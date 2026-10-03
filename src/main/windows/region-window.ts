// 놀이공간 영역 그리기 창 — 커서가 있는 화면을 덮고 드래그로 사각형을 그린다. 문서는 src/renderer/region.html
//
// 화면 하나만 덮는다. 여러 화면에 걸친 영역은 두지 않는다 (worklog/records/game-runtime/record.md "놀이공간·설정의 설계").
// 적용하면 화면 좌표의 사각형을, 취소하거나 창을 닫으면 null 을 돌려준다. 저장은 부른 쪽이 한다 — 여기서는 그리기만 한다
// 한 번 답하는 창의 공통 동작은 틀(./answer-window.ts)이 한다. 그리는 중에 다시 부르면 같은 약속을 돌려준다
import type { RegionChannel } from "../../shared/ipc/overlays";
import type { Rect } from "../../shared/geometry";
import type { RegionInit } from "../../shared/model/overlays";
import { regionFits } from "../../state/settings.js";
import { REGION_MIN } from "../../state/rules.js";
import { askWindow, singleFlight } from "./answer-window";
import { cursorScreen } from "./display";
import { createOverlayWindow } from "./options";

const CH = {
  init: "region:init",
  done: "region:done",
} satisfies Record<string, RegionChannel>;

export interface RegionOptions {
  preload: string;
  html: string;
  current: Rect | null; // 지금 영역 (화면 좌표)
}

const isRect = (v: unknown): v is Rect => {
  if (v == null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return [r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n));
};

export const askRegion = singleFlight((opts: RegionOptions): Promise<Rect | null> => {
  const b = cursorScreen().bounds;
  // 지금 영역을 이 화면 안 좌표로. 다른 화면에 있으면 보이지 않는다
  const cur = opts.current;
  const local = cur ? { x: cur.x - b.x, y: cur.y - b.y, w: cur.w, h: cur.h } : null;
  const onScreen = local && local.x < b.width && local.y < b.height && local.x + local.w > 0 && local.y + local.h > 0 ? local : null;
  const init: RegionInit = { current: onScreen, min: { ...REGION_MIN } };
  return askWindow<Rect | null>({
    create: () => [createOverlayWindow({ preload: opts.preload, layer: "screen-saver", bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, firstMouse: true, allWorkspaces: true })], // mac — 알림 창과 같은 옵션 (94 문서 4-3·4-4)
    html: opts.html,
    closed: () => null,
    wire(ctx) {
      ctx.scope.on(CH.done, (_e, rect) => {
        if (!isRect(rect)) return ctx.finish(null);
        // 창 안 좌표 → 화면 좌표. 화면 밖으로 나간 몫은 자른다
        const x = Math.max(0, Math.min(rect.x, b.width));
        const y = Math.max(0, Math.min(rect.y, b.height));
        const w = Math.min(rect.x + rect.w, b.width) - x;
        const h = Math.min(rect.y + rect.h, b.height) - y;
        if (!regionFits(w, h)) return ctx.finish(null);
        ctx.finish({ x: Math.round(b.x + x), y: Math.round(b.y + y), w: Math.round(w), h: Math.round(h) });
      });
    },
    loaded(win) {
      win.webContents.send(CH.init, init);
      win.show();
      win.focus(); // Esc·Enter 를 받는다
    },
    loadFailed: (_e, ctx) => ctx.finish(null),
  });
});
