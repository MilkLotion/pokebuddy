// 설정창의 진화 창 — 진화 트리로 후보를 고르고 `진화` 로 진화 확인 창을 연다 (P10p, 확인 창은 ./pet-forms.ts drawEvolveConfirm)
// 후보마다 결과 종과 상태를 보인다. 가능한 후보가 하나면 그것을 고른 채로 연다.
// `취소` 는 아무것도 바꾸지 않는다 (docs/specs/game.md "진화 확인 화면에서 취소한 개체는 진화 가능 상태를 유지한다")
import type { EvoNodeView } from "../../shared/model/detail.js";
import { buttonEl, el } from "../ui/dom.js";
import { evoDrawer, RADIAL, RADIAL_MIN } from "../ui/evo-tree.js";
import { api } from "./api.js";
import { portraitOf } from "./art-cache.js";
import { actionButtonEl, actionsRowEl, closeDialog, closeDialogKeepNotice, dialogEl, dialogHead, drawDialog, openAnyDialog, openSubDialog } from "./dialog.js";
import { petInView, ui } from "./state.js";
import { NATURE_SHOWN } from "../../shared/features.js";

// 진화 사슬 — 도감·상점과 같은 트리(src/tx/shop-detail.ts). 종마다 한 번 받는다. 받기 전·못 받으면 후보 줄로 그린다
const evoTrees = new Map<string, EvoNodeView | null>();
const evoTreeAsked = new Set<string>();
function evoTreeOf(species: string): EvoNodeView | null {
  if (evoTrees.has(species)) return evoTrees.get(species) ?? null;
  if (!evoTreeAsked.has(species)) {
    evoTreeAsked.add(species);
    void api
      .shopDetail(species)
      .then((d) => {
        evoTrees.set(species, d?.kind === "pokemon" ? d.tree : null);
        if (ui.dialog?.kind === "evolve") drawDialog();
      })
      .catch((e) => {
        console.error(e); // 사슬을 못 받았다 — 후보 줄로 그린다
        evoTrees.set(species, null);
      });
  }
  return null;
}
const EVOLVE_RADIAL = { ...RADIAL, width: 340 };
const evolveDrawer = evoDrawer((slug, cls) => portraitOf(slug, false, cls));

