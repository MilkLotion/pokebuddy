// 파티 상세 기기 창 — 메인이 만들어 보낸 개체 하나를 그린다 (src/main/pet-window.ts). Figma 05 `Party / Detail Device` `908:23772`(기기 `862:22000`)
// 배치는 시안 C 다 (2026-10-02 사용자 결정 "c로 확정", Figma `Party Detail Device` `1262:76637` — 변형 셋을 C 배치로 바꿨다)
//   화면  자리·상태 → 초상·이름·레벨·타입 → 네 막대(경험치·친밀도·만복도·심심함)
//   몸통  돌봄 단추 둘(밥 주기는 밝은 단추)
//   흰 판 포인트 적립 · 진화 · 도감 보기 · 크기 줄을 구분선으로 나눈 목록
// 메가스톤을 지닌 개체는 초상 오른쪽 아래에 메가스톤 표식이 있다. 누르면 메가진화한다 (같은 날 사용자 결정)
// 그린 뒤 높이를 알려 창 높이를 내용에 맞춘다. 이전·다음·닫기는 메인에 보내고, 울음소리는 받아서 여기서 튼다.
// 단추는 무엇을 할지만 관리 창에 돌려보낸다 — 명령과 대화상자(진화·성격·교체)는 관리 창이 처리한다
import type { PetDeviceAction, PetDeviceView } from "../../shared/model/devices.js";
import { needBridge } from "../ui/bridge.js";
import { genderIcon } from "../ui/gender-icon.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { spriteCanvas } from "../ui/portrait.js";
import { buttonEl, el } from "../ui/dom.js";
import { createCryPlayer } from "../ui/cry.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { clampPercent, fillBarEl, zoneClassOf } from "../ui/fill-bar.js";
import { createDeviceFrame } from "./device-frame.js";
import { petBusyKey } from "../../shared/device-busy.js";
import { NATURE_SHOWN } from "../../shared/features.js";
import { structureOf } from "../ui/live-draw.js";
import { COACH_SIZE, drawCoachLayer, guardCoachFocus, type CoachLayer } from "../ui/coach.js";

const api = needBridge("pokebuddyPet");
// 튜토리얼 막은 body 에 fixed 로 붙어 #device 높이에 들지 않는다. 높이가 바뀌면 막 자리를 다시 잡는다
// 튜토리얼 중에는 넘기지도 닫지도 않는다 — 다음·확인·✕ 만 받는다
const frame = createDeviceFrame({
  api,
  windowName: "pet",
  canKey: () => !coachEl,
  onResized: () => {
    if (coachEl) drawCoach();
  },
});
const device = frame.device;

