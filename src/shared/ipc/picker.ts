// 첫 실행 선택 창의 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다
// 선택 창은 자기 다리(window.pokebuddyPicker)를 쓴다. preload 파일은 무대와 같다

import type { PickerPayload } from "../model/stage.js";
import type { BridgeOf, Invoke, Send } from "./kinds.js";

export type PickerIpc = {
  "picker:list": Invoke<"list", [], PickerPayload>;
  "picker:start": Send<"start", [slug: string]>;
  "picker:portraits": Invoke<"portraits", [slugs: string[]], Record<string, string | null>>; // 선택 창 카드의 초상 — slug 별 data URI (못 받으면 null)
};

// 채널 이름 — preload 와 메인이 같은 문자열을 쓰도록 계약의 열쇠로 묶는다
export type PickerChannel = keyof PickerIpc;

// preload 가 내놓는 다리 — window.pokebuddyPicker
export type PickerBridge = BridgeOf<PickerIpc>;
