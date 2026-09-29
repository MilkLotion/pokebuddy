// 파티 상세 기기 창 — 관리 창이 정해 보낸 개체 하나를 그린다 (src/main/pet-window.ts). Figma 05 `Party / Detail Device` `908:23772`(기기 `862:22000`)
// 그린 뒤 높이를 알려 창 높이를 내용에 맞춘다. 이전·다음·닫기는 메인에 보내고, 울음소리는 받아서 여기서 튼다.
// 단추는 무엇을 할지만 관리 창에 돌려보낸다 — 명령과 대화상자(진화·성격·교체)는 관리 창이 처리한다
import type { PetDeviceAction, PetDeviceView } from "../shared/manage.js";
import { genderIcon } from "./gender.js";

const root = document.getElementById("device");
if (!(root instanceof HTMLElement)) throw new Error("pet.html 에 #device 가 없다");
const device: HTMLElement = root;
const api = window.pokebuddyPet;

const ZONE_WORD: Record<string, string> = { full: "배부름", normal: "보통", hungry: "배고픔", starving: "매우 배고픔" };

// 배고픔 디버프 — 관리 창 파티 칸의 `DEBUFF` 와 같은 이름·색 (docs/specs/balance.md "배고픔 디버프")
const DEBUFF_TONE: Record<string, "warning" | "danger"> = { hungry: "warning", starving: "danger" };

