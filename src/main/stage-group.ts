// 무대 묶음 — 화면마다 무대 창과 무대(마리 움직임) 한 쌍을 두고, 앱에는 무대 하나처럼 보인다 (2026-09-28 여러 화면).
// 설계는 worklog/records/multi-display/record.md
//
//   한 화면 · 영역 지정   쌍이 하나 — 모든 마리가 그 무대에 있다 (여러 화면 전과 같다)
//   모든 화면            화면마다 쌍 하나 — 마리는 사는 화면의 무대에만 있다 (layout.ts assignScreens)
//
// 끌어다 놓을 때 커서가 다른 화면의 무대 위면 그 화면으로 옮긴다. 놓은 자리가 새 집이고 사는 화면과 함께 저장한다.
// 끄는 도중에도 커서가 다른 화면에 들어가면 그 화면 무대로 넘긴다 — 원래 창 밖은 그려지지 않기 때문이다
// (2026-09-28 사용자 보고 "드래그하면 화면에서 안움직이고 드랍하면 다른화면으로 옮겨짐", worklog/records/multi-display/record.md).
// 입력은 잡은 창으로 계속 온다(포인터 캡처). 묶음이 좌표를 바꿔 마리를 든 무대로 보내고, 잡은 창은 끝날 때까지 통과시키지 않는다
// 창·무대를 만드는 일은 부르는 쪽이 준다 — 이 모듈은 Electron 을 부르지 않아 자체 시험에서 가짜로 돌린다
import type { BrowserWindow } from "electron";
import type { CoachView, HitReply, PointerMsg, StageState } from "../shared/model/stage";
import type { CareAction } from "../state/types";
import { assignScreens, clampInStage, homeOf, screenRefOfInfo, stackShift, toLocal, type Home, type PlayLane, type Rect, type ScreenRef, type Size, type Spot } from "./layout";
import type { PartyPet } from "./save-party";
import type { Stage } from "./stage";
import type { StageWindow } from "./stage-window";

// 무대 창 하나의 알림 — 묶음이 그 창의 무대로 이어 준다
export interface LaneHooks {
  onReady(): void;
  onHit(id: HitReply): void;
  onPointer(msg: PointerMsg): void;
  onGone(): void;
  onHidden(): void;
}

// 무대 하나에 주는 것 — 커서(그 무대 안 좌표)와 놓기
export interface LaneStageHooks {
  cursor(): Spot | null;
  onDrop(id: string, home: Home): void;
}

export interface StageGroupOptions {
  createWindow(hooks: LaneHooks): StageWindow;
  createStage(win: StageWindow, hooks: LaneStageHooks): Stage;
  cursorPoint(): Spot; // 화면 좌표의 커서
  // 놓았다 — 부르는 쪽이 저장한다. screen 은 모든 화면 방식일 때만 준다(사는 화면)
  onDrop(id: string, home: Home, screen: ScreenRef | undefined): void;
  log?: ((o: Record<string, unknown>) => void) | null;
}

interface Lane {
  key: string;
  plan: PlayLane;
  win: StageWindow;
  stage: Stage;
}

// 끄는 중인 마리 — source 는 잡은 창(입력이 오는 곳), owner 는 지금 마리를 든 무대
interface Drag {
  id: string;
  source: Lane;
  owner: Lane;
  origin: { home: Home; screen: ScreenRef | null } | null; // 잡을 때의 집·사는 화면 — 끊기면 되돌린다
  moving: boolean; // 다른 무대로 넘기는 중(그림 준비)
  dropped: boolean; // 넘기는 중에 놓았다
  last: Spot | null; // 마지막 몸 좌상단(화면 좌표)
}

