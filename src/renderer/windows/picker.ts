// 첫 실행 — 첫 포켓몬 선택 창. 목록·문구는 메인이 언어에 맞춰 준다 (picker:list).
// 고르고 `함께하기` 를 누르면 슬러그를 메인에 보낸다 (picker:start). 창을 그냥 닫으면 메인이 시작하지 않는다.
// 카드를 두 번 누르면 바로 시작한다
import type { PickerItem, PickerPayload } from "../../shared/model/stage.js";
import { portraitImg } from "../ui/portrait.js";
import { needEl } from "../ui/dom.js";

const list = needEl("list", HTMLElement, "picker");
const title = needEl("title", HTMLElement, "picker");
const start = needEl("start", HTMLButtonElement, "picker");
const chosenName = needEl("chosen-name", HTMLElement, "picker");
const chosenNote = needEl("chosen-note", HTMLElement, "picker");

let picked: string | null = null;

function pick(item: PickerItem, card: HTMLElement) {
  picked = item.slug;
  for (const c of list.querySelectorAll(".card[aria-pressed='true']")) c.setAttribute("aria-pressed", "false");
  card.setAttribute("aria-pressed", "true");
  chosenName.hidden = false;
  chosenName.textContent = item.name;
  chosenNote.textContent = item.evolution;
  chosenNote.title = item.evolution;
  start.disabled = false;
}

function card(item: PickerItem): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "card";
  b.setAttribute("aria-pressed", "false");
  b.dataset.slug = item.slug; // 화면에는 보이지 않는다. E2E 가 종을 찾을 때 쓴다
  const portrait = document.createElement("div");
  portrait.className = "portrait";
  portrait.setAttribute("aria-hidden", "true");
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = item.name;
  b.append(portrait, name);
  b.addEventListener("click", () => pick(item, b));
  b.addEventListener("dblclick", () => {
    pick(item, b);
    window.pokebuddyPicker.start(item.slug);
  });
  return b;
}

function render(payload: PickerPayload) {
  title.textContent = payload.title;
  document.title = payload.title;
  start.textContent = payload.start;
  chosenNote.textContent = payload.empty;
  list.setAttribute("aria-label", payload.title);
  list.replaceChildren(...payload.items.map(card));
  void fillPortraits(payload.items.map((i) => i.slug), 0);
}

// 초상 — 받는 대로 원을 채운다. 못 받은 칸은 잠시 뒤 다시 청한다(첫 실행은 그림을 받는 중일 수 있다)
const PORTRAIT_RETRY = { times: 4, waitMs: 4000 };
async function fillPortraits(slugs: string[], tried: number): Promise<void> {
  const got = await window.pokebuddyPicker.portraits(slugs);
  const left: string[] = [];
  for (const slug of slugs) {
    const b = list.querySelector<HTMLElement>(`.card[data-slug="${CSS.escape(slug)}"]`);
    const host = b?.querySelector<HTMLElement>(".portrait");
    const uri = got[slug];
    if (!host) continue;
    if (!uri) {
      left.push(slug);
      continue;
    }
    host.appendChild(portraitImg(uri));
    host.classList.add("has-art");
  }
  if (!left.length) return;
  if (tried < PORTRAIT_RETRY.times) {
    setTimeout(() => void fillPortraits(left, tried + 1), PORTRAIT_RETRY.waitMs);
    return;
  }
  // 끝내 못 받은 칸 — 깜빡임을 멈추고 빈 원으로 둔다
  for (const slug of left) list.querySelector<HTMLElement>(`.card[data-slug="${CSS.escape(slug)}"] .portrait`)?.classList.add("no-art");
}

void window.pokebuddyPicker.list().then(render);

start.addEventListener("click", () => {
  if (picked) window.pokebuddyPicker.start(picked);
});
