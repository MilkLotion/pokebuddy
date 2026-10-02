// 앱이 그리는 메뉴 — 메인이 준 항목을 그리고 고른 항목의 번호를 돌려준다 (src/main/menu-window.ts).
// 방향키로 가리키고 Enter 로 고른다. Esc 는 닫기만 한다. 가리킨 항목은 옅은 배경이다 (Figma `Menu Item` Hover)
// 말풍선이 달린 항목(포켓몬 메뉴의 `모습 바꾸기`)은 눌러도 메뉴가 닫히지 않는다 — 메뉴 옆에 말풍선이 붙어 뜬다.
//   마우스를 올려서는 뜨지 않는다 (2026-10-02 사용자 "클릭해야 나오게 하자"). 다시 누르거나 Esc·←(→) 로 말풍선만 닫는다
//   말풍선의 자리는 창을 띄울 때 한 번 잡는다 — 창이 말풍선 자리까지 넓으므로 빈 곳을 누르면 메뉴를 닫는다
import type { MenuSubView, MenuView } from "../../shared/model/overlays.js";
import { portraitImg } from "../ui/portrait.js";

function need(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLElement)) throw new Error(`menu.html 에 #${id} 가 없다`);
  return node;
}
const wrap = need("wrap");
const menu = need("menu");
const bubble = need("bubble");
const api = window.pokebuddyMenu;

const SUB_GAP = 8; // 메뉴와 말풍선 사이 — src/main/menu-window.ts SUB_GAP 과 같다
const SUB_DROP = 5; // 말풍선 아래 끝은 그 항목 아래 끝보다 이만큼 아래 — 메뉴 안쪽 여백 4 + 테두리 1
const TAIL = 10; // 꼬리 한 변 — menu.html `.tail`

let buttons: HTMLButtonElement[] = [];
let at = -1; // 가리킨 항목 (buttons 안의 번호)
let rows: HTMLButtonElement[] = [];
let rowAt = -1; // 말풍선 안에서 가리킨 줄
let opener: HTMLButtonElement | null = null; // 말풍선이 달린 항목
let opened = false;

function point(i: number): void {
  at = i;
  buttons.forEach((b, n) => b.classList.toggle("on", n === i));
}
function pointRow(i: number): void {
  rowAt = i;
  rows.forEach((r, n) => r.classList.toggle("on", n === i));
}

// 누를 수 있는 다음 항목 — 끝에서는 반대쪽으로 돈다
function step(list: HTMLButtonElement[], from: number, dir: 1 | -1): number {
  if (!list.some((b) => !b.disabled)) return from;
  let i = from;
  do i = (i + dir + list.length) % list.length;
  while (list[i]?.disabled);
  return i;
}

function setOpen(on: boolean): void {
  if (!opener) return;
  opened = on;
  bubble.classList.toggle("shown", on);
  opener.classList.toggle("open", on);
  opener.setAttribute("aria-expanded", String(on));
  if (!on) pointRow(-1);
}

function drawBubble(sub: MenuSubView): void {
  bubble.replaceChildren();
  rows = [];
  const tail = document.createElement("div");
  tail.className = "tail";
  const head = document.createElement("div");
  head.className = "head";
  head.textContent = sub.title;
  bubble.append(tail, head);
  for (const row of sub.rows) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "row";
    b.setAttribute("role", "menuitem");
    b.disabled = row.current;
    if (row.current) b.setAttribute("aria-current", "true");
    const face = document.createElement("span");
    face.className = "face";
    if (row.icon) {
      face.appendChild(portraitImg(row.icon));
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = row.label;
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = row.note;
    b.append(face, name, note);
    const index = rows.length;
    b.addEventListener("mouseenter", () => {
      if (!b.disabled) pointRow(index);
    });
    // 마우스가 나가면 가리킨 표시를 지운다 — 남으면 지금 줄과 함께 두 줄이 칠해져 보인다 (2026-10-02 사용자 "호버했다가 치워도 저 배경이 안사라져")
    b.addEventListener("mouseleave", () => {
      if (rowAt === index) pointRow(-1);
    });
    b.addEventListener("click", () => api.pick(row.id));
    rows.push(b);
    bubble.appendChild(b);
  }
}

// 말풍선의 세로 자리 — 아래 끝을 그 항목 아래 끝 + SUB_DROP 에 맞춘다. 메뉴 위로 넘치면 메뉴 위 끝에 붙인다.
// 꼬리는 그 항목의 세로 가운데를 가리킨다
function bubbleTop(item: HTMLElement): number {
  const top = Math.max(0, item.offsetTop + item.offsetHeight + SUB_DROP - bubble.offsetHeight);
  const tail = bubble.querySelector<HTMLElement>(".tail");
  if (tail) tail.style.top = `${Math.round(item.offsetTop + item.offsetHeight / 2 - top - TAIL / 2 - 1)}px`; // -1 은 말풍선 테두리
  return top;
}

