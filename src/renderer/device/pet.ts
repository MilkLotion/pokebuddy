// 파티 상세 기기 창 — 관리 창이 정해 보낸 개체 하나를 그린다 (src/main/pet-window.ts). Figma 05 `Party / Detail Device` `908:23772`(기기 `862:22000`)
// 배치는 시안 C 다 (2026-10-02 사용자 결정 "c로 확정", Figma `Party Detail Device` `1262:76637` — 변형 셋을 C 배치로 바꿨다)
//   화면  자리·상태 → 초상·이름·레벨·타입 → 네 막대(경험치·친밀도·만복도·기분)
//   몸통  돌봄 단추 둘(밥 주기는 밝은 단추)
//   흰 판 포인트 적립 · 진화 · 도감 보기 · 크기 줄을 구분선으로 나눈 목록
// 메가스톤을 지닌 개체는 초상 오른쪽 아래에 메가스톤 표식이 있다. 누르면 메가진화한다 (같은 날 사용자 결정)
// 그린 뒤 높이를 알려 창 높이를 내용에 맞춘다. 이전·다음·닫기는 메인에 보내고, 울음소리는 받아서 여기서 튼다.
// 단추는 무엇을 할지만 관리 창에 돌려보낸다 — 명령과 대화상자(진화·성격·교체)는 관리 창이 처리한다
import type { PetDeviceAction, PetDeviceView } from "../../shared/model/devices.js";
import { genderIcon } from "../ui/gender-icon.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { sprite } from "../ui/portrait.js";
import { buttonEl, el } from "../ui/dom.js";

const root = document.getElementById("device");
if (!(root instanceof HTMLElement)) throw new Error("pet.html 에 #device 가 없다");
const device: HTMLElement = root;
const api = window.pokebuddyPet;

// 창 높이 맞추기 — 그린 직후 한 번 알리고, 그 뒤 #device 높이가 바뀔 때마다 다시 알린다
// - 늦게 온 글꼴로 줄바꿈이 늘어도 창이 따라간다. 안 하면 아래가 잘린다 (worklog/records/features-0930/record.md 6번)
// - ResizeObserver 는 한 프레임에 한 번 부른다. 지난번과 같은 높이면 보내지 않는다
// - #device 는 폭 고정·높이 내용 기준이다. 창 크기가 바뀌어도 #device 높이는 그대로라 다시 불리지 않는다
// - 튜토리얼 막은 body 에 fixed 로 붙어 #device 높이에 들지 않는다. 높이가 바뀌면 막 자리를 다시 잡는다
let sentHeight = -1;
function sendSize(force: boolean): boolean {
  const h = Math.ceil(device.getBoundingClientRect().height);
  if (!force && h === sentHeight) return false;
  sentHeight = h;
  api.size(h);
  return true;
}
// 첫 render() 전(sentHeight < 0)에는 보내지 않는다 — 빈 #device 높이로 숨은 새 창이 먼저 보이면 안 된다
new ResizeObserver(() => {
  if (sentHeight >= 0 && sendSize(false) && coachEl) drawCoach();
}).observe(device);

// 쓰는 글꼴 — 빈 문서는 글꼴을 아직 요청하지 않아 fonts.ready 가 바로 끝난다. 첫 측정 전에 직접 부른다
// - 굵기별로 파일이 따로다: Galmuri11 400·700, Galmuri9 400 (pet.html @font-face)
// - 실패해도 그리기는 한다. 늦게 오면 위 ResizeObserver 가 높이를 고친다
const fontsReady: Promise<unknown> = Promise.allSettled(
  ['400 12px "Galmuri11"', '700 12px "Galmuri11"', '400 10px "Galmuri9"'].map((f) => document.fonts.load(f)),
).then(() => document.fonts.ready);

const ZONE_WORD: Record<string, string> = { full: "배부름", normal: "보통", hungry: "배고픔", starving: "매우 배고픔" };

