// 가방의 도구 넣기 — 가방 상한(999)은 구매에만 있다. 상점은 사기 전에 bagRoomOf 로 본다.
// 줍기·업적 보상·우편처럼 사지 않고 받는 것은 막지 않는다 (2026-09-27 사용자 "구매는 … 999개로 제한", docs/specs/balance.md "가방 구매 상한")
import { loadJson, type DexOptions } from "../dex/data.js";
import { evoItemTable } from "../dex/tables.js";
import type { SaveV3 } from "../shared/save-v3";
import { BAG_RULES } from "./rules.js";

// 이 도구를 가방에 더 넣을 수 있는 수 — 가방 상한(BAG_RULES.max)까지
export const bagRoomOf = (save: Pick<SaveV3, "bag">, id: string): number => Math.max(0, BAG_RULES.max - (save.bag[id] ?? 0));

// 도구를 가방에 넣는다
export function addItem(save: Pick<SaveV3, "bag">, id: string, count: number): void {
  save.bag[id] = (save.bag[id] ?? 0) + count;
}

// 가방 도구 표(data/items.json)의 한 줄 — 효과와 수치. 쓰기(./use.ts)·화면 값·명령이 같이 읽는다 (96 대조 ③)
// form — 모습 바꾸기에 쓰는 도구(로토무카탈로그). 가방에서 쓰지 않고 모습 바꾸기가 하나씩 쓴다 (src/dex/forms.ts setForm)
// call-rider — 버드렉스의 말을 부르는 도구(유대의고삐). 가방에서 쓰지 않고 버드렉스의 파티 상세 `말 부르기` 가 하나씩 쓴다 (src/party/riders.ts callRider)
export type ItemEffect = "fullness" | "fullness-full-buff" | "play-buff" | "exp" | "level" | "nature" | "shiny-on" | "shiny-off" | "form" | "call-rider";

// 모습 도구인가 — 로토무카탈로그(form)와 유대의고삐(call-rider). 진화 분류에 두고, 가방에서 쓰지 않고, 줍기로 얻지 않는다
export const isFormTool = (effect: ItemEffect | string | undefined): boolean => effect === "form" || effect === "call-rider";

export interface ItemEntry {
  ko: string;
  // 원작 첫 등장 세대 — 진화 분류에 두는 도구(로토무카탈로그)만 쓴다
  gen?: number;
  price: number | null;
  effect: ItemEffect;
  amount: number;
}

const items = (opts?: DexOptions): Record<string, ItemEntry> => loadJson<Record<string, ItemEntry>>("items.json", opts);

export const itemOf = (id: string, opts?: DexOptions): ItemEntry | null => (id.startsWith("_") ? null : items(opts)[id] ?? null);

// 진화용 도구인가 — data/evo-items.json 에 있으면 그렇다
export const isEvoItem = (id: string, opts?: DexOptions): boolean => evoItemTable(opts)[id] != null;

// 상점·가방의 `진화` 분류에 두는가 — 진화용 도구와 모습 도구(로토무카탈로그·유대의고삐)
// (2026-10-05 사용자 결정 "카탈로구는 진화로 옮기고", 2026-10-07 "아이템은 진화에 추가하고")
export const inEvoCategory = (id: string, opts?: DexOptions): boolean => isEvoItem(id, opts) || isFormTool(itemOf(id, opts)?.effect);

// 원작 첫 등장 세대 — 우리 도구(빈 기술머신·연결의끈·지도)는 0
const itemGen = (id: string, opts?: DexOptions): number => evoItemTable(opts)[id]?.gen ?? itemOf(id, opts)?.gen ?? 0;

// `진화` 분류의 순서 — 우리 도구(빈 기술머신·연결의끈·지도)가 맨 위, 그 아래 원작 세대 오래된 순, 같은 세대는 가나다순
// 상점 진화 탭과 가방 진화 탭이 같이 쓴다 (2026-10-05 사용자 결정 "옛날아이템이 위로", "가나다순으로", "원작에 없음 … 가장위로", "빈기술머신-연결의끈-지도 순서")
export const evoOrder = (a: { id: string; name: string }, b: { id: string; name: string }, opts?: DexOptions): number =>
  itemGen(a.id, opts) - itemGen(b.id, opts) || a.name.localeCompare(b.name, "ko");
