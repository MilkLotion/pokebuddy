// 설정창의 메가진화·모습 바꾸기 — 메가스톤 표식, 메가진화 창, 모습 바꾸기 확인 (P10p)
// 규칙은 src/dex/mega.ts. 메가스톤을 지닌 개체는 박스 칸에 메가스톤 표식이 붙고, 파티 상세 기기 창의 초상 표식을 누르면 메가진화한다.
// 표식 그림은 키스톤이다 (2026-10-02 사용자 결정 "다 키스톤으로"). PokeAPI 그림은 30×30 이고 구슬은 그 안의 14×14(8,9)다 — 구슬만 잘라 보인다
import type { EvoNodeView } from "../../shared/model/detail.js";
import type { FormView, PetView } from "../../shared/model/snapshot.js";
import { josa } from "../../shared/josa.js";
import { el } from "../ui/dom.js";
import { evoDrawer } from "../ui/evo-tree.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { api } from "./api.js";
import { iconCache, portraitOf } from "./art-cache.js";
import { sendCommand } from "./command.js";
import { actionButtonEl, actionsRowEl, closeDialog, dialogEl, dialogHead, openAnyDialog } from "./dialog.js";
import type { Dialog } from "./dialog-types.js";
import { findPartySlot, petInView } from "./state.js";
import { lvNature } from "./widgets.js";
import { NATURE_SHOWN } from "../../shared/features.js";

// 받침이 있으면 "으로", 없거나 ㄹ 받침이면 "로" — "루나아라로", "코스모움으로"
function toParticle(word: string): string {
  return josa(word, "으로/로");
}

const MEGA_ICON = "item:key-stone";
const MEGA_CROP = { x: 8, y: 9, size: 14, sheet: 30 };

function paintMegaMark(mark: HTMLElement, uri: string): void {
  const k = Number(mark.dataset.megaMark) / MEGA_CROP.size;
  mark.style.backgroundImage = `url("${uri}")`;
  mark.style.backgroundSize = `${MEGA_CROP.sheet * k}px ${MEGA_CROP.sheet * k}px`;
  mark.style.backgroundPosition = `${-MEGA_CROP.x * k}px ${-MEGA_CROP.y * k}px`;
}

export function megaMark(size: number, title = "메가스톤"): HTMLElement {
  const mark = el("span", "mega-mark");
  mark.dataset.megaMark = String(size);
  mark.style.width = `${size}px`;
  mark.style.height = `${size}px`;
  mark.title = title;
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", title);
  const uri = iconCache.get(MEGA_ICON);
  if (uri) paintMegaMark(mark, uri);
  else if (uri === undefined) {
    iconCache.set(MEGA_ICON, null); // 청하는 중 — 두 번 청하지 않는다
    void api.icons([MEGA_ICON]).then((got) => {
      const u = got[MEGA_ICON] ?? null;
      iconCache.set(MEGA_ICON, u);
      if (u) for (const m of document.querySelectorAll<HTMLElement>("[data-mega-mark]")) paintMegaMark(m, u);
    });
  }
  return mark;
}

// 박스 칸의 표식 — 메가스톤을 지닌 개체만 (PetView.mega). 이로치 아이콘은 표식 오른쪽으로 비킨다 (CSS .has-mega)
export function markMega(cell: HTMLElement, pet: PetView, size: number): void {
  if (!pet.mega) return;
  cell.classList.add("has-mega");
  cell.appendChild(megaMark(size));
}

// 메가진화 창 — 파티 상세 기기 창의 메가스톤 표식을 누르면 뜬다 (Figma 05 `Party / Mega Confirm` `1319:50090`·`Party / Mega Confirm · 다른 메가 있음` `1319:50396`·`Party / Detail Device / Mega Choose` `1325:47012`)
//   메가 모습이 하나   바꾸기 확인 창과 같은 모양. 단추는 `메가진화`
//   메가 모습이 둘     진화 창의 틀로 고른다 — 트리는 지금 종과 메가 모습뿐이다. 고르고 `메가진화` 로 바로 바뀐다
//   지금 메가 모습     원래 모습으로 돌아가는 확인
// 같은 프리셋에 메가 모습인 다른 개체가 있으면 그 개체가 원래 모습으로 돌아간다고 한 줄로 알린다
const megaDrawer = (shiny: boolean): ReturnType<typeof evoDrawer> => evoDrawer((slug, cls) => portraitOf(slug, shiny, cls));

