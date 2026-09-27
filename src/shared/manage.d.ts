// 관리 창 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다 (런타임 값 없음)
// 선언 파일인 이유와 다른 파일을 import 하지 않는 이유는 shared/stage.d.ts 와 같다.
// 화면이 읽는 값은 src/tx/snapshot.ts 가 만든다. 그 파일이 여기 타입을 가져다 쓴다 — 모양의 출처는 한 곳이다.
// FullnessZone 은 src/state/time.ts 의 같은 이름과 같은 값이다. 자체 검사가 서로 대입해 어긋남을 잡는다

export type ViewZone = "full" | "normal" | "hungry" | "starving";
export type ViewSlotState = "pokemon" | "empty" | "locked";
export type ViewUnlockBy = "shop" | "achievement";

export interface ViewBuff {
  kind: string;
  remainMin: number;
}

// 진화 후보 하나 — 화면이 그대로 보인다. 낮·밤은 스냅샷을 만든 시각으로 정했다
export interface EvolutionView {
  to: string; // 결과 종 슬러그 — evolve 명령의 args.to 로 보낸다
  name: string; // 결과 종의 화면 이름
  ready: boolean;
  need?: string; // 모자란 조건의 화면 문구 — "Lv.16 필요", "물의돌 필요", "밤에만"
  item?: string; // 진화용 도구가 조건이면 그 도구 id. 가방의 돌로 대상을 고를 때 쓴다
}

export interface PetView {
  id: string;
  species: string;
  name: string; // 화면에 보이는 종 이름
  shiny: boolean;
  level: number;
  percentToNext: number; // 다음 레벨까지 백분율
  exp: number; // 누적 경험치 — 가방 사용 패널이 사탕 미리보기와 최대 개수를 셈한다
  growth: string; // 경험치 타입 (src/dex/growth.ts) — Snapshot.growthCurves 의 키
  types: string[]; // 화면에 보이는 타입 이름
  typeIds: string[]; // types 와 같은 순서의 타입 키 (grass 등) — 타입 배지 색을 고른다
  nature: string; // 화면에 보이는 성격 이름
  size: number; // 그림 크기 단계 번호 1~sizeLevels
  natureId: string; // 성격 id — 성격 변경 창이 지금 성격을 막을 때 쓴다
  affinity: number;
  fullness: number;
  zone: ViewZone;
  mood: number; // 0~100. 보이기만 하는 값이다
  moodWord: string; // 기분 단계 말 — "좋음" 처럼 화면에 그대로 쓴다
  hidden: boolean;
  feedReady: boolean;
  feedInSec: number;
  playReady: boolean;
  playStreak: number;
  longPlay: boolean;
  buffs: ViewBuff[];
  evolutions: EvolutionView[]; // 다음 한 단계의 후보. 최종 단계면 비어 있다
  forms?: FormView[]; // 공유 sid 계열의 고를 수 있는 종 — 그 밖의 개체에는 없다 (src/dex/forms.ts)
}

// 공유 sid 계열의 모습 하나 — 박스 칸의 단체사진·툴팁과 바꾸기 확인 창이 쓴다
export interface FormView {
  species: string;
  name: string;
  types: string[];
  typeIds: string[];
}

export interface SlotView {
  index: number;
  state: ViewSlotState;
  unlockBy?: ViewUnlockBy;
  pet?: PetView;
}

export interface EggView {
  id: string;
  kind: string;
  name: string;
  ready: boolean;
  remainSec: number;
  percent: number;
  careReady: boolean;
  actions: { pat: number; song: number };
}

export interface BoxView {
  id: string;
  name: string;
  used: number;
  size: number;
  slots: (PetView | null)[];
}

