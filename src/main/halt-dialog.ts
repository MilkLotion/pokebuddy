// 두 PC 규칙의 멈춤 창 — 밀려남 안내·넘겨받기 확인·넘겨받기 막힘 (worklog-mac/records/cloud-authority/design-p1.md 3·5절)
// 앱이 게임을 멈춘 뒤 띄운다. 창의 답을 받아 무엇을 할지는 앱(src/main/app.ts)이 정한다.
//
// Electron 네이티브 대화상자를 쓴다. 작은 투명 부모 창을 하나 만들어 붙인다
//   - mac 은 부모 없는 대화상자가 동기로 돌아 메인을 멈추고, signal(자동 닫힘·밀려남으로 닫기)이 먹지 않는다 (electron.d.ts MessageBoxOptions.signal)
//   - 무대 창·배너가 항상 위에 떠 있다 — 부모를 그보다 위 층(screen-saver)에 둬서 가리지 않게 한다 (src/main/region-window.ts 와 같은 층)
import { app, BrowserWindow, dialog, screen } from "electron";
import type { HaltInfo } from "../online/cloud.js";
import { t } from "./text";

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
  const area = screen.getPrimaryDisplay().workArea;
  const width = 480;
  const height = 240;
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 3),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
  });
  win.setAlwaysOnTop(true, "screen-saver");
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

async function ask(o: AskOptions): Promise<HaltAnswer> {
  const abort = new AbortController();
  let closed = false;
  const close = (): void => {
    closed = true;
    abort.abort();
  };
  if (o.signal?.aborted) return "closed";
  o.signal?.addEventListener("abort", close, { once: true });
  const timer = o.timeoutMs ? setTimeout(close, o.timeoutMs) : null;
  const buttons = o.go ? [o.go, o.stop] : [o.stop];
  const stopId = buttons.length - 1;
  let parent: BrowserWindow | null = null;
  try {
    parent = parentWindow();
    const r = await dialog.showMessageBox(parent, {
      type: o.type,
      title: o.title,
      message: o.message,
      detail: o.detail,
      buttons,
      defaultId: 0,
      cancelId: stopId,
      noLink: true,
      signal: abort.signal,
    });
    if (closed) return "closed";
    return o.go && r.response === 0 ? "go" : "stop";
  } catch (e) {
    console.error("멈춤 창을 띄우지 못했다 — 멈춤으로 본다", e);
    return closed ? "closed" : "stop";
  } finally {
    if (timer) clearTimeout(timer);
    o.signal?.removeEventListener("abort", close);
    if (parent && !parent.isDestroyed()) parent.destroy();
  }
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
