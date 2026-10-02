// 포인터 — 마리를 잡고·끌고·놓고·찌르고·우클릭한다. 어느 마리인지는 hit 가 정한다
//
// -webkit-app-region: drag 로 OS 가 창을 끄는 방식은 렌더러에 마우스 이벤트가 하나도 오지 않아 "클릭"을 알 수 없고,
// mac 에서는 놓는 순간도 알 수 없다(moved 가 move 의 별칭). 그래서 직접 받는다 — 눌렀다 떼면 클릭, 조금이라도 끌면 드래그.
// 창은 움직이지 않는다. 마리가 무대 안에서 움직인다 — drag 의 x·y 는 몸 좌상단이 놓일 무대 좌표(커서 − 잡은 오프셋).
// 옮기고 가두고 반응을 고르는 건 메인이 한다
import type { PointerMsg } from "../shared/model/stage.js";

const DRAG_START_PX = 4; // 이만큼 움직여야 드래그 — 손 떨림을 클릭으로 친다
const CLICK_MAX_MS = 500; // 이보다 오래 누르고 있다 떼면 클릭이 아니다

export interface PointerDeps {
  hitAt(x: number, y: number): string | null; // 무대 좌표 → 마리 id
  bodyOrigin(id: string): { x: number; y: number } | null; // 그 마리 몸 좌상단 (잡은 오프셋의 기준)
  send(msg: PointerMsg): void;
  now?(): number;
}

export interface PointerHandle {
  pressedId(): string | null; // 누르고 있는 마리 — onHover 답에 쓴다
  release(): void; // 클릭 통과가 켜지면 메인이 부른다 — 누르고 있던 것도 놓는다
}

interface Press {
  pointerId: number;
  id: string;
  grabX: number; // 커서 − 몸 좌상단
  grabY: number;
  sx: number; // 누른 화면 좌표 — 드래그 시작 판정
  sy: number;
  lastX: number; // 마지막 커서 무대 좌표 — 이벤트 없이 놓을 때(release · 새 누름) 쓴다
  lastY: number;
  at: number;
  dragging: boolean;
}

export function enablePointer(target: HTMLElement, deps: PointerDeps): PointerHandle {
  const now = deps.now ?? (() => performance.now());
  let press: Press | null = null;
  const cursorAt = (x: number, y: number) => {
    target.style.cursor = deps.hitAt(x, y) ? "grab" : "default";
  };

  function finish(cancelled: boolean, x: number, y: number) {
    if (!press) return;
    const p = press;
    press = null;
    cursorAt(x, y);
    if (p.dragging) deps.send({ type: "drop", id: p.id, x, y });
    else if (!cancelled && now() - p.at <= CLICK_MAX_MS) deps.send({ type: "click", id: p.id, x, y });
  }
  const finishBy = (e: PointerEvent, cancelled: boolean) => {
    if (!press || e.pointerId !== press.pointerId) return;
    finish(cancelled, e.clientX, e.clientY);
  };

  target.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // 이전 누름의 떼기를 놓쳤다 — 먼저 놓아 준다. 안 그러면 메인이 들고 있는 상태로 남는다
    if (press) finish(true, press.lastX, press.lastY);
    // 그림 위에서만 누름이 된다 — 통과 전환 전의 한 프레임에 투명한 곳이 눌릴 수 있어 한 번 더 가린다
    const id = deps.hitAt(e.clientX, e.clientY);
    if (!id) return;
    const origin = deps.bodyOrigin(id);
    if (!origin) return;
    // 누른 채 마리 밖·창 밖으로 나가도 이벤트를 계속 받는다 — 빠르게 끌면 작은 마리를 금방 벗어난다
    target.setPointerCapture(e.pointerId);
    press = {
      pointerId: e.pointerId,
      id,
      grabX: e.clientX - origin.x,
      grabY: e.clientY - origin.y,
      sx: e.screenX,
      sy: e.screenY,
      lastX: e.clientX,
      lastY: e.clientY,
      at: now(),
      dragging: false,
    };
    target.style.cursor = "grabbing";
  });

  target.addEventListener("pointermove", (e) => {
    if (!press) {
      cursorAt(e.clientX, e.clientY);
      return;
    }
    if (e.pointerId !== press.pointerId) return;
    press.lastX = e.clientX;
    press.lastY = e.clientY;
    // 버튼이 이미 떨어졌는데 pointerup 을 놓쳤다(클릭 통과 전환 등) — 놓은 것으로 친다
    if ((e.buttons & 1) === 0) {
      finish(true, e.clientX, e.clientY);
      return;
    }
    if (!press.dragging) {
      if (Math.hypot(e.screenX - press.sx, e.screenY - press.sy) < DRAG_START_PX) return;
      press.dragging = true;
      deps.send({ type: "grab", id: press.id, x: e.clientX, y: e.clientY });
    }
    // 잡은 지점이 커서 밑에 그대로 있도록 몸 좌상단을 계산해 넘긴다
    deps.send({ type: "drag", id: press.id, x: Math.round(e.clientX - press.grabX), y: Math.round(e.clientY - press.grabY) });
  });

  target.addEventListener("pointerup", (e) => finishBy(e, false));
  // 캡처를 잃으면(창이 숨겨짐 등) 놓은 것으로 친다 — 안 그러면 들린 채로 남는다
  target.addEventListener("pointercancel", (e) => finishBy(e, true));
  target.addEventListener("lostpointercapture", (e) => finishBy(e, true));

  // 우클릭 — 그림 위에서만 메뉴를 청한다 (메뉴는 메인이 네이티브로 띄운다). 투명한 곳은 통과 중이라 오지 않지만,
  // 통과 전환 전의 한 프레임에 올 수 있어 한 번 더 가린다
  target.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (press) return; // 끄는 중에 우클릭 — 무시
    const id = deps.hitAt(e.clientX, e.clientY);
    if (id) deps.send({ type: "menu", id, x: e.clientX, y: e.clientY });
  });

  return {
    pressedId: () => press?.id ?? null,
    release: () => {
      if (press) finish(true, press.lastX, press.lastY);
    },
  };
}
