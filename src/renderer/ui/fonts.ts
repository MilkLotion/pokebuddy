// 글꼴 준비 — 빈 문서는 글꼴을 아직 청하지 않아 fonts.ready 가 바로 끝난다. 첫 측정 전에 쓰는 글꼴을 직접 청한다
// - 굵기별로 파일이 따로다(Galmuri11 400·700, Galmuri9 400). 창이 쓰는 것만 준다
// - 실패해도 끝난다 — 그리기는 대체 글꼴로 하고, 늦게 온 글꼴은 창의 ResizeObserver 가 높이를 고친다

// 기기 창 다섯이 쓰는 글꼴 — 파티 기기 창은 Galmuri9 를 쓰지 않아 앞의 둘만 준다
export const DEVICE_FONTS = ['400 12px "Galmuri11"', '700 12px "Galmuri11"', '400 10px "Galmuri9"'] as const;

export function whenFontsReady(fonts: readonly string[]): Promise<unknown> {
  return Promise.allSettled(fonts.map((f) => document.fonts.load(f))).then(() => document.fonts.ready);
}
