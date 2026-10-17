// 렌더러가 보낸 값의 검사 — 창이 받는 값은 믿지 않는다. 정해진 모양만 넘긴다 (worklog/records/code-structure/design/10-main.md 3.3절)
// Electron 을 모른다 — 자체 검사가 직접 부른다. 액션 종류를 가르는 본문(창마다 다른 isAction)은 그 창 파일에 남는다

import { ART_ASK_LIMITS } from "../../shared/art-limits.js";
import type { DeviceKind, DeviceKindTab } from "../../shared/model/devices";

// 받는 값의 상한 — 지금까지 창 파일마다 숫자로 적던 것
export const INPUT_LIMITS = {
  idChars: 80, // 식별자 글자 수 (개체·도구·상품)
  qty: 999, // 수량
  copyChars: 2000, // 복사할 글자
  portraitAsks: ART_ASK_LIMITS.portraits, // 초상 요청 한 번의 개수 — 설정창이 이 크기로 나눠 보낸다
  iconKeys: ART_ASK_LIMITS.icons, // 도구·알 그림 요청 한 번의 개수
  deviceHeight: { min: 200, max: 1200 }, // 기기 창 높이
  noticeChars: 500, // 기기 창 입력의 안내·결과 글자
} as const;

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

// 비어 있지 않고 idChars 이하인 글자
export const isShortId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= INPUT_LIMITS.idChars;

// 정수 1~qty
export const isQty = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= INPUT_LIMITS.qty;

// 이전·다음
export const isStep = (v: unknown): v is -1 | 1 => v === 1 || v === -1;

// 기기 종류 탭 — 다섯 기기 중 하나 (src/shared/model/devices.ts DeviceKind)
const DEVICE_KINDS: readonly DeviceKind[] = ["pet", "dex", "battle", "shop", "bag"];
export const isDeviceKind = (v: unknown): v is DeviceKind => typeof v === "string" && (DEVICE_KINDS as readonly string[]).includes(v);
// 머리의 종류 탭 목록 — 셋까지, 칸마다 종류·지금·흐림
export const isDeviceKindTabs = (v: unknown): v is DeviceKindTab[] =>
  Array.isArray(v) && v.length <= 3 && v.every((t) => isRecord(t) && isDeviceKind(t.id) && typeof t.current === "boolean" && typeof t.disabled === "boolean");

// 0 이상 count 미만의 정수
export const isIndexBelow = (v: unknown, count: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < count;

// 렌더러가 잰 기기 창 높이 — 유한한 수면 올려서 min~max 로 자른다. 아니면 null
export function deviceHeightOf(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(INPUT_LIMITS.deviceHeight.min, Math.min(INPUT_LIMITS.deviceHeight.max, Math.ceil(v)));
}
