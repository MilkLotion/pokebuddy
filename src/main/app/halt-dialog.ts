// 두 PC 규칙의 멈춤 창 — 밀려남 안내·넘겨받기 확인·넘겨받기 막힘 (worklog-mac/records/cloud-authority/design-p1.md 3·5절)
// 저장 계정 분실 창(D29) — 게임은 멈추지 않는다 (worklog-mac/records/cloud-authority/design-p2.md 5절·15절 G-a·G-c)
// 저장 잠김 창 — 저장 키를 쓰지 못해 암호화 저장을 열 수 없다 (worklog/records/cloud-authority/record.md "P3 로컬 암호화")
// 이용 정지 창 — 서버가 계정을 정지했다 (같은 기록 "P4c")
// 업데이트 필요 창 — 서버가 이 앱 버전을 거절했고 새 버전이 준비됐다 (worklog/records/app-update/record.md)
// 앱이 게임을 멈춘 뒤 띄운다. 창의 답을 받아 무엇을 할지는 앱(src/main/app.ts)이 정한다.
//
// 이 파일은 창마다 띄우는 때의 규칙(저절로 닫힘·밖에서 닫기)과 고른 단추를 답으로 읽는 규칙만 둔다.
// 글자는 화면 값(src/view/halt.ts), 창 띄우기는 src/main/windows/alert-ask.ts 가 맡는다
import type { HaltInfo, OwnerKind } from "../../online/cloud-state.js";
import { blockedAlert, confirmAlert, heldAlert, kickedAlert, lostAlert, saveLockedAlert, updateRequiredAlert, type AlertSpec } from "../../view/halt";
import { askChoice } from "../windows/alert-ask";

// 밀려남 안내가 저절로 닫히는 시간 — 자리에 없는 PC 도 종료까지 간다
const KICKED_CLOSE_MS = 30_000;

// 창의 답 — go 는 넘겨받기·다시 시도, stop 은 취소·종료, closed 는 밖에서 닫았다(시간 초과·밀려남)
export type HaltAnswer = "go" | "stop" | "closed";

// 진행·멈춤 창의 답 — 단추가 둘이면 0 번이 진행이다
async function askGoStop(spec: AlertSpec, more: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<HaltAnswer> {
  const r = await askChoice({ ...spec, ...more });
  if (r === "closed") return "closed";
  return spec.buttons.length > 1 && r === 0 ? "go" : "stop";
}

// 밀려남 안내 — 단추 하나. KICKED_CLOSE_MS 뒤 저절로 닫힌다. 답과 무관하게 앱은 종료한다
export function askKicked(info: HaltInfo): Promise<HaltAnswer> {
  return askGoStop(kickedAlert(info), { timeoutMs: KICKED_CLOSE_MS });
}

// 이용 정지 안내(P4c, D35) — 단추 하나. 답과 무관하게 앱은 종료한다. 저절로 닫히지 않는다 — 사용자가 읽고 닫는다
export function askHeld(): Promise<HaltAnswer> {
  return askGoStop(heldAlert());
}

// 업데이트 필요 창 — 서버가 이 앱 버전을 거절했고 새 버전이 준비됐다(worklog/records/app-update/record.md "업데이트 필요 때 바로 받기")
//   Esc 는 나중에 — 게임은 멈추지 않고, 설정의 다시 시작·끌 때 적용이 남는다. 알림 창은 단추에 처음 포커스를 두지 않는다
export async function askUpdateRequired(version: string, manual: boolean): Promise<boolean> {
  return (await askChoice(updateRequiredAlert(version, manual))) === 1;
}

// 연결 끊긴 다른 PC 를 넘겨받을지 묻는다(G2) — go 면 여기서 시작, stop 이면 종료(D22)
export function askConfirm(info: HaltInfo, signal?: AbortSignal): Promise<HaltAnswer> {
  return askGoStop(confirmAlert(info, Date.now()), signal ? { signal } : {});
}

// 교환이 걸려 넘겨받지 못했다 — go 면 다시 시도, stop 이면 종료
export function askBlocked(info: HaltInfo, signal?: AbortSignal): Promise<HaltAnswer> {
  return askGoStop(blockedAlert(info), signal ? { signal } : {});
}

// 저장 잠김 창의 답 — quit 종료(저장은 그대로), fresh 저장을 백업하고 새로 시작
export type SaveLockedAnswer = "quit" | "fresh";

// 저장 키를 쓰지 못했다(키체인 거부·키 파일 잠김·키 저장소 없음)인데 암호화된 저장이 있다 — 켤 때 게임을 만들기 전에 묻는다.
// 저장을 옮기지 않고 먼저 묻는다(검수 P3-3, 2026-09-30 사용자 결정 "안내 창으로 묻기"). Esc 는 종료 — 새로 시작은 Esc 로 고르지 않는다
export async function askSaveLocked(): Promise<SaveLockedAnswer> {
  return (await askChoice(saveLockedAlert())) === 1 ? "fresh" : "quit";
}

// 분실 창의 답 — login 은 관리 창 계정 탭, local 은 이 PC 저장으로 계속, fresh 는 처음부터, closed 는 밖에서 닫았다
export type LostAnswer = "login" | "local" | "fresh" | "closed";

// 저장 계정을 잃었다(D29) — 게임은 계속, 클라우드 저장만 꺼져 있다
//   member     Esc 는 로그인(관리 창만 연다 — 되돌릴 수 있다)
//   anonymous  Esc 는 이 PC 저장으로 계속 — 처음부터는 Esc 로 고르지 않는다
export async function askLost(kind: OwnerKind, synced: boolean, signal?: AbortSignal): Promise<LostAnswer> {
  const r = await askChoice({ ...lostAlert(kind, synced), ...(signal ? { signal } : {}) });
  if (r === "closed") return "closed";
  if (kind === "member") return r === 1 ? "local" : "login";
  return r === 1 ? "fresh" : "local";
}
