// 랜덤 배틀 상대 고르기의 화면 값 — 서버가 준 칸(종·모습·타입)에 이름과 그림 열쇠를 더한다. 줄은 늘 3개다
// 규칙은 docs/specs/adventure.md "상대 고르기" — 후보가 모자란 줄은 실패 줄(party: null)
import { megaOf } from "../dex/mega.js";
import type { OfferData } from "../online/battle-net.js";
import type { BattleOfferView, BattlePickSlotView } from "../shared/model/battle-net.js";
import { portraitArtKey } from "./device-art.js";
import { tableName } from "./name-table.js";

const ROWS = 3;

// 칸 하나 — 친선 배틀의 양쪽 배틀 파티 줄도 쓴다 (src/view/friendly-battle.ts)
export function slotOf(s: { species: string; form: string | null; types: string[]; shiny?: boolean } | null): BattlePickSlotView | null {
  if (!s) return null;
  const shown = s.form ?? s.species;
  const mega = s.form ? megaOf(s.form) : null;
  return { species: shown, name: mega ? mega.ko : tableName(s.species), portrait: portraitArtKey(shown, s.shiny === true), types: [...s.types] };
}

export function battleOfferView(data: OfferData): BattleOfferView {
  const rows = Array.from({ length: ROWS }, (_, i) => {
    const pick = data.picks[i];
    return { slot: i + 1, party: pick ? pick.party.map(slotOf) : null };
  });
  return { offerId: data.offerId, rows, cooldownMs: data.cooldownMs };
}

// 배틀 창 결과 대화상자의 보상 줄 — Figma 05 `16 배틀` 결과 1791:10820. detail `다음 랜덤 배틀은 5분 뒤에 할 수 있어요.`
// lead 는 오늘의 첫 배틀만 이름을 붙이고, 그 뒤 판은 포인트만 (2026-10-09 사용자 "오늘의 첫 배틀 +500p", "+50p", "+10p")
export function battleRewardText(reward: number): { lead: string; detail: string } {
  return { lead: reward >= 500 ? `오늘의 첫 배틀 +${reward}P` : `+${reward}P`, detail: "다음 랜덤 배틀은 5분 뒤에 할 수 있어요." };
}
