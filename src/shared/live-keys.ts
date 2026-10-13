// 시간으로만 바뀌는 화면 모델의 필드 — 이것만 다르면 다시 그리지 않고 표시만 고친다(설정창·파티 상세 기기 창)
// 다시 그리면 키보드 포커스·title 툴팁·글자 선택이 사라진다 (2026-09-29 검수 C2). 화면 모델의 필드 이름이라 계약 쪽에 한 벌을 둔다
// 값 모듈이다. 다른 파일을 가져다 쓰지 않는다
export const LIVE_KEYS = ["feedInSec", "playInSec", "affinity", "boredom", "boredWord", "remainSec", "percent", "remainMin", "text", "noteText", "feedText", "playText"] as const; // playText — 놀아주기 단추도 남은 시간을 보인다 (94 항목 5-1)

// 설정창 스냅샷에서 시간으로만 바뀌는 값의 경로 — 이름이 아니라 자리로 고른다(같은 이름이 다른 자리에서는 모양일 수 있다).
// 헤더의 포인트와 낮·밤 게이지다. 이것만 다르면 헤더 글자만 고친다 (실행 규칙 R1, worklog/records/perf-refactor 1-1).
// 시간만 흘러도 모양이 바뀌는 경로는 자체 검사 selftest-live-shape 가 찾는다 — 새 시간 값을 스냅샷에 넣으면 여기에 더한다
// seq 는 스냅샷의 순번이라 늘 다르다 — 모양이 아니다
export const SNAPSHOT_LIVE_PATHS = ["points", "day.progress", "day.leftMs", "seq"] as const;
