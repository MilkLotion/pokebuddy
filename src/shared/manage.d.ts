// 관리 창 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다 (런타임 값 없음)
// 선언 파일인 이유와 다른 파일을 import 하지 않는 이유는 shared/stage.d.ts 와 같다.
// 화면이 읽는 값은 src/tx/snapshot.ts 가 만든다. 그 파일이 여기 타입을 가져다 쓴다 — 모양의 출처는 한 곳이다.
// FullnessZone 은 src/state/time.ts 의 같은 이름과 같은 값이다. 자체 검사가 서로 대입해 어긋남을 잡는다

export type ViewZone = "full" | "normal" | "hungry" | "starving";
export type ViewSlotState = "pokemon" | "empty" | "locked";

export interface ViewBuff {
  kind: string;
  name: string; // 화면 이름 — 든든함 · 신남 · 들뜸
  remainMin: number; // 남은 분(반올림). 시간으로만 바뀌는 값이라 1초 시계가 표시만 고친다
}

// 진화 후보 하나 — 화면이 그대로 보인다. 낮·밤은 스냅샷을 만든 시각으로 정했다
export interface EvolutionView {
  to: string; // 결과 종 슬러그 — evolve 명령의 args.to 로 보낸다
  name: string; // 결과 종의 화면 이름. 도감에서 해금 안 된 종이면 "???"
  known: boolean; // 도감에서 해금(또는 획득)한 종 — 아니면 이름·그림을 가린다 (2026-10-01 사용자 결정)
  ready: boolean;
  need?: string; // 모자란 조건의 화면 문구 — "Lv.16 필요", "물의돌 필요", "밤에만"
  item?: string; // 진화용 도구가 조건이면 그 도구 id. 가방의 돌로 대상을 고를 때 쓴다
  map?: true; // 지도 간선(기본형 → 리전폼) — 지도도 쓴다. 가방의 지도로 대상을 고를 때 쓴다
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
  gender: "male" | "female" | "none"; // 성별 — 무성은 아이콘을 두지 않는다 (src/dex/gender.ts)
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
  longPlay: boolean; // 신남 버프가 켜져 있다
  buffs: ViewBuff[]; // 켜진 버프만 — buffNames 와 같은 순서
  buffNames: string[]; // 켜진 버프의 화면 이름 — 든든함 · 신남 · 들뜸 순서 (2026-09-29 사용자 결정)
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
  pet?: PetView;
}

export interface EggView {
  id: string;
  kind: string;
  name: string;
  ready: boolean;
  remainSec: number;
  percent: number;
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
  effect?: string; // 효과 종류 (src/bag/use.ts ItemEffect) — 가방 분류 칩과 사용 패널의 미리보기가 쓴다. 진화용 도구는 없다
  amount?: number; // 효과의 양 — 경험사탕은 경험치, 기본먹이는 만복도
  sellPrice?: number; // 하나의 판매가 (src/shop/sell.ts sellPrice). 없으면 팔 수 없다 — 가격이 없거나 0P 인 도구
  buyPrice?: number; // 판매가의 바탕인 구매가 — 판매 안내 "구매가 Y P의 60%" 가 쓴다. sellPrice 가 있을 때만
  sellRate?: number; // 판매 비율 (SHOP_V3_RULES.sellRate) — 판매 안내의 백분율. sellPrice 가 있을 때만
  about?: ItemAbout; // 가방 기기 창의 설명 (src/tx/lists.ts itemAbout)
}

// 도구 설명 — 상점·가방 기기 창이 같이 쓴다 (src/tx/lists.ts itemAbout, data/items.json group·desc·effectText)
export interface ItemAbout {
  group: string; // 분류 줄 — "경험치 도구" · "진화용 도구"
  desc: string; // 설명
  effect: string; // 정보 줄 `효과`
  where: string; // 정보 줄 `쓰는 곳`. 진화용 도구는 진화 전 종 이름("피카츄·레어코일 외 5종")
}

// 성격 변경 창의 선택지 하나. 자료 순서다
export interface NatureOption {
  id: string;
  name: string; // 화면 이름. 어느 성격이든 민트(mint) 한 개로 바꾼다
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
  room?: number; // 구매 수량의 상한. 도구 — 가방에 더 담을 수 있는 개수 (최대 999 − 가진 개수). 알 — 돌보미집 빈 칸, 단일 포켓몬 알이면 남은 종 수 − 기다리는 같은 알 수까지
  dex?: number; // 포켓몬 — 전국도감 번호. 상점 격자의 번호 줄·검색·지방에 쓴다
  form?: number; // 리전폼의 폼 순번 — 번호 줄이 `#0026-1` 이 된다 (src/dex/regional.ts)
  region?: string; // 리전폼의 지방 — 지방 필터가 번호 구간 대신 이것으로 거른다
  about?: ShopAbout; // 상점 기기 창의 설명 — 포켓몬 상품은 없다
}

