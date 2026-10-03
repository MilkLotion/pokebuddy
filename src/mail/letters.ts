// 받은 편지와 읽은 편지의 기록 — save.mail. 선물 넣기는 src/mail/gifts.ts
import type { SaveV3 } from "../shared/save-v3";
import { MAIL_RULES } from "./rules.js";

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
export const mailOf = (save: SaveV3): { applied: string[]; read: string[] } => (save.mail ??= { applied: [], read: [] });
export const remember = (list: string[], id: string): void => {
  if (list.includes(id)) return;
  list.push(id);
  if (list.length > MAIL_RULES.keep) list.splice(0, list.length - MAIL_RULES.keep);
};

export const isApplied = (save: SaveV3, letterId: string): boolean => save.mail?.applied.includes(letterId) === true;
export const isRead = (save: SaveV3, letterId: string): boolean => save.mail?.read.includes(letterId) === true;

export function markRead(save: SaveV3, letterId: string): boolean {
  if (!letterId) return false;
  remember(mailOf(save).read, letterId);
  return true;
}

// 저장 정규화 — 문자열 id 만 남기고 최근 keep 개로 자른다
export function normalizeMail(raw: unknown): { applied: string[]; read: string[] } {
  const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(-MAIL_RULES.keep) : []);
  return isObj(raw) ? { applied: ids(raw.applied), read: ids(raw.read) } : { applied: [], read: [] };
}
