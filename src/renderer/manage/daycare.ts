// 설정창의 돌보미집 — 넘김 줄의 돌보미집 단추, 돌보미집 모달, 알 열기·모두 열기, 부화 결과 창, 겹친 모달의 뒤 (P10 19)
// 겹친 모달의 뒤(underEl·underScrimEl)는 이 파일을 읽을 때 가림막에 끼운다 — 대화상자(dialogEl) 바로 앞
import type { EggView, Snapshot } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { shinyIcon } from "../ui/shiny-icon.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { iconOf, portraitOf } from "./art-cache.js";
import { lastReplyOf, sendCommand } from "./command.js";
import { actionButtonEl, actionsRowEl, closeDialog, dialogEl, dialogHead, dismissDialog, drawDialog, openAnyDialog, scrimEl } from "./dialog.js";
import type { Hatched } from "./dialog-types.js";
import { petInView, ui } from "./state.js";
import { BOX_ICON, dialogCloseEl, lvNature } from "./widgets.js";

let openingAll = false; // 모두 열기가 알을 차례로 여는 중 — 단추를 다시 누르지 못하게

// 넘김 줄의 돌보미집 단추 — 집 아이콘, `정렬` 왼쪽. 부화할 수 있는 알이 있으면 오른쪽 위 점
// (2026-10-02 사용자 결정 "돌보미집은 집아이콘 만들어서 정렬 왼쪽에 버튼으로 두자")
export function daycareOpenButton(v: Snapshot): HTMLButtonElement {
  const b = buttonEl("icon-button daycare-open");
  b.innerHTML = BOX_ICON.house; // 고정 그림 — 사용자 값이 들어가지 않는다
  b.setAttribute("aria-label", "돌보미집");
  b.title = "돌보미집";
  b.dataset.tut = "hatch"; // 부화 튜토리얼이 밝히는 곳
  const dot = el("span", "dot");
  dot.setAttribute("aria-hidden", "true");
  dot.hidden = !v.eggs.list.some((e) => e.ready);
  b.appendChild(dot);
  b.addEventListener("click", () => openAnyDialog({ kind: "daycare" }));
  return b;
}

// 돌보미집 칸 — 알 그림과 `열기`(준비됨) 또는 남은 시간. 준비된 칸은 톤 바탕 (Figma 05 `Box / Daycare Modal` `1093:23698`)
function daycareCell(egg: EggView, live: boolean): HTMLElement {
  const cell = el("div", egg.ready ? "egg ready" : "egg");
  cell.title = egg.name;
  cell.appendChild(iconOf(egg.icon, "shell"));
  if (egg.ready) {
    const openEgg = buttonEl("primary", "열기");
    openEgg.disabled = !live;
    openEgg.addEventListener("click", () => void openEggAndShow(egg.id, "daycare"));
    cell.appendChild(openEgg);
  } else {
    const note = el("div", "note", egg.noteText);
    note.dataset.liveEgg = egg.id; // 1초 시계가 이 글자만 고친다 (applyLive)
    cell.appendChild(note);
  }
  return cell;
}

// 돌보미집 모달 — 제목·부제(알 수, 준비 수)·✕, 3×2 칸. live 가 아니면 부화 결과 창 뒤에 깔린 모습이다(누를 수 없다)
export function drawDaycare(root: HTMLElement = dialogEl, live = true): void {
  const v = ui.view;
  if (!v) {
    if (live) closeDialog();
    return;
  }
  const ready = v.eggs.list.filter((e) => e.ready).length;
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.append(el("h2", undefined, "돌보미집"), el("div", "sub", `알 ${v.eggs.used} / ${v.eggs.size}${ready ? ` · 부화 준비 ${ready}` : ""}`));
  top.appendChild(titles);
  // 모두 열기 — 준비된 알을 칸 순서대로 모두 열고 결과를 하나씩 보인다. 준비된 알이 없으면 흐리다. 자리는 늘 있다
  // (2026-10-02 사용자 결정, Figma 05 `Box / Daycare Modal`). 부화 결과 창 뒤에 깔린 모습(live 아님)에도 같은 자리에 그린다
  const all = buttonEl("act open-all", "모두 열기");
  all.disabled = !live || ready === 0 || openingAll;
  all.addEventListener("click", () => void openAllEggs());
  const x = dialogCloseEl();
  x.setAttribute("aria-label", "닫기");
  x.disabled = !live;
  x.addEventListener("click", closeDialog);
  top.append(all, x);
  const grid = el("div", "daycare-grid");
  for (let i = 0; i < v.eggs.size; i++) {
    const egg = v.eggs.list[i];
    grid.appendChild(egg ? daycareCell(egg, live) : el("div", "egg empty"));
  }
  root.append(top, grid);
}

// 알 하나를 연다 — 결과를 돌려준다. 실패하면 null (실패 문구는 send 가 띄운다)
async function openEgg(eggId: string): Promise<Hatched | null> {
  if (!(await sendCommand("egg.open", eggId, {}, { keepOpen: true }))) return null;
  const r = lastReplyOf();
  if (!r) return null;
  const egg = r.egg as { id?: unknown } | undefined;
  if (egg && typeof egg.id === "string") return { eggId: egg.id };
  if (typeof r.petId === "string") return { petId: r.petId, ...(typeof r.slotIndex === "number" ? { slotIndex: r.slotIndex } : {}) };
  return null;
}

