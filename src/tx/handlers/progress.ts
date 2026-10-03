// 업적·튜토리얼·설정 처리기
import { claim } from "../../achievement/claim.js";
import { done as doneTutorial, skip as skipTutorial } from "../../tutorial/queue.js";
import { isSettingKey, setSetting } from "../../state/settings.js";
import type { TxHandler } from "../executor";
import { isObj, reasonOf } from "./args.js";

// ── 업적과 튜토리얼 ────────────────────────────────────────────────────────────

const idOf = (args: unknown): string | null => {
  if (!isObj(args)) return null;
  const id = args.id;
  return typeof id === "string" && id ? id : null;
};

// 업적 보상 수령 — 업적당 한 번. 파티 칸·포켓몬·포인트·알·도구 가운데 그 업적의 보상을 준다 (src/achievement/core.ts claim)
export const claimHandler: TxHandler = (draft, args, ctx) => {
  const id = idOf(args);
  if (!id) return { ok: false, reason: "bad-args" };
  const res = claim(draft, id, ctx.now, undefined, ctx.rand);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { id, slotIndex: res.slotIndex, petId: res.petId, toBox: res.toBox, points: res.points, eggId: res.eggId, item: res.item, skipped: res.skipped } };
};

export const tutorialHandler = (kind: "skip" | "done"): TxHandler => (draft, args) => {
  const id = idOf(args);
  if (!id) return { ok: false, reason: "bad-args" };
  const steps = isObj(args) && typeof args.steps === "number" ? args.steps : undefined;
  const res = kind === "skip" ? skipTutorial(draft, id) : doneTutorial(draft, id, steps);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { id, state: res.state, steps: res.steps } };
};

// ── 설정 ───────────────────────────────────────────────────────────────────────

// 설정 한 항목 바꾸기 — 허용 값은 src/state/settings.ts 가 가진다
export const settingsHandler: TxHandler = (draft, args) => {
  if (!isObj(args)) return { ok: false, reason: "bad-args" };
  if (!isSettingKey(args.key)) return { ok: false, reason: "bad-args" };
  const res = setSetting(draft, args.key, args.value);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { key: res.key, value: res.value } };
};
