// 멈춤·안내 창의 화면 값 — 창마다 제목·본문·단추 글자와 Esc 단추, 알림 창에 보낼 단추 순서. 창은 메인이 띄운다 (src/main/windows/alert-ask.ts)
// 창의 답을 무엇으로 읽을지는 메인이 정한다 (src/main/halt-dialog.ts)
// (예전 src/main/halt-dialog.ts 안에 있었다. 메인 레인 M8-5 에서 화면 값으로 옮겼다)
import type { HaltInfo, OwnerKind } from "../online/cloud-state.js";
import type { AlertView } from "../shared/model/overlays";
import { t } from "./text.js";

// 창 하나의 내용 — 단추 번호가 답이다
export interface AlertSpec {
  type: "info" | "warning" | "question";
  title: string;
  message: string;
  detail: string;
  buttons: string[]; // 0 번이 네이티브 창의 기본 단추
  primary?: number; // 알림 창에서 오른쪽 채움 단추로 보일 번호 — 없으면 0
  cancelId: number; // Esc·창 닫기가 고르는 단추
}

// 상대 PC 이름 — 서버가 준 이름(Mac · Windows PC). 모르면 "다른 PC"
const otherName = (info: HaltInfo): string => info.other?.label || t("cloud.other.unknown");

// 상대가 마지막으로 서버에 닿은 때 — "5분 전"처럼 짧게. 지금 시각은 부르는 쪽이 넘긴다
export function agoText(seen: number | null, now: number): string {
  if (!seen) return t("cloud.ago.unknown");
  const min = Math.floor(Math.max(0, now - seen) / 60_000);
  if (min < 1) return t("cloud.ago.now");
  if (min < 60) return t("cloud.ago.minutes", { n: min });
  const hour = Math.floor(min / 60);
  return hour < 24 ? t("cloud.ago.hours", { n: hour }) : t("cloud.ago.days", { n: Math.floor(hour / 24) });
}

// 알림 창에 보낼 내용 — 단추는 왼쪽 보조 → 오른쪽 주 단추 순서
export function alertViewOf(o: { title: string; message: string; detail: string; buttons: string[]; primary?: number }): AlertView {
  const primary = o.primary ?? 0;
  const order = [...o.buttons.keys()].filter((i) => i !== primary).concat(primary);
  return {
    title: o.title,
    lead: o.message,
    detail: o.detail,
    buttons: order.map((i) => ({ label: o.buttons[i] ?? "", index: i, primary: i === primary })),
  };
}

// 진행·멈춤 창 — 진행 단추가 0 번, 멈춤 단추가 마지막(Esc). 진행이 없으면 단추 하나
function goStop(o: { type: AlertSpec["type"]; title: string; message: string; detail: string; go: string | null; stop: string }): AlertSpec {
  const buttons = o.go ? [o.go, o.stop] : [o.stop];
  return { type: o.type, title: o.title, message: o.message, detail: o.detail, buttons, cancelId: buttons.length - 1 };
}

// 밀려남 안내 — 단추 하나
export function kickedAlert(info: HaltInfo): AlertSpec {
  return goStop({
    type: "info",
    title: t("cloud.kicked.title"),
    message: t("cloud.kicked.message", { other: otherName(info) }),
    detail: t("cloud.kicked.detail"),
    go: null,
    stop: t("cloud.kicked.ok"),
  });
}

// 이용 정지 안내(P4c, D35) — 단추 하나
export function heldAlert(): AlertSpec {
  return goStop({
    type: "warning",
    title: t("cloud.held.title"),
    message: t("cloud.held.message"),
    detail: t("cloud.held.detail"),
    go: null,
    stop: t("cloud.held.ok"),
  });
}

// 업데이트 필요 창 — 0 나중에(Esc), 1 지금 다시 시작·받기(오른쪽 주 단추)
//   ready   [나중에] [지금 다시 시작]
//   manual  [나중에] [받기] — mac 이 앱을 그 자리에서 바꿀 수 없다(dmg 를 연다)
export function updateRequiredAlert(version: string, manual: boolean): AlertSpec {
  return {
    type: "info",
    title: t("update.required.title"),
    message: manual ? t("update.required.manual", { version }) : t("update.required.ready", { version }),
    detail: manual ? "" : t("update.required.ready.detail"),
    buttons: [t("update.required.later"), manual ? t("update.required.get") : t("update.required.restart")],
    primary: 1,
    cancelId: 0,
  };
}

// 연결 끊긴 다른 PC 를 넘겨받을지 묻는다(G2) — 0 여기서 시작, 1 취소
export function confirmAlert(info: HaltInfo, now: number): AlertSpec {
  return goStop({
    type: "warning",
    title: t("cloud.confirm.title"),
    message: t("cloud.confirm.message", { other: otherName(info) }),
    detail: `${t("cloud.confirm.seen", { ago: agoText(info.other?.seen ?? null, now) })}\n${t("cloud.confirm.detail")}`,
    go: t("cloud.confirm.start"),
    stop: t("cloud.confirm.cancel"),
  });
}

// 교환이 걸려 넘겨받지 못했다 — 0 다시 시도, 1 종료
//   CLOUD_TRADE_ACTIVE    상대 PC 에 열린 교환이 있다
//   CLOUD_TRADE_UNSYNCED  상대 PC 가 끝낸 교환을 아직 올리지 않았다
export function blockedAlert(info: HaltInfo): AlertSpec {
  const key = info.code === "CLOUD_TRADE_UNSYNCED" ? "tradeUnsynced" : "tradeActive";
  return goStop({
    type: "warning",
    title: t("cloud.blocked.title"),
    message: t(`cloud.blocked.${key}`, { other: otherName(info) }),
    detail: t(`cloud.blocked.${key}.detail`),
    go: t("cloud.blocked.retry"),
    stop: t("cloud.blocked.quit"),
  });
}

// 저장 잠김 창 — 0 종료(Esc), 1 새로 시작. 새로 시작은 Esc 로 고르지 않는다
export function saveLockedAlert(): AlertSpec {
  return {
    type: "warning",
    title: t("save.locked.title"),
    message: t("save.locked.message"),
    detail: t("save.locked.detail"),
    buttons: [t("save.locked.quit"), t("save.locked.fresh")],
    cancelId: 0,
  };
}

// 분실 창(D29)
//   member     0 로그인(Esc), 1 이 PC 저장으로 계속
//   anonymous  0 이 PC 저장으로 계속(Esc), 1 처음부터.
//              synced(서버에 한 번이라도 올렸다)일 때만 "서버에 둔 익명 저장은 되찾을 수 없어요" 줄을 넣는다(G-c)
export function lostAlert(kind: OwnerKind, synced: boolean): AlertSpec {
  if (kind === "member") {
    return {
      type: "warning",
      title: t("cloud.lost.title"),
      message: t("cloud.lost.member.message"),
      detail: t("cloud.lost.member.detail"),
      buttons: [t("cloud.lost.login"), t("cloud.lost.local")],
      cancelId: 0,
    };
  }
  const detail = [synced ? t("cloud.lost.anonymous.gone") : null, t("cloud.lost.anonymous.fresh"), t("cloud.lost.anonymous.tip")].filter((v): v is string => !!v).join("\n");
  return {
    type: "warning",
    title: t("cloud.lost.title"),
    message: t("cloud.lost.anonymous.message"),
    detail,
    buttons: [t("cloud.lost.local"), t("cloud.lost.fresh")],
    cancelId: 0,
  };
}
