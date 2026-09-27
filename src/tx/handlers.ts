// 명령 이름 → 도메인 처리 — 계약은 docs/specs/modules.md "명령 계약".
//
// 처리기는 사본만 고치고 성공 여부를 돌려준다. 저장은 거래 실행기가 한다.
// 도메인 규칙은 각 모듈(src/party 등)에 두고 여기서는 인자를 풀어 넘기기만 한다.
import { use } from "../bag/use.js";
import { claim } from "../achievement/core.js";
import { dayPartOf, evolve } from "../dex/evolve.js";
import { done as doneTutorial, skip as skipTutorial } from "../tutorial/core.js";
import { care, isCareAction } from "../egg/care.js";
import { open } from "../egg/open.js";
import { setForm } from "../dex/forms.js";
import { keep, place, swap } from "../party/placement.js";
import { setHidden, shownCount } from "../party/visibility.js";
import { feed, play } from "../state/care.js";
import { isSettingKey, setSetting } from "../state/settings.js";
import { setHome, setSize } from "../party/home.js";
import { begin } from "../party/starter.js";
import { buy } from "../shop/buy.js";
import { isBoxSortKey, moveSlot, moveToBox, renameBox, sortBox } from "../box/slots.js";
import { petName } from "../main/text.js";
import { apply as applyTrade, isLocked as isTradeLocked, lock as lockTrade, unlock as unlockTrade } from "../trade/core.js";
import type { TxHandler } from "./executor";

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

const petIdOf = (args: unknown): string | null => {
  if (!isObj(args)) return null;
  const id = args.petId;
  return typeof id === "string" && id ? id : null;
};

const slotOf = (args: unknown): number | null => {
  if (!isObj(args)) return null;
  const i = args.slotIndex;
  return typeof i === "number" && Number.isInteger(i) && i >= 0 ? i : null;
};

// 표시·숨김 — 칸의 hidden 하나만 바꾼다
const visibility = (hidden: boolean): TxHandler => (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = setHidden(draft.party.slots, petId, hidden);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return { ok: true, result: { petId, hidden, shown: shownCount(draft.party.slots) } };
};

// 박스 개체를 빈 파티 칸에 — 칸을 지정하지 않으면 앞의 빈 칸에 넣는다
const placeHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = place(draft, petId, slotOf(args) ?? undefined);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return { ok: true, result: { petId, slotIndex: res.slotIndex, hidden: true } };
};

// 파티 칸의 개체와 박스 개체를 한 번에 맞바꾼다
const swapHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  const slotIndex = slotOf(args);
  if (!petId || slotIndex == null) return { ok: false, reason: "bad-args" };
  const res = swap(draft, slotIndex, petId);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return { ok: true, result: { petId, slotIndex: res.slotIndex, movedOut: res.movedOut, hidden: true } };
};

// 파티 개체를 박스에 보관한다
const keepHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = keep(draft, petId);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return { ok: true, result: { petId, slotIndex: res.slotIndex } };
};

export const HANDLERS: Record<string, TxHandler> = {
  "party.show": visibility(false),
  "party.hide": visibility(true),
  "party.place": placeHandler,
  "party.swap": swapHandler,
  "party.keep": keepHandler,
};

// ── 알 ─────────────────────────────────────────────────────────────────────────

const eggIdOf = (args: unknown): string | null => {
  if (!isObj(args)) return null;
  const id = args.eggId;
  return typeof id === "string" && id ? id : null;
};

// 돌봄 — 준비 시간을 줄이고 행동 조건을 쌓는다
const careHandler: TxHandler = (draft, args) => {
  const eggId = eggIdOf(args);
  const action = isObj(args) ? args.action : null;
  if (!eggId || !isCareAction(action)) return { ok: false, reason: "bad-args" };
  const egg = draft.eggs.find((e) => e.id === eggId);
  if (!egg) return { ok: false, reason: "no-egg" };
  const res = care(egg, action);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return { ok: true, result: { eggId, action, shortenedMs: res.shortenedMs, remainMs: res.remainMs, ready: res.ready } };
};

// 열기 — 결과 판정, 개체 생성, 배치, 도감 기록을 한 거래로 묶는다
const openHandler: TxHandler = (draft, args, ctx) => {
  const eggId = eggIdOf(args);
  if (!eggId) return { ok: false, reason: "bad-args" };
  const res = open(draft, eggId, ctx.now, ctx.rand);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return {
    ok: true,
    result: res.egg
      ? { egg: res.egg }
      : { petId: res.petId, species: res.species, shiny: res.shiny, slotIndex: res.slotIndex, toBox: res.toBox, conditionId: res.conditionId },
  };
};