// 상점 기기 창이 보일 상품 설명 (src/tx/lists.ts, Figma 05 `Shop / Device / …`). 문구는 화면이 그대로 쓴다
export interface ShopAbout extends ItemAbout {
  spec: [string, string]; // 가격 아래 둘째 줄 — ["보유", "3개"] · ["준비", "5분"]
}

export type DexState = "obtained" | "unlocked" | "locked";

export interface DexEntry {
  slug: string;
  dex: number;
  form?: number; // 리전폼의 폼 순번 — `#0026-1`. 정렬은 번호, 그다음 폼 순번 (src/dex/regional.ts)
  region?: string; // 리전폼의 지방 — 지방 필터가 번호 구간 대신 이것으로 거른다
  name: string;
  state: DexState;
  shiny: boolean;
}

// 도감 상세 — 칸을 누를 때 한 종만 따로 읽는다. 문구는 화면이 그대로 쓴다 (Figma Dex / Base 상세 패널)
export interface DexDetail {
  slug: string;
  dex: number;
  form?: number; // 리전폼의 폼 순번 — `No.026-1`
  name: string; // 미해금이면 "???"
  state: DexState;
  types: string[]; // 미해금이면 비어 있다
  typeIds: string[]; // types 와 같은 순서의 타입 키
  shiny: boolean; // 이로치를 얻었는가
  owned: number; // 가진 개체 수
  methods: string; // 입수 방법 — 경로가 없으면 "획득 방법 준비 중"
  evolution: string; // 다음 단계와 조건 — 미해금이면 "해금하면 보여요"
  gimmick: string;
  genus: string; // 공식 분류 — "쥐포켓몬". 미해금이면 빈 문자열
  flavor: string; // 공식 도감 설명문. 한국어가 없으면 영어. 미해금이면 빈 문자열
  height: string; // "1.1m". 미해금이면 빈 문자열
  weight: string; // "19.0kg". 미해금이면 빈 문자열
}

// 상점 상세 — 구매 창을 열 때 상품 하나만 만든다 (src/tx/shop-detail.ts, 2026-09-30 사용자 결정 "상점에서 포켓몬 상세 추가")
// 진화 사슬의 한 종. 미해금이면 name 이 "???" 이고 화면은 그림 대신 빈 원을 그린다(실루엣 없음). 조건 문구는 미해금이어도 준다
export interface EvoNodeView {
  slug: string;
  name: string;
  locked: boolean;
  current: boolean; // 지금 보는(사려는) 종
  need?: string; // 이 종으로 오는 조건 — "Lv.16" · "천둥의돌" · "친밀도 65 · 밤" · "각성의돌 · 수컷". 뿌리는 없다
  children: EvoNodeView[];
}

export interface EvoPairView {
  from: { slug: string; name: string; locked: boolean };
  to: { slug: string; name: string; locked: boolean };
  note?: string; // 도구 밖의 조건 — "수컷" · "밤". 도구 이름은 제목에 있으니 뺀다
}

export type ShopDetail =
  | { kind: "pokemon"; slug: string; dex: number; form?: number; name: string; genus: string; types: string[]; typeIds: string[]; tree: EvoNodeView }
  | { kind: "evolution"; pairs: EvoPairView[] }; // 진화용 도구 — 이 도구로 진화하는 쌍, 도감 번호순

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
  playArea: "all" | "screen" | "region"; // 모든 화면 · 한 화면 · 영역 지정 (2026-09-28 여러 화면)
  hasRegion: boolean; // 영역을 이미 그렸는가
}

