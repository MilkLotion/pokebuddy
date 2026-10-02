// 사각형과 크기 — 메인(무대·창 자리)과 렌더러(히트·영역 그리기)가 같은 모양을 쓴다. 타입만 둔다
// 단위는 쓰는 쪽이 정한다(DIP · 도트 · 무대 좌표)

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}
