// 가방·상점 기기 창의 도구 설명
import type { DexOptions } from "../dex/data.js";
import type { SaveV3 } from "../shared/save-v3";
import type { ItemAbout } from "../shared/model/snapshot";
import { evoItemNote } from "./shop-detail.js";
import { itemTable } from "../dex/tables.js";
import { isEvoItem } from "../bag/items.js";
import { shiftOfItem } from "../dex/forms.js";
import { petName } from "./text.js";

// 도구 설명 — 상점·가방 기기 창이 같이 쓴다. 모르는 도구면 undefined
// 진화용 도구는 가방에서 쓰지 않는다 — 진화는 파티 상세의 진화 줄에서 한다 (2026-10-01 사용자 결정 "진화아이템에는 사용을 없애자").
// 쓰는 곳은 진화 탭 상품 줄과 같은 진화 전 종 이름이다 (2026-10-01 사용자 Figma 수정)
// 모습 도구를 쓰는 곳 — "로토무 · 모습 바꾸기", 한 방향 묶음은 "플라엣테"
export function formWhere(id: string): string {
  const shift = shiftOfItem(id);
  if (!shift) return "모습 바꾸기";
  return shift.oneWay ? petName(shift.base) : `${petName(shift.base)} · 모습 바꾸기`;
}

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
  // 쓰는 곳 — 로토무카탈로그는 로토무의 모습 바꾸기에서 쓴다. 유대의고삐는 가방에서 쓰고 버드렉스가 있어야 한다(말 부르기)
  // 한 방향 모습 도구(영원의 꽃·붉은 달)는 쓰는 종 이름만 — 상점 줄 설명과 같다 (2026-10-08 사용자 결정 "플라엣테, 다투곰 만 적자")
  const where = item.effect === "form" ? formWhere(id) : item.effect === "call-rider" ? "버드렉스 · 말 부르기" : "파티 포켓몬";
  return { group: item.group ?? "도구", desc: item.desc ?? "", effect: item.effectText ?? "", where };
}
