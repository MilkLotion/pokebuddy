// 랜덤 배틀 상대 고르기의 화면 값 — 서버가 준 칸(종·모습·타입)에 이름과 그림 열쇠를 더한다. 줄은 늘 3개다
// 규칙은 docs/specs/adventure.md "상대 고르기" — 후보가 모자란 줄은 실패 줄(party: null)
import { megaOf } from "../dex/mega.js";
import type { OfferData } from "../online/battle-net.js";
import type { BattleOfferView, BattlePickSlotView } from "../shared/model/battle-net.js";
import { portraitArtKey } from "./device-art.js";
import { tableName } from "./name-table.js";

const ROWS = 3;

function slotOf(s: { species: string; form: string | null; types: string[]; shiny?: boolean } | null): BattlePickSlotView | null {
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

// 배틀 창 결과 대화상자의 보상 줄 — Figma 05 `16 배틀` 결과 1791:10820: lead `그날 첫 배틀 +500P`, detail `다음 랜덤 배틀은 5분 뒤에 할 수 있어요.`
// 이긴 판·진 판의 보상 이름은 [스펙 미확정] — `승리 보상`·`참가 보상` 으로 둔다
export function battleRewardText(reward: number, winner: 0 | 1 | null): { lead: string; detail: string } {
  const what = reward >= 500 ? "그날 첫 배틀" : winner === 0 ? "승리 보상" : "참가 보상";
  return { lead: `${what} +${reward}P`, detail: "다음 랜덤 배틀은 5분 뒤에 할 수 있어요." };
}
