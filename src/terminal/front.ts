// 동반자(companion)가 어느 창을 따르고 어느 세션의 상태를 볼지 — 순수 함수. 창·파일·Electron 을 모른다.
//
// 동반자는 기기당 하나라 매 폴링 "지금 맨 앞 창" 을 다시 고르고, 그 창의 주인이 터미널 호스트인지를 가른다.
//   (a) 훅 기록 중 조상에 그 창 주인 pid 가 든 것이 있으면 → 훅이 달린 CLI 를 띄운 적 있는 터미널 앱이다. 그 창 주인을 따른다
//   (b) 알려진 터미널 앱 이름이면 → 아직 CLI 를 띄운 적 없다. 붙기만 하고 상태는 대기
//   (c) 아니면 터미널 호스트가 아니다 → 부르는 쪽이 앵커를 유지한다 (브라우저를 봐도 펫은 마지막 자리에 남는다)
// 앱 이름표(b)는 대비책일 뿐 — (a) 는 이름을 몰라도 맞는다.
// 같은 앱의 창이 여럿이면 창을 가리지 않고 그 앱이 띄운 최신 세션을 따른다 (2026-09-27 창 기록·VS Code 확장 삭제)
import type { HelperInfo, HelperWindow, HostInfo, SelfMark } from "./types";
import type { HookStateRead } from "../shared/hook-record";

// 터미널 앱 이름 — 헬퍼가 주는 app 필드 (mac 은 앱 이름, Windows 는 실행 파일 이름). 대소문자를 가리지 않는다
export const KNOWN_TERMINAL_APPS: ReadonlySet<string> = new Set(
  [
    "Code", "Code - Insiders", "Cursor", "Windsurf", "Antigravity", "VSCodium",
    "iTerm2", "Terminal", "Ghostty", "WezTerm", "Warp", "Alacritty", "kitty", "Hyper", "Tabby",
    "WindowsTerminal", "cmux",
  ].map((name) => name.toLowerCase()),
);
export const isKnownTerminal = (app: unknown): boolean => KNOWN_TERMINAL_APPS.has(String(app || "").toLowerCase());

// 펫 자신(과 이름이 같은 다른 Electron 창)인가 — 개발 실행은 Electron 이라 이름으로 함께 거른다.
// self = { pid, appNames: Set<소문자 이름> }
const isSelf = (w: HelperWindow, self: SelfMark | null | undefined): boolean =>
  !!self && (w.pid === self.pid || (self.appNames && self.appNames.has(String(w.app || "").toLowerCase())));

// 맨 앞 창. 헬퍼의 frontPid(맨 앞 앱 pid)로 고른다 — 앱 이름은 펫끼리 겹친다.
// Windows 는 frontId(포그라운드 HWND)가 목록에 있으면 그 창, 없으면(대화상자·작은 창) 같은 pid 의 첫 창.
// frontPid 를 주지 않는 옛 헬퍼는 frontmost 이름으로 대체한다.
// 반환: 창 하나. 펫 자신이거나 그 앱의 창이 목록에 없으면(다른 Space — 실측 32.5%) null
export function frontWindow(
  info: HelperInfo | null | undefined,
  windows: HelperWindow[] | null | undefined,
  self?: SelfMark | null,
): HelperWindow | null {
  if (!info || !Array.isArray(windows)) return null;
  const frontPid = Number(info.frontPid) || 0;
  let front: HelperWindow | null = null;
  if (frontPid) {
    if (self && frontPid === self.pid) return null;
    const byId = info.frontId != null ? windows.find((w) => w.id === info.frontId && w.pid === frontPid) : null;
    front = byId || windows.find((w) => w.pid === frontPid) || null;
  } else if (info.frontmost) {
    front = windows.find((w) => w.app === info.frontmost) || null;
  }
  return front && !isSelf(front, self) ? front : null;
}

// 맨 앞 창의 주인이 터미널 호스트인가 — 위 (a)~(c).
//   front          frontWindow 의 결과
//   stateRecords   훅이 적은 세션 기록 (src/agents/hook-records.ts readHookRecords)
// 반환: { kind: "hook" | "known", pids } — pids 는 따를 세션의 pid (비면 대기). 호스트가 아니면 null
export function hostOf(front: HelperWindow | null | undefined, stateRecords: HookStateRead[] | null | undefined): HostInfo | null {
  if (!front) return null;
  const hooked = (stateRecords || []).some((r) => Array.isArray(r.ancestors) && r.ancestors.includes(front.pid));
  if (hooked) return { kind: "hook", pids: [front.pid] };
  if (isKnownTerminal(front.app)) return { kind: "known", pids: [] };
  return null;
}
