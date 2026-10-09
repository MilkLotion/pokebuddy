// 생성 파일 — src/battle/engine.ts 복사본. 고치지 말고 npm run battle:build 를 돌린다
// 배틀 엔진 — 두 쪽 6칸과 시드를 받아 판 결과와 이벤트 목록을 낸다. 같은 입력이면 늘 같은 결과다
// 규칙은 docs/specs/moves.md "전투 규칙", 구조는 docs/specs/adventure.md "배틀 엔진"
//
// 이 파일은 import 가 없다 — 서버 함수(Deno)에 그대로 복사하려고. src/verify/save-rules.ts 와 같은 방식이다
// 저장·데이터 파일을 읽지 않는다. 개체 → 전투 개체는 ./fighter.ts 가 만든다
// 난수는 시드 하나(mulberry32)에서만 뽑는다. Math.random·시각은 쓰지 않는다
//
// 시간은 0.1초 틱. 한 틱에 할 행동을 모아 기술 > 평타 → 선공도 → 스피드 → 난수 순서로 한다. 행동하지 않은 개체는 그 뒤에 걷는다
// 전장은 계산 칸 20×12(화면 10×6, 화면 칸 1 = 계산 칸 2×2). 개체는 2×2 를 차지하고 8방향으로 0.3초에 1칸 걷는다. 사거리 = 몸 사이 틈(물리 1, 특수 3)
// 장애물은 없다(2026-10-09). 걷기는 다른 개체만 피한다. 규칙은 docs/specs/moves.md "전장과 대상"
// 이번 판(E1)에 넣은 특성: 게으름·슬로스타트·스킬링크·모습이 바뀌는 5종. 나머지 특성은 무보정이다
// 설계와 단계는 worklog/records/battle-server/battle-server.md "엔진 설계"

export const ENGINE_RULES = {
  tickMs: 100,
  maxMs: 90_000, // 판 길이 상한 — 넘으면 남은 HP 비율 합으로 판정
  hpScale: 3, // 전투 HP = 실제 HP × 3 (2026-10-08 사용자 결정)
  basicPower: 10, // 평타 위력 — 상성·자속 없음, 반드시 맞음, 급소 없음
  basicMs: 1000, // 평타 간격 — 모두 같다. 스피드와 상관없다 (2026-10-08 사용자 "평타는 고정 간격으로 해보자. 근데 난 평타는 자주 썼으면 좋겠어")
  speedRef: 95, // 기술 쿨타임의 기준 스피드 — 일반 풀(전설급 제외, 종족값 합 400 이상) 50레벨 실제 스피드 중앙값
  speedMulMin: 0.8, // 기술 쿨타임 × 기준 ÷ 실제 스피드, 이 범위로 자른다 (2026-10-08 사용자 "A로 하고")
  speedMulMax: 1.2,
  critRates: [1 / 24, 1 / 8, 1 / 2, 1] as readonly number[], // 급소율 단계 — 보통·높음·대운 높음·확정 (docs/specs/moves.md "급소")
  critMul: 1.5,
  immuneMul: 0, // 상성 효과 없음의 배율 — 원작대로 0 (docs/specs/moves.md "피해")
  weatherTickMs: 5000, // 모래바람 피해·그래스필드 회복 간격 — 최대 HP 의 1/16 (docs/specs/moves.md "날씨, 필드, 오라")
  sniperMul: 2.25,
  stageMs: 10_000, // 능력 변화 지속
  rampageMs: 2000, // 난동 뒤 행동 불가
  intimidateStages: -1, // 위협 — 시작할 때 상대 전체 공격 −1, 여럿이면 쌓인다
  pressureMul: 1.1, // 프레셔 — 상대 전체 기술 쿨타임 +10% (평타는 아님, 2026-10-08 사용자 결정)
  friendGuardMul: 0.75, // 아군 특성은 자기 쪽 전체에 건다 (2026-10-08 사용자 "전체로해")
  batteryMul: 1.1, // 배터리·파워스폿 — 자기 쪽 아군만, 자신 제외 (2026-10-09 사용자 결정, 켬/끔 실험)
  powerSpotMul: 1.1,
  steelySpiritMul: 1.5,
  plusMinusMul: 1.5,
  victoryStarMul: 1.1,
  reflectMs: 3000, // 마자용 반사 대기
  reflectMul: 2,
  shieldMs: 2000, // 킹실드 막기
  stanceStepMs: 3000, // 킬가르도 — 두 기술을 3초 어긋나게 번갈아
  skillLinkStacks: 5, // 스킬링크 스택 최대, 자동은 autoStacks 에서 쓴다
  skillLinkAuto: 3,
  truantMul: 1.5, // 게으름 — 한 번 쓴 뒤 쿨타임 ×1.5 (2026-10-09 사용자 결정, 켬/끔 실험)
  regeneratorDiv: 4, // 재생력 — HP 50% 아래가 처음 되면 최대 HP 의 1/4 회복 (2026-10-09 사용자 결정)
  weatherDefMul: 1.3, // 모래바람 바위 특방·눈 얼음 방어 (2026-10-09 사용자 "제안대로 해봐", 맞춘 파티 실험, 처음 ×1.5)
  weatherBoostMul: 1.3, // 쾌청 불꽃·비 물·쾌청 하이드로스팀 — 약해지는 쪽 ×0.5 는 그대로 (2026-10-09 사용자 결정)
  slowStartMul: 5, // 슬로스타트 — 첫 기술·첫 평타까지 5배
  schoolingPct: 25, // 약어리 — HP 이 비율 미만이면 단독의 모습
  shieldsDownPct: 50, // 메테노 — HP 이 비율 이하면 코어의 모습
  fieldW: 20, // 전장 계산 칸 — 화면 10×6 (2026-10-09 사용자 "1안으로 진행해", 처음 8×5)
  fieldH: 12,
  body: 2, // 개체 하나가 차지하는 계산 칸(2×2)
  stepMs: 300, // 계산 칸 1칸 걷는 시간 — 모두 같다
  // 사거리(두 몸 사이 틈, 대각선 포함) — 기술 분류로 정한다: 물리 1, 특수 3. 두 기술 중 짧은 쪽(쌍두형은 근접)
  // (2026-10-09 사용자 "반영해봐" — 밸런스 격자 실험에서 가장 고른 안. 처음은 접촉 1·비접촉 물리 2·특수 3·파동·탄환·소리 5)
  rangePhysical: 1,
  rangeSpecial: 3,
  rangeDamage: { 1: 1, 3: 0.9 } as Readonly<Record<number, number>>, // 사거리별 주는 피해 배율(기술·평타) — 특수(사거리 3) ×0.9
} as const;

// ── 날씨·필드·오라 (docs/specs/moves.md "날씨, 필드, 오라") ──
export type WeatherKind = "sun" | "rain" | "sand" | "snow" | "none" | "harsh-sun" | "heavy-rain" | "strong-winds";
export type FieldKind = "electric" | "grassy" | "psychic" | "misty";
export type AuraKind = "fairy" | "dark" | "break";
export interface SlotRef {
  side: Side;
  slot: number;
}
// 룰렛 하나 — 후보 포켓몬과 뽑힌 포켓몬. fixed 는 룰렛 없이 정해진 경우(원시회귀·델타스트림)
export interface BattleRoulette {
  kind: string | null;
  candidates: SlotRef[];
  picked: SlotRef | null;
  fixed?: true;
}
const WEATHER_ABILITY: Readonly<Record<string, WeatherKind>> = {
  drought: "sun",
  "orichalcum-pulse": "sun",
  drizzle: "rain",
  "sand-stream": "sand",
  "sand-spit": "sand",
  "snow-warning": "snow",
  "cloud-nine": "none",
  "air-lock": "none",
};
const PRIMAL_ABILITY: Readonly<Record<string, WeatherKind>> = { "desolate-land": "harsh-sun", "primordial-sea": "heavy-rain", "delta-stream": "strong-winds" };
const FIELD_ABILITY: Readonly<Record<string, FieldKind>> = {
  "electric-surge": "electric",
  "hadron-engine": "electric",
  "grassy-surge": "grassy",
  "seed-sower": "grassy",
  "psychic-surge": "psychic",
  "misty-surge": "misty",
};
const AURA_ABILITY: Readonly<Record<string, AuraKind>> = { "fairy-aura": "fairy", "dark-aura": "dark", "aura-break": "break" };
const WEATHER_TYPE: Readonly<Partial<Record<WeatherKind, string>>> = { sun: "fire", "harsh-sun": "fire", rain: "water", "heavy-rain": "water", sand: "rock", snow: "ice" };
const FIELD_TYPE: Readonly<Record<FieldKind, string>> = { electric: "electric", grassy: "grass", psychic: "psychic", misty: "fairy" };

// ── 상태 이상 (docs/specs/moves.md "상태 이상") ──
export type StatusKind = "burn" | "paralysis" | "poison" | "toxic" | "freeze" | "sleep" | "confusion" | "flinch"; // 붙잡기는 2026-10-09 에 뺐다(사용자 "다 삭제")
type MajorStatus = "burn" | "paralysis" | "poison" | "toxic" | "freeze" | "sleep";
const MAJOR: ReadonlySet<string> = new Set(["burn", "paralysis", "poison", "toxic", "freeze", "sleep"]);
const STATUS_MS: Readonly<Record<StatusKind, number>> = { burn: 10_000, paralysis: 10_000, poison: 10_000, toxic: 10_000, freeze: 3000, sleep: 3000, confusion: 5000, flinch: 0 };

export interface Pos {
  x: number; // 계산 칸 — 몸의 왼쪽 위
  y: number;
}
export interface Obstacle extends Pos {
  size: 1 | 2;
}

// 기술 하나의 사거리 — 물리 1, 특수 3. 변화기는 null(사거리를 정하지 않는다)
export function moveRange(m: Pick<EngineMove, "class" | "power">): number | null {
  if (m.class === "status" || !m.power) return null;
  return m.class === "physical" ? ENGINE_RULES.rangePhysical : ENGINE_RULES.rangeSpecial;
}
// 포켓몬의 사거리 — 공격기 사거리 중 짧은 쪽(물리기 하나·특수기 하나면 1). 공격기가 없으면 1(병풍 등)
export function rangeOfMoves(moves: readonly Pick<EngineMove, "class" | "power">[]): number {
  const list = moves.map(moveRange).filter((r): r is number => r !== null);
  return list.length ? Math.min(...list) : ENGINE_RULES.rangePhysical;
}
const rangeMul = (range: number): number => ENGINE_RULES.rangeDamage[range] ?? 1;

// 처음 자리 — 각 쪽 `1 2 / 3 4 / 5 6`, 상대는 거울. 2·4·6 이 앞 열이다. 팀은 화면 가운데 3줄(위아래 빈 줄)에 선다
export function startPos(side: Side, slot: number): Pos {
  const col = slot % 2; // 0 뒤 열, 1 앞 열
  const row = Math.floor(slot / 2);
  const cell = side === 0 ? col : ENGINE_RULES.fieldW / ENGINE_RULES.body - 1 - col;
  // 세 줄을 세로 가운데에 — 10×6 이면 계산 칸 3(화면 칸 반)에서 시작한다
  const top = (ENGINE_RULES.fieldH - 3 * ENGINE_RULES.body) / 2;
  return { x: cell * ENGINE_RULES.body, y: top + row * ENGINE_RULES.body };
}

// 능력 변화 단계 → 배율. 오르면 1.2·1.4, 내리면 그 역수 [스펙 미확정: 내림 배율]
// 능력 변화 — 단계당 25%, 최대 ±6. 오르면 1 + 0.25 × 단계, 내리면 1 ÷ (1 + 0.25 × 단계)
// (docs/specs/moves.md "능력 변화", 2026-10-08 사용자 "25%로 하고", "6랭크까지 하는게 나을듯")
const STAGE_STEP = 0.25;
const STAGE_MAX = 6;
const stageMul = (stage: number): number => (stage >= 0 ? 1 + STAGE_STEP * stage : 1 / (1 + STAGE_STEP * -stage));
// effects.stats 의 능력 이름 → 능력치 번호
const STAT_INDEX: Readonly<Record<string, number>> = { atk: 1, def: 2, spa: 3, spd: 4, spe: 5 };

export type MoveClass = "physical" | "special" | "status";

export interface EngineMove {
  id: string;
  type: string;
  class: MoveClass;
  power: number | null;
  accuracy: number | null; // null 이면 반드시 맞는다
  priority: number;
  cooldownMs: number; // 틱 단위로 올린 값
  hits: readonly [number, number] | null;
  traits: readonly string[];
  effects: {
    charge?: boolean;
    recharge?: boolean;
    recoil?: number;
    halfHp?: boolean;
    drain?: number;
    stats?: readonly { who: "self" | "target"; stat: string; change: number; chance: number }[]; // 맞힌 뒤 chance% 로 능력 변화
    crit?: "high" | "always"; // 급소율
    status?: { kind: StatusKind | readonly StatusKind[]; chance: number }; // 상태 이상 — 목록이면 하나를 뽑는다 (moves.md "상태 이상")
    flinch?: number; // 풀죽음 확률(%)
    rampage?: boolean;
    hpScale?: boolean;
  };
}

