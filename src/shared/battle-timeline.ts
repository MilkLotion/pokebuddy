// 배틀 판 재생 계산 — 화면 모델의 이벤트를 시각 t 까지 적용한 상태와, 지금 보일 연출(기술 알약·피해 숫자)을 낸다
// DOM·node 를 쓰지 않는다. 렌더러(src/renderer/battle/screen.ts)가 그리고, 자체 검사가 같은 계산을 본다
// 앞으로만 진행한다 — 시각이 뒤로 가면 처음부터 다시 적용한다
import type { BattlePos, BattleScreenEvent, BattleScreenView, BattleSide } from "./model/battle-screen.js";
import type { LookSheets, SpriteSheet } from "./model/stage.js";

export const TIMELINE_RULES = {
  castMs: 900, // 기술 이름 알약이 떠 있는 시간
  popMs: 800, // 피해 숫자가 떠올랐다 사라지는 시간
  chipMs: 600, // 깎인 몫이 남아 있는 시간
  hitMs: 400, // 카드의 맞음 표시
  actMs: 500, // 카드의 기술 사용 표시
} as const;

export type PopKind = "normal" | "super" | "weak" | "miss" | "heal";

export interface Pop {
  side: BattleSide;
  slot: number;
  t: number;
  kind: PopKind;
  text: string;
}

export interface Cast {
  side: BattleSide;
  slot: number;
  t: number;
  move: string; // 기술 id
}

export interface UnitState {
  from: BattlePos; // 걷기 보간 — 출발 칸
  to: BattlePos; // 도착 칸
  stepAt: number; // 걷기 시작 시각
  hp: number;
  chipHp: number; // 깎이기 전 HP — chipUntil 까지 보인다
  chipUntil: number;
  fainted: boolean;
  faintAt: number;
  turn: number; // 다음 차례 기술 번호(0·1)
  gaugeFrom: number; // 다음 기술 쿨타임이 돌기 시작한 시각
  gaugeTo: number | null; // 다음 기술이 준비되는 시각. 모르면 null
  charging: boolean;
  stat: { stage: number; until: number } | null; // 마지막 능력 변화 — 그 단계와 끝 시각
  actAt: number; // 마지막 기술 사용 시각
  hitAt: number; // 마지막으로 맞은 시각
  facing: number; // 보는 방향 — PMD 방향 행(0 아래, 2 오른쪽, 4 위, 6 왼쪽)
  swing: { at: number; kind: "physical" | "special" } | null; // 마지막 공격 동작 — 평타·물리기는 physical, 특수기는 special
}

export interface TimelineState {
  t: number;
  units: [(UnitState | null)[], (UnitState | null)[]];
  alive: [number, number];
  ended: boolean;
}

const other = (side: BattleSide): BattleSide => (side === 0 ? 1 : 0);

// 방향 → PMD 방향 행. 오른쪽 2, 아래 0, 왼쪽 6, 위 4 (src/motion/rules.ts rowOf 와 같은 셈)
export function rowOf(dx: number, dy: number): number {
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (((2 - octant) % 8) + 8) % 8;
}

// 피해 숫자의 종류 — 상성 배율과 급소로 고른다
export function popKindOf(mult: number, crit: boolean): PopKind {
  if (mult === 0) return "miss";
  if (mult > 1 || crit) return "super";
  if (mult < 1) return "weak";
  return "normal";
}

export interface Timeline {
  seek(t: number): TimelineState; // t 까지 적용한 상태
  pops(t: number): Pop[]; // t 에 보일 피해 숫자
  casts(t: number): Cast[]; // t 에 보일 기술 알약
  // 다음 기술 쿨타임 바 — 0~1. 모르면 0
  gauge(u: UnitState, t: number): number;
  // 보이는 자리(계산 칸, 소수) — 걷는 중이면 보간
  posOf(u: UnitState, t: number): BattlePos;
}

