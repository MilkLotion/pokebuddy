// 두 PC 규칙의 멈춤 창 — 밀려남 안내·넘겨받기 확인·넘겨받기 막힘 (worklog-mac/records/cloud-authority/design-p1.md 3·5절)
// 저장 계정 분실 창(D29) — 게임은 멈추지 않는다 (worklog-mac/records/cloud-authority/design-p2.md 5절·15절 G-a·G-c)
// 저장 잠김 창 — 저장 키를 쓰지 못해 암호화 저장을 열 수 없다 (worklog/records/cloud-authority/record.md "P3 로컬 암호화")
// 이용 정지 창 — 서버가 계정을 정지했다 (같은 기록 "P4c")
// 업데이트 필요 창 — 서버가 이 앱 버전을 거절했고 새 버전이 준비됐다 (worklog/records/app-update/record.md)
// 앱이 게임을 멈춘 뒤 띄운다. 창의 답을 받아 무엇을 할지는 앱(src/main/app.ts)이 정한다.
//
// 게임 디자인의 알림 창(src/main/windows/alert-window.ts)으로 먼저 띄운다 — 2026-10-01 사용자 "그것들은 디자인 못바꿔?" → "진행"
// (worklog/records/alert-window/record.md). 알림 창을 띄우지 못하면 아래 Electron 네이티브 대화상자로 띄운다.
// 네이티브는 작은 투명 부모 창을 하나 만들어 붙인다
//   - mac 은 부모 없는 대화상자가 동기로 돌아 메인을 멈추고, signal(자동 닫힘·밀려남으로 닫기)이 먹지 않는다 (electron.d.ts MessageBoxOptions.signal)
//   - 무대 창·배너가 항상 위에 떠 있다 — 부모를 그보다 위 층(screen-saver)에 둬서 가리지 않게 한다 (src/main/windows/region-window.ts 와 같은 층)
import { app, dialog, type BrowserWindow } from "electron";
import type { HaltInfo, OwnerKind } from "../online/cloud-state.js";
import type { AlertView } from "../shared/model/overlays";
import { showAlert } from "./windows/alert-window";
import { preloadFile, rendererFile } from "./paths";
import { t } from "./text";
import { primaryWorkArea } from "./windows/display";
import { createOverlayWindow } from "./windows/options";
import { centerSpotOf } from "./windows/placement";

// 밀려남 안내가 저절로 닫히는 시간 — 자리에 없는 PC 도 종료까지 간다
export const KICKED_CLOSE_MS = 30_000;

// 창의 답 — go 는 넘겨받기·다시 시도, stop 은 취소·종료, closed 는 밖에서 닫았다(시간 초과·밀려남)
export type HaltAnswer = "go" | "stop" | "closed";

// 상대 PC 이름 — 서버가 준 이름(Mac · Windows PC). 모르면 "다른 PC"
const otherName = (info: HaltInfo): string => info.other?.label || t("cloud.other.unknown");

// 상대가 마지막으로 서버에 닿은 때 — "5분 전"처럼 짧게
export function agoText(seen: number | null, now = Date.now()): string {
  if (!seen) return t("cloud.ago.unknown");
  const min = Math.floor(Math.max(0, now - seen) / 60_000);
  if (min < 1) return t("cloud.ago.now");
  if (min < 60) return t("cloud.ago.minutes", { n: min });
  const hour = Math.floor(min / 60);
  return hour < 24 ? t("cloud.ago.hours", { n: hour }) : t("cloud.ago.days", { n: Math.floor(hour / 24) });
}

// 대화상자를 붙일 부모 창 — 주 화면 가운데, 투명, 작업 표시줄에 없음. 창을 닫으면 부순다
function parentWindow(): BrowserWindow {
  const size = { width: 480, height: 240 };
  // 문서를 읽지 않는 창이다(preload: null) — 보안 옵션만 다른 창과 같게 둔다. 아이콘은 붙이지 않는다
  const win = createOverlayWindow({ preload: null, layer: "screen-saver", bounds: { ...centerSpotOf(primaryWorkArea(), size), ...size }, icon: false });
  // Dock 을 숨긴 mac 앱은 앞으로 나오지 않는다 — 창을 보기 전에 앱을 앞으로 가져온다
  if (process.platform === "darwin") app.focus({ steal: true });
  win.show();
  return win;
}

interface AskOptions {
  type: "info" | "warning" | "question";
  title: string;
  message: string;
  detail: string;
  go: string | null; // 진행 단추 글자. 없으면 단추 하나(stop)
  stop: string;
  timeoutMs?: number; // 지나면 closed
  signal?: AbortSignal; // 밖에서 닫는다 — closed
}