export interface BagItemView {
  id: string;
  name: string;
  count: number;
  evolution: boolean; // 진화용 도구 — 누르면 진화할 개체를 고른다
  natures?: string[]; // 민트 — 바꿀 수 있는 성격 id. 성실민트는 보정 없는 성격 5개
  effect?: string; // 효과 종류 (src/bag/use.ts ItemEffect) — 가방 분류 칩과 사용 패널의 미리보기가 쓴다. 진화용 도구는 없다
  amount?: number; // 효과의 양 — 경험사탕은 경험치, 기본먹이는 만복도
}

// 성격 변경 창의 선택지 하나. 자료 순서다
export interface NatureOption {
  id: string;
  name: string; // 화면 이름
  mint: string; // 그 성격으로 바꾸는 민트 id
  mintName: string;
}

export type ShopCategory = "egg" | "pokemon" | "tool" | "evolution" | "slot";

export interface ShopItemView {
  id: string;
  name: string;
  note: string;
  price: number;
  category: ShopCategory;
  affordable: boolean; // 지금 포인트로 살 수 있다
  blocked?: string; // 살 수 없는 다른 이유 — 화면이 그대로 보여 준다
  room?: number; // 도구 — 가방에 더 담을 수 있는 개수 (최대 999 − 가진 개수). 구매 수량의 상한
}

export type DexState = "obtained" | "unlocked" | "locked";

export interface DexEntry {
  slug: string;
  dex: number;
  name: string;
  state: DexState;
  shiny: boolean;
  condition: string | null; // 발견한 알 행동 조건
}

// 도감 상세 — 칸을 누를 때 한 종만 따로 읽는다. 문구는 화면이 그대로 쓴다 (Figma Dex / Base 상세 패널)
export interface DexDetail {
  slug: string;
  dex: number;
  name: string; // 미해금이면 "???"
  state: DexState;
  types: string[]; // 미해금이면 비어 있다
  typeIds: string[]; // types 와 같은 순서의 타입 키
  shiny: boolean; // 이로치를 얻었는가
  owned: number; // 가진 개체 수
  methods: string; // 입수 방법 — 경로가 없으면 "획득 방법 준비 중"
  evolution: string; // 다음 단계와 조건 — 미해금이면 "해금하면 보여요"
  eggCondition: string; // "없음" · "미발견 · …" · "발견 · <조건>"
  gimmick: string;
  genus: string; // 공식 분류 — "쥐포켓몬". 미해금이면 빈 문자열
  flavor: string; // 공식 도감 설명문. 한국어가 없으면 영어. 미해금이면 빈 문자열
  height: string; // "1.1m". 미해금이면 빈 문자열
  weight: string; // "19.0kg". 미해금이면 빈 문자열
}

// 달성 전 · 달성했고 보상이 남음 · 보상까지 받음
export type AchievementState = "locked" | "achieved" | "claimed";

export interface AchievementView {
  id: string;
  name: string;
  desc: string; // 빈 문자열이면 설명 줄을 그리지 않는다
  reward: string; // 보상 설명. 화면이 그대로 보여 준다
  state: AchievementState;
}

// 설정 모달이 읽는 값. 저장의 settings 와 같은 뜻이며 화면이 쓰기 좋은 모양이다
export interface SettingsView {
  language: string;
  startOnLogin: boolean;
  sound: boolean;
  volume: number; // 소리 크기 0~100
  sleepAfterMin: number; // 0 이면 잠들지 않음
  playArea: "full" | "region";
  hasRegion: boolean; // 영역을 이미 그렸는가
}

