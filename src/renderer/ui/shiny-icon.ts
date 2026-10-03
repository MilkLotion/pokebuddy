// 이로치 아이콘 — Figma `Shiny Mark` `1225:26525` 와 같은 도트 비트맵 (2026-10-02 사용자 결정 "E로 하자")
// 원작 8·9세대 요약 화면의 빨간 네 갈래 별 2개를 도트로 그렸다. 글자 `이로치` 대신 쓴다
// 그림은 10×10 도트 판이고, 크기(px)만큼 늘려 그린다
import { dotIconEl } from "./dot-icon.js";

const BITMAP: readonly string[] = [".......#..", ".......#..", ".....#####", "...#...#..", "...#...#..", "..###.....", "#######...", "..###.....", "...#......", "...#......"];

// 아이콘 색 — Figma `red/600`, manage.html 의 --danger 와 같은 값
const COLOR = "#dc2626";

// 이로치 아이콘 — 부르는 쪽이 이름 옆이나 칸 구석에 붙인다. label 은 툴팁과 접근성 이름이다
export function shinyIcon(size: number, label = "이로치"): SVGSVGElement {
  return dotIconEl({ rows: BITMAP, className: "shiny", label, size, color: COLOR });
}
