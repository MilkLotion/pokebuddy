// 랜덤 배틀 샘플 파티 — data/battle-samples.json 읽기와 검사 (docs/specs/adventure.md "샘플 파티")
//   서버 복사본은 build-battle 이 battle-data.json 의 samples 로 싣는다. 서버는 이 파일을 import 하지 않는다
//   칸에 기술을 두지 않는다 — fighterFrom 이 종의 기본 2개를 쓴다(sub1 의 기술 데이터를 그대로 따른다)
import type { DexOptions } from "../dex/data.js";
import { loadJson } from "../dex/data.js";
import { partyOf, type BattleData, type FighterSource } from "./fighter-core.js";

export const SAMPLE_LEVELS = ["hard", "normal", "easy"] as const;
export type SampleLevel = (typeof SAMPLE_LEVELS)[number];
const SAMPLE_KINDS = ["type-concept", "type-cover", "offense", "bulk", "weather", "legend"] as const;
export const SAMPLES_PER_LEVEL = 10;

export interface BattleSample {
  id: string; // `<level>-NN` — 판 기록(battles.opponent_sample)에 남는 값
  level: SampleLevel;
  name: string; // 화면 이름
  kind: (typeof SAMPLE_KINDS)[number];
  note: string;
  slots: FighterSource[]; // 칸 6개, 칸 순서가 배치
}

export const battleSamples = (opts?: DexOptions): BattleSample[] => loadJson<{ samples: BattleSample[] }>("battle-samples.json", opts).samples;

// 서버에 실을 모양 — 화면 이름과 칸만. 유형·설명은 싣지 않는다
export const samplesForServer = (list: readonly BattleSample[]): { id: string; level: SampleLevel; name: string; slots: FighterSource[] }[] =>
  list.map((s) => ({ id: s.id, level: s.level, name: s.name, slots: s.slots.map((c) => ({ species: c.species, ...(c.form ? { form: c.form } : {}) })) }));

// 샘플 하나의 잘못 — 빈 목록이면 통과
export function sampleProblems(s: BattleSample, data: BattleData): string[] {
  const out: string[] = [];
  if (!new RegExp(`^${s.level}-\\d{2}$`).test(s.id)) out.push(`id 모양: ${s.id}`);
  if (!SAMPLE_LEVELS.includes(s.level)) out.push(`level: ${s.level}`);
  if (!SAMPLE_KINDS.includes(s.kind)) out.push(`kind: ${s.kind}`);
  if (!s.name) out.push("name 없음");
  if (s.slots.length !== 6) out.push(`칸 ${s.slots.length}개`);
  const seen = new Set<string>();
  for (const c of s.slots) {
    if (!data.species[c.species]) out.push(`없는 종: ${c.species}`);
    if (seen.has(c.species)) out.push(`같은 종 두 번: ${c.species}`);
    seen.add(c.species);
    if (c.form && data.mega[c.form]?.base !== c.species) out.push(`메가 모습이 종과 다름: ${c.form}`);
    if ("moves" in c || "moveSwap" in c) out.push(`기술을 적었다: ${c.species}`);
  }
  // 출전 제한 — 서버가 배틀 파티를 읽는 partyOf 에 샘플을 저장 모양으로 넣어 같은 판정을 받는다(세는 함수를 따로 두지 않는다)
  const ids = s.slots.map((_, i) => `sample-${i}`);
  const save = {
    pets: s.slots.map((c, i) => ({ id: ids[i], species: c.species })),
    battle: { slots: ids, mega: Object.fromEntries(s.slots.flatMap((c, i) => (c.form ? [[ids[i], c.form]] : []))) },
  };
  if (partyOf(save, data).blocked) out.push("출전 불가 개체가 있다");
  return out;
}