// 배고픔 디버프 — 관리 창 파티 칸의 `DEBUFF` 와 같은 이름·색 (docs/specs/balance.md "배고픔 디버프")
const DEBUFF_TONE: Record<string, "warning" | "danger"> = { hungry: "warning", starving: "danger" };

// 버프 배지 — 이름과 남은 시간. 1시간 미만은 분(0분이면 1분), 그 위는 시간(올림).
// 관리 창(src/renderer/manage/manage.ts buffBadge)과 같은 규칙이다 — 고칠 때 함께 고친다
const buffBadge = (b: PetDeviceView["pet"]["buffs"][number]): string =>
  `${b.name} ${b.remainMin < 60 ? `${Math.max(1, b.remainMin)}분` : `${Math.ceil(b.remainMin / 60)}시간`}`;

// 상태 배지 묶음 — 디버프 뒤에 켜진 버프(든든함·신남·들뜸). 하나도 없으면 null
function statusBadges(pet: PetDeviceView["pet"]): HTMLElement | null {
  const list: HTMLElement[] = [];
  const tone = DEBUFF_TONE[pet.zone];
  if (tone) list.push(el("span", `badge ${tone}`, ZONE_WORD[pet.zone] ?? pet.zone));
  for (const buff of pet.buffs ?? []) {
    const badge = el("span", "badge success", buffBadge(buff));
    badge.dataset.liveBuff = buff.kind; // 남은 분은 1초 시계가 고친다 (applyLive)
    list.push(badge);
  }
  if (!list.length) return null;
  const box = el("div", "status");
  box.append(...list);
  return box;
}

// 누른 단추 — 지금 그린 개체 id 를 붙여 보낸다
type ActBody = PetDeviceAction extends infer A ? (A extends PetDeviceAction ? Omit<A, "petId"> : never) : never;
let shownPetId = "";
const act = (action: ActBody): void => api.act({ ...action, petId: shownPetId } as PetDeviceAction);

// 성격을 화면에 보일지 — 2026-09-30 사용자 결정 "성격은 없앨거야 … 코드는 남겨두고". 성격 부여·저장은 그대로다.
// 관리 창 src/renderer/manage/manage.ts NATURE_UI, 메인 src/dex/natures.ts NATURE_SHOWN 과 같이 바꾼다
const NATURE_UI = false;

