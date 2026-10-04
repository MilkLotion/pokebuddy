// 진화 트리 그리기 — 상점 구매 창(src/renderer/manage/manage.ts)과 도감 기기 창(src/renderer/device/dex.ts)이 같이 쓴다.
// 사슬 자료는 src/tx/shop-detail.ts 의 EvoNodeView. 초상은 창마다 그리는 방법이 달라 부르는 쪽이 넘긴다.
// 모양 CSS(.evo-*)는 manage.html 과 dex.html 에 같은 이름으로 둔다
import type { EvoNodeView } from "../../shared/model/detail.js";
import { el } from "./dom.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// 이브이처럼 갈래가 많으면 방사형 — 가운데 뿌리, 둘레에 갈래 (2026-09-30 사용자 결정 "이브이는 예외라서 방사형으로 하는게 국룰")
export const RADIAL_MIN = 5;
// 순서는 사용자가 준 참고 그림을 따른다 — 위부터 시계 방향. 표에 없는 종은 자료 순서로 뒤에 둔다
const RADIAL_ORDER = ["jolteon", "flareon", "umbreon", "leafeon", "sylveon", "glaceon", "espeon", "vaporeon"];
// 상점 구매 창 기준 — 창(682) 안에 구매 창이 다 들어가게 Figma(300·114)보다 조금 줄였다 (2026-09-30 검수). 도감 기기 창은 폭만 줄여 넘긴다
export interface RadialSize {
  width: number;
  height: number;
  radius: number;
  arrowFrom: number;
  arrowTo: number;
  head: number;
}
export const RADIAL: RadialSize = { width: 390, height: 256, radius: 98, arrowFrom: 40, arrowTo: 58, head: 6 };

// 초상 하나를 그리는 방법 — 창마다 다르다(관리 창은 그림 목록, 도감 기기 창은 메인이 보낸 data URI)
export type PortraitFn = (slug: string, cls: string) => HTMLElement;

// lockedName — 미해금 종의 이름 대신 쓸 글자. 도감 기기 창은 "???" (2026-09-30 사용자 "해금안되어있으면 ??? 로"). 없으면 이름 그대로
export function evoDrawer(portrait: PortraitFn, opts: { lockedName?: string } = {}) {
  // 화살표 — 오른쪽을 가리킨다. 폭은 부르는 쪽이 정한다
  function evoArrow(width: number): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "evo-arrow");
    svg.setAttribute("viewBox", `0 0 ${width} 8`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", "8");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `M0 4H${width}M${width - 4} 0l4 4-4 4`);
    svg.appendChild(path);
    return svg;
  }

  // 초상 자리 — 미해금 종은 검은 실루엣이다. 이름만 ??? 로 가린다 (2026-10-02 사용자 결정 "진화트리 다 실루엣으로 보이게. 이름만 ???").
  // 2026-09-30 의 "실루엣은 안보이게"(빈 원)를 이 결정으로 바꿨다. 그림을 검게 하는 것은 CSS `.portrait.locked .art` 다
  const evoPortrait = (slug: string, locked: boolean, cls: string): HTMLElement => portrait(slug, locked ? `${cls} locked` : cls);

  function evoNodeEl(node: EvoNodeView, withNeed: boolean): HTMLElement {
    const box = el("div", node.current ? "evo-node current" : "evo-node");
    box.dataset.slug = node.slug; // 진화 창이 후보 노드를 찾아 누를 수 있게 한다 (src/renderer/manage/evolve.ts drawEvolve)
    const name = node.locked && opts.lockedName ? opts.lockedName : node.name;
    box.append(evoPortrait(node.slug, node.locked, "portrait"), el("div", "evo-name", name));
    if (withNeed && node.need) box.appendChild(el("div", "evo-need", node.need));
    return box;
  }

  // 일직선·갈래 — 한 종 뒤에 자식 가지를 세로로 쌓는다. 가지마다 조건과 화살표, 그 뒤에 하위 트리
  function evoTree(node: EvoNodeView): HTMLElement {
    const branch = el("div", "evo-branch");
    branch.appendChild(evoNodeEl(node, false));
    if (node.children.length) {
      const kids = el("div", "evo-kids");
      for (const child of node.children) {
        const step = el("div", "evo-step");
        step.append(el("div", "evo-need", child.need ?? ""), evoArrow(22));
        const row = el("div", "evo-row");
        row.append(step, evoTree(child));
        kids.appendChild(row);
      }
      branch.appendChild(kids);
    }
    return branch;
  }

  function evoRadial(root: EvoNodeView, size: RadialSize = RADIAL): HTMLElement {
    const box = el("div", "evo-radial");
    box.style.width = `${size.width}px`;
    box.style.height = `${size.height}px`;
    const rank = (n: EvoNodeView): number => {
      const i = RADIAL_ORDER.indexOf(n.slug);
      return i < 0 ? RADIAL_ORDER.length + root.children.indexOf(n) : i;
    };
    const kids = [...root.children].sort((a, b) => rank(a) - rank(b));
    const cx = size.width / 2;
    const cy = size.height / 2;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "evo-radial-arrows");
    svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    svg.setAttribute("aria-hidden", "true");
    // 노드는 가운데 기준으로 놓는다 — CSS 가 translate(-50%, -50%) 로 맞춘다
    const place = (node: HTMLElement, x: number, y: number): void => {
      node.style.left = `${Math.round(x)}px`;
      node.style.top = `${Math.round(y)}px`;
    };
    kids.forEach((kid, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / kids.length;
      const hx = Math.cos(a);
      const hy = Math.sin(a);
      const x1 = cx + hx * size.arrowFrom;
      const y1 = cy + hy * size.arrowFrom;
      const x2 = cx + hx * size.arrowTo;
      const y2 = cy + hy * size.arrowTo;
      const h = size.head;
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", `M${x1} ${y1}L${x2} ${y2}M${x2 - hx * h - hy * h} ${y2 - hy * h + hx * h}L${x2} ${y2}L${x2 - hx * h + hy * h} ${y2 - hy * h - hx * h}`);
      svg.appendChild(path);
      const node = evoNodeEl(kid, true);
      place(node, cx + hx * size.radius, cy + hy * size.radius);
      box.appendChild(node);
    });
    const center = evoNodeEl(root, false);
    place(center, cx, cy);
    box.append(svg, center);
    return box;
  }

  return { evoTree, evoRadial };
}