// 상태 배지 묶음 — 디버프 뒤에 켜진 버프(든든함·신남·들뜸). 하나도 없으면 null
function statusBadges(pet: PetDeviceView["pet"]): HTMLElement | null {
  const list: HTMLElement[] = [];
  const tone = DEBUFF_TONE[pet.zone];
  if (tone) list.push(el("span", `badge ${tone}`, ZONE_WORD[pet.zone] ?? pet.zone));
  for (const name of pet.buffNames ?? []) list.push(el("span", "badge success", name));
  if (!list.length) return null;
  const box = el("div", "status");
  box.append(...list);
  return box;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, text: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

// 누른 단추 — 지금 그린 개체 id 를 붙여 보낸다
type ActBody = PetDeviceAction extends infer A ? (A extends PetDeviceAction ? Omit<A, "petId"> : never) : never;
let shownPetId = "";
const act = (action: ActBody): void => api.act({ ...action, petId: shownPetId } as PetDeviceAction);

// 개체 상세 튜토리얼 — 파티 개체를 처음 열면 위에서 아래로 다섯 곳을 차례로 밝힌다 (Figma 05 `914:25889` ~ `914:26376`, 옛 관리 창 상세에서 옮김).
// 입력 규칙은 관리 창과 같다 — 막·구멍을 누르면 말풍선만 흔든다. 다음·확인·✕ 만 받는다 (worklog/records/tutorial-overhaul/record.md)
const DETAIL_STEPS = [
  { tut: "detail-ball", title: "볼을 눌러 넣고 꺼낼 수 있어요", body: "볼에 넣어도 파티에 남아 계속 자라요." },
  { tut: "detail-care", title: "여기서도 돌볼 수 있어요", body: "바탕화면 우클릭 메뉴의 밥 주기·놀아주기와 같아요." },
  { tut: "detail-growth", title: "진화와 성격", body: "조건을 채우면 진화를 눌러 직접 진화해요. 성격은 민트로 바꿔요." },
  { tut: "detail-size", title: "바탕화면 크기", body: "이 포켓몬의 크기만 바뀌어요." },
  { tut: "detail-manage", title: "교체와 박스 보관", body: "박스에 보관하면 성장이 멈춰요." },
] as const;
const COACH = { pad: 6, gap: 10, width: 280, margin: 8 };
let detailStep = 0;
let detailPetId: string | null = null; // 다른 개체를 열면 1단계부터
let coachEl: HTMLElement | null = null;
let lastView: PetDeviceView | null = null;

function drawCoach(): void {
  coachEl?.remove();
  coachEl = null;
  const v = lastView;
  if (!v || !v.tutorial) return;
  const step = DETAIL_STEPS[detailStep];
  const target = step ? device.querySelector<HTMLElement>(`[data-tut="${step.tut}"]`) : null;
  if (!step || !target) return;
  const last = detailStep === DETAIL_STEPS.length - 1;
  const layer = el("div", "coach");
  const r = target.getBoundingClientRect();
  const W = document.documentElement.clientWidth;
  const H = device.getBoundingClientRect().height;
  const hole = { l: Math.max(0, r.left - COACH.pad), t: Math.max(0, r.top - COACH.pad), r: Math.min(W, r.right + COACH.pad), b: Math.min(H, r.bottom + COACH.pad) };
  const bubble = el("div", "coach-bubble");
  const nudge = (): void => {
    bubble.classList.remove("nudge");
    void bubble.offsetWidth;
    bubble.classList.add("nudge");
  };
  const block = (cls: string, x: number, y: number, w: number, h: number): void => {
    const d = el("div", cls);
    Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });
    d.addEventListener("mousedown", (e) => {
      e.preventDefault();
      nudge();
    });
    layer.appendChild(d);
  };
  for (const [x, y, w, h] of [
    [0, 0, W, hole.t],
    [0, hole.b, W, H - hole.b],
    [0, hole.t, hole.l, hole.b - hole.t],
    [hole.r, hole.t, W - hole.r, hole.b - hole.t],
  ] as const) block("coach-dim", x, y, w, h);
  block("coach-block", hole.l, hole.t, hole.r - hole.l, hole.b - hole.t); // 안내만 한다 — 대상은 보이되 눌리지 않는다
  const head = el("div", "head");
  const x = button("x", "✕", () => act({ kind: "tutorial", action: "skip" }));
  x.setAttribute("aria-label", "튜토리얼 닫기");
  head.append(el("span", "step", `튜토리얼 · 개체 상세 ${detailStep + 1} / ${DETAIL_STEPS.length}`), x);
  const go = button("act primary", last ? "확인" : "다음", () => {
    if (last) act({ kind: "tutorial", action: "done" });
    else {
      detailStep += 1;
      drawCoach();
    }
  });
  const foot = el("div", "foot");
  foot.appendChild(go);
  bubble.append(head, el("div", "title", step.title), el("div", "body", step.body), foot);
  layer.appendChild(bubble);
  document.body.appendChild(layer);
  const bh = bubble.offsetHeight;
  const left = Math.min(Math.max(COACH.margin, r.left + r.width / 2 - COACH.width / 2), W - COACH.width - COACH.margin);
  const below = hole.b + COACH.gap;
  const top = below + bh > H - COACH.margin ? hole.t - COACH.gap - bh : below;
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(Math.max(COACH.margin, top))}px`;
  go.focus({ preventScroll: true });
  coachEl = layer;
}

// 튜토리얼 중에는 키보드 초점도 말풍선 안에 둔다
document.addEventListener(
  "focusin",
  (e) => {
    if (!coachEl || !(e.target instanceof Node) || coachEl.contains(e.target)) return;
    coachEl.querySelector<HTMLButtonElement>(".coach-bubble .act")?.focus({ preventScroll: true });
  },
  true,
);

// 남은 시간 — 관리 창 waitWord 와 같은 말
function waitWord(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return `${s}초`;
  const min = Math.ceil(s / 60);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

// 그림 자리 — 88×88 원. 빈 테두리를 잘라 들어가는 가장 큰 정수 배(최대 2배)로 그린다
const STAGE = { w: 88, h: 88, maxScale: 2 };

function sprite(uri: string): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = 0;
  out.height = 0;
  const img = new Image();
  img.onload = () => {
    const src = document.createElement("canvas");
    src.width = img.naturalWidth;
    src.height = img.naturalHeight;
    const sctx = src.getContext("2d");
    if (!sctx) return;
    sctx.drawImage(img, 0, 0);
    const { data, width, height } = sctx.getImageData(0, 0, src.width, src.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if ((data[(y * width + x) * 4 + 3] ?? 0) >= 128) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    if (x1 < 0) return;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const scale = Math.max(1, Math.min(STAGE.maxScale, Math.floor(STAGE.w / w), Math.floor(STAGE.h / h)));
    out.width = Math.min(w * scale, STAGE.w);
    out.height = Math.min(h * scale, STAGE.h);
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, x0, y0, w, h, (out.width - w * scale) / 2, (out.height - h * scale) / 2, w * scale, h * scale);
  };
  img.src = uri;
  return out;
}

let audio: HTMLAudioElement | null = null;
let volume = 0;

async function playCry(): Promise<void> {
  const uri = await api.cry();
  if (!uri) return;
  audio?.pause();
  audio = new Audio(uri);
  audio.volume = volume;
  void audio.play().catch(() => undefined);
}

// live — 시간으로만 바뀌는 값이면 그 필드. 새 보기가 모양은 같고 이 값만 다르면 막대만 고친다 (applyLive)
function bar(label: string, value: number, shown: string, cls = "", live?: "affinity" | "fullness" | "mood"): HTMLElement {
  const box = el("div", "bar");
  if (live) box.dataset.live = live;
  const head = el("div", "head");
  head.append(el("span", undefined, label), el("strong", undefined, shown));
  const track = el("div", "track");
  const fill = el("div", cls ? `fill ${cls}` : "fill");
  fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
  track.appendChild(fill);
  box.append(head, track);
  return box;
}

// 카드 한 줄 — 누를 수 있으면 단추다(진화·성격)
function line(title: string, desc: string | null, right: HTMLElement[], run?: () => void): HTMLElement {
  const row = run ? button("line", "", run) : el("div", "line");
  row.replaceChildren();
  const copy = el("div", "copy");
  copy.appendChild(el("strong", undefined, title));
  if (desc) copy.appendChild(el("span", undefined, desc));
  row.append(copy, ...right);
  if (run) row.appendChild(el("span", "go", "›"));
  return row;
}

// 막대 글자 — 친밀도 · 만복도(구간) · 기분(말)
function liveShown(pet: PetDeviceView["pet"], field: "affinity" | "fullness" | "mood"): string {
  if (field === "affinity") return `${pet.affinity}`;
  if (field === "fullness") return `${pet.fullness} · ${ZONE_WORD[pet.zone] ?? pet.zone}`;
  return `${pet.mood} · ${pet.moodWord}`;
}
const feedText = (pet: PetDeviceView["pet"]): string =>
  pet.fullness >= 100 ? "밥 주기 · 배부름" : pet.feedReady ? "밥 주기" : `밥 주기 · ${waitWord(pet.feedInSec)}`;

// 시간으로만 바뀌는 값 — 이것만 다르면 다시 그리지 않고 표시만 고친다. 관리 창(src/renderer/manage.ts structureOf)과 같은 목록이다
// 다시 그리면 키보드 포커스·title 툴팁이 사라진다 (2026-09-29 검수 C2)
const LIVE_KEYS = new Set(["feedInSec", "affinity", "mood", "moodWord", "remainSec", "percent", "remainMin"]);
const structureOf = (v: PetDeviceView): string =>
  JSON.stringify(v, (k: string, val: unknown) => (LIVE_KEYS.has(k) ? undefined : k === "fullness" && typeof val === "number" ? val >= 100 : val));
let renderedStructure = "";

function applyLive(v: PetDeviceView): void {
  const pet = v.pet;
  for (const box of device.querySelectorAll<HTMLElement>(".bar[data-live]")) {
    const field = box.dataset.live as "affinity" | "fullness" | "mood";
    const shown = box.querySelector<HTMLElement>(".head strong");
    if (shown) shown.textContent = liveShown(pet, field);
    const fill = box.querySelector<HTMLElement>(".fill");
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, pet[field]))}%`;
  }
  const feed = device.querySelector<HTMLButtonElement>('[data-live="feed"]');
  if (feed) feed.textContent = feedText(pet);
  lastView = v;
}

