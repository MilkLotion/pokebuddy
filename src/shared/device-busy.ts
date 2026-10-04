// 기기 창 처리 중 열쇠 — 누른 단추·칸 하나를 가리킨다. 공용 자리(src/shared)라 DOM 을 쓰지 않는다
// - 설정창은 답이 0.3초 안에 오지 않으면 누른 것의 열쇠를 기기 창 입력에 싣는다(…DeviceInput.busy)
// - 기기 창은 같은 열쇠의 단추·칸만 점 세 개로 바꾼다 (docs/specs/ui-components.md "처리 중", 2026-10-04 사용자 결정 94 2-1)
import type { PartyDeviceAction, PetDeviceAction } from "./model/devices.js";

// 파티 상세 — 밥 주기·놀아주기·볼 토글·크기 칸. 대화상자·도감 보기·튜토리얼은 명령이 아니라 null
export function petBusyKey(action: PetDeviceAction): string | null {
  if (action.kind !== "cmd") return null;
  if (action.cmd === "feed" || action.cmd === "play") return action.cmd;
  if (action.cmd === "party.show" || action.cmd === "party.hide") return "ball";
  const size = action.args?.size;
  return typeof size === "number" ? `size:${size}` : null;
}

// 파티 기기 창 — 누른 칸·프리셋 칩
export const partyBusyKey = (action: PartyDeviceAction): string => `${action.kind}:${action.index}`;