// 진화 창 — 진화 트리에서 고르고 `진화` 를 누르면 진화 확인 창이 뜬다 (Figma 05 `Party / Detail Device / Evolution Confirm` `1126:23890`, 2026-09-30 사용자 결정 "진화트리 이용해서").
// 2026-09-30 의 "고르고 진화하면 바로 진화되게" 를 2026-10-05 사용자 결정 "진화 누르면 진화하시겠습니까? 그거 창 뜨게" 로 바꿨다
// 지금 종은 회색 톤·굵은 이름, 고른 후보는 청록 톤, 조건이 모자란 후보는 흐리게. 준비된 후보가 있으면 첫 후보를 미리 고른다.
// 도감에서 해금 안 된 후보는 도감 기기 창과 같이 검은 실루엣과 ??? 로 둔다 — 고르기·진화는 된다 (2026-10-01 사용자 결정, Figma 05 `1126:23890`)
export function drawEvolve(petId: string, to?: string): void {
  const pet = petInView(petId);
  if (!pet) {
    closeDialogKeepNotice();
    return;
  }
  // 후보는 전부 — 조건을 못 채운 후보(지도 간선 포함)는 흐리게 누를 수 없게 둔다. 가방에서 오는 길은 없앴다(2026-10-01 진화용 도구 사용 없음)
  const list = pet.evolutions;
  const ready = list.filter((c) => c.ready);
  const picked = list.find((c) => c.to === to && c.ready) ?? ready[0];
  dialogEl.append(...dialogHead("진화", `${pet.name} · Lv.${pet.level}`, { close: true }));

  const tree = evoTreeOf(pet.species);
  if (tree) {
    const card = el("div", "evo-card");
    card.appendChild(tree.children.length >= RADIAL_MIN ? evolveDrawer.evoRadial(tree, EVOLVE_RADIAL) : evolveDrawer.evoTree(tree));
    // 지금 종과 고를 수 있는 후보만 진하게, 나머지(앞 단계·조건이 모자란 후보·그다음 단계)는 흐리게 (2026-10-04 사용자 결정 "고를 수 없는 칸은 다 흐리게")
    for (const node of card.querySelectorAll<HTMLElement>(".evo-node[data-slug]")) {
      if (node.classList.contains("current")) continue;
      const c = list.find((x) => x.to === node.dataset.slug);
      if (!c?.ready) {
        node.classList.add("dim");
        if (c) node.title = c.need ?? "조건이 모자라요";
        continue;
      }
      node.classList.add("pick");
      if (picked?.to === c.to) node.classList.add("picked");
      node.setAttribute("role", "button");
      node.tabIndex = 0;
      node.setAttribute("aria-pressed", String(picked?.to === c.to));
      const choose = (): void => openAnyDialog({ kind: "evolve", petId, to: c.to });
      node.addEventListener("click", choose);
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      });
    }
    dialogEl.appendChild(card);
  }

  // 트리를 아직 못 받았으면 후보 줄로 고른다
  const rows = el("div", "rows");
  for (const c of tree ? [] : list) {
    const row = buttonEl("row-card");
    const body = el("div", "body");
    // 지도 간선은 준비됐을 때도 지도를 쓴다고 적는다 — 옆의 기본형 결과와 가른다
    const readyNote = c.map ? "지도를 쓰면 진화할 수 있어요" : "진화할 수 있어요";
    body.append(el("div", "title", c.name), el("div", "note", c.ready ? readyNote : (c.need ?? "조건이 모자라요")));
    row.appendChild(body);
    row.disabled = !c.ready;
    row.setAttribute("aria-pressed", String(picked?.to === c.to));
    row.addEventListener("click", () => openAnyDialog({ kind: "evolve", petId, to: c.to }));
    rows.appendChild(row);
  }
  if (!tree) dialogEl.appendChild(rows);

  if (picked) {
    const info = el("div", "info-box");
    info.appendChild(el("div", undefined, `${pet.name} → ${picked.name}`));
    // 쓰는 도구 — 돌 진화의 돌, 지도 간선의 지도 하나 ("지도 1개를 씁니다.")
    const uses = picked.uses;
    const useText = uses.map((name) => `${name} 1개`).join("와 "); // "1개" 뒤라 조사는 늘 "와"·"를"
    const kept = NATURE_SHOWN ? "레벨·친밀도·성격은 그대로입니다." : "레벨·친밀도는 그대로입니다.";
    info.appendChild(el("div", "note", uses.length ? `${useText}를 씁니다. ${kept}` : kept));
    // 되돌릴 수 없는 결과는 확인 창에 한 줄로 알린다 (2026-09-27 사용자 "추천대로진행", docs/specs/scenarios.md 진화 흐름)
    info.appendChild(el("div", "note", "진화는 되돌릴 수 없어요."));
    dialogEl.appendChild(info);
  }

  const go = actionButtonEl("진화", true, !picked, () => {
    if (picked) openSubDialog({ kind: "evolve-confirm", petId, to: picked.to }); // 진화 창의 하위 모달 — 물러나면(취소·Esc·가림막) 고른 후보 그대로 진화 창으로
  });
  // 단추는 다른 확인 창처럼 오른쪽에 `취소`·`진화` (Figma 05 `Party / Detail Device / Evolution Confirm` `1126:23890`, 2026-09-30 점검)
  dialogEl.appendChild(actionsRowEl(el("div", "spacer"), actionButtonEl("취소", false, false, closeDialog), go)); // 개체 상세 기기 창에서 열었다 — 닫으면 그 창이 그대로 있다
}
