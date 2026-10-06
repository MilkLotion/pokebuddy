// 설정창의 설정·사용자 모달 — 일반·화면 설정, 계정·연결 탭의 틀 (P10o). 연결 탭 본문은 ./agents.ts, 가이드북은 ./guide.ts
// 설정 모달 탭 — 일반·화면 두 칸. 사용자 모달 탭 — 계정·연결 두 칸 (2026-09-28 사용자 "설정모달에서 계정은 빼고, 설정옆에 유저아이콘 추가 후 해당 메뉴에서 계정,연결 설정").
// 두 모달은 같은 틀이다. 탭을 바꿔도 모달 크기(560×500)가 같다.
// Figma 05 `Settings / General` `633:18937` · `Settings / Display` `633:19017` · `User / Connect` `1079:1891` (worklog/records/trade/record.md "계정 탭 구조로 수정").
// 계정 탭의 내용은 교환 세션이 로그인과 함께 채운다 — 여기서는 자리만 둔다
import type { ScreenView } from "../../shared/model/overlays.js";
import { buttonEl, el } from "../ui/dom.js";
import { api } from "./api.js";
import { agentRows, drawAgents, loadAgents } from "./agents.js";
import { runLocked, sendCommand } from "./command.js";
import { actionButtonEl, actionsRowEl, closeDialog, dialogEl, drawDialog, openAnyDialog } from "./dialog.js";
import type { SettingsTab, UserTab } from "./dialog-types.js";
import { ui } from "./state.js";
import { chipsEl, dialogCloseEl, segmentedEl, settingRow, switchEl } from "./widgets.js";
import { versionFoot } from "./update-notes.js";
import { accountOverlayEl } from "./account.js";
import { accountActionsEl, drawAccount } from "./account-forms.js";

const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "general", label: "일반" },
  { id: "display", label: "화면" },
];
const USER_TABS: readonly { id: UserTab; label: string }[] = [
  { id: "account", label: "계정" },
  { id: "agents", label: "연결" },
];

// 설정의 고르기 — 박스 정렬과 같은 목록. 목록은 누르는 칸과 폭이 같다. 칸 폭은 가장 긴 선택지에 맞춘 고정값
let settingSelectOpen: string | null = null;
// 열린 고르기를 닫는다 — 바깥을 누르면 닫는 설정창의 document 클릭이 부른다. 열려 있었으면 true
export function closeSettingSelect(): boolean {
  if (!settingSelectOpen) return false;
  settingSelectOpen = null;
  return true;
}
function settingSelect<T extends string>(id: string, options: readonly { value: T; label: string }[], current: T, width: number, pick: (value: T) => void): HTMLElement {
  const wrap = el("div", "box-sort setting-select");
  const now = options.find((o) => o.value === current);
  const toggle = buttonEl("sort-toggle", `${now?.label ?? current} ▾`);
  toggle.style.width = `${width}px`;
  toggle.setAttribute("aria-expanded", String(settingSelectOpen === id));
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    settingSelectOpen = settingSelectOpen === id ? null : id;
    drawDialog();
  });
  wrap.appendChild(toggle);
  if (settingSelectOpen === id) {
    const menu = el("div", "sort-menu");
    menu.setAttribute("role", "menu");
    for (const o of options) {
      const item = buttonEl(o.value === current ? "sort-item on" : "sort-item", o.label);
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(o.value === current));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        settingSelectOpen = null;
        if (o.value === current) drawDialog();
        else pick(o.value);
      });
      menu.appendChild(item);
    }
    wrap.appendChild(menu);
  }
  return wrap;
}