export interface Snapshot {
  points: number;
  party: { slots: SlotView[]; shown: number; usable: number };
  boxes: BoxView[];
  eggs: { list: EggView[]; used: number; size: number };
  bag: BagItemView[];
  dex: { unlocked: number; obtained: number; shiny: number };
  shop: ShopItemView[];
  achievements: { total: number; unclaimed: number; list: AchievementView[] };
  settings: SettingsView;
  natures: NatureOption[];
  growthCurves: Record<string, number[]>; // 경험치 타입별 레벨 L 이 되는 누적 경험치 — 칸 L(1~100). 가방 사용 패널의 미리보기
  sizeLevels: number; // 그림 크기 단계 수 — 상세의 크기 단추 수 (src/save/rules.ts SIZE_STEPS)
  eggPalettes: Record<string, string[]>; // 알 종류별 그림 색표 (data/eggs.json palette) — 없는 알은 원작 그림
  tutorial: string | null; // 관리 창에 지금 보여 줄 튜토리얼 id(shop · hatch · party). 해당 탭에 있을 때만 화면이 코치마크를 그린다 (src/tutorial/core.ts)
  // 포켓몬 표시·클릭 통과 — 저장이 아니라 이 앱 프로세스의 창 상태다. 앱이 채운다. 없으면 설정에 두 줄을 두지 않는다
  display?: DisplayView;
  saveFailing?: boolean; // 저장이 이어서 3번 실패했다 — 모든 탭 위쪽에 안내를 띄운다 (src/main/game.ts)
}

export interface DisplayView {
  hidden: boolean; // 잠시 숨김 (트레이의 잠시 숨기기와 같다)
  clickThrough: boolean; // 클릭 통과
}

// ── CLI 연결 ───────────────────────────────────────────────────────────────────
// 설정 모달의 연결 탭. 저장이 아니라 각 CLI 의 설정 파일을 본다. 그래서 스냅샷이 아니라 따로 읽는다
export type AgentAction = "connect" | "disconnect" | "check";

export interface AgentRow {
  name: string;
  label: string;
  installed: boolean; // 그 CLI 를 쓰고 있는가
  connected: boolean; // 우리 훅이 전부 등록돼 있는가
  registered: number;
  total: number;
  usage: string; // transcript 이면 토큰을 읽는다. none 이면 작업 시간으로 적립한다
  error?: string;
}

export interface AgentReply {
  ok: boolean;
  reason: string;
  list: AgentRow[]; // 처리 뒤 다시 읽은 상태
}

// 화면이 보내는 요청 — 이름과 인자는 src/tx/bridge.ts 가 푼다.
// 조작 하나마다 `args.reqId` 를 새로 붙인다. 없으면 같은 순간의 두 조작이 하나로 합쳐진다
export interface ManageRequest {
  cmd: string;
  target?: string;
  args?: Record<string, unknown>;
}

// 결과는 문구가 아니라 코드 — 문구는 화면이 만든다
export interface ManageReply {
  ok: boolean;
  reason: string;
  screen?: TradeScreen; // trade.* 명령의 결과 — 교환 탭이 그리는 값
  [key: string]: unknown;
}

// 도감은 종이 1000개를 넘어 스냅샷에 담지 않는다. 탭을 열 때만 따로 부른다.
// CLI 연결은 저장 밖을 보므로 역시 따로 부른다
// manage:route 는 메인 → 렌더러 한 방향이다. 알림 배너의 `바로가기` 가 관리 창을 어디로 옮길지 알린다
// manage:draw-region 은 설정의 `영역 그리기` — 영역 그리기 창을 열고, 적용·취소가 끝나면 답한다
// manage:dim 은 렌더러 → 메인 — 모달 가림막을 켜고 끈다. OS 가 그리는 창 단추 자리도 같은 색으로 어둡게 한다
// manage:portraits 는 초상 — 종과 이로치 여부를 보내면 열쇠(slug 또는 slug:shiny)별 data URI 를 돌려준다. 못 받으면 null
// manage:art 는 디스크에 이미 있는 초상·도구·알 그림 전부 — 창을 열 때 한 번 받아 첫 화면부터 그림을 채운다
// manage:dex-open 은 렌더러 → 메인 — 도감 칸을 눌렀다. 도감 기기 창에 그 종을 띄운다. null 이면 기기 창을 닫는다
// manage:dex-step 은 메인 → 렌더러 — 기기 창의 이전·다음. 순서는 관리 창의 지금 목록(검색·칩 적용)이 정한다
// manage:dex-closed 는 메인 → 렌더러 — 기기 창이 닫혔다. 고른 칸 표시를 지운다
// manage:trade 는 메인 → 렌더러 — 교환 보기가 바뀌었다(실시간 신호·주기 새로 고침·조작 결과). manage:copy 는 렌더러 → 메인 — 글자를 클립보드에 쓴다
export type ManageChannel = "manage:snapshot" | "manage:command" | "manage:dex" | "manage:dex-detail" | "manage:agents" | "manage:route" | "manage:draw-region" | "manage:dim" | "manage:portraits" | "manage:icons" | "manage:art" | "manage:dex-open" | "manage:dex-step" | "manage:dex-closed" | "manage:trade" | "manage:copy" | "manage:account" | "manage:account-view";

