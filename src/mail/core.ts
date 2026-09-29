// 우편함 — 서버에서 받은 편지의 선물을 로컬 저장에 넣는다. 설계는 worklog/records/post-box/record.md "구현 설계"
//
// 서버 호출은 메인(src/main/mail.ts)이 한다. 여기서는 선물 검사와 저장만 다룬다.
//   선물은 가방 도구(기본먹이 제외)·진화용 도구·포인트·포켓몬. 모르는 선물이 하나라도 있으면 그 편지는 넣지 않는다 — 앱이 옛 버전이다
//   포켓몬 선물은 레벨 1 새 개체로 박스에 넣는다. 성격·성별은 상점 종 구매와 같은 규칙, 이로치 아님. 도감에 입수로 남긴다
//   넣은 편지 id 는 save.mail.applied 에 남긴다. 같은 편지는 두 번 넣지 않는다(서버가 끊김 복구로 같은 선물을 다시 돌려줘도)
//   읽은 편지 id 는 save.mail.read — 목록의 안 읽음 점과 헤더 점
import { isMetaKey, loadJson, type DexOptions } from "../dex/data.js";
import { putPet } from "../box/slots.js";
import { rollGender } from "../dex/gender.js";
import { randomNature } from "../dex/natures.js";
import { hasProfile } from "../dex/species.js";
import { newPet, nextPetId, recordDex } from "../party/create.js";
import type { SaveV3 } from "../shared/save-v3";
import { currentItemId } from "../bag/mint.js";

export type Gift = { kind: "item"; id: string; count: number } | { kind: "points"; count: number } | { kind: "pokemon"; species: string; count: number };

export const MAIL_RULES = {
  itemMax: 999, // 한 편지의 도구 한 종류 개수 상한
  pointsMax: 100_000,
  pokemonMax: 6, // 한 편지의 같은 종 마리 수 상한
  keep: 200, // applied · read 에 남기는 최근 id 수 — 서버 목록은 50개라 넉넉하다
} as const;

interface NamedEntry {
  ko: string;
}
const items = (opts?: DexOptions): Record<string, NamedEntry> => loadJson<Record<string, NamedEntry>>("items.json", opts);
const evoItems = (opts?: DexOptions): Record<string, NamedEntry> => loadJson<Record<string, NamedEntry>>("evo-items.json", opts);

// 선물로 줄 수 있는 도구의 이름 — 줄 수 없으면 null. 기본먹이는 무료·무제한이라 가방에 두지 않는다
export function giftItemName(id: string, opts?: DexOptions): string | null {
  if (!id || isMetaKey(id) || id === "basic-food") return null;
  return items(opts)[id]?.ko ?? evoItems(opts)[id]?.ko ?? null;
}

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
const intIn = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;

// 서버의 선물 배열 → 검사한 선물. 하나라도 모르면 null
export function parseGifts(raw: unknown, opts?: DexOptions): Gift[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Gift[] = [];
  for (const g of raw) {
    if (!isObj(g)) return null;
    // 옛 민트 식별자(<성격>-mint)는 민트 한 종류로 바꿔 받는다 — 편지를 버리지 않는다 (2026-09-29 민트 통일)
    const id = typeof g.id === "string" ? currentItemId(g.id) : null;
    if (g.kind === "item" && id && giftItemName(id, opts) && intIn(g.count, MAIL_RULES.itemMax)) out.push({ kind: "item", id, count: g.count });
    else if (g.kind === "points" && intIn(g.count, MAIL_RULES.pointsMax)) out.push({ kind: "points", count: g.count });
    else if (g.kind === "pokemon" && typeof g.species === "string" && hasProfile(g.species, opts) && intIn(g.count, MAIL_RULES.pokemonMax)) out.push({ kind: "pokemon", species: g.species, count: g.count });
    else return null;
  }
  return out;
}

const mailOf = (save: SaveV3): { applied: string[]; read: string[] } => (save.mail ??= { applied: [], read: [] });
const remember = (list: string[], id: string): void => {
  if (list.includes(id)) return;
  list.push(id);
  if (list.length > MAIL_RULES.keep) list.splice(0, list.length - MAIL_RULES.keep);
};

export const isApplied = (save: SaveV3, letterId: string): boolean => save.mail?.applied.includes(letterId) === true;
export const isRead = (save: SaveV3, letterId: string): boolean => save.mail?.read.includes(letterId) === true;

export type ApplyResult = { ok: true; applied: boolean } | { ok: false; reason: "bad-args" | "bad-gift" };

export interface ApplyEnv {
  now?: number; // 포켓몬 선물의 얻은 시각
  rand?: () => number; // 포켓몬 선물의 성격·성별
}

// 선물을 저장에 넣는다. 이미 넣은 편지면 아무것도 하지 않는다(applied: false)
export function applyGifts(save: SaveV3, letterId: string, raw: unknown, opts?: DexOptions, env: ApplyEnv = {}): ApplyResult {
  if (!letterId) return { ok: false, reason: "bad-args" };
  const gifts = parseGifts(raw, opts);
  if (!gifts || !gifts.length) return { ok: false, reason: "bad-gift" };
  if (isApplied(save, letterId)) return { ok: true, applied: false };
  for (const g of gifts) {
    // 업적 보상처럼 사지 않고 받는 것은 가방 상한(999)으로 막지 않는다 (src/save/rules.ts bagMax)
    if (g.kind === "item") save.bag[g.id] = (save.bag[g.id] ?? 0) + g.count;
    else if (g.kind === "points") save.points.balance += g.count;
    else for (let i = 0; i < g.count; i++) givePokemon(save, g.species, env, opts);
  }
  const mail = mailOf(save);
  remember(mail.applied, letterId);
  remember(mail.read, letterId); // 받았으면 읽은 것이다
  return { ok: true, applied: true };
}

// 포켓몬 선물 한 마리 — 파티가 비어 있어도 박스로 넣는다
function givePokemon(save: SaveV3, species: string, env: ApplyEnv, opts?: DexOptions): void {
  const rand = env.rand ?? Math.random;
  const id = nextPetId(save);
  save.pets.push(newPet({ id, species, shiny: false, nature: randomNature(rand, opts).id, gender: rollGender(species, rand, opts), now: env.now ?? Date.now() }));
  recordDex(save, species, false);
  putPet(save.boxes, id);
}

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
