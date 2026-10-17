// 저장 쓰기의 종류 — 클라우드에 바로 올릴 사건인가, 스로틀로 모아 올릴 것인가 (./cloud.ts noteSaved)
import { FIND_POKEMON, type WriteName } from "../shared/names/commands.js";
import type { SaveKind } from "./cloud-state.js";

// 클라우드에 바로 올리는 쓰기 — 잃으면 되돌리기 어려운 사건 (design-p1.md 6절, cloud-authority.md D27).
// 이름은 src/tx/command-table.ts 의 거래 이름(TxName)이다. 나머지 명령 쓰기(돌봄·설정 등)는 2분, 시간 진행만 바뀐 쓰기는 10분 스로틀로 모아 올린다(./cloud.ts noteSaved).
// 교환 ack 뒤 올리기는 교환 세션이 따로 알린다 (src/online/trade-session.ts onSettled)
const EVENT_WRITES: ReadonlySet<string> = new Set<WriteName>([
  "trade.lock",
  "trade.unlock",
  "trade.apply",
  "mail.apply",
  "battle.reward",
  "battle.claim",
  "egg.open",
  "evolve",
  "starter.pick",
  FIND_POKEMON,
]);

// 쓰기 이름 → 종류. 이름이 없는 쓰기(시간 진행)는 tick, 그 밖의 이름 있는 쓰기(명령)는 change 다
export const saveKindOf = (name: string | undefined): SaveKind => (!name ? "tick" : EVENT_WRITES.has(name) ? "event" : "change");
