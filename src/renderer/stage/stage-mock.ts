// 무대의 가짜 다리 — stage.html?mock=1 을 Chrome 에서 직접 열 때 쓴다. 고정 시트 없이 색 사각형 시트를 만들어
// 그리기·히트·드래그를 화면 안 텍스트로 확인한다. Electron 에서는 쓰지 않는다(smoke-renderer 는 이 모드를 쓴다)
import type { CoachView, HoverQuery, LookSheets, PointerMsg, SpriteSheet, StageFrame, StageInit } from "../../shared/model/stage.js";
import type { StageBridge } from "../../shared/ipc/stage.js";

export function createMockBridge(opts: { coach: string | null; note: (s: string) => void }): StageBridge {
  type Cb<T> = (v: T) => void;
  const note = opts.note;
  let coachCb: Cb<CoachView | null> | null = null;
  const cbs = { init: [] as Cb<StageInit>[], sheets: [] as Cb<LookSheets>[], frame: [] as Cb<StageFrame>[], hover: [] as Cb<HoverQuery>[], ct: [] as Cb<boolean>[] };

  // 색 사각형 시트 — 프레임마다 안쪽 여백을 달리 해 넘어가는 것이 보이게, 행마다 밝기를 달리 해 방향이 보이게
  function sheet(fw: number, fh: number, cols: number, rows: number, hue: number, ms: number): SpriteSheet {
    const c = document.createElement("canvas");
    c.width = fw * cols;
    c.height = fh * rows;
    const g = c.getContext("2d");
    if (g) {
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < cols; i++) {
          const inset = 2 + i * 2;
          g.fillStyle = `hsl(${hue} 70% ${35 + r * 6}%)`;
          g.fillRect(i * fw + inset, r * fh + inset, fw - inset * 2, fh - inset * 2 - 4);
          g.fillStyle = "#fff";
          g.fillRect(i * fw + Math.floor(fw / 2) - 1, r * fh + Math.floor(fh / 2) + 3, 3, 3); // 정렬 기준점 (w/2, h/2+4) 표시
        }
      }
    }
    return { fw, fh, rows, frames: Array.from({ length: cols }, (_, x) => ({ x, ms })), dataUrl: c.toDataURL("image/png") };
  }
  function look(name: string, hue: number, big: boolean): LookSheets {
    const anims: Record<string, SpriteSheet> = {
      Idle: sheet(24, 24, 2, 8, hue, 500),
      Walk: sheet(24, 24, 4, 8, hue, 150),
      Pose: sheet(24, 24, 3, 1, hue + 40, 130),
      Faint: sheet(24, 24, 3, 1, hue - 40, 200),
    };
    if (big) anims["Attack"] = sheet(48, 40, 3, 8, hue + 90, 60); // 몸보다 큰 작업 동작 — 몸 밖으로 넘치는 정렬 확인
    return {
      look: name,
      cell: big ? { w: 48, h: 40 } : { w: 24, h: 24 },
      body: { w: 24, h: 24 },
      anims,
      clips: {
        idle: { anim: "Idle", mode: "loop", row: 0 },
        running: { anim: "Walk", mode: "loop", row: 2 },
        waiting: { anim: "Idle", mode: "loop", row: 4 },
        waving: { anim: "Pose", mode: "once", row: 0 },
        failed: { anim: "Faint", mode: "hold", row: 0 },
      },
    };
  }

  const states: StageFrame["state"][] = ["idle", "running", "waiting", "waving", "failed"];
  const pets = [
    { id: "a", look: "mock-a", zoom: 2, x: 40, y: 60, held: false, walk: true },
    { id: "b", look: "mock-b", zoom: 3, x: 200, y: 40, held: false, walk: false },
    { id: "c", look: "mock-c", zoom: 2, x: 120, y: 120, held: false, walk: false },
  ];
  let held: string | null = null;
  let t0 = 0;
  let last: PointerMsg | null = null;

  function frameAt(now: number): StageFrame {
    const sec = (now - t0) / 1000;
    const state = states[Math.floor(sec / 4) % states.length] ?? "idle";
    const a = pets[0];
    if (a && held !== a.id) {
      a.x = 40 + Math.round(((Math.sin(sec / 2) + 1) / 2) * Math.max(0, innerWidth - 100));
    }
    const dir = Math.cos(sec / 2) >= 0 ? 2 : 6;
    return {
      at: Date.now(),
      state,
      pets: pets.map((p) => ({
        id: p.id,
        look: p.look,
        zoom: p.zoom,
        x: p.x,
        y: p.y,
        held: held === p.id,
        ...(p.id === "a" ? { bubble: ["mock-meat", "mock-meat", "mock-meat"] } : {}), // 말풍선 모양 확인용 — 가짜 모드에서만
        play: held === p.id ? { anim: "Idle", row: 4, mode: "hold", rate: 1 } : p.walk ? { anim: "Walk", row: dir, mode: "loop", rate: 1.5 } : p.id === "c" && Math.floor(sec) % 6 < 2 ? { anim: "Attack", row: 0, mode: "loop", rate: 1 } : null,
      })),
    };
  }

  return {
    ready() {
      t0 = performance.now();
      setTimeout(() => {
        for (const cb of cbs.init) cb({ size: { w: innerWidth, h: innerHeight }, debug: true });
        for (const cb of cbs.sheets) {
          cb(look("mock-a", 120, false));
          cb(look("mock-b", 0, false));
          cb(look("mock-c", 210, true));
        }
        setInterval(() => {
          const f = frameAt(performance.now());
          for (const cb of cbs.frame) cb(f);
        }, 40);
        addEventListener("resize", () => {
          for (const cb of cbs.init) cb({ size: { w: innerWidth, h: innerHeight }, debug: true });
        });
        // 메인의 hoverTick 흉내 — 마우스 자리를 40ms 마다 묻는다
        let mx = -1;
        let my = -1;
        addEventListener("pointermove", (e) => {
          mx = e.clientX;
          my = e.clientY;
        });
        setInterval(() => {
          if (mx >= 0) for (const cb of cbs.hover) cb({ x: mx, y: my });
        }, 40);
        // 키 c — 클릭 통과 켜기 흉내 (누르고 있던 것이 놓이는지)
        addEventListener("keydown", (e) => {
          if (e.key === "c") for (const cb of cbs.ct) cb(true);
        });
      }, 0);
    },
    onInit: (cb) => void cbs.init.push(cb),
    onSheets: (cb) => void cbs.sheets.push(cb),
    onFrame: (cb) => void cbs.frame.push(cb),
    onHover: (cb) => void cbs.hover.push(cb),
    onClickThrough: (cb) => void cbs.ct.push(cb),
    onCry: () => {},
    // 말풍선 아이콘 흉내 — 색 사각형 하나를 mock-meat 로 준다
    onIcons: (cb) => {
      const c = document.createElement("canvas");
      c.width = 30;
      c.height = 30;
      const g = c.getContext("2d");
      if (g) {
        g.fillStyle = "#cc5428";
        g.fillRect(6, 8, 18, 14);
      }
      setTimeout(() => cb({ "mock-meat": c.toDataURL("image/png") }), 0);
    },
    // ?coach=pet · area — 튜토리얼 말풍선 흉내. 버튼을 누르면 지운다
    onCoach: (cb) => {
      coachCb = cb;
      const kind = opts.coach;
      if (kind !== "pet" && kind !== "area") return;
      setTimeout(() => {
        cb(
          kind === "pet"
            ? { id: "first-care", kind: "pet", petId: "a", step: "튜토리얼 · 첫 돌봄 1 / 2", title: "포켓몬 위에서 우클릭해 보세요", body: "밥 주기와 놀아주기로 돌볼 수 있어요.", button: "" }
            : { id: "playground", kind: "area", areaLabel: "지금 · 화면 전체", step: "튜토리얼 · 놀이공간 1 / 1", title: "포켓몬이 다니는 공간을 바꿀 수 있어요", body: "설정의 놀이공간에서 화면 전체와 영역 지정 중에서 고르세요. 영역 지정은 드래그로 범위를 그려요.", button: "확인" },
        );
      }, 300);
    },
    coachAction: (a) => {
      note(`(mock) 튜토리얼 ${a.id} ${a.action}`);
      coachCb?.(null);
    },
    hit: () => {},
    log: () => {}, // mock 은 진단을 #debug 로만 본다
    pointer(msg) {
      last = msg;
      const p = pets.find((x) => x.id === msg.id);
      if (!p) return;
      if (msg.type === "grab") held = msg.id;
      else if (msg.type === "drag" && held === msg.id) {
        p.x = msg.x;
        p.y = msg.y;
      } else if (msg.type === "drop") held = null;
      else if (msg.type === "click") p.zoom = p.zoom >= 3 ? 1 : p.zoom + 1;
      else if (msg.type === "menu") note(`(mock) 메뉴 ${msg.id} — 마지막 ${last.type}`);
    },
  };
}
