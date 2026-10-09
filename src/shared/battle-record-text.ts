// 배틀 기록 문구 — 상대 고르기의 `내 전적` 줄, 배틀 기록 모달, 받은 판 알림 배너가 같은 셈을 쓴다
// 규칙 docs/specs/adventure.md "배틀 기록" 의 "앱에서 보이기"(2026-10-10 사용자 확정 "이렇게 진행"), Figma 05 `15 모험` `Adventure / Battle Record` 1870:13392
import type { BattleRecordRow, BattleTally } from "./model/battle-net.js";

export const playedOf = (t: BattleTally): number => t.wins + t.losses + t.draws;

// `12승 8패 1무` — 셋 다 보인다
export const tallyText = (t: BattleTally): string => `${t.wins}승 ${t.losses}패 ${t.draws}무`;

// 승률 — 승 ÷ 판 수를 반올림한 정수 %. 판이 없으면 `—` (구현 판단)
export const rateText = (t: BattleTally): string => (playedOf(t) ? `${Math.round((t.wins / playedOf(t)) * 100)}%` : "—");

// 상대 고르기 `내 전적` 줄 — 건 판 기준
export const recordBarText = (mine: BattleTally): string => `${tallyText(mine)} · 승률 ${rateText(mine)}`;

// 요약 카드 셋째 줄 — `승률 57% · 21판`
export const summaryRateText = (t: BattleTally): string => `승률 ${rateText(t)} · ${playedOf(t)}판`;

// 최근 배틀 한 줄 — 시각은 이 PC 의 시간대로 `10월 9일 14:10`, 판 길이는 `1:32`, 받은 판의 포인트 자리는 `—`
export function recordRowText(r: BattleRecordRow): { result: string; kind: string; when: string; length: string; point: string } {
  const d = new Date(r.at);
  const s = Math.round(r.endMs / 1000);
  return {
    result: r.result === "win" ? "승" : r.result === "lose" ? "패" : "무",
    kind: r.mine ? "건 배틀" : "받은 배틀",
    when: `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    length: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
    point: r.reward == null ? "—" : `+${r.reward}P`,
  };
}
