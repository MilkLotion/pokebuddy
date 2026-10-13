// 배틀 로그 줄 — 화면 모델의 이벤트에서 기술 사용·기절 줄을 만든다 (docs/specs/adventure.md "배틀 로그")
// - 평타는 줄을 만들지 않는다 (2026-10-13 사용자 "평타는 안넣을거고")
// - 기술 줄은 맞은 포켓몬마다 한 줄. 같은 시각의 같은 쓴 쪽 결과 이벤트(피해·빗나감·막음)를 모은다
// - 기절 줄은 마지막으로 HP 를 깎은 것이 기술일 때만 때린 쪽과 기술을 붙인다
// 메인(화면 모델)이 만들고 렌더러(배틀 로그 창)가 그린다. DOM·node 를 쓰지 않는다
import { josa } from "./josa.js";
import type { BattleScreenEvent, BattleSide } from "./model/battle-screen.js";

// 이름 한 칸 — 앞 점의 팀 색은 side, 글자는 조사까지 붙인 것
export interface BattleLogName {
  side: BattleSide;
  text: string;
}

// 한 줄 — 기술 줄 `who · whom · move · result`, 기절 줄 `who · whom · move+tail · result(기절)`
export interface BattleLogLine {
  t: number; // 판 시각(ms)
  kind: "move" | "faint";
  who: BattleLogName; // 기술 줄은 쓴 포켓몬, 기절 줄은 기절한 포켓몬
  whom: BattleLogName | null; // 기술 줄은 맞은 포켓몬, 기절 줄은 때린 포켓몬. 없으면 null
  move: string | null; // 기술 이름
  tail: string; // 기술 이름 바로 뒤 글자 — 기절 줄의 `을 맞고`
  result: string; // `-58 · 효과 굉장`·`빗나감`·`기절`. 없으면 빈 글자
}

export interface BattleLogInput {
  events: readonly BattleScreenEvent[];
  names: readonly [readonly (string | null)[], readonly (string | null)[]]; // 칸마다 포켓몬 이름
  moveNames: Readonly<Record<string, string>>; // 기술 id → 이름. 없으면 id 그대로
}

const other = (side: BattleSide): BattleSide => (side === 0 ? 1 : 0);
const BASIC = "basic"; // 평타 피해의 source (src/battle/engine.ts)

// 피해 판정 말 — 피해 숫자와 같은 순서. 급소가 먼저다 (src/shared/battle-timeline.ts judgeLabel)
function judgeText(mult: number, crit: boolean): string | null {
  if (crit) return "급소";
  if (mult > 1) return "효과 굉장";
  if (mult < 1) return "효과 별로";
  return null;
}

// 맞은 포켓몬 하나의 결과
interface Hit {
  target: number;
  amount: number;
  mult: number;
  crit: boolean;
  dealt: boolean; // 피해 이벤트가 있었다
  missed: boolean;
  blocked: boolean;
}

function resultText(h: Hit): string {
  if (h.dealt && h.mult !== 0) return [`-${h.amount}`, judgeText(h.mult, h.crit)].filter(Boolean).join(" · ");
  if (h.dealt) return "효과 없음";
  if (h.blocked) return "막음";
  if (h.missed) return "빗나감";
  return "";
}

export function battleLogLines(input: BattleLogInput): BattleLogLine[] {
  const { events } = input;
  const nameOf = (side: BattleSide, slot: number): string => input.names[side]?.[slot] ?? "";
  const moveName = (id: string): string => input.moveNames[id] ?? id;
  const named = (side: BattleSide, slot: number, pair: "이/가" | "에게" | "의"): BattleLogName => {
    const n = nameOf(side, slot);
    return { side, text: pair === "이/가" ? `${n}${josa(n, "이/가")}` : `${n}${pair}` };
  };
  // 칸마다 마지막으로 HP 를 깎은 것 — 기술이면 때린 쪽과 기술, 아니면 null
  const lastBlow = new Map<string, { side: BattleSide; slot: number; move: string } | null>();
  const key = (side: BattleSide, slot: number): string => `${side}:${slot}`;

  const out: BattleLogLine[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.kind === "move") {
      // 같은 시각에 이어지는 이 기술의 결과 — 맞은 순서대로
      const hits = new Map<number, Hit>();
      const hitOf = (target: number): Hit => {
        let h = hits.get(target);
        if (!h) {
          h = { target, amount: 0, mult: 1, crit: false, dealt: false, missed: false, blocked: false };
          hits.set(target, h);
        }
        return h;
      };
      for (let j = i + 1; j < events.length && events[j]!.t === e.t; j++) {
        const r = events[j]!;
        if (r.kind === "move" && r.side === e.side && r.slot === e.slot) break;
        if (!("side" in r) || r.side !== e.side || r.slot !== e.slot) continue;
        if (r.kind === "damage" && r.source === e.move) {
          const h = hitOf(r.target);
          h.dealt = true;
          h.amount += r.amount;
          h.mult = r.mult;
          h.crit ||= r.crit === true;
        } else if (r.kind === "miss" && r.move === e.move) hitOf(r.target).missed = true;
        else if (r.kind === "blocked" && r.move === e.move) hitOf(r.target).blocked = true;
      }
      const who = named(e.side, e.slot, "이/가");
      if (!hits.size) out.push({ t: e.t, kind: "move", who, whom: null, move: moveName(e.move), tail: "", result: "" });
      for (const h of hits.values()) out.push({ t: e.t, kind: "move", who, whom: named(other(e.side), h.target, "에게"), move: moveName(e.move), tail: "", result: resultText(h) });
    } else if (e.kind === "damage" && e.amount > 0) {
      lastBlow.set(key(other(e.side), e.target), e.source === BASIC ? null : { side: e.side, slot: e.slot, move: e.source });
    } else if (e.kind === "reflect" && e.amount > 0) {
      lastBlow.set(key(other(e.side), e.target), null);
    } else if ((e.kind === "self" || e.kind === "weather" || e.kind === "status-hp") && e.amount > 0) {
      lastBlow.set(key(e.side, e.slot), null);
    } else if (e.kind === "faint") {
      const by = lastBlow.get(key(e.side, e.slot)) ?? null;
      const who = named(e.side, e.slot, "이/가");
      if (by) {
        const move = moveName(by.move);
        out.push({ t: e.t, kind: "faint", who, whom: named(by.side, by.slot, "의"), move, tail: `${josa(move, "을/를")} 맞고`, result: "기절" });
      } else out.push({ t: e.t, kind: "faint", who, whom: null, move: null, tail: "", result: "기절" });
    }
  }
  return out;
}