interface PickOptions {
  type: "info" | "warning" | "question";
  title: string;
  message: string;
  detail: string;
  buttons: string[]; // 0 번이 네이티브 창의 기본 단추
  primary?: number; // 알림 창에서 오른쪽 채움 단추로 보일 번호 — 없으면 0
  cancelId: number; // Esc·창 닫기가 고르는 단추
  timeoutMs?: number; // 지나면 closed
  signal?: AbortSignal; // 밖에서 닫는다 — closed
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

// 단추를 고르게 한다 — 고른 단추 번호. 밖에서 닫았으면 closed, 띄우지 못했으면 cancelId
async function pick(o: PickOptions): Promise<number | "closed"> {
  const started = Date.now();
  const viaAlert = await showAlert({
    preload: preloadFile(),
    html: rendererFile("alert.html"),
    view: alertViewOf(o),
    cancelId: o.cancelId,
    ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
    ...(o.signal ? { signal: o.signal } : {}),
  });
  if (viaAlert !== null) return viaAlert;
  // 알림 창을 띄우지 못했다 — 남은 시간만큼 네이티브 창으로
  const left = o.timeoutMs ? Math.max(1, o.timeoutMs - (Date.now() - started)) : 0;
  return pickNative({ ...o, ...(o.timeoutMs ? { timeoutMs: left } : {}) });
}

// 네이티브 대화상자 — 알림 창의 대비책
async function pickNative(o: PickOptions): Promise<number | "closed"> {
  const abort = new AbortController();
  let closed = false;
  const close = (): void => {
    closed = true;
    abort.abort();
  };
  if (o.signal?.aborted) return "closed";
  o.signal?.addEventListener("abort", close, { once: true });
  const timer = o.timeoutMs ? setTimeout(close, o.timeoutMs) : null;
  let parent: BrowserWindow | null = null;
  try {
    parent = parentWindow();
    const r = await dialog.showMessageBox(parent, {
      type: o.type,
      title: o.title,
      message: o.message,
      detail: o.detail,
      buttons: o.buttons,
      defaultId: 0,
      cancelId: o.cancelId,
      noLink: true,
      signal: abort.signal,
    });
    return closed ? "closed" : r.response;
  } catch (e) {
    console.error("멈춤 창을 띄우지 못했다 — 취소로 본다", e);
    return closed ? "closed" : o.cancelId;
  } finally {
    if (timer) clearTimeout(timer);
    o.signal?.removeEventListener("abort", close);
    if (parent && !parent.isDestroyed()) parent.destroy();
  }
}

async function ask(o: AskOptions): Promise<HaltAnswer> {
  const buttons = o.go ? [o.go, o.stop] : [o.stop];
  const r = await pick({
    type: o.type,
    title: o.title,
    message: o.message,
    detail: o.detail,
    buttons,
    cancelId: buttons.length - 1,
    ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
    ...(o.signal ? { signal: o.signal } : {}),
  });
  if (r === "closed") return "closed";
  return o.go && r === 0 ? "go" : "stop";
}

// 밀려남 안내 — 단추 하나. KICKED_CLOSE_MS 뒤 저절로 닫힌다. 답과 무관하게 앱은 종료한다
export function showKicked(info: HaltInfo): Promise<HaltAnswer> {
  return ask({
    type: "info",
    title: t("cloud.kicked.title"),
    message: t("cloud.kicked.message", { other: otherName(info) }),
    detail: t("cloud.kicked.detail"),
    go: null,
    stop: t("cloud.kicked.ok"),
    timeoutMs: KICKED_CLOSE_MS,
  });
}

// 이용 정지 안내(P4c, D35) — 단추 하나. 답과 무관하게 앱은 종료한다. 저절로 닫히지 않는다 — 사용자가 읽고 닫는다
export function showHeld(): Promise<HaltAnswer> {
  return ask({
    type: "warning",
    title: t("cloud.held.title"),
    message: t("cloud.held.message"),
    detail: t("cloud.held.detail"),
    go: null,
    stop: t("cloud.held.ok"),
  });
}

// 업데이트 필요 창 — 서버가 이 앱 버전을 거절했고 새 버전이 준비됐다(worklog/records/app-update/record.md "업데이트 필요 때 바로 받기")
//   ready   [나중에] [지금 다시 시작]
//   manual  [나중에] [받기] — mac 이 앱을 그 자리에서 바꿀 수 없다(dmg 를 연다)
//   Esc 는 나중에 — 게임은 멈추지 않고, 설정의 다시 시작·끌 때 적용이 남는다. 알림 창은 단추에 처음 포커스를 두지 않는다
export async function askUpdateRequired(version: string, manual: boolean): Promise<boolean> {
  const r = await pick({
    type: "info",
    title: t("update.required.title"),
    message: manual ? t("update.required.manual", { version }) : t("update.required.ready", { version }),
    detail: manual ? "" : t("update.required.ready.detail"),
    buttons: [t("update.required.later"), manual ? t("update.required.get") : t("update.required.restart")],
    primary: 1,
    cancelId: 0,
  });
  return r === 1;
}

// 연결 끊긴 다른 PC 를 넘겨받을지 묻는다(G2) — go 면 여기서 시작, stop 이면 종료(D22)
export function askConfirm(info: HaltInfo, signal?: AbortSignal): Promise<HaltAnswer> {
  return ask({
    type: "warning",
    title: t("cloud.confirm.title"),
    message: t("cloud.confirm.message", { other: otherName(info) }),
    detail: `${t("cloud.confirm.seen", { ago: agoText(info.other?.seen ?? null) })}\n${t("cloud.confirm.detail")}`,
    go: t("cloud.confirm.start"),
    stop: t("cloud.confirm.cancel"),
    ...(signal ? { signal } : {}),
  });
}

// 교환이 걸려 넘겨받지 못했다 — go 면 다시 시도, stop 이면 종료
//   CLOUD_TRADE_ACTIVE    상대 PC 에 열린 교환이 있다
//   CLOUD_TRADE_UNSYNCED  상대 PC 가 끝낸 교환을 아직 올리지 않았다
export function askBlocked(info: HaltInfo, signal?: AbortSignal): Promise<HaltAnswer> {
  const key = info.code === "CLOUD_TRADE_UNSYNCED" ? "tradeUnsynced" : "tradeActive";
  return ask({
    type: "warning",
    title: t("cloud.blocked.title"),
    message: t(`cloud.blocked.${key}`, { other: otherName(info) }),
    detail: t(`cloud.blocked.${key}.detail`),
    go: t("cloud.blocked.retry"),
    stop: t("cloud.blocked.quit"),
    ...(signal ? { signal } : {}),
  });
}

// 저장 잠김 창의 답 — quit 종료(저장은 그대로), fresh 저장을 백업하고 새로 시작
export type SaveLockedAnswer = "quit" | "fresh";

// 저장 키를 쓰지 못했다(키체인 거부·키 파일 잠김·키 저장소 없음)인데 암호화된 저장이 있다 — 켤 때 게임을 만들기 전에 묻는다.
// 저장을 옮기지 않고 먼저 묻는다(검수 P3-3, 2026-09-30 사용자 결정 "안내 창으로 묻기"). Esc 는 종료 — 새로 시작은 Esc 로 고르지 않는다
export async function askSaveLocked(): Promise<SaveLockedAnswer> {
  const r = await pick({
    type: "warning",
    title: t("save.locked.title"),
    message: t("save.locked.message"),
    detail: t("save.locked.detail"),
    buttons: [t("save.locked.quit"), t("save.locked.fresh")],
    cancelId: 0,
  });
  return r === 1 ? "fresh" : "quit";
}

// 분실 창의 답 — login 은 관리 창 계정 탭, local 은 이 PC 저장으로 계속, fresh 는 처음부터, closed 는 밖에서 닫았다
export type LostAnswer = "login" | "local" | "fresh" | "closed";

// 저장 계정을 잃었다(D29) — 게임은 계속, 클라우드 저장만 꺼져 있다
//   member     [로그인] [이 PC 저장으로 계속]. Esc 는 로그인(관리 창만 연다 — 되돌릴 수 있다)
//   anonymous  [이 PC 저장으로 계속] [처음부터]. Esc 는 이 PC 저장으로 계속 — 처음부터는 Esc 로 고르지 않는다.
//              synced(서버에 한 번이라도 올렸다)일 때만 "서버에 둔 익명 저장은 되찾을 수 없어요" 줄을 넣는다(G-c)
export async function askLost(kind: OwnerKind, synced: boolean, signal?: AbortSignal): Promise<LostAnswer> {
  if (kind === "member") {
    const r = await pick({
      type: "warning",
      title: t("cloud.lost.title"),
      message: t("cloud.lost.member.message"),
      detail: t("cloud.lost.member.detail"),
      buttons: [t("cloud.lost.login"), t("cloud.lost.local")],
      cancelId: 0,
      ...(signal ? { signal } : {}),
    });
    return r === "closed" ? "closed" : r === 1 ? "local" : "login";
  }
  const detail = [synced ? t("cloud.lost.anonymous.gone") : null, t("cloud.lost.anonymous.fresh"), t("cloud.lost.anonymous.tip")].filter((v): v is string => !!v).join("\n");
  const r = await pick({
    type: "warning",
    title: t("cloud.lost.title"),
    message: t("cloud.lost.anonymous.message"),
    detail,
    buttons: [t("cloud.lost.local"), t("cloud.lost.fresh")],
    cancelId: 0,
    ...(signal ? { signal } : {}),
  });
  return r === "closed" ? "closed" : r === 1 ? "fresh" : "local";
}
