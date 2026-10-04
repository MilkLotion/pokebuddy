// 성공한 명령의 결과 줄 — 가방 사용·상점 구매 뒤 기기 창의 초록 상자에 보이는 두 줄 { lead, line }.
// 거래 앞뒤 화면 값(스냅샷)을 견준다. 설정창의 명령 처리기(src/main/manage/window.ts)가 성공 답에 붙인다.
// 결과 줄이 없는 명령은 null 이다(가방 판매는 결과 상자를 쓰지 않는다 — 판매 쪽은 받는 포인트가 미리보기에 있다)
import type { ResultLine } from "../shared/model/devices.js";
import type { BagItemView, PetView, Snapshot } from "../shared/model/snapshot.js";
import { josa } from "../shared/josa.js";
import { numberText, pointText, waitText } from "../shared/count-text.js";

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

// 명령의 수량 — 없으면 1
const countOf = (args: unknown): number => (isObj(args) && typeof args.count === "number" && args.count > 0 ? args.count : 1);

// 스냅샷의 개체 하나 — 파티 칸 먼저, 그다음 박스. 파티 상세 기기 창(./device-pet.ts)도 같은 찾기를 쓴다 (94 항목 9-5-5)
export const snapshotPet = (v: Snapshot, id: string): PetView | null =>
  v.party.slots.find((s) => s.pet?.id === id)?.pet ?? v.boxes.flatMap((b) => b.slots).find((p): p is PetView => p?.id === id) ?? null;

// 쓴 뒤 첫 줄 — 쓰기 전 값(before)과 쓴 뒤 값(after)을 견준다.
// 진화용 도구·성격민트는 따로 창 흐름이 있어 여기 오지 않는다(민트는 바꾼 뒤 개체 상세로 간다)
function usedLead(item: BagItemView, before: PetView, after: PetView | null): string {
  const name = before.name;
  const used = `${name}에게 ${item.name}${josa(item.name, "을/를")} 썼어요`;
  if (!after) return used;
  const buffWord = (kind: string): string => {
    const hit = after.buffs.find((b) => b.kind === kind);
    return hit ? ` · ${hit.name} ${waitText(hit.remainMin * 60)}` : "";
  };
  const fullness = `${name} 만복도 ${Math.round(before.fullness)} → ${Math.round(after.fullness)}`;
  switch (item.effect) {
    case "exp":
    case "level":
      return after.level !== before.level ? `${name} Lv.${before.level} → Lv.${after.level}` : `${name} 경험치 +${numberText(Math.max(0, after.exp - before.exp))}`;
    case "fullness":
      return fullness;
    case "fullness-full-buff":
      return `${fullness}${buffWord("premium-food")}`;
    case "play-buff":
      return `${name}에게 ${item.name}${josa(item.name, "을/를")} 줬어요${buffWord("long-play")}`;
    case "shiny-on":
    case "shiny-off":
      return `${name}의 모습이 바뀌었어요`;
    default:
      return used;
  }
}

// cmd·target·args 는 설정창이 보낸 요청 그대로다. before·after 는 거래 앞뒤의 화면 값이다
export function resultLineOf(req: { cmd: string; target?: string; args?: unknown }, before: Snapshot, after: Snapshot): ResultLine | null {
  const count = countOf(req.args);
  if (req.cmd === "bag.use") {
    const item = before.bag.find((i) => i.id === req.target);
    const petId = isObj(req.args) && typeof req.args.petId === "string" ? req.args.petId : null;
    const pet = petId ? snapshotPet(before, petId) : null;
    if (!item || !pet) return null;
    return { lead: usedLead(item, pet, snapshotPet(after, pet.id)), line: `${item.name} ${numberText(count)}개를 썼어요` };
  }
  if (req.cmd === "shop.buy") {
    const item = before.shop.find((i) => i.id === req.target);
    if (!item) return null;
    // 산 결과 — 기기 창은 닫지 않고 합계 상자를 초록 결과로 바꾼다 (2026-10-02 사용자 결정, Figma 05 `Shop / Device / Egg · 구매 결과`)
    return {
      lead: `${item.name} ${numberText(count)}개를 ${item.price === 0 ? "받았어요" : "샀어요"}`,
      line: `보유 ${pointText(after.points)}${item.category === "egg" ? ` · 돌보미집 ${after.eggs.used} / ${after.eggs.size}` : ""}`,
    };
  }
  return null;
}