// 관리 창 안의 목적지. 부화는 돌보미집, 진화는 개체 상세, 업적은 업적 창 (docs/specs/game.md "알림 배너의 개별 표시")
// 교환은 교환 링크(딥링크)로 앱을 열었을 때 교환 탭으로 간다. 계정은 GitHub 로그인 뒤 브라우저에서 돌아왔을 때 설정의 계정 탭으로 간다
export type ManageRoute = { to: "daycare" } | { to: "pet"; petId: string } | { to: "achievements"; id: string } | { to: "trade" } | { to: "account" };

// ── 계정과 클라우드 저장 ──────────────────────────────────────────────────────────────
// 설정의 계정 탭·헤더 저장 표시·밀려남 배너가 그리는 값 (src/main/online.ts). Figma 05 Screens `633:19206`~`633:20029`
// manage:account 는 렌더러 → 메인 요청(결과에 screen), manage:account-view 는 메인 → 렌더러 밀어 보내기다
export type CloudStatusView = "off" | "connecting" | "choose" | "online" | "offline" | "save-needed";
export interface SaveSummaryView {
  pets: number;
  points: number;
  savedAt: number | null;
}
export interface AccountScreen {
  available: boolean; // 서버 설정이 있고 이 앱이 저장을 쓴다
  signedIn: boolean;
  method: "password" | "github" | null;
  username: string | null;
  displayName: string | null;
  blocked: boolean; // 걸린 교환이 있어 로그인·로그아웃·삭제를 할 수 없다
  kicked: boolean; // 다른 PC 에서 로그인해 이 PC 가 로그아웃됐다 — 배너를 닫을 때까지
  cloud: {
    status: CloudStatusView;
    lastSavedAt: number | null;
    busy: boolean;
    error: string | null;
    choice: { server: SaveSummaryView; local: SaveSummaryView | null } | null;
  };
}
export type AccountAction =
  | { action: "status" }
  | { action: "check-username"; username: string }
  | { action: "sign-up"; username: string; displayName: string; password: string }
  | { action: "sign-in"; username: string; password: string }
  | { action: "github" }
  | { action: "github-cancel" } // 브라우저 로그인을 기다리다 취소
  | { action: "sign-out"; save?: boolean } // save — 저장 필요 상태에서 "저장하고 로그아웃"
  | { action: "rename"; displayName: string }
  | { action: "delete" }
  | { action: "save-now" }
  | { action: "choose"; which: "server" | "local" }
  | { action: "dismiss-kicked" };
export interface AccountReply {
  ok: boolean;
  code: string | null; // 실패 코드 — AUTH_* · CLOUD_* · NETWORK
  check?: "available" | "taken" | "invalid" | "NETWORK"; // check-username 의 결과
  screen: AccountScreen;
}

// ── 친구 교환 ───────────────────────────────────────────────────────────────────
// 교환 탭이 그리는 값 — 메인이 교환 흐름(src/trade/session.ts)의 보기와 저장을 합쳐 만든다 (src/main/trade-screen.ts).
// Figma 05 Screens `633:18522` 의 교환 6화면. 명령은 `command` 의 trade.* 로 보낸다. 결과에도 이 값(`screen`)이 온다
export interface TradeCardView {
  species: string;
  name: string;
  shiny: boolean;
  level: number;
  nature: string;
  types: string[];
  typeIds: string[];
}

