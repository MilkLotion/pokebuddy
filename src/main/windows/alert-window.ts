// 알림 창 — OS 대화상자 대신 게임 디자인으로 멈춤·분실·저장 잠김·정지·업데이트를 묻는다. 문서는 src/renderer/alert.html
// 설계는 worklog/records/alert-window/alert-window.md. Figma 시안은 99 `시안 · 알림 창 (OS 대화상자 대체)` `1152:20447`
//
// 테두리 없음 · 배경 투명 · 항상 위(무대 창·배너보다 위 screen-saver 층) · 작업 표시줄에 없음. 주 화면 가운데 위쪽 1/3 에 띄운다
// 부를 때마다 창을 새로 만들고 답하면 부순다. 게임을 만들기 전(저장 잠김 창)에도 뜬다
// 창이 내용을 그려 크기를 알려 오지 못하면(ALERT_RULES.readyMs·문서 못 읽음·렌더러 죽음) 창을 부수고 null — 부른 쪽이 OS 대화상자로 띄운다
// 보이기 전에 밖에서 닫히면(앱 종료·로그오프) closed — 끄는 중에 OS 대화상자를 새로 띄우지 않는다(검수 3)
// 한 번 답하는 창의 공통 동작은 틀(./answer-window.ts)이 한다
import { app } from "electron";
import type { AlertChannel } from "../../shared/ipc/overlays";
import type { AlertView } from "../../shared/model/overlays";
import { askWindow } from "./answer-window";
import { primaryWorkArea } from "./display";
import { createOverlayWindow } from "./options";
import { centerSpotOf } from "./placement";

const CH = {
  show: "alert:show",
  size: "alert:size",
  pick: "alert:pick",
} satisfies Record<string, AlertChannel>;

// 창 폭은 알림 상자 440 에 그림자 자리 16 을 둘렀다. 높이는 창이 알려 온 내용 높이에 같은 자리를 더한다
export const ALERT_RULES = { box: 440, margin: 16, readyMs: 3000 } as const;

export interface AlertOptions {
  preload: string;
  html: string;
  view: AlertView;
  cancelId: number; // Esc·답 없이 창이 닫힘이 고르는 단추 번호
  timeoutMs?: number; // 지나면 closed — 밀려남 안내의 저절로 닫힘
  signal?: AbortSignal; // 밖에서 닫는다 — closed
}

// 답 — 누른 단추 번호, closed(시간 초과·밖에서 닫음), null(알림 창을 띄우지 못했다)
export type AlertAnswer = number | "closed" | null;

export function askAlert(o: AlertOptions): Promise<AlertAnswer> {
  if (o.signal?.aborted) return Promise.resolve("closed");
  let shown = false;
  return askWindow<AlertAnswer>({
    // mac 의 다른 앱 전체 화면 Space 위에도 뜬다 — 무대 창과 같은 설정(검수 5)
    create: () => [createOverlayWindow({ preload: o.preload, layer: "screen-saver", bounds: { width: ALERT_RULES.box + ALERT_RULES.margin * 2, height: 240 }, firstMouse: true, allWorkspaces: true })],
    html: o.html,
    end: "destroy",
    // 보인 뒤 닫혔으면(Alt+F4 등) 취소, 보이기 전이면 밖에서 닫은 것(closed)
    closed: () => (shown ? o.cancelId : "closed"),
    wire(ctx) {
      const win = ctx.wins[0];
      if (!win) return;
      // 내용 높이를 받았다 — 창 크기를 맞추고 보인다. 한 번만
      ctx.scope.on(CH.size, (_e, height) => {
        if (shown) return;
        if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return;
        shown = true;
        const area = primaryWorkArea();
        const width = ALERT_RULES.box + ALERT_RULES.margin * 2;
        const h = Math.min(Math.ceil(height) + ALERT_RULES.margin * 2, area.height);
        win.setBounds({ ...centerSpotOf(area, { width, height: h }), width, height: h });
        // Dock 을 숨긴 mac 앱은 앞으로 나오지 않는다 — 창을 보기 전에 앱을 앞으로 가져온다
        if (process.platform === "darwin") app.focus({ steal: true });
        win.show();
        win.focus();
      });
      // 단추를 눌렀다 — 보인 단추가 아니면(Esc 의 null 포함) 취소 단추로 본다
      ctx.scope.on(CH.pick, (_e, index) => {
        if (!shown) return;
        ctx.finish(o.view.buttons.some((b) => b.index === index) ? (index as number) : o.cancelId);
      });
      // 렌더러가 죽으면 답이 오지 않는다 — 보였으면 취소, 아니면 OS 대화상자로(검수 2)
      win.webContents.on("render-process-gone", () => ctx.finish(shown ? o.cancelId : null));
      const signal = o.signal;
      if (signal) {
        const onAbort = (): void => ctx.finish("closed");
        signal.addEventListener("abort", onAbort, { once: true });
        ctx.onCleanup(() => signal.removeEventListener("abort", onAbort));
      }
      const timers: NodeJS.Timeout[] = [];
      if (o.timeoutMs) timers.push(setTimeout(() => ctx.finish("closed"), o.timeoutMs));
      timers.push(
        setTimeout(() => {
          if (!shown) ctx.finish(null);
        }, ALERT_RULES.readyMs),
      );
      ctx.onCleanup(() => timers.forEach(clearTimeout));
    },
    loaded: (win) => win.webContents.send(CH.show, o.view),
    loadFailed(e, ctx) {
      console.error("알림 창 문서를 읽지 못했다 — OS 대화상자로 띄운다", e);
      if (!shown) ctx.finish(null);
    },
  }).catch((e: unknown) => {
    // 창을 만들지 못했다 — 틀이 약속을 거절한다
    console.error("알림 창을 만들지 못했다 — OS 대화상자로 띄운다", e);
    return null;
  });
}
