// 무대와 선택 창의 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다
// 말풍선 위라는 히트 답은 문자열 "coach" 다 — 마리 id(p숫자)와 겹치지 않는다

import type { CoachAction, CoachView, HitReply, HoverQuery, LookSheets, PickerPayload, PointerMsg, StageFrame, StageInit } from "../model/stage.js";

// 채널 이름 — preload 와 메인이 같은 문자열을 쓰도록 유니언으로 묶는다 (런타임 상수는 양쪽이 각자 satisfies 로 검사)
export type StageChannel =
  | "stage:init" // M→R  StageInit
  | "stage:sheets" // M→R  LookSheets
  | "stage:frame" // M→R  StageFrame
  | "stage:hover" // M→R  HoverQuery
  | "stage:click-through" // M→R  boolean
  | "stage:cry" // M→R  울음소리 { uri: data URI, volume: 0~1 }
  | "stage:icons" // M→R  말풍선 아이콘 { 열쇠: data URI } — 렌더러가 열쇠로 캐시한다
  | "stage:coach" // M→R  CoachView | null
  | "stage:coach-action" // R→M  CoachAction
  | "stage:ready" // R→M  없음
  | "stage:hit" // R→M  HitReply
  | "stage:pointer" // R→M  PointerMsg
  | "stage:log" // R→M  Record<string, unknown> — 렌더러 진단(시트 디코드 실패 등)을 메인 로그로
  | "picker:list" // R→M invoke → PickerPayload
  | "picker:start" // R→M  slug
  | "picker:portraits"; // R→M invoke slug[] → slug 별 data URI (못 받으면 null)

// preload 가 window.pokebuddy 로 내놓는 것 — 무대와 선택 창이 같은 preload 를 쓴다
export interface StageBridge {
  ready(): void;
  onInit(cb: (init: StageInit) => void): void;
  onSheets(cb: (sheets: LookSheets) => void): void;
  onFrame(cb: (frame: StageFrame) => void): void;
  onHover(cb: (q: HoverQuery) => void): void;
  onClickThrough(cb: (on: boolean) => void): void;
  onCry(cb: (uri: string, volume: number) => void): void; // 울음소리 한 번 — 놀아주기가 성공했을 때
  onIcons(cb: (icons: Record<string, string>) => void): void; // 말풍선 아이콘 그림 — 열쇠별 data URI
  onCoach(cb: (coach: CoachView | null) => void): void; // 바탕화면 튜토리얼 — null 이면 지운다
  coachAction(action: CoachAction): void;
  hit(id: HitReply): void;
  pointer(msg: PointerMsg): void;
  log(entry: Record<string, unknown>): void;
  pickerList(): Promise<PickerPayload>;
  pickerStart(slug: string): void;
  pickerPortraits(slugs: string[]): Promise<Record<string, string | null>>; // 선택 창 카드의 초상
}
