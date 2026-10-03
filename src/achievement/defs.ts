// 업적 정의 — 표 읽기와 보상 종류. 업적 달성 판정과 보상 수령 — 규칙은 docs/specs/game.md "파티 칸과 업적", 이름·분류·조건·보상은 data/achievements.json
//
// 조건은 데이터의 cond 로 적는다. 판정과 진행도는 여기서 한다 (2026-10-03 업적 개선, worklog/records/achievements/record.md)
//   dex       얻은 종 수 dex.obtained ≥ count. 도감 탭 머리의 `획득` 수와 같다(리전폼·특수 폼 포함)
//   region    도감 번호 from~to 를 모두 얻었다. 번호마다 기본형 하나를 얻으면 된다. 리전폼·특수 폼은 세지 않는다
//   species   적은 종을 모두 얻었다(dex.obtained). 종마다 그 슬러그 그대로 본다 — 다른 모습(오리진폼)은 세지 않는다
//   shiny     이로치로 얻은 종 수 dex.shinyObtained ≥ count
//   level     개체 하나를 기준 레벨 이상으로 레벨업했다. 거래 전후 저장을 비교한다 —
//             교환으로 받은 개체는 거래 전에 없으므로 받는 순간은 세지 않는다 (2026-09-27)
//   affinity  친밀도가 value 이상인 개체가 있다
//   evolve    진화 횟수 counts.evolved ≥ count
//   mega      메가스톤이 생긴 종 수 dex.megaOpened ≥ count
//   hatch     알에서 포켓몬이 나온 횟수 counts.hatched ≥ count
//   single    얻은 단일 포켓몬 종 수 ≥ count (src/dex/obtain.ts singleSpecies)
//   find      줍기 횟수 find.seq ≥ count
//   work      에이전트와 함께 일한 누적 시간 totals.workMs ≥ hours
//   streak    이어서 앱이 돈 날 수 counts.streak ≥ days. 하루를 거르면 1 로 돌아간다
//   trade     끝난 교환 횟수 counts.traded ≥ count
//   shown     파티의 개체를 count 마리 이상 동시에 꺼냈다. 숨긴 채 배치만 한 것은 아니다
//   party     파티 칸에 든 포켓몬 수 ≥ count. 숨긴 개체도 센다
// 옛 업적 네 개(show-two · starter-final · work-100h · party-three)는 키와 뜻을 그대로 둔다. 이미 달성·수령한 저장을 그대로 인정한다.
//   starter-final 의 키는 옛 조건(첫 포켓몬 최종 진화)의 이름이다 (2026-09-27)
// 보상은 다섯 종류다
//   party-slot        업적으로 여는 파티 칸 하나를 연다
//   { pokemon }       그 종의 새 개체 하나 — 상점 구매와 같은 경로(성격 무작위, 이로치 아님, 빈 파티 칸 없으면 박스).
//                     업적 보상 종은 모두 단일 포켓몬이다 (2026-10-03 사용자 결정 "업적에서 구하는 포켓몬들도 단일종으로", src/shop/catalog.ts singleSpecies).
//                     이미 얻은 종이면 개체를 주지 않고 수령만 기록한다 (docs/specs/game.md "단일 포켓몬")
//   { points }        포인트
//   { egg }           그 종류의 알 하나를 돌보미집에 넣는다. 빈 칸이 없거나 남은 종이 없으면 받지 못한다
//   { item, count? }  도구. 가방 상한으로 막지 않는다(우편 선물과 같다)
// 달성은 한 번 기록하면 되돌리지 않는다. 두 마리를 다시 숨겨도, 이어진 날이 끊겨도 달성은 남는다.
// 보상은 업적창에서 사용자가 직접 받는다. 업적당 한 번만 받는다.
import { isMetaKey, type DexOptions } from "../dex/data.js";
import { rewardSpecies } from "../dex/obtain.js";
import { achievementTable, type AchievementCond, type AchievementDef, type AchievementGroup } from "../dex/tables.js";

// 업적 표의 타입은 src/dex/tables.ts 에 있다 — 도감(src/dex/obtain.ts)도 같은 표를 읽는다
// 업적창의 분류 칩 — 순서는 GROUPS
export const GROUPS: readonly AchievementGroup[] = ["dex", "grow", "egg", "find", "together"];

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

// 보상을 종류별로 읽는다 — 그 종류가 아니면 null. 손으로 쓰는 데이터라 값의 모양도 본다
const rewardOf = (def: AchievementDef): Record<string, unknown> => (isObj(def.reward) ? def.reward : {});
// 보상으로 주는 종
export const rewardPokemon = (def: AchievementDef): string | null => {
  const v = rewardOf(def).pokemon;
  return typeof v === "string" ? v : null;
};
export const rewardPoints = (def: AchievementDef): number | null => {
  const v = rewardOf(def).points;
  return typeof v === "number" ? v : null;
};
export const rewardEgg = (def: AchievementDef): string | null => {
  const v = rewardOf(def).egg;
  return typeof v === "string" ? v : null;
};
export const rewardItem = (def: AchievementDef): { id: string; count: number } | null => {
  const r = rewardOf(def);
  if (typeof r.item !== "string") return null;
  return { id: r.item, count: typeof r.count === "number" && r.count > 0 ? r.count : 1 };
};


export const defs = (opts?: DexOptions): [string, AchievementDef][] =>
  Object.entries(achievementTable(opts)).filter(([id]) => !isMetaKey(id));

export const defOf = (id: string, opts?: DexOptions): AchievementDef | null => (isMetaKey(id) ? null : achievementTable(opts)[id] ?? null);

