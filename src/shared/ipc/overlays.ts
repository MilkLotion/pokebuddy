// 작은 창(알림 배너·알림 창·메뉴·영역 그리기·화면 덮개)의 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다

import type { AlertView, BannerView, MenuView, RegionInit, RegionRect, ScreenOverlayInit } from "../model/overlays.js";

// region:init 은 메인 → 렌더러, region:done 은 렌더러 → 메인 (null 이면 취소)
export type RegionChannel = "region:init" | "region:done";

export interface RegionBridge {
  onInit: (cb: (init: RegionInit) => void) => void;
  done: (rect: RegionRect | null) => void;
}

// screens:init 은 메인 → 렌더러, screens:pick·screens:cancel 은 렌더러 → 메인
export type ScreensChannel = "screens:init" | "screens:pick" | "screens:cancel";

export interface ScreensBridge {
  onInit: (cb: (init: ScreenOverlayInit) => void) => void;
  pick: () => void; // 이 화면을 골랐다
  cancel: () => void;
}

// banner:show 는 메인 → 렌더러, 나머지는 렌더러 → 메인
export type BannerChannel = "banner:show" | "banner:go" | "banner:close";

export interface BannerBridge {
  onShow: (cb: (banner: BannerView) => void) => void;
  go: (key: string) => void; // `바로가기` 를 눌렀다
  close: (key: string) => void; // 제목 줄 `✕` 를 눌렀다 — 그 배너를 닫고 다음 배너로 간다
}

// menu:show·menu:side 는 메인 → 렌더러, 나머지는 렌더러 → 메인. menu:pick 이 null 이면 닫기만 한다
export type MenuChannel = "menu:show" | "menu:size" | "menu:pick" | "menu:side" | "menu:placed";

export interface MenuBridge {
  onShow: (cb: (items: MenuView[]) => void) => void;
  size: (w: number, h: number, sub?: { w: number; h: number; top: number }) => void; // 그린 뒤의 메뉴 크기 — 메인이 창 크기와 자리를 정한다. sub 는 말풍선의 크기와 메뉴 위 끝에서 잰 자리
  onSide: (cb: (side: "left" | "right") => void) => void; // 말풍선이 뜰 쪽 — 화면 오른쪽에 자리가 없으면 왼쪽
  placed: () => void; // 말풍선 자리를 잡았다 — 메인이 창을 보인다
  pick: (id: number | null) => void;
}

// alert:show 는 메인 → 렌더러, 나머지는 렌더러 → 메인
//   alert:size  내용을 그린 뒤 창에 맞출 크기(px) — 메인이 창 크기를 맞추고 보인다
//   alert:pick  누른 단추 번호. Esc 는 null — 메인이 취소 단추로 본다
export type AlertChannel = "alert:show" | "alert:size" | "alert:pick";

export interface AlertBridge {
  onShow: (cb: (view: AlertView) => void) => void;
  size: (height: number) => void;
  pick: (index: number | null) => void;
}
