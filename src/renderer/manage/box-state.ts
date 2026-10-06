// 설정창의 박스·파티 옮기기 상태 — 파티 탭·박스 탭·교체 화면·옮기기·끌기가 같이 읽고 쓴다 (P10 13-0)
// 다른 파일의 let 은 고칠 수 없어(ESM) 객체 둘로 둔다. 상태만 있고 그리기는 없다
// 박스 정렬·이동·이름 (Figma 05 `Box / Sort Open` `633:17372` · `Box / Dragging` `633:17375` · `Box / Rename` `633:17378`)

// 끄는 중인 칸 — 끄는 동안 주기적 새로 그리기를 쉰다. 박스 칸이면 박스·칸 번호, 파티 칸이면 개체 ID
// 박스 순서 모달의 타일이면 박스 ID
export type DragFrom = { boxId: string; slot: number } | { partyPet: string } | { box: string };

export interface HoldState {
  // 옮기기로 든 개체 — 든 동안 원래 칸은 흐리다. ghost 가 참이면 커서를 따라가는 칸도 띄운다.
  //   포켓몬 메뉴의 `옮기기`   커서를 따라간다 (2026-10-01 사용자 결정 "실제 게임처럼 마우스에 들리고")
  //   교체 화면               따라가지 않는다 — 파티 기기 창에서 든 것처럼 원래 칸만 흐리다 (2026-10-02 사용자 결정 "교체일때는 지금처럼유지")
  box: { petId: string; boxId: string; slot: number; ghost: boolean } | null;
  party: string | null; // 파티 기기 창에서 든 파티 개체 — 박스 칸이나 다른 파티 칸을 누르면 거기 놓는다
  // 교체 화면 — 박스 탭 + 파티 기기 창. 파티 탭의 `교체` 와 빈 파티 칸이 연다. 박스 탭을 나가거나 기기 창을 닫으면 끝난다.
  // 이 동안 박스 칸을 누르면 상세 대신 그 개체를 든다. 파티 기기 창의 칸을 누르면 그 칸에 놓는다 (2026-10-02 사용자 결정)
  swap: boolean;
  drag: DragFrom | null;
}
export const hold: HoldState = { box: null, party: null, swap: false, drag: null };

export interface BoxUi {
  page: number; // 보고 있는 박스
  sortOpen: boolean;
  menuOpen: boolean; // 박스 머리의 햄버거 메뉴 — 박스 순서·교환 (2026-10-02 사용자 결정, Figma 05 `Box / Menu Open`)
  renaming: boolean;
  note: string; // 박스 명령이 실패한 이유 — 머리 부제 자리에 보인다. 줄을 끼우지 않는다 (2026-10-01 사용자 "레이아웃은 바뀌면 안된다")
  // 박스 찾기 — 검색한 말(소문자, 빈 글자면 찾지 않는 중)과 지금 결과 개체. 강조는 이 개체 한 칸이다 (box-find.ts)
  find: { query: string; pet: string | null };
}
export const boxUi: BoxUi = { page: 0, sortOpen: false, menuOpen: false, renaming: false, note: "", find: { query: "", pet: null } };
