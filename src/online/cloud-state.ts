// 클라우드 저장의 상태 없는 부분 — cloud.json 의 형식, 상태·옵션·공개 API 의 모양, 부팅 판단 도우미.
// 상태기계 본문은 ./cloud.ts 다. 설계는 worklog-mac/records/cloud-authority/design-p1.md 2절·11절
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandoffReport, PendingHandoff } from "./handoff.js";

// 저장 주인 계정의 종류
export type OwnerKind = "anonymous" | "member";

// cloud.json — save.json 과 같은 폴더. save.json 에는 필드를 더하지 않는다
export interface CloudSyncState {
  deviceId: string; // 설치마다 한 번 만드는 무작위 ID
  userId: string | null; // 이 저장을 올리는 계정. 로그아웃하면 null
  owner: string | null; // 로컬 저장이 속한 계정. 로그아웃해도 유지. 서버와 맞춘 계정으로 바뀐다
  syncedRev: number; // 마지막으로 서버와 맞춘 rev
  dirty: boolean; // 마지막 올리기 뒤 저장이 바뀌었다
  lastSavedAt: number | null; // 마지막으로 올린 시각
  superseded: boolean; // 다른 PC 에 밀려났다 — 다음 실행은 rev 와 무관하게 서버 저장을 받는다
  pendingOp: string | null; // 보냈지만 결과를 모르는 올리기의 멱등 키 — 다시 보낼 때 같은 키
  ownerKind: OwnerKind | null; // owner 의 종류. owner 가 null 이면 null
  handoff: PendingHandoff | null; // 옮기지 못한 익명 저장 이관 티켓 — 정식 계정 start 때 다시 시도
  // 계정 시드(P4b, D24) — 알 결과를 정한다(src/verify/save-rules.ts seededRand). 오프라인에서도 쓰려고 적어 둔다.
  // seedOwner 가 owner 와 같을 때만 쓴다 — 계정이 바뀌면 온라인이 될 때 새로 받는다
  seed: string | null;
  seedOwner: string | null;
  // 이용 정지(P4c, D35) — 서버가 CLOUD_ACCOUNT_HELD 를 줬다. 오프라인으로 켜도 멈추게 적어 둔다. 기기 연결이 되면(정지가 풀림) 지운다
  accountHeld: boolean;
}

//   off              로그인하지 않았거나 멈췄다
//   connecting       활성 기기로 만드는 중
//   online           하트비트·자동 저장이 돈다
//   offline          서버에 닿지 못한다 — 재시도한다. 진행은 다시 연결되면 자동으로 올린다
//   confirm          연결 끊긴 다른 PC 를 넘겨받을지 사용자 확인을 기다린다(G2) — 게임 멈춤
//   blocked          교환이 걸려 넘겨받지 못한다 — 게임 멈춤
//   update-required  서버가 이 앱 버전을 받지 않는다 — 게임은 계속, 올리기만 멈춤(10절 Q6)
//   superseded       다른 PC 에 밀려났다 — 끝 상태, 앱은 안내 뒤 종료
export type CloudStatus = "off" | "connecting" | "online" | "offline" | "confirm" | "blocked" | "update-required" | "superseded" | "held";

// boot: 앱을 켤 때·로그인할 때. late: 오프라인으로 켠 뒤 처음 서버에 닿을 때(F3)
export type CloudMode = "boot" | "late";
// tick: 주기 저장(2분 스로틀). event: 교환·부화 등 사건(약 1초 모아 바로)
export type SaveKind = "tick" | "event";
export type HaltReason = "superseded" | "confirm" | "blocked" | "held";

// 넘겨받거나 확인·양보할 상대 PC
export interface OtherDevice {
  label: string | null; // 안내 문구용 PC 이름
  seen: number | null; // 상대가 마지막으로 서버에 닿은 시각(ms)
}

export interface HaltInfo {
  other: OtherDevice | null; // 밀려남 신호·양보·확인이면 상대 PC. 모르면 null
  code: string | null; // blocked 일 때 CLOUD_TRADE_ACTIVE · CLOUD_TRADE_UNSYNCED
}

export interface CloudView {
  status: CloudStatus;
  lastSavedAt: number | null;
  busy: boolean;
  // 마지막 실패 코드 또는 올리기를 막은 이유
  //   CLOUD_OWNER_OTHER  로컬 저장이 다른 계정 것이고 이 계정 서버 저장이 없다 — 올리지 않는다(10절 Q1)
  //   CLOUD_BAD_SAVE     받은 서버 저장을 읽지 못했다 — 올리지 않는다
  //   CLOUD_PET_TRADED_OUT 서버 저장을 받은 뒤에도 교환으로 내보낸 개체가 남아 거부됐다 — 올리지 않는다
  error: string | null;
  other: OtherDevice | null; // confirm·blocked·superseded 일 때 상대 PC
}