// 다시 그린 뒤 포커스를 같은 자리로 — 기기 창 안의 자식 번호 길과 태그·클래스가 같은 요소
function focusPath(): { path: number[]; sign: string } | null {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || !device.contains(a) || a === device) return null;
  const path: number[] = [];
  for (let n: Element = a; n !== device; n = n.parentElement as Element) path.unshift([...(n.parentElement?.children ?? [])].indexOf(n));
  return { path, sign: `${a.tagName}.${a.className}` };
}
function restoreFocus(kept: { path: number[]; sign: string } | null): void {
  if (!kept || (document.activeElement && document.activeElement !== document.body)) return;
  let n: Element | undefined = device;
  for (const i of kept.path) n = n?.children[i];
  if (n instanceof HTMLElement && `${n.tagName}.${n.className}` === kept.sign) n.focus({ preventScroll: true });
}

function render(v: PetDeviceView): void {
  const kept = focusPath();
  renderedStructure = structureOf(v);
  renderBody(v);
  restoreFocus(kept);
}

function renderBody(v: PetDeviceView): void {
  const pet = v.pet;
  shownPetId = pet.id;
  volume = v.volume;
  device.className = `device${v.side === "left" ? " left" : ""}`;
  device.replaceChildren();
  device.appendChild(el("div", "hinge"));

  const top = el("div", "top");
  top.appendChild(el("div", "light"));
  for (const c of ["#ff6b6b", "#ffd84a", "#6ad06a"]) {
    const led = el("div", "led");
    led.style.background = c;
    top.appendChild(led);
  }
  top.appendChild(el("div", "title", "파티"));
  const close = button("close", "✕", () => api.close());
  close.title = "닫기";
  top.appendChild(close);
  device.appendChild(top);

  // 화면 — 자리·상태, 초상·이름·레벨·성격·타입, 볼 토글
  const bezel = el("div", "bezel");
  const screen = el("div", "screen");
  screen.appendChild(el("div", "where", v.where));
  const entry = el("div", "entry");
  const stage = el("div", "stage");
  if (v.portrait) stage.appendChild(sprite(v.portrait));
  entry.appendChild(stage);
  const info = el("div", "info");
  // 이름 줄 — 이름 · 성별 24 (Figma `862:22000` 의 `gender`, 2026-09-30 사용자 결정)
  const nameRow = el("div", "name-row");
  nameRow.appendChild(el("div", "name", pet.name));
  const sex = genderIcon(pet.gender, 24);
  if (sex) nameRow.appendChild(sex);
  info.appendChild(nameRow);
  info.appendChild(el("div", "sub", `Lv.${pet.level} · ${pet.nature}`));
  const types = el("div", "types");
  pet.types.forEach((name, i) => {
    const badge = el("span", "type", name);
    const id = pet.typeIds[i];
    if (id) badge.dataset.type = id;
    types.appendChild(badge);
  });
  info.appendChild(types);
  entry.appendChild(info);
  screen.appendChild(entry);
  if (v.inParty) {
    const action = pet.hidden ? "꺼내기" : "볼에 넣기";
    const ball = button(`ball-toggle ${pet.hidden ? "closed" : "open"}`, "", () => act({ kind: "cmd", cmd: pet.hidden ? "party.show" : "party.hide" }));
    ball.dataset.tut = "detail-ball";
    ball.title = action;
    ball.setAttribute("aria-label", action);
    screen.appendChild(ball);
    // 상태 배지 — 화면 오른쪽 아래. 화면 높이가 정해져 있어 배지가 생겨도 아래 칸이 밀리지 않는다 (2026-09-30 사용자 결정, Figma `862:22000` 의 `status`)
    const badges = statusBadges(pet);
    if (badges) screen.appendChild(badges);
  }
  bezel.appendChild(screen);
  device.appendChild(bezel);

  // 기록 칸 — 네 막대 2×2
  const records = el("div", "records");
  records.append(
    bar("경험치", pet.percentToNext, `${pet.percentToNext}%`),
    bar("친밀도", pet.affinity, liveShown(pet, "affinity"), "", "affinity"),
    bar("만복도", pet.fullness, liveShown(pet, "fullness"), pet.zone === "hungry" || pet.zone === "starving" ? pet.zone : "", "fullness"),
    bar("기분", pet.mood, liveShown(pet, "mood"), "mood", "mood"),
  );
  device.appendChild(records);

  // 흰 판 — 돌봄 · 성장 · 크기 · 관리
  const actions = el("div", "actions");
  if (v.inParty) {
    const full = pet.fullness >= 100;
    const care = el("div", "row");
    care.dataset.tut = "detail-care";
    const feed = button("act primary", feedText(pet), () => act({ kind: "cmd", cmd: "feed" }), !pet.feedReady || full);
    feed.dataset.live = "feed";
    care.append(
      feed,
      button("act", pet.playReady ? "놀아주기" : "놀아주기 · 쉬는 중", () => act({ kind: "cmd", cmd: "play" }), !pet.playReady),
    );
    actions.appendChild(care);
  }
  const ready = pet.evolutions.filter((e) => e.ready);
  const evolve = (): void => act({ kind: "dialog", dialog: "evolve" });
  const evoLine = !pet.evolutions.length
    ? line("진화", "더 진화하지 않아요", [])
    : ready.length
      ? line(`진화 · ${ready.map((e) => e.name).join(" · ")}`, null, [el("span", "chip-ready", "진화 가능")], evolve)
      : line(`진화 · ${pet.evolutions.map((e) => e.name).join(" · ")}`, pet.evolutions.map((e) => e.need ?? "").filter(Boolean).join(" · ") || null, [], evolve);
  const growth = el("div", "card");
  growth.dataset.tut = "detail-growth";
  growth.append(evoLine, line(`성격 · ${pet.nature}`, null, [], () => act({ kind: "dialog", dialog: "nature" })));
  actions.appendChild(growth);
  if (v.inParty) {
    const sizes = el("div", "sizes");
    sizes.setAttribute("role", "group");
    sizes.setAttribute("aria-label", "크기");
    for (let n = 1; n <= v.sizeLevels; n++) {
      const b = button("size", String(n), () => {
        if (n !== pet.size) act({ kind: "cmd", cmd: "pet.set", args: { size: n } });
      });
      b.setAttribute("aria-pressed", String(n === pet.size));
      sizes.appendChild(b);
    }
    const size = el("div", "card");
    size.dataset.tut = "detail-size";
    size.appendChild(line("크기", null, [sizes]));
    actions.appendChild(size);
  }
  const manage = el("div", "row");
  manage.dataset.tut = "detail-manage";
  if (v.inParty) {
    manage.append(
      button("act", "교체", () => act({ kind: "dialog", dialog: "pick-box" })),
      button("act", "박스에 보관", () => act({ kind: "dialog", dialog: "keep" })), // 관리 창에서 확인한 뒤 보낸다
    );
  } else if (v.emptySlot != null) {
    const slotIndex = v.emptySlot;
    manage.appendChild(button("act primary", "파티에 배치", () => act({ kind: "cmd", cmd: "party.place", args: { slotIndex } })));
  } else {
    manage.appendChild(button("act primary", "교체", () => act({ kind: "dialog", dialog: "pick-slot" })));
  }
  actions.appendChild(manage);
  if (v.notice) actions.appendChild(el("div", "notice", v.notice));
  device.appendChild(actions);

  const controls = el("div", "controls");
  const cry = button("cry", "울음소리", () => void playCry(), v.volume <= 0); // 설정에서 소리를 끄면 막는다
  controls.append(button("prev", "◀ 이전", () => api.step(-1)), cry, button("next", "다음 ▶", () => api.step(1)));
  device.appendChild(controls);

  api.size(device.getBoundingClientRect().height);
  if (detailPetId !== pet.id) {
    detailPetId = pet.id;
    detailStep = 0; // 다른 개체를 열면 튜토리얼은 1단계부터
  }
  lastView = v;
  drawCoach();
}

