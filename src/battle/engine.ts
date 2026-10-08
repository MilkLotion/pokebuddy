// 배틀 엔진 — 두 쪽 6칸과 시드를 받아 판 결과와 이벤트 목록을 낸다. 같은 입력이면 늘 같은 결과다
// 규칙은 docs/specs/moves.md "전투 규칙", 구조는 docs/specs/adventure.md "배틀 엔진"
//
// 이 파일은 import 가 없다 — 서버 함수(Deno)에 그대로 복사하려고. src/verify/save-rules.ts 와 같은 방식이다
// 저장·데이터 파일을 읽지 않는다. 개체 → 전투 개체는 ./fighter.ts 가 만든다
// 난수는 시드 하나(mulberry32)에서만 뽑는다. Math.random·시각은 쓰지 않는다
//
// 시간은 0.1초 틱. 한 틱에 할 행동을 모아 기술 > 평타 → 선공도 → 스피드 → 난수 순서로 한다. 행동하지 않은 개체는 그 뒤에 걷는다
// 전장은 계산 칸 16×10(화면 칸 1 = 계산 칸 2×2). 개체는 2×2 를 차지하고 8방향으로 0.3초에 1칸 걷는다. 사거리 = 몸 사이 틈(근접 1, 원거리 6)
// 장애물은 판의 시드로 가운데 4열에 1×1 둘과 2×2 하나를 뽑는다. 규칙은 docs/specs/moves.md "전장과 대상"
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
  smartAim: 0, // 1 이면 기술을 쓸 때 사거리 안에서 상성이 가장 좋은 상대를 노린다 — 시험 값
  sniperMul: 2.25,
  stageMs: 10_000, // 능력 변화 지속
  rampageMs: 2000, // 난동 뒤 행동 불가
  intimidateStages: -1, // 위협 — 시작할 때 상대 전체 공격 −1, 여럿이면 쌓인다
  pressureMul: 1.1, // 프레셔 — 상대 전체 기술 쿨타임 +10% (평타는 아님, 2026-10-08 사용자 결정)
  friendGuardMul: 0.75, // 아군 특성은 자기 쪽 전체에 건다 (2026-10-08 사용자 "전체로해")
  batteryMul: 1.3,
  powerSpotMul: 1.3,
  steelySpiritMul: 1.5,
  plusMinusMul: 1.5,
  victoryStarMul: 1.1,
  reflectMs: 3000, // 마자용 반사 대기
  reflectMul: 2,
  shieldMs: 2000, // 킹실드 막기
  stanceStepMs: 3000, // 킬가르도 — 두 기술을 3초 어긋나게 번갈아
  skillLinkStacks: 5, // 스킬링크 스택 최대, 자동은 autoStacks 에서 쓴다
  skillLinkAuto: 3,
  truantMul: 2, // 게으름 — 한 번 쓴 뒤 쿨타임 2배
  slowStartMul: 5, // 슬로스타트 — 첫 기술·첫 평타까지 5배
  schoolingPct: 25, // 약어리 — HP 이 비율 미만이면 단독의 모습
  shieldsDownPct: 50, // 메테노 — HP 이 비율 이하면 코어의 모습
  fieldW: 16, // 전장 계산 칸 — 화면 8×5
  fieldH: 10,
  body: 2, // 개체 하나가 차지하는 계산 칸(2×2)
  stepMs: 300, // 계산 칸 1칸 걷는 시간 — 모두 같다
  // 사거리(두 몸 사이 틈, 대각선 포함) — 기술로 정한다: 접촉 1, 접촉 없는 물리 2, 특수 3, 파동·탄환·소리 특수 5. 두 기술 중 짧은 쪽
  // (2026-10-08 사용자 "b로", "1,2 3,5 4개로")
  rangeContact: 1,
  rangePhysical: 2,
  rangeSpecial: 3,
  rangeFar: 5,
  farTraits: ["pulse", "ballistic", "sound"] as readonly string[],
  rangeDamage: { 1: 1, 2: 0.9, 3: 0.8, 5: 0.75 } as Readonly<Record<number, number>>, // 사거리별 주는 피해 배율(기술·평타) — 시작 값, 모의 대전으로 맞춘다
  obstacleSizes: [1, 1, 2] as readonly (1 | 2)[], // 장애물 — 1×1 두 개, 2×2 한 개 (2026-10-08 사용자 결정)
  obstacleX0: 4, // 장애물을 놓는 계산 칸 열 — 가운데 4열(화면 칸 2~5)
  obstacleX1: 12, // 이 열은 포함하지 않는다
} as const;

