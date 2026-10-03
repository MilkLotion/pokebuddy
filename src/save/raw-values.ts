// 저장 정규화의 값 읽기 도우미 — 손으로 고칠 수 있는 파일 값을 너그럽게 읽는다. save 폴더 안에서만 쓴다
// 정수 값(int · nonNeg)은 반올림한다. 저장 v2 의 도우미(./v2/normalize.ts)는 반올림하지 않아 따로 둔다
import type { NatureId } from "../shared/species";
import { isNatureId } from "../dex/natures";

export type Raw = Record<string, unknown>;

export const isRawObject = (v: unknown): v is Raw => v != null && typeof v === "object" && !Array.isArray(v);
export const numOr = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
export const intOr = (v: unknown, d = 0): number => Math.round(numOr(v, d));
export const nonNeg = (v: unknown, d = 0): number => Math.max(0, intOr(v, d));
export const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const boolOr = (v: unknown, d = false): boolean => (typeof v === "boolean" ? v : d);
export const strOr = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
export const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
export const uniqueList = <T>(list: T[]): T[] => [...new Set(list)];

// 성격 식별자인가 — 글자이고 성격 표에 있다
export const isNatureValue = (v: unknown): v is NatureId => typeof v === "string" && isNatureId(v);

// 정해진 선택지 가운데 하나인가 — 아니면 기본값
export const choiceOr = <T>(v: unknown, choices: readonly T[], fallback: T): T => (choices.some((c) => c === v) ? (v as T) : fallback);