export interface CloudIo {
  loadState: () => unknown; // cloud.json 내용 — 없거나 읽지 못하면 null. 옛 형식도 받는다(normalizeCloudState)
  saveState: (state: CloudSyncState) => void;
  readSave: () => Record<string, unknown> | null; // 지금 로컬 저장(JSON 객체)
  // 받은 저장으로 로컬 저장을 바꾼다. 바꾸기 전 로컬 저장을 백업한다. 검사에 실패하면 false
  replaceSave: (save: Record<string, unknown>) => boolean;
}

export interface CloudOptions {
  client: SupabaseClient;
  io: CloudIo;
  appVersion: string;
  deviceLabel: string; // 안내 문구용 PC 이름
  onView: (view: CloudView) => void;
  onHalt: (reason: HaltReason, info: HaltInfo) => void; // 게임을 멈춰야 한다 — 앱이 안내·확인 창을 띄운다
  // 계정이 서버에서 사라졌다(CLOUD_LOGIN_REQUIRED) — 클라우드는 off. 게임은 멈추지 않는다. kind 는 돌던 계정의 종류(D29)
  onLost?: (kind: OwnerKind) => void;
  // 남은 이관 티켓을 start 가 다시 옮겼다 — 앱은 discarded 면 이 PC 진행을 백업했다고 알린다
  onHandoff?: (outcome: "moved" | "discarded" | "empty") => void;
  heartbeatMs?: number; // 하트비트 간격 (기본 60초)
  throttleMs?: number; // 주기 저장 올리기 최소 간격 (기본 2분)
  eventDelayMs?: number; // 사건 저장을 모으는 시간 (기본 1초)
  retryMs?: number; // 오프라인일 때 다시 연결을 시도하는 간격 (기본 60초)
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface Cloud {
  view: () => CloudView;
  // 세션(익명·로그인)으로 켠다. kind 는 이 계정의 종류 — 저장 주인(ownerKind)으로 적는다. 기본 member
  start: (userId: string, mode: CloudMode, kind?: OwnerKind) => Promise<void>;
  noteSaved: (kind: SaveKind) => void; // 로컬 저장을 썼다
  confirm: (go: boolean) => Promise<void>; // confirm·blocked 답 — go 면 다시 넘겨받기(confirm 은 force), 아니면 멈춤(앱 종료)
  sleep: () => Promise<void>; // 잠금·절전 직전 — 올리고 잠듦을 알린 뒤 하트비트를 멈춘다
  wake: () => Promise<void>; // 잠금 해제·깨어남 — 아직 활성인지 보고 하트비트를 다시 돌린다
  release: (timeoutMs?: number) => Promise<void>; // 정상 종료 — 올리고 released 를 알린 뒤 멈춘다(최대 timeoutMs)
  // 세션 종료(OS 끄기·로그오프·업데이트 설치) 직전 — 올리고 released 를 알리되 멈추지 않는다(최대 timeoutMs).
  // 끄기가 취소되어 앱이 계속 돌면 다음 하트비트가 active 로 되돌린다
  announceRelease: (timeoutMs?: number) => Promise<void>;
  released: () => boolean; // announceRelease 로 released 를 알린 뒤 아직 active 로 되돌리지 않았다
  unsaved: () => "none" | "dirty"; // 끄기·로그아웃 전 확인용 — 온라인이고 올리지 않은 진행이 있다
  flush: () => Promise<void>; // 온라인이고 바뀌었으면 지금 한 번 올린다
  stop: (forget?: boolean) => void; // 멈춤. forget 이면 로그아웃 — userId 만 지우고 owner 는 남긴다
  // 로컬 저장의 주인 — 부팅 판단용(세션 없음 + 주인 있음 → 분실). 없으면 null
  owner: () => { id: string; kind: OwnerKind | null } | null;
  // 마지막으로 서버와 맞춘 rev — 0 이면 지금 주인 계정으로 한 번도 올리거나 받지 않았다(D29 문구, design-p2.md 15절 G-c)
  synced: () => number;
  pendingHandoff: () => PendingHandoff | null; // 다시 시도할 이관 티켓
  seed: () => string | null; // 지금 저장 주인의 계정 시드(P4b). 아직 받지 못했거나 주인이 바뀌었으면 null
  held: () => boolean; // 이용 정지를 적어 두었다(P4c) — 서버에 닿기 전 부팅 판단용
  // 멈춘 상태에서 저장 주인을 from → to 로 바꾼다. to 의 첫 저장으로 다시 맞춘다(syncedRev 0). 주인이 from 이 아니거나 돌고 있으면 false
  rebind: (from: string, to: string, kind?: OwnerKind) => boolean;
  // 세션 교체 뒤 이관 결과를 적는다 — 정식 계정 start 전에 부른다
  //   adopted empty      rebind(anon, to) — 이 PC 저장을 그 계정 첫 저장으로(그 계정에 저장이 있으면 받는다)
  //   adopted moved·discarded  주인은 익명 그대로 — start 의 맞추기가 서버 저장을 받는다(로컬 백업)
  //   pending            티켓을 cloud.json 에 남긴다(CLOUD_HANDOFF_INVALID 는 버린다)
  applyHandoff: (report: HandoffReport, to: string) => void;
  // 로그아웃·삭제 뒤 — 멈추고 cloud.json 을 새 설치처럼(기기 ID 만 유지)
  reset: () => void;
}

const handoffOf = (v: unknown): PendingHandoff | null => {
  if (!v || typeof v !== "object") return null;
  const h = v as Record<string, unknown>;
  return typeof h.ticket === "string" && typeof h.anon === "string" && typeof h.expiresAt === "number"
    ? { ticket: h.ticket, anon: h.anon, expiresAt: h.expiresAt }
    : null;
};

// cloud.json 읽기 — 옛 형식(owner·superseded·pendingOp 없음, offlineDirty 있음)도 받는다
//   옛 파일의 owner 는 올리던 계정(userId)으로 본다. 로그아웃 상태였으면 null(10절 Q1 의 작은 구멍 허용)
//   ownerKind·handoff 가 없는 P1 파일 — P1 클라우드는 정식 계정만 돌았다. owner 가 있으면 member
export function normalizeCloudState(raw: unknown): CloudSyncState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.deviceId !== "string" || typeof s.syncedRev !== "number" || typeof s.dirty !== "boolean") return null;
  const userId = typeof s.userId === "string" ? s.userId : null;
  const owner = "owner" in s ? (typeof s.owner === "string" ? s.owner : null) : userId;
  return {
    deviceId: s.deviceId,
    userId,
    owner,
    syncedRev: s.syncedRev,
    dirty: s.dirty,
    lastSavedAt: typeof s.lastSavedAt === "number" ? s.lastSavedAt : null,
    superseded: s.superseded === true,
    pendingOp: typeof s.pendingOp === "string" ? s.pendingOp : null,
    ownerKind: owner == null ? null : s.ownerKind === "anonymous" || s.ownerKind === "member" ? s.ownerKind : "member",
    handoff: handoffOf(s.handoff),
    seed: typeof s.seed === "string" ? s.seed : null,
    seedOwner: typeof s.seedOwner === "string" ? s.seedOwner : null,
    accountHeld: s.accountHeld === true,
  };
}