HANDLERS["egg.care"] = careHandler;
HANDLERS["egg.open"] = openHandler;

// ── 상점 ───────────────────────────────────────────────────────────────────────

// 구매 — 검사와 반영을 한 거래로 묶는다. 하나라도 걸리면 아무것도 바꾸지 않는다
const buyHandler: TxHandler = (draft, args, ctx) => {
  if (!isObj(args)) return { ok: false, reason: "bad-args" };
  const productId = typeof args.productId === "string" ? args.productId : "";
  if (!productId) return { ok: false, reason: "bad-args" };
  // 수량 — 없으면 1. 여러 개는 값이 있는 도구만 된다(알·포켓몬·파티 칸·0P 상품은 하나씩). 상한은 포인트다
  const count = args.count === undefined ? 1 : args.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return { ok: false, reason: "bad-args" };
  let res = buy(draft, productId, ctx.now, ctx.rand);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  let spent = res.spent ?? 0;
  if (count > 1) {
    if (!spent || res.eggId || res.petId || res.slotIndex !== undefined) return { ok: false, reason: "bad-args" };
    for (let i = 1; i < count; i += 1) {
      res = buy(draft, productId, ctx.now, ctx.rand);
      if (!res.ok) return { ok: false, reason: res.reason ?? "failed" }; // 실행기가 사본을 버린다 — 앞서 산 것도 반영하지 않는다
      spent += res.spent ?? 0;
    }
  }
  return {
    ok: true,
    result: { productId, count, spent, balance: res.balance, eggId: res.eggId, petId: res.petId, slotIndex: res.slotIndex, toBox: res.toBox },
  };
};

HANDLERS["shop.buy"] = buyHandler;

// ── 가방 ───────────────────────────────────────────────────────────────────────

// 도구 사용 — 대상 개체에 효과를 적용하고 하나를 차감한다
const useHandler: TxHandler = (draft, args) => {
  if (!isObj(args)) return { ok: false, reason: "bad-args" };
  const itemId = typeof args.itemId === "string" ? args.itemId : "";
  const petId = petIdOf(args);
  if (!itemId || !petId) return { ok: false, reason: "bad-args" };
  const nature = typeof args.nature === "string" ? args.nature : undefined;
  const res = use(draft, itemId, petId, { nature });
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return {
    ok: true,
    result: { itemId, petId, left: res.left, level: res.level, exp: res.exp, fullness: res.fullness, nature: res.nature, shiny: res.shiny },
  };
};

HANDLERS["bag.use"] = useHandler;

// ── 진화 ───────────────────────────────────────────────────────────────────────

// 진화 — 조건을 채운 개체를 사용자가 직접 진화시킨다. 후보가 여럿이면 골라야 한다
const evolveHandler: TxHandler = (draft, args, ctx) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const choice = isObj(args) && typeof args.to === "string" ? args.to : undefined;
  const part = dayPartOf(ctx.now);
  const res = evolve(draft, petId, part, choice);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed", ...(res.choices ? { choices: res.choices } : {}) };
  return { ok: true, result: { petId, from: res.from, to: res.to, usedItem: res.usedItem } };
};

HANDLERS["evolve"] = evolveHandler;

// ── 돌봄 ───────────────────────────────────────────────────────────────────────

// 밥 주기 — 기본먹이를 쓰는 것과 같다. 무료이며 쿨타임을 함께 쓴다
const feedHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = feed(draft, petId);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  draft.totals.fed += 1; // 누적 기록 — 첫 돌봄 튜토리얼이 "이미 돌봤다"를 본다. 2026-09-26 전에는 v3 에서 늘지 않았다
  return { ok: true, result: { petId, fullness: res.fullness } };
};

// 놀아주기 — 쿨타임마다 한 번 친밀도를 올린다
const playHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = play(draft, petId);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  draft.totals.played += 1;
  return { ok: true, result: { petId, affinity: res.affinity, streak: res.streak, longPlay: res.longPlay } };
};

HANDLERS["feed"] = feedHandler;
HANDLERS["play"] = playHandler;

// ── 업적과 튜토리얼 ────────────────────────────────────────────────────────────

const idOf = (args: unknown): string | null => {
  if (!isObj(args)) return null;
  const id = args.id;
  return typeof id === "string" && id ? id : null;
};

