// 계정 입력 규칙 — 서버 판정(src/online/account.ts), 설정창 안내(src/renderer/manage/manage.ts), 실패 문구(./fail-text.ts)가 같은 값을 쓴다.
// 렌더러는 shared 만 읽으므로 여기 둔다. 서버(supabase)의 아이디 검사는 SQL 쪽에 따로 있다
export const ACCOUNT_RULES = {
  usernameMin: 4, // 아이디 — 영문 소문자로 시작, 소문자·숫자·_
  usernameMax: 16,
  nameMax: 12, // 화면에 보이는 이름 — 1자 이상
  passwordMin: 8,
} as const;

// 아이디 모양 — 영문 소문자 하나 뒤에 소문자·숫자·_ 를 붙여 usernameMin~usernameMax 자
export const USERNAME_PATTERN = new RegExp(`^[a-z][a-z0-9_]{${ACCOUNT_RULES.usernameMin - 1},${ACCOUNT_RULES.usernameMax - 1}}$`);