// 상태 배지 묶음 — 디버프 뒤에 켜진 버프(든든함·신남). 하나도 없으면 null
function statusBadges(pet: PetDeviceView["pet"]): HTMLElement | null {
  const list: HTMLElement[] = [];
  // 디버프 — 배고픔, 그다음 심심해·지루해. 관리 창 파티 칸과 같은 이름·색(스냅샷의 pet.debuffs)
  for (const d of pet.debuffs ?? []) {
    const badge = el("span", `badge ${d.tone}`, d.label);
    badge.title = d.note;
    list.push(badge);
  }
  for (const buff of pet.buffs ?? []) {
    const badge = el("span", "badge success", buff.text);
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
// 처리 중 — 설정창이 실어 보낸 열쇠와 같은 단추만 점 세 개 (94 2-1, src/shared/device-busy.ts)
function markBusy(b: HTMLButtonElement, busy: string | null, body: ActBody): void {
  if (busy !== null && busy === petBusyKey({ ...body, petId: shownPetId } as PetDeviceAction)) b.setAttribute("aria-busy", "true");
}

// 메가스톤 조건 말풍선 — 흐린 표식 아래. 1초마다 다시 그려도 열린 채로 둔다 (Figma 03 `Mega Condition Bubble`)
const GOAL_TITLE: Record<NonNullable<PetDeviceView["pet"]["megaGoal"]>["kind"], string> = { mega: "메가스톤 조건", primal: "원시회귀 조건", rayquaza: "메가진화 조건" };
let goalOpen = false;
function closeGoal(): void {
  goalOpen = false;
  device.querySelector(".mega-goal")?.remove();
  device.querySelector(".mega-stone.goal")?.setAttribute("aria-expanded", "false");
}
function drawGoal(portrait: HTMLElement, stone: HTMLElement, goal: NonNullable<PetDeviceView["pet"]["megaGoal"]>): void {
  portrait.querySelector(".mega-goal")?.remove();
  stone.setAttribute("aria-expanded", String(goalOpen));
  if (!goalOpen) return;
  const box = el("div", "mega-goal");
  box.appendChild(el("div", "mega-goal-head", `${GOAL_TITLE[goal.kind]} · 모두 채우면 생겨요`));
  const rows: [string, [number, number], (n: number) => string][] = [
    ["친밀도", goal.affinity, (n) => String(n)],
    ["레벨", goal.level, (n) => `Lv.${n}`],
    ["파티에서 함께", goal.hours, (n) => `${n}`],
    ["놀아주기", goal.care, (n) => `${n}`],
  ];
  const unit = ["", "", "시간", "회"];
  rows.forEach(([label, [now, need], show], i) => {
    const done = now >= need;
    const row = el("div", "mega-goal-row");
    const value = i === 1 ? `${show(now)} / ${need}` : `${show(Math.min(now, need))} / ${need}${unit[i]}`;
    row.append(el("span", "mega-goal-label", label), el("span", done ? "mega-goal-value done" : "mega-goal-value", done ? `✓ ${value}` : value));
    box.appendChild(row);
  });
  box.appendChild(el("div", "mega-goal-foot", "시간과 횟수는 친밀도 100 뒤부터 세요"));
  portrait.appendChild(box);
}
// 말풍선 밖을 누르면 닫는다. 표식 자신은 표식의 click 이 여닫는다
document.addEventListener("pointerdown", (e) => {
  if (!goalOpen) return;
  const target = e.target as Element | null;
  if (target?.closest(".mega-goal, .mega-stone.goal")) return;
  closeGoal();
});

// 개체 상세 튜토리얼 — 파티 개체를 처음 열면 위에서 아래로 다섯 곳을 차례로 밝힌다 (Figma 05 `914:25889` ~ `914:26376`, 옛 관리 창 상세에서 옮김).
// 입력 규칙은 관리 창과 같다 — 막·구멍을 누르면 말풍선만 흔든다. 다음·확인·✕ 만 받는다 (worklog/records/tutorial-overhaul/tutorial-overhaul.md)
const DETAIL_STEPS = [
  { tut: "detail-ball", title: "볼을 눌러 넣고 꺼낼 수 있어요", body: "볼에 넣어도 파티에 남아 계속 자라요." },
  { tut: "detail-care", title: "여기서도 돌볼 수 있어요", body: "바탕화면 우클릭 메뉴의 밥 주기·놀아주기와 같아요." },
  NATURE_SHOWN
    ? { tut: "detail-growth", title: "진화와 성격", body: "조건을 채우면 진화를 눌러 직접 진화해요. 성격민트로 성격을 바꿔요." }
    : { tut: "detail-growth", title: "진화", body: "조건을 채우면 진화를 눌러 직접 진화해요." },
  { tut: "detail-size", title: "바탕화면 크기", body: "이 포켓몬의 크기만 바뀌어요." },
] as const;
const COACH = { pad: 6, gap: 10, ...COACH_SIZE };
let detailStep = 0;
let detailPetId: string | null = null; // 다른 개체를 열면 1단계부터
let coachEl: HTMLElement | null = null;
let coachNow: CoachLayer | null = null; // coachEl 의 초점 규칙(말풍선만·단추로 되돌림)
let lastView: PetDeviceView | null = null;
let coachSent = false; // 메인에 알린 코치마크 상태 — 바뀔 때만 보낸다

// 튜토리얼 동안 설정창의 창 단추 자리도 함께 어둡게 한다 — 메인이 설정창에 칠한다 (94 1-1, worklog/records/game-runtime/game-runtime.md 706·1143)
function drawCoach(): void {
  try {
    drawCoachNow();
  } finally {
    const on = coachEl != null;
    if (on !== coachSent) {
      coachSent = on;
      api.coach(on);
    }
  }
}

function drawCoachNow(): void {
  coachEl?.remove();
  coachEl = null;
  const v = lastView;
  if (!v || !v.tutorial) return;
  const step = DETAIL_STEPS[detailStep];
  const target = step ? device.querySelector<HTMLElement>(`[data-tut="${step.tut}"]`) : null;
  if (!step || !target) return;
  const last = detailStep === DETAIL_STEPS.length - 1;
  const onGo = (): void => {
    if (last) act({ kind: "tutorial", action: "done" });
    else {
      detailStep += 1;
      drawCoach();
    }
  };
  // 말풍선은 대상 가운데. 세로는 세 창이 같은 규칙(ui/coach.ts bubbleTopOf). 안내만 한다 — 대상은 보이되 눌리지 않는다
  coachNow = drawCoachLayer({
    target,
    bounds: { W: document.documentElement.clientWidth, H: device.getBoundingClientRect().height },
    pad: COACH.pad,
    gap: COACH.gap,
    align: "center",
    interactive: false,
    bubble: { step: `튜토리얼 · 개체 상세 ${detailStep + 1} / ${DETAIL_STEPS.length}`, title: step.title, body: step.body, goLabel: last ? "확인" : "다음", onGo, onSkip: () => act({ kind: "tutorial", action: "skip" }) },
  });
  coachEl = coachNow.layer;
}

// 튜토리얼 중에는 키보드 초점도 말풍선 안에 둔다
guardCoachFocus(() => (coachEl ? coachNow : null));

// 그림 자리 — 88×88 네모. 빈 테두리를 잘라 들어가는 가장 큰 정수 배(최대 2배)로 그린다 (ui/portrait.ts spriteCanvas)
const STAGE = { w: 88, h: 88, maxScale: 2 };
// 메가스톤 표식 — 28×28. 키스톤 그림(30×30 안의 14×14)의 빈 테두리를 잘라 두 배로 그린다
const MEGA_STONE = { w: 28, h: 28, maxScale: 2 };

// 울음소리 — 음량은 설정의 소리 크기를 곱한 값(메인이 준다)
const cryPlayer = createCryPlayer(() => api.cry());

// live — 시간으로만 바뀌는 값이면 그 필드. 새 보기가 모양은 같고 이 값만 다르면 막대만 고친다 (applyLive)
function bar(label: string, value: number, shown: string, cls = "", live?: "affinity" | "fullness" | "boredom"): HTMLElement {
  const box = el("div", "bar");
  if (live) box.dataset.live = live;
  const head = el("div", "head");
  head.append(el("span", undefined, label), el("strong", undefined, shown));
  box.append(head, fillBarEl(value, cls));
  return box;
}

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

// 포인트 적립 줄 — 제목과 설명은 메인이 정해 보낸다 (src/view/device-pet.ts careLineOf)
const careLine = (v: PetDeviceView): HTMLElement => line(v.careLine.title, v.careLine.desc, []);

// 시간으로만 바뀌는 값 — 이것만 다르면 다시 그리지 않고 표시만 고친다. 설정창과 같은 목록(shared/live-keys.ts)에
// 이 창만 받는 막대 글자(bars)를 더한다
const PET_LIVE: ReadonlySet<string> = new Set(["bars"]);
const structureOfPet = (v: PetDeviceView): string => structureOf(v, PET_LIVE);
let renderedStructure = "";

function applyLive(v: PetDeviceView): void {
  const pet = v.pet;
  for (const box of device.querySelectorAll<HTMLElement>(".bar[data-live]")) {
    const field = box.dataset.live as "affinity" | "fullness" | "boredom";
    const shown = box.querySelector<HTMLElement>(".head strong");
    if (shown) shown.textContent = v.bars[field];
    const fill = box.querySelector<HTMLElement>(".fill");
    if (fill) fill.style.width = `${clampPercent(pet[field])}%`;
  }
  const feed = device.querySelector<HTMLButtonElement>('[data-live="feed"]');
  if (feed) feed.textContent = pet.feedText;
  const play = device.querySelector<HTMLButtonElement>('[data-live="play"]');
  if (play) play.textContent = pet.playText;
  for (const node of device.querySelectorAll<HTMLElement>("[data-live-buff]")) {
    const buff = pet.buffs.find((b) => b.kind === node.dataset.liveBuff);
    if (buff && node.textContent !== buff.text) node.textContent = buff.text;
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
  renderedStructure = structureOfPet(v);
  renderBody(v);
  restoreFocus(kept);
}

function renderBody(v: PetDeviceView): void {
  const pet = v.pet;
  shownPetId = pet.id;
  cryPlayer.setVolume(v.volume);
  frame.beginDraw(v.side, "파티");

  // 화면 — 자리·상태, 초상·이름·레벨·성격·타입, 볼 토글
  const bezel = el("div", "bezel");
  const screen = el("div", "screen");
  // 첫 줄 — 자리·상태. 실패하면 줄을 끼우지 않고 이 자리의 글자·색만 실패 문구로 바꾼다(한 줄, 넘치면 말줄임, 전체는 title)
  // (2026-10-04 사용자 결정 94 1-3, Figma 05 `Party / Detail Device · 실패 문구` · 파티 기기 창의 머리 줄 실패 자리와 같은 방식)
  const where = el("div", v.notice ? "where bad" : "where", v.notice || v.where);
  if (v.notice) where.title = v.notice;
  screen.appendChild(where);
  const entry = el("div", "entry");
  const portrait = el("div", "portrait");
  const stage = el("div", "stage");
  if (v.portrait) stage.appendChild(spriteCanvas(v.portrait, STAGE));
  portrait.appendChild(stage);
  // 메가스톤 표식 — 초상 오른쪽 아래. 누르면 관리 창이 확인·고르기 창을 띄운다. 메가 모습이면 옅은 바탕이고 누르면 원래 모습으로 돌아간다.
  // 박스 개체는 누를 수 없다 — 메가진화는 프리셋 칸에서만 한다 (src/dex/mega.ts)
  if (pet.mega) {
    const word = pet.mega.kind === "primal" ? "원시회귀" : "메가진화";
    const label = !pet.mega.canChange ? "박스에 있는 포켓몬은 모습을 바꿀 수 없어요" : pet.mega.on ? "원래 모습으로" : word;
    const stone = buttonEl(pet.mega.on ? "mega-stone on" : "mega-stone", "", () => act({ kind: "dialog", dialog: "mega" }), !pet.mega.canChange);
    stone.title = label;
    stone.setAttribute("aria-label", label);
    if (v.megaIcon) stone.appendChild(spriteCanvas(v.megaIcon, MEGA_STONE));
    portrait.appendChild(stone);
  } else if (pet.megaGoal) {
    // 메가스톤이 아직 없다 — 같은 자리의 흐린 표식. 누르면 조건 말풍선을 열고 닫는다 (docs/specs/game.md "조건 말풍선")
    const goal = pet.megaGoal;
    const stone = buttonEl("mega-stone goal", "", () => {
      goalOpen = !goalOpen;
      drawGoal(portrait, stone, goal);
    });
    stone.setAttribute("aria-label", `${GOAL_TITLE[goal.kind]} 보기`);
    stone.setAttribute("aria-expanded", String(goalOpen));
    if (v.megaIcon) stone.appendChild(spriteCanvas(v.megaIcon, MEGA_STONE));
    portrait.appendChild(stone);
    drawGoal(portrait, stone, goal);
  }
  entry.appendChild(portrait);
  const info = el("div", "info");
  // 이름 줄 — 이름 · 성별 24 · 이로치 24 (Figma `862:22000` 의 `gender`·`shiny`, 2026-09-30·2026-10-02 사용자 결정)
  // 모습은 이름 아래 작은 줄 — 모습이 없으면 줄이 없다. 칸 높이가 정해져 있어 아래 막대는 움직이지 않는다
  // (Figma `Party Detail Device` 의 `name-block`·`Show Form`, 2026-10-07 사용자 결정 "이렇게하자")
  const nameBlock = el("div", "name-block");
  const nameRow = el("div", "name-row");
  const name = el("div", "name", pet.nameParts.name);
  name.title = pet.name; // 칸보다 긴 이름은 말줄임
  nameRow.appendChild(name);
  const sex = genderIcon(pet.gender, 24);
  if (sex) nameRow.appendChild(sex);
  if (pet.shiny) nameRow.appendChild(shinyIcon(24));
  nameBlock.appendChild(nameRow);
  if (pet.nameParts.form) nameBlock.appendChild(el("div", "form", pet.nameParts.form));
  info.appendChild(nameBlock);
  info.appendChild(el("div", "sub", NATURE_SHOWN ? `Lv.${pet.level} · ${pet.nature}` : `Lv.${pet.level}`));
  const types = el("div", "types");
  pet.types.forEach((name, i) => types.appendChild(typeBadgeEl(name, pet.typeIds[i])));
  info.appendChild(types);
  entry.appendChild(info);
  screen.appendChild(entry);
  if (v.inParty) {
    const action = pet.hidden ? "꺼내기" : "볼에 넣기";
    const ballBody: ActBody = { kind: "cmd", cmd: pet.hidden ? "party.show" : "party.hide" };
    const ball = buttonEl(`ball-toggle ${pet.hidden ? "closed" : "open"}`, "", () => act(ballBody));
    markBusy(ball, v.busy, ballBody);
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
    bar("친밀도", pet.affinity, v.bars.affinity, "", "affinity"),
    bar("만복도", pet.fullness, v.bars.fullness, zoneClassOf(pet.zone), "fullness"),
    bar("심심함", pet.boredom, v.bars.boredom, "boredom", "boredom"), // 기분의 자리 (2026-10-05 돌봄 개편, Figma 03 `Party Detail Device` `bar/심심함`)
  );
  screen.appendChild(records);
  bezel.appendChild(screen);
  device.appendChild(bezel);

  // 돌봄 단추 — 기기 몸통에 둔다. 밥 주기는 밝은 단추다 (시안 C). 박스 개체도 파티 개체와 같은 상세를 쓴다 (2026-09-30 사용자 "똑같은 파티상세를 써야지").
  // 볼 토글은 파티 개체 전용이다 — 박스 개체는 바탕화면에 꺼낼 수 없다.
  // 돌봄 단추는 박스 개체에게는 막는다 — 박스에서는 값이 줄지 않는다 (2026-09-30 사용자 "박스에선 막고")
  {
    const care = el("div", "keys");
    care.dataset.tut = "detail-care";
    const boxed = !v.inParty;
    const feed = buttonEl("key light", boxed ? "밥 주기" : pet.feedText, () => act({ kind: "cmd", cmd: "feed" }), boxed || pet.feedBlock !== null); // 배부름·쿨타임은 메인이 판정해 준다 (PetView.feedBlock)
    if (!boxed) feed.dataset.live = "feed"; // 남은 시간은 1초 시계가 고친다 (applyLive)
    const play = buttonEl("key", boxed ? "놀아주기" : pet.playText, () => act({ kind: "cmd", cmd: "play" }), boxed || pet.playBlock !== null);
    if (!boxed) play.dataset.live = "play";
    markBusy(feed, v.busy, { kind: "cmd", cmd: "feed" });
    markBusy(play, v.busy, { kind: "cmd", cmd: "play" });
    care.append(feed, play);
    if (boxed) care.title = "박스에 있는 포켓몬은 돌볼 수 없어요";
    device.appendChild(care);
  }
  // 흰 판 — 진화 · 도감 보기 · 크기 줄의 목록. 줄 사이는 구분선이다 (시안 C)
  const actions = el("div", "actions");
  // 진화 줄 — 이 개체가 갈 수 있는 갈래(성별이 맞는 후보)로 정한다. 성별은 적지 않는다 (2026-10-07 사용자 결정)
  //   0개는 최종 진화와 같다. 1개는 이름과 모자란 조건. 2개 이상은 나열하지 않고 진화 트리에서 확인한다(이브이·암멍이·수컷 킬리아)
  //   진화할 수 있는 갈래가 있으면 진화 가능 칩. 미해금 결과 종의 이름은 "???"(src/view/pet.ts evolutionsOf)
  const branches = pet.evolutions.filter((e) => !e.genderBlocked);
  const only = branches.length === 1 ? branches[0] : undefined;
  const readyChip = branches.some((e) => e.ready) ? [el("span", "chip-ready", "진화 가능")] : [];
  const evolve = (): void => act({ kind: "dialog", dialog: "evolve" });
  const evoLine = !branches.length
    ? line("진화", "더 진화하지 않아요", [])
    : only
      ? line(`진화 · ${only.name}`, only.ready ? null : (only.need ?? null), readyChip, evolve)
      : line("진화", "진화 트리에서 확인해요", readyChip, evolve);
  const growth = el("div", "group");
  growth.dataset.tut = "detail-growth";
  // 성격 줄 자리에 도감 보기 — 누르면 이 기기 창 옆에 그 종의 도감 기기 창을 띄운다. 다시 누르면 닫는다.
  // 떠 있는 동안 줄은 톤 배경 (2026-10-01 사용자 결정, Figma 05 `Party / Detail Device / Dex Beside` `1143:20169`)
  const second = NATURE_SHOWN
    ? line(`성격 · ${pet.nature}`, null, [], () => act({ kind: "dialog", dialog: "nature" }))
    : line("도감 보기", null, [], () => act({ kind: "dex" }));
  if (!NATURE_SHOWN) {
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
      markBusy(b, v.busy, { kind: "cmd", cmd: "pet.set", args: { size: n } });
      sizes.appendChild(b);
    }
    const size = el("div", "group");
    size.dataset.tut = "detail-size";
    size.appendChild(line("크기", null, [sizes]));
    actions.appendChild(size);
  }
  // 교체·박스에 보관·파티에 배치 단추는 두지 않는다 — 파티 탭 `교체` 모달에서 끌어 놓아 옮긴다 (2026-09-30 사용자 결정)
  device.appendChild(actions);

  const cry = buttonEl("cry", "울음소리", () => void cryPlayer.play(), v.volume <= 0); // 설정에서 소리를 끄면 막는다
  device.appendChild(frame.controlsEl(cry));

  frame.endDraw();
  if (detailPetId !== pet.id) {
    detailPetId = pet.id;
    closeGoal(); // 다른 개체를 열면 조건 말풍선은 닫는다
    detailStep = 0; // 다른 개체를 열면 튜토리얼은 1단계부터
  } else if (v.tutorial && !lastView?.tutorial) detailStep = 0; // 가이드북의 다시 보기 — 같은 개체여도 1단계부터
  lastView = v;
  drawCoach();
}

// 관리 창은 1초 시계마다 값이 바뀌면 다시 보낸다(쿨타임·만복도). 누르는 중(눌렀다 떼기 사이)에 다시 그리면 단추 누름이 사라진다 —
// 그동안 온 보기는 들고 있다가 뗀 뒤에 그린다
let pointerDown = false;
let pending: PetDeviceView | null = null;
const show = (view: PetDeviceView): void => {
  // 글꼴을 읽은 뒤에 재야 높이가 맞는다
  void frame.fontsReady.then(() => render(view));
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
  if (renderedStructure && structureOfPet(view) === renderedStructure) return applyLive(view);
  if (pointerDown) pending = view;
  else show(view);
});
