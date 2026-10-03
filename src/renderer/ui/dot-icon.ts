// 도트 아이콘 — 문자열 비트맵("#" 이 점)을 SVG 하나로. 성별·이로치 아이콘이 같이 쓴다
// 비트맵은 10×10 판 가운데에 놓는다(첫 줄의 폭과 줄 수로 잰다). 10×10 비트맵이면 옮기지 않는다

const GRID = 10;
const SVG_NS = "http://www.w3.org/2000/svg";

// 비트맵 → 한 줄 path. 도트 하나가 1×1 칸이다
function pathOf(rows: readonly string[]): string {
  const width = rows[0]?.length ?? 0;
  const ox = Math.floor((GRID - width) / 2);
  const oy = Math.floor((GRID - rows.length) / 2);
  let d = "";
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === "#") d += `M${ox + x} ${oy + y}h1v1h-1z`;
    });
  });
  return d;
}

// label 은 툴팁과 접근성 이름이다. 크기(px)만큼 늘려 그린다
export function dotIconEl(opts: { rows: readonly string[]; className: string; label: string; size: number; color: string }): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", opts.className);
  svg.setAttribute("viewBox", `0 0 ${GRID} ${GRID}`);
  svg.setAttribute("width", String(opts.size));
  svg.setAttribute("height", String(opts.size));
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", opts.label);
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = opts.label;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathOf(opts.rows));
  path.setAttribute("fill", opts.color);
  svg.append(title, path);
  return svg;
}
