// 기기 창 모델 네 벌(view/device-*.ts)이 같이 쓰는 것 — 결과 모양과 그림 열쇠
//
// 그림 열쇠 — 모델의 art 칸에는 data URI 대신 이 열쇠를 싣는다. 그림은 메인의 기기 창 틀(src/main/windows/devices.ts viewOf)이 붙인다
//   portrait:<slug>        초상. 이로치는 portrait:<slug>:shiny
//   item:<id>              도구 그림
//   egg:<알 종류>           색을 바꾼 알 그림. 색표가 없으면 기본 알 그림(icon egg)이다

// 모델과 바로잡은 입력 — 수량을 상한으로 자르거나 없는 대상을 첫 개체로 바꾼 값. 설정창은 다음 명령에 이 입력을 쓴다
export interface DeviceResult<M, I> {
  model: M;
  input: I;
}

export const portraitArtKey = (slug: string, shiny: boolean): string => `portrait:${slug}${shiny ? ":shiny" : ""}`;

export const itemArtKey = (id: string): string => `item:${id}`;

export const eggArtKey = (kind: string): string => `egg:${kind}`;

// 알 칸의 그림 — 태고의돌은 알이 아니라 돌이라 도구 그림이다(우리가 그린 그림)
export const eggIconKey = (kind: string): string => (kind === "ancient-stone" ? itemArtKey(kind) : eggArtKey(kind));

// 상품 그림 — 알은 색을 바꾼 알 그림, 도구·진화용 도구는 도구 그림, 포켓몬은 초상, 파티 칸은 빈 칸
export function shopIconKey(item: { category: string; id: string }): string | null {
  if (item.category === "slot") return null;
  if (item.category === "pokemon") return portraitArtKey(item.id, false);
  if (item.category === "egg") return eggIconKey(item.id);
  return itemArtKey(item.id);
}
