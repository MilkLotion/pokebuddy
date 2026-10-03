// 상점 기기 창 모델 — 고른 상품의 설명과 구매 조작 칸 (Figma 05 `Shop / Device / Tool`·`Egg`·`Evolution`).
// 지금은 설정창(src/renderer/manage/manage.ts shopDeviceModel)이 같은 모델을 만든다 — 기기 창 모델을 메인으로 옮기는 단계(D10b)에서 이 함수로 바꾼다.
// 살 수 있는 개수는 포인트만큼이고, 도구는 가방에 더 담을 수 있는 만큼(최대 999)까지다 (2026-09-27 사용자 결정). 0P 상품은 하나씩 받는다.
// 알은 돌보미집 빈 칸과 단일 포켓몬 알의 남은 수까지다 — 스냅샷의 room (src/view/shop-list.ts)
import type { ShopDeviceOpen } from "../shared/model/devices.js";
import type { EggPoolView, ShopItemView, Snapshot } from "../shared/model/snapshot.js";
import { eggArtKey, itemArtKey, portraitArtKey, type DeviceResult } from "./device-art.js";
import { numberText, pointText } from "../shared/count-text.js";

// 고른 값 — 설정창이 든다
export interface ShopDeviceInput {
  productId: string;
  qty: number;
  notice: string; // 마지막 구매 실패 — 합계 상자가 빨강
  done: { lead: string; line: string } | null; // 방금 산 결과 — 합계 상자가 초록
  busy: boolean; // 0.3초 넘게 답이 없다 — 구매 단추가 점 세 개
}

// 여러 개 살 수 있는 상품 — 포켓몬·파티 칸은 하나씩만 산다. 알은 돌보미집 빈 칸까지 (2026-09-30 사용자 결정 "알 여러개 구매 가능하게 수정.")
export const MULTI_BUY: ReadonlySet<string> = new Set(["tool", "evolution", "egg"]);

// 제목 줄의 분류 글자 — 상점 분류 칩(SHOP_TABS)의 이름과 같다. slot 은 파티 칸·파티 프리셋·박스를 담는다 (2026-10-03 사용자 결정)
const SHOP_KIND: Record<string, string> = { egg: "알", tool: "도구", evolution: "진화", slot: "파티", pokemon: "포켓몬" };

// `나오는 포켓몬` 줄의 값 — 단일 포켓몬 알은 남은 종 수, 태고의돌은 얻은 종 수
export function poolCount(pool: EggPoolView): string {
  const total = pool.entries.length;
  const got = pool.entries.filter((e) => e.obtained).length;
  return pool.single ? `${total}종 중 ${total - got}종 남음` : `${total}종 중 ${got}종 얻음`;
}

// 상품 그림 — 알은 색을 바꾼 알 그림, 도구·진화용 도구는 도구 그림, 포켓몬은 초상, 파티 칸은 빈 칸
function shopArt(item: ShopItemView): string | null {
  if (item.category === "slot") return null;
  if (item.category === "pokemon") return portraitArtKey(item.id, false);
  if (item.category === "egg" && item.id !== "ancient-stone") return eggArtKey(item.id);
  return itemArtKey(item.id);
}

// 고른 상품이 상점에 없으면 null(기기 창을 닫는다)
export function shopDeviceModel(v: Snapshot, given: ShopDeviceInput): DeviceResult<ShopDeviceOpen, ShopDeviceInput> | null {
  const item = v.shop.find((i) => i.id === given.productId);
  if (!item) return null;
  const input = { ...given };
  const afford = item.price > 0 ? Math.floor(v.points / item.price) : 1;
  // 살 수 없으면 상한 0 — 수량 줄은 그대로 두고 단추만 막는다 (2026-10-02 사용자 결정, Figma 05 `Shop / Device / Egg · 돌보미집 가득`)
  const cap = item.blocked ? 0 : Math.max(1, Math.min(afford, item.room ?? afford));
  const many = MULTI_BUY.has(item.category);
  const count = many ? Math.max(1, Math.min(input.qty, cap)) : 1;
  input.qty = count;
  const total = item.price * count;
  const short = total > v.points;
  const egg = item.category === "egg";
  const eggFree = Math.max(0, v.eggs.size - v.eggs.used);
  // 수량 상한의 까닭 — 가장 작은 상한 하나 (Figma 05 `Shop / Device / Tool` "최대 311 · 포인트", `… / Egg` "최대 3 · 빈 칸 3")
  const why = (): string => {
    if (afford < (item.room ?? afford)) return "포인트";
    if (!egg) return "가방 자리";
    if ((item.room ?? eggFree) < eggFree) return `남은 포켓몬 ${numberText(item.room ?? 0)}`;
    return `빈 칸 ${numberText(eggFree)}`;
  };

  // 합계 상자 — 실패는 빨강 `사지 못했어요`, 산 직후는 초록 결과(새 줄을 끼우지 않는다, 2026-09-30).
  // 막혔으면 문구를 바꾸지 않고 합계와 보유만 보인다 — 까닭은 머리의 상태 글자와 수량 안내에 있다
  let lead: string;
  let line = "";
  if (input.notice) {
    lead = "사지 못했어요";
    line = input.notice;
  } else if (input.done) {
    lead = input.done.lead;
    line = input.done.line;
  } else if (item.blocked) {
    lead = `합계 ${pointText(item.price)}`;
    line = `보유 ${pointText(v.points)}${egg ? ` · 돌보미집 ${v.eggs.used} / ${v.eggs.size}` : ""}`;
  } else if (short) {
    lead = "포인트가 모자라요";
    line = `합계 ${pointText(total)} · 보유 ${pointText(v.points)}`;
  } else {
    lead = `합계 ${pointText(total)}`;
    line = `구매 후 보유 ${pointText(v.points - total)}${egg ? ` · 돌보미집 ${v.eggs.used + count} / ${v.eggs.size}` : ""}`;
  }

  // 포켓몬 상품은 설명 데이터가 없다(포켓몬 탭은 숨김) — 효과·쓰는 곳만 둔다
  const about = item.about;
  return {
    input,
    model: {
      productId: item.id,
      kind: SHOP_KIND[item.category] ?? "",
      name: item.name,
      state: item.blocked ?? (short ? "포인트 부족" : "살 수 있음"),
      group: about?.group ?? "",
      art: shopArt(item),
      spec: about ? [["가격", pointText(item.price)], about.spec] : [["가격", pointText(item.price)]],
      desc: about?.desc ?? item.note,
      rows: about ? [["효과", about.effect], ["쓰는 곳", about.where]] : [["효과", "포켓몬 1마리"], ["쓰는 곳", "빈 파티 칸 · 없으면 박스"]],
      link: item.pool ? { label: "나오는 포켓몬", value: poolCount(item.pool) } : null,
      qty: many ? { count, cap, hint: `최대 ${numberText(cap)} · ${why()}` } : null,
      total: { lead, line, tone: input.notice ? "bad" : input.done ? "ok" : "" },
      buy: { label: item.price === 0 ? "받기" : "구매", disabled: !!item.blocked || short, busy: input.busy },
    },
  };
}
