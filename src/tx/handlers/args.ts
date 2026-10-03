// 처리기가 인자를 푸는 작은 도우미 — 처리기마다 같은 모양을 같은 글자로 푼다
import type { Reason } from "../../shared/names/reasons.js";

export const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

export const petIdOf = (args: unknown): string | null => {
  if (!isObj(args)) return null;
  const id = args.petId;
  return typeof id === "string" && id ? id : null;
};

export const slotOf = (args: unknown): number | null => {
  if (!isObj(args)) return null;
  const i = args.slotIndex;
  return typeof i === "number" && Number.isInteger(i) && i >= 0 ? i : null;
};

export const intOf = (args: unknown, key: string): number | null => {
  const v = isObj(args) ? args[key] : undefined;
  return typeof v === "number" && Number.isInteger(v) ? v : null;
};

// 도메인 결과의 거절 까닭 — 도메인은 실패에 까닭을 늘 싣는다. 싣지 않았으면 처리기의 잘못으로 보고 error 다
export const reasonOf = <R extends Reason>(res: { reason?: R }): R | "error" => res.reason ?? "error";
