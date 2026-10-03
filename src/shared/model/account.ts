// 화면 모델 — 계정·클라우드 저장·업데이트·패치노트. 타입만 둔다
import type { AccountReplyCode } from "../names/online-codes.js";

// ── 앱 버전과 업데이트 ──────────────────────────────────────────────────────────────
// 설정 모달 바닥 왼쪽이 그린다 (src/main/update/updater.ts). off 는 개발 실행·npm 설치본 — 버전만 보인다
export interface UpdateView {
  version: string; // 지금 버전
  status: "off" | "idle" | "checking" | "latest" | "downloading" | "ready" | "manual" | "error"; // manual — mac 에서 앱을 그 자리에서 바꿀 수 없어 새 버전만 알린다
  next: string | null; // 받는 중이거나 준비된 새 버전
  percent: number | null; // 받은 정도 0~100
  error: string | null;
}

// 설정 바닥의 업데이트 요청 — status 는 읽기만, check 는 `다시 확인`, install 은 `다시 시작`(manual 이면 `받기`)
export type UpdateAction = "status" | "check" | "install";

// 패치노트 — data/patch-notes.json 의 한 버전 (src/main/patch-notes.ts). Figma `99 · 시안` `800:18345`·`800:18549`
export interface PatchNote {
  version: string;
  date: string; // YYYY-MM-DD
  lines: string[];
}

export interface PatchNotesView {
  notes: PatchNote[]; // 새 버전이 맨 앞
  unseen: string | null; // 업데이트 뒤 아직 띄우지 않은 버전 — 관리 창을 열면 한 번 띄운다
}

// ── 계정과 클라우드 저장 ──────────────────────────────────────────────────────────────
// 설정의 계정 탭·헤더 저장 표시가 그리는 값 (src/main/online.ts). Figma 05 Screens `633:19206`~`633:20029`
// manage:account 는 렌더러 → 메인 요청(결과에 screen), manage:account-view 는 메인 → 렌더러 밀어 보내기다
// 클라우드 상태 — src/online/cloud.ts CloudStatus 와 같다 (worklog-mac/records/cloud-authority/design-p1.md 2절)
//   confirm·blocked·superseded 는 게임이 멈춘 상태다. 안내·확인 창은 메인 창이 띄운다
export type CloudStatusView = "off" | "connecting" | "online" | "offline" | "confirm" | "blocked" | "update-required" | "superseded" | "held";

// 클라우드 오류 코드 — cloud.error·AccountReply.code 에 온다
//   CLOUD_UPDATE_REQUIRED  서버가 이 앱 버전을 받지 않는다 — 게임은 계속, 저장은 올리지 않는다
//   CLOUD_TRADE_ACTIVE     다른 PC 가 교환 중이라 넘겨받지 못한다
//   CLOUD_TRADE_UNSYNCED   다른 PC 에서 끝낸 교환이 계정 저장에 아직 반영되지 않았다(7일 이내)
//   CLOUD_OWNER_OTHER      이 PC 저장이 다른 계정 것이고 이 계정 저장이 없다 — 올리지 않는다
//   CLOUD_BAD_SAVE         계정 저장을 읽지 못했다 — 올리지 않는다
//   CLOUD_PET_TRADED_OUT   계정 저장을 받은 뒤에도 교환으로 내보낸 개체가 남아 거부됐다 — 올리지 않는다
//   AUTH_RATE_LIMITED      익명 계정을 만들지 못했다(가입 제한) — 게임은 로컬로 계속, 60초 뒤 다시
//   SAVE_BACKUP_FAILED     로그아웃·삭제 뒤 이 PC 저장을 백업하지 못해 새로 시작하지 않았다(AccountReply.code)
export type CloudErrorCode =
  | "NETWORK"
  | "CLOUD_LOGIN_REQUIRED"
  | "CLOUD_UPDATE_REQUIRED"
  | "CLOUD_TRADE_ACTIVE"
  | "CLOUD_TRADE_UNSYNCED"
  | "CLOUD_OWNER_OTHER"
  | "CLOUD_BAD_SAVE"
  | "CLOUD_TOO_LARGE"
  | "CLOUD_PET_TRADED_OUT"
  | "AUTH_RATE_LIMITED";

// 넘겨받거나 확인·양보할 상대 PC
export interface CloudOtherView {
  label: string | null; // "Mac" · "Windows PC"
  seen: number | null; // 상대가 마지막으로 서버에 닿은 시각(ms)
}

export interface AccountScreen {
  available: boolean; // 서버 설정이 있고 이 앱이 저장을 쓴다
  signedIn: boolean;
  // 아래 두 값은 메인(src/main/online.ts)이 늘 채운다. 렌더러의 기본값(서버 설정 없음)이 빼도 되게 선택으로 둔다
  anonymous?: boolean; // 익명 계정으로 저장 중이다 — signedIn 은 거짓 (design-p2.md 5절)
  // 저장 계정을 잃었다(D29) — 클라우드 저장은 꺼져 있고 게임은 계속. 분실 창은 메인이 띄운다.
  //   member 는 다시 로그인하면 풀린다. anonymous 는 되찾을 수 없다. null 이면 분실 아님
  lost?: "member" | "anonymous" | null;
  method: "password" | "github" | null;
  username: string | null;
  displayName: string | null;
  blocked: boolean; // 걸린 교환이 있어 로그인·로그아웃·삭제를 할 수 없다
  // 서버에 올리지 못한 진행이 있을 수 있다 — 올리지 않은 진행, 온라인 아님, 올리기 막힘. 로그아웃·삭제 확인 창의 경고 줄. 없으면 거짓
  unsynced?: boolean;
  cloud: {
    status: CloudStatusView;
    lastSavedAt: number | null;
    busy: boolean;
    error: string | null; // CloudErrorCode 또는 그 밖의 실패 코드
    other: CloudOtherView | null; // confirm·blocked·superseded 일 때 상대 PC
  };
}

export type AccountAction =
  | { action: "status" }
  | { action: "check-username"; username: string }
  | { action: "sign-up"; username: string; displayName: string; password: string }
  | { action: "sign-in"; username: string; password: string }
  | { action: "github" }
  | { action: "github-cancel" } // 브라우저 로그인을 기다리다 취소
  | { action: "sign-out" } // 올리고 released 를 알린 뒤 로그아웃한다. 성공하면 저장을 백업하고 앱을 다시 켠다(D12)
  | { action: "rename"; displayName: string }
  | { action: "delete" }; // 성공하면 저장을 백업하고 앱을 다시 켠다(D12)

// 아이디 중복 확인의 결과 — NETWORK 는 서버에 닿지 못함, UNKNOWN 은 서버가 다른 실패를 돌려줌(입력 중에는 둘 다 글을 보이지 않는다)
export type UsernameCheck = "available" | "taken" | "invalid" | "NETWORK" | "UNKNOWN";

export interface AccountReply {
  ok: boolean;
  code: AccountReplyCode | null; // 실패 코드 — AUTH_* · SAVE_BACKUP_FAILED · NETWORK
  check?: UsernameCheck; // check-username 의 결과
  screen: AccountScreen;
}
