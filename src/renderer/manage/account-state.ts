// 설정창의 계정 상태 — 계정 탭(account.ts)과 그 폼(account-forms.ts)이 같이 읽고 쓴다 (P10m 나눔)
// 다른 파일의 let 은 고칠 수 없어(ESM) 객체 둘로 둔다. 상태만 있고 그리기는 없다 (box-state.ts 와 같은 꼴)
// 입력한 글자도 여기 들고 있다 — 1초 시계로 다시 그려도 사라지지 않게
import type { AccountScreen, UsernameCheck } from "../../shared/model/account.js";

export interface AccountUi {
  screen: AccountScreen | null; // 메인이 준 계정 화면 값
  loading: boolean; // 처음 상태를 읽는 중
  busy: boolean; // 계정 요청의 답을 기다리는 중
  github: boolean; // 브라우저에서 GitHub 로그인을 기다리는 중
  rename: string | null; // 이름 바꾸는 중이면 입력한 이름
  confirm: "delete" | "sign-out" | null; // 띄운 확인 창
  saving: "no" | "wait" | "slow"; // [저장하기] — 답을 기다림, 답이 늦어 처리 중 표시
}
export const accountUi: AccountUi = { screen: null, loading: false, busy: false, github: false, rename: null, confirm: null, saving: "no" };

export const acctForm = { mode: "sign-in" as "sign-in" | "sign-up", username: "", password: "", password2: "", displayName: "", error: "", check: "" as "" | UsernameCheck };
