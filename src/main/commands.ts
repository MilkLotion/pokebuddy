// 커맨드 배선 — dispatcher 를 만들고 무대가 받는 명령을 등록한다. writer 면 mailbox 를 잇는다 (CLI·읽기 전용 펫의 요청).
//
// 저장을 바꾸는 명령은 전부 거래 실행기(`src/tx/game.ts`)로 간다. 여기서 저장을 직접 고치지 않는다.
//   writer  실행기를 직접 부른다
//   reader  mailbox 로 보낸다. writer 가 처리해 파일에 쓰면 감시가 읽어 온다
// 창 표시 항목(hidden · clickThrough)만 저장 밖의 설정이라 여기서 처리한다.
// 결과 문구는 표면이 구성한다 — 여기서는 코드만 돌려준다.
import { bridgeMailbox } from "../commands/dispatcher";
import { createDispatcher, registerTxCommands, type Dispatcher } from "../tx/dispatcher";
import { sendToWriter, type CommandServer } from "../save/command-channel";
import type { Command, CommandResult } from "../shared/command";
import type { Reason } from "../shared/names/reasons";
import type { Size } from "../shared/geometry";
import type { PartyRequest, SaveParty } from "../save/save-party";
import { partyPetsOf } from "../view/party-pet";
import type { GameV3 } from "../tx/game";
import type { CareAction } from "../state/types";
import { evolveCandidates } from "../dex/evolve";
import { gameDayPart } from "../shared/clock";
import { appearanceOf } from "../dex/look";
import { unlockRules } from "../dex/unlocks";
import { itemOf } from "../bag/use";
import { argsFromCommand } from "../tx/args";
import type { SaveV3 } from "../shared/save-v3";
import type { TradeActionResult, TradeSession } from "../online/trade-session";

export interface CommandSettings {
  hidden(): boolean;
  setHidden(on: boolean): void;
  clickThrough(): boolean;
  setClickThrough(on: boolean): void;
}

export interface CommandContext {
  mailboxDir: string;
  party: SaveParty;
  game: GameV3;
  stage: { care?(id: string, action: CareAction): void; petIds(): string[]; size(): Size; visible(): boolean };
  settings: CommandSettings;
  quit(): void;
  prepareLook?(look: string): Promise<boolean>;
  onChanged?(evolvedId?: string): Promise<void>;
  log?: ((o: Record<string, unknown>) => void) | null;
  trade?: () => TradeSession | null; // 친구 교환 — 앱이 준비된 뒤 생기므로 부를 때 가져온다 (src/main/trade.ts)
  tradeScreen?: () => unknown; // 교환 모달이 그리는 값 (src/view/trade-screen.ts) — 결과의 screen 에 싣는다
  // 명령을 받기 전에 거른다 — 거절 사유를 주면 처리기로 보내지 않고 { ok: false, reason } 으로 답한다. null 이면 통과.
  // 무대 클릭(click)·메뉴·관리 창·mailbox 가 모두 dispatcher.dispatch 를 지나므로 한 곳에서 막힌다 (앱의 두 PC 규칙 멈춤)
  guard?: (command: Command) => Reason | null;
  // 게임 시각 — 마지막 1초 틱의 시각(앱은 전역 시계 clock.last). 틱 밖의 명령도 실행기처럼 이 시각으로 계산한다 (docs/specs/modules.md "저장 시점"). 없으면 지금 시각(자체 검사)
  now?: () => number;
}

export interface Commands {
  dispatcher: Dispatcher;
  setWriter(on: boolean): void; // writer 가 되면 mailbox 를 잇고, 내주면 끊는다
  click(id: string): Promise<CommandResult>; // 포켓몬 클릭 — 놀아주기
  stop(): void;
}

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

// on/off · true/false · 1/0 · yes/no. 모르면 null
export function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return null;
  const v = String(value).trim().toLowerCase();
  if (["1", "on", "true", "yes", "y"].includes(v)) return true;
  if (["0", "off", "false", "no", "n"].includes(v)) return false;
  return null;
}

