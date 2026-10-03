// 명령과 그 결과의 모양 — 우클릭·트레이·설정창·CLI·확장이 같은 모양으로 보내고, 처리기 하나가 모듈에 분배한다

import type { CommandName, CommandSource } from "./names/commands.js";
import type { FailCode } from "./names/online-codes.js";
import type { Reason } from "./names/reasons.js";

// ── 커맨드 ─────────────────────────────────────────────────────────────────────
// 우클릭·트레이·설정창·CLI·확장이 같은 모양으로 보내고, 처리기 하나가 모듈에 분배한다 (design.md "커맨드 처리기")
// 명령 이름과 보낸 곳의 원본은 ./names/commands.ts 다
export interface Command {
  cmd: CommandName;
  target?: string; // 마리 id · CLI 이름 · 설정 키
  args?: Record<string, unknown>;
  from: CommandSource;
  at?: number;
}

// 결과는 문구가 아니라 코드 — 문구는 표면이 언어 파일로 만든다
export interface CommandResult {
  ok: boolean;
  reason: FailCode; // "ok" · "cooldown" · "no-pet" · "unknown-cmd" · "not-writer" · "timeout" … 목록은 ./names/reasons.ts 와 ./names/online-codes.ts
  [key: string]: unknown;
}

// ── 거래 실행기의 요청과 결과 ──────────────────────────────────────────────────
// 실행기(src/tx/executor.ts)와 실행기에 거래를 내는 쪽(교환 세션·우편함)이 같이 본다
export interface TxRequest {
  id: string; // 요청 식별자. 같은 값으로 다시 보내도 한 번만 반영한다
  name: string;
  args?: unknown;
}

export type TxResult =
  | { ok: true; result: unknown; replayed: boolean; achieved?: string[] }
  | { ok: false; reason: TxFailure };

// 실패 이유 — 저장 실패와 규칙 실패를 구분한다. 화면이 다른 문구를 쓴다. 목록은 src/shared/names/reasons.ts
export type TxFailure = Reason;

// 도메인 결과의 성공·실패 — 실패에는 까닭이 늘 있다. 성공 쪽의 reason?: undefined 는 가르지 않고 res.reason 을 읽는 줄을 그대로 두려는 것이다
export type Outcome<R extends string> = { ok: true; reason?: undefined } | { ok: false; reason: R };
