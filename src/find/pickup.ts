// 줍기 — 무대에서 돌아다니는 포켓몬이 가끔 무언가를 주워 온다. 계약은 docs/specs/game.md "줍기", 수치는 docs/specs/balance.md "줍기"
//
// 주울 수 있는 것은 포인트·도구·진화용 도구·포켓몬 넷이다 (2026-09-29 사용자 결정).
// 판정은 마리마다 따로 한다. 그 마리가 조건을 채운 1초마다 1/3000, 잘 돌본 마리는 1/2000 확률이다 (2026-10-05 사용자 결정, src/find/roll.ts isCaredFor). 마리끼리 독립이다.
// 조건 — 앱이 켜져 있고, 그 마리가 무대에 나와 있는 꺼낸 파티 개체이며, 깨어 있다.
// 메인은 전역 1초 시계의 틱마다 깨어 있는 마리 각각을 그 틱 간격으로 굴린다(rollHits — src/main/app.ts clockTick). P = 1 − (1 − 1/2000)^(초).
// 주운 마리는 그 자리에서 저장에 반영한다(applyHits — src/tx/game.ts find). 한 번 굴림에 마리마다 최대 1건이다.
// 그래서 마리마다 따로, 주운 순간에 말풍선과 배너가 뜬다. 무기억 과정이라 쌓인 시간을 저장에 남기지 않는다.
// 순수 함수다. 파일을 읽지 않고(데이터 표 제외) 시각과 무작위를 받는다. 저장은 부르는 쪽(src/tx/game.ts find)이 한 번에 쓴다
import { loadJson, type DexOptions } from "../dex/data.js";
import { pickHatch } from "../egg/hatch.js";
import { pickByWeight, type Rand } from "../shared/rand.js";
import { addItem, isFormTool } from "../bag/items.js";
import { addNewPet } from "../party/create.js"; // 새 개체 배치 — 빈 파티 칸에 꺼낸 상태로, 없으면 박스로. 상점 구매·업적 보상과 같다
import { FIND_RULES } from "./rules.js";
import { MINT_ID, MINT_RETIRED } from "../bag/mint.js";
import { inRandomEgg } from "../dex/obtain.js";
import type { FindRecordV3, FindV3, SaveV3 } from "../shared/save-v3";
import { isCaredFor, KINDS, rollHits } from "./roll.js";

export interface FindInput {
  activeMs: Readonly<Record<string, number>>; // 마리별로 조건을 채운 시간 — 부르는 쪽이 무대에서 센다
  rate?: number; // 확률 배율 — 개발용(POKEBUDDY_FIND_RATE). 없으면 1
}

interface ItemEntry {
  price?: number | null;
  effect?: string;
}

export interface ItemCandidate {
  id: string; // 도구 식별자
  weight: number;
}

// 도구 후보 — data/items.json 에서 상점가가 0 초과 FIND_RULES.itemMaxPrice 이하. 가중치는 1/가격. 성격민트는 은퇴해 빠진다 (src/bag/mint.ts).
// 모습 도구(로토무카탈로그 effect form, 유대의고삐 effect call-rider)도 빠진다 — 줍기로 얻지 않는다
// (2026-10-05 설계 worklog/records/rotom-forms, 2026-10-07 사용자 "유대의고삐는 줍기에서 안 뜨게")
export function itemCandidates(opts?: DexOptions): ItemCandidate[] {
  const table = loadJson<Record<string, ItemEntry>>("items.json", opts);
  const out: ItemCandidate[] = [];
  for (const [id, e] of Object.entries(table)) {
    if (id.startsWith("_") || e == null || typeof e !== "object") continue;
    if (MINT_RETIRED && id === MINT_ID) continue;
    if (isFormTool(e.effect)) continue;
    const price = e.price;
    if (typeof price !== "number" || price <= 0 || price > FIND_RULES.itemMaxPrice) continue;
    out.push({ id, weight: 1 / price });
  }
  return out;
}

// 진화용 도구 후보 — data/evo-items.json 에서 FIND_RULES.evoExcluded(족자)를 뺀 것
export const evoCandidates = (opts?: DexOptions): string[] =>
  Object.keys(loadJson<Record<string, unknown>>("evo-items.json", opts)).filter((id) => !id.startsWith("_") && !FIND_RULES.evoExcluded.includes(id));

