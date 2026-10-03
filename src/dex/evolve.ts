// 진화 판정과 실행 — 규칙은 docs/specs/game.md "진화 계약", 조건은 data/evo.json 의 `need`
//
// 조건을 채워도 저절로 진화하지 않는다. 사용자가 직접 진화시킨다.
// 조건을 둘 이상 채우면 후보를 보여 주고 사용자가 고른다. 하나면 그것으로 간다.
// 진화해도 같은 개체다. 식별자·친밀도·성격·레벨·경험치·만복도·버프를 그대로 둔다. 종만 바뀐다.
// 도구 진화는 도구 하나를 쓴다. 진화와 소비는 한 거래로 묶인다.
// 공유 sid 계열(src/dex/forms.ts)은 이미 가진 종으로 가는 진화를 후보에서 뺀다 — 그 종은 모습 바꾸기로 고른다.
// 성별 조건(data/evo.json 의 gender)이 있으면 그 성별만 진화한다. 다른 성별에게도 후보로 보여 이유를 알린다 (2026-09-30 사용자 결정)
// 지도 간선(data/evo.json 의 map, 기본형 → 리전폼)은 가방의 지도(region-map) 하나를 쓴다 (2026-09-30 사용자 결정)
//   원작 조건이 돌이면 지도가 돌을 대신한다 — need 가 지도다(src/tools/build-evo.ts). 돌은 보지도 쓰지도 않는다
//     ("천둥의돌이면 라이츄, 지도면 알로라라이츄로 진화하게 하자. 아이템1개만쓰는게 나을거같네")
//   레벨·친밀도 간선은 원래 조건을 채우고 지도도 있어야 한다. 쓰는 것은 지도 하나다
//   같은 출발의 기본형 간선은 지도가 있어도 지도를 쓰지 않는다. 둘 다 준비되면 사용자가 고른다
//   배너·튜토리얼의 "진화할 수 있다" 는 레벨·친밀도 지도 간선을 보지 않는다 — 같은 조건의 기본형 간선과 짝이라 알림이 겹친다
//   돌 대신 지도인 간선은 본다 — 지도만 있고 돌이 없으면 이 간선만 준비되기 때문이다
import { gameDayPart } from "../shared/clock";
import type { DayPart, EvoNeed } from "../shared/species";
import type { SaveV3 } from "../shared/save-v3";
import { nextOf, type EvoStep } from "./evo.js";
import type { DexOptions } from "./data";
import { afterEvolve, formsOf } from "./forms.js";
import { recordDex } from "./record.js";
import { REGION_MAP, needIsMap } from "./regional.js";
import type { ReasonOf } from "../shared/names/reasons.js";

export type EvolveFailure = ReasonOf<
  | "no-pet" // 그런 개체가 없다
  | "no-step" // 진화할 곳이 없다
  | "not-ready" // 조건을 채우지 못했다
  | "need-choice" // 후보가 여럿이라 골라야 한다
  | "bad-choice" // 고른 종이 후보가 아니다
  | "no-item" // 진화용 도구가 가방에 없다
  | "no-map" // 고른 리전폼 진화에 쓸 지도가 가방에 없다
>;

// 못 채운 조건 하나 — 화면이 조건 글자를 만든다 (src/tx/snapshot.ts)
export type EvoMissing =
  | { kind: "level"; level: number }
  | { kind: "affinity"; value: number }
  | { kind: "item"; item: string }
  | { kind: "time"; when: DayPart }
  | { kind: "gender"; gender: "male" | "female" };

export interface Candidate {
  to: string;
  need: EvoNeed;
  when?: DayPart;
  ready: boolean; // 지금 조건을 채웠다
  // 못 채운 조건 — 순서는 성별 하나 / 시간대 하나 / 주 조건 → 더하는 친밀도 → 지도. 채웠으면 빈 목록
  lacks: EvoMissing[];
  map?: true; // 지도 간선 — 지도를 쓴다
}

// 못 채운 조건 하나를 `kind:값` 으로 — `level:36`. 로그와 시험이 쓴다
export function missingKey(m: EvoMissing): string {
  if (m.kind === "level") return `level:${m.level}`;
  if (m.kind === "affinity") return `affinity:${m.value}`;
  if (m.kind === "item") return `item:${m.item}`;
  if (m.kind === "time") return `time:${m.when}`;
  return `gender:${m.gender}`;
}

// 조건 검사의 답 — 개체가 없으면 noPet
interface NeedCheck {
  ready: boolean;
  lacks: EvoMissing[];
  noPet?: true;
}
const READY: NeedCheck = { ready: true, lacks: [] };
const lacking = (...lacks: EvoMissing[]): NeedCheck => ({ ready: false, lacks });

export interface EvolveResult {
  ok: boolean;
  reason?: EvolveFailure;
  petId?: string;
  from?: string;
  to?: string;
  usedItem?: string; // 쓴 도구의 첫 번째 — 옛 호출용
  usedItems?: string[]; // 쓴 도구 전부 — 지금 규칙에서는 늘 하나다(돌 또는 지도)
  choices?: string[]; // need-choice 일 때 고를 수 있는 종
}

// 게임 시간 — 30분마다 낮과 밤이 바뀐다 (src/shared/clock.ts gameDayPart, docs/specs/game.md "진화 계약")
export { GAME_DAY } from "../shared/clock";
export const dayPartOf = (now: number): DayPart => gameDayPart(now);

