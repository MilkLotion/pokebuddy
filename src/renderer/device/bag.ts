// 가방 기기 창 — 메인이 만들어 보낸 도구 하나를 그린다 (src/main/bag-window.ts). Figma 05 `Bag / Device / Use`
// 틀은 상점 기기 창과 같다(item-face.ts). 가운데 조작 칸은 머리 줄(제목·사용|판매), 사용 쪽 파티 줄, 수량, 미리보기 상자.
// 도구는 파티 개체에게만 쓴다. 진화용 도구는 판매만 있다 (2026-10-01 사용자 결정 C안). 누른 단추는 관리 창으로 돌려보낸다
import type { BagDeviceView } from "../../shared/model/devices.js";
import { needBridge } from "../ui/bridge.js";
import { createDeviceFrame } from "./device-frame.js";
import { drawItemFace, goButtonEl, qtyRowEl, totalBoxEl } from "./item-face.js";
import { portraitImg } from "../ui/portrait.js";
import { el } from "../ui/dom.js";

const api = needBridge("pokebuddyBag");
const frame = createDeviceFrame({ api, windowName: "bag" });

function render(v: BagDeviceView): void {
  const act = api.act;
  const card = el("div", "use-card");

  // 머리 줄 — 제목, 사용도 판매도 되면 오른쪽에 `사용 | 판매`
  // 프리셋이 둘 이상이면 제목(프리셋 이름) 양옆에 ◀ ▶ — 누르면 앞·뒤 프리셋을 적용한다.
  // 파티 줄 양끝에 세로로 길게 두던 것을 머리 줄로 올렸다 (2026-10-02 사용자 결정 B안, Figma 03 `Bag Device` `State=Use`)
  const head = el("div", "use-head");
  const title = el("div", "title", v.title);
  if (v.party && v.pager) {
    const arrow = (label: string, delta: -1 | 1, name: string): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "preset-step";
      b.textContent = label;
      b.setAttribute("aria-label", name);
      b.addEventListener("click", () => act({ itemId: v.itemId, kind: "preset", delta }));
      return b;
    };
    const nav = el("div", "preset-nav");
    nav.append(arrow("◀", -1, "앞 프리셋"), title, arrow("▶", 1, "다음 프리셋"));
    head.appendChild(nav);
  } else head.appendChild(title);
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

  // 파티 줄 — 초상과 레벨. 이름은 title 과 미리보기 첫 줄이 보인다. 줄은 칸 폭 전체를 쓴다 (Figma 05 `Bag / Device / Use` `1242:1896`)
  if (v.party) {
    const row = el("div", "party-row");
    if (!v.party.length) row.appendChild(el("div", "party-empty", "파티에 포켓몬이 없어요"));
    else {
      const strip = el("div", v.riders ? "party riders" : "party");
      for (const p of v.party) {
        const b = document.createElement("button");
        b.type = "button";
        b.title = p.name;
        b.setAttribute("aria-pressed", String(p.picked));
        const face = el("div", "face");
        if (p.art) face.appendChild(portraitImg(p.art));
        b.append(face, el("span", undefined, p.level));
        // 유대의고삐의 이미 가진 말 — 흐리고 못 고른다 (docs/specs/game.md "버드렉스의 말 부르기")
        if (p.dim) b.disabled = true;
        else b.addEventListener("click", () => act({ itemId: v.itemId, kind: "target", petId: p.petId }));
        strip.appendChild(b);
      }
      row.appendChild(strip);
    }
    card.appendChild(row);
  }
  if (v.qty) card.appendChild(qtyRowEl(v.qty, (qty) => act({ itemId: v.itemId, kind: "qty", qty })));

  // 미리보기 상자 — 결과는 초록, 실패는 빨강. 새 줄을 끼우지 않는다 (2026-09-30 레이아웃 흔들림 금지)
  card.appendChild(totalBoxEl(v.preview));

  const go = goButtonEl(v.go.label, v.go.disabled, v.go.busy, () => act({ itemId: v.itemId, kind: "go" }));
  drawItemFace(frame, { ...v, title: "가방" }, card, go);
}

frame.showWith((cb) => api.onShow(cb), render);