// 전투에서 바뀌는 다른 모습 — HP 를 뺀 능력치만 바꾼다(테라파고스는 처음부터 다른 모습이라 HP 도 그 값)
export interface EngineForm {
  species: string;
  stats: readonly number[]; // 실제 능력치 6개
  types?: readonly string[]; // 모습의 타입이 다르면(달마모드)
  moves?: readonly EngineMove[]; // 모습이 자기 기술을 쓰면(메로엣타 스텝폼) — 바뀌면 기술과 사거리도 바뀐다
  range?: number;
}

export interface EngineFighter {
  species: string; // 배틀에서 보이는 모습(메가 포함)
  types: readonly string[];
  level: number; // 피해 공식의 레벨 — 배틀은 50
  stats: readonly number[]; // 실제 능력치 [HP, 공격, 방어, 특수공격, 특수방어, 스피드]
  moves: readonly EngineMove[]; // 쓰는 순서 — 개체의 기술 순서를 이미 적용한 값
  ability: string | null;
  special: "wall" | "reflect" | "sketch" | "transform" | "stance" | null;
  range: number; // 사거리(계산 칸) — 평타와 기술이 같이 쓴다. 물리 1, 특수 3
  altForm?: EngineForm | null; // 모습이 바뀌는 종의 다른 모습
  schoolingReady?: boolean; // 약어리 어군 해금(Lv.60) — 해금 전에는 단독의 모습으로만 싸운다
}

export interface BattleInput {
  seed: number;
  sides: readonly [readonly (EngineFighter | null)[], readonly (EngineFighter | null)[]];
  typeChart: Readonly<Record<string, Readonly<Record<string, number>>>>;
  maxMs?: number;
  obstacles?: readonly Obstacle[]; // 자체 검사용 벽 — 판에는 장애물이 없다. 서버는 주지 않는다
  positions?: readonly [readonly (Pos | null)[], readonly (Pos | null)[]]; // 주면 처음 자리를 덮는다 — 자체 검사용
  hpScale?: number; // 주면 전투 HP 배율을 덮는다 — 모의 대전·재생 도구의 값 비교용. 서버는 주지 않는다
}

export type Side = 0 | 1;

export type BattleEvent =
  | { t: number; kind: "start"; obstacles: Obstacle[]; pos: [(Pos | null)[], (Pos | null)[]]; roulette?: { weather?: BattleRoulette; field?: BattleRoulette; aura?: BattleRoulette } }
  | { t: number; kind: "weather"; side: Side; slot: number; amount: number; hp: number; cause: "sand" | "grassy" | "rain-dish" | "ice-body" } // amount 음수는 회복
  | { t: number; kind: "status"; side: Side; slot: number; status: StatusKind; on: boolean; until?: number } // 걸림(on, until = 풀리는 시각)·풀림
  | { t: number; kind: "status-hp"; side: Side; slot: number; amount: number; hp: number; cause: "burn" | "poison" | "toxic" | "nightmare" | "poison-heal" | "confusion" } // amount 음수는 회복
  | { t: number; kind: "step"; side: Side; slot: number; x: number; y: number }
  | { t: number; kind: "move"; side: Side; slot: number; move: string; nextAt: number } // nextAt — 다음 차례 기술이 준비되는 시각(ms)
  | { t: number; kind: "attack"; side: Side; slot: number }
  | { t: number; kind: "charge"; side: Side; slot: number; move: string; nextAt: number }
  | { t: number; kind: "miss"; side: Side; slot: number; move: string; target: number }
  | { t: number; kind: "damage"; side: Side; slot: number; target: number; amount: number; mult: number; hp: number; source: string; hit: number; crit?: true }
  | { t: number; kind: "self"; side: Side; slot: number; amount: number; hp: number; cause: "recoil" | "half-hp" | "drain" }
  | { t: number; kind: "blocked"; side: Side; slot: number; target: number; move: string }
  | { t: number; kind: "reflect"; side: Side; slot: number; target: number; amount: number; hp: number }
  | { t: number; kind: "stat"; side: Side; slot: number; stat: number; stage: number; until?: number } // until — 10초짜리 변화가 끝나는 시각. 판 끝까지 가는 단계(불요의검·불굴의방패·다운로드)만이면 없다
  | { t: number; kind: "ability"; side: Side; slot: number; ability: string } // 특성이 효과를 낸 순간 — 결과 이벤트(stat·self·form·damage 등)보다 먼저, 같은 t
  | { t: number; kind: "status-blocked"; side: Side; slot: number; status: StatusKind; cause: "misty" | "ability" | "type" } // 상태 이상을 막았다 — 기술·특성의 확률을 통과했을 때만. 이미 다른 주된 상태 이상이 걸려 못 거는 경우는 내지 않는다
  | { t: number; kind: "form"; side: Side; slot: number; species: string }
  | { t: number; kind: "copy"; side: Side; slot: number; from: number; moves: string[] }
  | { t: number; kind: "faint"; side: Side; slot: number }
  | { t: number; kind: "end"; winner: Side | null; timeout: boolean };

export interface BattleResult {
  winner: Side | null; // null 이면 무승부
  timeout: boolean;
  endMs: number;
  hp: [number[], number[]]; // 칸마다 남은 전투 HP (빈 칸은 0)
  maxHp: [number[], number[]];
  obstacles: Obstacle[];
  events: BattleEvent[];
}

// ── 난수 ──
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ceilTick = (ms: number): number => Math.ceil(ms / ENGINE_RULES.tickMs) * ENGINE_RULES.tickMs;

// 기술 쿨타임의 스피드 배율
// 기술 쿨타임의 스피드 배율 — 기준 ÷ 실제 스피드(능력 변화 포함), 0.8~1.2
export const speedCooldownMul = (speed: number): number =>
  Math.max(ENGINE_RULES.speedMulMin, Math.min(ENGINE_RULES.speedMulMax, ENGINE_RULES.speedRef / Math.max(1, speed)));

interface Stage {
  stage: number;
  until: number;
}

interface Unit {
  side: Side;
  slot: number;
  base: EngineFighter; // 처음 받은 값
  species: string;
  types: readonly string[];
  stats: number[]; // 지금 모습의 실제 능력치(HP 칸은 쓰지 않음)
  moves: EngineMove[];
  maxHp: number;
  hp: number;
  turn: number; // 다음 차례 기술 번호
  uses: number; // 기술을 쓴 횟수
  nextMove: number;
  nextBasic: number;
  busyUntil: number;
  charged: boolean;
  slowFirstMove: boolean;
  slowFirstBasic: boolean;
  truant: boolean; // 한 번 쓴 뒤 2배가 켜졌는가
  stages: Map<number, Stage>;
  stackSince: number; // 스킬링크 스택이 쌓이기 시작한 시각
  reflectUntil: number;
  reflectClass: MoveClass | null;
  shieldUntil: number;
  inAlt: boolean;
  disabled: boolean; // 메타몽 기능 정지 — 기술 없음, 평타만
  fainted: boolean;
  x: number;
  y: number;
  target: Unit | null; // 쓰러질 때까지 바꾸지 않는다
  nextStep: number;
  range: number;
  ability: string | null; // 지금 특성 — 미라·떠도는영혼·트레이스로 바뀐다
  perm: number[]; // 판 끝까지 가는 능력 변화(불요의검·불굴의방패·다운로드)
  disguised: boolean; // 탈·아이스페이스가 아직 남았는가
  flashFire: boolean; // 타오르는불꽃이 켜졌는가
  electro: boolean; // 전기로바꾸기 — 다음 전기 기술 ×2
  halfDone: boolean; // HP 50% 아래로 처음 떨어진 일을 처리했는가(재생력·발끈·분노의껍질)
  illusion: boolean; // 일루전 — 첫 피해 전까지 대상이 되지 않는다
  lastAim: Unit | null; // 잠복 — 기술을 마지막으로 쓴 대상
  cursedMs: number; // 저주받은바디 — 다음 쿨타임에 더할 시간
  quickHalf: boolean; // 퀵드로 — 다음 쿨타임 절반
  major: { kind: MajorStatus; until: number } | null; // 화상·마비·독·맹독·얼음·잠듦 — 한 번에 하나
  confusedUntil: number;
  flinched: boolean; // 다음 기술 쿨타임 +1초
  toxicN: number; // 맹독 — 다음 5초 피해가 n/16
  hungry: boolean; // 꼬르륵스위치 — 배고픈 모양(오라휠이 악)
  gulp: "arrokuda" | "pikachu" | null; // 그대로꿀꺽미사일 — 문 먹이
  moveHit: boolean; // 기술 피해를 받은 적이 있는가 — "HP 가득"·"첫 피해" 특성은 처음 맞는 기술에만, 평타는 무시 (moves.md "특성")
  hitTypes: readonly string[] | null; // 변색·의태가 바꾼 타입 — 받는 상성에만 쓴다. 자속·면역·땅 판정은 types (2026-10-09 사용자 결정)
  costarDone: boolean; // 협연 — 판에 한 번
}

// 두 몸 사이 틈 — 대각선 포함(체비쇼프)
function gapOf(a: Pos, b: Pos): number {
  const B = ENGINE_RULES.body;
  const gx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x, b.x) - B);
  const gy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y, b.y) - B);
  return Math.max(gx, gy);
}

const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// 막힌 계산 칸 — 자체 검사가 준 벽만(판에는 장애물이 없다)
function obstacleGrid(obstacles: readonly Obstacle[]): Uint8Array {
  const { fieldW: W, fieldH: H } = ENGINE_RULES;
  const g = new Uint8Array(W * H);
  for (const o of obstacles) for (let dy = 0; dy < o.size; dy++) for (let dx = 0; dx < o.size; dx++) g[(o.y + dy) * W + o.x + dx] = 1;
  return g;
}

// 몸(2×2)이 그 자리에 들어가는가
function fits(grid: Uint8Array, x: number, y: number): boolean {
  const { fieldW: W, fieldH: H, body: B } = ENGINE_RULES;
  if (x < 0 || y < 0 || x > W - B || y > H - B) return false;
  for (let dy = 0; dy < B; dy++) for (let dx = 0; dx < B; dx++) if (grid[(y + dy) * W + x + dx]) return false;
  return true;
}

// 몸 자리 너비 우선 탐색 — 걸음 수와 앞 자리. 시작 자리는 막혀도 넣는다
function walk(grid: Uint8Array, from: Pos): { dist: Int16Array; prev: Int16Array } {
  const { fieldW: W, fieldH: H } = ENGINE_RULES;
  const dist = new Int16Array(W * H).fill(-1);
  const prev = new Int16Array(W * H).fill(-1);
  const start = from.y * W + from.x;
  dist[start] = 0;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    const cx = cur % W, cy = Math.floor(cur / W);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!fits(grid, nx, ny)) continue;
      const n = ny * W + nx;
      if (dist[n] !== -1) continue;
      dist[n] = dist[cur]! + 1;
      prev[n] = cur;
      queue.push(n);
    }
  }
  return { dist, prev };
}

const isSkillLinkMove = (u: Unit, m: EngineMove): boolean =>
  u.ability === "skill-link" && m.hits !== null && m.hits[0] === 2 && m.hits[1] === 5;

