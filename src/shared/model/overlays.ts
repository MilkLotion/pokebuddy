// 화면 모델 — 작은 창(알림 배너·알림 창·메뉴·영역 그리기·화면 덮개)이 받는 값. 타입만 둔다

import type { ManageRoute } from "./route.js";
import type { BannerKind } from "../names/banners.js";
import type { Rect } from "../geometry.js";
import type { ScreenRefV3 } from "../save-v3.js";

// 놀이공간 영역 그리기 창 — Figma `Playground / Region Draw` `396:8541`. 좌표는 창 안 좌표(DIP)다
export type RegionRect = Rect; // 원본은 ../geometry.ts

export interface RegionInit {
  current: Rect | null; // 지금 영역 (이 화면과 겹칠 때만)
  min: { area: number; side: number }; // 최소 넓이와 한 변 — 이보다 작으면 적용할 수 없다 (src/state/settings.ts REGION_MIN)
}

// ── 놀이공간 화면 고르기 (2026-09-28 여러 화면) ────────────────────────────────
// 설정의 한 화면 목록 한 줄. ref 를 그대로 `playScreen` 설정 값으로 보낸다
export interface ScreenView {
  number: number; // 화면 번호 — 주 화면이 1 (src/main/windows/screens.ts screenOrder)
  primary: boolean;
  w: number;
  h: number;
  current: boolean; // 한 화면 방식이 지금 쓰는 화면
  ref: ScreenRefV3;
}

// 화면 덮개 창 하나 — 번호를 크게 보인다. pick 이면 눌러서 고른다(Esc 취소), 아니면 클릭을 통과시키고 보기만 한다
export interface ScreenOverlayInit {
  number: number;
  primary: boolean;
  w: number;
  h: number;
  pick: boolean;
}

// 알림 배너 창 — 배너 하나의 문구와 `바로가기` 목적지. 문구는 src/view/banner.ts 가 만든다. 종류의 목록은 ../names/banners.ts
export interface BannerView {
  key: string;
  kind: BannerKind;
  title: string; // 부화 준비 완료 · 진화 가능 · 업적 달성 · 줍기
  target: string; // 돌보미집 알 N · <이름> Lv.N · 업적 이름 · <이름>이 <것>을 주웠어요
  go: string; // 바로가기
  route?: ManageRoute; // 없으면 `바로가기` 를 두지 않는다 — 도구·진화용 도구·포인트 줍기 (docs/specs/game.md "줍기")
  chime?: number; // 알림음 음량 0~1. 0 이면 소리를 내지 않는다 (src/state/settings.ts gainOf)
}

// 앱이 그리는 메뉴 창 — Figma `Context Menu` `338:738`. 메인이 메뉴 모델을 이 모양으로 바꿔 보낸다
export type MenuView =
  | { kind: "separator" }
  | { kind: "status"; title: string; caption?: string } // 맨 위 이름·상태 두 줄 — 누를 수 없다
  | { kind: "item"; id: number; label: string; disabled: boolean; hint?: string; sub?: MenuSubView }; // hint 는 오른쪽의 짧은 글 — 체크 항목의 `켜짐`

// 항목 옆에 붙어 뜨는 말풍선 — 항목을 눌러도 메뉴는 닫히지 않는다 (포켓몬 메뉴의 `모습 바꾸기`, Figma 05 `501:14010`)
// 줄의 id 는 menu:pick 으로 돌려보내는 번호다. icon 은 그림의 data URI
export interface MenuSubView {
  title: string;
  rows: { id: number; label: string; note: string; current: boolean; icon?: string }[];
}

// 알림 창 — OS 대화상자 대신 띄우는 멈춤·분실·저장 잠김·정지·업데이트 창
// 메인 src/main/alert-window.ts, 렌더러 src/renderer/alert.ts. 설계는 worklog/records/alert-window/alert-window.md
// buttons 는 보이는 순서(왼쪽 보조 → 오른쪽 주 단추)다. index 는 부른 쪽의 단추 번호다
export interface AlertView {
  title: string;
  lead: string; // 강조 줄
  detail: string; // 설명 — 줄바꿈을 그대로 보인다. 비면 줄을 숨긴다
  buttons: { label: string; index: number; primary: boolean }[];
}
