// 무대 틱과 포인터 처리. 포켓몬 겹침 허용. 소환 순서대로 그리기.
import { axesAt } from "../dex/natures";
import { profile } from "../dex/species";
import { paramsFor, NEUTRAL_PARAMS } from "../motion/params";
import { capsOf, createPetMotion } from "../motion/pet-motion";
import type { PetMotion, Phase } from "../motion/types";
import type { HitReply, Play, PointerMsg, StageFrame, StageState } from "../shared/stage";
import type { CareAction } from "../state/types";
import { MOTION_RULES } from "../motion/rules";
import { zoomOf, type ArtLoader, type Look } from "./art";
import { STAGE_RULES, clampInStage, homeOf, homeSpot, roamBox, stackShift, type Home, type Rect, type Size, type Spot } from "./layout";
import type { PartyPet } from "./save-party";
import type { StageWindow } from "./stage-window";

// 작업 상태가 바뀐 뒤 마리마다 반응하기까지 최대 지연 — 0~이 값 사이에서 무작위
const REACT_SPREAD_MS = 1200;

export interface StageOptions {
  buddyMode: "on" | "calm" | "off"; // off 면 움직임 없이 집에 서 있다 (상태 동작만)
  timeScale: number;
  window: StageWindow;
  art: ArtLoader;
  ghost(): boolean; // 클릭 통과(고스트) 설정 — 켜져 있으면 히트 판정을 하지 않는다
  cursor?(): Spot | null;
  onDrop(id: string, home: Home): void; // 놓았다 — 부르는 쪽이 저장한다 (가짜 창 위에서는 부르지 않는다)
  onClick(id: string): void;
  onMenu(id: string): void;
  onArtMissing(pet: PartyPet): void; // PMD 를 못 받았다 — 무대에 나오지 않는다
  now?: () => number;
  log?: ((o: Record<string, unknown>) => void) | null;
}

interface PetState {
  evolvingUntil?: number;
  bubble?: { text: string; until: number };
  quirkKey?: string;
  care: { action: "feed" | "play"; target: Spot; until: number; eatingAt: number | null; last: number } | null;
  pet: PartyPet;
  look: Look;
  zoom: number;
  body: Size; // 몸 (DIP) — body 칸 × zoom
  motion: PetMotion | null;
  roam: Spot; // brain 의 산책 오프셋
  offset: Spot; // 돌봄 이동과 화면 경계 보정
  pos: Spot; // 지금 몸 좌상단 (무대 안 좌표)
  dragPos: Spot | null; // 들고 있는 동안의 자리
  play: Play | null;
  phase: Phase | null;
  held: boolean;
}

export interface Stage {
  setParty(list: PartyPet[]): Promise<void>; // 목록이 바뀌었다 — 새 마리의 그림을 받고, 빠진 마리를 뺀다
  setStage(anchor: Rect, size: Size, fake: boolean): void; // 무대가 바뀌었다 — anchor 는 따라가는 창을 무대 안 좌표로 옮긴 것
  setVisible(on: boolean): void;
  setState(state: StageState, promptAt: number | null): void;
  focus(key: string | null): void;
  tick(): void; // 40ms
  pointer(msg: PointerMsg): void;
  hit(id: HitReply): void; // 렌더러의 답 — 커서 밑의 마리
  releaseHeld(): void; // 들고 있던 마리를 놓은 것으로 친다 — pointerup 이 영영 안 오는 경로의 탈출구. 저장하지 않는다
  resend(): void; // 렌더러가 새로 떴다 — init · 모든 look 의 sheets · 마지막 frame 을 다시 보낸다
  poke(id: string): boolean;
  care(id: string, action: CareAction): void;
  celebrate(id: string): void;
  say(id: string, text: string, ms: number): void; // 말풍선을 ms 동안 — 배고픔 구간 진입 (docs/specs/s5.md "배고픔 말풍선")
  petIds(): string[];
  petOf(id: string): PartyPet | null;
  heldId(): string | null;
  lastFrame(): StageFrame | null;
  pin(id: string | null): void; // 그 마리를 제자리에 세운다(걷지 않고 서 있는 동작). null 이면 풀고 선 자리에서 다시 움직인다 — 첫 돌봄 튜토리얼
}

