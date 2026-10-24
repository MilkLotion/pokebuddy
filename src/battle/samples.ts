// 랜덤 배틀 샘플 파티 — data/battle-samples.json 읽기와 검사 (docs/specs/adventure.md "샘플 파티")
//   서버 복사본은 build-battle 이 battle-data.json 의 samples 로 싣는다. 서버는 이 파일을 import 하지 않는다
//   칸에 기술을 두지 않는다 — fighterFrom 이 종의 기본 2개를 쓴다(sub1 의 기술 데이터를 그대로 따른다)
import type { DexOptions } from "../dex/data.js";
import { loadJson } from "../dex/data.js";
import { profileOf } from "../dex/species.js";
import { BATTLE_BASIS, partyOf, type BattleData, type FighterSource, type StatBasis } from "./fighter-core.js";

// champion — 원작 챔피언전 파티. 난이도를 맞추지 않는 따로 등급(2026-10-24 사용자 "따로 등급")
export const SAMPLE_LEVELS = ["hard", "normal", "easy", "champion"] as const;
export type SampleLevel = (typeof SAMPLE_LEVELS)[number];
const SAMPLE_KINDS = ["type-concept", "type-cover", "offense", "bulk", "weather", "legend", "champion"] as const;
// 등급마다 샘플 수 — 챔피언은 1세대부터 지방 챔피언 12명(2026-10-25 사용자 "어디지방 챔피언 이런거로 1세대부터 차례대로", 목록 "2번으로")
export const SAMPLES_PER_LEVEL: Readonly<Record<SampleLevel, number>> = { hard: 10, normal: 10, easy: 10, champion: 12 };
// 챔피언의 싸움 레벨 — 다른 샘플과 배틀 파티는 BATTLE_BASIS 의 50 (2026-10-25 사용자 "이 챔피언들은 체급높게하게 레벨 60으로 해버려")
export const CHAMPION_BATTLE_LEVEL = 60;

export interface BattleSample {
  id: string; // `<level>-NN` — 판 기록(battles.opponent_sample)에 남는 값. 챔피언은 세대 순
  level: SampleLevel;
  name: string; // 화면 이름
  region?: string; // 챔피언의 지방 이름(예: 관동) — 홈페이지 AI 트레이너 탭이 읽는다
  battleLevel?: number; // 싸움 레벨 — 챔피언만 둔다. 없으면 BATTLE_BASIS.level
  kind: (typeof SAMPLE_KINDS)[number];
  note: string;
  slots: FighterSource[]; // 칸 6개, 칸 순서가 처음 자리
}

export const battleSamples = (opts?: DexOptions): BattleSample[] => loadJson<{ samples: BattleSample[] }>("battle-samples.json", opts).samples;

// 샘플의 능력치 기준 — 싸움 레벨만 바꾼다(개체값·노력치는 배틀 기준 그대로)
export const sampleBasis = (s: Pick<BattleSample, "battleLevel">): StatBasis => (s.battleLevel ? { ...BATTLE_BASIS, level: s.battleLevel } : BATTLE_BASIS);

// 서버에 실을 모양 — 화면 이름·싸움 레벨과 칸만. 유형·설명·지방은 싣지 않는다
export const samplesForServer = (list: readonly BattleSample[]): { id: string; level: SampleLevel; name: string; battleLevel?: number; slots: FighterSource[] }[] =>
  list.map((s) => ({
    id: s.id,
    level: s.level,
    name: s.name,
    ...(s.battleLevel ? { battleLevel: s.battleLevel } : {}),
    slots: s.slots.map((c) => ({ species: c.species, ...(c.form ? { form: c.form } : {}) })),
  }));

// 샘플 하나의 잘못 — 빈 목록이면 통과
export function sampleProblems(s: BattleSample, data: BattleData): string[] {
  const out: string[] = [];
  if (!new RegExp(`^${s.level}-\\d{2}$`).test(s.id)) out.push(`id 모양: ${s.id}`);
  if (!SAMPLE_LEVELS.includes(s.level)) out.push(`level: ${s.level}`);
  if (!SAMPLE_KINDS.includes(s.kind)) out.push(`kind: ${s.kind}`);
  if (!s.name) out.push("name 없음");
  // 챔피언만 지방과 싸움 레벨 60 을 둔다
  const champion = s.level === "champion";
  if (champion !== !!s.region) out.push(`region: ${s.region ?? "없음"}`);
  if (champion ? s.battleLevel !== CHAMPION_BATTLE_LEVEL : s.battleLevel !== undefined) out.push(`battleLevel: ${s.battleLevel ?? "없음"}`);
  if (s.slots.length !== 6) out.push(`칸 ${s.slots.length}개`);
  const seen = new Set<number>();
  const battleOnly = new Set(Object.values(data.forms).map((f) => f.form)); // 전투 중에만 나오는 모습 — 모험에 나가지 않는다
  for (const c of s.slots) {
    if (!data.species[c.species]) out.push(`없는 종: ${c.species}`);
    const dex = profileOf(c.species).dex;
    if (seen.has(dex)) out.push(`같은 도감 번호 두 번: ${c.species}`);
    seen.add(dex);
    if (battleOnly.has(c.species)) out.push(`전투 중 모습: ${c.species}`);
    if (c.form && data.mega[c.form]?.base !== c.species) out.push(`메가 모습이 종과 다름: ${c.form}`);
    if ("moves" in c || "moveSwap" in c) out.push(`기술을 적었다: ${c.species}`);
  }
  // 출전 제한 — 모든 난이도(2026-10-24 사용자 "다 제한시켜. 모든팀이 똑같이 해야지". 그 전에는 상만 자유)
  // 서버가 배틀 파티를 읽는 partyOf 에 샘플을 저장 모양으로 넣어 같은 판정을 받는다(세는 함수를 따로 두지 않는다)
  const ids = s.slots.map((_, i) => `sample-${i}`);
  const save = {
    pets: s.slots.map((c, i) => ({ id: ids[i], species: c.species })),
    battle: { slots: ids, mega: Object.fromEntries(s.slots.flatMap((c, i) => (c.form ? [[ids[i], c.form]] : []))) },
  };
  if (partyOf(save, data).blocked) out.push("출전 불가 개체가 있다");
  return out;
}
