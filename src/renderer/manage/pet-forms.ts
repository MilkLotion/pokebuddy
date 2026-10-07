// 설정창의 메가진화·모습 바꾸기·진화 확인 — 메가스톤 표식, 메가진화 창, 모습 바꾸기 확인, 진화 확인 (P10p)
// 규칙은 src/dex/mega.ts. 메가스톤을 지닌 개체는 박스 칸에 메가스톤 표식이 붙고, 파티 상세 기기 창의 초상 표식을 누르면 메가진화한다.
// 표식 그림은 키스톤이다 (2026-10-02 사용자 결정 "다 키스톤으로"). PokeAPI 그림은 30×30 이고 구슬은 그 안의 14×14(8,9)다 — 구슬만 잘라 보인다
import type { EvoNodeView } from "../../shared/model/detail.js";
import type { EvolutionView, FormView, PetView } from "../../shared/model/snapshot.js";
import { josa } from "../../shared/josa.js";
import { el } from "../ui/dom.js";
import { evoDrawer } from "../ui/evo-tree.js";
import { typeBadgeEl } from "../ui/type-badge.js";
import { api } from "./api.js";
import { iconCache, portraitOf } from "./art-cache.js";
import { sendCommand } from "./command.js";
import { actionButtonEl, actionsRowEl, closeDialog, dialogEl, dialogHead, openAnyDialog } from "./dialog.js";
import type { Dialog } from "./dialog-types.js";
import { findPartySlot, petInView, ui } from "./state.js";
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
// battle — 배틀 파티 상세 기기 창의 표식에서 열었다. 같은 창이고 바꾸는 것만 배틀 파티의 메가 상태다(battle.mega). 바탕화면의 모습은 그대로다
// (docs/specs/adventure.md "메가진화")
const megaDrawer = (shiny: boolean): ReturnType<typeof evoDrawer> => evoDrawer((slug, cls) => portraitOf(slug, shiny, cls));

export function drawMega(petId: string, to?: string, battle = false): void {
  const slot = battle ? ui.view?.battle.slots.find((s) => s.pet?.id === petId) : undefined;
  const pet = battle ? slot?.pet : petInView(petId);
  const mega = pet?.mega;
  if (!pet || !mega || !mega.canChange) {
    closeDialog();
    return;
  }
  const word = mega.kind === "primal" ? "원시회귀" : "메가진화";
  const where = slot ? `배틀 파티 ${slot.index + 1}번` : whereText(pet);
  const kept = KEPT;
  const change = (species: string): void => {
    const send = battle ? sendCommand("battle.mega", pet.id, { form: species === pet.species ? null : species }) : sendCommand("pet.form", pet.id, { species });
    void send.then((ok) => {
      if (ok) closeDialog();
    });
  };
  // 확인 창 — 지금 모습 → 바뀔 모습 카드 + 안내 줄
  const confirm = (title: string, form: FormView, lines: string[], label: string): void => {
    dialogEl.append(...dialogHead(title, ""));
    const row = compareEl(pet, formCardEl(pet, form.species, form.name, form.types, form.typeIds));
    const info = el("div", "info-box");
    info.appendChild(el("div", undefined, `지금 ${pet.name} · ${where}`));
    for (const text of lines) info.appendChild(el("div", "note", text));
    dialogEl.append(row, info, actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, false, closeDialog), actionButtonEl(label, true, false, () => change(form.species))));
  };
  const place = battle ? "배틀 파티에서만 바뀌어요. 바탕화면은 그대로예요" : "같은 칸에서 바뀌어요";
  const rival = battle ? `배틀 파티에서 ${word}는 한 마리만 출전해요` : mega.rivals.length ? `${mega.rivals.join(" · ")}${josa(mega.rivals[mega.rivals.length - 1] ?? "", "은/는")} 원래 모습으로 돌아가요` : null;

  if (mega.on) {
    const base: FormView = { species: pet.species, name: mega.baseName, types: mega.baseTypes, typeIds: mega.baseTypeIds };
    confirm(`${base.name}${toParticle(base.name)} 돌아갈까요?`, base, [kept, place], "돌아가기");
    return;
  }
  const only = mega.forms.length === 1 ? mega.forms[0] : undefined;
  if (only) {
    confirm(`${only.name}${toParticle(only.name)} ${word}할까요?`, only, [kept, place, ...(rival ? [rival] : [])], word);
    return;
  }

  // 고르기 — 진화 창의 틀. 준비된 후보를 미리 고른다
  const picked = mega.forms.find((f) => f.species === to) ?? mega.forms[0];
  const back: { label: string; to: Dialog } = { label: pet.name, to: { kind: "pet", petId } };
  dialogEl.append(...(battle ? dialogHead(word, where) : dialogHead(word, `${pet.name} · Lv.${pet.level}`, back)));
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
    const choose = (): void => openAnyDialog({ kind: "mega", petId, to: f.species, ...(battle ? { battle: true as const } : {}) });
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
  dialogEl.appendChild(actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, false, () => (battle ? closeDialog() : openAnyDialog(back.to))), go));
}

