// [임시] 도구의 화면 이름 — 도구 레인 T7a 의 src/view/names.ts 가 생기면 거기 itemName 으로 합친다 (설계 30번 3.9절)
import type { DexOptions } from "../dex/data.js";
import { toolName } from "../shop/catalog.js";

// 도구 하나의 이름 — 가방이 모르는 식별자를 만나도 화면이 비지 않게
export const nameOfItem = (id: string, opts?: DexOptions): string => toolName(id, opts) ?? id;