export function createTimeline(view: BattleScreenView): Timeline {
  const events = view.events;
  const stepMs = view.field.stepMs;
  // 기술(충전) 시각 목록 — 처음 쿨타임 바는 0 에서 첫 기술까지 찬다. 엔진이 nextAt 을 주지 않으면 다음 기술 시각까지 찬다
  const firstAt = new Map<string, number>();
  const nextFire = new Map<BattleScreenEvent, number>();
  const lastFire = new Map<string, BattleScreenEvent>();
  for (const e of events) {
    if (e.kind !== "move" && e.kind !== "charge") continue;
    const k = `${e.side}:${e.slot}`;
    if (!firstAt.has(k)) firstAt.set(k, e.t);
    const prev = lastFire.get(k);
    if (prev) nextFire.set(prev, e.t);
    lastFire.set(k, e);
  }
  const readyAt = (e: BattleScreenEvent & { nextAt?: number }): number | null => e.nextAt ?? nextFire.get(e) ?? null;

  // 연출은 시각 순서 목록으로 미리 만든다
  const popList: Pop[] = [];
  const castList: Cast[] = [];
  for (const e of events) {
    if (e.kind === "move") castList.push({ side: e.side, slot: e.slot, t: e.t, move: e.move });
    else if (e.kind === "damage") popList.push({ side: other(e.side), slot: e.target, t: e.t, kind: popKindOf(e.mult, e.crit === true), text: e.mult === 0 ? "효과 없음" : `-${e.amount}` });
    else if (e.kind === "miss") popList.push({ side: other(e.side), slot: e.target, t: e.t, kind: "miss", text: "빗나감" });
    else if (e.kind === "blocked") popList.push({ side: other(e.side), slot: e.target, t: e.t, kind: "weak", text: "막음" });
    else if (e.kind === "reflect") popList.push({ side: other(e.side), slot: e.target, t: e.t, kind: "super", text: `-${e.amount}` });
    else if (e.kind === "self" && e.amount !== 0) popList.push({ side: e.side, slot: e.slot, t: e.t, kind: e.amount < 0 ? "heal" : "normal", text: e.amount < 0 ? `+${-e.amount}` : `-${e.amount}` });
  }

  let state: TimelineState;
  let index = 0;

  function reset(): void {
    const units = view.units.map((side, s) =>
      side.map((u, slot) => {
        if (!u) return null;
        const at = { x: 0, y: 0 };
        const st: UnitState = {
          from: at,
          to: at,
          stepAt: 0,
          hp: u.maxHp,
          chipHp: u.maxHp,
          chipUntil: 0,
          fainted: false,
          faintAt: 0,
          turn: 0,
          gaugeFrom: 0,
          gaugeTo: firstAt.get(`${s}:${slot}`) ?? null,
          charging: false,
          stat: null,
          actAt: -Infinity,
          hitAt: -Infinity,
          facing: s === 0 ? 2 : 6, // 처음에는 상대 쪽을 본다
          swing: null,
        };
        return st;
      }),
    ) as TimelineState["units"];
    state = { t: 0, units, alive: [units[0].filter(Boolean).length, units[1].filter(Boolean).length], ended: false };
    index = 0;
  }

  const unit = (side: BattleSide, slot: number): UnitState | null => state.units[side]?.[slot] ?? null;

  function hurt(u: UnitState, hp: number, t: number): void {
    if (hp < u.hp) {
      u.chipHp = t < u.chipUntil ? Math.max(u.chipHp, u.hp) : u.hp;
      u.chipUntil = t + TIMELINE_RULES.chipMs;
      u.hitAt = t;
    }
    u.hp = hp;
  }

  function apply(e: BattleScreenEvent): void {
    switch (e.kind) {
      case "start":
        e.pos.forEach((side, s) =>
          side.forEach((p, slot) => {
            const u = unit(s as BattleSide, slot);
            if (u && p) { u.from = { ...p }; u.to = { ...p }; }
          }),
        );
        break;
      case "step": {
        const u = unit(e.side, e.slot);
        if (u) {
          if (e.x !== u.to.x || e.y !== u.to.y) u.facing = rowOf(e.x - u.to.x, e.y - u.to.y);
          u.from = u.to; u.to = { x: e.x, y: e.y }; u.stepAt = e.t;
        }
        break;
      }
      case "move": {
        const u = unit(e.side, e.slot);
        if (u) {
          u.turn = (u.turn + 1) % 2; u.gaugeFrom = e.t; u.gaugeTo = readyAt(e); u.charging = false; u.actAt = e.t;
          u.swing = { at: e.t, kind: view.moveKinds[e.move] === "special" ? "special" : "physical" };
        }
        break;
      }
      case "attack": {
        const u = unit(e.side, e.slot);
        if (u) u.swing = { at: e.t, kind: "physical" };
        break;
      }
      case "charge": {
        const u = unit(e.side, e.slot);
        if (u) { u.charging = true; u.gaugeFrom = e.t; u.gaugeTo = readyAt(e); }
        break;
      }
      case "damage": {
        const u = unit(other(e.side), e.target);
        if (u) hurt(u, e.hp, e.t);
        // 때린 쪽은 맞은 쪽을 본다
        const a = unit(e.side, e.slot);
        if (a && u && (u.to.x !== a.to.x || u.to.y !== a.to.y)) a.facing = rowOf(u.to.x - a.to.x, u.to.y - a.to.y);
        break;
      }
      case "reflect": {
        const u = unit(other(e.side), e.target);
        if (u) hurt(u, e.hp, e.t);
        break;
      }
      case "self": {
        const u = unit(e.side, e.slot);
        if (u) hurt(u, e.hp, e.t);
        break;
      }
      case "stat": {
        const u = unit(e.side, e.slot);
        if (u) u.stat = e.stage === 0 ? null : { stage: e.stage, until: e.t + view.field.stageMs };
        break;
      }
      case "faint": {
        const u = unit(e.side, e.slot);
        if (u && !u.fainted) { u.fainted = true; u.faintAt = e.t; u.hp = 0; state.alive[e.side] -= 1; }
        break;
      }
      case "end":
        state.ended = true;
        break;
      default:
        break;
    }
  }

  reset();

  return {
    seek(t) {
      if (t < state.t) reset();
      while (index < events.length && events[index]!.t <= t) apply(events[index++]!);
      state.t = t;
      return state;
    },
    pops: (t) => popList.filter((p) => t >= p.t && t < p.t + TIMELINE_RULES.popMs),
    casts: (t) => castList.filter((c) => t >= c.t && t < c.t + TIMELINE_RULES.castMs),
    gauge(u, t) {
      if (u.gaugeTo === null || u.gaugeTo <= u.gaugeFrom) return u.gaugeTo !== null && t >= u.gaugeTo ? 1 : 0;
      return Math.max(0, Math.min(1, (t - u.gaugeFrom) / (u.gaugeTo - u.gaugeFrom)));
    },
    posOf(u, t) {
      const k = Math.max(0, Math.min(1, (t - u.stepAt) / stepMs));
      return { x: u.from.x + (u.to.x - u.from.x) * k, y: u.from.y + (u.to.y - u.from.y) * k };
    },
  };
}

