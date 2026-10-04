// 무대 창의 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다. 선택 창은 ./picker.ts
// 말풍선 위라는 히트 답은 문자열 "coach" 다 — 마리 id(p숫자)와 겹치지 않는다

import type { CoachAction, CoachView, HitReply, HoverQuery, LookSheets, PointerMsg, StageFrame, StageInit } from "../model/stage.js";
import type { BridgeOf, Push, Send } from "./kinds.js";

// 무대 창
export type StageIpc = {
  "stage:init": Push<"onInit", [init: StageInit]>;
  "stage:sheets": Push<"onSheets", [sheets: LookSheets]>;
  "stage:frame": Push<"onFrame", [frame: StageFrame]>;
  "stage:hover": Push<"onHover", [q: HoverQuery]>;
  "stage:click-through": Push<"onClickThrough", [on: boolean]>;
  "stage:cry": Push<"onCry", [cry: { uri: string; volume: number }]>; // 울음소리 한 번 — 놀아주기가 성공했을 때. uri 는 data URI, volume 은 0~1
  "stage:icons": Push<"onIcons", [icons: Record<string, string>]>; // 말풍선 아이콘 그림 — 열쇠별 data URI. 렌더러가 열쇠로 캐시한다
  "stage:coach": Push<"onCoach", [coach: CoachView | null]>; // 바탕화면 튜토리얼 — null 이면 지운다
  "stage:coach-action": Send<"coachAction", [action: CoachAction]>;
  "stage:ready": Send<"ready", []>;
  "stage:hit": Send<"hit", [id: HitReply]>;
  "stage:pointer": Send<"pointer", [msg: PointerMsg]>;
  "stage:log": Send<"log", [entry: Record<string, unknown>]>; // 렌더러 진단(시트 디코드 실패 등)을 메인 로그로
};

// 채널 이름 — preload 와 메인이 같은 문자열을 쓰도록 계약의 열쇠로 묶는다
export type StageChannel = keyof StageIpc;

// preload 가 내놓는 다리 — window.pokebuddy
export type StageBridge = BridgeOf<StageIpc>;
