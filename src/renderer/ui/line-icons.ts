// 선 아이콘 — 16 × 16 선 그림. 선 색·굵기는 각 창의 CSS 가 정한다
// - 파티 칸의 빈 칸(+)과 잠긴 칸·자물쇠 칩(자물쇠). Figma `Party Slot` state/empty·state/locked. 설정창의 파티 칸과 파티 기기 창이 같이 쓴다
// - 닫기(×). Figma `Icon / Close` `299:166`. 코치마크 말풍선의 ✕(세 창)와 설정창의 대화상자·경고 배너 닫기가 쓴다.
//   기기 창 머리 줄의 ✕ 는 Figma `Device Top` 이 글자라 글자 그대로다

const SVG_NS = "http://www.w3.org/2000/svg";

function lineIconEl(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

export const lockIconEl = (): SVGSVGElement =>
  lineIconEl([
    "M12 6.86H4c-.63 0-1.14.51-1.14 1.14v5.14c0 .63.51 1.15 1.14 1.15h8c.63 0 1.14-.52 1.14-1.15V8c0-.63-.51-1.14-1.14-1.14Z",
    "M5.14 6.86V5.14a2.86 2.86 0 0 1 5.72 0v1.72",
  ]);

export const plusIconEl = (): SVGSVGElement => lineIconEl(["M8 3.64v8.72M3.64 8h8.72"]);

export const closeIconEl = (): SVGSVGElement => lineIconEl(["M4 4l8 8", "M12 4l-8 8"]);

// 위아래 화살표 — 순서 바꾸기·교환 표시. 배틀 파티 상세 기기 창, 기술 바꾸기 모달, 교환 화면이 같이 쓴다 (Figma 02 `Trade Swap Mark` `1347:49286`)
export const swapIconEl = (): SVGSVGElement => {
  const svg = lineIconEl(["M5 13 V3", "M2 6 L5 3 L8 6", "M11 3 V13", "M8 10 L11 13 L14 10"]);
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  return svg;
};

// 위·아래 꺽쇠 — 박스 찾기 줄의 이전·다음 결과. 닫기와 같은 선이다 (Figma 01 `Icon / Chevron Up` `1590:60740`·`Icon / Chevron Down` `1590:60742`)
export const chevronUpIconEl = (): SVGSVGElement => lineIconEl(["M4 10l4-4 4 4"]);
export const chevronDownIconEl = (): SVGSVGElement => lineIconEl(["M4 6l4 4 4-4"]);
