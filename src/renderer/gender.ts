// 성별 아이콘 — Figma `Gender Icon` `995:333` 과 같은 도트 비트맵 (2026-09-30 사용자 결정 "이정도면 될듯")
// 원작 ♂(파랑)·♀(빨강) 모양을 도트로 그렸다. Galmuri 에 ♂♀ 글리프가 없어 글자 대신 쓴다. 무성은 아이콘을 두지 않는다
// 그림은 10×10 도트 판 가운데에 놓고, 크기(px)만큼 늘려 그린다

type Sex = "male" | "female";

const BITMAP: Readonly<Record<Sex, readonly string[]>> = {
  male: [".....####", ".......##", "......#.#", "..####...", ".##..##..", ".#....#..", ".#....#..", ".##..##..", "..####..."],
  female: ["..###..", ".#...#.", "#.....#", "#.....#", "#.....#", ".#...#.", "..###..", "...#...", ".#####.", "...#..."],
};

// 성별 색 — Figma 와 같은 값 (제안값)
const COLOR: Readonly<Record<Sex, string>> = { male: "#3885f0", female: "#ed4d66" };
const LABEL: Readonly<Record<Sex, string>> = { male: "수컷", female: "암컷" };
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

// 성별 아이콘 — 무성이면 null. 부르는 쪽이 이름 옆에 붙인다
export function genderIcon(gender: string, size: number): SVGSVGElement | null {
  if (gender !== "male" && gender !== "female") return null;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `gender ${gender}`);
  svg.setAttribute("viewBox", `0 0 ${GRID} ${GRID}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", LABEL[gender]);
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = LABEL[gender];
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathOf(BITMAP[gender]));
  path.setAttribute("fill", COLOR[gender]);
  svg.append(title, path);
  return svg;
}