api.onShow((items: MenuView[]) => {
  menu.replaceChildren();
  bubble.replaceChildren();
  buttons = [];
  rows = [];
  opener = null;
  opened = false;
  for (const item of items) {
    if (item.kind === "status") {
      const box = document.createElement("div");
      box.className = "status";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = item.title;
      box.appendChild(title);
      if (item.caption) {
        const caption = document.createElement("div");
        caption.className = "caption";
        caption.textContent = item.caption;
        box.appendChild(caption);
      }
      menu.appendChild(box);
      continue;
    }
    if (item.kind === "separator") {
      const sep = document.createElement("div");
      sep.className = "separator";
      sep.setAttribute("role", "separator");
      menu.appendChild(sep);
      continue;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "item";
    b.setAttribute("role", "menuitem");
    b.disabled = item.disabled;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = item.label;
    b.appendChild(label);
    if (item.hint) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = item.hint;
      b.appendChild(hint);
    }
    const index = buttons.length;
    b.addEventListener("mouseenter", () => {
      if (!b.disabled) point(index);
    });
    b.addEventListener("mouseleave", () => {
      if (at === index) point(-1);
    });
    // 말풍선이 달린 항목은 메뉴를 닫지 않는다 — 말풍선을 열고 닫는다. 메뉴에 말풍선은 하나만 둔다
    if (item.sub && !opener) {
      opener = b;
      b.setAttribute("aria-haspopup", "menu");
      b.setAttribute("aria-expanded", "false");
      drawBubble(item.sub);
      b.addEventListener("click", () => setOpen(!opened));
    } else {
      b.addEventListener("click", () => api.pick(item.id));
    }
    buttons.push(b);
    menu.appendChild(b);
  }
  menu.focus();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  if (!opener) {
    api.size(w, h); // 그림자 자리(양쪽 8)를 뺀 메뉴 크기
    return;
  }
  const top = bubbleTop(opener);
  bubble.style.top = `${top}px`;
  wrap.style.width = `${w + SUB_GAP + bubble.offsetWidth}px`;
  wrap.style.height = `${Math.max(h, top + bubble.offsetHeight)}px`;
  api.size(w, h, { w: bubble.offsetWidth, h: bubble.offsetHeight, top });
});

// 말풍선이 뜰 쪽 — 오른쪽이면 메뉴가 틀의 왼쪽에, 왼쪽이면 메뉴가 틀의 오른쪽에 앉는다
api.onSide((side) => {
  const extra = SUB_GAP + bubble.offsetWidth;
  wrap.classList.toggle("side-left", side === "left");
  menu.style.marginLeft = side === "left" ? `${extra}px` : "0";
  bubble.style.left = side === "left" ? "0" : `${menu.offsetWidth + SUB_GAP}px`;
  api.placed();
});

// 창은 말풍선 자리까지 넓다 — 메뉴와 말풍선 밖의 빈 곳을 누르면 닫는다
document.addEventListener("mousedown", (e) => {
  const on = e.target instanceof Node && (menu.contains(e.target) || (opened && bubble.contains(e.target)));
  if (!on) api.pick(null);
});

document.addEventListener("keydown", (e) => {
  const back = wrap.classList.contains("side-left") ? "ArrowRight" : "ArrowLeft"; // 말풍선에서 메뉴로 돌아가는 쪽
  const into = back === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
  if (opened && rowAt >= 0) {
    // 말풍선 안
    if (e.key === "ArrowDown") pointRow(step(rows, rowAt, 1));
    else if (e.key === "ArrowUp") pointRow(step(rows, rowAt, -1));
    else if (e.key === "Enter") rows[rowAt]?.click();
    else if (e.key === back) pointRow(-1);
    else if (e.key === "Escape") setOpen(false);
    else return;
  } else if (e.key === "ArrowDown") point(step(buttons, at, 1));
  else if (e.key === "ArrowUp") point(step(buttons, at, -1));
  else if (e.key === "Escape") {
    if (opened) setOpen(false);
    else api.pick(null);
  } else if (e.key === into && opener && buttons[at] === opener) {
    setOpen(true);
    pointRow(step(rows, -1, 1));
  } else if (e.key === "Enter" && at >= 0) {
    buttons[at]?.click();
    if (opened && buttons[at] === opener) pointRow(step(rows, -1, 1));
  } else return;
  e.preventDefault();
});
