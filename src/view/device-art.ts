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