// 확인 창 안내의 공통 줄
const KEPT = NATURE_SHOWN ? "레벨·친밀도·성격은 그대로예요" : "레벨·친밀도는 그대로예요";
const whereText = (pet: PetView): string => {
  const slot = findPartySlot(pet.id);
  return slot != null ? `파티 ${slot + 1}번 칸` : "박스";
};
// 쓰는 도구 한 줄 — "천둥의돌 1개를 써요", 둘이면 "물의돌 1개와 지도 1개를 써요" ("1개" 뒤라 조사는 늘 "와"·"를")
const usesText = (uses: readonly string[]): string => `${uses.map((name) => `${name} 1개`).join("와 ")}를 써요`;

// 지금 모습 → 바뀔 모습 두 카드 — 모습 바꾸기·메가진화·원래 모습·진화 확인이 같이 쓴다
// (Figma 03 `Form Confirm Panel` `1315:47600` 의 `before-after`, 2026-10-05 사용자 결정 "이전모습 -> 다음모습 으로 … 진화처럼")
// locked — 도감에서 해금 안 된 진화 결과. 진화 트리처럼 검은 실루엣으로 그린다
// 카드는 초상·이름·타입만 둔다. 레벨 줄은 두지 않는다 — 바뀌지 않는 값이다 (2026-10-08 사용자 결정 "레벨만 제거", "다른 확인 창에도 동일하게")
function formCardEl(pet: PetView, species: string, name: string, types: string[], typeIds: string[], locked = false): HTMLElement {
  const card = el("div", "nat-card");
  const tags = el("div", "tags");
  types.forEach((t, i) => tags.appendChild(typeBadgeEl(t, typeIds[i])));
  card.append(portraitOf(species, pet.shiny, locked ? "portrait locked" : "portrait"), el("div", "name", name), tags);
  return card;
}
// 화살표 위에는 쓰는 도구 이름 — 로토무카탈로그·진화 돌·지도. 없으면 화살표만
// (2026-10-05 사용자 결정 "화살표에 필요한아이템 적어", Figma 03 `Form Confirm Panel` 의 `step`)
function compareEl(pet: PetView, after: HTMLElement, uses: readonly string[] = []): HTMLElement {
  const row = el("div", "compare form-compare");
  const arrow = el("div", "compare-arrow");
  if (uses.length) arrow.appendChild(el("div", "compare-item", uses.join(" · ")));
  const mark = el("div", "compare-mark", "→");
  mark.setAttribute("aria-hidden", "true");
  arrow.appendChild(mark);
  row.append(formCardEl(pet, pet.look, pet.name, pet.types, pet.typeIds), arrow, after);
  return row;
}