export const freshCloudState = (deviceId: string): CloudSyncState => ({
  deviceId, userId: null, owner: null, syncedRev: 0, dirty: false, lastSavedAt: null, superseded: false, pendingOp: null, ownerKind: null, handoff: null,
  seed: null, seedOwner: null, accountHeld: false,
});

// 부팅 판단 — 익명 세션이 저장 주인과 다른 계정이면 그 세션으로는 올릴 수 없다(검수 H1)
//   분실 부팅 때 다른 경로(P1 로그아웃 뒤 교환 탭 등)가 새 익명 계정을 만든 경우다. 남은 이관 티켓이 없으면 분실로 본다.
//   분실로 볼 때 잃은 계정의 종류를 돌려준다. 아니면 null
export function strayAnonymous(
  user: { id: string; is_anonymous?: boolean | null },
  owner: { id: string; kind: OwnerKind | null } | null,
  pending: PendingHandoff | null,
): OwnerKind | null {
  if (user.is_anonymous !== true || !owner || owner.id === user.id || pending) return null;
  return owner.kind ?? "member";
}

// 올릴 개체가 있는가 — 스타터를 고르기 전(개체 0)은 올리지 않는다
export const hasPets = (save: Record<string, unknown>): boolean => Array.isArray(save.pets) && save.pets.length > 0;

export interface ClaimRow {
  outcome: "claimed" | "yield" | "confirm";
  rev: number | string | null;
  updated_at: string | null;
  has_save: boolean | null;
  other_label: string | null;
  other_seen: string | null;
}
export interface TouchRow {
  active: boolean;
  rev: number | string | null;
}
