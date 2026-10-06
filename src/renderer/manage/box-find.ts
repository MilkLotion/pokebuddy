// 박스 찾기 — 박스 머리 줄의 찾기 줄. 모든 박스에서 종 이름으로 찾아 그 박스로 넘기고 그 칸을 강조한다
// (2026-10-07 사용자 "전체박스 기준으로 검색하고 검색되면 해당 박스로 이동 및 해당 포켓몬 강조", 여러 결과는 브라우저 Ctrl+F 꼴)
// 모양: 한 틀 안에 입력칸·n/m | ^ v ✕ (사용자 그림 "([    ]|[][][])", Figma 02 `Find Bar` `1590:60744`)
//   - Enter 로 찾는다. 같은 말로 다시 Enter 면 다음 결과다. ^·v 는 결과 하나씩 옮기고 끝과 끝이 이어진다
//   - 다음 결과가 다른 박스에 있으면 그 박스로 넘긴다. 강조는 지금 결과 한 칸만, 옅은 바탕이다(테두리 강조 없음)
//   - 결과가 없으면 0/0 이고 ^·v 가 흐리다. 줄을 끼우지 않는다
//   - 확인 전 부화 개체(빈 칸으로 보이는 개체)는 찾지 않는다. 파티 프리셋의 개체는 박스에 없으므로 찾지 않는다
//   - 든 개체를 내려놓지 않는다(data-hold) — 든 채로 다른 박스의 결과로 갈 수 있다
import type { PetView, Snapshot } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { chevronDownIconEl, chevronUpIconEl, closeIconEl } from "../ui/line-icons.js";
import { boxUi } from "./box-state.js";
import { forgetSearchDraft, matchesName, normQuery, searchBoxEl } from "./search.js";
import { redrawBody } from "./shell.js";

const FIND_KEY = "box-find";

interface Hit {
  box: number; // 박스 자리
  pet: string;
}

// 이름 — 지금 종 이름. 공유 sid 계열은 고를 수 있는 종 이름도 맞춘다(박스 칸에 계열 이름이 보인다)
function namesOf(pet: PetView): string[] {
  return [pet.name, ...(pet.forms ?? []).map((f) => f.name)];
}

// 결과 — 박스 순서, 그 안은 칸 순서
function hitsOf(v: Snapshot, unseen: ReadonlySet<string>, q: string): Hit[] {
  if (!q) return [];
  const out: Hit[] = [];
  v.boxes.forEach((b, box) => {
    for (const pet of b.slots) {
      if (pet && !unseen.has(pet.id) && namesOf(pet).some((n) => matchesName(n, q))) out.push({ box, pet: pet.id });
    }
  });
  return out;
}

// 결과 하나를 옮긴다. 지금 결과가 없으면(처음 찾기·개체가 사라짐) 앞으로는 첫 결과, 뒤로는 마지막 결과다
function step(hits: Hit[], delta: 1 | -1): void {
  const n = hits.length;
  if (!n) return;
  const at = hits.findIndex((h) => h.pet === boxUi.find.pet);
  const next = hits[at < 0 ? (delta > 0 ? 0 : n - 1) : (at + delta + n) % n];
  if (!next) return;
  boxUi.find.pet = next.pet;
  boxUi.page = next.box;
  boxUi.note = "";
}

function clearFind(): void {
  boxUi.find = { query: "", pet: null };
  forgetSearchDraft(FIND_KEY);
}

function iconButton(cls: string, label: string, icon: SVGSVGElement, run: () => void): HTMLButtonElement {
  const b = buttonEl(`find-btn ${cls}`);
  b.setAttribute("aria-label", label);
  b.title = label;
  b.appendChild(icon);
  b.addEventListener("click", run);
  return b;
}

export function boxFindEl(v: Snapshot, unseen: ReadonlySet<string>): HTMLElement {
  const hits = hitsOf(v, unseen, boxUi.find.query);
  const bar = el("div", "box-find");
  bar.dataset.hold = "";
  const field = searchBoxEl(FIND_KEY, boxUi.find.query, "이름 검색", (q) => {
    const query = normQuery(q);
    if (!query) clearFind();
    else if (query === boxUi.find.query) step(hits, 1);
    else {
      boxUi.find = { query, pet: null };
      step(hitsOf(v, unseen, query), 1);
    }
    redrawBody();
  }, { go: false });
  // n/m — 입력칸 안 오른쪽. 찾지 않는 중이면 비운다. 폭은 고정이라 글자 수가 달라도 단추가 움직이지 않는다
  const at = hits.findIndex((h) => h.pet === boxUi.find.pet);
  const count = el("span", "find-count", boxUi.find.query ? `${at + 1}/${hits.length}` : "");
  const none = hits.length === 0;
  const prev = iconButton("find-prev", "이전 결과", chevronUpIconEl(), () => {
    step(hits, -1);
    redrawBody();
  });
  const next = iconButton("find-next", "다음 결과", chevronDownIconEl(), () => {
    step(hits, 1);
    redrawBody();
  });
  prev.disabled = none;
  next.disabled = none;
  const close = iconButton("find-close", "검색 닫기", closeIconEl(), () => {
    clearFind();
    redrawBody();
  });
  bar.append(field, count, el("span", "find-divider"), prev, next, close);
  return bar;
}