// 모습 바꾸기 확인 — Figma `Box / Shared Form Confirm` `1315:47601`. 도구를 쓰는 모습(로토무)은 화살표와 안내에 `로토무카탈로그`
// 안내는 세 줄이다 — 도구가 있으면 `같은 칸에서 바뀌어요` 대신 도구 줄.
// 한 방향 모습(플라엣테(영원의 꽃)·다투곰(붉은 달))은 넷째 줄 `원래 모습으로 돌아갈 수 없어요` (2026-10-08 사용자 확인, Figma 05 `Box / Form Confirm · 영원의 꽃`)
export function drawForm(petId: string, to: string): void {
  const pet = petInView(petId);
  const form = (pet?.forms ?? pet?.shiftForms)?.find((f) => f.species === to); // 공유 계열 또는 모습 바꾸기 종(로토무)
  if (!pet || !form) {
    closeDialog();
    return;
  }
  dialogEl.append(...dialogHead(`${form.name}${toParticle(form.name)} 바꿀까요?`, ""));
  const item = pet.formItem && to !== pet.formItem.base ? pet.formItem.name : null;
  const row = compareEl(pet, formCardEl(pet, form.species, form.name, form.types, form.typeIds), item ? [item] : []);
  const info = el("div", "info-box");
  info.appendChild(el("div", undefined, `지금 ${pet.name} · ${whereText(pet)}`));
  if (item) info.appendChild(el("div", "note", usesText([item])));
  info.appendChild(el("div", "note", KEPT));
  if (!item) info.appendChild(el("div", "note", "같은 칸에서 바뀌어요")); // 스탯 문장은 뺐다 — 능력치 기능이 없다 (2026-09-30 사용자 결정 "능력치 … 없애자")
  if (item && pet.formItem?.oneWay) info.appendChild(el("div", "note", "원래 모습으로 돌아갈 수 없어요"));
  const go = actionButtonEl("바꾸기", true, false, () => {
    void sendCommand("pet.form", pet.id, { species: to }).then((ok) => {
      if (ok) closeDialog();
    });
  });
  dialogEl.append(row, info, actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, false, closeDialog), go));
}

// 진화 확인 — 진화 창의 `진화` 가 연다. 지금 종 → (쓰는 도구) → 진화 뒤 종
// (2026-10-05 사용자 결정 "진화 누르면 진화하시겠습니까? 그거 창 뜨게 … 그 모달 응용해서", Figma 05 진화 확인 화면)
// 안내는 세 줄 — 위치, 쓰는 도구(없으면 그대로인 값), 되돌릴 수 없다. `취소` 는 고른 후보 그대로 진화 창으로 돌아간다
export function drawEvolveConfirm(petId: string, to: string): void {
  const pet = petInView(petId);
  const c: EvolutionView | undefined = pet?.evolutions.find((x) => x.to === to && x.ready);
  // 후보가 없으면 닫는다 — 진화가 끝나 새 스냅샷으로 다시 그릴 때도 여기로 온다(진화 창으로 돌리면 진화 뒤 종의 진화 창이 남는다)
  if (!pet || !c) {
    closeDialog();
    return;
  }
  const back: Dialog = { kind: "evolve", petId, to };
  dialogEl.append(...dialogHead(`${c.name}${toParticle(c.name)} 진화할까요?`, ""));
  const row = compareEl(pet, formCardEl(pet, c.to, c.name, c.types, c.typeIds, !c.known), c.uses);
  const info = el("div", "info-box");
  info.append(
    el("div", undefined, `지금 ${pet.name} · ${whereText(pet)}`),
    el("div", "note", c.uses.length ? usesText(c.uses) : KEPT),
    el("div", "note", "진화는 되돌릴 수 없어요"),
  );
  const go = actionButtonEl("진화", true, false, () => {
    void sendCommand("evolve", pet.id, { to: c.to }).then((ok) => {
      if (ok) openAnyDialog({ kind: "pet", petId });
    });
  });
  dialogEl.append(row, info, actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, false, () => openAnyDialog(back)), go));
}