// 소리 크기 — Figma `Volume Control` `645:16735`. 슬라이더 + 숫자 입력 + 스피커 단추(누르면 음소거, 다시 누르면 켬).
// 음소거는 설정의 sound 를 끈다. 크기 값은 그대로 남긴다. 슬라이더는 놓을 때, 숫자는 입력을 마칠 때 한 번 저장한다
function volumeControl(volume: number, on: boolean, set: (key: string, value: unknown) => void): HTMLElement {
  const box = el("div", on ? "volume" : "volume muted");
  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = "100";
  range.step = "1";
  range.value = String(volume);
  range.setAttribute("aria-label", "소리 크기");
  const number = document.createElement("input");
  number.type = "number";
  number.min = "0";
  number.max = "100";
  number.step = "1";
  number.value = String(volume);
  number.setAttribute("aria-label", "소리 크기 숫자");
  const paint = (v: number): void => range.style.setProperty("--p", `${v}%`);
  paint(volume);
  range.addEventListener("input", () => {
    number.value = range.value;
    paint(Number(range.value));
  });
  range.addEventListener("change", () => set("volume", Number(range.value)));
  // 숫자 칸 — 범위 밖이나 소수는 0~100 정수로 맞춘다. 빈 칸이면 원래 값으로 되돌린다
  number.addEventListener("change", () => {
    const raw = Number(number.value);
    if (number.value.trim() === "" || !Number.isFinite(raw)) {
      number.value = String(volume);
      return;
    }
    const v = Math.max(0, Math.min(100, Math.round(raw)));
    number.value = String(v);
    range.value = String(v);
    paint(v);
    if (v !== volume) set("volume", v);
  });
  number.addEventListener("keydown", (e) => {
    if (e.key === "Enter") number.blur();
  });
  const mute = buttonEl("mute", "");
  mute.setAttribute("aria-pressed", String(!on));
  mute.setAttribute("aria-label", on ? "음소거" : "소리 켜기");
  mute.title = on ? "음소거" : "소리 켜기";
  mute.appendChild(speakerIcon(!on));
  mute.addEventListener("click", () => set("sound", !on));
  box.append(range, number, mute);
  return box;
}

// 스피커 그림 16px — Figma `Icon / Sound` `645:346` (On · Muted). 선 색은 글자색을 따른다
function speakerIcon(muted: boolean): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const paths = ["M4 6 H7 L11 3 V13 L7 10 H4 Z", ...(muted ? ["M12 6 L16 10", "M16 6 L12 10"] : ["M12.5 5.5 Q14 8 12.5 10.5", "M14 3.5 Q16.5 8 14 12.5"])];
  for (const d of paths) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

const setSetting = (key: string, value: unknown): void => void sendCommand("settings.set", key, { value });
// 창 표시 두 항목(포켓몬 표시·고스트 모드)은 저장 밖의 설정이라 메인이 받는다 (src/main/app/commands.ts display.set)
const setDisplay = (key: "hidden" | "clickThrough", value: boolean): void => void sendCommand("display.set", key, { value });

// 일반 — 잠들기 기준, 언어, 로그인 시 시작, 소리, 알림, 가이드북
function drawGeneral(scroll: HTMLElement): void {
  if (!ui.view) return;
  const s = ui.view.settings;
  const sleep = s.sleepChoices.map((c) => ({ value: String(c.value), label: c.label }));
  scroll.appendChild(
    settingRow("잠들기 기준", "이 시간 동안 조작이 없으면 잠듦", settingSelect("sleep", sleep, String(s.sleepAfterMin), 104, (v) => setSetting("sleepAfterMin", Number(v)))),
  );
  const langs = [
    { value: "ko", label: "한국어" },
    { value: "en", label: "English" },
  ] as const;
  scroll.appendChild(settingRow("언어", undefined, settingSelect("language", langs, s.language === "en" ? "en" : "ko", 92, (v) => setSetting("language", v))));
  scroll.appendChild(settingRow("로그인 시 시작", undefined, switchEl(s.startOnLogin, "로그인 시 시작", () => setSetting("startOnLogin", !s.startOnLogin))));
  scroll.appendChild(settingRow("소리", "알림음과 울음소리 크기", volumeControl(s.volume, s.sound, setSetting)));
  // 알림 — 종류마다 켜고 끈다. 눌린 칩이 켠 알림이다 (Figma 03 `Settings Panel` `setting/알림`, 02 `Notify Chips`, 2026-10-05)
  const kinds = [
    { id: "hatch", label: "부화" },
    { id: "evolve", label: "진화" },
    { id: "achievement", label: "업적" },
    { id: "find", label: "줍기" },
  ];
  const onKinds = kinds.map((k) => k.id).filter((id) => !s.notifyOff.includes(id));
  scroll.appendChild(settingRow("알림", "끈 알림은 배너로 띄우지 않아요", chipsEl(kinds, onKinds, (id) => setSetting("notify", { kind: id, on: s.notifyOff.includes(id) }))));
  const guide = buttonEl("act", "열기 ›");
  guide.addEventListener("click", () => openAnyDialog({ kind: "guide" }));
  scroll.appendChild(settingRow("가이드북", undefined, guide));
}