export interface Pos {
  x: number; // 계산 칸 — 몸의 왼쪽 위
  y: number;
}
export interface Obstacle extends Pos {
  size: 1 | 2;
}

// 기술 하나의 사거리 — 변화기는 null(사거리를 정하지 않는다)
export function moveRange(m: Pick<EngineMove, "class" | "power" | "traits">): number | null {
  if (m.class === "status" || !m.power) return null;
  if (m.traits.includes("contact")) return ENGINE_RULES.rangeContact;
  if (m.class === "physical") return ENGINE_RULES.rangePhysical;
  return m.traits.some((t) => ENGINE_RULES.farTraits.includes(t)) ? ENGINE_RULES.rangeFar : ENGINE_RULES.rangeSpecial;
}
// 포켓몬의 사거리 — 공격기 사거리 중 짧은 쪽. 공격기가 없으면 접촉 사거리(병풍 등)
export function rangeOfMoves(moves: readonly Pick<EngineMove, "class" | "power" | "traits">[]): number {
  const list = moves.map(moveRange).filter((r): r is number => r !== null);
  return list.length ? Math.min(...list) : ENGINE_RULES.rangeContact;
}
const rangeMul = (range: number): number => ENGINE_RULES.rangeDamage[range] ?? 1;

// 처음 자리 — 각 쪽 `1 2 / 3 4 / 5 6`, 상대는 거울. 2·4·6 이 앞 열이다. 팀은 화면 가운데 3줄(위아래 빈 줄)에 선다
export function startPos(side: Side, slot: number): Pos {
  const col = slot % 2; // 0 뒤 열, 1 앞 열
  const row = Math.floor(slot / 2) + 1;
  const cell = side === 0 ? col : ENGINE_RULES.fieldW / ENGINE_RULES.body - 1 - col;
  return { x: cell * ENGINE_RULES.body, y: row * ENGINE_RULES.body };
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
    rampage?: boolean;
    hpScale?: boolean;
  };
}

// 전투에서 바뀌는 다른 모습 — HP 를 뺀 능력치만 바꾼다(테라파고스는 처음부터 다른 모습이라 HP 도 그 값)
export interface EngineForm {
  species: string;
  stats: readonly number[]; // 실제 능력치 6개
}

export interface EngineFighter {
  species: string; // 배틀에서 보이는 모습(메가 포함)
  types: readonly string[];
  level: number; // 피해 공식의 레벨 — 배틀은 50
  stats: readonly number[]; // 실제 능력치 [HP, 공격, 방어, 특수공격, 특수방어, 스피드]
  moves: readonly EngineMove[]; // 쓰는 순서 — 개체의 기술 순서를 이미 적용한 값
  ability: string | null;
  special: "wall" | "reflect" | "sketch" | "transform" | "stance" | null;
  range: number; // 사거리(계산 칸) — 평타와 기술이 같이 쓴다. 근접 1, 원거리 6
  altForm?: EngineForm | null; // 모습이 바뀌는 종의 다른 모습
  schoolingReady?: boolean; // 약어리 어군 해금(Lv.60) — 해금 전에는 단독의 모습으로만 싸운다
}