export interface Snapshot {
  points: number;
  // preset 은 지금 적용한 파티 프리셋 — 번호(0 부터), 가진 수, 최대 수, 이름 (src/party/presets.ts)
  party: { slots: SlotView[]; shown: number; usable: number; preset: { index: number; count: number; max: number; name: string } };
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
  tutorial: string | null; // 관리 창에 지금 보여 줄 튜토리얼 id(shop · hatch · achievement). 해당 탭에 있을 때만 화면이 코치마크를 그린다 (src/tutorial/core.ts)
  detailTutorial: boolean; // 개체 상세 튜토리얼을 아직 끝내거나 건너뛰지 않았다 — 파티 개체 상세를 처음 열면 화면이 5단계를 보여 준다
  areaTutorial: boolean; // 놀이공간 튜토리얼을 아직 끝내거나 건너뛰지 않았다 — 설정 › 화면을 처음 열면 놀이공간 줄을 밝힌다 (2026-09-28 바탕화면에서 옮김)
  screenTutorials: string[]; // 화면을 처음 열 때 띄우는 튜토리얼 가운데 아직 끝내거나 건너뛰지 않은 것 — area · dex · trade · user (src/tutorial/core.ts SCREEN_TUTORIALS)
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
export type AgentAction = "connect" | "disconnect" | "check" | "probe"; // probe — 연결 점검(훅을 한 번 실제로 돌려 본다)

export interface AgentRow {
  name: string;
  label: string;
  installed: boolean; // 그 CLI 를 쓰고 있는가
  connected: boolean; // 우리 훅이 하나라도 등록돼 있는가
  outdated: boolean; // 연결됐지만 등록 목록·훅 파일이 지금과 다르다 — 연결 탭 "갱신"
  registered: number;
  total: number;
  usage: string; // transcript 이면 토큰을 읽는다. none 이면 작업 시간으로 적립한다
  lastSignalAt: number | null; // 마지막 신호 시각(ms) — 훅이 쓴 state 기록 가운데 가장 늦은 것. 없으면 null
  error?: string;
}

export interface AgentReply {
  ok: boolean;
  reason: string;
  list: AgentRow[]; // 처리 뒤 다시 읽은 상태
  platform: string; // process.platform — Windows 에서만 붙이는 안내(codex --no-daemon)를 가른다
  node: { path: string; version: string } | null; // 훅을 돌릴 Node.js — 없으면 연결을 막는다 (src/agents/check.ts)
  detail?: string; // probe 실패 — exit 의 종료 코드
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
  screen?: TradeScreen; // trade.* 명령의 결과 — 교환 모달이 그리는 값
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
export type ManageChannel = "manage:snapshot" | "manage:command" | "manage:dex" | "manage:dex-detail" | "manage:shop-detail" | "manage:agents" | "manage:route" | "manage:draw-region" | "manage:dim" | "manage:portraits" | "manage:icons" | "manage:art" | "manage:dex-open" | "manage:dex-step" | "manage:dex-closed" | "manage:pet-open" | "manage:pet-step" | "manage:pet-act" | "manage:pet-closed" | "manage:shop-open" | "manage:shop-step" | "manage:shop-act" | "manage:shop-closed" | "manage:bag-open" | "manage:bag-step" | "manage:bag-act" | "manage:bag-closed" | "manage:party-open" | "manage:party-act" | "manage:party-step" | "manage:party-closed" | "manage:trade" | "manage:copy" | "manage:account" | "manage:account-view" | "manage:update" | "manage:update-view" | "manage:notes" | "manage:screens" | "manage:identify-screens" | "manage:pick-screen" | "manage:mail" | "manage:mail-view" | "manage:clock" | "manage:pet-menu";

// 관리 창 안의 목적지. 부화는 돌보미집, 진화는 개체 상세, 업적은 업적 창 (docs/specs/game.md "알림 배너의 개별 표시")
// form 은 포켓몬 메뉴의 모습 말풍선에서 고른 모습 — 바꾸기 확인 창을 띄운다
// 교환은 교환 링크(딥링크)로 앱을 열었을 때 박스 탭을 열고 교환 모달을 띄운다. 계정은 GitHub 로그인 뒤 브라우저에서 돌아왔을 때 설정의 계정 탭으로 간다
export type ManageRoute = { to: "daycare" } | { to: "pet"; petId: string } | { to: "achievements"; id: string } | { to: "trade" } | { to: "account" } | { to: "agents" } | { to: "bag" } | { to: "shop" } | { to: "form"; petId: string; species: string } | { to: "move"; petId: string } | { to: "sell"; petId: string; price: number };

// ── 앱 버전과 업데이트 ──────────────────────────────────────────────────────────────
// 설정 모달 바닥 왼쪽이 그린다 (src/main/updater.ts). off 는 개발 실행·npm 설치본 — 버전만 보인다
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
export interface AccountReply {
  ok: boolean;
  code: string | null; // 실패 코드 — AUTH_* · CLOUD_* · NETWORK
  check?: "available" | "taken" | "invalid" | "NETWORK"; // check-username 의 결과
  screen: AccountScreen;
}

// ── 우편함 ───────────────────────────────────────────────────────────────────────
// 헤더 봉투 단추가 여는 모달 (src/main/mail.ts). Figma 05 Screens 섹션 `10 우편함` `932:22859` (A안 편지 + 선물)
// manage:mail 은 렌더러 → 메인 요청(결과에 screen), manage:mail-view 는 메인 → 렌더러 밀어 보내기다
export interface MailGiftView {
  kind: "item" | "points" | "pokemon";
  id: string | null; // 도구 id — 그림(item:<id>)을 찾는다. 포켓몬은 종 slug(초상). 포인트는 null
  name: string; // "경험사탕M" · "포인트" · "미뇽"
  count: number;
}
export interface MailLetterView {
  id: string;
  title: string;
  body: string;
  sender: string;
  startsAt: number;
  endsAt: number | null; // 없으면 기한 없음
  gifts: MailGiftView[]; // 비면 공지 편지
  claimedAt: number | null; // 서버가 받은 기록을 가진 시각
  applied: boolean; // 이 저장에 선물을 넣었다
  read: boolean;
  unsupported: boolean; // 모르는 선물이 있다 — 앱을 업데이트해야 받는다
}
export interface MailScreen {
  available: boolean; // 서버 설정이 있다
  status: "idle" | "loading" | "ok" | "offline";
  signedIn: boolean; // 정식 계정 — 선물은 로그인해야 받는다
  letters: MailLetterView[]; // 최근 순
  unread: number; // 읽지 않았거나 받을 선물이 남은 편지 수 — 헤더 점
  busy: string | null; // 받는 중인 편지 id
  error: string | null; // 마지막 받기의 실패 코드 — MAIL_* · NETWORK · bad-gift
}
export type MailAction = { action: "refresh" } | { action: "read"; id: string } | { action: "claim"; id: string };
export interface MailReply {
  ok: boolean;
  code: string | null;
  screen: MailScreen;
}

// ── 친구 교환 ───────────────────────────────────────────────────────────────────
// 교환 모달이 그리는 값 — 메인이 교환 흐름(src/trade/session.ts)의 보기와 저장을 합쳐 만든다 (src/main/trade-screen.ts).
// Figma 05 Screens 섹션 `930:18244`(교환) 의 교환 6화면. 명령은 `command` 의 trade.* 로 보낸다. 결과에도 이 값(`screen`)이 온다
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
  available: boolean; // 교환을 쓸 수 없다(동반자 아님·reader·서버 설정 없음) — 모달은 안내만 보인다
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
  shopDetail: (productId: string) => Promise<ShopDetail | null>; // 상점 구매 창의 상세 — 포켓몬 진화 트리, 진화용 도구의 대상
  agents: (req?: { name: string; action: AgentAction }) => Promise<AgentReply>; // 인자가 없으면 읽기만 한다
  onRoute: (cb: (route: ManageRoute) => void) => void; // 배너의 `바로가기` 로 옮겨 갈 곳
  petMenu: (petId: string) => Promise<boolean>; // 파티 카드·박스 칸을 눌렀다 — 메인이 커서 자리에 포켓몬 메뉴를 띄운다. 띄울 길이 없으면 false
  drawRegion: () => Promise<ManageReply>; // 적용하면 ok, 취소하면 reason "cancelled"
  screens: () => Promise<ScreenView[]>; // 지금 화면 목록 — 번호 순. 화면을 모르면(개발 실행기 등) 빈 목록
  identifyScreens: (on: boolean) => void; // 모든 화면에 번호 덮개를 띄운다·치운다 — 한 화면 목록이 열린 동안
  pickScreen: () => Promise<ManageReply>; // 화면 위에서 눌러 고른다. 고르면 저장하고 ok, 취소하면 reason "cancelled"
  dim: (on: boolean) => void; // 모달 가림막이 켜졌다·꺼졌다
  portraits: (asks: PortraitAsk[]) => Promise<Record<string, string | null>>;
  icons: (keys: string[]) => Promise<Record<string, string | null>>; // 도구·알 그림 — 열쇠는 "egg" 또는 "item:<식별자>"
  art: () => Promise<Record<string, string>>; // 초상(slug · slug:shiny)과 도구·알(egg · item:<식별자>) 열쇠별 data URI
  dexOpen: (slug: string | null, gen?: number, beside?: boolean) => void; // 도감 기기 창에 이 종을 띄운다. null 이면 닫는다. gen 은 마지막으로 받은 닫힘 세대 번호 — 낡으면 메인이 버린다. beside 면 파티 상세 기기 창 옆에 붙인다
  onDexStep: (cb: (delta: -1 | 1) => void) => void; // 기기 창의 이전·다음
  onDexClosed: (cb: (gen: number) => void) => void; // 기기 창이 닫혔다 — 새 세대 번호 (src/main/device-gen.ts)
  petOpen: (open: PetDeviceOpen | null, gen?: number) => void; // 파티 상세 기기 창에 이 개체를 띄운다. null 이면 닫는다. gen 은 마지막으로 받은 닫힘 세대 번호 — 낡으면 메인이 버린다
  onPetStep: (cb: (delta: -1 | 1) => void) => void; // 파티 상세 기기 창의 이전·다음
  onPetAct: (cb: (action: PetDeviceAction) => void) => void; // 파티 상세 기기 창에서 누른 단추 — 관리 창이 처리한다
  onPetClosed: (cb: (gen: number) => void) => void; // 파티 상세 기기 창이 닫혔다 — 새 세대 번호 (src/main/device-gen.ts)
  shopOpen: (open: ShopDeviceOpen | null, gen?: number) => void; // 상점 기기 창에 이 상품을 띄운다. null 이면 닫는다
  onShopStep: (cb: (delta: -1 | 1) => void) => void; // 상점 기기 창의 이전·다음
  onShopAct: (cb: (action: ShopDeviceAction) => void) => void; // 상점 기기 창에서 누른 단추 — 관리 창이 처리한다
  onShopClosed: (cb: (gen: number) => void) => void; // 상점 기기 창이 닫혔다 — 새 세대 번호
  bagOpen: (open: BagDeviceOpen | null, gen?: number) => void; // 가방 기기 창에 이 도구를 띄운다. null 이면 닫는다
  onBagStep: (cb: (delta: -1 | 1) => void) => void;
  onBagAct: (cb: (action: BagDeviceAction) => void) => void;
  onBagClosed: (cb: (gen: number) => void) => void;
  partyOpen: (open: PartyDeviceOpen | null, gen?: number) => void; // 파티 기기 창(교체 화면)을 띄운다. null 이면 닫는다
  onPartyAct: (cb: (action: PartyDeviceAction) => void) => void; // 파티 기기 창에서 누른 칸·칩 — 관리 창이 처리한다
  onPartyStep: (cb: (delta: -1 | 1) => void) => void; // 방향키 — 앞·뒤 프리셋
  onPartyClosed: (cb: (gen: number) => void) => void;
  onTrade: (cb: (screen: TradeScreen) => void) => void; // 교환 보기가 바뀌었다
  copyText: (text: string) => void; // 교환 링크 복사 — 메인의 clipboard 로 쓴다
  account: (req: AccountAction) => Promise<AccountReply>;
  mail: (req: MailAction) => Promise<MailReply | null>; // 우편함 — 서버 설정이 없으면 null
  onMail: (cb: (screen: MailScreen) => void) => void; // 목록·받기 상태가 바뀌었다
  onAccount: (cb: (screen: AccountScreen) => void) => void; // 계정·저장 상태가 바뀌었다
  update: (action: UpdateAction) => Promise<UpdateView | null>; // 업데이트가 연결되지 않았으면 null
  onUpdate: (cb: (view: UpdateView) => void) => void; // 버전·업데이트 상태가 바뀌었다
  notes: (action: "list" | "seen") => Promise<PatchNotesView | null>; // seen 은 안 본 노트를 띄웠다고 알린다
  // 앱 전역 1초 시계 `manage:clock` — 메인이 1초마다 보낸다. 받을 때마다 스냅샷을 다시 읽는다 (2026-09-29 사용자 결정 "전역 타이머 1초").
  // preload 가 아직 내주지 않으면 없다 — 관리 창이 임시로 자기 1초 타이머를 쓴다
  onClock?: (cb: (tick: { now: number }) => void) => void;
}

// ── 도감 기기 창 ────────────────────────────────────────────────────────────────
// 관리 창 옆에 붙어 한 종의 도감 항목을 보이는 창 — Figma `99 · 시안` `579:17691` (worklog/records/play-bugs/record.md)
export interface DexDeviceView {
  detail: DexDetail;
  portrait: string | null; // data URI. 미해금이면 화면이 검은 실루엣으로 칠한다
  side: "right" | "left"; // 관리 창의 어느 쪽에 붙었나 — 경첩 면을 관리 창 쪽에 그린다
  volume: number; // 울음소리 음량 0~1 — 0 이면 울음소리 단추를 막는다
  // 진화 트리 — 상점 구매 창과 같은 사슬이다(src/tx/shop-detail.ts). 미해금 종도 보낸다 — 트리 안의 미해금 종은 기기 창이 ??? 와 빈 원으로 그린다. 사슬이 없으면 null
  tree: EvoNodeView | null;
  treePortraits: Record<string, string>; // 트리의 해금 종 그림 — slug → data URI
  beside: boolean; // 파티 상세 기기 창 옆에 붙었다 — 바닥 단추 줄(이전·울음소리·다음)을 두지 않는다
}

// dexdev:show 는 메인 → 렌더러. 나머지는 렌더러 → 메인이다
//   size   그린 높이 — 창 높이를 내용에 맞춘다
//   step   이전(-1) · 다음(1)
//   cry    지금 종의 울음소리 data URI (못 받으면 null)
//   close  닫기
export type DexDeviceChannel = "dexdev:show" | "dexdev:size" | "dexdev:step" | "dexdev:cry" | "dexdev:close";

// 파티 상세 기기 창 — 관리 창이 정해 보내는 것(PetDeviceOpen)에 메인이 그림·붙은 쪽·음량을 더한다 (src/main/pet-window.ts)
export interface PetDeviceOpen {
  pet: PetView;
  where: string; // "파티 1번 · 나와 있음" · "박스 1 · 보관 중"
  inParty: boolean;
  slotIndex: number | null; // 파티 칸 — 교체 대화상자가 쓴다
  sizeLevels: number;
  notice: string; // 마지막 실패 문구
  tutorial: boolean; // 개체 상세 튜토리얼을 보일 차례 — 파티 개체이고 아직 끝내거나 건너뛰지 않았다
  dexOpen: boolean; // 옆에 이 종의 도감 기기 창이 떠 있다 — `도감 보기` 줄을 톤 배경으로
}
export interface PetDeviceView extends PetDeviceOpen {
  portrait: string | null; // data URI
  side: "right" | "left";
  volume: number; // 울음소리 음량 0~1 — 0 이면 울음소리 단추를 막는다
}
// 기기 창에서 누른 단추. 명령은 관리 창의 명령 경로로, 대화상자는 관리 창에서 연다
// petId 는 기기 창에 떠 있던 개체 — 관리 창의 지금 개체와 다르면 버린다(빠르게 넘길 때 다른 개체에 쓰이지 않게)
export type PetDeviceAction = { petId: string } & (
  | { kind: "cmd"; cmd: "feed" | "play" | "party.show" | "party.hide" | "pet.set"; args?: Record<string, unknown> }
  | { kind: "dialog"; dialog: "evolve" | "nature" }
  | { kind: "tutorial"; action: "done" | "skip" } // 개체 상세 튜토리얼을 끝냈다·닫았다
  | { kind: "dex" } // 도감 보기 — 기기 창을 닫고 그 종의 도감 기기 창을 연다 (2026-09-30)
);
export type PetDeviceChannel = "petdev:show" | "petdev:size" | "petdev:step" | "petdev:cry" | "petdev:close" | "petdev:act";
export interface PetDeviceBridge {
  onShow: (cb: (view: PetDeviceView) => void) => void;
  size: (height: number) => void;
  step: (delta: -1 | 1) => void;
  cry: () => Promise<string | null>;
  close: () => void;
  act: (action: PetDeviceAction) => void;
}

// 상점 기기 창 — 관리 창이 정해 보내는 것(ShopDeviceOpen)에 메인이 붙은 쪽을 더한다 (src/main/shop-window.ts, Figma 05 `Shop / Device / Tool`)
// 구매도 이 창에서 한다(2026-10-01 사용자 결정 A안). 수량·구매 단추는 관리 창으로 돌아가 관리 창이 명령을 보낸다
export interface ShopDeviceOpen {
  productId: string;
  kind: string; // 머리 줄 첫 글자 — 도구 · 알 · 진화 · 파티 칸 · 포켓몬
  name: string;
  state: string; // 머리 줄 오른쪽 — "살 수 있음" · 살 수 없는 짧은 이유(돌보미집 가득 등)
  group: string;
  art: string | null; // 상품 그림 data URI. 없으면 빈 칸
  spec: [string, string][]; // 가격·보유 두 줄
  desc: string;
  rows: [string, string][]; // 효과·쓰는 곳
  qty: { count: number; cap: number; hint: string } | null; // 여러 개 살 수 있는 상품만. 살 수 없으면 cap 0 — 줄은 그대로 두고 단추만 막는다
  total: { lead: string; line: string; tone: "" | "ok" | "bad" }; // 합계 상자 — 산 직후는 초록 결과, 실패는 빨강
  buy: { label: string; disabled: boolean; busy: boolean };
}
export interface ShopDeviceView extends ShopDeviceOpen {
  side: "right" | "left";
}
// 기기 창에서 누른 단추 — productId 가 관리 창의 지금 상품과 다르면 버린다
export type ShopDeviceAction = { productId: string } & ({ kind: "qty"; qty: number } | { kind: "buy" });
export type ShopDeviceChannel = "shopdev:show" | "shopdev:size" | "shopdev:step" | "shopdev:close" | "shopdev:act";
export interface ShopDeviceBridge {
  onShow: (cb: (view: ShopDeviceView) => void) => void;
  size: (height: number) => void;
  step: (delta: -1 | 1) => void;
  close: () => void;
  act: (action: ShopDeviceAction) => void;
}

// 가방 기기 창 — 상점 기기 창과 같은 틀 (src/main/bag-window.ts, Figma 05 `Bag / Device / Use`, 2026-10-01 사용자 결정 C안).
// 도구는 파티 개체에게만 쓴다. 진화용 도구는 가방에서 쓰지 않는다(판매만). 단추는 관리 창으로 돌아가 관리 창이 명령을 보낸다
export interface BagDeviceOpen {
  itemId: string;
  kind: string; // 머리 줄 첫 글자 — 도구 · 진화
  name: string;
  state: string; // 머리 줄 오른쪽 — "보유 ×3"
  group: string;
  art: string | null;
  spec: [string, string][]; // 판매가·구매가
  desc: string;
  rows: [string, string][]; // 효과·쓰는 곳
  title: string; // 조작 칸 머리 — 사용 쪽은 지금 프리셋 이름, 판매 쪽은 "판매하기"
  pager: boolean; // 사용 쪽 파티 줄 양끝에 ◀ ▶ 를 둔다 — 프리셋이 둘 이상일 때. 누르면 앞·뒤 프리셋을 적용한다 (2026-10-02 사용자 결정)
  mode: "use" | "sell";
  modes: boolean; // 사용·판매 전환을 둔다 — 사용도 판매도 되는 도구만
  party: { petId: string; name: string; level: string; art: string | null; picked: boolean }[] | null; // 사용 쪽 파티 줄
  qty: { count: number; cap: number; hint: string } | null;
  preview: { lead: string; line: string; tone: "" | "ok" | "bad" };
  go: { label: string; disabled: boolean; busy: boolean }; // 바닥 가운데 주 단추 — `N개 사용` · `NP에 팔기`
}
export interface BagDeviceView extends BagDeviceOpen {
  side: "right" | "left";
}
export type BagDeviceAction = { itemId: string } & ({ kind: "mode"; mode: "use" | "sell" } | { kind: "target"; petId: string } | { kind: "qty"; qty: number } | { kind: "go" } | { kind: "preset"; delta: -1 | 1 });
export type BagDeviceChannel = "bagdev:show" | "bagdev:size" | "bagdev:step" | "bagdev:close" | "bagdev:act";
export interface BagDeviceBridge {
  onShow: (cb: (view: BagDeviceView) => void) => void;
  size: (height: number) => void;
  step: (delta: -1 | 1) => void;
  close: () => void;
  act: (action: BagDeviceAction) => void;
}

// 파티 기기 창 — 교체 화면. 박스 탭 옆에 붙어 지금 프리셋의 파티 칸과 프리셋 칩을 보인다
// (src/main/party-window.ts, Figma 05 `Party / Swap · Open` `1248:2567`, 2026-10-02 사용자 결정).
// 칸과 칩을 누르면 관리 창으로 돌아가 관리 창이 명령을 보낸다. 눌러서 들고 눌러서 놓는다 — 포켓몬 메뉴의 `옮기기` 와 같다
export interface PartyDeviceSlot {
  index: number;
  state: "pokemon" | "empty" | "locked";
  name: string; // 개체 이름. 개체가 없으면 빈 글자
  level: string; // "Lv.12". 개체가 없으면 빈 글자
  art: string | null; // 초상 data URI
  held: boolean; // 이 칸의 개체를 들었다 — 흐리게
  target: boolean; // 든 것을 놓을 수 있는 칸 — 옅은 바탕
}
export interface PartyDeviceOpen {
  name: string; // 프리셋 이름
  slots: PartyDeviceSlot[];
  presets: { index: number; owned: boolean; active: boolean }[]; // 늘 max 개. 사지 않은 프리셋은 자물쇠 칩
  notice: string; // 마지막 실패 문구. 머리 줄의 이름 옆 자리에 보인다 — 줄을 끼우지 않는다
}
export interface PartyDeviceView extends PartyDeviceOpen {
  side: "right" | "left";
}
export type PartyDeviceAction = { kind: "slot"; index: number } | { kind: "preset"; index: number };
export type PartyDeviceChannel = "partydev:show" | "partydev:size" | "partydev:step" | "partydev:close" | "partydev:act";
export interface PartyDeviceBridge {
  onShow: (cb: (view: PartyDeviceView) => void) => void;
  size: (height: number) => void;
  step: (delta: -1 | 1) => void;
  close: () => void;
  act: (action: PartyDeviceAction) => void;
}

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

// ── 놀이공간 화면 고르기 (2026-09-28 여러 화면) ────────────────────────────────
// 설정의 한 화면 목록 한 줄. ref 를 그대로 `playScreen` 설정 값으로 보낸다
export interface ScreenView {
  number: number; // 화면 번호 — 주 화면이 1 (src/main/layout.ts screenOrder)
  primary: boolean;
  w: number;
  h: number;
  current: boolean; // 한 화면 방식이 지금 쓰는 화면
  ref: { id: number; x: number; y: number; w: number; h: number };
}

// 화면 덮개 창 하나 — 번호를 크게 보인다. pick 이면 눌러서 고른다(Esc 취소), 아니면 클릭을 통과시키고 보기만 한다
export interface ScreenOverlayInit {
  number: number;
  primary: boolean;
  w: number;
  h: number;
  pick: boolean;
}

// screens:init 은 메인 → 렌더러, screens:pick·screens:cancel 은 렌더러 → 메인
export type ScreensChannel = "screens:init" | "screens:pick" | "screens:cancel";

export interface ScreensBridge {
  onInit: (cb: (init: ScreenOverlayInit) => void) => void;
  pick: () => void; // 이 화면을 골랐다
  cancel: () => void;
}

// 알림 배너 창 — 배너 하나의 문구와 `바로가기` 목적지. 문구는 src/notify/banner.ts 가 만든다
export type BannerKind = "hatch" | "evolve" | "achievement" | "notice" | "find"; // notice — 대상 그림 없이 안내 문구 두 줄 (src/agents/notice.ts). find — 줍기, 대상 그림 없이 문구 두 줄 (src/find/core.ts)

export interface BannerView {
  key: string;
  kind: BannerKind;
  title: string; // 부화 준비 완료 · 진화 가능 · 업적 달성 · 줍기
  target: string; // 돌보미집 알 N · <이름> Lv.N · 업적 이름 · <이름>이 <것>을 주웠어요
  go: string; // 바로가기
  route: ManageRoute;
  chime?: number; // 알림음 음량 0~1. 0 이면 소리를 내지 않는다 (src/state/settings.ts gainOf)
}

// banner:show 는 메인 → 렌더러, 나머지는 렌더러 → 메인
export type BannerChannel = "banner:show" | "banner:go" | "banner:close";

export interface BannerBridge {
  onShow: (cb: (banner: BannerView) => void) => void;
  go: (key: string) => void; // `바로가기` 를 눌렀다
  close: (key: string) => void; // 제목 줄 `✕` 를 눌렀다 — 그 배너를 닫고 다음 배너로 간다
}

// 앱이 그리는 메뉴 창 — Figma `Context Menu` `338:738`. 메인이 메뉴 모델을 이 모양으로 바꿔 보낸다
export type MenuView =
  | { kind: "separator" }
  | { kind: "status"; title: string; caption?: string } // 맨 위 이름·상태 두 줄 — 누를 수 없다
  | { kind: "item"; id: number; label: string; disabled: boolean; hint?: string; sub?: MenuSubView }; // hint 는 오른쪽의 짧은 글 — 체크 항목의 `켜짐`

// 항목 옆에 붙어 뜨는 말풍선 — 항목을 눌러도 메뉴는 닫히지 않는다 (포켓몬 메뉴의 `모습 바꾸기`, Figma 05 `501:14010`)
// 줄의 id 는 menu:pick 으로 돌려보내는 번호다. icon 은 그림의 data URI
export interface MenuSubView {
  title: string;
  rows: { id: number; label: string; note: string; current: boolean; icon?: string }[];
}

// menu:show·menu:side 는 메인 → 렌더러, 나머지는 렌더러 → 메인. menu:pick 이 null 이면 닫기만 한다
export type MenuChannel = "menu:show" | "menu:size" | "menu:pick" | "menu:side" | "menu:placed";

export interface MenuBridge {
  onShow: (cb: (items: MenuView[]) => void) => void;
  size: (w: number, h: number, sub?: { w: number; h: number; top: number }) => void; // 그린 뒤의 메뉴 크기 — 메인이 창 크기와 자리를 정한다. sub 는 말풍선의 크기와 메뉴 위 끝에서 잰 자리
  onSide: (cb: (side: "left" | "right") => void) => void; // 말풍선이 뜰 쪽 — 화면 오른쪽에 자리가 없으면 왼쪽
  placed: () => void; // 말풍선 자리를 잡았다 — 메인이 창을 보인다
  pick: (id: number | null) => void;
}

// 초상 요청 한 건 — 열쇠는 slug, 이로치면 `slug:shiny`
export interface PortraitAsk {
  slug: string;
  shiny: boolean;
}
