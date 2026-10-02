// 이로치 아이콘 — Figma `Shiny Mark` `1225:26525` 와 같은 도트 비트맵 (2026-10-02 사용자 결정 "E로 하자")
// 원작 8·9세대 요약 화면의 빨간 네 갈래 별 2개를 도트로 그렸다. 글자 `이로치` 대신 쓴다
// 그림은 10×10 도트 판이고, 크기(px)만큼 늘려 그린다

const BITMAP: readonly string[] = [".......#..", ".......#..", ".....#####", "...#...#..", "...#...#..", "..###.....", "#######...", "..###.....", "...#......", "...#......"];

// 아이콘 색 — Figma `red/600`, manage.html 의 --danger 와 같은 값
const COLOR = "#dc2626";
const GRID = 10;
const SVG_NS = "http://www.w3.org/2000/svg";

// 비트맵 → 한 줄 path. 도트 하나가 1×1 칸이다
function pathOf(rows: readonly string[]): string {
  let d = "";
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === "#") d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return d;
}

// 이로치 아이콘 — 부르는 쪽이 이름 옆이나 칸 구석에 붙인다. label 은 툴팁과 접근성 이름이다
export function shinyIcon(size: number, label = "이로치"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "shiny");
  svg.setAttribute("viewBox", `0 0 ${GRID} ${GRID}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = label;
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathOf(BITMAP));
  path.setAttribute("fill", COLOR);
  svg.append(title, path);
  return svg;
}
