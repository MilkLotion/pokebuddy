// 우편함 — 서버에서 받은 편지의 선물을 로컬 저장에 넣는다. 설계는 worklog/records/post-box/record.md "구현 설계"
//
// 서버 호출은 메인(src/main/mail.ts)이 한다. 여기서는 선물 검사와 저장만 다룬다.
//   선물은 가방 도구(기본먹이 제외)·진화용 도구·포인트·포켓몬. 모르는 선물이 하나라도 있으면 그 편지는 넣지 않는다 — 앱이 옛 버전이다
//   단일 포켓몬 선물은 한 마리만 넣는다. 이미 얻은 종이면 넣지 않는다 — 편지의 다른 선물은 그대로 받는다 (docs/specs/game.md "단일 포켓몬")
//   포켓몬 선물은 레벨 1 새 개체로 박스에 넣는다. 박스 빈 칸이 모자라면 그 편지는 넣지 않는다(box-full) — 자리를 만든 뒤 다시 받는다. 성격·성별은 상점 종 구매와 같은 규칙, 이로치 아님. 도감에 입수로 남긴다
//   넣은 편지 id 는 save.mail.applied 에 남긴다. 같은 편지는 두 번 넣지 않는다(서버가 끊김 복구로 같은 선물을 다시 돌려줘도)
//   읽은 편지 id 는 save.mail.read — 목록의 안 읽음 점과 헤더 점
import { isMetaKey, loadJson, type DexOptions } from "../dex/data.js";
import { boxRoom } from "../box/slots.js";
import { hasProfile } from "../dex/species.js";
import { addNewPet } from "../party/create.js";
import { addItem } from "../bag/items.js";
import { singleSpecies } from "../dex/obtain.js";
import type { SaveV3 } from "../shared/save-v3";
import { MAIL_RULES } from "./rules.js";
import { MINT_ID, MINT_REFUND_EACH, MINT_RETIRED, currentItemId } from "../bag/mint.js";
import { isApplied, mailOf, remember } from "./letters.js";

export type Gift = { kind: "item"; id: string; count: number } | { kind: "points"; count: number } | { kind: "pokemon"; species: string; count: number };

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
    // 성격민트 은퇴 — 민트 선물은 개당 구매가만큼 포인트로 받는다. 편지는 버리지 않는다 (src/bag/mint.ts)
    if (MINT_RETIRED && g.kind === "item" && id === MINT_ID && intIn(g.count, MAIL_RULES.itemMax)) out.push({ kind: "points", count: g.count * MINT_REFUND_EACH });
    else if (g.kind === "item" && id && giftItemName(id, opts) && intIn(g.count, MAIL_RULES.itemMax)) out.push({ kind: "item", id, count: g.count });
    else if (g.kind === "points" && intIn(g.count, MAIL_RULES.pointsMax)) out.push({ kind: "points", count: g.count });
    else if (g.kind === "pokemon" && typeof g.species === "string" && hasProfile(g.species, opts) && intIn(g.count, MAIL_RULES.pokemonMax)) out.push({ kind: "pokemon", species: g.species, count: g.count });
    else return null;
  }
  return out;
}

export type ApplyResult = { ok: true; applied: boolean } | { ok: false; reason: "bad-args" | "bad-gift" | "box-full" };

export interface ApplyEnv {
  now?: number; // 포켓몬 선물의 얻은 시각
  rand?: () => number; // 포켓몬 선물의 성격·성별
}

// 포켓몬 선물마다 실제로 넣을 마리 수 — 단일 포켓몬은 저장마다 한 번만 얻는다. 이미 얻었으면 0마리, 아니면 한 편지에서 한 마리다
function pokemonCounts(save: SaveV3, gifts: readonly Gift[], opts?: DexOptions): Map<Gift, number> {
  const singles = singleSpecies(opts);
  const taken = new Set<string>();
  const give = new Map<Gift, number>();
  for (const g of gifts) {
    if (g.kind !== "pokemon") continue;
    if (!singles.has(g.species)) give.set(g, g.count);
    else {
      give.set(g, save.dex.obtained.includes(g.species) || taken.has(g.species) ? 0 : 1);
      taken.add(g.species);
    }
  }
  return give;
}

// 이 선물을 받는 데 드는 박스 빈 칸 수 — 받기 전 검사(src/main/mail.ts)와 applyGifts 가 같은 셈을 쓴다
export function neededBoxRoom(save: SaveV3, gifts: readonly Gift[], opts?: DexOptions): number {
  return [...pokemonCounts(save, gifts, opts).values()].reduce((n, c) => n + c, 0);
}

// 선물을 저장에 넣는다. 이미 넣은 편지면 아무것도 하지 않는다(applied: false)
export function applyGifts(save: SaveV3, letterId: string, raw: unknown, opts?: DexOptions, env: ApplyEnv = {}): ApplyResult {
  if (!letterId) return { ok: false, reason: "bad-args" };
  const gifts = parseGifts(raw, opts);
  if (!gifts || !gifts.length) return { ok: false, reason: "bad-gift" };
  if (isApplied(save, letterId)) return { ok: true, applied: false };
  const give = pokemonCounts(save, gifts, opts);
  // 포켓몬 선물이 모두 들어갈 박스 빈 칸 — 값을 바꾸기 전에 본다
  const pokemon = [...give.values()].reduce((n, c) => n + c, 0);
  if (pokemon > boxRoom(save.boxes)) return { ok: false, reason: "box-full" };
  for (const g of gifts) {
    // 업적 보상처럼 사지 않고 받는 것은 가방 상한(999)으로 막지 않는다 (src/bag/rules.ts BAG_RULES.max)
    if (g.kind === "item") addItem(save, g.id, g.count);
    else if (g.kind === "points") save.points.balance += g.count;
    else for (let i = 0; i < (give.get(g) ?? 0); i++) givePokemon(save, g.species, env, opts);
  }
  const mail = mailOf(save);
  remember(mail.applied, letterId);
  remember(mail.read, letterId); // 받았으면 읽은 것이다
  return { ok: true, applied: true };
}

// 포켓몬 선물 한 마리 — 파티가 비어 있어도 박스로 넣는다
function givePokemon(save: SaveV3, species: string, env: ApplyEnv, opts?: DexOptions): void {
  addNewPet(save, { species, shiny: false, now: env.now ?? Date.now(), rand: env.rand ?? Math.random, place: "box-only", opts }); // 둘 곳은 applyGifts 가 먼저 봤다
}