// 조건 하나를 지금 채웠는가. 못 채웠으면 모자란 조건을 돌려준다. 레벨·친밀도 지도 간선이면 원래 조건 뒤에 지도를 본다
function checkNeed(save: SaveV3, petId: string, step: EvoStep, dayPart: DayPart): NeedCheck {
  const base = checkBaseNeed(save, petId, step, dayPart);
  if (!step.map || needIsMap(step.need) || base.noPet || (save.bag[REGION_MAP] ?? 0) > 0) return base;
  return lacking(...base.lacks, { kind: "item", item: REGION_MAP });
}

// 지도를 뺀 원래 조건 — 성별·시간대·레벨·친밀도·도구. 간선에 더하는 친밀도(affinity)가 있으면 그 조건 뒤에 본다
function checkBaseNeed(save: SaveV3, petId: string, step: EvoStep, dayPart: DayPart): NeedCheck {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ready: false, lacks: [], noPet: true };
  if (step.gender && pet.gender !== step.gender) return lacking({ kind: "gender", gender: step.gender }); // 바뀌지 않는 이유라 먼저 본다
  if (step.when && step.when !== dayPart) return lacking({ kind: "time", when: step.when });
  const main = checkMainNeed(save, pet, step);
  if (!step.affinity || pet.affinity >= step.affinity) return main;
  return lacking(...main.lacks, { kind: "affinity", value: step.affinity });
}

// 간선의 조건 하나 — 레벨·친밀도·도구
function checkMainNeed(save: SaveV3, pet: { level: number; affinity: number }, step: EvoStep): NeedCheck {
  const need = step.need;
  if (!need) return READY; // 조건이 없는 옛 데이터 — 막지 않는다
  if (need.kind === "level") return pet.level >= need.level ? READY : lacking({ kind: "level", level: need.level });
  if (need.kind === "affinity") return pet.affinity >= need.value ? READY : lacking({ kind: "affinity", value: need.value });
  return (save.bag[need.item] ?? 0) > 0 ? READY : lacking({ kind: "item", item: need.item });
}

// 개체가 갈 수 있는 곳 전부. 화면이 조건을 보여 주는 데 쓴다
export function candidates(save: SaveV3, petId: string, dayPart: DayPart, opts?: DexOptions): Candidate[] {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return [];
  const have = formsOf(pet, opts);
  return nextOf(pet.species, opts).filter((step) => !have.includes(step.to)).map((step) => {
    const { ready, lacks } = checkNeed(save, petId, step, dayPart);
    return { to: step.to, need: step.need ?? { kind: "affinity", value: 100 }, when: step.when, ready, lacks, ...(step.map ? { map: true as const } : {}) };
  });
}

// 지금 진화할 수 있는가 — 알림 배너와 튜토리얼이 쓴다. 레벨·친밀도 지도 간선은 보지 않는다(짝인 기본형 간선이 같은 조건이라 알림이 겹친다)
export const canEvolve = (save: SaveV3, petId: string, dayPart: DayPart, opts?: DexOptions): boolean =>
  candidates(save, petId, dayPart, opts).some((c) => c.ready && (!c.map || needIsMap(c.need)));

export function evolve(save: SaveV3, petId: string, dayPart: DayPart, choice?: string, opts?: DexOptions): EvolveResult {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ok: false, reason: "no-pet" };

  const all = candidates(save, petId, dayPart, opts);
  if (!all.length) return { ok: false, reason: "no-step" };
  const ready = all.filter((c) => c.ready);
  if (!ready.length) return { ok: false, reason: "not-ready" };

  let picked = ready[0];
  if (choice) {
    picked = ready.find((c) => c.to === choice) ?? undefined;
    // 지도만 모자란 리전폼 진화는 이유를 따로 알린다 — 화면을 거치지 않은 명령도 여기서 막힌다
    const short = all.find((c) => c.to === choice && !c.ready);
    if (!picked && short?.map && short.lacks.some((m) => m.kind === "item" && m.item === REGION_MAP)) return { ok: false, reason: "no-map", choices: ready.map((c) => c.to) };
    if (!picked) return { ok: false, reason: "bad-choice", choices: ready.map((c) => c.to) };
  } else if (ready.length > 1) {
    return { ok: false, reason: "need-choice", choices: ready.map((c) => c.to) };
  }
  if (!picked) return { ok: false, reason: "not-ready" };

  // 도구 진화는 도구 하나, 지도 간선은 지도 하나를 여기서 쓴다. 돌 대신 지도인 간선은 need 가 지도라 한 번만 센다
  //   전부 있는지 먼저 본 뒤에 뺀다 — 모자라면 가방을 건드리지 않는다
  const uses = [...new Set([...(picked.need.kind === "item" ? [picked.need.item] : []), ...(picked.map ? [REGION_MAP] : [])])];
  for (const id of uses) if ((save.bag[id] ?? 0) < 1) return { ok: false, reason: id === REGION_MAP ? "no-map" : "no-item" };
  for (const id of uses) {
    const left = (save.bag[id] ?? 0) - 1;
    if (left > 0) save.bag[id] = left;
    else delete save.bag[id];
  }

  const from = pet.species;
  pet.evolved.push(from);
  pet.species = picked.to;
  pet.stage += 1;
  save.counts.evolved += 1; // 진화 업적이 센다

  recordDex(save, picked.to, pet.shiny);
  afterEvolve(save, pet, from, opts); // 공유 sid 계열이면 이전 종과 갈래의 다른 결과를 고를 종으로 남긴다

  return { ok: true, petId, from, to: picked.to, ...(uses.length ? { usedItem: uses[0], usedItems: uses } : {}) };
}