// 업적 보상 수령 — 업적당 한 번. 파티 칸 하나를 연다
const claimHandler: TxHandler = (draft, args, ctx) => {
  const id = idOf(args);
  if (!id) return { ok: false, reason: "bad-args" };
  const res = claim(draft, id, ctx.now);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return { ok: true, result: { id, slotIndex: res.slotIndex } };
};

const tutorialHandler = (kind: "skip" | "done"): TxHandler => (draft, args) => {
  const id = idOf(args);
  if (!id) return { ok: false, reason: "bad-args" };
  const steps = isObj(args) && typeof args.steps === "number" ? args.steps : undefined;
  const res = kind === "skip" ? skipTutorial(draft, id) : doneTutorial(draft, id, steps);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return { ok: true, result: { id, state: res.state, steps: res.steps } };
};

HANDLERS["achievement.claim"] = claimHandler;
HANDLERS["tutorial.skip"] = tutorialHandler("skip");
HANDLERS["tutorial.done"] = tutorialHandler("done");

// ── 설정 ───────────────────────────────────────────────────────────────────────

// 설정 한 항목 바꾸기 — 허용 값은 src/state/settings.ts 가 가진다
const settingsHandler: TxHandler = (draft, args) => {
  if (!isObj(args)) return { ok: false, reason: "bad-args" };
  if (!isSettingKey(args.key)) return { ok: false, reason: "bad-args" };
  const res = setSetting(draft, args.key, args.value);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return { ok: true, result: { key: res.key, value: res.value } };
};

HANDLERS["settings.set"] = settingsHandler;

// ── 첫 선택과 자리 ─────────────────────────────────────────────────────────────

// 첫 선택 — 저장이 비었을 때 한 번. 고른 종으로 개체 하나를 만들어 꺼내 놓는다
const starterHandler: TxHandler = (draft, args, ctx) => {
  if (!isObj(args)) return { ok: false, reason: "bad-args" };
  const species = typeof args.species === "string" ? args.species : "";
  if (!species) return { ok: false, reason: "bad-args" };
  const res = begin(draft, species, ctx.now, ctx.rand);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return { ok: true, result: { petId: res.petId, species: res.species, slotIndex: res.slotIndex } };
};

// 놓아 둔 자리와 그림 크기 — 끌어다 놓으면 자리를, 상세의 크기 단추는 크기를 보낸다. 한 요청에 하나만 온다
const homeHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  if (isObj(args) && args.size !== undefined) {
    const sized = setSize(draft, petId, args.size);
    if (!sized.ok) return { ok: false, reason: sized.reason ?? "failed" };
    return { ok: true, result: { petId, size: sized.size } };
  }
  const res = setHome(draft, petId, isObj(args) ? args.home : null);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return { ok: true, result: { petId, home: res.home } };
};

HANDLERS["starter.pick"] = starterHandler;
HANDLERS["pet.set"] = homeHandler;

// 공유 sid 계열의 모습 바꾸기 — 고를 수 있는 종으로 지금 종만 바꾼다 (src/dex/forms.ts)
const formHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = setForm(draft, petId, isObj(args) ? args.species : undefined);
  if (!res.ok) return { ok: false, reason: res.reason ?? "failed" };
  return { ok: true, result: { petId, from: res.from, to: res.to } };
};
HANDLERS["pet.form"] = formHandler;

// ── 박스 정렬·이동·이름 ─────────────────────────────────────────────────────────
// 박스의 slots 와 name 만 바꾼다. 파티·알·도감은 건드리지 않는다 (src/box/slots.ts)

const boxIndexOf = (draft: Parameters<TxHandler>[0], args: unknown, key: string): number => {
  const id = isObj(args) ? args[key] : undefined;
  return typeof id === "string" ? draft.boxes.findIndex((b) => b.id === id) : -1;
};
const intOf = (args: unknown, key: string): number | null => {
  const v = isObj(args) ? args[key] : undefined;
  return typeof v === "number" && Number.isInteger(v) ? v : null;
};

// 지금 보는 박스 하나를 기준대로 한 번 정렬한다
const boxSortHandler: TxHandler = (draft, args) => {
  const boxIndex = boxIndexOf(draft, args, "boxId");
  const by = isObj(args) ? args.by : undefined;
  if (boxIndex < 0) return { ok: false, reason: "no-box" };
  if (!isBoxSortKey(by)) return { ok: false, reason: "bad-args" };
  const box = draft.boxes[boxIndex];
  if (!box) return { ok: false, reason: "no-box" };
  sortBox(box, new Map(draft.pets.map((p) => [p.id, p])), by, (slug) => petName(slug));
  return { ok: true, result: { boxId: box.id, by } };
};