// 화면 — 포켓몬 표시, 클릭 통과, 놀이공간. 앞의 두 줄은 이 앱의 창 상태라 앱이 값을 줄 때만 둔다
function drawDisplay(scroll: HTMLElement): void {
  if (!ui.view) return;
  const s = ui.view.settings;
  const d = ui.view.display;
  if (d) {
    const shown = settingRow("포켓몬 표시", undefined, switchEl(!d.hidden, "포켓몬 표시", () => setDisplay("hidden", !d.hidden)));
    shown.dataset.tut = "set-hidden"; // 화면 탭 튜토리얼이 밝히는 곳
    const ghost = settingRow("고스트 모드", "포켓몬 위도 뒤 창을 클릭", switchEl(d.clickThrough, "고스트 모드", () => setDisplay("clickThrough", !d.clickThrough)));
    ghost.dataset.tut = "set-ghost";
    scroll.append(shown, ghost);
  }
  // 놀이공간 — 모든 화면 · 한 화면 · 영역 지정 (2026-09-28 여러 화면, worklog/records/multi-display/record.md)
  const area = [
    { id: "all", label: "모든 화면" },
    { id: "screen", label: "한 화면" },
    { id: "region", label: "영역 지정" },
  ] as const;
  const hint =
    s.playArea === "all"
      ? "다른 화면으로 끌어다 놓으면 그 화면으로 옮겨 감"
      : s.playArea === "region"
        ? s.hasRegion
          ? "그려 둔 영역 안에서만 돌아다님"
          : "영역을 아직 그리지 않았음"
        : undefined;
  const areaRow = settingRow("놀이공간", hint, segmentedEl(area, s.playArea, (id) => setSetting("playArea", id)));
  areaRow.dataset.tut = "area"; // 놀이공간 튜토리얼이 밝히는 곳
  scroll.appendChild(areaRow);
  // 한 화면 — 목록에서 고르거나 화면 위에서 눌러 고른다. 목록이 열린 동안 모든 모니터에 번호를 띄운다(syncIdentify)
  if (s.playArea === "screen") {
    void loadScreens();
    const rows = screenRows ?? [];
    const options = rows.map((r) => ({ value: String(r.ref.id), label: [`화면 ${r.number}`, r.primary ? "주 화면" : "", `${r.w}×${r.h}`].filter(Boolean).join(" · ") }));
    const now = rows.find((r) => r.current) ?? rows[0];
    const box = el("div", "screen-pick");
    if (now) box.appendChild(settingSelect("screen", options, String(now.ref.id), 224, (id) => {
      const row = rows.find((r) => String(r.ref.id) === id);
      if (row) setSetting("playScreen", row.ref);
    }));
    box.appendChild(actionButtonEl("화면에서 고르기", false, false, () => void runLocked(() => api.pickScreen())));
    const screenRow = settingRow("화면", undefined, box);
    screenRow.dataset.tut = "area-screen"; // 놀이공간 튜토리얼이 함께 밝힌다
    scroll.appendChild(screenRow);
  }
  // 영역 지정일 때만 그리기 단추를 둔다. 그린 뒤에는 `다시 그리기` (docs/specs/game.md 설정 계약)
  if (s.playArea === "region") {
    const draw = actionButtonEl(s.hasRegion ? "다시 그리기" : "영역 그리기", !s.hasRegion, false, () => void runLocked(() => api.drawRegion()));
    const regionRow = settingRow("영역", undefined, draw);
    regionRow.dataset.tut = "area-region"; // 화면 탭 튜토리얼이 함께 밝힌다
    scroll.appendChild(regionRow);
  }
}

