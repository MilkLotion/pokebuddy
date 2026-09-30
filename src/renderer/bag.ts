// 가방 기기 창 — 관리 창이 정해 보낸 도구 하나를 그린다 (src/main/bag-window.ts). Figma 05 `Bag / Device / Use`
// 틀은 상점 기기 창과 같다(item-device.ts). 가운데 조작 칸은 머리 줄(제목·사용|판매), 사용 쪽 파티 줄, 수량, 미리보기 상자.
// 도구는 파티 개체에게만 쓴다. 진화용 도구는 판매만 있다 (2026-10-01 사용자 결정 C안). 누른 단추는 관리 창으로 돌려보낸다
import type { BagDeviceView } from "../shared/manage.js";
import { deviceFrame, el, goButton, qtyRow } from "./item-device.js";

const api = window.pokebuddyBag;
const frame = deviceFrame(api, "bag.html");

function render(v: BagDeviceView): void {
  const act = api.act;
  const card = el("div", "use-card");

  // 머리 줄 — 제목, 사용도 판매도 되면 오른쪽에 `사용 | 판매`
  const head = el("div", "use-head");
  head.appendChild(el("div", "title", v.title));
  if (v.modes) {
    const seg = el("div", "seg");
    for (const [mode, label] of [["use", "사용"], ["sell", "판매"]] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-pressed", String(v.mode === mode));
      b.addEventListener("click", () => act({ itemId: v.itemId, kind: "mode", mode }));
      seg.appendChild(b);
    }
    head.appendChild(seg);
  }
  card.appendChild(head);

  // 파티 줄 — 초상과 레벨. 이름은 title 과 미리보기 첫 줄이 보인다
  if (v.party) {
    if (!v.party.length) card.appendChild(el("div", "party-empty", "파티에 포켓몬이 없어요"));
    else {
      const strip = el("div", "party");
      for (const p of v.party) {
        const b = document.createElement("button");
        b.type = "button";
        b.title = p.name;
        b.setAttribute("aria-pressed", String(p.picked));
        const face = el("div", "face");
        if (p.art) {
          const img = document.createElement("img");
          img.alt = "";
          img.src = p.art;
          face.appendChild(img);
        }
        b.append(face, el("span", undefined, p.level));
        b.addEventListener("click", () => act({ itemId: v.itemId, kind: "target", petId: p.petId }));
        strip.appendChild(b);
      }
      card.appendChild(strip);
    }
  }
  if (v.qty) card.appendChild(qtyRow(v.qty, (qty) => act({ itemId: v.itemId, kind: "qty", qty })));

  // 미리보기 상자 — 결과는 초록, 실패는 빨강. 새 줄을 끼우지 않는다 (2026-09-30 레이아웃 흔들림 금지)
  const preview = el("div", v.preview.tone ? `total ${v.preview.tone}` : "total");
  preview.appendChild(el("strong", undefined, v.preview.lead));
  if (v.preview.line) preview.appendChild(el("div", undefined, v.preview.line));
  card.appendChild(preview);

  const go = goButton(v.go.label, v.go.disabled, v.go.busy, () => act({ itemId: v.itemId, kind: "go" }));
  frame.render({ ...v, title: "가방" }, card, go);
}

api.onShow((view) => {
  // 글꼴을 읽은 뒤에 재야 높이가 맞는다
  void frame.fontsReady.then(() => render(view));
});