export interface TradeScreen {
  available: boolean; // 교환을 쓸 수 없다(동반자 아님·reader·서버 설정 없음) — 탭은 안내만 보인다
  phase: "idle" | "hosting" | "trading" | "done" | "closed";
  link: string | null; // 내가 만든 링크 (hosting)
  expiresAt: number | null; // 참가 전 만료 시각 ms (hosting)
  busy: boolean;
  error: { code: string; detail?: string } | null; // 오류 배너 — 코드는 서버 TRADE_* · NETWORK · LOCAL
  closedReason: string | null; // closed 일 때 — guest_left · host_left · expired 등
  friendJoined: boolean;
  friendName: string | null; // 친구가 로그인했으면 가입 때 받은 이름
  mine: TradeCardView | null; // 내가 올린 포켓몬
  myPetId: string | null;
  myReady: boolean;
  friend: TradeCardView | null; // 친구가 올린 포켓몬 — 받을 수 없어도 보인다
  friendReady: boolean;
  friendBlocked: string | null; // 받을 수 없는 이유 — single 등
  singles: string[]; // 올릴 수 없는 개체 ID (단일 포켓몬)
  received: { petId: string; card: TradeCardView; party: number | null; box: string | null; hidden: boolean; sent: TradeCardView | null } | null; // 완료
}

export interface ManageBridge {
  snapshot: () => Promise<Snapshot | null>; // 저장이 없으면 null
  command: (req: ManageRequest) => Promise<ManageReply>;
  dex: () => Promise<DexEntry[]>;
  dexDetail: (slug: string) => Promise<DexDetail | null>; // 도감 칸 하나의 상세
  agents: (req?: { name: string; action: AgentAction }) => Promise<AgentReply>; // 인자가 없으면 읽기만 한다
  onRoute: (cb: (route: ManageRoute) => void) => void; // 배너의 `바로가기` 로 옮겨 갈 곳
  drawRegion: () => Promise<ManageReply>; // 적용하면 ok, 취소하면 reason "cancelled"
  dim: (on: boolean) => void; // 모달 가림막이 켜졌다·꺼졌다
  portraits: (asks: PortraitAsk[]) => Promise<Record<string, string | null>>;
  icons: (keys: string[]) => Promise<Record<string, string | null>>; // 도구·알 그림 — 열쇠는 "egg" 또는 "item:<식별자>"
  art: () => Promise<Record<string, string>>; // 초상(slug · slug:shiny)과 도구·알(egg · item:<식별자>) 열쇠별 data URI
  dexOpen: (slug: string | null) => void; // 도감 기기 창에 이 종을 띄운다. null 이면 닫는다
  onDexStep: (cb: (delta: -1 | 1) => void) => void; // 기기 창의 이전·다음
  onDexClosed: (cb: () => void) => void; // 기기 창이 닫혔다
  onTrade: (cb: (screen: TradeScreen) => void) => void; // 교환 보기가 바뀌었다
  copyText: (text: string) => void; // 교환 링크 복사 — 메인의 clipboard 로 쓴다
  account: (req: AccountAction) => Promise<AccountReply>;
  onAccount: (cb: (screen: AccountScreen) => void) => void; // 계정·저장 상태가 바뀌었다
}

// ── 도감 기기 창 ────────────────────────────────────────────────────────────────
// 관리 창 옆에 붙어 한 종의 도감 항목을 보이는 창 — Figma `99 · 시안` `579:17691` (worklog/records/play-bugs/record.md)
export interface DexDeviceView {
  detail: DexDetail;
  portrait: string | null; // data URI. 미해금이면 화면이 검은 실루엣으로 칠한다
  side: "right" | "left"; // 관리 창의 어느 쪽에 붙었나 — 경첩 면을 관리 창 쪽에 그린다
  volume: number; // 울음소리 음량 0~1 — 0 이면 울음소리 단추를 막는다
}

