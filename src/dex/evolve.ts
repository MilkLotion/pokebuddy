// 진화 판정과 실행 — 규칙은 docs/specs/game.md "진화 계약", 조건은 data/evo.json 의 `need`
//
// 조건을 채워도 저절로 진화하지 않는다. 사용자가 직접 진화시킨다.
// 조건을 둘 이상 채우면 후보를 보여 주고 사용자가 고른다. 하나면 그것으로 간다.
// 진화해도 같은 개체다. 식별자·친밀도·성격·레벨·경험치·만복도·버프를 그대로 둔다. 종만 바뀐다.
// 도구 진화는 도구 하나를 쓴다. 진화와 소비는 한 거래로 묶인다.
// 공유 sid 계열(src/dex/forms.ts)은 이미 가진 종으로 가는 진화를 후보에서 뺀다 — 그 종은 모습 바꾸기로 고른다.
import type { DayPart, EvoNeed } from "../shared/types";
import type { SaveV3 } from "../shared/save-v3";
import { nextOf, type EvoStep } from "./evo.js";
import type { DexOptions } from "./data";
import { afterEvolve, formsOf } from "./forms.js";

export type EvolveFailure =
  | "no-pet" // 그런 개체가 없다
  | "no-step" // 진화할 곳이 없다
  | "not-ready" // 조건을 채우지 못했다
  | "need-choice" // 후보가 여럿이라 골라야 한다
  | "bad-choice" // 고른 종이 후보가 아니다
  | "no-item"; // 진화용 도구가 가방에 없다

export interface Candidate {
  to: string;
  need: EvoNeed;
  when?: DayPart;
  ready: boolean; // 지금 조건을 채웠다
  missing?: string; // 못 채운 이유 — 화면이 조건을 보여 준다
}

export interface EvolveResult {
  ok: boolean;
  reason?: EvolveFailure;
  petId?: string;
  from?: string;
  to?: string;
  usedItem?: string;
  choices?: string[]; // need-choice 일 때 고를 수 있는 종
}

// 게임 시간 — 30분마다 낮과 밤이 바뀐다. 매시 0~29분이 낮이고 30~59분이 밤이다.
// 하루를 기다리지 않아도 시간대 진화를 볼 수 있게 한 사용자 결정이다 (docs/specs/game.md "진화 계약").
export const GAME_DAY = { halfMin: 30 };
export const dayPartOf = (now: number): DayPart => (new Date(now).getMinutes() < GAME_DAY.halfMin ? "day" : "night");

// 조건 하나를 지금 채웠는가. 못 채웠으면 이유를 돌려준다
export function checkNeed(save: SaveV3, petId: string, step: EvoStep, dayPart: DayPart): { ready: boolean; missing?: string } {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return { ready: false, missing: "no-pet" };
  if (step.when && step.when !== dayPart) return { ready: false, missing: `time:${step.when}` };

  const need = step.need;
  if (!need) return { ready: true }; // 조건이 없는 옛 데이터 — 막지 않는다
  if (need.kind === "level") return pet.level >= need.level ? { ready: true } : { ready: false, missing: `level:${need.level}` };
  if (need.kind === "affinity") return pet.affinity >= need.value ? { ready: true } : { ready: false, missing: `affinity:${need.value}` };
  return (save.bag[need.item] ?? 0) > 0 ? { ready: true } : { ready: false, missing: `item:${need.item}` };
}

// 개체가 갈 수 있는 곳 전부. 화면이 조건을 보여 주는 데 쓴다
export function candidates(save: SaveV3, petId: string, dayPart: DayPart, opts?: DexOptions): Candidate[] {
  const pet = save.pets.find((p) => p.id === petId);
  if (!pet) return [];
  const have = formsOf(pet, opts);
  return nextOf(pet.species, opts).filter((step) => !have.includes(step.to)).map((step) => {
    const { ready, missing } = checkNeed(save, petId, step, dayPart);
    return { to: step.to, need: step.need ?? { kind: "affinity", value: 100 }, when: step.when, ready, missing };
  });
}

// 지금 진화할 수 있는가 — 배너와 상세의 진화 버튼이 쓴다
export const canEvolve = (save: SaveV3, petId: string, dayPart: DayPart, opts?: DexOptions): boolean =>
  candidates(save, petId, dayPart, opts).some((c) => c.ready);

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
    if (!picked) return { ok: false, reason: "bad-choice", choices: ready.map((c) => c.to) };
  } else if (ready.length > 1) {
    return { ok: false, reason: "need-choice", choices: ready.map((c) => c.to) };
  }
  if (!picked) return { ok: false, reason: "not-ready" };

  // 도구 진화는 여기서 하나를 쓴다
  let usedItem: string | undefined;
  if (picked.need.kind === "item") {
    const id = picked.need.item;
    const left = (save.bag[id] ?? 0) - 1;
    if (left < 0) return { ok: false, reason: "no-item" };
    if (left > 0) save.bag[id] = left;
    else delete save.bag[id];
    usedItem = id;
  }

  const from = pet.species;
  pet.evolved.push(from);
  pet.species = picked.to;
  pet.stage += 1;

  if (!save.dex.unlocked.includes(picked.to)) save.dex.unlocked.push(picked.to);
  if (!save.dex.obtained.includes(picked.to)) save.dex.obtained.push(picked.to);
  if (pet.shiny && !save.dex.shinyObtained.includes(picked.to)) save.dex.shinyObtained.push(picked.to);
  afterEvolve(save, pet, from, opts); // 공유 sid 계열이면 이전 종과 갈래의 다른 결과를 고를 종으로 남긴다

  return { ok: true, petId, from, to: picked.to, usedItem };
}
