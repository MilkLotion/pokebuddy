// 가방·상점 기기 창의 도구 설명
import type { DexOptions } from "../dex/data.js";
import type { SaveV3 } from "../shared/save-v3";
import type { ItemAbout } from "../shared/model/snapshot";
import { evoItemNote } from "./shop-detail.js";
import { itemTable } from "../dex/tables.js";
import { isEvoItem } from "../bag/items.js";

// 도구 설명 — 상점·가방 기기 창이 같이 쓴다. 모르는 도구면 undefined
// 진화용 도구는 가방에서 쓰지 않는다 — 진화는 파티 상세의 진화 줄에서 한다 (2026-10-01 사용자 결정 "진화아이템에는 사용을 없애자").
// 쓰는 곳은 진화 탭 상품 줄과 같은 진화 전 종 이름이다 (2026-10-01 사용자 Figma 수정)
export function itemAbout(save: SaveV3, id: string, opts?: DexOptions): ItemAbout | undefined {
  if (isEvoItem(id, opts))
    return {
      group: "진화용 도구",
      desc: "정해진 포켓몬을 진화시키는 도구다. 진화는 파티 상세의 진화 줄에서 한다.",
      effect: "바로 진화 · 1개 소모",
      where: evoItemNote(save, id, opts),
    };
  const item = itemTable(opts)[id];
  if (!item) return undefined;
  // 모습 도구는 가방에서 쓰지 않는다 — 로토무카탈로그는 로토무의 모습 바꾸기, 유대의고삐는 버드렉스의 말 부르기에서 쓴다
  const where = item.effect === "form" ? "로토무 · 모습 바꾸기" : item.effect === "call-rider" ? "버드렉스 · 말 부르기" : "파티 포켓몬";
  return { group: item.group ?? "도구", desc: item.desc ?? "", effect: item.effectText ?? "", where };
}
