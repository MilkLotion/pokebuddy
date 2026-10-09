// 친선 배틀 판 → 배틀 창 입력. 서버 판은 방장 쪽이 0번이다(supabase/functions/friendly-battle) — 참가자 앱은 양쪽을 뒤집어 내 쪽을 왼쪽(0번)에 둔다
// 결과 대화상자는 보상 줄 없이 안내 한 줄(2026-10-10 사용자 "친선 배틀이라 보상은 없어요 삭제") (Figma 05 `16 배틀` `Battle / Window · 친선 배틀 결과` 1879:10646, docs/specs/adventure.md "친선 배틀")
import { ENGINE_RULES, type BattleEvent, type BattleResult, type EngineFighter, type Obstacle, type Pos } from "../battle/engine.js";
import type { FriendlyBattle } from "../online/friendly-session.js";
import type { BattleLook } from "../shared/model/battle-net.js";
import type { BattleScreenInput } from "./battle-screen.js";

export const FRIENDLY_TEXT = {
  title: "친선 배틀",
  friend: "친구", // 친구가 표시 이름이 없을 때
  detail: "확인을 누르면 친구와 다시 준비할 수 있어요.",
} as const;

type Pair<T> = [T, T];
const swap = <T>(p: readonly [T, T]): Pair<T> => [p[1], p[0]];
const flipSide = (s: number): 0 | 1 => (s === 0 ? 1 : 0);
// 좌우 뒤집기 — 몸이 계산 칸 2×2 라 왼쪽 위 x 는 fieldW − body − x
const flipX = (x: number): number => ENGINE_RULES.fieldW - ENGINE_RULES.body - x;
const flipPos = (p: Pos | null): Pos | null => (p ? { ...p, x: flipX(p.x) } : null);

// 이벤트 하나 뒤집기 — 쪽 번호(side·winner)를 바꾸고 칸 자리(x)를 좌우로 바꾼다. 목표 칸(target)은 상대 쪽 칸 번호라 그대로다
export function flipEvent(e: BattleEvent): BattleEvent {
  if (e.kind === "start") return { ...e, obstacles: e.obstacles.map((o) => ({ ...o, x: flipX(o.x) })), pos: swap(e.pos).map((side) => side.map(flipPos)) as Pair<(Pos | null)[]> };
  if (e.kind === "end") return { ...e, winner: e.winner === null ? null : flipSide(e.winner) };
  if (e.kind === "step") return { ...e, side: flipSide(e.side), x: flipX(e.x) };
  return { ...e, side: flipSide(e.side) } as BattleEvent;
}

export function friendlyScreenInput(b: FriendlyBattle, role: "host" | "guest", friendName: string | null): BattleScreenInput {
  const flip = role === "guest";
  const sides = b.sides as unknown as Pair<(EngineFighter | null)[]>;
  const looks = b.looks as unknown as Pair<(BattleLook | null)[]> | undefined;
  const events = b.events as BattleEvent[];
  const result: BattleResult = {
    winner: flip && b.result.winner !== null ? flipSide(b.result.winner) : b.result.winner,
    timeout: b.result.timeout,
    endMs: b.result.endMs,
    hp: flip ? swap(b.result.hp) : b.result.hp,
    maxHp: flip ? swap(b.result.maxHp) : b.result.maxHp,
    obstacles: (b.result.obstacles as Obstacle[]).map((o) => (flip ? { ...o, x: flipX(o.x) } : o)),
    events: flip ? events.map(flipEvent) : events,
  };
  return {
    sides: flip ? swap(sides) : sides,
    result,
    ...(looks ? { looks: flip ? swap(looks) : looks } : {}),
    opponentName: friendName ?? FRIENDLY_TEXT.friend,
    reward: { lead: "", detail: FRIENDLY_TEXT.detail },
    title: FRIENDLY_TEXT.title,
  };
}