// 방향키로도 넘긴다. Esc 는 닫는다
document.addEventListener("keydown", (e) => {
  if (coachEl) return; // 튜토리얼 중에는 넘기지도 닫지도 않는다 — 다음·확인·✕ 만 받는다
  if (e.key === "ArrowLeft") api.step(-1);
  else if (e.key === "ArrowRight") api.step(1);
  else if (e.key === "Escape") api.close();
});

// 관리 창은 1초 시계마다 값이 바뀌면 다시 보낸다(쿨타임·만복도). 누르는 중(눌렀다 떼기 사이)에 다시 그리면 단추 누름이 사라진다 —
// 그동안 온 보기는 들고 있다가 뗀 뒤에 그린다
let pointerDown = false;
let pending: PetDeviceView | null = null;
const show = (view: PetDeviceView): void => {
  // 글꼴을 읽은 뒤에 재야 높이가 맞는다
  void document.fonts.ready.then(() => render(view));
};
const release = (): void => {
  pointerDown = false;
  const next = pending;
  pending = null;
  if (next) setTimeout(() => show(next), 0); // 누른 단추의 click 이 먼저 돌게 한 틱 미룬다
};
document.addEventListener("pointerdown", () => (pointerDown = true), true);
document.addEventListener("pointerup", release, true);
document.addEventListener("pointercancel", release, true);
window.addEventListener("blur", release);

api.onShow((view) => {
  // 모양이 같으면 표시만 고친다 — 누르는 중에도 된다(요소를 바꾸지 않는다)
  if (renderedStructure && structureOf(view) === renderedStructure) return applyLive(view);
  if (pointerDown) pending = view;
  else show(view);
});