// 남은 시간 글자 — 1:30
export function clockText(maxMs: number, t: number): string {
  const left = Math.max(0, Math.ceil((maxMs - t) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

// ── 포켓몬 그림 — 무대와 같은 PMD 묶음에서 지금 동작·방향·프레임을 고른다 ──
// 동작 후보는 앞에서부터 그 종이 가진 것을 쓴다(종마다 가진 동작이 다르다)
const SPRITE_ANIMS = {
  faint: ["Faint", "Trip", "Hurt"],
  physical: ["Attack", "Strike", "Punch", "Slam", "Swing", "Shoot"],
  special: ["Shoot", "SpAttack", "Charge", "Attack"],
  hurt: ["Hurt", "Cringe"],
  walk: ["Walk", "Idle"],
  idle: ["Idle", "Walk"],
} as const;

export interface SpriteFrame {
  anim: string;
  sheet: SpriteSheet;
  row: number;
  col: number; // 시트의 열 번호 — 렌더러가 col × fw 로 자른다
}

const lengthOf = (sheet: SpriteSheet): number => sheet.frames.reduce((n, f) => n + f.ms, 0);

function pick(sheets: LookSheets, names: readonly string[]): [string, SpriteSheet] | null {
  for (const n of names) {
    const sh = sheets.anims[n];
    if (sh && sh.frames.length) return [n, sh];
  }
  return null;
}

// 경과 시간 → 프레임. loop 는 되풀이, 그 밖은 마지막 프레임에서 멈춘다
function frameAt(sheet: SpriteSheet, elapsed: number, loop: boolean): number {
  const total = lengthOf(sheet);
  if (total <= 0) return 0;
  let k = loop ? ((elapsed % total) + total) % total : Math.max(0, elapsed);
  for (let i = 0; i < sheet.frames.length; i++) {
    k -= sheet.frames[i]!.ms;
    if (k < 0) return i;
  }
  return sheet.frames.length - 1;
}

export function spriteFrame(sheets: LookSheets, u: UnitState, t: number, stepMs: number): SpriteFrame | null {
  const out = (got: [string, SpriteSheet] | null, elapsed: number, loop: boolean): SpriteFrame | null => {
    if (!got) return null;
    const [anim, sheet] = got;
    const f = sheet.frames[frameAt(sheet, elapsed, loop)];
    return f ? { anim, sheet, row: Math.min(u.facing, sheet.rows - 1), col: f.x } : null;
  };
  if (u.fainted) return out(pick(sheets, SPRITE_ANIMS.faint), t - u.faintAt, false);
  if (u.swing) {
    const got = pick(sheets, SPRITE_ANIMS[u.swing.kind]);
    if (got && t - u.swing.at < lengthOf(got[1])) return out(got, t - u.swing.at, false);
  }
  const hurt = pick(sheets, SPRITE_ANIMS.hurt);
  if (hurt && t - u.hitAt < lengthOf(hurt[1])) return out(hurt, t - u.hitAt, false);
  if (t - u.stepAt < stepMs) return out(pick(sheets, SPRITE_ANIMS.walk), t, true);
  return out(pick(sheets, SPRITE_ANIMS.idle), t, true);
}