export interface StageGroup {
  layout(lanes: PlayLane[], all: boolean): void; // 폴링마다 부른다 — 화면 구성이 바뀔 때만 창을 만들고 닫는다
  setParty(list: PartyPet[]): Promise<void>;
  setVisible(on: boolean): void;
  raise(): void; // 보이는 무대 창 전부 "항상 위"를 다시 건다 (src/main/keep-on-top.ts)
  owns(w: BrowserWindow): boolean; // 무대 창인가
  setState(state: StageState, promptAt: number | null): void;
  focus(key: string | null): void;
  tick(): void;
  releaseHeld(): void;
  care(id: string, action: CareAction): void;
  celebrate(id: string): void;
  say(id: string, keys: string[], uris: Record<string, string>, ms: number): void; // 아이콘 말풍선 — src/main/stage.ts say
  pin(id: string | null): void;
  petIds(): string[]; // 파티 순서
  awakeIds(): string[]; // 무대의 마리 가운데 자고 있지 않은 마리 — 줍기의 활동 시간 (src/find/core.ts)
  petOf(id: string): PartyPet | null;
  heldId(): string | null;
  stageRectOf(id: string): Rect | null; // 그 마리가 있는 무대 창 사각형(화면 좌표)
  laneKeys(): string[];
  alive(): boolean;
  isVisible(): boolean;
  size(): Size; // 첫 무대 크기 — 상태 보고용
  setPassing(on: boolean): void;
  sendClickThrough(on: boolean): void;
  sendCry(id: string, uri: string, volume: number): void;
  sendCoach(view: CoachView | null): void;
  close(): void;
}

