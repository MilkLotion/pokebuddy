// 배틀 창의 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다
// 배틀 창은 자기 다리(window.pokebuddyBattleScreen)를 쓴다. preload 파일은 다른 창과 같다

import type { BattleScreenView } from "../model/battle-screen.js";
import type { BridgeOf, Push, Send } from "./kinds.js";

export type BattleScreenIpc = {
  "battlescreen:ready": Send<"ready", []>; // 문서를 읽었다 — 메인이 판을 보낸다
  "battlescreen:show": Push<"onShow", [view: BattleScreenView]>; // 재생할 판
  "battlescreen:loading": Push<"onLoading", [title: string]>; // 판을 받기 전 — 준비 중 모습(제목만). 판이 오면 onShow 가 바꾼다
  "battlescreen:close": Send<"close", []>; // 머리 줄 ✕·Esc
};

export type BattleScreenChannel = keyof BattleScreenIpc;

// preload 가 내놓는 다리 — window.pokebuddyBattleScreen
export type BattleScreenBridge = BridgeOf<BattleScreenIpc>;
