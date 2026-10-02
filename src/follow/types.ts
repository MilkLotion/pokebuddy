// 창 추적·에이전트 판정 모듈의 타입 — 헬퍼 출력 · 훅 기록의 모양
import type { AgentState } from "../shared/names/agents";
import type { HookStateRead } from "../shared/hook-record";

// 헬퍼(winbounds)가 주는 창 하나 — 좌표는 헬퍼가 준 그대로다(mac 은 포인트, Windows 는 물리 픽셀). 좌표를 읽는 곳은 mac 의 offScreen 판정뿐이다
export interface HelperWindow {
  app: string;
  pid: number;
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface HelperInfo {
  frontmost?: string;
  frontPid?: number;
  frontId?: number;
  windows: HelperWindow[];
  input?: HelperInput; // Windows -Serve 헬퍼만 — 트레이 메뉴의 바깥 클릭·Esc (helpers/winbounds.ps1)
}

// 헬퍼가 센 입력 — 마우스 버튼을 누른 횟수와 마지막 누른 자리(물리 픽셀), Esc 를 누른 횟수
export interface HelperInput {
  click: number;
  x: number;
  y: number;
  esc: number;
}

// 훅이 세션마다 적는 기록 (state/*.json) — 형식의 원본은 src/shared/hook-record.ts. 읽는 쪽이라 모든 필드를 의심한다
// [임시] 옛 이름 — 이 폴더를 옮길 때 HookStateRead 로 바꾼다
export type StateRecord = HookStateRead;

// 펫 자신을 가리는 표식 — 맨 앞 창 판정에서 자기 창·다른 펫 창을 뺀다
export interface SelfMark {
  pid: number;
  appNames: Set<string>;
}

export type HostKind = "hook" | "known";
export interface HostInfo {
  kind: HostKind;
  pids: number[];
}

export interface StateInfo {
  state: AgentState;
  promptAt: number | null;
  tokenWork?: boolean;
}

// 헬퍼 실행 명령 — Electron 을 모른다. serve 는 줄 단위로 계속 답하는 방식(Windows ps1 -Serve)
export interface HelperCommand {
  cmd: string;
  args: string[];
  serve?: boolean;
}
export interface LineHelper {
  query(cb: (err: Error | null, line?: string) => void): void;
  stop(): void;
}

// createLineHelper 옵션 — timeoutMs 는 답 한 줄, startTimeoutMs 는 막 띄운 헬퍼의 첫 답
export interface LineHelperOptions {
  timeoutMs?: number;
  startTimeoutMs?: number;
}

// queryHelper 콜백 — 헬퍼 표준 출력 한 덩이(JSON 한 줄). 실패면 err
export type HelperReply = (err: Error | null, stdout?: string) => void;