export interface BattleInput {
  seed: number;
  sides: readonly [readonly (EngineFighter | null)[], readonly (EngineFighter | null)[]];
  typeChart: Readonly<Record<string, Readonly<Record<string, number>>>>;
  maxMs?: number;
  obstacles?: readonly Obstacle[]; // 주면 뽑지 않고 이 장애물을 쓴다 — 자체 검사용
  positions?: readonly [readonly (Pos | null)[], readonly (Pos | null)[]]; // 주면 처음 자리를 덮는다 — 자체 검사용
  hpScale?: number; // 주면 전투 HP 배율을 덮는다 — 모의 대전·재생 도구의 값 비교용. 서버는 주지 않는다
}

export type Side = 0 | 1;

export type BattleEvent =
  | { t: number; kind: "start"; obstacles: Obstacle[]; pos: [(Pos | null)[], (Pos | null)[]] }
  | { t: number; kind: "step"; side: Side; slot: number; x: number; y: number }
  | { t: number; kind: "move"; side: Side; slot: number; move: string; nextAt: number } // nextAt — 다음 차례 기술이 준비되는 시각(ms)
  | { t: number; kind: "attack"; side: Side; slot: number }
  | { t: number; kind: "charge"; side: Side; slot: number; move: string; nextAt: number }
  | { t: number; kind: "miss"; side: Side; slot: number; move: string; target: number }
  | { t: number; kind: "damage"; side: Side; slot: number; target: number; amount: number; mult: number; hp: number; source: string; hit: number; crit?: true }
  | { t: number; kind: "self"; side: Side; slot: number; amount: number; hp: number; cause: "recoil" | "half-hp" | "drain" }
  | { t: number; kind: "blocked"; side: Side; slot: number; target: number; move: string }
  | { t: number; kind: "reflect"; side: Side; slot: number; target: number; amount: number; hp: number }
  | { t: number; kind: "stat"; side: Side; slot: number; stat: number; stage: number }
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
}

// 두 몸 사이 틈 — 대각선 포함(체비쇼프)
function gapOf(a: Pos, b: Pos): number {
  const B = ENGINE_RULES.body;
  const gx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x, b.x) - B);
  const gy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y, b.y) - B);
  return Math.max(gx, gy);
}

const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// 막힌 계산 칸 — 장애물만
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

// 장애물 뽑기 — 가운데 4열에 1×1 두 개와 2×2 한 개를 완전 무작위로. 양쪽이 서로 닿을 길이 없으면 다시 뽑는다(20번 뒤에는 없음)
export function rollObstacles(rand: () => number): Obstacle[] {
  const R = ENGINE_RULES;
  for (let attempt = 0; attempt < 20; attempt++) {
    const list: Obstacle[] = [];
    const count = R.obstacleSizes.length;
    const used = new Uint8Array(R.fieldW * R.fieldH);
    for (let i = 0, tries = 0; i < count && tries < 50; tries++) {
      const size = R.obstacleSizes[i]!;
      const x = R.obstacleX0 + Math.floor(rand() * (R.obstacleX1 - R.obstacleX0 - size + 1));
      const y = Math.floor(rand() * (R.fieldH - size + 1));
      let clash = false;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (used[(y + dy) * R.fieldW + x + dx]) clash = true;
      if (clash) continue;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) used[(y + dy) * R.fieldW + x + dx] = 1;
      list.push({ x, y, size });
      i++;
    }
    const grid = obstacleGrid(list);
    const { dist } = walk(grid, startPos(0, 3));
    const goal = startPos(1, 3);
    if (dist[goal.y * R.fieldW + goal.x]! >= 0) return list;
  }
  return [];
}

const isSkillLinkMove = (u: Unit, m: EngineMove): boolean =>
  u.base.ability === "skill-link" && m.hits !== null && m.hits[0] === 2 && m.hits[1] === 5;

