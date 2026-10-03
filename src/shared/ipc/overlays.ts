// 작은 창(알림 배너·알림 창·메뉴·영역 그리기·화면 덮개)의 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다

import type { Rect } from "../geometry.js";
import type { AlertView, BannerView, MenuView, RegionInit, ScreenOverlayInit } from "../model/overlays.js";
import type { BridgeOf, Push, Send } from "./kinds.js";

// 놀이공간 영역 그리기 창
export type RegionIpc = {
  "region:init": Push<"onInit", [init: RegionInit]>;
  "region:done": Send<"done", [rect: Rect | null]>; // null 이면 취소
};
export type RegionChannel = keyof RegionIpc;
export type RegionBridge = BridgeOf<RegionIpc>;

// 놀이공간 화면 번호 덮개 창
export type ScreensIpc = {
  "screens:init": Push<"onInit", [init: ScreenOverlayInit]>;
  "screens:pick": Send<"pick", []>; // 이 화면을 골랐다
  "screens:cancel": Send<"cancel", []>;
};
export type ScreensChannel = keyof ScreensIpc;
export type ScreensBridge = BridgeOf<ScreensIpc>;

// 알림 배너 창
export type BannerIpc = {
  "banner:show": Push<"onShow", [banner: BannerView]>;
  "banner:go": Send<"go", [key: string]>; // `바로가기` 를 눌렀다
  "banner:close": Send<"close", [key: string]>; // 제목 줄 `✕` 를 눌렀다 — 그 배너를 닫고 다음 배너로 간다
};
export type BannerChannel = keyof BannerIpc;
export type BannerBridge = BridgeOf<BannerIpc>;

// 앱이 그리는 메뉴 창
export type MenuIpc = {
  "menu:show": Push<"onShow", [items: MenuView[]]>;
  "menu:size": Send<"size", [w: number, h: number, sub?: { w: number; h: number; top: number }]>; // 그린 뒤의 메뉴 크기 — 메인이 창 크기와 자리를 정한다. sub 는 말풍선의 크기와 메뉴 위 끝에서 잰 자리
  "menu:side": Push<"onSide", [side: "left" | "right"]>; // 말풍선이 뜰 쪽 — 화면 오른쪽에 자리가 없으면 왼쪽
  "menu:placed": Send<"placed", []>; // 말풍선 자리를 잡았다 — 메인이 창을 보인다
  "menu:pick": Send<"pick", [id: number | null]>; // null 이면 닫기만 한다
};
export type MenuChannel = keyof MenuIpc;
export type MenuBridge = BridgeOf<MenuIpc>;

// 알림 창
export type AlertIpc = {
  "alert:show": Push<"onShow", [view: AlertView]>;
  "alert:size": Send<"size", [height: number]>; // 내용을 그린 뒤 창에 맞출 크기(px) — 메인이 창 크기를 맞추고 보인다
  "alert:pick": Send<"pick", [index: number | null]>; // 누른 단추 번호. Esc 는 null — 메인이 취소 단추로 본다
};
export type AlertChannel = keyof AlertIpc;
export type AlertBridge = BridgeOf<AlertIpc>;
