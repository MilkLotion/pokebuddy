// 시간으로만 바뀌는 화면 모델의 필드 — 이것만 다르면 다시 그리지 않고 표시만 고친다(설정창·파티 상세 기기 창)
// 다시 그리면 키보드 포커스·title 툴팁·글자 선택이 사라진다 (2026-09-29 검수 C2). 화면 모델의 필드 이름이라 계약 쪽에 한 벌을 둔다
// 값 모듈이다. 다른 파일을 가져다 쓰지 않는다
export const LIVE_KEYS = ["feedInSec", "affinity", "mood", "moodWord", "remainSec", "percent", "remainMin", "text", "noteText", "feedText", "playText"] as const; // playText — 놀아주기 단추도 남은 시간을 보인다 (94 항목 5-1)