// 개체 상세 튜토리얼 — 파티 개체를 처음 열면 위에서 아래로 다섯 곳을 차례로 밝힌다 (Figma 05 `914:25889` ~ `914:26376`, 옛 관리 창 상세에서 옮김).
// 입력 규칙은 관리 창과 같다 — 막·구멍을 누르면 말풍선만 흔든다. 다음·확인·✕ 만 받는다 (worklog/records/tutorial-overhaul/record.md)
const DETAIL_STEPS = [
  { tut: "detail-ball", title: "볼을 눌러 넣고 꺼낼 수 있어요", body: "볼에 넣어도 파티에 남아 계속 자라요." },
  { tut: "detail-care", title: "여기서도 돌볼 수 있어요", body: "바탕화면 우클릭 메뉴의 밥 주기·놀아주기와 같아요." },
  NATURE_UI
    ? { tut: "detail-growth", title: "진화와 성격", body: "조건을 채우면 진화를 눌러 직접 진화해요. 성격민트로 성격을 바꿔요." }
    : { tut: "detail-growth", title: "진화", body: "조건을 채우면 진화를 눌러 직접 진화해요." },
  { tut: "detail-size", title: "바탕화면 크기", body: "이 포켓몬의 크기만 바뀌어요." },
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
  const x = buttonEl("x", "✕", () => act({ kind: "tutorial", action: "skip" }));
  x.setAttribute("aria-label", "튜토리얼 닫기");
  head.append(el("span", "step", `튜토리얼 · 개체 상세 ${detailStep + 1} / ${DETAIL_STEPS.length}`), x);
  const go = buttonEl("act primary", last ? "확인" : "다음", () => {
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

// 그림 자리 — 88×88 네모. 빈 테두리를 잘라 들어가는 가장 큰 정수 배(최대 2배)로 그린다 (portrait.ts sprite)
const STAGE = { w: 88, h: 88, maxScale: 2 };
// 메가스톤 표식 — 28×28. 키스톤 그림(30×30 안의 14×14)의 빈 테두리를 잘라 두 배로 그린다
const MEGA_STONE = { w: 28, h: 28, maxScale: 2 };

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

// 진화 줄의 결과 종 이름 — 도감 미해금 종은 "???"(src/tx/snapshot.ts evolutionsOf). 같은 "???" 는 한 번만 적는다
const evoNames = (list: PetDeviceView["pet"]["evolutions"]): string => [...new Set(list.map((e) => e.name))].join(" · ");

// 카드 한 줄 — 누를 수 있으면 단추다(진화·도감 보기)
function line(title: string, desc: string | null, right: HTMLElement[], run?: () => void): HTMLElement {
  const row = run ? buttonEl("line", "", run) : el("div", "line");
  row.replaceChildren();
  const copy = el("div", "copy");
  copy.appendChild(el("strong", undefined, title));
  if (desc) copy.appendChild(el("span", undefined, desc));
  row.append(copy, ...right);
  if (run) row.appendChild(el("span", "go", "›"));
  return row;
}

// 포인트 적립 줄 — 돌봄 보너스를 보인다. 줄은 늘 있고 글자만 바뀐다 (Figma 03 `Party Detail Device` `row/포인트 적립`, 2026-10-02 사용자 결정 A안)
//   박스 개체          적립하지 않는다
//   친밀도 100 전      기본 속도. 친밀도가 가득이면 보너스가 붙는다고 알린다
//   친밀도 100         보너스 합과 내역(기분 단계 · 버프). 보너스가 없으면 기본 속도
function careLine(v: PetDeviceView): HTMLElement {
  const care = v.pet.care;
  if (!v.inParty) return line("포인트 적립 없음", "파티에 있을 때만 포인트가 쌓여요", []);
  if (!care) return line("포인트 적립 기본", "친밀도가 가득이면 돌봄으로 더 빨리 쌓여요", []);
  if (care.bonus <= 0) return line("포인트 적립 기본", "기분이 좋거나 버프가 켜지면 더 빨리 쌓여요", []);
  const parts = care.parts.map((p) => `${p.kind === "mood" ? `기분 ${p.name}` : p.name} +${p.bonus}%`);
  return line(`포인트 적립 +${care.bonus}%`, parts.join(" · "), []);
}

// 막대 글자 — 친밀도 · 만복도(구간) · 기분(말)
function liveShown(pet: PetDeviceView["pet"], field: "affinity" | "fullness" | "mood"): string {
  if (field === "affinity") return `${pet.affinity}`;
  if (field === "fullness") return `${pet.fullness} · ${ZONE_WORD[pet.zone] ?? pet.zone}`;
  return `${pet.mood} · ${pet.moodWord}`;
}
const feedText = (pet: PetDeviceView["pet"]): string =>
  pet.fullness >= 100 ? "밥 주기 · 배부름" : pet.feedReady ? "밥 주기" : `밥 주기 · ${waitWord(pet.feedInSec)}`;

// 시간으로만 바뀌는 값 — 이것만 다르면 다시 그리지 않고 표시만 고친다. 관리 창(src/renderer/manage/manage.ts structureOf)과 같은 목록이다
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
  for (const node of device.querySelectorAll<HTMLElement>("[data-live-buff]")) {
    const buff = pet.buffs.find((b) => b.kind === node.dataset.liveBuff);
    if (buff && node.textContent !== buffBadge(buff)) node.textContent = buffBadge(buff);
  }
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
  const close = buttonEl("close", "✕", () => api.close());
  close.title = "닫기";
  top.appendChild(close);
  device.appendChild(top);

  // 화면 — 자리·상태, 초상·이름·레벨·성격·타입, 볼 토글
  const bezel = el("div", "bezel");
  const screen = el("div", "screen");
  screen.appendChild(el("div", "where", v.where));
  const entry = el("div", "entry");
  const portrait = el("div", "portrait");
  const stage = el("div", "stage");
  if (v.portrait) stage.appendChild(sprite(v.portrait, STAGE));
  portrait.appendChild(stage);
  // 메가스톤 표식 — 초상 오른쪽 아래. 누르면 관리 창이 확인·고르기 창을 띄운다. 메가 모습이면 옅은 바탕이고 누르면 원래 모습으로 돌아간다.
  // 박스 개체는 누를 수 없다 — 메가진화는 프리셋 칸에서만 한다 (src/dex/mega.ts)
  if (pet.mega) {
    const word = pet.mega.kind === "primal" ? "원시회귀" : "메가진화";
    const label = !pet.mega.canChange ? "박스에 있는 포켓몬은 모습을 바꿀 수 없어요" : pet.mega.on ? "원래 모습으로" : word;
    const stone = buttonEl(pet.mega.on ? "mega-stone on" : "mega-stone", "", () => act({ kind: "dialog", dialog: "mega" }), !pet.mega.canChange);
    stone.title = label;
    stone.setAttribute("aria-label", label);
    if (v.megaIcon) stone.appendChild(sprite(v.megaIcon, MEGA_STONE));
    portrait.appendChild(stone);
  }
  entry.appendChild(portrait);
  const info = el("div", "info");
  // 이름 줄 — 이름 · 성별 24 · 이로치 24 (Figma `862:22000` 의 `gender`·`shiny`, 2026-09-30·2026-10-02 사용자 결정)
  const nameRow = el("div", "name-row");
  nameRow.appendChild(el("div", "name", pet.name));
  const sex = genderIcon(pet.gender, 24);
  if (sex) nameRow.appendChild(sex);
  if (pet.shiny) nameRow.appendChild(shinyIcon(24));
  info.appendChild(nameRow);
  info.appendChild(el("div", "sub", NATURE_UI ? `Lv.${pet.level} · ${pet.nature}` : `Lv.${pet.level}`));
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
    const ball = buttonEl(`ball-toggle ${pet.hidden ? "closed" : "open"}`, "", () => act({ kind: "cmd", cmd: pet.hidden ? "party.show" : "party.hide" }));
    ball.dataset.tut = "detail-ball";
    ball.title = action;
    ball.setAttribute("aria-label", action);
    screen.appendChild(ball);
    // 상태 배지 — 초상·이름 줄의 오른쪽 아래. 그 줄의 높이가 정해져 있어 배지가 생겨도 아래 막대가 밀리지 않는다 (2026-09-30 사용자 결정, Figma `862:22000` 의 `status`)
    const badges = statusBadges(pet);
    if (badges) entry.appendChild(badges);
  }

  // 기록 — 네 막대 2×2. 화면 안에 둔다 (시안 C)
  const records = el("div", "records");
  records.append(
    bar("경험치", pet.percentToNext, `${pet.percentToNext}%`),
    bar("친밀도", pet.affinity, liveShown(pet, "affinity"), "", "affinity"),
    bar("만복도", pet.fullness, liveShown(pet, "fullness"), pet.zone === "hungry" || pet.zone === "starving" ? pet.zone : "", "fullness"),
    bar("기분", pet.mood, liveShown(pet, "mood"), "mood", "mood"),
  );
  screen.appendChild(records);
  bezel.appendChild(screen);
  device.appendChild(bezel);

  // 돌봄 단추 — 기기 몸통에 둔다. 밥 주기는 밝은 단추다 (시안 C). 박스 개체도 파티 개체와 같은 상세를 쓴다 (2026-09-30 사용자 "똑같은 파티상세를 써야지").
  // 볼 토글은 파티 개체 전용이다 — 박스 개체는 바탕화면에 꺼낼 수 없다.
  // 돌봄 단추는 박스 개체에게는 막는다 — 박스에서는 값이 줄지 않는다 (2026-09-30 사용자 "박스에선 막고")
  {
    const full = pet.fullness >= 100;
    const care = el("div", "keys");
    care.dataset.tut = "detail-care";
    const boxed = !v.inParty;
    const feed = buttonEl("key light", boxed ? "밥 주기" : feedText(pet), () => act({ kind: "cmd", cmd: "feed" }), boxed || !pet.feedReady || full);
    if (!boxed) feed.dataset.live = "feed"; // 남은 시간은 1초 시계가 고친다 (applyLive)
    care.append(
      feed,
      buttonEl("key", pet.playReady || boxed ? "놀아주기" : "놀아주기 · 쉬는 중", () => act({ kind: "cmd", cmd: "play" }), boxed || !pet.playReady),
    );
    if (boxed) care.title = "박스에 있는 포켓몬은 돌볼 수 없어요";
    device.appendChild(care);
  }
  // 흰 판 — 진화 · 도감 보기 · 크기 줄의 목록. 줄 사이는 구분선이다 (시안 C)
  const actions = el("div", "actions");
  const ready = pet.evolutions.filter((e) => e.ready);
  const evolve = (): void => act({ kind: "dialog", dialog: "evolve" });
  const evoLine = !pet.evolutions.length
    ? line("진화", "더 진화하지 않아요", [])
    : ready.length
      ? line(`진화 · ${evoNames(ready)}`, null, [el("span", "chip-ready", "진화 가능")], evolve)
      : line(`진화 · ${evoNames(pet.evolutions)}`, pet.evolutions.map((e) => e.need ?? "").filter(Boolean).join(" · ") || null, [], evolve);
  const growth = el("div", "group");
  growth.dataset.tut = "detail-growth";
  // 성격 줄 자리에 도감 보기 — 누르면 이 기기 창 옆에 그 종의 도감 기기 창을 띄운다. 다시 누르면 닫는다.
  // 떠 있는 동안 줄은 톤 배경 (2026-10-01 사용자 결정, Figma 05 `Party / Detail Device / Dex Beside` `1143:20169`)
  const second = NATURE_UI
    ? line(`성격 · ${pet.nature}`, null, [], () => act({ kind: "dialog", dialog: "nature" }))
    : line("도감 보기", null, [], () => act({ kind: "dex" }));
  if (!NATURE_UI) {
    second.classList.toggle("on", v.dexOpen);
    second.setAttribute("aria-pressed", String(v.dexOpen));
  }
  growth.append(careLine(v), evoLine, second);
  actions.appendChild(growth);
  {
    const sizes = el("div", "sizes");
    sizes.setAttribute("role", "group");
    sizes.setAttribute("aria-label", "크기");
    for (let n = 1; n <= v.sizeLevels; n++) {
      const b = buttonEl("size", String(n), () => {
        if (n !== pet.size) act({ kind: "cmd", cmd: "pet.set", args: { size: n } });
      });
      b.setAttribute("aria-pressed", String(n === pet.size));
      sizes.appendChild(b);
    }
    const size = el("div", "group");
    size.dataset.tut = "detail-size";
    size.appendChild(line("크기", null, [sizes]));
    actions.appendChild(size);
  }
  // 교체·박스에 보관·파티에 배치 단추는 두지 않는다 — 파티 탭 `교체` 모달에서 끌어 놓아 옮긴다 (2026-09-30 사용자 결정)
  // 실패 문구 — 관리 창 Alert Inline(오류)과 같은 모양 (Figma `Alert` `1040:216`)
  if (v.notice) {
    const box = el("div", "alert bad inline");
    box.append(el("i", "alert-icon"), el("span", undefined, v.notice));
    actions.appendChild(box);
  }
  device.appendChild(actions);

  const controls = el("div", "controls");
  const cry = buttonEl("cry", "울음소리", () => void playCry(), v.volume <= 0); // 설정에서 소리를 끄면 막는다
  controls.append(buttonEl("prev", "◀ 이전", () => api.step(-1)), cry, buttonEl("next", "다음 ▶", () => api.step(1)));
  device.appendChild(controls);

  // 숨은 새 창은 이 값을 받아야 보인다 — 같은 높이여도 보낸다
  sendSize(true);
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
  void fontsReady.then(() => render(view));
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