const SETTING_KEYS = ["hidden", "clickThrough"] as const;
type SettingKey = (typeof SETTING_KEYS)[number];
const isSettingKey = (v: unknown): v is SettingKey => typeof v === "string" && (SETTING_KEYS as readonly string[]).includes(v);

// 그림을 기다린 뒤 이보다 오래된 요청은 반영하지 않는다. 보낸 쪽은 진화 답을 45초 기다린다 (src/save/command-channel.ts).
// 보낸 쪽이 포기한 뒤에 진화하면 실패로 안 채로 상태만 바뀐다
const EVOLVE_EXPIRE_MS = 40_000;

export function createCommands(ctx: CommandContext): Commands {
  const now = ctx.now ?? Date.now;
  const log = ctx.log ?? null;
  // 멈춤 거르기는 명령 통로의 guard 옵션이다 (src/tx/dispatcher.ts) — dispatch 를 덮어쓰지 않는다 (설계 D4)
  const dispatcher = createDispatcher({ log, guard: ctx.guard ?? null });
  let server: CommandServer | null = null;

  const target = (c: Command): string | null => (typeof c.target === "string" && c.target ? c.target : null);
  // 개체 명령의 대상 — target 이 없으면 args.petId 를 본다. 실행기의 인자 풀기(src/tx/args.ts argsFromCommand)와 같은 규칙이다 (X4, 2026-10-03)
  const petTarget = (c: Command): string | null => target(c) ?? (isObj(c.args) && typeof c.args.petId === "string" && c.args.petId ? c.args.petId : null);

  // 쓰는 프로세스는 메모리 값(1초 틱 진행 포함)을 본다 — 파일은 15초마다 쓴다 (src/tx/game.ts). 못 읽으면 저장 감시의 값
  const currentSave = (): SaveV3 | null => (ctx.party.isWriter() ? ctx.game.read() : null) ?? ctx.party.save();

  // 저장을 바꾸는 명령 하나 — writer 면 실행기로, reader 면 mailbox 로.
  // mailbox 를 잇고 있는 쪽(server)이 reader 일 수는 없다. 그때는 받아 줄 writer 가 없다는 뜻이다
  async function runSave(c: Command): Promise<CommandResult> {
    if (!ctx.party.isWriter()) return server ? { ok: false, reason: "not-writer" } : sendToWriter(ctx.mailboxDir, c);
    const result = ctx.game.send({ cmd: c.cmd, target: c.target, args: c.args }, c.from);
    ctx.party.refresh();
    return result;
  }

  // 저장이 바뀐 뒤 무대를 다시 그린다. 진화는 그 마리를 축하한다
  async function refreshAfter(evolvedId?: string): Promise<void> {
    try {
      await ctx.onChanged?.(evolvedId);
    } catch (e) {
      log?.({ commands: "refresh-failed", message: String(e) });
    }
  }

  dispatcher.register("quit", () => {
    // 회신이 먼저 파일에 내려가게 한 박자 뒤에 끝낸다 (mailbox 로 온 quit)
    setTimeout(() => ctx.quit(), 50);
    return { ok: true, reason: "ok" };
  });

  // 저장 설정은 실행기로 간다 — 무대를 다시 그리지 않는다
  dispatcher.register("settings.set", (c) => runSave(c));

  // 창 표시 두 항목은 저장 밖의 설정이라 여기서 처리한다. 모르는 키는 bad-value
  dispatcher.register("display.set", (c) => {
    const key = target(c) ?? (isObj(c.args) ? c.args.key : undefined);
    if (!isSettingKey(key)) return { ok: false, reason: "bad-args", key: String(key) }; // 같은 잘못은 같은 코드 (94 항목 9-5-2)
    const value = asBool(isObj(c.args) ? c.args.value : undefined);
    if (value == null) return { ok: false, reason: "bad-value", key };
    if (key === "hidden") ctx.settings.setHidden(value);
    else ctx.settings.setClickThrough(value);
    return { ok: true, reason: "ok", key, value };
  });

  // 받은 요청의 식별자와 보낸 곳 — 파티 저장이 그대로 넘긴다. 설정창이 다시 보낸 요청이 같은 reqId 로 한 번만 실행된다 (94 문서 9-2-3)
  const partyRequest = (c: Command): PartyRequest => ({ ...(isObj(c.args) && typeof c.args.reqId === "string" && c.args.reqId ? { reqId: c.args.reqId } : {}), from: c.from });

  // 숨기기·보이기도 다른 개체 명령과 같이 target 이 없으면 args.petId 를 본다 (94 문서 4-12, X4)
  const showHide = (shown: boolean) => async (c: Command): Promise<CommandResult> => {
    const id = petTarget(c);
    if (!id) return { ok: false, reason: "bad-args" }; // 같은 잘못은 같은 코드 (94 항목 9-5-2)
    return ctx.party.setShown(id, shown, partyRequest(c));
  };
  dispatcher.register("party.show", showHide(true));
  dispatcher.register("party.hide", showHide(false));

  // pet.set — 자리 또는 그림 크기
  dispatcher.register("pet.set", async (c) => {
    const id = petTarget(c);
    // 크기는 박스 개체도 정한다 — 파티에 나오면 그 크기로 보인다 (2026-09-30). 자리(home)는 파티 개체만
    const inParty = !!id && partyPetsOf(ctx.party.save(), false).some((p) => p.id === id);
    const owned = inParty || (!!id && !!currentSave()?.pets.some((p) => p.id === id));
    if (!id || !owned) return { ok: false, reason: "no-pet", id: String(id) };
    const size = isObj(c.args) ? c.args.size : undefined;
    if (size !== undefined) {
      if (typeof size !== "number") return { ok: false, reason: "bad-value", id };
      return ctx.party.setSize(id, size, partyRequest(c));
    }
    const home = isObj(c.args) ? c.args.home : undefined;
    if (!inParty) return { ok: false, reason: "no-pet", id };
    if (!isObj(home)) return { ok: false, reason: "not-yet", id };
    const { dx, dy } = home;
    if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy)) return { ok: false, reason: "bad-value", id };
    // 사는 화면 — 모든 화면 방식에서 끌어다 놓았을 때만 온다. 값 검사는 실행기(src/party/home.ts)가 한다
    const screen = isObj(c.args) && c.args.screen !== undefined ? c.args.screen : undefined;
    return ctx.party.setHome(id, { dx, dy }, screen, partyRequest(c));
  });

  // 돌봄 — 저장은 실행기가 바꾸고 무대는 반응만 보인다
  for (const action of ["feed", "play"] as const) dispatcher.register(action, async (c) => {
    const id = petTarget(c);
    if (!id) return { ok: false, reason: "bad-args" }; // 같은 잘못은 같은 코드 (94 항목 9-5-2)
    const result = await runSave(c);
    if (result.ok) ctx.stage.care?.(id, action);
    return result;
  });

  // 진화는 그림이 있어야 한다. 바뀔 모습을 먼저 받아 두고, 못 받으면 저장을 건드리지 않는다
  dispatcher.register("evolve", async (c) => {
    const id = petTarget(c);
    if (!id) return { ok: false, reason: "bad-args" }; // 같은 잘못은 같은 코드 (94 항목 9-5-2)
    const save = ctx.party.isWriter() ? currentSave() : null;
    if (save) {
      const pet = save.pets.find((row) => row.id === id);
      if (!pet) return { ok: false, reason: "no-pet", id };
      const choice = typeof c.args?.to === "string" ? c.args.to : null;
      // 낮·밤은 실행기(src/tx/handlers/pet.ts)와 같은 틱 시각으로 가른다 (94 문서 9-2-2)
      const targets = choice ? [choice] : evolveCandidates(save, id, gameDayPart(now())).filter((x) => x.ready).map((x) => x.to);
      for (const species of targets) {
        const look = appearanceOf({ species, shiny: pet.shiny, gender: pet.gender }); // 성별 그림이 있는 종(대쓰여너 암컷)은 그 그림을 받는다
        if (ctx.prepareLook && !(await ctx.prepareLook(look))) return { ok: false, reason: "art-missing", look };
      }
      // 만료는 보낸 쪽 벽시계(c.at)와 견주는 기다림 한도라 벽시계로 잰다 — 게임 계산이 아니다
      if (c.at != null && Date.now() - c.at > EVOLVE_EXPIRE_MS) return { ok: false, reason: "expired", id };
    }
    const result = await runSave(c);
    if (result.ok) await refreshAfter(id);
    return result;
  });

  // 공유 sid 계열의 모습 바꾸기 — 진화처럼 바뀔 종의 그림을 먼저 받아 둔다. 못 받으면 저장을 건드리지 않는다
  dispatcher.register("pet.form", async (c) => {
    const id = petTarget(c);
    if (!id) return { ok: false, reason: "bad-args" }; // 같은 잘못은 같은 코드 (94 항목 9-5-2)
    const species = typeof c.args?.species === "string" ? c.args.species : null;
    const save = ctx.party.isWriter() ? currentSave() : null;
    const pet = save?.pets.find((row) => row.id === id);
    if (pet && species && ctx.prepareLook) {
      const look = appearanceOf({ species, shiny: pet.shiny, gender: pet.gender });
      if (!(await ctx.prepareLook(look))) return { ok: false, reason: "art-missing", look };
    }
    const result = await runSave(c);
    if (result.ok) await refreshAfter(id);
    return result;
  });

  // 모습 선택은 제거했다 — 실제 종의 이름과 그림을 보인다 (docs/specs/game.md "별명 입력과 모습 선택을 제공하지 않는다").
  // 옛 값은 legacy 에 남아 있다. 명령 pet.look 은 없앴다 (2026-10-03)

  // 나머지 저장 명령 — 인자를 풀고 실행기에 넣는 일만 한다.
  // 무대 다시 그리기는 기다리지 않고 답한다. 처음 나오는 종은 그림을 인터넷에서 받느라 1~2초 걸린다 — 관리 창이 그동안 멈춰 보였다
  // (worklog/records/response-latency/record.md)
  // 위에서 따로 등록한 명령(무대 반응·그림 준비가 필요한 것과 저장 감시가 맡는 것)은 뺀다.
  // party.show · party.hide · pet.set 은 reader 경로가 달라 `ctx.party` 가 맡는다 (src/save/save-party.ts)
  registerTxCommands(dispatcher, async (c) => {
    const result = await runSave(c);
    if (result.ok) {
      if (c.cmd === "bag.use") bagReaction(c);
      void refreshAfter();
    }
    return result;
  }, { except: ["settings.set", "party.show", "party.hide", "pet.set", "feed", "play", "evolve", "pet.form"] });

  // 가방 도구를 쓴 뒤 무대 반응 — 먹이는 메뉴의 밥 주기, 장난감은 놀아주기와 같은 반응(울음소리 포함)이다.
  // 무대에 없는 개체(박스·숨김)는 stage.care 가 그냥 넘어간다. 그 밖의 도구는 새 반응이 없다(약은 그림이 바뀐다).
  // 파티클은 보류다 (docs/specs/game.md, 2026-09-30 사용자 결정 추천안 "파티클은 뒤로")
  function bagReaction(c: Command): void {
    const { petId, itemId } = argsFromCommand(c); // 실행기와 같은 풀이 — 도구는 target, 개체는 args.petId
    if (typeof petId !== "string" || !petId || typeof itemId !== "string" || !itemId) return;
    const effect = itemOf(itemId)?.effect;
    if (effect === "fullness" || effect === "fullness-full-buff") ctx.stage.care?.(petId, "feed");
    else if (effect === "play-buff") ctx.stage.care?.(petId, "play");
  }


  // 친구 교환 — 서버를 타므로 결과를 기다려 교환 보기를 돌려준다. writer 만 교환 세션을 가진다.
  // reader 는 다른 저장 명령처럼 mailbox 로 writer 에 넘긴다 (worklog/records/trade/record.md "구현 2c~2e 계획과 E2E 설계")
  // 결과는 조작의 결과다. 보기의 error 는 앞선 새로 고침의 실패일 수 있어 결과로 쓰지 않는다
  const tradeCommand = (run: (session: TradeSession, c: Command) => Promise<TradeActionResult> | TradeActionResult) => async (c: Command): Promise<CommandResult> => {
    if (!ctx.party.isWriter()) return server ? { ok: false, reason: "not-writer" } : sendToWriter(ctx.mailboxDir, c);
    const session = ctx.trade?.() ?? null;
    if (!session) return { ok: false, reason: "trade-off" };
    const r = await run(session, c);
    const screen = ctx.tradeScreen?.();
    const extra = { trade: session.view(), ...(screen ? { screen } : {}) };
    return r.ok ? { ok: true, reason: "ok", ...extra } : { ...r, ...extra };
  };
  const argStr = (c: Command, key: string): string => (isObj(c.args) && typeof c.args[key] === "string" ? (c.args[key] as string) : "");
  dispatcher.register("trade.create", tradeCommand((s) => s.create()));
  dispatcher.register("trade.join", tradeCommand((s, c) => s.join(argStr(c, "link") || target(c) || "")));
  dispatcher.register("trade.offer", tradeCommand((s, c) => s.offer(target(c) ?? argStr(c, "petId"))));
  dispatcher.register("trade.ready", tradeCommand((s) => s.ready()));
  dispatcher.register("trade.unready", tradeCommand((s) => s.unready()));
  dispatcher.register("trade.leave", tradeCommand((s) => s.leave()));
  dispatcher.register("trade.status", tradeCommand(() => ({ ok: true }))); // 서버를 다시 읽지 않는다 — 실시간 신호·주기 새로 고침이 바꾼 보기를 본다

  // CLI 가 읽는 현재 상태. 저장 v3 의 값을 그대로 준다 — 화면 문구는 표면이 만든다
  dispatcher.register("snapshot", () => {
    const save = currentSave();
    const slots = save?.party.slots ?? [];
    return {
      ok: true,
      reason: "ok",
      writer: ctx.party.isWriter(),
      stage: ctx.stage.size(),
      visible: ctx.stage.visible(),
      shown: ctx.stage.petIds(),
      hidden: ctx.settings.hidden(),
      clickThrough: ctx.settings.clickThrough(),
      slots: slots.length ? slots.filter((s) => s.state !== "locked").length : null,
      points: save?.points.balance ?? null,
      bag: save?.bag ?? {},
      unlocked: save?.dex.unlocked ?? [],
      obtained: save?.dex.obtained ?? [],
      dex: unlockRules(),
      eggs: save?.eggs.map((e) => ({ id: e.id, kind: e.kind, ready: e.ready, remainMs: e.remainMs })) ?? [],
      achievements: save?.achievements ?? {},
      log: save?.log ?? [],
      party: save
        ? slots.map((s, index) => ({ index, state: s.state, petId: s.petId ?? null, hidden: s.hidden === true }))
        : partyPetsOf(ctx.party.save(), false),
      pets: save?.pets ?? [],
    };
  });


  return {
    dispatcher,
    // 포켓몬 클릭은 놀아주기다 (docs/specs/game.md "직접 돌봄 — 클릭 한 번으로 반응을 구경한다").
    // 클릭 반응은 무대가 이미 보였다. 놀아주기에 성공하면 play 명령이 놀이 연출을 더한다.
    // 쿨타임처럼 못 놀아주면 반응만으로 끝난다. 실패를 알림으로 띄우지 않는다
    async click(id) {
      return dispatcher.dispatch({ cmd: "play", target: id, from: "pet" });
    },
    setWriter(on) {
      if (on && !server) {
        server = bridgeMailbox(dispatcher, ctx.mailboxDir, { log });
        log?.({ commands: "mailbox", dir: ctx.mailboxDir });
      } else if (!on && server) {
        server.stop();
        server = null;
      }
    },
    stop() {
      server?.stop();
      server = null;
    },
  };
}
