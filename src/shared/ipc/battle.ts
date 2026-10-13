// 배틀 창의 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다
// 배틀 창은 자기 다리(window.pokebuddyBattleScreen)를 쓴다. preload 파일은 다른 창과 같다

import type { BattleLogLine } from "../battle-log.js";
import type { BattleScreenView } from "../model/battle-screen.js";
import type { BridgeOf, Push, Send } from "./kinds.js";

export type BattleScreenIpc = {
  "battlescreen:ready": Send<"ready", []>; // 문서를 읽었다 — 메인이 판을 보낸다
  "battlescreen:show": Push<"onShow", [view: BattleScreenView]>; // 재생할 판
  "battlescreen:loading": Push<"onLoading", [title: string]>; // 판을 받기 전 — 준비 중 모습(제목만). 판이 오면 onShow 가 바꾼다
  "battlescreen:close": Send<"close", []>; // 머리 줄 ✕·Esc
  "battlescreen:log-open": Send<"logOpen", []>; // 판 표시 줄의 노트 단추 — 배틀 로그 창을 연다(열려 있으면 앞으로)
  "battlescreen:log-at": Send<"logAt", [count: number]>; // 재생 시각까지 보일 로그 줄 수 — 바뀔 때만 보낸다
};

export type BattleScreenChannel = keyof BattleScreenIpc;

// preload 가 내놓는 다리 — window.pokebuddyBattleScreen
export type BattleScreenBridge = BridgeOf<BattleScreenIpc>;

// 배틀 로그 창이 받는 값 — 재생 시각까지의 줄. 시각 글자는 판 표시 줄과 같은 남은 시간이라 maxMs 를 같이 준다
export interface BattleLogView {
  maxMs: number;
  lines: BattleLogLine[];
}

// 배틀 로그 창의 IPC 계약 (docs/specs/adventure.md "배틀 로그") — 다리는 window.pokebuddyBattleLog
export type BattleLogIpc = {
  "battlelog:ready": Send<"ready", []>; // 문서를 읽었다 — 메인이 지금까지의 줄을 보낸다
  "battlelog:show": Push<"onShow", [view: BattleLogView]>; // 보일 줄 전부. 줄이 늘거나 새 판이 오면 다시 보낸다
  "battlelog:close": Send<"close", []>; // 머리 줄 ✕·Esc
};

export type BattleLogChannel = keyof BattleLogIpc;
export type BattleLogBridge = BridgeOf<BattleLogIpc>;