// 포켓몬 후보 — 랜덤알과 같다. 해금한 종 가운데 랜덤알에서 나올 수 있는 종 (src/dex/obtain.ts inRandomEgg)
export const pokemonCandidates = (save: SaveV3, opts?: DexOptions): string[] => save.dex.unlocked.filter((slug) => inRandomEgg(slug, opts));

const pickIndex = (n: number, rand: Rand): number => Math.min(n - 1, Math.max(0, Math.floor(rand() * n)));

const pickItem = (rand: Rand, opts?: DexOptions): string | null => pickByWeight(itemCandidates(opts), (c) => c.weight, rand)?.id ?? null;

// 무대에 꺼내 둔 파티 개체만 줍는다 — 숨긴 개체·박스 개체·없는 개체는 뺀다
export function eligiblePetIds(save: SaveV3, awake: Iterable<string>): string[] {
  const shown = new Set(save.party.slots.filter((s) => s.state === "pokemon" && s.petId && !s.hidden).map((s) => s.petId as string));
  return [...new Set(awake)].filter((id) => shown.has(id) && save.pets.some((p) => p.id === id));
}

// 잘 돌본 마리 — 줍기 확률이 1/2000 인 마리 (src/find/roll.ts isCaredFor). 메인 시계가 굴릴 때도 쓴다
export const caredIds = (save: SaveV3): Set<string> => new Set(save.pets.filter(isCaredFor).map((p) => p.id));

export const emptyFind = (): FindV3 => ({ seq: 0, log: [] });

// 마리 하나가 무언가를 주웠다 — 항목과 내용을 고르고 저장에 반영한다. 반영할 수 없으면(후보 없음·둘 곳 없음) null
export function findOne(save: SaveV3, petId: string, now: number, rand: Rand, opts?: DexOptions): FindRecordV3 | null {
  const finder = save.pets.find((p) => p.id === petId);
  if (!finder) return null;
  const kind = pickByWeight(KINDS, (k) => FIND_RULES.weights[k], rand);
  if (!kind) return null;

  let ref = "";
  let amount = 1;
  let newPetId: string | undefined;
  if (kind === "points") {
    const { min, max } = FIND_RULES.points;
    amount = min + pickIndex(max - min + 1, rand);
    save.points.balance += amount;
  } else if (kind === "item" || kind === "evo") {
    const evo = kind === "evo" ? evoCandidates(opts) : [];
    const id = kind === "item" ? pickItem(rand, opts) : evo.length ? evo[pickIndex(evo.length, rand)] : null;
    if (!id) return null;
    addItem(save, id, 1); // 사지 않고 받는 것이라 가방 상한으로 막지 않는다 (src/bag/items.ts)
    ref = id;
  } else {
    const result = pickHatch(pokemonCandidates(save, opts), rand, opts);
    if (!result) return null; // 후보 없음 — 이번 판정은 없음
    const added = addNewPet(save, { species: result.species, shiny: result.shiny, now, rand, place: "party-first", opts });
    if (!added) return null; // 둘 곳 없음 — 이번 판정은 없음
    newPetId = added.pet.id;
    ref = result.species;
  }

  const find = save.find ?? emptyFind();
  find.seq += 1;
  const rec: FindRecordV3 = { id: `f${find.seq}`, at: now, petId, species: finder.species, kind, ref, amount, ...(newPetId ? { newPetId } : {}) };
  find.log = [...find.log, rec].slice(-FIND_RULES.keep);
  save.find = find;
  return rec;
}

// 반영 — 주운 마리마다 한 건씩 저장에 넣는다. 꺼낸 파티 개체가 아니면 건너뛴다. 이번에 주운 기록을 돌려준다
export function applyHits(save: SaveV3, petIds: readonly string[], now: number, rand: Rand, opts?: DexOptions): FindRecordV3[] {
  const found: FindRecordV3[] = [];
  for (const petId of eligiblePetIds(save, petIds)) {
    const rec = findOne(save, petId, now, rand, opts);
    if (rec) found.push(rec);
  }
  return found;
}

// 굴림과 반영을 한 번에 — 꺼낸 파티 개체만 굴린다. 자체 확인과 한 번에 넘기는 호출이 쓴다
export function applyFind(save: SaveV3, input: FindInput, now: number, rand: Rand, opts?: DexOptions): FindRecordV3[] {
  const shown = new Set(eligiblePetIds(save, Object.keys(input.activeMs)));
  const activeMs = Object.fromEntries(Object.entries(input.activeMs).filter(([id]) => shown.has(id)));
  return applyHits(save, rollHits(activeMs, rand, input.rate, caredIds(save)), now, rand, opts);
}