// dexdev:show 는 메인 → 렌더러. 나머지는 렌더러 → 메인이다
//   size   그린 높이 — 창 높이를 내용에 맞춘다
//   step   이전(-1) · 다음(1)
//   cry    지금 종의 울음소리 data URI (못 받으면 null)
//   close  닫기
export type DexDeviceChannel = "dexdev:show" | "dexdev:size" | "dexdev:step" | "dexdev:cry" | "dexdev:close";

export interface DexDeviceBridge {
  onShow: (cb: (view: DexDeviceView) => void) => void;
  size: (height: number) => void;
  step: (delta: -1 | 1) => void;
  cry: () => Promise<string | null>;
  close: () => void;
}

// 놀이공간 영역 그리기 창 — Figma `Playground / Region Draw` `396:8541`. 좌표는 창 안 좌표(DIP)다
export interface RegionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RegionInit {
  current: RegionRect | null; // 지금 영역 (이 화면과 겹칠 때만)
  min: { area: number; side: number }; // 최소 넓이와 한 변 — 이보다 작으면 적용할 수 없다 (src/state/settings.ts REGION_MIN)
}

// region:init 은 메인 → 렌더러, region:done 은 렌더러 → 메인 (null 이면 취소)
export type RegionChannel = "region:init" | "region:done";

export interface RegionBridge {
  onInit: (cb: (init: RegionInit) => void) => void;
  done: (rect: RegionRect | null) => void;
}

// 알림 배너 창 — 배너 하나의 문구와 `바로가기` 목적지. 문구는 src/notify/banner.ts 가 만든다
export type BannerKind = "hatch" | "evolve" | "achievement";

export interface BannerView {
  key: string;
  kind: BannerKind;
  title: string; // 부화 준비 완료 · 진화 가능 · 업적 달성
  target: string; // 돌보미집 알 N · <이름> Lv.N · 업적 이름
  go: string; // 바로가기
  route: ManageRoute;
  chime?: number; // 알림음 음량 0~1. 0 이면 소리를 내지 않는다 (src/state/settings.ts gainOf)
}

// banner:show 는 메인 → 렌더러, 나머지는 렌더러 → 메인
export type BannerChannel = "banner:show" | "banner:go" | "banner:hover";

export interface BannerBridge {
  onShow: (cb: (banner: BannerView) => void) => void;
  go: (key: string) => void; // `바로가기` 를 눌렀다
  hover: (on: boolean) => void; // 커서가 배너 위에 있는 동안 사라지지 않는다
}

// 앱이 그리는 메뉴 창 — Figma `Context Menu` `338:738`. 메인이 메뉴 모델을 이 모양으로 바꿔 보낸다
export type MenuView =
  | { kind: "separator" }
  | { kind: "status"; title: string; caption?: string } // 맨 위 이름·상태 두 줄 — 누를 수 없다
  | { kind: "item"; id: number; label: string; disabled: boolean; hint?: string }; // hint 는 오른쪽의 짧은 글 — 체크 항목의 `켜짐`

// menu:show 는 메인 → 렌더러, 나머지는 렌더러 → 메인. menu:pick 이 null 이면 닫기만 한다
export type MenuChannel = "menu:show" | "menu:size" | "menu:pick";

export interface MenuBridge {
  onShow: (cb: (items: MenuView[]) => void) => void;
  size: (w: number, h: number) => void; // 그린 뒤의 크기 — 메인이 창 크기와 자리를 정한다
  pick: (id: number | null) => void;
}

// 초상 요청 한 건 — 열쇠는 slug, 이로치면 `slug:shiny`
export interface PortraitAsk {
  slug: string;
  shiny: boolean;
}
