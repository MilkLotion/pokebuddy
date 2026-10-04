// 설정창의 버전·업데이트와 패치노트 — 설정 바닥의 버전 글자·다시 시작 단추, 패치노트 모달, 업데이트 뒤 처음 열 때 노트 (P10k)
// Figma 05 Screens 섹션 `930:18246`(설정) 의 설정 바닥 — 바닥 왼쪽에 버전과 업데이트 상태, 그 옆에 `패치노트` (src/main/update/updater.ts)
// Figma `99 · 시안` `800:18345`(설정에서 연 것 — 왼쪽 버전 목록, 오른쪽 내용)·`800:18549`(업데이트 뒤 처음 켤 때)
import type { PatchNotesView, UpdateView } from "../../shared/model/account.js";
import { buttonEl, el } from "../ui/dom.js";
import { api } from "./api.js";
import { setBusy } from "./command.js";
import { actionButtonEl, closeDialog, dialogEl, drawDialog, openAnyDialog } from "./dialog.js";
import { ui } from "./state.js";
import { dialogCloseEl } from "./widgets.js";

let upd: UpdateView | null = null;
let patch: PatchNotesView | null = null;

function versionWord(u: UpdateView): string {
  if (u.status === "latest") return `pokebuddy ${u.version} · 최신 버전`;
  if (u.status === "downloading") return `새 버전 ${u.next ?? ""} 받는 중 ${u.percent ?? 0}%`;
  if (u.status === "ready") return `새 버전 ${u.next ?? ""} 준비됨`;
  if (u.status === "manual") return `새 버전 ${u.next ?? ""}`;
  if (u.status === "error") return "업데이트를 확인하지 못했어요";
  return `pokebuddy ${u.version}`; // 꺼 둠(개발 실행·npm 설치본)·확인 전·확인 중
}

// `다시 시작`을 눌렀다 — 앱이 꺼질 때까지 "다시 시작하는 중"과 처리 중 단추를 둔다. 클라우드 저장을 올리느라 몇 초 걸릴 수 있다
// (Figma `Settings / Version · 다시 시작하는 중`). 앱이 꺼진 뒤에는 설치 프로그램의 진행 창이 보인다 (src/main/update/updater.ts)
let restarting = false;

async function updateSend(action: "check" | "install"): Promise<void> {
  const restart = action === "install" && upd?.status === "ready";
  if (restart) {
    restarting = true;
    if (ui.dialog?.kind === "settings") drawDialog();
  }
  let next: UpdateView | null = null;
  try {
    next = await api.update(action);
  } catch (e) {
    console.error("업데이트 요청 실패", e);
  }
  if (next) upd = next;
  if (restart && !next) restarting = false; // 요청이 닿지 않았다 — 다시 누를 수 있게 되돌린다
  if (ui.dialog?.kind === "settings") drawDialog();
}

export function versionFoot(): HTMLElement {
  const box = el("div", "version-foot");
  if (upd && restarting) {
    box.appendChild(el("span", "version-word", "다시 시작하는 중"));
    const b = smallButton("다시 시작", true, () => {});
    setBusy(b, true);
    box.appendChild(b);
  } else if (upd) {
    box.appendChild(el("span", "version-word", versionWord(upd)));
    if (upd.status === "ready") box.appendChild(smallButton("다시 시작", true, () => void updateSend("install")));
    // mac 에서 앱을 그 자리에서 바꿀 수 없다(dmg 안·쓰기 불가) — 이 Mac 용 dmg 를 연다 (src/main/update/mac-updater.ts)
    else if (upd.status === "manual") box.appendChild(smallButton("받기", true, () => void updateSend("install")));
    else if (upd.status === "error") box.appendChild(smallButton("다시 확인", false, () => void updateSend("check")));
  }
  if (patch?.notes.length) box.appendChild(smallButton("패치노트", false, () => openAnyDialog({ kind: "notes" })));
  return box;
}

const smallButton = (label: string, primary: boolean, run: () => void): HTMLButtonElement => {
  const b = actionButtonEl(label, primary, false, run);
  b.classList.add("small");
  return b;
};

// 설정창을 열 때 — 마지막 확인 뒤 오래되었으면 메인이 새 버전을 확인한다. 상태가 바뀌면 다시 그린다
export async function peekUpdate(): Promise<void> {
  try {
    const next = await api.update("peek");
    if (!next) return;
    upd = next;
  } catch (e) {
    console.error("업데이트 확인 요청 실패", e);
    return;
  }
  if (ui.dialog?.kind === "settings") drawDialog();
}

export async function loadUpdate(): Promise<void> {
  try {
    const [u, n] = await Promise.all([api.update("status"), api.notes("list")]);
    upd = u;
    patch = n;
  } catch (e) {
    console.error("버전·패치노트를 읽지 못했다", e);
    return;
  }
  if (ui.dialog?.kind === "settings") drawDialog();
}

// 업데이트한 뒤 처음 열었다 — 그 버전의 노트를 한 번 띄운다. 다른 모달이 떠 있으면 가리지 않고 다음에 연다
export function openUnseenNotes(): void {
  const v = patch?.unseen;
  if (!v || ui.dialog) return;
  openAnyDialog({ kind: "notes-new", version: v });
  void api.notes("seen").then((n) => {
    if (n) patch = n;
  });
}

api.onUpdate((next) => {
  upd = next;
  if (ui.dialog?.kind === "settings") drawDialog();
});

function noteDetail(version: string): HTMLElement {
  const box = el("div", "notes-detail");
  const note = patch?.notes.find((n) => n.version === version);
  if (!note) return box;
  const head = el("div", "notes-version");
  head.append(el("h3", undefined, note.version), el("span", "notes-date", note.date));
  box.appendChild(head);
  for (const line of note.lines) box.appendChild(el("p", "notes-line", `· ${line}`));
  return box;
}

// 2단 모달(패치노트·가이드북)의 머리 — 제목·부제와 ✕
export function notesHead(title: string, sub: string, onClose: () => void): HTMLElement {
  const head = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.append(el("h2", undefined, title), el("div", "sub", sub));
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", onClose);
  head.append(titles, x);
  return head;
}

// ✕ 는 설정으로 돌아간다 — 설정 바닥에서 열었다
export function drawNotes(pick?: string): void {
  const notes = patch?.notes ?? [];
  const current = pick ?? notes[0]?.version ?? "";
  dialogEl.appendChild(notesHead("패치노트", "버전마다 바뀐 것", () => openAnyDialog({ kind: "settings", tab: "general" })));
  const body = el("div", "notes-body");
  const list = el("div", "notes-list scroll");
  for (const n of notes) {
    const item = buttonEl(n.version === current ? "notes-item on" : "notes-item");
    item.append(el("span", "notes-item-version", n.version), el("span", "notes-date", n.date));
    item.setAttribute("aria-pressed", String(n.version === current));
    item.addEventListener("click", () => {
      if (n.version !== current) openAnyDialog({ kind: "notes", pick: n.version });
    });
    list.appendChild(item);
  }
  body.append(list, noteDetail(current));
  dialogEl.appendChild(body);
}

export function drawNotesNew(version: string): void {
  dialogEl.append(notesHead(`${version} 으로 업데이트했어요`, "이번 버전에서 바뀐 것", closeDialog), noteDetail(version));
}
