// 렌더러가 보낸 값의 검사 — 창이 받는 값은 믿지 않는다. 정해진 모양만 넘긴다 (worklog/records/code-structure/design/10-main.md 3.3절)
// Electron 을 모른다 — 자체 검사가 직접 부른다. 액션 종류를 가르는 본문(창마다 다른 isAction)은 그 창 파일에 남는다

// 받는 값의 상한 — 지금까지 창 파일마다 숫자로 적던 것
export const INPUT_LIMITS = {
  idChars: 80, // 식별자 글자 수 (개체·도구·상품)
  qty: 999, // 수량
  copyChars: 2000, // 복사할 글자
  portraitAsks: 300, // 초상 요청 한 번의 개수 — 도감 한 화면 분량
  iconKeys: 200, // 도구·알 그림 요청 한 번의 개수
  deviceHeight: { min: 200, max: 1200 }, // 기기 창 높이
  noticeChars: 500, // 기기 창 입력의 안내·결과 글자
  artChars: 400_000, // [임시] 설정창이 보내는 색칠한 알 그림(data URI) 글자 수
} as const;

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

// 비어 있지 않고 idChars 이하인 글자
export const isShortId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= INPUT_LIMITS.idChars;

// 정수 1~qty
export const isQty = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= INPUT_LIMITS.qty;

// 이전·다음
export const isStep = (v: unknown): v is -1 | 1 => v === 1 || v === -1;

// 0 이상 count 미만의 정수
export const isIndexBelow = (v: unknown, count: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < count;

// 렌더러가 잰 기기 창 높이 — 유한한 수면 올려서 min~max 로 자른다. 아니면 null
export function deviceHeightOf(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(INPUT_LIMITS.deviceHeight.min, Math.min(INPUT_LIMITS.deviceHeight.max, Math.ceil(v)));
}