// 알 열기 — 끝나면 부화 결과 창을 연다. 돌보미집 모달에서 열면 그 모달 위에 겹친다 (2026-09-30 사용자 "열기를 누르면 모달열린채로 부화결과창")
async function openEggAndShow(eggId: string, over?: "daycare"): Promise<void> {
  const got = await openEgg(eggId);
  if (got) openAnyDialog({ kind: "hatched", ...got, ...(over ? { over } : {}) });
}

// 모두 열기 — 준비된 알을 칸 순서대로 하나씩 연다(알마다 egg.open 하나). 다 연 뒤 결과를 하나씩 보인다.
// 여는 중에 실패하면 거기서 멈추고 그때까지 연 결과만 보인다. 하나도 못 열면 실패 문구가 돌보미집 모달에 남는다
async function openAllEggs(): Promise<void> {
  if (openingAll || !ui.view) return;
  const ids = ui.view.eggs.list.filter((e) => e.ready).map((e) => e.id);
  if (!ids.length) return;
  openingAll = true;
  const queue: Hatched[] = [];
  try {
    for (const id of ids) {
      const got = await openEgg(id);
      if (!got) break;
      queue.push(got);
    }
  } finally {
    openingAll = false;
  }
  const first = queue[0];
  if (first) openAnyDialog({ kind: "hatched", ...first, over: "daycare", ...(queue.length > 1 ? { queue, at: 0 } : {}) });
  else drawDialog(); // 단추의 흐림을 되돌린다
}

// 부화 결과 — Figma 05 `Box / Daycare Modal · Hatch Result` `1096:22424`. 제목, 초상·이름·타입·레벨, `확인` 만 둔 작은 창.
// 들어간 자리 안내 줄은 뺐다 — 파티·박스 화면에서 본다 (2026-09-30 사용자 "info 는 삭제해서 부화결과창 ui를 작게")
// 랜덤알에서 단일 포켓몬 알이 나오면 같은 창으로 그 알을 알린다 (docs/specs/game.md 단일 포켓몬 알). 이때는 알이 어디 갔는지 안내가 필요해 두 줄을 남긴다
export function drawHatched(petId?: string, eggId?: string, over?: "daycare", queue?: Hatched[], at = 0): void {
  const card = el("div", "nat-card");
  const info = el("div", "info-box");
  if (eggId) {
    const egg = ui.view?.eggs.list.find((e) => e.id === eggId);
    dialogEl.append(...dialogHead("알에서 새 알이 나왔어요", ""));
    card.append(iconOf(egg?.icon ?? "egg:random", "portrait"), el("div", "name", egg?.name ?? "알"));
    // 태고의돌은 얻은 화석도 다시 나온다 — 상점의 `나오는 포켓몬` 부제와 같은 뜻으로 적는다
    const repeat = egg?.kind === "ancient-stone";
    info.append(el("div", undefined, "돌보미집에 들어갔어요."), el("div", "note", repeat ? "얻은 포켓몬도 다시 나와요." : "아직 얻지 않은 포켓몬이 나와요."));
  } else {
    const pet = petId ? petInView(petId) : undefined;
    if (!pet) {
      closeDialog();
      return;
    }
    dialogEl.append(...dialogHead("알이 부화했어요", ""));
    const tags = el("div", "tags");
    pet.types.forEach((name, i) => tags.appendChild(typeBadgeEl(name, pet.typeIds[i])));
    tags.appendChild(el("span", "note", lvNature(pet.level, pet.nature)));
    const name = el("div", "name", pet.name);
    if (pet.shiny) name.appendChild(shinyIcon(16));
    card.append(portraitOf(pet.look, pet.shiny, "portrait"), name, tags);
  }
  // 모두 열기의 결과는 `다음 (1 / N)` 으로 넘기고 마지막만 `확인 (N / N)` 이다. ✕·Esc·바깥 누르기는 남은 결과를 건너뛴다(dismiss)
  const next = queue?.[at + 1];
  const count = queue ? ` (${at + 1} / ${queue.length})` : "";
  const done = actionButtonEl(`${next ? "다음" : "확인"}${count}`, true, false, () => {
    if (next && queue) openAnyDialog({ kind: "hatched", ...next, ...(over ? { over } : {}), queue, at: at + 1 });
    else if (over) openAnyDialog({ kind: "daycare" });
    else closeDialog();
  });
  done.dataset.confirm = ""; // Space·Enter 가 누르는 단추 (manage.ts 의 keydown)
  dialogEl.append(card);
  if (info.childElementCount) dialogEl.appendChild(info);
  dialogEl.appendChild(actionsRowEl(done));
}

// 겹친 모달의 뒤 — 돌보미집 모달 모습과 한 겹 더 어두운 막 (Figma 05 `1096:22424`)
const underEl = el("div", "dialog daycare under");
const underScrimEl = el("div", "scrim-under");
underEl.hidden = true;
underScrimEl.hidden = true;
scrimEl.insertBefore(underScrimEl, dialogEl);
scrimEl.insertBefore(underEl, underScrimEl);
underScrimEl.addEventListener("click", dismissDialog);
export function drawUnder(): void {
  const stacked = ui.dialog?.kind === "hatched" && ui.dialog.over === "daycare";
  underEl.hidden = !stacked;
  underScrimEl.hidden = !stacked;
  underEl.replaceChildren();
  if (stacked) drawDaycare(underEl, false);
}
