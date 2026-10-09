// 거절 까닭의 원본 — 명령 결과(CommandResult.reason)에 실리는 로컬 판정의 까닭이다. kebab-case 로 적는다.
// 도메인은 자기 거절 까닭을 `ReasonOf<…>` 로 선언한다. 목록에 없는 글자는 컴파일 오류다.
// 서버 호출 길에서 생기는 코드(대문자)는 ./online-codes.ts 에 있다. 화면에 닿는 실패 값은 둘의 합(FailCode)이다.
// 설계는 worklog/records/code-structure/design/40-contracts-save-online.md 3.1절
//
// 값 모듈이다. 다른 파일을 가져다 쓰지 않는다

export const REASONS = [
  // 공통 — 명령 통로·실행기·메인
  "ok",
  "error", // 처리기가 던졌다
  "bad-args",
  "bad-count",
  "bad-value",
  "bad-cmd", // 명령 통로 — 파일 이름에 넣을 수 없는 명령 이름
  "bad-result", // 명령 통로 — 회신 파일의 모양이 틀렸다
  "send-failed", // 명령 통로 — 요청 파일을 쓰지 못했다
  "timeout",
  "unknown-cmd", // 모르는 명령·모르는 거래·내부 거래
  "no-result",
  "no-save",
  "save-failed",
  "not-writer",
  "halted", // 다른 PC 확인이 끝날 때까지 게임이 멈춰 있다
  "cancelled", // 사용자가 창을 닫았다 (영역 그리기·화면 고르기)
  "denied", // 설정창 — 보낸 창이 설정창이 아니다
  "bad-request", // 설정창 — 요청의 모양이 틀렸다
  "not-yet", // 아직 받지 않는 인자다
  "expired", // 그림을 기다리는 사이 보낸 쪽이 포기했다
  // 개체·파티·프리셋
  "no-pet",
  "already",
  "already-shiny", // 이로치에 이로치 약 — already 와 가른다 (94 항목 9-3-3)
  "already-normal", // 일반 색에 돌아오는 약 — already 와 가른다 (94 항목 9-3-3)
  "not-pokemon",
  "not-in-box",
  "not-in-party",
  "not-in-preset", // 적용하지 않은 다른 프리셋에 없다 (party.pull)
  "slot-not-empty",
  "slot-locked",
  "no-empty-slot",
  "no-preset",
  "already-active",
  "preset-max",
  "slots-not-full",
  // 박스
  "no-box",
  "bad-slot",
  "empty-slot",
  "box-full",
  "same-slot",
  // 돌봄·가방
  "cooldown",
  "full",
  "no-item",
  "none-left",
  "max-level",
  "bad-nature",
  // 알
  "no-egg",
  "not-ready",
  "no-candidate",
  // 상점·판매
  "no-product",
  "not-enough-points",
  "daycare-full",
  "bag-full",
  "no-locked-slot",
  "box-max",
  "not-unlocked",
  "sold-out",
  "not-sellable",
  "not-enough-items",
  "pet-not-sellable",
  "trade-locked",
  "last-pet",
  "in-preset",
  "in-battle", // 배틀 파티에 든 개체 (src/battle/party.ts)
  // 진화·모습·메가
  "no-step",
  "need-choice",
  "bad-choice",
  "no-map",
  "not-shared",
  "bad-form",
  "form-locked", // 모습 바꾸기 해금 전(로토무 — 에이전트 작업 시간)
  "no-rider", // 그 모습이 되려면 있어야 하는 말이 없다(버드렉스(백마 탄 모습) — 블리자포스)
  "no-partner", // 그 모습이 되려면 있어야 하는 짝이 없다(블랙큐레무 — 제크로무)
  "not-rider-owner", // 말을 부를 버드렉스 계열 개체가 저장에 없다(유대의고삐)
  "no-stone",
  "art-missing", // 바뀔 모습의 그림을 받지 못했다
  // 업적·튜토리얼
  "no-achievement",
  "not-achieved",
  "already-claimed",
  "egg-none",
  "bad-id",
  // 교환 — 로컬 판정
  "busy",
  "trade-not-ready", // 두 사람 모두 포켓몬을 올리기 전에 확정했다 — 알의 not-ready 와 가른다 (94 항목 4-7)
  "no-channel",
  "in-trade",
  "stopped",
  "cloud-wait",
  "login-required",
  "save-wait",
  "single",
  "locked",
  "bad-received",
  "trade-off", // 교환을 쓸 수 없다 (서버 설정 없음·멈춤)
  // 우편 — 로컬 판정
  "bad-gift",
] as const;

export type Reason = (typeof REASONS)[number];

// 도메인이 자기 거절 까닭을 선언할 때 쓴다 — `export type BuyFailure = ReasonOf<"no-product" | "sold-out">`
export type ReasonOf<T extends Reason> = T;

// 할 수 있는가의 답 — 되면 ok 와 덧붙인 값, 안 되면 까닭 하나. 도메인의 check… 함수가 돌려준다
export type Check<R extends Reason = Reason, T = unknown> = ({ ok: true } & T) | { ok: false; reason: R };