export function createStage(opts: StageOptions): Stage {
  const { buddyMode, timeScale, window: win, art } = opts;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? null;
  const pets = new Map<string, PetState>();
  let order: string[] = []; // 소환 순서. 목록 갱신과 드래그로 변경하지 않음
  let anchor: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let size: Size = { w: 0, h: 0 };
  let fake = false; // 가짜 창(작업 영역) 위 — 이 기준으로 집을 저장하면 진짜 창이 왔을 때 화면 기준 오프셋이 되어 튄다
  let visible = false;
  let agent: StageState = "idle";
  let held: string | null = null;
  let pinned: string | null = null;
  let generation = 0; // setParty 가 겹쳐 불렸을 때 옛 호출이 결과를 덮지 않게
  const sentLooks = new Set<string>();
  let last: StageFrame | null = null;

  const shiftOf = (body: Size): number => stackShift(body);
  const spotOf = (p: PetState): Spot => homeSpot(p.pet.home, p.body, anchor, size, shiftOf(p.body));
  // 집 + 산책 + 돌봄 이동을 화면 안으로 제한
  const settle = (p: PetState): Spot => {
    const s = spotOf(p);
    const pos = clampInStage(s.x + p.roam.x + p.offset.x, s.y + p.roam.y + p.offset.y, p.body, size);
    p.offset = { x: pos.x - s.x - p.roam.x, y: pos.y - s.y - p.roam.y };
    return pos;
  };

  function makeMotion(pet: PartyPet, look: Look, zoom: number): PetMotion | null {
    if (buddyMode === "off") return null;
    const params = pet.nature ? paramsFor(axesAt(pet.nature, pet.id, now())) : { ...NEUTRAL_PARAMS };
    if (pet.nature) params.sleepScale /= profile(pet.species).sleepiness;
    return createPetMotion({
      caps: capsOf({ anims: look.art.anims, work: look.art.work, workOnly: look.art.workOnly, zoom }),
      mode: buddyMode,
      timeScale,
      // 여러 마리가 같은 신호에 같은 틱에 움직이면 똑같아 보인다 — 마리마다 반응 시점을 어긋낸다
      reactMs: REACT_SPREAD_MS,
      params,
      now: now(),
      log: log ? (o) => log({ pet: pet.id, ...o }) : null,
    });
  }

  function sendSheets(look: Look): void {
    win.sendSheets(look.sheets);
    sentLooks.add(look.look);
  }

  // 나중에 소환한 마리가 앞. 드래그 중에도 같은 순서
  function drawOrder(): PetState[] {
    return order.flatMap((id) => { const pet = pets.get(id); return pet ? [pet] : []; });
  }

  function release(id: string): void {
    const p = pets.get(id);
    if (held === id) held = null;
    if (!p) return;
    p.held = false;
    p.dragPos = null;
    p.roam = { x: 0, y: 0 };
    p.motion?.rehome(now()); // 사용자가 놓은 게 아니므로 집은 그대로고, 다음 틱이 마리를 집으로 되돌린다
  }

  return {
    async setParty(list) {
      const gen = ++generation;
      const keep = new Set(list.map((p) => p.id));
      for (const id of [...pets.keys()]) {
        if (keep.has(id)) continue;
        if (held === id) release(id);
        pets.delete(id);
      }
      order = order.filter((id) => keep.has(id));
      for (const pet of list) {
        const cur = pets.get(pet.id);
        if (cur && cur.look.look === pet.look) {
          // 집·별명·크기가 바뀌었을 수 있다 (파일 감시). 크기가 바뀌면 배율과 움직임(걷는 속도)을 다시 만든다
          const zoom = zoomOf(pet.size, cur.look.art.body);
          if (zoom !== cur.zoom || pet.nature !== cur.pet.nature || pet.species !== cur.pet.species) {
            cur.zoom = zoom;
            cur.body = { w: cur.look.art.body.w * zoom, h: cur.look.art.body.h * zoom };
            cur.motion = makeMotion(pet, cur.look, zoom);
          }
          cur.pet = { ...pet, home: { ...pet.home } };
          continue;
        }
        const look = await art.loadLook(pet.look);
        if (gen !== generation) return; // 새 목록이 왔다 — 그쪽이 이어 간다
        if (!look) {
          opts.onArtMissing(pet);
          continue;
        }
        if (held === pet.id) release(pet.id);
        const zoom = zoomOf(pet.size, look.art.body);
        pets.set(pet.id, {
          pet: { ...pet, home: { ...pet.home } },
          look,
          zoom,
          body: { w: look.art.body.w * zoom, h: look.art.body.h * zoom },
          motion: makeMotion(pet, look, zoom),
          roam: { x: 0, y: 0 },
          offset: { x: 0, y: 0 },
          pos: { x: 0, y: 0 },
          dragPos: null,
          play: null,
          phase: null,
          held: false,
          care: null,
        });
        sendSheets(look);
        if (!order.includes(pet.id)) order.push(pet.id);
        log?.({ stage: "pet", id: pet.id, look: look.look, zoom, body: `${look.art.body.w}x${look.art.body.h}`, cell: `${look.art.cell.w}x${look.art.cell.h}` });
      }

    },

    setStage(nextAnchor, nextSize, nextFake) {
      anchor = { ...nextAnchor };
      size = { ...nextSize };
      fake = nextFake;
      const h = held ? pets.get(held) : null;
      if (h?.dragPos) h.dragPos = clampInStage(h.dragPos.x, h.dragPos.y, h.body, size);
    },

    setVisible(on) {
      visible = on;
      if (!on) for (const p of pets.values()) p.care = null;
    },

    setState(state, promptAt) {
      agent = state;
      const t = now();
      for (const p of pets.values()) p.motion?.state(state, promptAt, t);
    },

    focus(key) {
      const t = now();
      for (const p of pets.values()) p.motion?.focus(key, t);
    },

    tick() {
      const t = now();
      win.hoverTick(held != null, opts.ghost());
      if (size.w <= 0 || size.h <= 0) return; // 아직 따라갈 창이 없다
      const cursor = opts.cursor?.() ?? null;
      const positions = drawOrder().map((p) => ({ id: p.pet.id, x: p.pos.x + p.body.w / 2, y: p.pos.y + p.body.h / 2 }));
      for (const id of order) {
        const p = pets.get(id);
        if (!p) continue;
        if (p.pet.nature === "quirky" && p.motion) {
          const axes = axesAt("quirky", id, t);
          const key = Object.values(axes).join(",");
          if (key !== p.quirkKey) {
            const params = paramsFor(axes);
            params.sleepScale /= profile(p.pet.species).sleepiness;
            p.motion.tune(params);
            p.quirkKey = key;
          }
        }
        if (id === pinned && !p.care && !p.held) p.play = null; // 세운 마리는 산책을 멈추고 서 있는 동작만. 들거나 돌보는 중이면 평소대로
        else if (p.motion && !p.care) {
          const home = spotOf(p);
          const local = (s: Spot): Spot => ({ x: s.x - home.x - p.offset.x - p.body.w / 2, y: s.y - home.y - p.offset.y - p.body.h / 2 });
          const out = p.motion.tick({ now: t, agent, box: roamBox(home, p.body, size), visible, company: positions.filter((s) => s.id !== id).map(local), cursor: cursor ? local(cursor) : null });
          p.play = out.act;
          p.phase = out.phase;
          if (!p.held) p.roam = out.roam;
        }
        p.pos = p.held && p.dragPos ? p.dragPos : settle(p);
        const action = p.care;
        if (action && !p.held && visible) {
          const dt = Math.max(0, Math.min(STAGE_RULES.care.maxStepMs, t - action.last));
          action.last = t;
          action.target = clampInStage(action.target.x, action.target.y, p.body, size);
          const dx = action.target.x - p.pos.x, dy = action.target.y - p.pos.y;
          const distance = Math.hypot(dx, dy);
          const step = Math.min(distance, dt * STAGE_RULES.care.speedPerZoom * p.zoom);
          const walking = distance > STAGE_RULES.care.arrivalPx && !!p.look.art.anims.Walk;
          if (walking) {
            p.pos = clampInStage(p.pos.x + dx / distance * step, p.pos.y + dy / distance * step, p.body, size);
            p.play = { anim: "Walk", row: MOTION_RULES.rowOf(dx, dy), mode: "loop", rate: 1 };
          } else {
            if (action.eatingAt == null) action.eatingAt = t;
            const anim = [action.action === "feed" ? "Eat" : "Hop", "Nod", "Idle"].find((a) => p.look.art.anims[a]);
            if (anim) p.play = { anim, row: 0, mode: "loop", rate: 1 };
          }
          const home = spotOf(p);
          p.offset = { x: p.pos.x - home.x - p.roam.x, y: p.pos.y - home.y - p.roam.y };
          p.phase = walking ? "walk" : "fidget";
          // 도착한 뒤 밥은 eatMs, 놀이는 playMs 만큼 반응하고 끝난다. until 은 걸어가다 막혔을 때의 상한이다
          const doneMs = action.action === "feed" ? STAGE_RULES.care.eatMs : STAGE_RULES.care.playMs;
          if (t >= action.until || (action.eatingAt != null && t - action.eatingAt >= doneMs)) {
            p.care = null;
            p.motion?.rehome(t);
            p.roam = { x: 0, y: 0 };
            p.offset = { x: p.pos.x - home.x, y: p.pos.y - home.y };
          }
        }
      }
      const frame: StageFrame = {
        at: t,
        state: agent,
        pets: drawOrder().map((p) => ({ id: p.pet.id, look: p.look.look, zoom: p.zoom, x: p.pos.x, y: p.pos.y, play: p.play, held: p.held,
          ...(p.evolvingUntil && t < p.evolvingUntil ? { evolution: (p.evolvingUntil - t) / 1200 } : {}),
          ...(p.bubble && t < p.bubble.until ? { bubble: p.bubble.text } : {}),
          ...(p.care?.action === "feed" ? { berry: { x: p.care.target.x + p.body.w / 2, y: p.care.target.y + p.body.h - 4 } } : {}) })),
      };
      last = frame;
      if (visible) win.sendFrame(frame);
    },

    // 포인터로 마리를 만졌다 — 렌더러는 무대 안 좌표만 알려 주고, 옮기기·반응·저장은 여기서 한다
    pointer(msg) {
      const p = pets.get(msg.id);
      if (!p) return;
      const t = now();
      if (msg.type === "grab") {
        p.care = null;
        if (held && held !== msg.id) release(held);
        held = msg.id;
        p.held = true;
        p.dragPos = { ...p.pos };
        p.motion?.pickup(t);
      } else if (msg.type === "drag") {
        if (held !== msg.id) return;
        // 끄는 중에도 무대 안에 가둔다 — 가장자리에 붙어 따라오고, 놓을 때 튀어 들어가지 않는다
        const next = clampInStage(msg.x, msg.y, p.body, size);
        p.motion?.drag(next.x - p.pos.x, next.y - p.pos.y);
        p.dragPos = next;
        p.pos = next;
      } else if (msg.type === "drop") {
        // 렌더러는 click-through(true) 를 받으면 스스로 drop 을 보낸다 — 이미 놓았으면(releaseHeld) 조용히 넘긴다
        if (held !== msg.id) return;
        held = null;
        p.held = false;
        const at = p.dragPos ?? p.pos;
        p.dragPos = null;
        p.roam = { x: 0, y: 0 }; // 놓은 자리가 새 집 — 산책분은 집에 들어간다
        p.offset = { x: 0, y: 0 };
        const home = homeOf(at, p.body, anchor, shiftOf(p.body));
        p.pet.home = home;
        p.pos = settle(p);
        if (!fake) opts.onDrop(msg.id, home);
        p.motion?.drop(t);
        log?.({ stage: "drop", id: msg.id, at, home, saved: !fake });
      } else if (msg.type === "click") {
        p.motion?.click(t);
        opts.onClick(msg.id);
      } else if (msg.type === "menu") {
        opts.onMenu(msg.id);
      }
    },

    hit(id) {
      if (opts.ghost()) return;
      win.setPassing(held ? false : id == null);
    },

    releaseHeld() {
      if (held) release(held);
    },

    resend() {
      win.sendInit();
      for (const look of sentLooks) {
        const cached = art.cached(look);
        if (cached) win.sendSheets(cached.sheets);
      }
      win.sendClickThrough(opts.ghost());
      if (last) win.sendFrame(last);
    },

    poke(id) {
      const p = pets.get(id);
      if (!p) return false;
      p.motion?.click(now());
      return true;
    },

    care(id, action) {
      const p = pets.get(id);
      if (!p) return;
      p.motion?.click(now());
      if (action === "poke") return;
      const t = now();
      p.care = { action, target: clampInStage(p.pos.x + (p.pos.x > size.w / 2 ? -1 : 1) * STAGE_RULES.care.foodOffsetPx, p.pos.y, p.body, size), until: t + STAGE_RULES.care.durationMs, eatingAt: null, last: t };
    },

    say(id, text, ms) {
      const p = pets.get(id);
      if (p) p.bubble = { text, until: now() + ms };
    },
    celebrate(id) {
      const p = pets.get(id);
      if (p) { p.evolvingUntil = now() + 1200; p.motion?.click(now()); }
    },
    petIds: () => order.filter((id) => pets.has(id)),
    petOf: (id) => pets.get(id)?.pet ?? null,
    heldId: () => held,
    pin(id) {
      if (id === pinned) return;
      // 풀린 마리는 선 자리를 지킨다 — 산책분을 오프셋으로 옮기고 걷던 길을 버린다(집은 그대로, 저장하지 않는다)
      const was = pinned ? pets.get(pinned) : undefined;
      if (was) {
        was.offset = { x: was.offset.x + was.roam.x, y: was.offset.y + was.roam.y };
        was.roam = { x: 0, y: 0 };
        was.motion?.rehome(now());
      }
      pinned = id;
    },
    lastFrame: () => last,
  };
}
