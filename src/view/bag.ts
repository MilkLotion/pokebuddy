// 가방·상점 기기 창의 도구 설명
import type { DexOptions } from "../dex/data.js";
import type { SaveV3 } from "../shared/save-v3";
import type { ItemAbout } from "../shared/model/snapshot";
import { evoItemNote } from "./shop-detail.js";
import { itemTable, evoItemTable } from "../dex/tables.js";

// 진화용 도구인가 — data/evo-items.json 에 있으면 그렇다
export const isEvoItem = (id: string, opts?: DexOptions): boolean => evoItemTable(opts)[id] != null;

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
  return { group: item.group ?? "도구", desc: item.desc ?? "", effect: item.effectText ?? "", where: "파티 포켓몬" };
}