export function runBattle(input: BattleInput): BattleResult {
  const R = ENGINE_RULES;
  const rand = mulberry32(input.seed);
  const maxMs = input.maxMs ?? R.maxMs;
  const events: BattleEvent[] = [];
  const chart = input.typeChart;
  let curT = 0; // 지금 틱 — 쿨타임의 스피드 배율이 읽는다

  // ── 준비 ──
  const units: [(Unit | null)[], (Unit | null)[]] = [[], []];
  for (const side of [0, 1] as const) {
    input.sides[side].forEach((f, slot) => {
      units[side][slot] = f ? makeUnit(f, side, slot) : null;
    });
  }
  const all = (): Unit[] => [...units[0], ...units[1]].filter((u): u is Unit => u !== null);
  const alive = (side: Side): Unit[] => units[side].filter((u): u is Unit => u !== null && u.hp > 0);

  // 전장 — 장애물을 먼저 뽑고 처음 자리에 세운다
  const obstacles: Obstacle[] = input.obstacles ? input.obstacles.map((o) => ({ ...o })) : rollObstacles(rand);
  const walls = obstacleGrid(obstacles);
  for (const u of all()) {
    const p = input.positions?.[u.side][u.slot] ?? startPos(u.side, u.slot);
    u.x = p.x;
    u.y = p.y;
  }
  events.push({
    t: 0,
    kind: "start",
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

  // 특성 — 자기 쪽 살아 있는 아군(self 포함 여부는 부르는 쪽이 정한다)
  function hasAlly(u: Unit, ability: string, withSelf = true): boolean {
    return alive(u.side).some((v) => v.base.ability === ability && (withSelf || v !== u));
  }
  const countAlly = (u: Unit, ability: string, withSelf: boolean): number =>
    alive(u.side).filter((v) => v.base.ability === ability && (withSelf || v !== u)).length;
  const foeHas = (u: Unit, ability: string): boolean => alive(u.side === 0 ? 1 : 0).some((v) => v.base.ability === ability);

  // 위협 — 판이 시작되면 상대 전체 공격 −1. 위협 개체 수만큼 쌓인다
  for (const u of all()) {
    if (u.base.ability !== "intimidate") continue;
    for (const o of alive(u.side === 0 ? 1 : 0)) setStage(o, 1, R.intimidateStages, 0, true);
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
    return s && s.until > t ? s.stage : 0;
  }
  function statNow(u: Unit, stat: number, t: number): number {
    return Math.max(1, Math.floor(u.stats[stat]! * stageMul(stageOf(u, stat, t))));
  }

  // byFoe — 상대가 건 하락. 플라워베일 아군의 풀 타입은 막는다
  function setStage(u: Unit, stat: number, delta: number, t: number, byFoe = false): void {
    if (byFoe && delta < 0 && u.types.includes("grass") && hasAlly(u, "flower-veil")) return;
    const cur = stageOf(u, stat, t);
    const stage = Math.max(-STAGE_MAX, Math.min(STAGE_MAX, cur + delta));
    u.stages.set(stat, { stage, until: t + R.stageMs });
    events.push({ t, kind: "stat", side: u.side, slot: u.slot, stat, stage });
  }

  function firstBasic(u: Unit): number {
    let ms: number = R.basicMs;
    if (u.slowFirstBasic) ms *= R.slowStartMul;
    return ms;
  }

  // 기술 하나의 쿨타임 — 게으름·슬로스타트·반동으로 쉼을 곱한다
  function cooldownOf(u: Unit, m: EngineMove, first: boolean): number {
    let ms = m.cooldownMs;
    if (first && u.slowFirstMove) ms *= R.slowStartMul;
    if (u.truant) ms *= R.truantMul;
    let mul = speedCooldownMul(statNow(u, 5, curT));
    if (foeHas(u, "pressure")) mul *= R.pressureMul;
    return ceilTick(ms * mul);
  }

  // 급소 — 타마다. 전투무장·조가비갑옷은 맞지 않는다(확정급소도). 대운은 한 단계 위
  function critOf(u: Unit, m: EngineMove, o: Unit): boolean {
    if (o.base.ability === "battle-armor" || o.base.ability === "shell-armor") return false;
    if (m.effects.crit === "always") return true;
    const stage = Math.min(R.critRates.length - 1, (m.effects.crit === "high" ? 1 : 0) + (u.base.ability === "super-luck" ? 1 : 0));
    return rand() < R.critRates[stage]!;
  }

  // 아군 특성의 기술 위력 배율 — 배터리(특수)·파워스폿은 자신 제외, 강철정신은 자신 포함, 플러스·마이너스는 짝이 있으면 자신의 특수공격
  function allyMoveMul(u: Unit, m: EngineMove): number {
    let mul = 1;
    if (m.class === "special") mul *= R.batteryMul ** countAlly(u, "battery", false);
    mul *= R.powerSpotMul ** countAlly(u, "power-spot", false);
    if (m.type === "steel") mul *= R.steelySpiritMul ** countAlly(u, "steely-spirit", true);
    if (m.class === "special" && (u.base.ability === "plus" || u.base.ability === "minus") && alive(u.side).some((v) => v !== u && (v.base.ability === "plus" || v.base.ability === "minus"))) mul *= R.plusMinusMul;
    return mul;
  }
  // 받는 피해 배율 — 프렌드가드(자신 제외)
  const guardMul = (o: Unit): number => R.friendGuardMul ** countAlly(o, "friend-guard", false);

  const typeMul = (moveType: string, defender: Unit): number =>
    defender.types.reduce((a, d) => {
      const m = chart[moveType]?.[d] ?? 1;
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

  // 대상 고르기 — 장애물을 돌아가는 걸음 수로 가장 가까운 상대. 같으면 같은 줄(위아래 차이가 작은 쪽) → 번호가 작은 쪽. 닿을 길이 없는 상대는 빼다
  function pickTarget(u: Unit): Unit | null {
    const { dist } = walk(walls, u);
    let best: Unit | null = null, bestSteps = Infinity;
    for (const o of foesOf(u)) {
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
    if (goal < 0) {
      // 개체로 막혔다 — 장애물만 본 길에서 대상이 닿지 않으면 다른 상대
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

  function hurt(target: Unit, amount: number, t: number): void {
    target.hp = Math.max(0, target.hp - amount);
    checkForm(target, t);
  }

  // 모습 바뀜 — HP 조건
  function checkForm(u: Unit, t: number): void {
    const f = u.base.altForm;
    if (!f || u.hp <= 0) return;
    const pct = (u.hp * 100) / u.maxHp;
    if (u.base.ability === "schooling" && u.base.schoolingReady && u.inAlt && pct < R.schoolingPct) toForm(u, false, t);
    else if (u.base.ability === "shields-down" && !u.inAlt && pct <= R.shieldsDownPct) toForm(u, true, t);
  }

  function toForm(u: Unit, alt: boolean, t: number): void {
    const f = u.base.altForm;
    if (!f || u.inAlt === alt) return;
    u.inAlt = alt;
    const src = alt ? f.stats : u.base.stats;
    u.stats = [u.stats[0]!, ...src.slice(1)];
    u.species = alt ? f.species : u.base.species;
    events.push({ t, kind: "form", side: u.side, slot: u.slot, species: u.species });
  }

  function faintCheck(u: Unit, t: number): void {
    if (u.hp <= 0 && !u.fainted) {
      u.fainted = true;
      events.push({ t, kind: "faint", side: u.side, slot: u.slot });
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
    const atk = statNow(u, 1, t), spa = statNow(u, 3, t);
    const phys = atk >= spa;
    const d = Math.max(1, Math.floor(baseDamage(u.base.level, R.basicPower, phys ? atk : spa, statNow(o, phys ? 2 : 4, t)) * guardMul(o) * rangeMul(u.range) * roll()));
    hurt(o, d, t);
    events.push({ t, kind: "damage", side: u.side, slot: u.slot, target: o.slot, amount: d, mult: 1, hp: o.hp, source: "basic", hit: 1 });
    faintCheck(o, t);
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
    if (m.effects.charge && !u.charged) {
      u.charged = true;
      u.nextMove = t + cooldownOf(u, m, false);
      events.push({ t, kind: "charge", side: u.side, slot: u.slot, move: m.id, nextAt: u.nextMove });
      return;
    }
    u.charged = false;
    // 돌핀맨 — 두 기술을 한 번씩 쓴 뒤 다음 기술 전에 마이티폼
    if (u.base.ability === "zero-to-hero" && !u.inAlt && u.uses >= 2) toForm(u, true, t);
    const stacks = isSkillLinkMove(u, m) ? stacksAt(u, m, t) : 0;
    const used: Extract<BattleEvent, { kind: "move" }> = { t, kind: "move", side: u.side, slot: u.slot, move: m.id, nextAt: t };
    events.push(used);

    if (u.base.special === "stance") toForm(u, m.class !== "status", t); // 섀도볼 → 블레이드폼, 킹실드 → 실드폼
    if (m.id === "kings-shield") u.shieldUntil = t + R.shieldMs;
    if (u.base.special === "reflect") {
      u.reflectUntil = t + R.reflectMs;
      u.reflectClass = m.class;
    } else if (m.class !== "status" && m.power) attack(u, m, t, stacks);

    if (m.effects.rampage) u.busyUntil = t + R.rampageMs;

    u.uses += 1;
    if (u.base.ability === "truant") u.truant = true;
    if (u.slowFirstMove) u.slowFirstMove = false;
    if (isSkillLinkMove(u, m)) u.stackSince = t;
    u.turn += 1;
    const next = u.moves[u.turn % u.moves.length]!;
    if (u.base.special === "stance") u.nextMove = t + R.stanceStepMs;
    else u.nextMove = t + cooldownOf(u, next, false) * (m.effects.recharge ? 2 : 1);
    if (u.busyUntil > u.nextMove) u.nextMove = u.busyUntil;
    used.nextAt = u.nextMove;
  }

  function attack(u: Unit, m: EngineMove, t: number, stacks: number): void {
    let first = hitTarget(u);
    if (!first) return;
    // 상성 고르기 — 사거리 안 상대 가운데 이 기술의 상성이 가장 좋은 상대. 같으면 지금 대상
    if (R.smartAim) {
      for (const o of foesOf(u)) if (inRange(u, o, u.range) && typeMul(m.type, o) > typeMul(m.type, first)) first = o;
    }
    // 명중은 한 번 본다. 빗나가면 모든 타가 빗나간다
    const accuracy = m.accuracy === null ? null : m.accuracy * (hasAlly(u, "victory-star") ? R.victoryStarMul : 1);
    if (accuracy !== null && rand() * 100 >= accuracy) {
      events.push({ t, kind: "miss", side: u.side, slot: u.slot, move: m.id, target: first.slot });
      return;
    }
    const n = hitsOf(u, m, stacks);
    const phys = m.class === "physical";
    const stab = u.types.includes(m.type) ? 1.5 : 1;
    let dealt = 0;
    let firstHit: Unit | null = null;
    for (let h = 1; h <= n; h++) {
      const o = h === 1 ? first : hitTarget(u);
      if (!o) break;
      if (o.shieldUntil > t) {
        events.push({ t, kind: "blocked", side: u.side, slot: u.slot, target: o.slot, move: m.id });
        if (m.traits.includes("contact")) setStage(u, 1, -1, t, true);
        break;
      }
      let power = m.power!;
      if (m.effects.hpScale) power = Math.max(1, Math.floor((power * u.hp) / u.maxHp));
      const mult = stab * typeMul(m.type, o) * allyMoveMul(u, m) * guardMul(o);
      const crit = critOf(u, m, o);
      // 급소면 쓴 쪽 공격 하락과 맞는 쪽 방어 상승은 무시한다
      const atkNow = statNow(u, phys ? 1 : 3, t), defNow = statNow(o, phys ? 2 : 4, t);
      const atkStat = crit ? Math.max(atkNow, u.stats[phys ? 1 : 3]!) : atkNow;
      const defStat = crit ? Math.min(defNow, o.stats[phys ? 2 : 4]!) : defNow;
      const raw = baseDamage(u.base.level, power, atkStat, defStat);
      const typeOnly = typeMul(m.type, o);
      const critMul = (crit ? (u.base.ability === "sniper" ? R.sniperMul : R.critMul) : 1) * rangeMul(u.range);
      const d = typeOnly === 0 ? 0 : Math.max(1, Math.floor(raw * mult * critMul * roll()));
      hurt(o, d, t);
      dealt += d;
      events.push({ t, kind: "damage", side: u.side, slot: u.slot, target: o.slot, amount: d, mult: typeOnly, hp: o.hp, source: m.id, hit: h, ...(crit ? { crit: true as const } : {}) });
      // 마자용 — 반사 대기 중 같은 분류의 기술을 받으면 받은 피해의 2배를 돌려준다(한 번)
      if (o.base.special === "reflect" && o.reflectUntil > t && o.reflectClass === m.class && o.hp > 0 && d > 0) {
        o.reflectUntil = -1;
        const back = d * R.reflectMul;
        hurt(u, back, t);
        events.push({ t, kind: "reflect", side: o.side, slot: o.slot, target: u.slot, amount: back, hp: u.hp });
      }
      if (h === 1 && d > 0) firstHit = o;
      faintCheck(o, t);
      if (u.hp <= 0) break;
    }
    // 공격기의 능력 변화 — 맞힌 뒤 chance% 로. self 는 쓴 포켓몬, target 은 맞은 첫 대상
    for (const fx of m.effects.stats ?? []) {
      const idx = STAT_INDEX[fx.stat];
      if (idx === undefined || dealt <= 0) continue;
      const who = fx.who === "self" ? u : firstHit;
      if (!who || who.hp <= 0) continue;
      if (fx.chance < 100 && rand() * 100 >= fx.chance) continue;
      setStage(who, idx, fx.change, t, fx.who === "target");
    }
    if (dealt > 0 && u.hp > 0) {
      if (m.effects.recoil && u.base.ability !== "rock-head") {
        const r = Math.max(1, Math.floor((dealt * m.effects.recoil) / 100));
        hurt(u, r, t);
        events.push({ t, kind: "self", side: u.side, slot: u.slot, amount: r, hp: u.hp, cause: "recoil" });
      }
      if (m.effects.drain) {
        const g = Math.floor((dealt * m.effects.drain) / 100);
        u.hp = Math.min(u.maxHp, u.hp + g);
        events.push({ t, kind: "self", side: u.side, slot: u.slot, amount: -g, hp: u.hp, cause: "drain" });
      }
    }
    if (m.effects.halfHp && u.hp > 0) {
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
    const acts: { u: Unit; kind: 0 | 1; pri: number; spe: number; k: number }[] = [];
    for (const u of all()) {
      if (u.hp <= 0 || !canAct(u)) continue;
      if (moveReady(u, t)) acts.push({ u, kind: 0, pri: u.moves[u.turn % u.moves.length]!.priority, spe: statNow(u, 5, t), k: rand() });
      if (u.nextBasic <= t && u.busyUntil <= t) acts.push({ u, kind: 1, pri: 0, spe: statNow(u, 5, t), k: rand() });
    }
    acts.sort((a, b) => a.kind - b.kind || b.pri - a.pri || b.spe - a.spe || a.k - b.k);
    for (const a of acts) {
      if (a.u.hp <= 0) continue;
      if (a.kind === 0) doMove(a.u, t);
      else doBasic(a.u, t);
    }
    // 걷기 — 이번 틱에 행동하지 않은 개체. 순서는 난수로 섞는다
    const acted = new Set(acts.map((a) => a.u));
    const walkers = all()
      .filter((u) => u.hp > 0 && !acted.has(u) && u.nextStep <= t && u.busyUntil <= t)
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
