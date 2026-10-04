// 파티 저장의 writer·reader 나누기 — 무대·메뉴의 파티 명령을 writer 면 실행기로, reader 면 writer 에게 보낸다.
//
// 저장을 직접 고치지 않는다. 모든 변경은 거래 실행기를 거친다 — 앱이 실행기의 입구(send)를 넘긴다 (src/tx/game.ts).
// 그래서 여기는 명령 보내기만 한다. 잠금 잡기와 파일 다시 읽기는 저장 감시(src/save/save-watch.ts)다.
// 무대가 읽을 모양(PartyPet)은 화면 값이 만든다 — 부르는 쪽이 partyPetsOf(party.save(), …)를 부른다 (src/view/party-pet.ts)
//
// 잠금 파일은 `save.lock` 이다. 기기에서 저장을 쓰는 프로세스는 하나다
// (docs/specs/modules.md "창이 여러 개여도 저장 쓰기는 주 프로세스 하나가 한다").
//   writer  잠금을 잡았다. 명령을 직접 실행한다
//   reader  못 잡았다. 명령을 mailbox 로 보내고, 파일이 바뀌면 다시 읽는다. 10초마다 다시 잡아 본다
// (예전 src/main/save-party.ts. 메인 레인 M8-8 에서 저장 층으로 옮겼다)
import { sendToWriter } from "./command-channel.js";
import { createEmptySave } from "./save-file.js";
import { createSaveWatch } from "./save-watch.js";
import type { CommandResult } from "../shared/command";
import type { HomePoint } from "../party/home";
import type { ManageReply, ManageRequest } from "../shared/ipc/manage";
import type { CommandSource } from "../shared/names/commands";
import type { SaveV3 } from "../shared/save-v3";
import type { Paths } from "../platform/paths";

export interface SavePartyOptions {
  send: (req: ManageRequest, from: CommandSource) => ManageReply; // 거래 실행기의 입구 — 앱은 game.send
  paths: Pick<Paths, "save" | "saveLock" | "mailbox">;
  now?: () => number;
  pid?: number;
  log?: ((o: Record<string, unknown>) => void) | null;
}

// 부르는 쪽이 받은 요청의 식별자와 보낸 곳 — 설정창은 답을 못 받으면 같은 reqId 로 다시 보낸다(docs/specs/game.md "요청 ID로 중복을 막는다").
// 받은 것이 있으면 그대로 실행기·writer 에 넘기고, 없으면(무대 끌기·메뉴) 여기서 만든다
export interface PartyRequest {
  reqId?: string;
  from?: CommandSource;
}

export interface SaveParty {
  isWriter(): boolean;
  needsStarter(): boolean;
  begin(species: string): boolean;
  setHome(id: string, home: HomePoint, screen?: unknown, req?: PartyRequest): Promise<CommandResult>; // 저장하지 못하면 그 이유를 돌려준다. screen 은 사는 화면(모든 화면 방식)
  setSize(id: string, size: number, req?: PartyRequest): Promise<CommandResult>; // 그림 크기 단계 번호. 규칙은 src/party/home.ts · src/save/rules.ts SIZE_STEPS
  setShown(id: string, shown: boolean, req?: PartyRequest): Promise<CommandResult>;
  save(): SaveV3 | null;
  refresh(): void; // 명령을 보낸 뒤 바로 다시 읽는다 — 감시를 기다리지 않는다
  onChange(cb: () => void): () => void;
  onRole(cb: (isWriter: boolean) => void): () => void;
  stop(): void;
}

export function createSaveParty(opts: SavePartyOptions): SaveParty {
  const { send, paths } = opts;
  const now = opts.now ?? Date.now;
  const sw = createSaveWatch({ paths, ...(opts.pid !== undefined ? { pid: opts.pid } : {}), log: opts.log ?? null });

  // reader 의 요청 — writer 가 처리해 파일에 쓰면 감시가 읽어 온다. 받은 reqId·from 은 그대로 싣는다
  const ask = (cmd: "pet.set" | "party.show" | "party.hide", target: string, args: Record<string, unknown>, req: PartyRequest | undefined): Promise<CommandResult> => {
    const all = req?.reqId ? { ...args, reqId: req.reqId } : args;
    return sendToWriter(paths.mailbox, { cmd, target, ...(Object.keys(all).length ? { args: all } : {}), from: req?.from ?? "pet" });
  };

  // writer 판정은 하나다 — 잠금 파일에 내 pid 가 적혀 있는가까지 본다(sw.isWriter). 앱의 다른 writer 검사(명령 통로·우편·교환)와 같다 (94 문서 9-5-4)
  //   run   writer — 실행기로 바로
  //   ask   reader — writer 에게 mailbox 로 보낸다
  //   lost  역할을 맡았다고 알고 있는데 잠금이 내 것이 아니다(빼앗겼다, 감시가 아직 모른다) — not-writer.
  //         mailbox 로 보내면 아직 잇고 있는 내 명령 통로로 되돌아온다 (src/main/app/commands.ts runSave 의 server 분기와 같은 뜻)
  const route = (): "run" | "ask" | "lost" => (sw.isWriter() ? "run" : sw.holdsRole() ? "lost" : "ask");
  const lost: CommandResult = { ok: false, reason: "not-writer" };

  return {
    isWriter: sw.isWriter,
    needsStarter: () => {
      const state = sw.save();
      return sw.isWriter() && (!state || state.pets.length === 0);
    },
    begin(species) {
      if (!sw.isWriter()) return false;
      // 저장이 아직 없으면 빈 저장을 먼저 만든다. 실행기는 읽을 것이 있어야 돈다
      if (!sw.save() && !createEmptySave(paths.save, now())) return false;
      const r = send({ cmd: "starter.pick", target: species, args: { reqId: `starter:${species}:${now()}` } }, "menu");
      sw.refresh();
      return r.ok;
    },
    async setHome(id, home, screen, req) {
      const extra = screen !== undefined ? { screen } : {};
      const way = route();
      if (way === "lost") return lost;
      if (way === "ask") return ask("pet.set", id, { home, ...extra }, req);
      const r = send({ cmd: "pet.set", target: id, args: { home, ...extra, reqId: req?.reqId ?? `home:${id}:${now()}` } }, req?.from ?? "pet");
      sw.refresh();
      return r;
    },
    async setSize(id, size, req) {
      const way = route();
      if (way === "lost") return lost;
      if (way === "ask") return ask("pet.set", id, { size }, req);
      const r = send({ cmd: "pet.set", target: id, args: { size, reqId: req?.reqId ?? `size:${id}:${now()}` } }, req?.from ?? "menu");
      sw.refresh();
      return r;
    },
    async setShown(id, shown, req) {
      const way = route();
      if (way === "lost") return lost;
      if (way === "ask") return ask(shown ? "party.show" : "party.hide", id, {}, req);
      const r = send({ cmd: shown ? "party.show" : "party.hide", target: id, args: { reqId: req?.reqId ?? `shown:${id}:${now()}` } }, req?.from ?? "menu");
      sw.refresh();
      return r;
    },
    save: sw.save,
    refresh: sw.refresh,
    onChange: sw.onChange,
    onRole: sw.onRole,
    stop: sw.stop,
  };
}