export function runBattle(input: BattleInput): BattleResult {
  const R = ENGINE_RULES;
  const rand = mulberry32(input.seed);
  const maxMs = input.maxMs ?? R.maxMs;
  const events: BattleEvent[] = [];
  const chart = input.typeChart;
  let curT = 0; // 지금 틱 — 쿨타임의 스피드 배율이 읽는다
  let gasAlive = false; // 화학변화가스 포켓몬이 살아 있는가 — ab() 가 읽는다
  // 판의 날씨·필드·오라 — 시작할 때 룰렛으로 정하고 판 끝까지 간다
  let weather: WeatherKind | null = null;
  let field: FieldKind | null = null;
  let aura: AuraKind | null = null;
  let sunny = false;
  let rainy = false;

  // ── 준비 ──
  const units: [(Unit | null)[], (Unit | null)[]] = [[], []];
  for (const side of [0, 1] as const) {
    input.sides[side].forEach((f, slot) => {
      units[side][slot] = f ? makeUnit(f, side, slot) : null;
    });
  }
  const all = (): Unit[] => [...units[0], ...units[1]].filter((u): u is Unit => u !== null);
  const alive = (side: Side): Unit[] => units[side].filter((u): u is Unit => u !== null && u.hp > 0);

  // 전장 — 장애물은 없다(2026-10-09 사용자 "장애물 제거"). 자체 검사가 준 벽만 쓴다
  const obstacles: Obstacle[] = (input.obstacles ?? []).map((o) => ({ ...o }));
  const walls = obstacleGrid(obstacles);
  for (const u of all()) {
    const p = input.positions?.[u.side][u.slot] ?? startPos(u.side, u.slot);
    u.x = p.x;
    u.y = p.y;
  }
  // 날씨·필드·오라 룰렛 — 양쪽 12칸에서 그 특성을 가진 포켓몬 하나를 같은 확률로 뽑는다
  function spin<K extends string>(table: Readonly<Record<string, K>>): { kind: K; roulette: BattleRoulette } | null {
    const cands = all().filter((u) => { const a = ab(u); return a !== null && table[a] !== undefined; });
    if (!cands.length) return null;
    const pick = cands[Math.floor(rand() * cands.length)]!;
    const kind = table[ab(pick)!]!;
    return { kind, roulette: { kind, candidates: cands.map((c) => ({ side: c.side, slot: c.slot })), picked: { side: pick.side, slot: pick.slot } } };
  }
  // 원시회귀 날씨·델타스트림은 룰렛 없이 정해진다. 둘 이상이면 그것끼리 뽑는다
  const primal = spin(PRIMAL_ABILITY);
  const weatherSpin = primal ? { kind: primal.kind, roulette: { ...primal.roulette, fixed: true as const } } : spin(WEATHER_ABILITY);
  const fieldSpin = spin(FIELD_ABILITY);
  const auraSpin = spin(AURA_ABILITY);
  weather = weatherSpin && weatherSpin.kind !== "none" ? weatherSpin.kind : null;
  field = fieldSpin?.kind ?? null;
  aura = auraSpin?.kind ?? null;
  sunny = weather === "sun" || weather === "harsh-sun";
  rainy = weather === "rain" || weather === "heavy-rain";
  const roulette = {
    ...(weatherSpin ? { weather: weatherSpin.roulette } : {}),
    ...(fieldSpin ? { field: fieldSpin.roulette } : {}),
    ...(auraSpin ? { aura: auraSpin.roulette } : {}),
  };

  events.push({
    t: 0,
    kind: "start",
    ...(Object.keys(roulette).length ? { roulette } : {}),
    obstacles: obstacles.map((o) => ({ ...o })),
    pos: [units[0].map((u) => (u ? { x: u.x, y: u.y } : null)), units[1].map((u) => (u ? { x: u.x, y: u.y } : null))],
  });

  function makeUnit(f: EngineFighter, side: Side, slot: number): Unit {
    const startAlt = !!f.altForm && (f.ability === "tera-shift" || (f.ability === "schooling" && f.schoolingReady === true));
    const stats = [...(startAlt && f.altForm ? f.altForm.stats : f.stats)];
    const hpStat = f.ability === "tera-shift" && f.altForm ? f.altForm.stats[0]! : f.stats[0]!;
    const maxHp = Math.max(1, Math.floor(hpStat * (input.hpScale ?? R.hpScale)));
    return {
      side,
      slot,
      base: f,
      species: startAlt && f.altForm ? f.altForm.species : f.species,
      types: f.types,
      stats,
      moves: [...f.moves],
      maxHp,
      hp: maxHp,
      turn: 0,
      uses: 0,
      nextMove: Infinity,
      nextBasic: Infinity,
      busyUntil: 0,
      charged: false,
      slowFirstMove: f.ability === "slow-start",
      slowFirstBasic: f.ability === "slow-start",
      truant: false,
      stages: new Map(),
      stackSince: 0,
      reflectUntil: -1,
      reflectClass: null,
      shieldUntil: -1,
      inAlt: startAlt,
      disabled: false,
      fainted: false,
      x: 0,
      y: 0,
      target: null,
      nextStep: R.stepMs,
      range: f.range,
      ability: f.ability,
      perm: [0, 0, 0, 0, 0, 0],
      disguised: f.ability === "disguise" || f.ability === "ice-face",
      flashFire: false,
      electro: false,
      halfDone: false,
      illusion: f.ability === "illusion",
      lastAim: null,
      cursedMs: 0,
      quickHalf: false,
      moveHit: false,
      hitTypes: null,
      costarDone: false,
      hungry: false,
      gulp: null,
      major: null,
      confusedUntil: -1,
      flinched: false,
      toxicN: 1,
    };
  }

  // 메타몽 — 같은 칸 상대의 HP 를 뺀 능력치·타입·기술을 따라 한다. 칸이 비면 기능 정지(평타만)
  // 루브도 — 상대 파티의 기술 칸에서 둘을 뽑는다. 상대 기술이 없으면 평타만
  // 따라 하는 값은 처음 받은 값(base)이다 — 메타몽끼리·루브도끼리 순서에 따라 결과가 바뀌지 않게
  for (const u of all()) {
    const foes = input.sides[u.side === 0 ? 1 : 0];
    if (u.base.special === "transform") {
      const src = foes[u.slot];
      if (!src || src.special === "transform") {
        u.disabled = true;
        u.moves = [];
      } else {
        u.stats = [u.stats[0]!, ...src.stats.slice(1)];
        u.types = src.types;
        u.moves = [...src.moves];
        u.range = src.range;
        events.push({ t: 0, kind: "copy", side: u.side, slot: u.slot, from: u.slot, moves: u.moves.map((m) => m.id) });
      }
    } else if (u.base.special === "sketch") {
      const cells: EngineMove[] = [];
      for (const f of foes) if (f && f.special !== "transform") cells.push(...f.moves);
      const picked: EngineMove[] = [];
      for (let i = 0; i < 2 && cells.length; i++) picked.push(cells.splice(Math.floor(rand() * cells.length), 1)[0]!);
      u.moves = picked;
      u.range = rangeOfMoves(picked);
      if (picked.length) events.push({ t: 0, kind: "copy", side: u.side, slot: u.slot, from: -1, moves: picked.map((m) => m.id) });
    }
  }

  // 지금 특성 — 화학변화가스 포켓몬이 살아 있으면 다른 포켓몬의 특성은 없다
  function ab(u: Unit): string | null {
    if (gasAlive && u.ability !== "neutralizing-gas") return null;
    return u.ability;
  }
  // 받는 쪽 특성 — 쓴 쪽이 틀깨기·테라볼티지·터보블레이즈면 막는 특성을 무시한다(스펙터가드·프리즘아머는 무시하지 못한다)
  const MOLD = new Set(["mold-breaker", "teravolt", "turboblaze"]);
  const UNBREAKABLE = new Set(["shadow-shield", "prism-armor", "full-metal-body"]);
  function defAb(o: Unit, by: Unit | null): string | null {
    const a = ab(o);
    if (a && by && by !== o && MOLD.has(ab(by) ?? "") && !UNBREAKABLE.has(a)) return null;
    return a;
  }

  // 특성 — 자기 쪽 살아 있는 아군(self 포함 여부는 부르는 쪽이 정한다)
  function hasAlly(u: Unit, ability: string, withSelf = true): boolean {
    return alive(u.side).some((v) => ab(v) === ability && (withSelf || v !== u));
  }
  const countAlly = (u: Unit, ability: string, withSelf: boolean): number =>
    alive(u.side).filter((v) => ab(v) === ability && (withSelf || v !== u)).length;
  const foeHas = (u: Unit, ability: string): boolean => alive(u.side === 0 ? 1 : 0).some((v) => ab(v) === ability);

  // 특성이 효과를 낸 순간 — 결과 이벤트(stat·self·form·damage·status 등)보다 먼저, 같은 t 로 낸다
  // 값만 곱하는 특성(천하장사·적응력·멀티스케일 등)과 5초마다 도는 회복(포이즌힐·젖은접시·아이스바디)은 내지 않는다
  function abilityFx(u: Unit, ability: string, t: number): void {
    events.push({ t, kind: "ability", side: u.side, slot: u.slot, ability });
  }

  // 기분파·의태 — 날씨·필드는 판 끝까지 가므로 판 시작에 타입을 정한다. 의태는 받는 상성에만(hitTypes)
  for (const u of all()) {
    const FORECAST: Partial<Record<WeatherKind, string>> = { sun: "fire", "harsh-sun": "fire", rain: "water", "heavy-rain": "water", snow: "ice", sand: "normal" };
    if (u.ability === "forecast" && weather && FORECAST[weather]) {
      abilityFx(u, "forecast", 0);
      u.types = [FORECAST[weather]!];
    }
    if (u.ability === "mimicry" && field) {
      abilityFx(u, "mimicry", 0);
      u.hitTypes = [FIELD_TYPE[field]];
    }
  }

  // 트레이스 — 같은 칸 상대의 특성을 받는다(그 칸이 비거나 트레이스면 그대로)
  for (const u of all()) {
    if (u.ability !== "trace") continue;
    const src = units[u.side === 0 ? 1 : 0][u.slot];
    if (src && src.ability && src.ability !== "trace") {
      abilityFx(u, "trace", 0);
      u.ability = src.ability;
    }
  }
  gasAlive = all().some((v) => v.ability === "neutralizing-gas");

  // 위협 — 판이 시작되면 상대 전체 공격 −1. 위협 개체 수만큼 쌓인다. 번견은 대신 공격 +1
  for (const u of all()) {
    if (ab(u) !== "intimidate") continue;
    abilityFx(u, "intimidate", 0);
    for (const o of alive(u.side === 0 ? 1 : 0)) {
      const oa = ab(o);
      if (oa === "inner-focus" || oa === "own-tempo" || oa === "oblivious" || oa === "scrappy") {
        abilityFx(o, oa, 0); // 위협을 받지 않는다(9세대 원작)
        continue;
      }
      if (oa === "guard-dog") {
        abilityFx(o, "guard-dog", 0);
        setStage(o, 1, 1, 0, o);
      } else setStage(o, 1, R.intimidateStages, 0, u);
    }
  }
  // 판 시작에 자기 능력만 올리는 특성은 판 끝까지 간다 — stat 이벤트에 until 이 없다
  for (const u of all()) {
    const a = ab(u);
    if (a === "intrepid-sword") u.perm[1] = u.perm[1]! + 1;
    if (a === "dauntless-shield") u.perm[2] = u.perm[2]! + 1;
    if (a === "download") {
      const foes = alive(u.side === 0 ? 1 : 0);
      const def = foes.reduce((x, o) => x + o.stats[2]!, 0), spd = foes.reduce((x, o) => x + o.stats[4]!, 0);
      const k = def < spd ? 1 : 3;
      u.perm[k] = u.perm[k]! + 1;
    }
    if (a === "intrepid-sword" || a === "dauntless-shield" || a === "download") abilityFx(u, a, 0);
    for (let i = 1; i <= 5; i++) if (u.perm[i]) events.push({ t: 0, kind: "stat", side: u.side, slot: u.slot, stat: i, stage: stageOf(u, i, 0), ...untilOf(u, i, 0) });
  }

  // 첫 시계
  for (const u of all()) {
    u.nextBasic = firstBasic(u);
    u.nextMove = u.moves.length ? cooldownOf(u, u.moves[0]!, true) : Infinity;
    if (u.base.special === "stance" && u.moves.length) u.nextMove = u.moves[0]!.cooldownMs;
  }

  // ── 값 ──
  function stageOf(u: Unit, stat: number, t: number): number {
    const s = u.stages.get(stat);
    const temp = s && s.until > t ? s.stage : 0;
    return Math.max(-STAGE_MAX, Math.min(STAGE_MAX, temp + (u.perm[stat] ?? 0)));
  }
  // noStage — 천진(상대 능력 변화 무시)
  function statNow(u: Unit, stat: number, t: number, noStage = false): number {
    return Math.max(1, Math.floor(u.stats[stat]! * (noStage ? 1 : stageMul(stageOf(u, stat, t))) * conditionStatMul(u, stat) * abilityStatMul(u, stat)));
  }

  // 특성의 능력치 배율 — 평타에도 붙는다(moves.md "특성")
  function abilityStatMul(u: Unit, stat: number): number {
    const a = ab(u);
    let mul = 1;
    if (stat === 1 && (a === "huge-power" || a === "pure-power")) mul *= 2;
    if (stat === 1 && (a === "hustle" || a === "gorilla-tactics")) mul *= 1.5;
    if (stat === 2 && a === "fur-coat") mul *= 2;
    if (stat === 1 && a === "guts" && u.major) mul *= 1.5; // 근성
    if (stat === 2 && a === "marvel-scale" && u.major) mul *= 1.5; // 이상한비늘
    if ((stat === 1 || stat === 3) && a === "defeatist" && u.hp * 2 <= u.maxHp) mul *= 0.5;
    if ((stat === 1 || stat === 3) && a === "supreme-overlord") mul *= 1 + 0.1 * Math.min(5, units[u.side].filter((v) => v && v.hp <= 0).length);
    // 재앙 특성 — 자신 외 모두
    const RUIN: Readonly<Record<string, number>> = { "tablets-of-ruin": 1, "sword-of-ruin": 2, "vessel-of-ruin": 3, "beads-of-ruin": 4 };
    for (const [ruin, s2] of Object.entries(RUIN)) if (s2 === stat && a !== ruin && all().some((v) => v !== u && v.hp > 0 && ab(v) === ruin)) mul *= 0.75;
    return mul;
  }

  // 땅에 있는가 — 비행 타입과 부유는 아니다. 필드 효과는 땅에 있는 포켓몬만 받는다
  function grounded(u: Unit): boolean {
    return !u.types.includes("flying") && ab(u) !== "levitate";
  }

  // 날씨·필드가 바꾸는 능력치 배율 — 모래바람 바위 특방, 눈 얼음 방어, 날씨·필드를 타는 특성
  function conditionStatMul(u: Unit, stat: number): number {
    let mul = 1;
    const a0 = ab(u);
    if (weather === "sand" && stat === 4 && u.types.includes("rock")) mul *= R.weatherDefMul;
    if (weather === "snow" && stat === 2 && u.types.includes("ice")) mul *= R.weatherDefMul;
    if (stat === 3 && a0 === "solar-power" && sunny) mul *= 1.5;
    if (stat === 1 && a0 === "orichalcum-pulse" && sunny) mul *= 1.33;
    if (stat === 3 && a0 === "hadron-engine" && field === "electric") mul *= 1.33;
    if (stat === 2 && a0 === "grass-pelt" && field === "grassy") mul *= 1.5;
    if ((stat === 1 || stat === 4) && sunny && alive(u.side).some((v) => ab(v) === "flower-gift")) mul *= 1.5;
    // 고대활성(쾌청)·쿼크차지(일렉트릭필드) — HP 를 뺀 실제 능력치 중 가장 높은 하나 ×1.3. 스피드면 능력치 대신 쿨타임(weatherCooldownMul)
    if (paradoxBoost(u) === stat && stat !== 5) mul *= 1.3;
    return mul;
  }

  // 고대활성·쿼크차지가 올리는 능력 번호 — 발동하지 않으면 null
  function paradoxBoost(u: Unit): number | null {
    const a0 = ab(u);
    if (!((a0 === "protosynthesis" && sunny) || (a0 === "quark-drive" && field === "electric"))) return null;
    let best = 1;
    for (let i = 2; i <= 5; i++) if (u.stats[i]! > u.stats[best]!) best = i;
    return best;
  }

  // 날씨·필드를 타는 스피드 특성 — 스피드 ×2 대신 기술 쿨타임 ×0.75. 스피드 배율 자르기와 따로 곱한다 (moves.md "특성")
  function weatherCooldownMul(u: Unit): number {
    const a0 = ab(u);
    if ((a0 === "chlorophyll" && sunny) || (a0 === "swift-swim" && rainy) || (a0 === "sand-rush" && weather === "sand") || (a0 === "slush-rush" && weather === "snow") || (a0 === "surge-surfer" && field === "electric")) return 0.75;
    if (paradoxBoost(u) === 5) return 0.85;
    return 1;
  }

  // 날씨·필드·오라가 바꾸는 기술 — 타입(웨더볼·대지의파동), 위력, 명중, 위력 배율, 실패
  interface MoveNow {
    type: string;
    power: number;
    accuracy: number | null;
    mul: number;
    fail: "weather" | "field" | null;
  }
  function moveNow(u: Unit, m: EngineMove, o: Unit): MoveNow {
    let type = m.type;
    let power = m.power ?? 0;
    let accuracy = m.accuracy;
    if (m.id === "aura-wheel" && ab(u) === "hunger-switch" && u.hungry) type = "dark"; // 꼬르륵스위치 — 배고픈 모양
    if (m.id === "weather-ball" && weather && WEATHER_TYPE[weather]) {
      type = WEATHER_TYPE[weather]!;
      power = 100;
    }
    if (m.id === "terrain-pulse" && field && grounded(u)) {
      type = FIELD_TYPE[field];
      power = 100;
    }
    if (field === "electric" && m.id === "rising-voltage" && grounded(o)) power = 140;
    if (field === "electric" && m.id === "psyblade") power = 120;
    if (field === "psychic" && m.id === "expanding-force" && grounded(u)) power = 120;
    if (m.id === "thunder" || m.id === "hurricane") accuracy = sunny ? 50 : rainy ? null : accuracy;
    if (m.id === "blizzard" && weather === "snow") accuracy = null;
    let mul = 1;
    let fail: MoveNow["fail"] = null;
    if (sunny && type === "fire") mul *= R.weatherBoostMul;
    if (sunny && type === "water") mul *= m.id === "hydro-steam" ? R.weatherBoostMul : 0.5;
    if (rainy && type === "water") mul *= R.weatherBoostMul;
    if (rainy && type === "fire") mul *= 0.5;
    if (weather === "harsh-sun" && type === "water" && m.id !== "hydro-steam") fail = "weather";
    if (weather === "heavy-rain" && type === "fire") fail = "weather";
    if (weather === "sand" && ab(u) === "sand-force" && (type === "rock" || type === "ground" || type === "steel")) mul *= 1.3;
    if (field && field !== "misty" && grounded(u) && FIELD_TYPE[field] === type) mul *= 1.3;
    if (field === "grassy" && grounded(o) && (m.id === "earthquake" || m.id === "bulldoze" || m.id === "magnitude")) mul *= 0.5;
    if (field === "misty" && grounded(o) && type === "dragon") mul *= 0.5;
    if (field === "psychic" && grounded(o) && m.priority > 0) fail = "field";
    // 오라 — 전장 전체. 반전은 그 오라를 가진 포켓몬이 살아 있을 때만
    if (aura === "fairy" && type === "fairy") mul *= 1.33;
    if (aura === "dark" && type === "dark") mul *= 1.33;
    if (aura === "break") {
      const has = (name: string): boolean => all().some((v) => v.hp > 0 && ab(v) === name);
      if (type === "fairy" && has("fairy-aura")) mul *= 0.75;
      if (type === "dark" && has("dark-aura")) mul *= 0.75;
    }
    return { type, power, accuracy, mul, fail };
  }

  // src — 능력 변화를 건 포켓몬. 상대가 건 하락은 플라워베일·클리어바디·하얀연기·메탈프로텍트·부풀린가슴·괴력집게·미러아머로 막는다
  function setStage(u: Unit, stat: number, delta: number, t: number, src: Unit | null = null): void {
    const a = ab(u);
    if (a === "contrary") delta = -delta;
    if (a === "simple") delta *= 2;
    const byFoe = src !== null && src.side !== u.side;
    if (byFoe && delta < 0) {
      const d = defAb(u, src);
      if (u.types.includes("grass") && hasAlly(u, "flower-veil")) {
        abilityFx(alive(u.side).find((v) => ab(v) === "flower-veil")!, "flower-veil", t);
        return;
      }
      if (d === "clear-body" || d === "full-metal-body" || d === "white-smoke" || (d === "big-pecks" && stat === 2) || (d === "hyper-cutter" && stat === 1)) {
        abilityFx(u, d, t);
        return;
      }
      if (d === "mirror-armor") {
        abilityFx(u, d, t);
        if (src.hp > 0) setStage(src, stat, delta, t, null);
        return;
      }
    }
    const temp = u.stages.get(stat);
    const cur = temp && temp.until > t ? temp.stage : 0;
    const next = Math.max(-STAGE_MAX, Math.min(STAGE_MAX, cur + delta));
    u.stages.set(stat, { stage: next, until: t + R.stageMs });
    events.push({ t, kind: "stat", side: u.side, slot: u.slot, stat, stage: stageOf(u, stat, t), ...untilOf(u, stat, t) });
    // 오기·승기 — 상대가 능력을 내리면 공격·특수공격 +2
    if (byFoe && delta < 0 && u.hp > 0) {
      if (a === "defiant" || a === "competitive") abilityFx(u, a, t);
      if (a === "defiant") setStage(u, 1, 2, t, u);
      if (a === "competitive") setStage(u, 3, 2, t, u);
    }
    // 협연 — 자기 쪽 아군(자신 제외)의 능력이 처음 오르면 그 변화(오른 단계 수)를 복사한다. 판에 한 번
    const rose = next - cur;
    if (rose > 0 && u.hp > 0) {
      for (const v of alive(u.side)) {
        if (v === u || v.costarDone || ab(v) !== "costar") continue;
        v.costarDone = true;
        abilityFx(v, "costar", t);
        setStage(v, stat, rose, t, v);
      }
    }
  }

  // stat 이벤트의 until — 10초짜리 변화가 남아 있으면 그 끝 시각. 판 끝까지 가는 단계만이면 없다
  function untilOf(u: Unit, stat: number, t: number): { until?: number } {
    const s = u.stages.get(stat);
    return s && s.until > t ? { until: s.until } : {};
  }

  function firstBasic(u: Unit): number {
    let ms: number = R.basicMs;
    if (u.slowFirstBasic) ms *= R.slowStartMul;
    if (u.ability === "stall") ms = ceilTick(ms * 1.5);
    return ms;
  }

  // 기술 하나의 쿨타임 — 게으름·슬로스타트·반동으로 쉼·스피드·프레셔·날씨·쿨타임 특성
  function cooldownOf(u: Unit, m: EngineMove, first: boolean): number {
    let ms = m.cooldownMs;
    const a = ab(u);
    if (first && u.slowFirstMove) ms *= R.slowStartMul;
    if (u.truant) ms *= R.truantMul;
    let mul = speedCooldownMul(statNow(u, 5, curT));
    if (foeHas(u, "pressure")) mul *= R.pressureMul;
    mul *= weatherCooldownMul(u);
    if (first && a === "prankster") mul *= 0.5; // 짓궂은마음 — 첫 기술 쿨타임 절반
    if (first && a === "stall") mul *= 1.5; // 시간벌기 — 첫 기술 ×1.5
    if (a === "gale-wings" && m.type === "flying" && !u.moveHit) mul *= 0.8; // 질풍날개 — 기술에 맞기 전이면 비행 기술 선공
    if (a === "triage" && m.effects.drain) mul *= 0.8; // 힐링시프트 — 흡수 기술 선공
    const paralyzed = u.major?.kind === "paralysis";
    if (paralyzed && a !== "quick-feet") mul *= 1.25; // 마비
    if (a === "quick-feet" && u.major) mul *= 0.85; // 속보
    if (u.quickHalf) {
      mul *= 0.5;
      u.quickHalf = false;
    }
    return ceilTick(ms * mul);
  }

  // 급소 — 타마다. 전투무장·조가비갑옷은 맞지 않는다(확정급소도). 대운은 한 단계 위
  function critOf(u: Unit, m: EngineMove, o: Unit): boolean {
    const d = defAb(o, u);
    if (d === "battle-armor" || d === "shell-armor") return false;
    if (m.effects.crit === "always") return true;
    if (ab(u) === "merciless" && (o.major?.kind === "poison" || o.major?.kind === "toxic")) return true; // 무도한행동
    const stage = Math.min(R.critRates.length - 1, (m.effects.crit === "high" ? 1 : 0) + (ab(u) === "super-luck" ? 1 : 0));
    return rand() < R.critRates[stage]!;
  }

  // 아군 특성의 기술 위력 배율 — 배터리(특수)·파워스폿은 자신 제외, 강철정신은 자신 포함, 플러스·마이너스는 짝이 있으면 자신의 특수공격
  function allyMoveMul(u: Unit, m: EngineMove): number {
    let mul = 1;
    if (m.class === "special") mul *= R.batteryMul ** countAlly(u, "battery", false);
    mul *= R.powerSpotMul ** countAlly(u, "power-spot", false);
    if (m.type === "steel") mul *= R.steelySpiritMul ** countAlly(u, "steely-spirit", true);
    if (m.class === "special" && (ab(u) === "plus" || ab(u) === "minus") && alive(u.side).some((v) => v !== u && (ab(v) === "plus" || ab(v) === "minus"))) mul *= R.plusMinusMul;
    return mul;
  }
  // 받는 피해 배율(평타에도) — 프렌드가드(자신 제외, 틈새포착은 무시)
  const guardMul = (o: Unit, by: Unit): number => (ab(by) === "infiltrator" ? 1 : R.friendGuardMul ** countAlly(o, "friend-guard", false));

  // 기술에 붙는 쓴 쪽 특성 — 타입 바꾸기와 위력 배율 (moves.md "특성")
  const ATE: Readonly<Record<string, string>> = { aerilate: "flying", pixilate: "fairy", refrigerate: "ice", galvanize: "electric" };
  function attackerMove(u: Unit, m: EngineMove, type: string, power: number): { type: string; mul: number; stab: number } {
    const a = ab(u);
    let mul = 1;
    if (a && ATE[a] && type === "normal") {
      type = ATE[a]!;
      mul *= 1.2;
    }
    if (a === "normalize") {
      type = "normal";
      mul *= 1.2;
    }
    if (a === "liquid-voice" && m.traits.includes("sound")) type = "water";
    const has = (t: string): boolean => m.traits.includes(t);
    if (a === "iron-fist" && has("punch")) mul *= 1.2;
    if (a === "mega-launcher" && has("pulse")) mul *= 1.5;
    if (a === "sharpness" && has("slicing")) mul *= 1.5;
    if (a === "strong-jaw" && has("bite")) mul *= 1.5;
    if (a === "tough-claws" && has("contact")) mul *= 1.3;
    if (a === "toxic-boost" && m.class === "physical" && (u.major?.kind === "poison" || u.major?.kind === "toxic")) mul *= 1.5; // 독폭주
    if (a === "flare-boost" && m.class === "special" && u.major?.kind === "burn") mul *= 1.5; // 열폭주
    if (a === "punk-rock" && has("sound")) mul *= 1.3;
    if (a === "technician" && power <= 60) mul *= 1.5;
    if (a === "reckless" && (m.effects.recoil || m.effects.halfHp)) mul *= 1.2;
    if (a === "water-bubble" && type === "water") mul *= 2;
    if (a === "transistor" && type === "electric") mul *= 1.3;
    if (a === "dragons-maw" && type === "dragon") mul *= 1.5;
    if (a === "steelworker" && type === "steel") mul *= 1.5;
    if (a === "rocky-payload" && type === "rock") mul *= 1.5;
    if (u.hp * 3 <= u.maxHp) {
      const pinch: Readonly<Record<string, string>> = { blaze: "fire", overgrow: "grass", torrent: "water", swarm: "bug" };
      if (a && pinch[a] === type) mul *= 1.5;
    }
    if (u.flashFire && type === "fire") mul *= 1.5;
    if (u.electro && type === "electric") mul *= 2;
    if (a === "sheer-force" && sheerForced(u, m)) mul *= 1.3;
    const stab = u.types.includes(type) || a === "libero" || a === "protean" ? (a === "adaptability" ? 2 : 1.5) : 1;
    return { type, mul, stab };
  }
  // 우격다짐이 붙는 기술 — 상대 하락이나 자기 상승이 있는 공격기
  const sheerForced = (u: Unit, m: EngineMove): boolean =>
    ab(u) === "sheer-force" &&
    (!!m.effects.status || !!m.effects.flinch || (m.effects.stats ?? []).some((fx) => (fx.who === "target" && fx.change < 0) || (fx.who === "self" && fx.change > 0)));

  // ── 상태 이상 ──
  const majorOn = (u: Unit, t: number): boolean => u.major !== null && u.major.until > t;
  const stunned = (u: Unit, t: number): boolean => majorOn(u, t) && (u.major!.kind === "freeze" || u.major!.kind === "sleep");

  // 상태 이상 걸기 — 걸리면 true. src 는 건 포켓몬(특성이 걸면 그 특성 주인)
  function applyStatus(o: Unit, kind: StatusKind, t: number, src: Unit | null): boolean {
    if (o.hp <= 0) return false;
    const d = src ? defAb(o, src) : ab(o);
    // 막음 — 확률을 통과한 뒤 막혔을 때만 status-blocked 를 낸다. 특성이 막았으면 그 특성 주인에게 ability 를 먼저 낸다
    const blocked = (cause: "misty" | "ability" | "type", by: Unit | null = null, ability: string | null = null): false => {
      if (by && ability) abilityFx(by, ability, t);
      events.push({ t, kind: "status-blocked", side: o.side, slot: o.slot, status: kind, cause });
      return false;
    };
    const veil = (name: string): Unit | null => alive(o.side).find((v) => ab(v) === name) ?? null;
    if (kind === "flinch") {
      if (d === "inner-focus") return blocked("ability", o, d);
      o.flinched = true;
      events.push({ t, kind: "status", side: o.side, slot: o.slot, status: "flinch", on: true });
      if (d === "steadfast") {
        abilityFx(o, d, t);
        setStage(o, 5, 1, t, o);
      }
      return true;
    }
    // 이미 다른 주된 상태 이상이 걸려 못 거는 경우는 막음이 아니다 — 아무 이벤트도 내지 않는다
    if (MAJOR.has(kind) && majorOn(o, t)) return false;
    if (field === "misty" && grounded(o)) return blocked("misty");
    if (d === "comatose" || d === "purifying-salt") return blocked("ability", o, d);
    if (MAJOR.has(kind)) {
      if (d === "leaf-guard" && sunny) return blocked("ability", o, d);
      const corrosive = src && ab(src) === "corrosion";
      const typeGuard: Partial<Record<StatusKind, readonly string[]>> = { burn: ["fire"], paralysis: ["electric"], poison: corrosive ? [] : ["poison", "steel"], toxic: corrosive ? [] : ["poison", "steel"], freeze: ["ice"] };
      if ((typeGuard[kind] ?? []).some((ty) => o.types.includes(ty))) return blocked("type");
      const abilityGuard: Partial<Record<StatusKind, readonly string[]>> = {
        burn: ["water-veil", "water-bubble", "thermal-exchange"],
        paralysis: ["limber"],
        poison: ["immunity"],
        toxic: ["immunity"],
        freeze: ["magma-armor"],
        sleep: ["insomnia", "vital-spirit"],
      };
      if (d && (abilityGuard[kind] ?? []).includes(d)) return blocked("ability", o, d);
      const ally = kind === "poison" || kind === "toxic" ? veil("pastel-veil") : kind === "sleep" ? veil("sweet-veil") : null;
      if (ally) return blocked("ability", ally, ab(ally));
      let ms = STATUS_MS[kind];
      if (kind === "sleep" && d === "early-bird") ms = ms / 2;
      if (d === "natural-cure") ms = Math.min(ms, 5000);
      o.major = { kind: kind as MajorStatus, until: t + ms };
      if (kind === "toxic") o.toxicN = 1;
      events.push({ t, kind: "status", side: o.side, slot: o.slot, status: kind, on: true, until: o.major.until });
      // 싱크로 — 화상·마비·독·맹독을 건 상대에게도
      if (d === "synchronize" && src && src !== o && kind !== "freeze" && kind !== "sleep") {
        abilityFx(o, d, t);
        applyStatus(src, kind, t, null);
      }
      // 독조종 — 자기가 독·맹독을 건 상대는 혼란에도
      if (src && ab(src) === "poison-puppeteer" && (kind === "poison" || kind === "toxic")) {
        abilityFx(src, "poison-puppeteer", t);
        applyStatus(o, "confusion", t, src);
      }
      return true;
    }
    // 혼란
    if (d === "own-tempo") return blocked("ability", o, d);
    o.confusedUntil = t + STATUS_MS.confusion;
    events.push({ t, kind: "status", side: o.side, slot: o.slot, status: "confusion", on: true, until: o.confusedUntil });
    return true;
  }

  function cureMajor(o: Unit, t: number): void {
    if (!o.major) return;
    events.push({ t, kind: "status", side: o.side, slot: o.slot, status: o.major.kind, on: false });
    o.major = null;
  }

  // 시간이 다 된 상태 이상을 푼다 — 틱마다
  function expireStatus(t: number): void {
    for (const u of all()) {
      if (u.hp <= 0) continue;
      if (u.major && u.major.until <= t) cureMajor(u, t);
      if (u.confusedUntil > 0 && u.confusedUntil <= t) {
        u.confusedUntil = -1;
        events.push({ t, kind: "status", side: u.side, slot: u.slot, status: "confusion", on: false });
      }
      // 10초짜리 능력 변화가 끝났다 — 판 끝까지 가는 단계가 남으면 그 단계를 until 없이 다시 낸다. 없으면 화면이 until 로 지운다
      for (const [stat, s] of u.stages) {
        if (s.until > t) continue;
        u.stages.delete(stat);
        if (u.perm[stat]) events.push({ t, kind: "stat", side: u.side, slot: u.slot, stat, stage: stageOf(u, stat, t) });
      }
    }
  }

  // 상태 이상의 HP 변화 — 5초마다
  function statusHp(u: Unit, amount: number, t: number, cause: "burn" | "poison" | "toxic" | "nightmare" | "poison-heal" | "confusion", by: Unit | null = null): void {
    if (amount > 0) {
      hurt(u, amount, t, false);
      events.push({ t, kind: "status-hp", side: u.side, slot: u.slot, amount, hp: u.hp, cause });
      faintCheck(u, t, by);
    } else if (u.hp < u.maxHp) {
      const g = Math.min(-amount, u.maxHp - u.hp);
      u.hp += g;
      events.push({ t, kind: "status-hp", side: u.side, slot: u.slot, amount: -g, hp: u.hp, cause });
    }
  }
  function statusTick(u: Unit, t: number): void {
    const a = ab(u);
    const guard = a === "magic-guard";
    const part = (n: number): number => Math.max(1, Math.floor((u.maxHp * n) / 16));
    if (u.major && u.major.until > t) {
      const k = u.major.kind;
      if (a === "poison-heal" && (k === "poison" || k === "toxic")) statusHp(u, -part(2), t, "poison-heal");
      else if (!guard && k === "burn") statusHp(u, part(1), t, "burn");
      else if (!guard && k === "poison") statusHp(u, part(2), t, "poison");
      else if (!guard && k === "toxic") {
        statusHp(u, part(u.toxicN), t, "toxic");
        u.toxicN += 1;
      }
    }
    // 나이트메어 — 잠든 상대 전체가 1/8
    if (u.hp > 0 && !guard && u.major?.kind === "sleep" && u.major.until > t && all().some((v) => v.hp > 0 && v.side !== u.side && ab(v) === "bad-dreams")) statusHp(u, part(2), t, "nightmare");
    if (u.hp <= 0) return;
    // 풀기 — 탈피(30%), 촉촉바디(비), 치유의마음(아군 하나 30%)
    if (u.major && ((a === "shed-skin" && rand() < 0.3) || (a === "hydration" && rainy))) {
      abilityFx(u, a!, t);
      cureMajor(u, t);
    }
    if (a === "healer" && rand() < 0.3) {
      const sick = alive(u.side).filter((v) => v !== u && v.major);
      if (sick.length) {
        abilityFx(u, a, t);
        cureMajor(sick[Math.floor(rand() * sick.length)]!, t);
      }
    }
  }

  // 기술에 붙는 받는 쪽 특성 — 위력 배율. 무효는 immuneOf
  function defenderMoveMul(o: Unit, u: Unit, type: string, m: EngineMove, eff: number): number {
    const d = defAb(o, u);
    let mul = 1;
    const contact = m.traits.includes("contact") && ab(u) !== "long-reach";
    if (d === "ice-scales" && m.class === "special") mul *= 0.5;
    if (d === "fluffy" && contact) mul *= 0.5;
    if (d === "fluffy" && type === "fire") mul *= 2;
    if ((d === "filter" || d === "solid-rock" || d === "prism-armor") && eff > 1) mul *= 0.75;
    if (d === "thick-fat" && (type === "fire" || type === "ice")) mul *= 0.5;
    if ((d === "heatproof" || d === "water-bubble") && type === "fire") mul *= 0.5;
    if (d === "purifying-salt" && type === "ghost") mul *= 0.5;
    if (d === "punk-rock" && m.traits.includes("sound")) mul *= 0.5;
    if (d === "dry-skin" && type === "fire") mul *= 1.25;
    // 멀티스케일·스펙터가드 — 처음 맞는 기술만 ×0.5
    if ((d === "multiscale" || d === "shadow-shield") && !o.moveHit) mul *= 0.5;
    return mul;
  }

  // 특성 무효 — 무효면 무엇이 일어나는지. null 이면 맞는다
  type Absorb = { heal?: true; stat?: [number, number]; flash?: true } | "plain";
  function immuneOf(o: Unit, u: Unit, type: string, m: EngineMove, eff: number): Absorb | null {
    const d = defAb(o, u);
    if (!d) return null;
    if ((d === "levitate" || d === "eelevate") && type === "ground") return "plain";
    if (d === "earth-eater" && type === "ground") return { heal: true };
    if ((d === "volt-absorb") && type === "electric") return { heal: true };
    if ((d === "water-absorb" || d === "dry-skin") && type === "water") return { heal: true };
    if (d === "lightning-rod" && type === "electric") return { stat: [3, 1] };
    if (d === "storm-drain" && type === "water") return { stat: [3, 1] };
    if (d === "motor-drive" && type === "electric") return { stat: [5, 1] };
    if (d === "sap-sipper" && type === "grass") return { stat: [1, 1] };
    if (d === "flash-fire" && type === "fire") return { flash: true };
    if (d === "well-baked-body" && type === "fire") return { stat: [2, 2] };
    if (d === "bulletproof" && m.traits.includes("ballistic")) return "plain";
    if (d === "soundproof" && m.traits.includes("sound")) return "plain";
    if (d === "wonder-guard" && eff <= 1) return "plain";
    if (d === "wind-rider" && m.traits.includes("wind")) return { stat: [1, 1] }; // 바람타기 — 바람 기술 무효, 공격 +1
    return null;
  }

  // 델타스트림이면 비행 타입의 약점이 없다. 배짱·심안은 노말·격투로 고스트를 맞힌다. 변색·의태가 바꾼 타입은 여기(받는 상성)에만 쓴다
  const typeMul = (moveType: string, defender: Unit, by: Unit | null = null): number =>
    (defender.hitTypes ?? defender.types).reduce((a, d) => {
      let m = chart[moveType]?.[d] ?? 1;
      if (weather === "strong-winds" && d === "flying" && m > 1) m = 1;
      if (d === "ghost" && m === 0 && by && (ab(by) === "scrappy" || ab(by) === "minds-eye") && (moveType === "normal" || moveType === "fighting")) m = 1;
      return a * (m === 0 ? R.immuneMul : m);
    }, 1);

  const foesOf = (u: Unit): Unit[] => alive(u.side === 0 ? 1 : 0);
  const inRange = (a: Pos, b: Pos, range: number): boolean => gapOf(a, b) <= range;

  // 걸음 수 표에서 상대에게 닿는 가장 가까운 자리 — 없으면 -1
  function reachOf(dist: Int16Array, o: Unit, range: number): { at: number; steps: number } {
    let at = -1, steps = Infinity;
    for (let i = 0; i < dist.length; i++) {
      const d = dist[i]!;
      if (d < 0 || d >= steps) continue;
      if (inRange({ x: i % R.fieldW, y: Math.floor(i / R.fieldW) }, o, range)) {
        at = i;
        steps = d;
      }
    }
    return { at, steps };
  }

  // 대상 고르기 — 걸음 수로 가장 가까운 상대. 같으면 같은 줄(위아래 차이가 작은 쪽) → 번호가 작은 쪽. 닿을 길이 없는 상대는 빼다
  function pickTarget(u: Unit): Unit | null {
    const { dist } = walk(walls, u);
    let best: Unit | null = null, bestSteps = Infinity;
    const foes = foesOf(u);
    const hidden = foes.filter((o) => o.illusion && ab(o) === "illusion");
    for (const o of foes) {
      if (hidden.includes(o) && hidden.length < foes.length) continue;
      const { steps } = reachOf(dist, o, u.range);
      if (steps === Infinity) continue;
      const better =
        steps < bestSteps ||
        (steps === bestSteps && best !== null && (Math.abs(o.y - u.y) < Math.abs(best.y - u.y) || (Math.abs(o.y - u.y) === Math.abs(best.y - u.y) && o.slot < best.slot)));
      if (better) {
        best = o;
        bestSteps = steps;
      }
    }
    return best;
  }

  // 지금 대상 — 쓰러지면 다시 고른다
  function targetOf(u: Unit): Unit | null {
    if (!u.target || u.target.hp <= 0) u.target = pickTarget(u);
    return u.target;
  }

  // 사거리 안의 대상 — 연속기의 남은 타가 쓴다. 대상이 쓰러졌으면 사거리 안에서 가장 가까운 상대(틈 → 번호)
  function hitTarget(u: Unit): Unit | null {
    if (u.target && u.target.hp > 0 && inRange(u, u.target, u.range)) return u.target;
    let best: Unit | null = null;
    for (const o of foesOf(u)) {
      if (!inRange(u, o, u.range)) continue;
      if (!best || gapOf(u, o) < gapOf(u, best) || (gapOf(u, o) === gapOf(u, best) && o.slot < best.slot)) best = o;
    }
    return best;
  }

  // 행동할 수 있는가 — 대상이 사거리 안이어야 한다
  const canAct = (u: Unit): boolean => {
    const o = targetOf(u);
    return o !== null && inRange(u, o, u.range);
  };

  // 한 걸음 — 다른 개체를 피해 대상에게 닿는 자리로. 막혔으면 개체를 무시한 길의 첫 걸음이 비었을 때만 간다
  function step(u: Unit, t: number): void {
    let o = targetOf(u);
    if (!o || inRange(u, o, u.range)) return;
    const occupied = new Uint8Array(walls);
    for (const v of all()) {
      if (v === u || v.hp <= 0) continue;
      for (let dy = 0; dy < R.body; dy++) for (let dx = 0; dx < R.body; dx++) occupied[(v.y + dy) * R.fieldW + v.x + dx] = 1;
    }
    let route = walk(occupied, u);
    let goal = reachOf(route.dist, o, u.range).at;
    // 대상 주위가 다른 개체로 막혔다 — 지금 닿을 수 있는 다른 상대 가운데 걸음 수가 가장 적은 쪽으로 바꾼다(같으면 번호가 작은 쪽)
    // TFT 9.14·Underlords 가 고친 "닿지 못하는 대상을 붙잡고 서 있기"를 막는다 (2026-10-09 사용자 "A+B로 진행해")
    if (goal < 0) {
      let best: Unit | null = null, bestSteps = Infinity, bestAt = -1;
      for (const f of foesOf(u)) {
        const r = reachOf(route.dist, f, u.range);
        if (r.at >= 0 && (r.steps < bestSteps || (r.steps === bestSteps && best !== null && f.slot < best.slot))) {
          best = f;
          bestSteps = r.steps;
          bestAt = r.at;
        }
      }
      if (best) {
        u.target = best;
        o = best;
        goal = bestAt;
      }
    }
    if (goal < 0) {
      // 개체로 막혔다 — 벽만 본 길에서 대상이 닿지 않으면 다른 상대
      const free = walk(walls, u);
      if (reachOf(free.dist, o, u.range).at < 0) {
        u.target = pickTarget(u);
        o = u.target;
        if (!o) return;
      }
      route = walk(walls, u);
      goal = reachOf(route.dist, o, u.range).at;
      if (goal < 0) return;
    }
    const start = u.y * R.fieldW + u.x;
    let next = goal;
    while (route.prev[next]! !== start && route.prev[next]! >= 0) next = route.prev[next]!;
    if (next === start) return;
    const nx = next % R.fieldW, ny = Math.floor(next / R.fieldW);
    if (!fits(occupied, nx, ny)) return;
    u.x = nx;
    u.y = ny;
    u.nextStep = t + R.stepMs;
    events.push({ t, kind: "step", side: u.side, slot: u.slot, x: nx, y: ny });
  }

  function baseDamage(level: number, power: number, atk: number, def: number): number {
    const lv = Math.floor((2 * level) / 5) + 2;
    return Math.floor(Math.floor((lv * power * atk) / def) / 50) + 2;
  }
  const roll = (): number => (85 + Math.floor(rand() * 16)) / 100;

  // byMove — 기술 피해면 일루전을 벗긴다(평타는 아님)
  function hurt(target: Unit, amount: number, t: number, byMove = true): void {
    const before = target.hp;
    target.hp = Math.max(0, target.hp - amount);
    checkForm(target, t);
    if (amount > 0 && byMove) target.illusion = false;
    // HP 50% 아래로 처음 떨어질 때 — 재생력(1/4 회복, 한 번), 발끈(특수공격 +1), 분노의껍질(공격·특수공격 +1, 방어 −1)
    if (target.hp > 0 && !target.halfDone && before * 2 > target.maxHp && target.hp * 2 <= target.maxHp) {
      target.halfDone = true;
      const a = ab(target);
      if (a === "regenerator" || a === "berserk" || a === "anger-shell") abilityFx(target, a, t);
      if (a === "regenerator") {
        const g = Math.min(Math.floor(target.maxHp / R.regeneratorDiv), target.maxHp - target.hp);
        target.hp += g;
        events.push({ t, kind: "self", side: target.side, slot: target.slot, amount: -g, hp: target.hp, cause: "drain" });
      }
      if (a === "berserk") setStage(target, 3, 1, t, target);
      if (a === "anger-shell") {
        setStage(target, 1, 1, t, target);
        setStage(target, 3, 1, t, target);
        setStage(target, 2, -1, t, target);
      }
    }
  }

  // 맞는 쪽(기술만) — 탈·아이스페이스(첫 기술 피해 무효), 옹골참(처음 맞는 기술로는 1 남김). 평타로 깎여도 조건은 남는다
  function shield(o: Unit, u: Unit, d: number, phys: boolean): number {
    const a = defAb(o, u);
    if (d > 0 && o.disguised && (a === "disguise" || (a === "ice-face" && phys))) {
      abilityFx(o, a, curT);
      o.disguised = false;
      return 0;
    }
    if (a === "sturdy" && !o.moveHit && d >= o.hp) {
      abilityFx(o, a, curT);
      return o.hp - 1;
    }
    return d;
  }

  // 반격 피해 — 철가시·까칠한피부·유폭·내용물분출. reflect 이벤트로 낸다. 매직가드는 받지 않는다
  function strikeBack(o: Unit, u: Unit, amount: number, t: number): void {
    if (amount <= 0 || u.hp <= 0 || ab(u) === "magic-guard") return;
    hurt(u, amount, t);
    events.push({ t, kind: "reflect", side: o.side, slot: o.slot, target: u.slot, amount, hp: u.hp });
    faintCheck(u, t, o);
  }

  // 기술에 맞은 뒤 — "맞으면" 발동하는 특성(기술에만, moves.md "특성")
  function onHit(o: Unit, u: Unit, m: EngineMove, type: string, d: number, crit: boolean, t: number): void {
    const a = defAb(o, u);
    const contact = m.traits.includes("contact") && ab(u) !== "long-reach";
    if (contact) {
      if ((a === "iron-barbs" || a === "rough-skin") && u.hp > 0 && ab(u) !== "magic-guard") abilityFx(o, a, t);
      if (a === "iron-barbs" || a === "rough-skin") strikeBack(o, u, Math.max(1, Math.floor(u.maxHp / 8)), t);
      if ((a === "gooey" || a === "tangling-hair") && u.hp > 0) {
        abilityFx(o, a, t);
        setStage(u, 5, -1, t, o);
      }
      if (a === "mummy" || a === "lingering-aroma" || a === "wandering-spirit") abilityFx(o, a, t);
      if (a === "mummy" || a === "lingering-aroma") u.ability = a === "mummy" ? "mummy" : null;
      if (a === "wandering-spirit") [o.ability, u.ability] = [u.ability, o.ability];
      if (o.hp <= 0 && a === "aftermath") {
        abilityFx(o, a, t);
        strikeBack(o, u, Math.max(1, Math.floor(u.maxHp / 4)), t);
      }
      // 접촉 기술에 맞으면 30% 로 때린 상대에게 — 정전기(마비)·불꽃몸(화상)·독가시(독)·포자(독·마비·잠듦 중 하나)
      const contactStatus: Readonly<Record<string, readonly StatusKind[]>> = { static: ["paralysis"], "flame-body": ["burn"], "poison-point": ["poison"], "effect-spore": ["poison", "paralysis", "sleep"] };
      const cs = a ? contactStatus[a] : undefined;
      if (cs && u.hp > 0 && rand() < 0.3) {
        abilityFx(o, a!, t);
        applyStatus(u, cs[Math.floor(rand() * cs.length)]!, t, o);
      }
    }
    // 그대로꿀꺽미사일 — 문 먹이를 뱉는다. 때린 쪽이 자기 최대 HP 1/4, 삼켰던 것이 아리코면 방어 −1(피카츄는 마비라 지금 효과 없음)
    if (o.gulp) {
      const prey = o.gulp;
      o.gulp = null;
      abilityFx(o, "gulp-missile", t);
      strikeBack(o, u, Math.max(1, Math.floor(u.maxHp / 4)), t);
      if (prey === "arrokuda" && u.hp > 0) setStage(u, 2, -1, t, o);
      if (prey === "pikachu" && u.hp > 0) applyStatus(u, "paralysis", t, o);
    }
    if (o.hp <= 0) {
      if (a === "innards-out") {
        abilityFx(o, a, t);
        strikeBack(o, u, d, t);
      }
      return;
    }
    // 맞은 쪽의 능력 변화 특성 — 조건이 맞으면 ability 를 먼저 낸다
    const statFx: [boolean, () => void][] = [
      [a === "anger-point" && crit, () => setStage(o, 1, 6, t, o)],
      [a === "stamina", () => setStage(o, 2, 1, t, o)],
      [a === "justified" && type === "dark", () => setStage(o, 1, 1, t, o)],
      [a === "rattled" && (type === "dark" || type === "ghost" || type === "bug"), () => setStage(o, 5, 1, t, o)],
      [a === "steam-engine" && (type === "water" || type === "fire"), () => setStage(o, 5, 2, t, o)],
      [a === "thermal-exchange" && type === "fire", () => setStage(o, 1, 1, t, o)],
      [a === "water-compaction" && type === "water", () => setStage(o, 2, 2, t, o)],
      // 깨어진갑옷 — 물리 기술에 맞으면 방어 −1, 스피드 +2 (2026-10-09 사용자 결정)
      [a === "weak-armor" && m.class === "physical", () => {
          setStage(o, 2, -1, t, o);
          setStage(o, 5, 2, t, o);
        }],
    ];
    for (const [on, run] of statFx) {
      if (!on) continue;
      abilityFx(o, a!, t);
      run();
    }
    if (a === "electromorphosis" || (a === "wind-power" && m.traits.includes("wind"))) {
      abilityFx(o, a, t);
      o.electro = true; // 전기로바꾸기·풍력발전 — 다음 전기 기술 ×2
    }
    // 변색 — 맞은 기술의 타입이 된다. 받는 상성에만 쓰고 자속은 원래 타입 (2026-10-09 사용자 결정)
    if (a === "color-change" && (o.hitTypes ?? o.types).join() !== type) {
      abilityFx(o, a, t);
      o.hitTypes = [type];
    }
    if (a === "cursed-body" && rand() < 0.3) {
      abilityFx(o, a, t);
      u.cursedMs += 3000;
    }
    if (a === "cotton-down") {
      abilityFx(o, a, t);
      for (const v of alive(u.side)) setStage(v, 5, -1, t, o);
    }
  }

  // 모습 바뀜 — HP 조건
  function checkForm(u: Unit, t: number): void {
    const f = u.base.altForm;
    if (!f || u.hp <= 0) return;
    const pct = (u.hp * 100) / u.maxHp;
    const a = ab(u);
    // 달마모드 — HP 50% 이하, 판 끝까지
    const to = a === "schooling" && u.base.schoolingReady && u.inAlt && pct < R.schoolingPct ? false : (a === "shields-down" && !u.inAlt && pct <= R.shieldsDownPct) || (a === "zen-mode" && !u.inAlt && pct <= 50) ? true : null;
    if (to === null) return;
    abilityFx(u, a!, t);
    toForm(u, to, t);
  }

  function toForm(u: Unit, alt: boolean, t: number): void {
    const f = u.base.altForm;
    if (!f || u.inAlt === alt) return;
    u.inAlt = alt;
    const src = alt ? f.stats : u.base.stats;
    u.stats = [u.stats[0]!, ...src.slice(1)];
    u.species = alt ? f.species : u.base.species;
    if (f.types) u.types = alt ? f.types : u.base.types;
    // 자기 기술을 쓰는 모습(메로엣타) — 기술과 사거리도 바꾼다. 차례 번호는 그대로라 다음 차례는 새 기술 칸의 같은 자리다
    if (f.moves?.length) {
      u.moves = alt ? [...f.moves] : [...u.base.moves];
      u.range = alt ? (f.range ?? u.base.range) : u.base.range;
    }
    events.push({ t, kind: "form", side: u.side, slot: u.slot, species: u.species });
  }

  // by — 쓰러뜨린 포켓몬(알 때). 자기과신·백의울음·흑의울음·비스트부스트·Eelevate, 소울하트는 누가 쓰러져도
  function faintCheck(u: Unit, t: number, by: Unit | null = null): void {
    if (u.hp <= 0 && !u.fainted) {
      u.fainted = true;
      events.push({ t, kind: "faint", side: u.side, slot: u.slot });
      if (u.ability === "neutralizing-gas") gasAlive = all().some((v) => v.hp > 0 && v.ability === "neutralizing-gas");
      if (by && by.hp > 0 && by.side !== u.side) {
        const a = ab(by);
        if (a === "moxie" || a === "chilling-neigh" || a === "grim-neigh" || a === "beast-boost" || a === "eelevate") abilityFx(by, a, t);
        if (a === "moxie" || a === "chilling-neigh") setStage(by, 1, 1, t, by);
        if (a === "grim-neigh") setStage(by, 3, 1, t, by);
        if (a === "beast-boost" || a === "eelevate") {
          let best = 1;
          for (let i = 2; i <= 5; i++) if (by.stats[i]! > by.stats[best]!) best = i;
          setStage(by, best, 1, t, by);
        }
      }
      for (const v of all()) {
        if (v.hp <= 0 || ab(v) !== "soul-heart") continue;
        abilityFx(v, "soul-heart", t);
        setStage(v, 3, 1, t, v);
      }
    }
  }

  // ── 행동 ──
  function doBasic(u: Unit, t: number): void {
    let interval: number = R.basicMs;
    if (u.truant) interval *= R.truantMul;
    u.nextBasic = t + interval;
    if (u.slowFirstBasic) u.slowFirstBasic = false;
    const o = hitTarget(u);
    if (!o) return;
    events.push({ t, kind: "attack", side: u.side, slot: u.slot });
    // 천진 — 상대의 능력 변화를 보지 않는다
    const atk = statNow(u, 1, t, defAb(o, u) === "unaware"), spa = statNow(u, 3, t, defAb(o, u) === "unaware");
    const phys = atk >= spa;
    const burnMul = phys && u.major?.kind === "burn" && ab(u) !== "guts" ? 0.5 : 1;
    const raw = Math.max(1, Math.floor(baseDamage(u.base.level, R.basicPower, phys ? atk : spa, statNow(o, phys ? 2 : 4, t, ab(u) === "unaware")) * guardMul(o, u) * rangeMul(u.range) * burnMul * roll()));
    const d = raw;
    hurt(o, d, t, false);
    events.push({ t, kind: "damage", side: u.side, slot: u.slot, target: o.slot, amount: d, mult: 1, hp: o.hp, source: "basic", hit: 1 });
    faintCheck(o, t, u);
  }

  function hitsOf(u: Unit, m: EngineMove, stacks: number): number {
    if (!m.hits) return 1;
    const [lo, hi] = m.hits;
    if (isSkillLinkMove(u, m)) return stacks;
    if (lo === hi) return lo;
    if (lo === 2 && hi === 5) {
      const x = rand();
      return x < 0.35 ? 2 : x < 0.7 ? 3 : x < 0.85 ? 4 : 5;
    }
    if (lo === 1 && hi === 10) {
      let n = 1;
      while (n < 10 && rand() < 0.9) n++;
      return n;
    }
    return lo + Math.floor(rand() * (hi - lo + 1));
  }

  const stacksAt = (u: Unit, m: EngineMove, t: number): number =>
    Math.min(R.skillLinkStacks, Math.floor((t - u.stackSince) / Math.max(R.tickMs, ceilTick(m.cooldownMs / R.skillLinkStacks))));

  // 차례가 온 기술을 쓸 수 있는가 — 스킬링크 기술은 쿨타임 대신 스택 수로 본다
  function moveReady(u: Unit, t: number): boolean {
    if (!u.moves.length || u.busyUntil > t) return false;
    const m = u.moves[u.turn % u.moves.length]!;
    if (isSkillLinkMove(u, m)) return stacksAt(u, m, t) >= R.skillLinkAuto;
    return u.nextMove <= t;
  }

  function doMove(u: Unit, t: number): void {
    const m = u.moves[u.turn % u.moves.length]!;
    // 충전 — 처음 차면 충전하고, 다시 차면 나간다
    // 쾌청의 솔라빔·솔라블레이드, 비의 일렉트릭빔은 충전하지 않는다
    const instant = (sunny && (m.id === "solar-beam" || m.id === "solar-blade")) || (rainy && m.id === "electro-shot");
    if (m.effects.charge && !u.charged && !instant) {
      u.charged = true;
      u.nextMove = t + cooldownOf(u, m, false);
      events.push({ t, kind: "charge", side: u.side, slot: u.slot, move: m.id, nextAt: u.nextMove });
      return;
    }
    u.charged = false;
    // 돌핀맨 — 두 기술을 한 번씩 쓴 뒤 다음 기술 전에 마이티폼
    if (ab(u) === "zero-to-hero" && !u.inAlt && u.uses >= 2 && u.base.altForm) {
      abilityFx(u, "zero-to-hero", t);
      toForm(u, true, t);
    }
    const stacks = isSkillLinkMove(u, m) ? stacksAt(u, m, t) : 0;
    // 혼란 — 1/3 로 기술이 실패하고 자신이 위력 40(물리, 상성·자속 없음) 피해. 그 기술 차례는 지나간다
    const confusedFail = u.confusedUntil > t && rand() < 1 / 3;
    if (confusedFail) {
      const self = Math.max(1, Math.floor(baseDamage(u.base.level, 40, statNow(u, 1, t), statNow(u, 2, t)) * roll()));
      statusHp(u, self, t, "confusion");
    }
    const used: Extract<BattleEvent, { kind: "move" }> = { t, kind: "move", side: u.side, slot: u.slot, move: m.id, nextAt: t };
    if (!confusedFail) events.push(used);

    if (u.base.special === "stance") toForm(u, m.class !== "status", t); // 섀도볼 → 블레이드폼, 킹실드 → 실드폼
    if (m.id === "kings-shield") u.shieldUntil = t + R.shieldMs;
    if (confusedFail || u.hp <= 0) {
      // 실패 — 효과 없이 차례만 넘긴다
    } else if (u.base.special === "reflect") {
      u.reflectUntil = t + R.reflectMs;
      u.reflectClass = m.class;
    } else if (m.class !== "status" && m.power) attack(u, m, t, stacks);

    if (m.effects.rampage) u.busyUntil = t + R.rampageMs;
    // 메로엣타 — 루미나코러스(relic-song)를 쓰면 보이스폼 ↔ 스텝폼 (2026-10-09 사용자 "메로엣타 모습바꾸기가 안되던데")
    if (m.id === "relic-song" && u.base.altForm && u.base.altForm.moves?.length && u.hp > 0 && !confusedFail) toForm(u, !u.inAlt, t);
    // 그대로꿀꺽미사일 — 파도타기·다이빙을 쓰면 먹이를 문다. HP 50% 초과면 아리코, 아니면 피카츄
    if (ab(u) === "gulp-missile" && (m.id === "surf" || m.id === "dive") && u.hp > 0) u.gulp = u.hp * 2 > u.maxHp ? "arrokuda" : "pikachu";

    u.uses += 1;
    if (ab(u) === "truant") u.truant = true;
    if (u.slowFirstMove) u.slowFirstMove = false;
    if (isSkillLinkMove(u, m)) u.stackSince = t;
    u.turn += 1;
    const next = u.moves[u.turn % u.moves.length]!;
    if (u.base.special === "stance") u.nextMove = t + R.stanceStepMs;
    else {
      if (ab(u) === "quick-draw" && rand() < 0.3) {
        abilityFx(u, "quick-draw", t);
        u.quickHalf = true;
      }
      u.nextMove = t + cooldownOf(u, next, false) * (m.effects.recharge ? 2 : 1) + u.cursedMs + (u.flinched ? 1000 : 0);
      u.cursedMs = 0;
      if (u.flinched) {
        u.flinched = false;
        events.push({ t, kind: "status", side: u.side, slot: u.slot, status: "flinch", on: false });
      }
    }
    if (u.busyUntil > u.nextMove) u.nextMove = u.busyUntil;
    used.nextAt = u.nextMove;
  }

  function attack(u: Unit, m: EngineMove, t: number, stacks: number): void {
    let first = hitTarget(u);
    if (!first) return;
    const now0 = moveNow(u, m, first);
    // 사이코필드 — 땅에 있는 상대에게 선공기가 실패한다
    if (now0.fail === "field") {
      events.push({ t, kind: "miss", side: u.side, slot: u.slot, move: m.id, target: first.slot });
      return;
    }
    // 명중은 한 번 본다. 빗나가면 모든 타가 빗나간다. 노가드는 쓴 쪽이나 맞는 쪽이면 반드시 맞는다
    const ua = ab(u);
    let accMul = hasAlly(u, "victory-star") ? R.victoryStarMul : 1;
    if (ua === "compound-eyes") accMul *= 1.3;
    if (ua === "keen-eye" || ua === "illuminate") accMul *= 1.1;
    // 감미로운꿀 — 판 시작부터 10초 동안 자기 쪽 기술의 명중 ×1.33
    if (t < 10_000 && hasAlly(u, "supersweet-syrup")) accMul *= 1.33;
    // 모래숨기·눈숨기 — 모래바람·눈이면 자기에게 오는 기술의 명중 ×0.8
    const fa = defAb(first, u);
    if ((fa === "sand-veil" && weather === "sand") || (fa === "snow-cloak" && weather === "snow")) accMul *= 0.8;
    if (ua === "hustle" && m.class === "physical") accMul *= 0.8;
    const sure = ua === "no-guard" || ab(first) === "no-guard";
    const accuracy = now0.accuracy === null || sure ? null : now0.accuracy * accMul;
    if (accuracy !== null && rand() * 100 >= accuracy) {
      events.push({ t, kind: "miss", side: u.side, slot: u.slot, move: m.id, target: first.slot });
      return;
    }
    // 부자유친 — 한 번 맞는 기술이 두 번 맞고, 두 번째는 위력 25%
    const parental = ua === "parental-bond" && !m.hits;
    const n = hitsOf(u, m, stacks) + (parental ? 1 : 0);
    const phys = m.class === "physical";
    // 잠복 — 대상을 새로 정한 뒤 그 대상에게 쓰는 첫 기술 ×2
    const stake = ua === "stakeout" && u.lastAim !== first ? 2 : 1;
    u.lastAim = first;
    let dealt = 0;
    let firstHit: Unit | null = null;
    for (let h = 1; h <= n; h++) {
      const o = h === 1 ? first : hitTarget(u);
      if (!o) break;
      if (o.shieldUntil > t && !(ua === "unseen-fist" && m.traits.includes("contact"))) {
        events.push({ t, kind: "blocked", side: u.side, slot: u.slot, target: o.slot, move: m.id });
        if (m.traits.includes("contact")) setStage(u, 1, -1, t, o);
        break;
      }
      const now = h === 1 ? now0 : moveNow(u, m, o);
      let power = now.power;
      if (m.effects.hpScale) power = Math.max(1, Math.floor((power * u.hp) / u.maxHp));
      if (parental && h === n) power = Math.max(1, Math.floor(power / 4));
      const am = attackerMove(u, m, now.type, power);
      const type = am.type;
      const eff = now.fail === "weather" ? 0 : typeMul(type, o, u) * (ab(u) === "tinted-lens" && typeMul(type, o, u) < 1 && typeMul(type, o, u) > 0 ? 2 : 1);
      // 특성 무효 — 흡수·마중물·타오르는불꽃 등. 피해 0, 상성 0 으로 낸다
      const absorb = eff === 0 ? null : immuneOf(o, u, type, m, eff);
      if (absorb) {
        abilityFx(o, defAb(o, u)!, t);
        events.push({ t, kind: "damage", side: u.side, slot: u.slot, target: o.slot, amount: 0, mult: 0, hp: o.hp, source: m.id, hit: h });
        if (absorb !== "plain") {
          if (absorb.heal && o.hp < o.maxHp) {
            const g = Math.min(Math.floor(o.maxHp / 4), o.maxHp - o.hp);
            o.hp += g;
            events.push({ t, kind: "self", side: o.side, slot: o.slot, amount: -g, hp: o.hp, cause: "drain" });
          }
          if (absorb.stat) setStage(o, absorb.stat[0], absorb.stat[1], t, o);
          if (absorb.flash) o.flashFire = true;
        }
        break;
      }
      const mult = am.stab * eff * allyMoveMul(u, { ...m, type }) * guardMul(o, u) * now.mul * am.mul * defenderMoveMul(o, u, type, m, eff) * stake;
      const crit = critOf(u, m, o);
      // 급소면 쓴 쪽 공격 하락과 맞는 쪽 방어 상승은 무시한다. 천진은 상대의 능력 변화를 보지 않는다
      const atkNow = statNow(u, phys ? 1 : 3, t, defAb(o, u) === "unaware"), defNow = statNow(o, phys ? 2 : 4, t, ab(u) === "unaware");
      const atkStat = crit ? Math.max(atkNow, statNow(u, phys ? 1 : 3, t, true)) : atkNow;
      const defStat = crit ? Math.min(defNow, statNow(o, phys ? 2 : 4, t, true)) : defNow;
      const raw = baseDamage(u.base.level, power, atkStat, defStat);
      const burnMul = phys && u.major?.kind === "burn" && ua !== "guts" ? 0.5 : 1; // 화상 — 물리 피해 ×0.5, 근성은 받지 않음
      const critMul = (crit ? (ua === "sniper" ? R.sniperMul : R.critMul) : 1) * rangeMul(u.range) * burnMul;
      const d = eff === 0 ? 0 : shield(o, u, Math.max(1, Math.floor(raw * mult * critMul * roll())), phys);
      hurt(o, d, t);
      o.moveHit = true;
      dealt += d;
      if (type === "electric" && u.electro && d > 0) u.electro = false;
      events.push({ t, kind: "damage", side: u.side, slot: u.slot, target: o.slot, amount: d, mult: eff, hp: o.hp, source: m.id, hit: h, ...(crit ? { crit: true as const } : {}) });
      if (d > 0) onHit(o, u, m, type, d, crit, t);
      // 마자용 — 반사 대기 중 같은 분류의 기술을 받으면 받은 피해의 2배를 돌려준다(한 번)
      if (o.base.special === "reflect" && o.reflectUntil > t && o.reflectClass === m.class && o.hp > 0 && d > 0) {
        o.reflectUntil = -1;
        const back = d * R.reflectMul;
        hurt(u, back, t);
        events.push({ t, kind: "reflect", side: o.side, slot: o.slot, target: u.slot, amount: back, hp: u.hp });
      }
      if (h === 1 && d > 0) firstHit = o;
      faintCheck(o, t, u);
      if (u.hp <= 0) break;
    }
    // 공격기의 상태 이상·풀죽음 — 피해를 준 뒤 chance% 로 맞은 첫 대상에게. 우격다짐이면 없고, 인분은 받지 않는다. 하늘의은총은 2배
    if (dealt > 0 && firstHit && firstHit.hp > 0 && !sheerForced(u, m) && defAb(firstHit, u) !== "shield-dust") {
      const grace = ua === "serene-grace" ? 2 : 1;
      const st = m.effects.status;
      if (st && rand() * 100 < st.chance * grace) {
        const kinds = Array.isArray(st.kind) ? st.kind : [st.kind as StatusKind];
        applyStatus(firstHit, kinds[Math.floor(rand() * kinds.length)]!, t, u);
      }
      if (m.effects.flinch && rand() * 100 < m.effects.flinch * grace) applyStatus(firstHit, "flinch", t, u);
    }
    // 쓴 쪽 특성 — 독수(접촉 30% 독)·독사슬(30% 맹독)·악취(10% 풀죽음)
    if (dealt > 0 && firstHit && firstHit.hp > 0 && defAb(firstHit, u) !== "shield-dust") {
      const touch: StatusKind | null =
        ua === "poison-touch" && m.traits.includes("contact") && rand() < 0.3 ? "poison" : ua === "toxic-chain" && rand() < 0.3 ? "toxic" : ua === "stench" && rand() < 0.1 ? "flinch" : null;
      if (touch) {
        abilityFx(u, ua!, t);
        applyStatus(firstHit, touch, t, u);
      }
    }
    // 공격기의 능력 변화 — 맞힌 뒤 chance% 로. self 는 쓴 포켓몬, target 은 맞은 첫 대상
    // 우격다짐이면 그 기술의 능력 변화는 없다. 하늘의은총은 확률 2배, 인분은 상대가 거는 하락을 받지 않는다
    for (const fx of sheerForced(u, m) ? [] : (m.effects.stats ?? [])) {
      const idx = STAT_INDEX[fx.stat];
      if (idx === undefined || dealt <= 0) continue;
      const who = fx.who === "self" ? u : firstHit;
      if (!who || who.hp <= 0) continue;
      if (fx.who === "target" && defAb(who, u) === "shield-dust") continue;
      const chance = ua === "serene-grace" ? fx.chance * 2 : fx.chance;
      if (chance < 100 && rand() * 100 >= chance) continue;
      setStage(who, idx, fx.change, t, fx.who === "target" ? u : u);
    }
    if (dealt > 0 && u.hp > 0) {
      if (m.effects.recoil && ua !== "rock-head" && ua !== "magic-guard") {
        const r = Math.max(1, Math.floor((dealt * m.effects.recoil) / 100));
        hurt(u, r, t);
        events.push({ t, kind: "self", side: u.side, slot: u.slot, amount: r, hp: u.hp, cause: "recoil" });
      }
      if (m.effects.drain) {
        const g = Math.floor((dealt * m.effects.drain) / 100);
        // 해감액 — 흡수한 만큼 피해를 받는다
        if (firstHit && defAb(firstHit, u) === "liquid-ooze") {
          abilityFx(firstHit, "liquid-ooze", t);
          hurt(u, g, t);
          events.push({ t, kind: "self", side: u.side, slot: u.slot, amount: g, hp: u.hp, cause: "drain" });
        } else {
          u.hp = Math.min(u.maxHp, u.hp + g);
          events.push({ t, kind: "self", side: u.side, slot: u.slot, amount: -g, hp: u.hp, cause: "drain" });
        }
      }
    }
    if (m.effects.halfHp && u.hp > 0 && ua !== "magic-guard") {
      const l = Math.floor(u.maxHp / 2);
      hurt(u, l, t);
      events.push({ t, kind: "self", side: u.side, slot: u.slot, amount: l, hp: u.hp, cause: "half-hp" });
    }
    faintCheck(u, t);
  }

  // ── 판 ──
  const done = (): { winner: Side | null } | null => {
    const a = alive(0).length, b = alive(1).length;
    if (a && b) return null;
    return { winner: !a && !b ? null : a ? 0 : 1 };
  };

  let end = done();
  let t = 0;
  curT = 0;
  while (!end && t < maxMs) {
    t += R.tickMs;
    curT = t;
    expireStatus(t); // 시간이 다 된 상태 이상은 그 틱의 행동보다 먼저 푼다
    const acts: { u: Unit; kind: 0 | 1; pri: number; spe: number; k: number }[] = [];
    for (const u of all()) {
      if (u.hp <= 0 || stunned(u, t) || !canAct(u)) continue;
      if (moveReady(u, t)) acts.push({ u, kind: 0, pri: u.moves[u.turn % u.moves.length]!.priority, spe: statNow(u, 5, t), k: rand() });
      if (u.nextBasic <= t && u.busyUntil <= t) acts.push({ u, kind: 1, pri: 0, spe: statNow(u, 5, t), k: rand() });
    }
    acts.sort((a, b) => a.kind - b.kind || b.pri - a.pri || b.spe - a.spe || a.k - b.k);
    for (const a of acts) {
      if (a.u.hp <= 0) continue;
      if (a.kind === 0) doMove(a.u, t);
      else doBasic(a.u, t);
    }
    // 날씨·필드 — 5초마다 모래바람 피해(바위·땅·강철·방진 제외), 그래스필드(땅)·젖은접시(비)·아이스바디(눈) 회복
    if (t % R.weatherTickMs === 0) {
      for (const u of all()) {
        if (u.hp <= 0) continue;
        const tick = Math.max(1, Math.floor(u.maxHp / 16));
        if (ab(u) === "speed-boost") {
          abilityFx(u, "speed-boost", t);
          setStage(u, 5, 1, t, u);
        }
        if (ab(u) === "hunger-switch") u.hungry = !u.hungry; // 배부른 모양 → 배고픈 모양 → … 5초마다
        statusTick(u, t);
        if (u.hp <= 0) continue;
        if (ab(u) === "moody") {
          const up = [1, 2, 3, 4, 5].filter((i) => stageOf(u, i, t) < STAGE_MAX);
          if (up.length) {
            abilityFx(u, "moody", t);
            const a = up[Math.floor(rand() * up.length)]!;
            setStage(u, a, 2, t, u);
            const down = [1, 2, 3, 4, 5].filter((i) => i !== a && stageOf(u, i, t) > -STAGE_MAX);
            if (down.length) setStage(u, down[Math.floor(rand() * down.length)]!, -1, t, u);
          }
        }
        if (weather === "sand" && !u.types.some((ty) => ty === "rock" || ty === "ground" || ty === "steel") && ab(u) !== "overcoat" && ab(u) !== "magic-guard") {
          hurt(u, tick, t);
          events.push({ t, kind: "weather", side: u.side, slot: u.slot, amount: tick, hp: u.hp, cause: "sand" });
          faintCheck(u, t);
        }
        if (u.hp <= 0) continue;
        const heal = (cause: "grassy" | "rain-dish" | "ice-body"): void => {
          if (u.hp <= 0 || u.hp >= u.maxHp) return;
          const g = Math.min(tick, u.maxHp - u.hp);
          u.hp += g;
          events.push({ t, kind: "weather", side: u.side, slot: u.slot, amount: -g, hp: u.hp, cause });
        };
        if (field === "grassy" && grounded(u)) heal("grassy");
        if (rainy && ab(u) === "rain-dish") heal("rain-dish");
        if (weather === "snow" && ab(u) === "ice-body") heal("ice-body");
      }
    }
    // 걷기 — 이번 틱에 행동하지 않은 개체. 순서는 난수로 섞는다
    const acted = new Set(acts.map((a) => a.u));
    const walkers = all()
      .filter((u) => u.hp > 0 && !acted.has(u) && u.nextStep <= t && u.busyUntil <= t && !stunned(u, t))
      .map((u) => ({ u, k: rand() }))
      .sort((a, b) => a.k - b.k);
    for (const { u } of walkers) step(u, t);
    // 난동으로 밀린 평타
    for (const u of all()) if (u.hp > 0 && u.busyUntil > t && u.nextBasic < u.busyUntil) u.nextBasic = u.busyUntil;
    end = done();
  }

  const hp: [number[], number[]] = [units[0].map((u) => u?.hp ?? 0), units[1].map((u) => u?.hp ?? 0)];
  const maxHp: [number[], number[]] = [units[0].map((u) => u?.maxHp ?? 0), units[1].map((u) => u?.maxHp ?? 0)];
  let winner: Side | null;
  let timeout = false;
  if (end) winner = end.winner;
  else {
    timeout = true;
    const score = (s: Side): number => units[s].reduce((a, u) => a + (u ? Math.floor((u.hp * 1000) / u.maxHp) : 0), 0);
    const a = score(0), b = score(1);
    winner = a === b ? null : a > b ? 0 : 1;
  }
  events.push({ t, kind: "end", winner, timeout });
  return { winner, timeout, endMs: t, hp, maxHp, obstacles, events };
}