// 칸 옮기기 — toSlot 이 있으면 그 칸으로(빈 칸이면 옮기고 개체 칸이면 맞바꾼다), 없으면 toBoxId 의 첫 빈 칸으로
const boxMoveHandler: TxHandler = (draft, args) => {
  const from = boxIndexOf(draft, args, "boxId");
  const slot = intOf(args, "slot");
  const to = isObj(args) && args.toBoxId !== undefined ? boxIndexOf(draft, args, "toBoxId") : from;
  const toSlot = intOf(args, "toSlot");
  if (from < 0 || to < 0) return { ok: false, reason: "no-box" };
  if (slot == null) return { ok: false, reason: "bad-args" };
  if (toSlot == null) {
    const res = moveToBox(draft.boxes, { boxIndex: from, slotIndex: slot }, to);
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, result: { boxId: draft.boxes[to]?.id, slot: res.spot.slotIndex } };
  }
  const res = moveSlot(draft.boxes, { boxIndex: from, slotIndex: slot }, { boxIndex: to, slotIndex: toSlot });
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, result: { boxId: draft.boxes[to]?.id, slot: toSlot } };
};

// 박스 이름 바꾸기 — 비우면 기본 이름으로 돌아간다
const boxRenameHandler: TxHandler = (draft, args) => {
  const boxIndex = boxIndexOf(draft, args, "boxId");
  const name = isObj(args) ? args.name : undefined;
  const box = draft.boxes[boxIndex];
  if (!box) return { ok: false, reason: "no-box" };
  if (typeof name !== "string") return { ok: false, reason: "bad-args" };
  return { ok: true, result: { boxId: box.id, name: renameBox(box, name, boxIndex) } };
};

HANDLERS["box.sort"] = boxSortHandler;
HANDLERS["box.move"] = boxMoveHandler;
HANDLERS["box.rename"] = boxRenameHandler;

// ── 친구 교환 ───────────────────────────────────────────────────────────────────
// 서버 호출은 메인 프로세스가 한다. 여기서는 로컬 저장만 바꾼다 (src/trade/core.ts, docs/work/trade/record.md)

const strOf = (args: unknown, key: string): string | null => {
  const v = isObj(args) ? args[key] : undefined;
  return typeof v === "string" && v ? v : null;
};

// 확정할 때 잠근다
const tradeLockHandler: TxHandler = (draft, args) => {
  const channelId = strOf(args, "channelId");
  const petId = petIdOf(args);
  const offerRev = intOf(args, "offerRev");
  if (!channelId || !petId || offerRev == null || offerRev < 0) return { ok: false, reason: "bad-args" };
  const res = lockTrade(draft, channelId, petId, offerRev);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, result: { channelId, petId, offerRev } };
};

// 확정 풀기·취소·만료
const tradeUnlockHandler: TxHandler = (draft, args) => {
  const channelId = strOf(args, "channelId");
  if (!channelId) return { ok: false, reason: "bad-args" };
  return { ok: true, result: { channelId, unlocked: unlockTrade(draft, channelId) } };
};

// 완료 반영 — 한 번의 저장으로 맞바꾼다. 이미 반영했으면 아무것도 하지 않는다
const tradeApplyHandler: TxHandler = (draft, args, ctx) => {
  const channelId = strOf(args, "channelId");
  if (!channelId) return { ok: false, reason: "bad-args" };
  const res = applyTrade(draft, channelId, isObj(args) ? args.received : undefined, ctx.now);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, result: res.applied ? { channelId, applied: true, petId: res.newPetId, where: res.where } : { channelId, applied: false } };
};

HANDLERS["trade.lock"] = tradeLockHandler;
HANDLERS["trade.unlock"] = tradeUnlockHandler;
HANDLERS["trade.apply"] = tradeApplyHandler;

// 교환에 걸린 개체는 값을 바꾸는 명령을 거절한다. 자리만 바꾸는 명령(파티·박스 이동)과 돌봄·숨기기는 막지 않는다
// — 반영은 그때의 자리를 찾아 들어가므로 자리가 바뀌어도 된다. 값이 바뀌면 친구에게 간 값과 어긋난다
for (const name of ["bag.use", "evolve", "pet.form"] as const) {
  const inner = HANDLERS[name];
  if (!inner) continue;
  HANDLERS[name] = (draft, args, ctx) => {
    const petId = petIdOf(args);
    if (petId && isTradeLocked(draft, petId)) return { ok: false, reason: "trade-locked" };
    return inner(draft, args, ctx);
  };
}
