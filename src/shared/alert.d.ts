// 알림 창 계약 — OS 대화상자 대신 띄우는 멈춤·분실·저장 잠김·정지·업데이트 창
// 메인 src/main/alert-window.ts, 렌더러 src/renderer/alert.ts, preload src/main/preload.ts. 설계는 worklog/records/alert-window/record.md

// buttons 는 보이는 순서(왼쪽 보조 → 오른쪽 주 단추)다. index 는 부른 쪽의 단추 번호다
export interface AlertView {
  title: string;
  lead: string; // 강조 줄
  detail: string; // 설명 — 줄바꿈을 그대로 보인다. 비면 줄을 숨긴다
  buttons: { label: string; index: number; primary: boolean }[];
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