// 한 화면 목록 — 그릴 때마다 새로 읽고, 바뀌었을 때만 다시 그린다(모니터를 꽂거나 뺐을 수 있다)
let screenRows: ScreenView[] | null = null;
let screensLoading = false;
async function loadScreens(): Promise<void> {
  if (screensLoading) return;
  screensLoading = true;
  try {
    const next = await api.screens();
    const changed = JSON.stringify(next) !== JSON.stringify(screenRows);
    screenRows = next;
    if (changed && ui.dialog?.kind === "settings" && ui.dialog.tab === "display") drawDialog();
  } finally {
    screensLoading = false;
  }
}

// 한 화면 목록이 열린 동안만 모든 모니터에 번호 덮개 — 바뀔 때만 메인에 알린다
let identifying = false;
export function syncIdentify(): void {
  const on = ui.dialog?.kind === "settings" && ui.dialog.tab === "display" && settingSelectOpen === "screen";
  if (on === identifying) return;
  identifying = on;
  api.identifyScreens(on);
}

// 계정 — 로그인·계정 화면은 교환 세션이 채운다 (worklog/records/trade/record.md "계정과 로그인")

// 설정·사용자 모달의 틀 — 제목과 오른쪽 위 닫기, 두 칸 전환, 스크롤 본문. 바닥과 덧창은 모달마다 붙인다
function drawTabbedHead<T extends string>(title: string, tabs: readonly { id: T; label: string }[], current: T, pick: (id: T) => void): HTMLElement {
  const head = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, title));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", closeDialog);
  head.append(titles, x);
  dialogEl.appendChild(head);
  dialogEl.appendChild(segmentedEl(tabs, current, pick));
  const scroll = el("div", "scroll");
  dialogEl.appendChild(scroll);
  return scroll;
}

export function drawSettings(sub: SettingsTab): void {
  const scroll = drawTabbedHead("설정", SETTINGS_TABS, sub, (id) => {
    settingSelectOpen = null;
    openAnyDialog({ kind: "settings", tab: id });
  });
  if (sub === "general") drawGeneral(scroll);
  else drawDisplay(scroll);
  // 바닥 — 왼쪽은 버전·업데이트, 오른쪽 끝은 저작권 안내. 닫기 단추는 없다 (2026-09-28 사용자 "설정모달에서 우하단의 닫기버튼 없애자")
  // 저작권 안내는 README 의 라이선스 절을 기본 브라우저로 연다 — 주소는 메인이 정한다 (2026-10-03 사용자 결정, Figma 05 Screens 섹션 `930:18246`)
  const rights = actionButtonEl("저작권 안내", false, false, () => api.openRights());
  rights.classList.add("small");
  // 가운데 spacer — 실패 글자가 이 빈자리에 서고 저작권 안내는 오른쪽 끝에 남는다 (src/renderer/manage/dialog.ts 실패 표시, 2026-10-07)
  dialogEl.appendChild(actionsRowEl(versionFoot(), el("div", "spacer"), rights));
}

// 사용자 모달 — 계정·연결. 버전·업데이트 바닥은 두지 않는다(설정 모달에만)
export function drawUser(sub: UserTab): void {
  const scroll = drawTabbedHead("사용자", USER_TABS, sub, (id) => {
    if (id === "agents" && !agentRows) void loadAgents();
    openAnyDialog({ kind: "user", tab: id });
  });
  if (sub === "agents") {
    drawAgents(scroll);
    return;
  }
  drawAccount(scroll);
  const foot = accountActionsEl();
  if (foot) dialogEl.appendChild(foot);
  // 계정 탭의 확인 창(삭제·로그아웃·로그인 때 고르기)은 사용자 모달 위에 뜬다
  const overlay = accountOverlayEl();
  if (overlay) dialogEl.appendChild(overlay);
}
