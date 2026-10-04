// 단추를 고르게 하는 창 — 게임 디자인의 알림 창(alert-window.ts)으로 먼저 띄우고, 띄우지 못하면 Electron 네이티브 대화상자로 띄운다
// 알림 창: 2026-10-01 사용자 "그것들은 디자인 못바꿔?" → "진행" (worklog/records/alert-window/record.md)
// 창의 글자는 화면 값이 만든다 (src/view/halt.ts). 답을 무엇으로 읽을지는 부르는 쪽이 정한다 (src/main/app/halt-dialog.ts)
// 네이티브는 작은 투명 부모 창을 하나 만들어 붙인다
//   - mac 은 부모 없는 대화상자가 동기로 돌아 메인을 멈추고, signal(자동 닫힘·밀려남으로 닫기)이 먹지 않는다 (electron.d.ts MessageBoxOptions.signal)
//   - 무대 창·배너가 항상 위에 떠 있다 — 부모를 그보다 위 층(screen-saver)에 둬서 가리지 않게 한다 (region-window.ts 와 같은 층)
// (예전 src/main/halt-dialog.ts 안에 있었다. 메인 레인 M8-5 에서 나눴다)
import { app, dialog, type BrowserWindow } from "electron";
import { alertViewOf, type AlertSpec } from "../../view/halt";
import { askAlert } from "./alert-window";
import { primaryWorkArea } from "./display";
import { preloadFile, rendererFile } from "./files";
import { createOverlayWindow } from "./options";
import { centerSpotOf } from "./placement";

export interface ChoiceOptions extends AlertSpec {
  timeoutMs?: number; // 지나면 closed
  signal?: AbortSignal; // 밖에서 닫는다 — closed
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

// 단추를 고르게 한다 — 고른 단추 번호. 밖에서 닫았으면 closed, 띄우지 못했으면 cancelId
export async function askChoice(o: ChoiceOptions): Promise<number | "closed"> {
  const started = Date.now();
  const viaAlert = await askAlert({
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
  return askNative({ ...o, ...(o.timeoutMs ? { timeoutMs: left } : {}) });
}

// 네이티브 대화상자 — 알림 창의 대비책
async function askNative(o: ChoiceOptions): Promise<number | "closed"> {
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