export function createStageGroup(opts: StageGroupOptions): StageGroup {
  const log = opts.log ?? null;
  let lanes: Lane[] = [];
  let all = false;
  let party: PartyPet[] = [];
  let coach: CoachView | null = null;
  let visible = false;
  let pinned: string | null = null;
  let drag: Drag | null = null;

  const laneWith = (id: string): Lane | null => lanes.find((l) => l.stage.petOf(id) != null) ?? null;
  const laneAt = (p: Spot): Lane | null => lanes.find((l) => p.x >= l.plan.rect.x && p.y >= l.plan.rect.y && p.x < l.plan.rect.x + l.plan.rect.w && p.y < l.plan.rect.y + l.plan.rect.h) ?? null;
  const anchorOf = (l: Lane): Rect => toLocal(l.plan.target, l.plan.rect);

  // 놓은 뒤 목록의 그 마리 값을 바꾼다 — 저장이 돌아오기 전에 옮긴 화면에 바로 보이게
  const remember = (id: string, home: Home, screen: ScreenRef | undefined): void => {
    party = party.map((p) => (p.id === id ? { ...p, home: { ...home }, ...(screen ? { screen: { ...screen } } : {}) } : p));
  };

  // 마리 → 무대. 한 화면이면 첫 무대에 모두, 모든 화면이면 사는 화면대로
  async function distribute(): Promise<void> {
    if (!lanes.length) return;
    if (!all || lanes.length === 1) {
      await Promise.all(lanes.map((l, i) => l.stage.setParty(i === 0 ? party : [])));
    } else {
      const where = assignScreens(party, lanes.map((l) => l.plan.screen));
      await Promise.all(lanes.map((l) => l.stage.setParty(party.filter((p) => where.get(p.id) === l.plan.screen.id))));
    }
    for (const l of lanes) l.stage.pin(pinned && l.stage.petOf(pinned) ? pinned : null);
    sendCoachNow();
    log?.({ stage: "distribute", all, lanes: lanes.map((l) => ({ key: l.key, pets: l.stage.petIds() })) });
  }

  function sendCoachNow(): void {
    const target = coach?.kind === "pet" && coach.petId ? laneWith(coach.petId) : (lanes[0] ?? null);
    for (const l of lanes) l.win.sendCoach(l === target ? coach : null);
  }

  function onLaneDrop(source: Lane, id: string, home: Home): void {
    if (!all) {
      remember(id, home, undefined);
      opts.onDrop(id, home, undefined);
      return;
    }
    const at = opts.cursorPoint();
    const target = laneAt(at);
    const body = source.stage.bodyOf(id);
    if (target && target !== source && body) {
      // 다른 화면에 놓았다 — 커서가 몸 가운데에 오게 그 화면의 무대 안 자리를 잡고, 그 화면 기준 집으로 바꾼다
      const size = { w: target.plan.rect.w, h: target.plan.rect.h };
      const spot = clampInStage(at.x - target.plan.rect.x - body.w / 2, at.y - target.plan.rect.y - body.h / 2, body, size);
      const moved = homeOf(spot, body, anchorOf(target), stackShift(body));
      const screen = screenRefOfInfo(target.plan.screen);
      log?.({ stage: "move-screen", id, from: source.key, to: target.key, home: moved });
      remember(id, moved, screen);
      opts.onDrop(id, moved, screen);
      void distribute();
      return;
    }
    const screen = screenRefOfInfo(source.plan.screen);
    remember(id, home, screen);
    opts.onDrop(id, home, screen);
  }

  // 포인터 — 끄는 마리를 커서가 있는 화면의 무대로 넘기고, 이후 입력을 그 무대 좌표로 바꿔 보낸다
  function onLanePointer(lane: Lane, msg: PointerMsg): void {
    if (msg.type === "grab") {
      const p = party.find((x) => x.id === msg.id);
      drag = { id: msg.id, source: lane, owner: lane, origin: p ? { home: { ...p.home }, screen: p.screen ? { ...p.screen } : null } : null, moving: false, dropped: false, last: null };
      lane.stage.pointer(msg);
      return;
    }
    const d = drag;
    if (!d || d.id !== msg.id || d.source !== lane) {
      lane.stage.pointer(msg);
      return;
    }
    if (msg.type === "drag") {
      const src = d.source.plan.rect;
      d.last = { x: src.x + msg.x, y: src.y + msg.y };
      if (d.moving) return;
      const to = all && lanes.length > 1 ? laneAt(opts.cursorPoint()) : null;
      if (to && to !== d.owner) {
        void handOver(d, to);
        return;
      }
      const o = d.owner.plan.rect;
      d.owner.stage.pointer({ ...msg, x: d.last.x - o.x, y: d.last.y - o.y });
      return;
    }
    if (msg.type === "drop") {
      if (d.moving) {
        d.dropped = true; // 넘기기가 끝나면 그 무대에서 놓는다
        return;
      }
      drag = null;
      d.owner.stage.pointer(msg);
      return;
    }
    lane.stage.pointer(msg);
  }

  // 다른 화면 무대로 넘긴다 — 사는 화면을 바꿔 다시 나누고, 새 무대가 들린 채로 받는다. 저장은 놓을 때 한다
  async function handOver(d: Drag, to: Lane): Promise<void> {
    d.moving = true;
    const cur = party.find((p) => p.id === d.id);
    if (cur) remember(d.id, cur.home, screenRefOfInfo(to.plan.screen));
    log?.({ stage: "hand-over", id: d.id, from: d.owner.key, to: to.key });
    await distribute();
    d.moving = false;
    if (drag !== d) return; // 도중에 끊겼다 — cancelDrag 가 되돌렸다
    d.owner = to;
    const o = to.plan.rect;
    const at = d.last ?? { x: o.x, y: o.y };
    to.stage.adopt(d.id, { x: at.x - o.x, y: at.y - o.y });
    if (d.dropped) {
      drag = null;
      to.stage.pointer({ type: "drop", id: d.id, x: 0, y: 0 });
    }
  }

  // 끄다가 끊겼다(창이 사라짐 등) — 저장하지 않고, 다른 무대로 넘겼으면 잡을 때의 화면·집으로 되돌린다
  function cancelDrag(): void {
    const d = drag;
    if (!d) return;
    drag = null;
    d.owner.stage.releaseHeld();
    if (d.owner === d.source || !d.origin) return;
    const origin = d.origin;
    party = party.map((p) => (p.id === d.id ? { ...p, home: { ...origin.home }, screen: origin.screen ? { ...origin.screen } : null } : p));
    void distribute();
  }

  // 무대 창 하나의 입력이 끊겼다 — 그 무대가 든 마리를 놓고, 묶음의 끄기가 그 창에 걸려 있으면 끊는다
  function laneLost(lane: Lane): void {
    lane.stage?.releaseHeld();
    if (drag && (drag.source === lane || drag.owner === lane)) cancelDrag();
  }

  function makeLane(plan: PlayLane): Lane {
    // 창·무대가 서로를 부르므로 틀을 먼저 만들고 채운다
    const lane = { key: plan.key, plan } as Lane;
    const raw = opts.createWindow({
      onReady: () => {
        laneLost(lane); // 렌더러가 새로 떴다 — 들고 있던 포인터도 사라졌다
        lane.stage?.resend();
        lane.win.resendCoach();
      },
      onHit: (id) => lane.stage?.hit(id),
      onPointer: (msg) => onLanePointer(lane, msg),
      onGone: () => laneLost(lane),
      onHidden: () => laneLost(lane),
    });
    // 잡은 창은 마리를 다른 무대로 넘긴 뒤에도 끝날 때까지 든 것으로 친다 — 통과로 바뀌면 포인터 캡처가 끊겨 떼기를 잃는다
    lane.win = { ...raw, hoverTick: (held, ghost) => raw.hoverTick(held || drag?.source === lane, ghost) };
    lane.stage = opts.createStage(lane.win, {
      cursor: () => {
        const rect = lane.win.stage();
        if (!rect || !lane.win.isVisible()) return null;
        const p = opts.cursorPoint();
        const x = p.x - rect.x, y = p.y - rect.y;
        return x >= 0 && y >= 0 && x <= rect.w && y <= rect.h ? { x, y } : null;
      },
      onDrop: (id, home) => onLaneDrop(lane, id, home),
    });
    return lane;
  }

  function place(l: Lane): void {
    l.win.setStage(l.plan.rect);
    l.stage.setStage(anchorOf(l), { w: l.plan.rect.w, h: l.plan.rect.h });
  }

  function applyVisible(): void {
    for (const l of lanes) {
      const show = visible && l.win.stage() != null; // 아직 무대 사각형이 없으면 1×1 창을 보이지 않는다
      l.win.setVisible(show);
      l.stage.setVisible(show);
    }
  }

  return {
    layout(next, nextAll) {
      const same = nextAll === all && next.length === lanes.length && next.every((p, i) => p.key === lanes[i]?.key);
      if (same) {
        next.forEach((p, i) => {
          const l = lanes[i]!;
          l.plan = p;
          place(l);
        });
        return;
      }
      // 화면 구성이 바뀌었다 — 없어진 화면의 창을 닫고 새 화면의 창을 만든 뒤 마리를 다시 나눈다
      const keep = new Map(lanes.map((l) => [l.key, l]));
      const built: Lane[] = [];
      for (const p of next) {
        const old = keep.get(p.key);
        if (old) {
          keep.delete(p.key);
          old.plan = p;
          built.push(old);
        } else built.push(makeLane(p));
      }
      for (const gone of keep.values()) {
        laneLost(gone);
        gone.win.close();
      }
      lanes = built;
      all = nextAll;
      log?.({ stage: "lanes", all, keys: lanes.map((l) => l.key) });
      for (const l of lanes) place(l);
      applyVisible();
      void distribute();
    },

    async setParty(list) {
      party = list.map((p) => ({ ...p, home: { ...p.home }, screen: p.screen ? { ...p.screen } : null }));
      await distribute();
    },

    setVisible(on) {
      visible = on;
      applyVisible();
    },
    raise() {
      for (const l of lanes) l.win.raise();
    },
    owns: (w) => lanes.some((l) => l.win.owns(w)),
    setState(state, promptAt) {
      for (const l of lanes) l.stage.setState(state, promptAt);
    },
    focus(key) {
      for (const l of lanes) l.stage.focus(key);
    },
    tick() {
      for (const l of lanes) l.stage.tick();
    },
    releaseHeld() {
      cancelDrag();
      for (const l of lanes) l.stage.releaseHeld();
    },
    care: (id, action) => laneWith(id)?.stage.care(id, action),
    celebrate: (id) => laneWith(id)?.stage.celebrate(id),
    say: (id, keys, uris, ms) => laneWith(id)?.stage.say(id, keys, uris, ms),
    pin(id) {
      pinned = id;
      for (const l of lanes) l.stage.pin(id && l.stage.petOf(id) ? id : null);
    },
    petIds() {
      const on = new Set(lanes.flatMap((l) => l.stage.petIds()));
      return party.map((p) => p.id).filter((id) => on.has(id));
    },
    awakeIds: () => lanes.flatMap((l) => l.stage.awakeIds()),
    petOf: (id) => laneWith(id)?.stage.petOf(id) ?? null,
    heldId: () => lanes.map((l) => l.stage.heldId()).find((id) => id != null) ?? null,
    stageRectOf: (id) => laneWith(id)?.win.stage() ?? null,
    laneKeys: () => lanes.map((l) => l.key),
    alive: () => lanes.some((l) => l.win.alive()),
    isVisible: () => lanes.some((l) => l.win.isVisible()),
    size: () => lanes[0]?.win.size() ?? { w: 0, h: 0 },
    setPassing(on) {
      for (const l of lanes) l.win.setPassing(on);
    },
    sendClickThrough(on) {
      for (const l of lanes) l.win.sendClickThrough(on);
    },
    sendCry(id, uri, volume) {
      (laneWith(id) ?? lanes[0])?.win.sendCry(uri, volume);
    },
    sendCoach(view) {
      coach = view;
      sendCoachNow();
    },
    close() {
      for (const l of lanes) l.win.close();
      lanes = [];
    },
  };
}