export function drawMega(petId: string, to?: string): void {
  const pet = petInView(petId);
  const mega = pet?.mega;
  if (!pet || !mega || !mega.canChange) {
    closeDialog();
    return;
  }
  const word = mega.kind === "primal" ? "원시회귀" : "메가진화";
  const slot = findPartySlot(pet.id);
  const where = slot != null ? `파티 ${slot + 1}번 칸` : "박스";
  const kept = NATURE_SHOWN ? "레벨·친밀도·성격은 그대로예요" : "레벨·친밀도는 그대로예요";
  const change = (species: string): void => {
    void sendCommand("pet.form", pet.id, { species }).then((ok) => {
      if (ok) closeDialog();
    });
  };
  // 확인 창 — 바뀔 모습 카드 + 안내 줄
  const confirm = (title: string, form: FormView, lines: string[], label: string): void => {
    dialogEl.append(...dialogHead(title, ""));
    const card = el("div", "nat-card");
    const tags = el("div", "tags");
    form.types.forEach((name, i) => tags.appendChild(typeBadgeEl(name, form.typeIds[i])));
    tags.appendChild(el("span", "note", lvNature(pet.level, pet.nature)));
    card.append(portraitOf(form.species, pet.shiny, "portrait"), el("div", "name", form.name), tags);
    const row = el("div", "compare");
    row.appendChild(card);
    const info = el("div", "info-box");
    info.appendChild(el("div", undefined, `지금 ${pet.name} · ${where}`));
    for (const text of lines) info.appendChild(el("div", "note", text));
    dialogEl.append(row, info, actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, false, closeDialog), actionButtonEl(label, true, false, () => change(form.species))));
  };
  const rival = mega.rivals.length ? `${mega.rivals.join(" · ")}${josa(mega.rivals[mega.rivals.length - 1] ?? "", "은/는")} 원래 모습으로 돌아가요` : null;

  if (mega.on) {
    const base: FormView = { species: pet.species, name: mega.baseName, types: mega.baseTypes, typeIds: mega.baseTypeIds };
    confirm(`${base.name}${toParticle(base.name)} 돌아갈까요?`, base, [kept, "같은 칸에서 바뀌어요"], "돌아가기");
    return;
  }
  const only = mega.forms.length === 1 ? mega.forms[0] : undefined;
  if (only) {
    confirm(`${only.name}${toParticle(only.name)} ${word}할까요?`, only, [kept, "같은 칸에서 바뀌어요", ...(rival ? [rival] : [])], word);
    return;
  }

  // 고르기 — 진화 창의 틀. 준비된 후보를 미리 고른다
  const picked = mega.forms.find((f) => f.species === to) ?? mega.forms[0];
  const back: { label: string; to: Dialog } = { label: pet.name, to: { kind: "pet", petId } };
  dialogEl.append(...dialogHead(word, `${pet.name} · Lv.${pet.level}`, back));
  const tree: EvoNodeView = {
    slug: pet.species,
    name: pet.name,
    locked: false,
    current: true,
    children: mega.forms.map((f) => ({ slug: f.species, name: f.name, locked: false, current: false, need: "메가스톤", children: [] })),
  };
  const card = el("div", "evo-card mega");
  card.appendChild(megaDrawer(pet.shiny).evoTree(tree));
  for (const node of card.querySelectorAll<HTMLElement>(".evo-node[data-slug]")) {
    const f = mega.forms.find((x) => x.species === node.dataset.slug);
    if (!f) continue;
    node.classList.add("pick");
    if (picked?.species === f.species) node.classList.add("picked");
    node.setAttribute("role", "button");
    node.tabIndex = 0;
    node.setAttribute("aria-pressed", String(picked?.species === f.species));
    const choose = (): void => openAnyDialog({ kind: "mega", petId, to: f.species });
    node.addEventListener("click", choose);
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose();
      }
    });
  }
  dialogEl.appendChild(card);
  if (picked) {
    const info = el("div", "info-box");
    info.append(
      el("div", undefined, `${pet.name} → ${picked.name}`),
      el("div", "note", `${kept}. 언제든 원래 모습으로 돌아가요.`),
      el("div", "note", rival ?? `한 프리셋에서 ${word}는 한 마리예요.`),
    );
    dialogEl.appendChild(info);
  }
  const go = actionButtonEl(word, true, !picked, () => {
    if (picked) change(picked.species);
  });
  dialogEl.appendChild(actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, false, () => openAnyDialog(back.to)), go));
}

// 모습 바꾸기 확인 — Figma `Box / Shared Form Confirm` `473:15738`
export function drawForm(petId: string, to: string): void {
  const pet = petInView(petId);
  const form = (pet?.forms ?? pet?.shiftForms)?.find((f) => f.species === to); // 공유 계열 또는 모습 바꾸기 종(로토무)
  if (!pet || !form) {
    closeDialog();
    return;
  }
  dialogEl.append(...dialogHead(`${form.name}${toParticle(form.name)} 바꿀까요?`, ""));
  const card = el("div", "nat-card");
  const tags = el("div", "tags");
  form.types.forEach((name, i) => tags.appendChild(typeBadgeEl(name, form.typeIds[i])));
  tags.appendChild(el("span", "note", lvNature(pet.level, pet.nature)));
  card.append(portraitOf(form.species, pet.shiny, "portrait"), el("div", "name", form.name), tags);
  const row = el("div", "compare");
  row.appendChild(card);
  const slot = findPartySlot(pet.id);
  const info = el("div", "info-box");
  info.append(
    el("div", undefined, `지금 ${pet.name} · ${slot != null ? `파티 ${slot + 1}번 칸` : "박스"}`),
    el("div", "note", NATURE_SHOWN ? "레벨·친밀도·성격은 그대로예요" : "레벨·친밀도는 그대로예요"),
    el("div", "note", "같은 칸에서 바뀌어요"), // 스탯 문장은 뺐다 — 능력치 기능이 없다 (2026-09-30 사용자 결정 "능력치 … 없애자")
  );
  const go = actionButtonEl("바꾸기", true, false, () => {
    void sendCommand("pet.form", pet.id, { species: to }).then((ok) => {
      if (ok) closeDialog();
    });
  });
  dialogEl.append(row, info, actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, false, closeDialog), go));
}
