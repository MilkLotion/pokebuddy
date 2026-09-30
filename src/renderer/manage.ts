// 관리 창 — 스냅샷을 받아 그리고, 조작은 명령으로 보낸다. 게임 규칙은 하나도 여기 두지 않는다.
//
// 값은 메인이 이미 화면이 읽을 모양으로 바꿔서 준다 (src/tx/snapshot.ts, src/tx/lists.ts). 여기서는 배치와 글자만 만든다.
// 명령을 보내면 새 스냅샷을 다시 받아 그린다. 화면이 스스로 상태를 들고 있지 않는다.
// 도감과 CLI 연결은 스냅샷에 없다. 필요할 때만 따로 부르고 그다음부터는 들고 있는다.
// 모달은 하나만 뜬다. 어느 모달인지는 `dialog` 하나가 가진다 — 겹쳐 띄우지 않는다.
import type {
  AccountAction,
  AccountReply,
  AccountScreen,
  AchievementView,
  AgentRow,
  BagItemView,
  BoxView,
  CloudStatusView,
  DexEntry,
  EggView,
  EvoNodeView,
  EvoPairView,
  FormView,
  MailGiftView,
  MailLetterView,
  MailScreen,
  ManageReply,
  ManageRoute,
  PatchNotesView,
  PetDeviceAction,
  PetView,
  PortraitAsk,
  ScreenView,
  ShopDetail,
  ShopItemView,
  SlotView,
  Snapshot,
  TradeCardView,
  TradeScreen,
  UpdateView,
} from "../shared/manage.js";
import { genderIcon } from "./gender.js";

type TabId = "party" | "box" | "dex" | "shop" | "bag";

const TABS: { id: TabId; label: string }[] = [
  { id: "party", label: "파티" },
  { id: "box", label: "박스" },
  { id: "dex", label: "도감" },
  { id: "shop", label: "상점" },
  { id: "bag", label: "가방" },
];
// 친구 교환은 탭이 아니다 — 박스 머리의 `교환` 단추가 모달로 연다
// (2026-09-30 사용자 결정 "교환 버튼을 만들고, 모달로 기존의 교환 창 띄우게." worklog/records/features-0930/record.md 7)

// 만복도 구간 → 화면 낱말. 계약의 구간 이름과 1:1 이다
const ZONE_WORD: Record<string, string> = { full: "배부름", normal: "보통", hungry: "배고픔", starving: "매우 배고픔" };
// 만복도 구간별 디버프 — 파티 칸의 상태 배지 (Figma `Party Slot Card` 의 debuff 자리)
const DEBUFF: Record<string, { label: string; tone: "warning" | "danger"; note: string }> = {
  hungry: { label: "배고픔", tone: "warning", note: "친밀도 증가량 −30%" },
  starving: { label: "매우 배고픔", tone: "danger", note: "친밀도 증가량 −60%" },
};

// 상점 분류 — `전체` 는 두지 않는다. 처음 여는 탭은 첫 탭 `알` (2026-09-29 사용자 결정 "상점에 전체는 없애")
const SHOP_TABS = [
  { id: "egg", label: "알" },
  // 포켓몬 탭은 잠시 숨긴다 (2026-09-30 사용자 결정 "상점의 포켓몬 탭을 지금은 없애놔"). 다시 열려면 { id: "pokemon", label: "포켓몬" } 를 이 자리에 되돌린다
  { id: "tool", label: "도구" },
  { id: "evolution", label: "진화" },
  { id: "slot", label: "파티 칸" },
];

const DEX_TABS = [
  { id: "all", label: "전체" },
  { id: "obtained", label: "획득" },
  { id: "unlocked", label: "해금" },
  { id: "locked", label: "미해금" },
];

// 잠들기 기준 — 0 은 잠들지 않음. 값은 src/state/settings.ts 의 허용 목록과 같다
const SLEEP_CHOICES = [
  { id: "3", label: "3분" },
  { id: "5", label: "5분" },
  { id: "10", label: "10분" },
  { id: "15", label: "15분" },
  { id: "0", label: "잠들지 않음" },
];


// 여러 개 살 수 있는 상품 — 포켓몬·파티 칸은 하나씩만 산다. 알은 돌보미집 빈 칸까지 (2026-09-30 사용자 결정 "알 여러개 구매 가능하게 수정.")
const MULTI_BUY = new Set(["tool", "evolution", "egg"]);

// 성격을 골라야 하는 도구 — 고르는 화면이 아직 없어 여기서 막는다

// 가이드북 — 구성은 docs/specs/game.md "튜토리얼과 가이드북" 의 다섯 주제다.
// 숫자는 적지 않는다. 밸런스 값이 바뀌어도 이 문구가 어긋나지 않게 한다
const GUIDE: { title: string; lines: string[] }[] = [
  {
    title: "돌봄",
    lines: [
      "밥을 주면 만복도가 오른다. 쿨타임이 지나야 다시 줄 수 있다.",
      "놀아주면 친밀도가 오른다. 쿨타임이 지난 뒤 남은 시간 안에 이어서 놀아주면 중첩이 오른다.",
      "두 번 이어서 놀아주면 들뜸, 세 번이면 신남이 되고 친밀도 증가량이 늘어난다.",
      "프리미엄먹이를 먹으면 든든함이 되고 친밀도 증가량이 늘어난다.",
      "PC 잠금·절전·앱 종료 중에는 시간이 흐르지 않는다.",
    ],
  },
  {
    title: "상점과 알",
    lines: [
      "포인트로 알, 포켓몬, 도구, 진화용 도구, 파티 칸을 산다.",
      "산 알은 돌보미집으로 간다. 5분이 지나면 열 수 있다.",
      "준비를 마친 알을 열면 개체가 나온다. 파티가 차 있으면 박스로 간다.",
    ],
  },
  {
    title: "파티와 박스",
    lines: [
      "파티 칸은 처음부터 다 열려 있지 않다. 상점과 업적으로 연다.",
      "파티에 있는 개체만 시간이 흐른다. 박스에 둔 개체는 멈춘다.",
      "꺼낸 개체만 바탕화면에 보인다. 숨겨도 포인트와 친밀도는 쌓인다.",
    ],
  },
  {
    title: "진화",
    lines: [
      "조건을 채운 개체는 상세에서 직접 진화시킨다. 저절로 진화하지 않는다.",
      "조건은 종마다 다르다. 레벨, 친밀도, 도구, 시간대를 본다.",
      "진화해도 같은 개체다. 이로치와 성격은 그대로 남는다.",
    ],
  },
  {
    title: "업적",
    lines: [
      "달성한 업적은 나중에 상태가 바뀌어도 사라지지 않는다.",
      "보상은 업적창에서 직접 받는다.",
      "받지 않은 보상이 있으면 탭 줄 오른쪽의 업적창 아이콘에 점이 뜬다.",
    ],
  },
];

function need<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) throw new Error(`manage.html 에 #${id} 가 없다`);
  return el;
}

const pointsEl = need("points", HTMLElement);
const tabsEl = need("tabs", HTMLElement);
const bodyEl = need("body", HTMLElement);
const scrimEl = need("scrim", HTMLElement);
const dialogEl = need("dialog", HTMLElement);
const achDotEl = need("achievements-dot", HTMLElement);

// 모달 하나. 어느 것인지와 그 모달만 쓰는 값을 함께 담는다
type Dialog =
  | { kind: "pet"; petId: string }
  | { kind: "evolve"; petId: string; to?: string; itemId?: string } // 진화 확인 — to 는 고른 후보, itemId 는 가방의 돌로 왔을 때
  | { kind: "evo-target"; itemId: string } // 가방의 진화용 도구 — 진화할 개체를 고른다
  | { kind: "nature"; petId: string; pick?: string; itemId?: string } // 성격 변경 — pick 은 고른 성격, itemId 는 가방의 민트로 왔을 때
  | { kind: "nature-target"; itemId: string } // 가방의 민트 — 성격을 바꿀 개체를 고른다
  | { kind: "buy"; productId: string; qty: number }
  | { kind: "pick-box"; slotIndex: number } // 칸이 정해졌고 넣을 박스 개체를 고른다
  | { kind: "pick-slot"; petId: string } // 개체가 정해졌고 넣을 파티 칸을 고른다
  | { kind: "achievements" }
  | { kind: "settings"; tab: SettingsTab }
  | { kind: "user"; tab: UserTab } // 사용자 — 계정·연결 (헤더 유저 아이콘)
  | { kind: "guide" }
  | { kind: "keep"; petId: string } // 박스에 보관 확인 — 파티 상세 기기 창의 `박스에 보관`
  | { kind: "hatched"; petId?: string; slotIndex?: number; eggId?: string } // 부화 결과 — 태어난 개체 또는 포켓몬 대신 나온 알
  | { kind: "form"; petId: string; to: string } // 공유 sid 계열의 모습 바꾸기 확인
  | { kind: "notes"; pick?: string } // 패치노트 — 설정 바닥의 `패치노트`. pick 은 왼쪽 목록에서 고른 버전
  | { kind: "notes-new"; version: string } // 업데이트 뒤 처음 켤 때 한 번 — 그 버전만
  | { kind: "mail" } // 우편함 — 헤더 봉투 단추
  | { kind: "letter"; id: string } // 우편함의 편지 한 통
  | { kind: "trade" }; // 친구 교환 — 박스 머리의 `교환` 단추

let tab: TabId = "party";
let view: Snapshot | null = null;
let detailPet: string | null = null; // 개체 상세 페이지에 띄운 개체 — 있으면 탭 본문 대신 상세를 그린다
let dexRows: DexEntry[] | null = null;
// 도감에서 고른 칸 — 상세는 관리 창 옆 도감 기기 창이 보인다 (src/main/dex-window.ts)
let dexPick: string | null = null;
let dexGen = 0; // 도감 기기 창 세대 번호 — 메인이 닫힘 알림에 실어 준 마지막 번호. 여는 요청에 싣는다 (src/main/device-gen.ts)
let agentRows: AgentRow[] | null = null;
let agentPlatform = ""; // 연결 탭의 Windows 안내를 가른다 — 에이전트 응답이 싣는다
let boxPage = 0;
// 검색어 — 탭을 옮겨도 남는다 (docs/specs/game.md "검색과 선택을 유지한다")
let boxQuery = "";
let dexQuery = "";
let pickQuery = "";
let boxMarked: string | null = null; // 박스 검색 결과로 찾아간 개체 — 그 칸을 고른 칸으로 보인다
// 박스 정렬·이동·이름 (Figma 05 `Box / Sort Open` `633:17372` · `Box / Dragging` `633:17375` · `Box / Rename` `633:17378`)
let boxSortOpen = false;
let boxRenaming = false;
let boxNote = ""; // 박스 명령이 실패했을 때 박스 줄 아래 한 줄
let dragFrom: { boxId: string; slot: number } | null = null; // 끄는 중인 칸 — 끄는 동안 주기적 새로 그리기를 쉰다
const BOX_SORTS: readonly { by: string; label: string }[] = [
  { by: "dex", label: "도감 번호" },
  { by: "level", label: "레벨 높은 순" },
  { by: "affinity", label: "친밀도 높은 순" },
  { by: "recent", label: "최근 얻은 순" },
  { by: "name", label: "이름순" },
];
const BOX_NAME_MAX = 10; // src/box/slots.ts BOX_RULES.nameMax 와 같다
// 박스마다 마지막으로 적용한 정렬 기준 — 단추와 목록에 보인다. 그 박스의 칸을 옮기면 순서가 흐트러지므로 지운다.
// 저장하지 않는다 — 관리 창을 다시 열면 "정렬" 로 돌아간다
const boxSortedBy = new Map<string, string>();
// 다시 그린 뒤 되돌릴 검색 칸 — 입력 중에 화면을 새로 그려도 포커스와 커서가 남게
let searchFocus: { key: string; caret: number } | null = null;
let shopFilter = "egg";
// 상점 포켓몬 격자 — 도감과 같은 지방·검색 (2026-09-29 사용자 결정 "도감처럼 격자 칸")
let shopQuery = "";
let shopRegion = "all";
let shopRegionOpen = false;
// 도감·상점 포켓몬 격자의 쪽 — 한 쪽에 GRID_PAGE 칸. 지방·검색·분류가 바뀌면 첫 쪽으로 (2026-09-29 사용자 결정 "페이지 넘김 추가")
// 5열 × 3줄 — 기본 창 높이(682)에서 스크롤 없이 들어간다
const GRID_PAGE = 15;
let dexPageNo = 0;
let shopPageNo = 0;
// 보는 방식 — 쪽(grid)과 스크롤(list). 도감과 상점 포켓몬 탭이 따로 기억한다 (2026-09-29 사용자 결정)
//   grid  한 쪽 15칸 격자와 ◀ ▶ 넘김
//   list  오늘 작업 전(9662a46) 화면 그대로 — 도감은 칸 격자 전부, 상점은 상품 줄 카드 전부를 세로 스크롤로
//         (2026-09-29 사용자 결정 "리스트형태는 작업하기 이전의 그 스크롤되는거로")
// 게임 저장이 아니라 이 컴퓨터의 화면 선호다 — 관리 창의 localStorage 에 둔다. 앱 데이터 폴더(userData)에 남아 다시 켜도 유지된다.
// 저장 위치와 기본값(격자)은 제안이다 (worklog view-mode 기록)
type ViewMode = "grid" | "list";
const VIEW_KEY = { dex: "pokebuddy.view.dex", shop: "pokebuddy.view.shop" } as const;
function loadView(where: keyof typeof VIEW_KEY): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY[where]) === "list" ? "list" : "grid";
  } catch {
    return "grid"; // 읽지 못하면 기본값
  }
}
function saveView(where: keyof typeof VIEW_KEY, mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_KEY[where], mode);
  } catch {
    // 저장하지 못해도 이번 실행에는 고른 방식을 쓴다
  }
}
let dexView: ViewMode = loadView("dex");
let shopView: ViewMode = loadView("shop");
// 스크롤 방식은 쪽 넘김 없이 전부 보인다. 쪽 방식만 한 쪽 GRID_PAGE 칸이다.
// 방식을 바꾼 직후 스크롤할 항목 — 쪽 방식에서 보던 첫 항목 (drawDex·drawShop 이 스크롤 방식을 그린 뒤 한 번 쓴다)
let listScrollTo: { where: "dex" | "shop"; index: number } | null = null;
let dexFilter = "all";
// 도감 지방 — 최초 등장 지방 기준의 전국도감 번호 구간 (Figma 05 `Dex / Base` `381:6028` 의 "지방: 전체 ▾").
// 리전폼 항목(알로라 라이츄 등)은 번호가 아니라 항목의 지방(region)으로 나눈다(스펙) — inDexRegion
let dexRegion = "all";
let dexRegionOpen = false;
const DEX_REGIONS: readonly { id: string; label: string; from: number; to: number }[] = [
  { id: "all", label: "전체", from: 1, to: Number.MAX_SAFE_INTEGER },
  { id: "kanto", label: "관동", from: 1, to: 151 },
  { id: "johto", label: "성도", from: 152, to: 251 },
  { id: "hoenn", label: "호연", from: 252, to: 386 },
  { id: "sinnoh", label: "신오", from: 387, to: 493 },
  { id: "unova", label: "하나", from: 494, to: 649 },
  { id: "kalos", label: "칼로스", from: 650, to: 721 },
  { id: "alola", label: "알로라", from: 722, to: 809 },
  { id: "galar", label: "가라르", from: 810, to: 898 },
  { id: "hisui", label: "히스이", from: 899, to: 905 }, // 최초 등장 지방 기준 (docs/specs/game.md "전체 도감과 지방") — 레전드 아르세우스에서 처음 나온 종
  { id: "paldea", label: "팔데아", from: 906, to: 1025 },
];
// 지방 하나에 드는 항목인가 — 리전폼은 자기 지방, 나머지는 번호 구간
function inDexRegion(regionId: string, dex: number, formRegion?: string): boolean {
  const region = DEX_REGIONS.find((r) => r.id === regionId) ?? DEX_REGIONS[0];
  if (!region || region.id === "all") return true;
  if (formRegion) return formRegion === region.id;
  return dex >= region.from && dex <= region.to;
}

// 도감 표시 번호 — `#0026`, 리전폼이면 `#0026-1` (src/dex/regional.ts dexLabel 과 같은 모양)
const dexNoText = (dex: number, form: number | undefined, pad: number): string => `${String(dex).padStart(pad, "0")}${form ? `-${form}` : ""}`;

let dialog: Dialog | null = null;
let notice = ""; // 마지막 실패 문구. 모달을 다시 그려도 남는다

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

// 남은 시간 — 1분 미만은 초, 1시간 미만은 분(올림), 그 위는 시간과 분. 쿨타임·알 준비가 10분·몇 시간이라 초로 쓰면 읽기 어렵다
function waitWord(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return `${s}초`;
  const min = Math.ceil(s / 60);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

// 버프 배지 — 이름과 남은 시간. 1시간 미만은 분(0분이면 1분), 그 위는 시간(올림). 파티 칸 오른쪽 위 한 줄 폭에 맞춘 짧은 꼴이다.
// 기기 창(src/renderer/pet.ts buffBadge)과 같은 규칙 (2026-09-30 사용자 결정 "추천대로 진행해")
const buffBadge = (b: PetView["buffs"][number]): string =>
  `${b.name} ${b.remainMin < 60 ? `${Math.max(1, b.remainMin)}분` : `${Math.ceil(b.remainMin / 60)}시간`}`;

const button = (cls: string, text?: string): HTMLButtonElement => {
  const b = el("button", cls || undefined, text);
  b.type = "button";
  return b;
};

// 경고·안내 배너 — Figma 02 Molecules `Alert` `1040:279`
// - tone: bad 오류 · warn 주의 · ok 완료 · info 안내. 바탕 톤과 아이콘으로 가른다
// - 제목이 있으면 Banner(제목 + 설명), 빈 제목이면 Inline 한 줄(폼·대화상자의 짧은 실패)
// - onClose 가 있을 때만 오른쪽 ✕
type AlertTone = "bad" | "warn" | "ok" | "info";
function alertBox(tone: AlertTone, title: string, desc = "", onClose?: () => void): HTMLElement {
  const box = el("div", `alert ${tone}${title ? "" : " inline"}`);
  const text = el("div", "alert-text");
  if (title) text.appendChild(el("strong", undefined, title));
  if (desc) text.appendChild(el("span", undefined, desc));
  box.append(el("i", "alert-icon"), text);
  if (onClose) {
    const x = button("dialog-close", "✕");
    x.setAttribute("aria-label", "닫기");
    x.addEventListener("click", onClose);
    box.appendChild(x);
  }
  return box;
}

const point =(n: number): string => `${n.toLocaleString("ko-KR")}P`;

// 값 막대 하나 — 이름, 현재/최대, 채움
// live — 시간으로만 바뀌는 값이면 그 개체와 필드. 1초 시계가 이 막대만 고친다 (applyLive)
function meter(label: string, value: number, zone?: string, live?: { pet: string; field: "affinity" | "fullness" }): HTMLElement {
  const box = el("div", "meter");
  if (live) {
    box.dataset.livePet = live.pet;
    box.dataset.liveField = live.field;
  }
  const row = el("div", "row");
  row.append(el("span", undefined, label), el("span", undefined, `${value}/100`));
  const track = el("div", "track");
  const fill = el("div", zone && zone !== "full" && zone !== "normal" ? `fill ${zone}` : "fill");
  fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
  track.appendChild(fill);
  box.append(row, track);
  return box;
}

// 거르개 칩 한 줄 — 도감·상점·설정이 같은 모양을 쓴다
function chips(items: { id: string; label: string }[], current: string, pick: (id: string) => void): HTMLElement {
  const row = el("div", "chips");
  for (const it of items) {
    const b = button("chip", it.label);
    b.setAttribute("aria-pressed", String(it.id === current));
    b.addEventListener("click", () => pick(it.id));
    row.appendChild(b);
  }
  return row;
}

// 부제가 없으면 부제 줄을 그리지 않는다
function head(title: string, sub?: string): HTMLElement {
  const box = el("div", "head");
  box.appendChild(el("h1", undefined, title));
  if (sub) box.appendChild(el("div", "sub", sub));
  return box;
}

// ── 초상 ───────────────────────────────────────────────────────────────────────
// 초상을 메인에서 data URI 로 받아 원 안에 채운다 (src/main/portraits.ts). 받기 전·못 받으면 빈 원 그대로다.
// 창을 열 때 디스크에 있는 그림 전부를 먼저 받는다(loadArt). 그래서 상점·상세에 들어가자마자 그림이 모두 보인다.
// 디스크에 없는 그림만 칸을 그린 뒤 청한다. 도감은 1000 칸이 넘어 보이는 칸만 청한다(lazy).
// 보이는 칸은 그린 뒤와 스크롤할 때 위치를 재서 고른다 — IntersectionObserver 는 창이 가려져 있으면 반응하지 않았다.
// 받은 것은 창이 떠 있는 동안 기억한다

const portraitCache = new Map<string, string | null>();
const portraitWant = new Map<string, PortraitAsk>();
let portraitTimer: ReturnType<typeof setTimeout> | null = null;

function paintPortrait(host: HTMLElement, uri: string, cls = "art"): void {
  if (host.classList.contains("has-art")) return;
  for (const n of [...host.childNodes]) if (n.nodeType === Node.TEXT_NODE) n.remove(); // "이로치" 같은 자리 글자는 그림이 대신한다
  const img = document.createElement("img");
  img.className = cls;
  img.alt = "";
  img.decoding = "sync"; // 칸과 그림이 한 프레임에 같이 보이게 한다
  img.src = uri;
  host.prepend(img);
  host.classList.add("has-art");
}

function askPortraits(): void {
  if (portraitTimer) return;
  portraitTimer = setTimeout(() => {
    portraitTimer = null;
    const asks = [...portraitWant.values()];
    portraitWant.clear();
    if (!asks.length) return;
    void window.pokebuddyManage.portraits(asks).then((got) => {
      for (const [key, uri] of Object.entries(got)) portraitCache.set(key, uri);
      for (const host of document.querySelectorAll<HTMLElement>("[data-portrait]")) {
        const uri = portraitCache.get(host.dataset.portrait ?? "");
        if (uri) paintPortrait(host, uri);
      }
    });
  }, 30);
}

function wantPortrait(key: string): void {
  if (portraitCache.has(key)) return;
  const [slug = "", shiny] = key.split(":");
  portraitWant.set(key, { slug, shiny: shiny === "shiny" });
  askPortraits();
}

// 화면에 들어온 lazy 칸을 청한다. 위아래로 한 화면씩 미리 받는다
let lazyTimer: ReturnType<typeof setTimeout> | null = null;
function askVisiblePortraits(): void {
  if (lazyTimer) return;
  lazyTimer = setTimeout(() => {
    lazyTimer = null;
    const view = window.innerHeight;
    for (const host of document.querySelectorAll<HTMLElement>("[data-portrait-lazy]")) {
      const r = host.getBoundingClientRect();
      if (r.bottom < -view || r.top > view * 2) continue;
      host.removeAttribute("data-portrait-lazy");
      wantPortrait(host.dataset.portrait ?? "");
    }
  }, 60);
}
document.addEventListener("scroll", askVisiblePortraits, true); // 스크롤은 거품이 없어 잡는 단계에서 받는다

// 초상 자리 하나 — cls 는 크기(portrait 80 · dot 26 등)를 정하는 기존 클래스다. lazy 면 보일 때 청한다
function portraitOf(slug: string, shiny: boolean, cls: string, text = "", lazy = false): HTMLElement {
  const host = el("div", cls, text);
  const key = shiny ? `${slug}:shiny` : slug;
  host.dataset.portrait = key;
  const uri = portraitCache.get(key);
  if (uri) paintPortrait(host, uri);
  else if (uri === undefined) {
    if (lazy) {
      host.dataset.portraitLazy = "";
      askVisiblePortraits();
    } else wantPortrait(key);
  }
  return host;
}

// 도구·알 그림 — PokeAPI 에 그림이 있는 것만 채운다(이상한사탕·진화의 돌·알). 없으면 Figma 처럼 빈 칸이다
const iconCache = new Map<string, string | null>();
const iconWant = new Set<string>();
let iconTimer: ReturnType<typeof setTimeout> | null = null;

function iconOf(key: string | null, cls: string): HTMLElement {
  const host = el("div", cls);
  if (!key) return host;
  host.dataset.icon = key;
  const uri = iconCache.get(key);
  if (uri) paintPortrait(host, uri, "icon-art");
  else if (uri === undefined) {
    iconWant.add(key);
    iconTimer ??= setTimeout(() => {
      iconTimer = null;
      const keys = [...iconWant];
      iconWant.clear();
      void window.pokebuddyManage.icons(keys).then((got) => {
        for (const [k, u] of Object.entries(got)) iconCache.set(k, u);
        for (const h of document.querySelectorAll<HTMLElement>("[data-icon]")) {
          const u = iconCache.get(h.dataset.icon ?? "");
          if (u) paintPortrait(h, u, "icon-art");
        }
      });
    }, 30);
  }
  return host;
}

// 알 그림 — 알 종류에 색표가 있으면 원작 알 그림의 색을 바꿔 쓴다 (data/eggs.json palette).
// 원작 그림을 저장소에 넣지 않으려고 실행 때 받은 그림을 캔버스로 바꾼다. 원작 9색과 RGB 가 정확히 같은 칸만 바꾼다
const EGG_SOURCE = ["#5a5241", "#ffffff", "#cdbd83", "#181818", "#fff6de", "#9ccd83", "#cde6b4", "#e6deb4", "#83b46a"];
const eggTinted = new Map<string, string | null>(); // 알 종류 → 색을 바꾼 data URI (null 이면 만드는 중)

function eggIcon(kind: string, cls: string): HTMLElement {
  if (kind === "ancient-stone") return iconOf("item:ancient-stone", cls); // 태고의돌은 알이 아니라 돌 — 우리가 그린 그림 (assets/items)
  const palette = view?.eggPalettes[kind];
  if (!palette || palette.length !== EGG_SOURCE.length) return iconOf("egg", cls);
  const host = el("div", cls);
  host.dataset.eggKind = kind;
  const done = eggTinted.get(kind);
  if (done) paintPortrait(host, done, "icon-art");
  else if (done === undefined) void tintEgg(kind, palette);
  return host;
}

async function tintEgg(kind: string, palette: string[]): Promise<void> {
  eggTinted.set(kind, null);
  const base = iconCache.get("egg") ?? (await window.pokebuddyManage.icons(["egg"]))["egg"];
  if (!base) {
    eggTinted.delete(kind); // 그림을 아직 못 받았다 — 다음에 다시 만든다
    return;
  }
  const img = new Image();
  img.src = base;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, canvas.width, canvas.height);
  const hex = (n: number): string => n.toString(16).padStart(2, "0");
  const swap = new Map(EGG_SOURCE.map((c, i) => [c, palette[i] ?? c]));
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const to = swap.get(`#${hex(d[i] ?? 0)}${hex(d[i + 1] ?? 0)}${hex(d[i + 2] ?? 0)}`);
    if (!to) continue;
    d[i] = parseInt(to.slice(1, 3), 16);
    d[i + 1] = parseInt(to.slice(3, 5), 16);
    d[i + 2] = parseInt(to.slice(5, 7), 16);
  }
  g.putImageData(data, 0, 0);
  const uri = canvas.toDataURL("image/png");
  eggTinted.set(kind, uri);
  for (const host of document.querySelectorAll<HTMLElement>(`[data-egg-kind="${CSS.escape(kind)}"]`)) paintPortrait(host, uri, "icon-art");
}

// ── 파티 ───────────────────────────────────────────────────────────────────────

// 타입 배지 — Figma `Type Badge` `118:134`. 색은 manage.html 의 `.type[data-type]` 이 타입 키로 고른다
function typeBadge(name: string, id: string | undefined): HTMLElement {
  const badge = el("span", "type", name);
  if (id) badge.dataset.type = id;
  return badge;
}

function petCard(pet: PetView): HTMLElement {
  const card = button("slot");

  const portrait = portraitOf(pet.species, pet.shiny, "portrait", pet.shiny ? "이로치" : "");
  if (pet.hidden) {
    const mark = el("span", "mark");
    mark.title = "숨긴 상태";
    portrait.appendChild(mark);
  }
  card.appendChild(portrait);

  // 레벨 · 이름 · 성별 · 성격을 한 줄에 — Figma `Party Slot Card` 123:149 의 `identity-copy`. 다음 레벨까지는 칸의 title 로 옮겼다
  // 성격은 타입 줄에서 이름 옆으로 옮겼다 (2026-09-30 사용자 결정 "성격은 … 이름 옆에")
  const info = el("div", "info");
  const top = el("div", "top");
  top.append(el("span", undefined, `Lv.${pet.level}`), el("div", "name", pet.name));
  const sex = genderIcon(pet.gender, 16);
  if (sex) top.appendChild(sex);
  top.appendChild(el("span", "nature", pet.nature));
  info.appendChild(top);

  const tags = el("div", "tags");
  pet.types.forEach((name, i) => tags.appendChild(typeBadge(name, pet.typeIds[i])));
  info.appendChild(tags);

  const meters = el("div", "meters");
  meters.append(meter("친밀도", pet.affinity, undefined, { pet: pet.id, field: "affinity" }), meter("만복도", pet.fullness, pet.zone, { pet: pet.id, field: "fullness" }));
  info.appendChild(meters);

  card.appendChild(info);
  // 상태 배지 — 디버프(배고픔 −30%, 매우 배고픔 −60%, docs/specs/balance.md) 뒤에 켜진 버프(든든함·신남·들뜸).
  // 버프도 배고픔처럼 칸 오른쪽 위에 둔다 (2026-09-30 사용자 결정 "들뜸, 신남 도 배고픔처럼"). 하나도 없으면 두지 않는다
  const badges: HTMLElement[] = [];
  const debuff = DEBUFF[pet.zone];
  if (debuff) {
    const badge = el("span", `debuff ${debuff.tone}`, debuff.label);
    badge.title = debuff.note;
    badges.push(badge);
  }
  for (const buff of pet.buffs ?? []) {
    const badge = el("span", "debuff success", buffBadge(buff));
    badge.dataset.liveBuff = `${pet.id}|${buff.kind}`; // 남은 분은 1초 시계가 고친다 (applyLive)
    badges.push(badge);
  }
  if (badges.length) {
    const box = el("div", "debuffs");
    box.append(...badges);
    card.appendChild(box);
  }
  card.dataset.pet = pet.id; // 진화 튜토리얼이 이 카드를 찾는다
  card.addEventListener("click", () => openPet(pet.id));
  if (pet.id === detailPet) card.classList.add("selected"); // 옆 기기 창에 떠 있는 개체 — 옅은 배경만 (강조 테두리 없음)
  const state = `${ZONE_WORD[pet.zone] ?? pet.zone} · 다음 레벨까지 ${pet.percentToNext}%`;
  if (pet.forms && pet.forms.length > 1) {
    // 공유 sid 계열 — 마우스를 올리면 박스와 같은 모습 툴팁. 두 툴팁이 겹치지 않게 title 대신 툴팁 머리 줄에 상태를 적는다
    // (Figma `Party / Shared Form Tip` `501:14010`, 2026-09-26 사용자 결정 "제안대로 진행")
    card.addEventListener("mouseenter", () => showFormTip(card, pet, `${pet.name} · ${state}`));
    card.addEventListener("mouseleave", () => hideFormTipSoon());
  } else {
    card.title = `${pet.name} · ${state}`;
  }
  return card;
}

// 빈 칸·잠긴 칸 그림 — Figma `Party Slot` state/empty·state/locked 의 +·자물쇠
function blankIcon(locked: boolean): HTMLElement {
  const box = el("span", "blank-icon");
  box.innerHTML = locked
    ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12 6.86H4c-.63 0-1.14.51-1.14 1.14v5.14c0 .63.51 1.15 1.14 1.15h8c.63 0 1.14-.52 1.14-1.15V8c0-.63-.51-1.14-1.14-1.14Z"/><path d="M5.14 6.86V5.14a2.86 2.86 0 0 1 5.72 0v1.72"/></svg>'
    : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.64v8.72M3.64 8h8.72"/></svg>';
  return box;
}

function blankCard(slot: SlotView): HTMLElement {
  const card = button("slot blank");
  if (slot.state === "locked") {
    card.classList.add("locked");
    card.disabled = true;
    card.append(blankIcon(true), el("strong", undefined, "잠긴 칸"));
    return card;
  }
  // 문구는 Figma `Party Slot` state/empty 의 "박스에서 배치"
  card.append(blankIcon(false), el("strong", undefined, "빈 칸"), el("small", undefined, "박스에서 배치"));
  card.addEventListener("click", () => open({ kind: "pick-box", slotIndex: slot.index }));
  return card;
}

function drawParty(v: Snapshot): void {
  bodyEl.appendChild(head("파티", `${v.party.shown}마리 표시 중 · ${v.party.usable} / ${v.party.slots.length}칸 사용 가능`));
  const grid = el("div", "grid");
  for (const slot of v.party.slots) grid.appendChild(slot.pet ? petCard(slot.pet) : blankCard(slot));
  bodyEl.appendChild(grid);
}

// ── 박스 ───────────────────────────────────────────────────────────────────────

const eggNote = (egg: EggView): string => (egg.ready ? "준비 완료" : `${egg.percent}% · ${waitWord(egg.remainSec)}`);

function eggCard(egg: EggView): HTMLElement {
  const card = el("div", "egg");
  card.appendChild(eggIcon(egg.kind, "shell"));
  card.appendChild(el("div", undefined, egg.name));
  const note = el("div", "note", eggNote(egg));
  note.dataset.liveEgg = egg.id; // 1초 시계가 이 글자만 고친다 (applyLive)
  card.appendChild(note);
  if (egg.ready) {
    const row = el("div", "acts");
    const openEgg = button("primary", "열기");
    openEgg.addEventListener("click", () => void openEggAndShow(egg.id));
    row.appendChild(openEgg);
    card.appendChild(row);
  }
  return card;
}

// 알 열기 — 끝나면 부화 결과 창을 연다 (docs/specs/game.md "부화 결과 창은 태어난 개체와 들어간 자리를 보여주고 `확인`만 둔다")
async function openEggAndShow(eggId: string): Promise<void> {
  if (!(await send("egg.open", eggId))) return;
  const r = lastReply;
  if (!r) return;
  const egg = r.egg as { id?: unknown } | undefined;
  if (egg && typeof egg.id === "string") open({ kind: "hatched", eggId: egg.id });
  else if (typeof r.petId === "string") open({ kind: "hatched", petId: r.petId, ...(typeof r.slotIndex === "number" ? { slotIndex: r.slotIndex } : {}) });
}

// 부화 결과 — Figma `Box / Hatch Result` `389:9488`. 태어난 개체는 종·타입·레벨·성격과 들어간 자리.
// 랜덤알에서 단일 포켓몬 알이 나오면 같은 창으로 그 알을 알린다 (docs/specs/game.md 단일 포켓몬 알)
function drawHatched(petId?: string, slotIndex?: number, eggId?: string): void {
  const card = el("div", "nat-card");
  const info = el("div", "info-box");
  if (eggId) {
    const egg = view?.eggs.list.find((e) => e.id === eggId);
    dialogEl.append(...dialogHead("알에서 새 알이 나왔어요", ""));
    card.append(eggIcon(egg?.kind ?? "random", "portrait"), el("div", "name", egg?.name ?? "알"));
    info.append(el("div", undefined, "돌보미집에 들어갔어요."), el("div", "note", "아직 얻지 않은 포켓몬이 나와요."));
  } else {
    const pet = petId ? petOf(petId) : undefined;
    if (!pet) {
      close();
      return;
    }
    dialogEl.append(...dialogHead("알이 부화했어요", ""));
    const tags = el("div", "tags");
    pet.types.forEach((name, i) => tags.appendChild(typeBadge(name, pet.typeIds[i])));
    tags.appendChild(el("span", "note", `Lv.${pet.level} · ${pet.nature}`));
    card.append(portraitOf(pet.species, pet.shiny, "portrait", pet.shiny ? "이로치" : ""), el("div", "name", pet.shiny ? `${pet.name} · 이로치` : pet.name), tags);
    if (slotIndex != null) info.append(el("div", undefined, `파티 ${slotIndex + 1}번 칸에 들어갔어요.`));
    else info.append(el("div", undefined, "파티가 가득 차 박스에 보관했어요."));
  }
  const row = el("div", "compare");
  row.appendChild(card);
  dialogEl.append(row, info, actions(el("div", "spacer"), actionButton("확인", true, false, close))); // Figma 처럼 오른쪽
}

// ── 검색 ───────────────────────────────────────────────────────────────────────
// 검색 칸은 입력 중에 결과를 바꾸지 않는다. Enter 나 `검색` 단추를 누를 때 그 값으로 한 번 거른다 (2026-09-29 사용자 결정)
//   한글 조합을 확정하는 Enter(isComposing)는 검색하지 않는다 — 조합 확정에만 쓴다
//   지우기(×)로 칸을 비우면 바로 전체로 돌린다 — 빈 칸은 걸러 볼 것이 없다
// 입력 중인 글자는 초안(searchDraft)으로 들고 있다 — 검색 전에 다른 일로 다시 그려도 사라지지 않는다.
// 검색 칸에 입력하는 동안 들어온 다시 그리기는 미뤘다가 칸을 떠날 때 그린다 — 칸을 갈아 끼우면 한글 조합이 끊긴다
// (2026-09-29 사용자 "어래곤 검색했는데 … 어곤 이렇게 래 씹힌다")
const searchDraft = new Map<string, string>();
let searchSubmitting = false; // 검색을 누른 그 다시 그리기는 미루지 않는다
let bodyHeld = false; // 입력 중이라 미룬 본문 다시 그리기
let dialogHeld = false; // 입력 중이라 미룬 대화상자 다시 그리기

// 지금 이 영역의 검색 칸(또는 박스 이름 칸)에 입력하고 있는가 — 창이 앞에 있을 때만. 뒤에 있으면(배너 바로가기 등) 미루지 않는다
function typingSearch(root: HTMLElement): boolean {
  if (searchSubmitting || !document.hasFocus()) return false;
  const a = document.activeElement;
  // 검색 칸과 박스 이름 입력칸 — 둘 다 한글을 친다. 계정·교환 입력칸(liveInput)은 다시 그려도 커서를 되돌린다
  return a instanceof HTMLInputElement && (a.dataset.search != null || a.classList.contains("box-name-input")) && root.contains(a);
}

// 검색 칸을 떠났다 — 미룬 다시 그리기를 한다. 누른 단추의 click 이 먼저 돌게 한 틱 미룬다
function releaseHeld(): void {
  setTimeout(() => {
    if (bodyHeld) {
      bodyHeld = false;
      draw();
    }
    if (dialogHeld) {
      dialogHeld = false;
      drawDialog();
    }
  }, 0);
}

function searchBox(key: string, value: string, placeholder: string, onSearch: (q: string) => void): HTMLElement {
  const box = el("span", "search-field");
  const input = document.createElement("input");
  input.type = "search";
  input.className = "search";
  input.id = `search-${key}`;
  input.dataset.search = key;
  input.placeholder = placeholder;
  input.value = searchDraft.get(key) ?? value;
  input.setAttribute("aria-label", placeholder);
  const go = button("search-go", "검색");
  go.setAttribute("aria-label", `${placeholder} 실행`);
  const submit = (): void => {
    if (!input.isConnected) return;
    searchDraft.delete(key);
    // 다시 그리면 옛 칸이 빠지며 blur 가 먼저 온다(Chromium) — 기억은 그린 뒤에 넣고 되돌린다
    const saved = document.activeElement === input ? { key, caret: input.selectionStart ?? input.value.length } : null;
    searchSubmitting = true;
    try {
      onSearch(input.value);
    } finally {
      searchSubmitting = false;
    }
    searchFocus = saved;
    restoreSearchFocus();
  };
  input.addEventListener("input", () => searchDraft.set(key, input.value));
  // 조합 중 Enter 는 검색을 예약만 한다 — 칸을 갈아 끼우면 조합이 끊긴다. 확정(compositionend) 직후 그 값으로 한 번 거른다.
  // 그래서 사용자는 Enter 를 한 번만 누른다 (2026-09-29 검수 반영)
  let pending = false;
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.isComposing || e.keyCode === 229) pending = true; // 229 — 조합 중 키 (IME)
    else submit();
  });
  input.addEventListener("compositionend", () => {
    if (!pending) return;
    pending = false;
    setTimeout(submit, 0); // 확정한 글자가 값에 들어간 뒤
  });
  // type="search" 의 지우기(×) — 빈 칸이 되면 search 이벤트가 온다. Enter 도 이 이벤트를 내지만 위에서 이미 처리했다
  input.addEventListener("search", () => {
    if (input.value === "") submit();
  });
  go.addEventListener("click", submit);
  input.addEventListener("blur", () => {
    if (searchFocus?.key === key) searchFocus = null;
    releaseHeld();
  });
  box.append(input, go);
  return box;
}

// 글자를 칠 때마다 값을 넘기는 입력 칸 — 계정·교환 링크. 다시 그리기는 하지 않는다. 포커스 복원은 searchFocus 를 쓴다
function liveInput(key: string, value: string, placeholder: string, onChange: (q: string) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "search";
  input.className = "search";
  input.id = `search-${key}`;
  input.placeholder = placeholder;
  input.value = value;
  input.setAttribute("aria-label", placeholder);
  // 다시 그리면 옛 칸이 빠지며 blur 가 먼저 온다(Chromium). 그래서 그린 뒤에 기억을 다시 넣고 되돌린다
  const apply = (): void => {
    const saved = { key, caret: input.selectionStart ?? input.value.length };
    onChange(input.value);
    searchFocus = saved;
    restoreSearchFocus();
  };
  input.addEventListener("input", (e) => {
    if (!(e as InputEvent).isComposing) apply();
  });
  input.addEventListener("compositionend", apply);
  // 사용자가 다른 곳을 누르면 포커스 기억을 지운다
  input.addEventListener("blur", () => {
    if (searchFocus?.key === key) searchFocus = null;
  });
  return input;
}

function restoreSearchFocus(): void {
  if (!searchFocus) return;
  const input = document.getElementById(`search-${searchFocus.key}`);
  if (!(input instanceof HTMLInputElement)) return;
  input.focus();
  input.setSelectionRange(searchFocus.caret, searchFocus.caret);
}

const normQuery = (q: string): string => q.trim().toLowerCase();

// 이름은 부분 일치, 숫자만 넣으면 도감 번호 앞자리 일치("025" 와 "25" 가 같다). `26-1` 처럼 하이픈이 있으면 표시 번호와 정확히 비교한다
function matchesName(name: string, q: string): boolean {
  return name.toLowerCase().includes(q);
}
function matchesDex(row: DexEntry, q: string): boolean {
  if (/^\d+$/.test(q)) return String(row.dex).startsWith(String(Number(q)));
  const m = /^(\d+)-(\d+)$/.exec(q);
  if (m) return row.dex === Number(m[1]) && row.form === Number(m[2]);
  // 미해금 종은 이름이 숨겨져 있다 — 이름으로 찾으면 무엇인지 드러나므로 번호로만 찾는다
  return row.state !== "locked" && matchesName(row.name, q);
}

function boxCell(pet: PetView, onPick: () => void): HTMLButtonElement {
  const cell = button("cell");
  const forms = pet.forms;
  if (forms && forms.length > 1) {
    // 공유 sid 계열 — 모습들을 한 장의 단체사진으로, 이름은 계열, 아래 줄은 지금 종 (Figma `Box / Shared Profile` `481:1227`)
    const level = pet.shiny ? `Lv.${pet.level} · 이로치` : `Lv.${pet.level}`;
    cell.append(groupPhoto(forms, pet.shiny), el("div", "who", `${forms[0]?.name ?? pet.name} 계열`), el("div", "note", `${level} · ${pet.name}`));
    cell.addEventListener("mouseenter", () => showFormTip(cell, pet));
    cell.addEventListener("mouseleave", () => hideFormTipSoon());
  } else {
    cell.append(portraitOf(pet.species, pet.shiny, "dot"), el("div", "who", pet.name), el("div", "note", pet.shiny ? `Lv.${pet.level} · 이로치` : `Lv.${pet.level}`));
  }
  cell.addEventListener("click", onPick);
  return cell;
}

// ── 공유 sid 계열 ───────────────────────────────────────────────────────────────
// 박스 칸의 2×2 단체사진과 마우스를 올리면 뜨는 툴팁. 툴팁의 줄을 누르면 바꾸기 확인 창이 뜬다.
// 파티 카드와 개체 상세는 지금 종 하나만 보인다 (2026-09-26 사용자 결정 "너 제안대로 하자").
// 파티에 나간 개체는 박스 칸이 없어 파티 카드에도 같은 툴팁을 단다 (2026-09-26 "제안대로 진행")

function groupPhoto(forms: FormView[], shiny: boolean): HTMLElement {
  const photo = el("div", "group-photo");
  for (const f of forms.slice(0, 4)) photo.appendChild(portraitOf(f.species, shiny, "gp-face"));
  return photo;
}

let formTip: HTMLElement | null = null;
let formTipTimer: ReturnType<typeof setTimeout> | null = null;

function hideFormTip(): void {
  if (formTipTimer) clearTimeout(formTipTimer);
  formTipTimer = null;
  formTip?.remove();
  formTip = null;
}
// 칸에서 툴팁으로 커서를 옮기는 사이에 닫히지 않게 잠깐 기다린다
function hideFormTipSoon(): void {
  if (formTipTimer) clearTimeout(formTipTimer);
  formTipTimer = setTimeout(hideFormTip, 150);
}

// status 는 파티 카드가 title 대신 머리 줄에 두는 상태 문구다
function showFormTip(cell: HTMLElement, pet: PetView, status?: string): void {
  hideFormTip();
  const tip = el("div", "form-tip");
  tip.setAttribute("role", "menu");
  if (status) tip.appendChild(el("div", "tip-head", status));
  tip.appendChild(el("div", "tip-head", "모습 바꾸기"));
  for (const f of pet.forms ?? []) {
    const now = f.species === pet.species;
    const row = button("form-row");
    row.setAttribute("role", "menuitem");
    if (now) row.setAttribute("aria-current", "true");
    row.append(portraitOf(f.species, pet.shiny, "gp-face"), el("span", "name", f.name), el("span", "note", now ? "지금" : "바꾸기"));
    row.disabled = now;
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      hideFormTip();
      open({ kind: "form", petId: pet.id, to: f.species });
    });
    tip.appendChild(row);
  }
  tip.addEventListener("mouseenter", () => {
    if (formTipTimer) clearTimeout(formTipTimer);
    formTipTimer = null;
  });
  tip.addEventListener("mouseleave", hideFormTipSoon);
  document.body.appendChild(tip);
  // 칸 바로 아래 가운데. 창 아래로 넘치면 칸 위에 둔다
  const r = cell.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  const top = r.bottom + 6 + h > window.innerHeight ? r.top - 6 - h : r.bottom + 6;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  formTip = tip;
}

// 조사 — src/shared/josa.ts 와 같은 규칙이다. 렌더러 빌드(tsconfig.renderer.json)는 src/renderer 밖의 실행 코드를 못 불러 따로 둔다
// 숫자로 끝나면 한국어로 읽은 소리 기준 (0·1·3·6·7·8 받침 있음, 1·7·8 은 ㄹ 받침)
// 라틴 글자로 끝나면 이름을 읽은 소리 기준 (L·R 은 ㄹ 받침 — 엘·알, M·N 은 받침 있음 — 엠·엔)
type JosaPair = "은/는" | "이/가" | "을/를" | "으로/로" | "과/와";
function josa(word: string, pair: JosaPair): string {
  const [withBatchim, without] = pair.split("/") as [string, string];
  const last = word.trim().slice(-1);
  let b: "none" | "rieul" | "other" = "none";
  if (/[0-9]/.test(last)) b = "178".includes(last) ? "rieul" : "036".includes(last) ? "other" : "none";
  else if (/[a-z]/i.test(last)) b = "lr".includes(last.toLowerCase()) ? "rieul" : "mn".includes(last.toLowerCase()) ? "other" : "none";
  else {
    const code = last.charCodeAt(0) - 0xac00;
    if (code >= 0 && code <= 11171 && code % 28 !== 0) b = code % 28 === 8 ? "rieul" : "other";
  }
  if (pair === "으로/로") return b === "other" ? withBatchim : without;
  return b === "none" ? without : withBatchim;
}

// 받침이 있으면 "으로", 없거나 ㄹ 받침이면 "로" — "루나아라로", "코스모움으로"
function toParticle(word: string): string {
  return josa(word, "으로/로");
}

// 모습 바꾸기 확인 — Figma `Box / Shared Form Confirm` `473:15738`
function drawForm(petId: string, to: string): void {
  const pet = petOf(petId);
  const form = pet?.forms?.find((f) => f.species === to);
  if (!pet || !form) {
    close();
    return;
  }
  dialogEl.append(...dialogHead(`${form.name}${toParticle(form.name)} 바꿀까요?`, ""));
  const card = el("div", "nat-card");
  const tags = el("div", "tags");
  form.types.forEach((name, i) => tags.appendChild(typeBadge(name, form.typeIds[i])));
  tags.appendChild(el("span", "note", `Lv.${pet.level} · ${pet.nature}`));
  card.append(portraitOf(form.species, pet.shiny, "portrait"), el("div", "name", form.name), tags);
  const row = el("div", "compare");
  row.appendChild(card);
  const slot = slotOfPet(pet.id);
  const info = el("div", "info-box");
  info.append(
    el("div", undefined, `지금 ${pet.name} · ${slot != null ? `파티 ${slot + 1}번 칸` : "박스"}`),
    el("div", "note", "레벨·친밀도·성격은 그대로예요"),
    el("div", "note", `스탯은 ${form.name} 기준이에요. 같은 칸에서 바뀌어요`),
  );
  const go = actionButton("바꾸기", true, false, () => {
    void send("pet.form", pet.id, { species: to }).then((ok) => {
      if (ok) close();
    });
  });
  dialogEl.append(row, info, actions(el("div", "spacer"), actionButton("취소", false, false, close), go));
}

function drawBox(v: Snapshot): void {
  const kept = v.boxes.reduce((sum, b) => sum + b.used, 0);
  const top = head("박스", `보관 ${kept}마리 · 박스 ${v.boxes.length}개`);
  top.appendChild(tradeOpenButton()); // 친구 교환 — 모달로 연다 (Figma 05 `Box / Trade Button` `1016:1891`)
  bodyEl.appendChild(top);

  const daycare = el("div", "daycare");
  daycare.dataset.tut = "hatch"; // 부화 튜토리얼이 밝히는 곳
  const title = el("div", "title");
  title.append(el("strong", undefined, "돌보미집"), el("span", undefined, `알 ${v.eggs.used} / ${v.eggs.size}`));
  daycare.appendChild(title);
  const eggs = el("div", "eggs");
  if (v.eggs.list.length) for (const egg of v.eggs.list) eggs.appendChild(eggCard(egg));
  else eggs.appendChild(el("div", "note", "알이 없습니다."));
  daycare.appendChild(eggs);
  bodyEl.appendChild(daycare);

  if (boxPage >= v.boxes.length) boxPage = 0;
  const box = v.boxes[boxPage];
  if (!box) return;

  const pager = el("div", "pager");
  const prev = button("", "◀");
  prev.disabled = boxPage === 0;
  prev.addEventListener("click", () => {
    boxPage -= 1;
    boxMarked = null;
    boxNote = "";
    draw();
  });
  const next = button("", "▶");
  next.disabled = boxPage >= v.boxes.length - 1;
  next.addEventListener("click", () => {
    boxPage += 1;
    boxMarked = null;
    boxNote = "";
    draw();
  });
  // ◀·▶ 에 개체를 놓으면 앞·뒤 박스의 첫 빈 칸으로 보낸다. 지금 박스에 머문다
  const dropToBox = (target: HTMLButtonElement, toIndex: number): void => {
    dropZone(target, () => {
      const to = v.boxes[toIndex];
      const from = dragFrom;
      if (from && to) void boxCommand("box.move", from.boxId, { slot: from.slot, toBoxId: to.id }, () => unsorted(from.boxId, to.id));
    });
  };
  if (!prev.disabled) dropToBox(prev, boxPage - 1);
  if (!next.disabled) dropToBox(next, boxPage + 1);
  pager.append(prev, boxNameEl(box), el("span", "used", `${box.used} / ${box.size}`), next);
  // 이름 검색 — 모든 박스를 대상으로 한다 (docs/specs/ui-components.md C-07)
  pager.appendChild(
    searchBox("box", boxQuery, "이름 검색", (q) => {
      boxQuery = q;
      draw();
    }),
  );
  pager.appendChild(boxSortEl(box));
  bodyEl.appendChild(pager);
  if (boxNote) bodyEl.appendChild(el("div", "box-note", boxNote));

  const q = normQuery(boxQuery);
  if (q) {
    const found = v.boxes.flatMap((b, bi) => b.slots.filter((p): p is PetView => p != null && matchesName(p.name, q)).map((p) => ({ pet: p, bi, box: b.name })));
    if (!found.length) {
      bodyEl.appendChild(el("div", "empty-note", "검색 결과 없음"));
      return;
    }
    const results = el("div", "box-grid");
    for (const { pet, bi, box: boxName } of found) {
      // 결과를 누르면 그 개체가 있는 박스로 간다
      const cell = boxCell(pet, () => {
        boxQuery = "";
        searchDraft.delete("box");
        searchFocus = null;
        boxPage = bi;
        boxMarked = pet.id;
        draw();
      });
      cell.appendChild(el("div", "note", boxName));
      cell.title = `${pet.name} · ${boxName}${josa(boxName, "으로/로")} 가기`;
      results.appendChild(cell);
    }
    bodyEl.appendChild(results);
    return;
  }

  const grid = el("div", "box-grid");
  box.slots.forEach((pet, slot) => {
    // 칸 옮기기 — 빈 칸이면 옮기고 개체 칸이면 맞바꾼다. 놓을 칸은 옅은 바탕으로 보인다(테두리 강조는 쓰지 않는다)
    const onDrop = (): void => {
      const from = dragFrom;
      if (!from || (from.boxId === box.id && from.slot === slot)) return;
      void boxCommand("box.move", from.boxId, { slot: from.slot, toBoxId: box.id, toSlot: slot }, () => unsorted(from.boxId, box.id));
    };
    if (!pet) {
      const blank = el("div", "cell blank");
      dropZone(blank, onDrop);
      grid.appendChild(blank);
      return;
    }
    const cell = boxCell(pet, () => openPet(pet.id));
    cell.setAttribute("aria-pressed", String(pet.id === boxMarked));
    if (pet.id === detailPet) cell.classList.add("selected"); // 옆 기기 창에 떠 있는 개체
    cell.title = `${pet.name} · 끌어서 옮기기`;
    cell.addEventListener("pointerdown", (e) => startBoxDrag(e, cell, { boxId: box.id, slot }));
    cell.addEventListener("dragstart", (e) => e.preventDefault()); // 칸 안 그림의 브라우저 기본 끌기를 막는다
    dropZone(cell, onDrop);
    grid.appendChild(cell);
  });
  bodyEl.appendChild(grid);
}

// 끌어 놓을 수 있는 곳 — 끄는 중에 커서 아래에 오면 옅은 바탕(.drop-on)
// 끌기는 브라우저의 끌어 놓기(OS 끌기)를 쓰지 않고 포인터 이벤트로 한다. 동반자의 무대 창이 화면 전체를 덮고 있어
// OS 끌기 신호가 관리 창에 닿지 않았다 (2026-09-27 사용자 "박스에서 드래그드랍이 아예 안되네")
const dropTargets = new WeakMap<Element, () => void>();
function dropZone(target: HTMLElement, onDrop: () => void): void {
  target.dataset.drop = "";
  dropTargets.set(target, onDrop);
}

const BOX_DRAG_START_PX = 5; // 이만큼 움직여야 끌기로 본다 — 그보다 작으면 누르기(상세 보기)

function startBoxDrag(down: PointerEvent, cell: HTMLElement, from: { boxId: string; slot: number }): void {
  if (down.button !== 0) return;
  const x0 = down.clientX;
  const y0 = down.clientY;
  let ghost: HTMLElement | null = null;
  let over: Element | null = null;
  const place = (e: PointerEvent): void => {
    if (!ghost) return;
    ghost.style.left = `${e.clientX - ghost.offsetWidth / 2 + 12}px`;
    ghost.style.top = `${e.clientY - ghost.offsetHeight / 2 + 12}px`;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-drop]") ?? null;
    const next = hit && hit !== cell ? hit : null;
    if (next === over) return;
    over?.classList.remove("drop-on");
    next?.classList.add("drop-on");
    over = next;
  };
  const move = (e: PointerEvent): void => {
    if (!ghost) {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) < BOX_DRAG_START_PX) return;
      dragFrom = from;
      boxSortOpen = false;
      hideFormTipSoon();
      const rect = cell.getBoundingClientRect();
      ghost = cell.cloneNode(true) as HTMLElement;
      ghost.classList.add("drag-ghost");
      ghost.removeAttribute("title");
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
      cell.classList.add("dragging");
    }
    place(e);
  };
  const end = (drop: boolean): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    if (!ghost) return;
    ghost.remove();
    cell.classList.remove("dragging");
    over?.classList.remove("drop-on");
    const target = over;
    // 끈 뒤 손을 뗀 곳에서 이어 오는 click(상세 열기)을 한 번 막는다
    const swallow = (c: Event): void => {
      c.stopPropagation();
      c.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    // 놓을 곳의 처리기는 dragFrom 을 읽는다 — 부른 뒤에 지운다
    if (drop && target) dropTargets.get(target)?.();
    dragFrom = null;
  };
  const up = (): void => end(true);
  const cancel = (): void => end(false);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
}

// 박스 이름 — 누르면 입력칸이 된다. Enter·바깥 클릭으로 저장, Esc 로 취소. 비우면 기본 이름(박스 N)
function boxNameEl(box: BoxView): HTMLElement {
  if (!boxRenaming) {
    const name = button("label box-name", box.name);
    name.title = "눌러서 이름 바꾸기";
    name.addEventListener("click", () => {
      boxRenaming = true;
      boxSortOpen = false;
      draw();
    });
    return name;
  }
  const input = document.createElement("input");
  input.className = "search box-name-input";
  input.value = box.name;
  input.maxLength = BOX_NAME_MAX;
  input.setAttribute("aria-label", "박스 이름");
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    boxRenaming = false;
    const name = input.value;
    if (save && name.trim() !== box.name) void boxCommand("box.rename", box.id, { name });
    else draw();
  };
  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") {
      e.stopPropagation(); // 관리 창의 Esc(대화상자 닫기)로 번지지 않게
      finish(false);
    }
  });
  // 다시 그려서 빠진 칸의 blur 는 저장으로 치지 않는다
  input.addEventListener("blur", () => setTimeout(() => input.isConnected && finish(true), 0));
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
  return input;
}

// 정렬 — 지금 보는 박스만 한 번 정렬한다. 목록은 바깥을 누르면 닫힌다
function boxSortEl(box: BoxView): HTMLElement {
  const wrap = el("div", "box-sort");
  const current = BOX_SORTS.find((s) => s.by === boxSortedBy.get(box.id));
  const toggle = button("sort-toggle", `${current?.label ?? "정렬"} ▾`);
  toggle.setAttribute("aria-expanded", String(boxSortOpen));
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    boxSortOpen = !boxSortOpen;
    draw();
  });
  wrap.appendChild(toggle);
  if (boxSortOpen) {
    const menu = el("div", "sort-menu");
    menu.setAttribute("role", "menu");
    for (const s of BOX_SORTS) {
      const item = button(s.by === current?.by ? "sort-item on" : "sort-item", s.label);
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(s.by === current?.by));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        boxSortOpen = false;
        void boxCommand("box.sort", box.id, { by: s.by }, () => boxSortedBy.set(box.id, s.by));
      });
      menu.appendChild(item);
    }
    wrap.appendChild(menu);
  }
  return wrap;
}

// 칸을 옮겨 순서가 흐트러진 박스는 정렬 표시를 지운다
function unsorted(...boxIds: string[]): void {
  for (const id of boxIds) boxSortedBy.delete(id);
}

// 박스 명령 — 대화상자 밖에서 보낸다. 실패하면 박스 줄 아래에 이유를 한 줄 보인다. 성공하면 onOk 를 먼저 부르고 다시 그린다
async function boxCommand(cmd: string, target: string, extra: Record<string, unknown>, onOk?: () => void): Promise<void> {
  if (busy) return;
  busy = true;
  let reply: ManageReply;
  try {
    const reqId = reqIdFor(cmd, target, extra);
    reply = await window.pokebuddyManage.command({ cmd, target, args: { ...extra, reqId } });
    rememberReply(cmd, target, extra, reqId, reply);
    if (reply.ok) onOk?.();
    await refresh();
  } finally {
    busy = false;
  }
  boxNote = reply.ok ? "" : REASON[reply.reason] ?? reply.reason;
  draw();
}

// 정렬·지방·설정 목록은 바깥을 누르면 닫는다
document.addEventListener("click", () => {
  if (settingSelectOpen) {
    settingSelectOpen = null;
    drawDialog();
  }
  if (!boxSortOpen && !dexRegionOpen && !shopRegionOpen) return;
  boxSortOpen = false;
  dexRegionOpen = false;
  shopRegionOpen = false;
  draw();
});

// ── 도감 ───────────────────────────────────────────────────────────────────────

function dexCell(row: DexEntry): HTMLElement {
  const cell = button(row.state === "locked" ? "dex-cell locked" : "dex-cell");
  cell.dataset.slug = row.slug;
  cell.setAttribute("aria-pressed", String(row.slug === dexPick));
  cell.addEventListener("click", () => pickDex(row.slug));
  // 미해금 종은 그림을 검은 실루엣으로 보인다 — CSS .dex-cell.locked .art (2026-09-27 사용자 결정 "모든 미해금에 다 하자")
  cell.append(el("div", "no", `#${dexNoText(row.dex, row.form, 4)}`), portraitOf(row.slug, false, "dot", "", true));
  cell.appendChild(el("div", undefined, row.state === "locked" ? "???" : row.name));
  if (row.state === "obtained") cell.appendChild(el("div", "no", row.shiny ? "이로치 획득" : "획득"));
  return cell;
}

// 고른 칸 표시만 바꾼다 — 격자를 다시 그리면 스크롤이 튄다 (worklog/records/play-bugs/record.md)
function markDexPick(): void {
  for (const cell of bodyEl.querySelectorAll<HTMLElement>(".dex-cell")) cell.setAttribute("aria-pressed", String(cell.dataset.slug === dexPick));
}

// 칸을 누르면 도감 기기 창에 그 종을 띄운다. 같은 칸을 다시 누르면 닫는다
function pickDex(slug: string): void {
  if (coachId === "dex") void send("tutorial.done", "dex", { steps: 1 }); // 칸을 눌러 본 것이 목표 행동이다
  dexPick = dexPick === slug ? null : slug;
  window.pokebuddyManage.dexOpen(dexPick, dexGen);
  markDexPick();
}

// 지금 격자에 보이는 목록 — 지방, 검색어, 등록 상태 칩을 함께 적용한다. 기기 창의 이전·다음도 이 순서를 따른다
function dexShown(): DexEntry[] {
  if (!dexRows) return [];
  const q = normQuery(dexQuery);
  return dexRows.filter((r) => inDexRegion(dexRegion, r.dex, r.region) && (dexFilter === "all" || r.state === dexFilter) && (!q || matchesDex(r, q)));
}

const dexRegionEl = (): HTMLElement =>
  regionEl(dexRegion, dexRegionOpen, (open) => (dexRegionOpen = open), (id) => {
    dexRegion = id;
    dexPageNo = 0;
  });

// 격자 넘김 줄 — 박스 넘김 줄(.pager)과 같은 ◀ ▶. 가운데에 `쪽 / 전체`
function gridPager(page: number, pages: number, go: (page: number) => void): HTMLElement {
  const pager = el("div", "pager grid-pager");
  const prev = button("", "◀");
  prev.setAttribute("aria-label", "이전 쪽");
  prev.disabled = page <= 0;
  prev.addEventListener("click", () => go(page - 1));
  const next = button("", "▶");
  next.setAttribute("aria-label", "다음 쪽");
  next.disabled = page >= pages - 1;
  next.addEventListener("click", () => go(page + 1));
  pager.append(prev, el("span", "used", `${page + 1} / ${pages}`), next);
  return pager;
}

// 한 쪽 — 쪽 번호를 범위 안으로 맞춘 뒤 그 쪽의 칸과 쪽 수를 돌려준다
function pageOf<T>(rows: T[], page: number, size: number = GRID_PAGE): { page: number; pages: number; items: T[] } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.max(0, Math.min(pages - 1, page));
  return { page: at, pages, items: rows.slice(at * size, (at + 1) * size) };
}

// 보는 방식 토글 — 검색 줄 오른쪽 끝의 아이콘 두 개. 고른 쪽은 톤 배경(색 테두리로 강조하지 않는다). 높이는 검색 칸과 같다
// 바꾸면 지금 쪽의 첫 항목이 들어 있는 쪽으로 간다
// 아이콘은 모양(격자·목록)이 아니라 넘기는 방식이다 — ‹ › 는 쪽 넘김, 위아래 꺾쇠는 스크롤 (2026-09-30 사용자 결정 "< > 로 옮기냐 스크롤하냐",
// Figma `Icon / Page` `1009:1237` · `Icon / Scroll` `1009:1239`). 두 방식 모두 같은 칸 격자다
const VIEW_ICON: Record<ViewMode, string> = {
  grid: '<path d="M6.5 4 2.5 8l4 4M9.5 4l4 4-4 4" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
  list: '<path d="M4.5 6 8 2.5 11.5 6M4.5 10 8 13.5 11.5 10" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>',
};
function viewToggle(current: ViewMode, pick: (mode: ViewMode) => void): HTMLElement {
  const box = el("span", "view-toggle");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "보는 방식");
  for (const [mode, label] of [["grid", "쪽으로 보기"], ["list", "스크롤로 보기"]] as const) {
    const b = button("view-opt");
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${VIEW_ICON[mode]}</svg>`; // 고정 그림 — 사용자 값이 들어가지 않는다
    b.title = label;
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", String(mode === current));
    b.dataset.view = mode;
    b.addEventListener("click", () => {
      if (mode !== current) pick(mode);
    });
    box.appendChild(b);
  }
  return box;
}

// 방식을 바꿀 때 — 지금 보던 첫 항목을 잇는다
//   쪽 → 스크롤  쪽의 첫 항목으로 스크롤한다
//   스크롤 → 쪽  본문 맨 위에 보이던 항목이 든 쪽으로 간다
// 돌려주는 값은 쪽 방식의 새 쪽 번호(스크롤로 갈 때는 지금 쪽 그대로)
function switchView(where: "dex" | "shop", from: ViewMode, to: ViewMode, page: number): number {
  if (from === "grid" && to === "list") {
    listScrollTo = { where, index: page * GRID_PAGE };
    return page;
  }
  const top = bodyEl.getBoundingClientRect().top;
  const rows = [...bodyEl.querySelectorAll<HTMLElement>(".dex-grid .dex-cell")]; // 도감 칸과 상점 칸(.dex-cell.shop-cell) 모두
  const first = rows.findIndex((r) => r.getBoundingClientRect().bottom > top + 1);
  return Math.floor(Math.max(0, first) / GRID_PAGE);
}

// 스크롤 방식을 그린 뒤 — 방식을 바꾼 직후면 그 항목으로 스크롤한다
function scrollListAfterSwitch(where: "dex" | "shop", list: HTMLElement): void {
  if (listScrollTo?.where !== where) return;
  const row = list.children[listScrollTo.index] as HTMLElement | undefined;
  listScrollTo = null;
  row?.scrollIntoView({ block: "start" });
  // 화면 밖 칸은 어림 높이로 먼저 잡혔다가(content-visibility) 그려지며 줄어든다 — 다음 프레임에 한 번 더 맞춘다
  requestAnimationFrame(() => row?.scrollIntoView({ block: "start" }));
}

// 지방 고르기 — 박스 정렬과 같은 모양의 목록. 바깥을 누르면 닫힌다. 도감과 상점 포켓몬 격자가 함께 쓴다
function regionEl(value: string, open: boolean, setOpen: (open: boolean) => void, pick: (id: string) => void): HTMLElement {
  const wrap = el("div", "box-sort left");
  const current = DEX_REGIONS.find((r) => r.id === value) ?? DEX_REGIONS[0];
  const toggle = button("sort-toggle", `지방: ${current?.label ?? "전체"} ▾`);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!open);
    draw();
  });
  wrap.appendChild(toggle);
  if (open) {
    const menu = el("div", "sort-menu");
    menu.setAttribute("role", "menu");
    for (const r of DEX_REGIONS) {
      const item = button(r.id === value ? "sort-item on" : "sort-item", r.label);
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(r.id === value));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        pick(r.id);
        setOpen(false);
        draw();
      });
      menu.appendChild(item);
    }
    wrap.appendChild(menu);
  }
  return wrap;
}

function stepDex(delta: -1 | 1): void {
  const rows = dexShown();
  if (!rows.length) return;
  const at = rows.findIndex((r) => r.slug === dexPick);
  const next = rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + delta))];
  if (!next || next.slug === dexPick) return;
  dexPick = next.slug;
  window.pokebuddyManage.dexOpen(dexPick, dexGen);
  // 쪽 방식 — 다음 종이 다른 쪽이면 그 쪽으로 넘긴다. 스크롤 방식 — 그 칸이 보이게 스크롤한다
  const page = Math.floor(rows.indexOf(next) / GRID_PAGE);
  if (dexView === "grid" && page !== dexPageNo && tab === "dex") {
    dexPageNo = page;
    draw();
  }
  markDexPick();
  if (dexView === "list") bodyEl.querySelector<HTMLElement>(`.dex-cell[data-slug="${CSS.escape(next.slug)}"]`)?.scrollIntoView({ block: "nearest" });
}

function drawDex(v: Snapshot): void {
  bodyEl.appendChild(head("도감", `획득 ${v.dex.obtained} · 해금 ${v.dex.unlocked} · 이로치 ${v.dex.shiny}`));
  // 지방·이름·번호 검색 — 등록 상태 칩과 함께 적용한다
  const bar = el("div", "search-row");
  bar.appendChild(dexRegionEl());
  bar.appendChild(
    searchBox("dex", dexQuery, "이름 또는 번호 검색", (q) => {
      dexQuery = q;
      dexPageNo = 0;
      draw();
    }),
  );
  bar.appendChild(
    viewToggle(dexView, (mode) => {
      dexPageNo = switchView("dex", dexView, mode, dexPageNo);
      dexView = mode;
      saveView("dex", mode);
      draw();
    }),
  );
  bodyEl.appendChild(bar);
  bodyEl.appendChild(
    chips(DEX_TABS, dexFilter, (id) => {
      dexFilter = id;
      dexPageNo = 0;
      draw();
    }),
  );
  if (!dexRows) {
    bodyEl.appendChild(el("div", "empty-note", "도감을 읽는 중입니다."));
    return;
  }
  const q = normQuery(dexQuery);
  const rows = dexShown();
  if (!rows.length) {
    bodyEl.appendChild(el("div", "empty-note", q ? "검색 결과 없음" : "해당하는 종이 없습니다."));
    return;
  }
  // 스크롤 방식 — 작업 전 화면 그대로 칸 격자를 전부 그린다(2026-09-25 사용자 요청). 화면 밖 칸은 CSS content-visibility 로
  // 그리기를 미루고, 초상은 보이는 칸만 받는다
  if (dexView === "list") {
    const all = el("div", "dex-grid");
    for (const row of rows) all.appendChild(dexCell(row));
    bodyEl.appendChild(all);
    scrollListAfterSwitch("dex", all);
    return;
  }
  // 격자 — 한 쪽씩. 2026-09-29 사용자 결정 "페이지 넘김 추가"로 전부 그리기(2026-09-25)를 바꿨다
  const shown = pageOf(rows, dexPageNo);
  dexPageNo = shown.page;
  bodyEl.appendChild(
    gridPager(shown.page, shown.pages, (page) => {
      dexPageNo = page;
      draw();
    }),
  );
  const grid = el("div", "dex-grid");
  for (const row of shown.items) grid.appendChild(dexCell(row));
  bodyEl.appendChild(grid);
}

// ── 상점 ───────────────────────────────────────────────────────────────────────

// 상점 줄의 그림 — 랜덤알은 알, 도구는 도구 그림. 칸 늘리기처럼 그림이 없는 상품은 빈 칸
// 포켓몬 상품은 두 방식 모두 격자 칸(shopCell)이라 줄로 그리지 않는다 (2026-09-30)
function shopThumb(item: ShopItemView): HTMLElement {
  if (item.category === "egg") return eggIcon(item.id, "thumb");
  if (item.category === "slot") return iconOf(null, "thumb");
  return iconOf(`item:${item.id}`, "thumb");
}

function shopRow(item: ShopItemView): HTMLElement {
  const card = button("row-card");
  card.appendChild(shopThumb(item));
  const body = el("div", "body");
  body.appendChild(el("div", "title", item.name));
  const note = item.blocked ?? item.note;
  if (note) body.appendChild(el("div", "note", note)); // 설명이 없는 상품은 이름 한 줄만
  // 줄 끝 › — 누르면 구매 창이 열린다 (Figma `Shop Layout` product 의 chevron)
  card.append(body, el("div", "price", point(item.price)), el("span", "chevron", "›"));
  // 살 수 없어도 누를 수 있다. 이유는 구매 창이 보여 준다
  card.addEventListener("click", () => open({ kind: "buy", productId: item.id, qty: 1 }));
  if (item.id === "random") card.dataset.tut = "shop"; // 상점 튜토리얼이 밝히는 곳
  return card;
}

// 포켓몬 상품 칸 — 도감 칸(.dex-cell)에 가격 한 줄을 더한다. 누르면 구매 창이 열린다. 살 수 없는 이유는 가격 아래 한 줄로
function shopCell(item: ShopItemView): HTMLElement {
  const cell = button("dex-cell shop-cell");
  cell.dataset.slug = item.id;
  cell.append(el("div", "no", item.dex ? `#${dexNoText(item.dex, item.form, 4)}` : ""), portraitOf(item.id, false, "dot", "", true));
  cell.append(el("div", undefined, item.name), el("div", "price", point(item.price)));
  if (item.blocked) cell.appendChild(el("div", "no", item.blocked));
  cell.addEventListener("click", () => open({ kind: "buy", productId: item.id, qty: 1 }));
  return cell;
}

// 포켓몬 상품 — 도감과 같은 지방·검색. 번호로 찾거나 이름으로 찾는다
function shopPokemonShown(items: ShopItemView[]): ShopItemView[] {
  const q = normQuery(shopQuery);
  return items.filter((i) => {
    const dex = i.dex ?? 0;
    if (!inDexRegion(shopRegion, dex, i.region)) return false;
    if (!q) return true;
    const m = /^(\d+)-(\d+)$/.exec(q);
    if (m) return dex === Number(m[1]) && i.form === Number(m[2]);
    return /^\d+$/.test(q) ? String(dex).startsWith(String(Number(q))) : matchesName(i.name, q);
  });
}

function shopGrid(items: ShopItemView[]): HTMLElement {
  const grid = el("div", "dex-grid");
  for (const item of items) grid.appendChild(shopCell(item));
  return grid;
}

function drawShop(v: Snapshot): void {
  bodyEl.appendChild(head("상점"));
  bodyEl.appendChild(
    chips(SHOP_TABS, shopFilter, (id) => {
      shopFilter = id;
      shopPageNo = 0;
      draw();
    }),
  );
  if (!SHOP_TABS.some((t) => t.id === shopFilter)) shopFilter = SHOP_TABS[0]?.id ?? "egg"; // 모르는 분류(옛 `all` 등)는 첫 탭으로
  // 상점 튜토리얼은 알 탭의 랜덤알 카드(data-tut="shop")를 가리킨다 — 그동안은 알 탭을 연다. 코치마크가 막아 다른 칩은 누를 수 없다
  if (v.tutorial === "shop") shopFilter = "egg";
  const rows = v.shop.filter((i) => i.category === shopFilter);
  if (!rows.length) {
    bodyEl.appendChild(el("div", "empty-note", shopFilter === "pokemon" ? "아직 파는 포켓몬이 없습니다." : "파는 것이 없습니다."));
    return;
  }

  // 포켓몬 탭 — 도감 같은 격자. 지방·검색으로 좁힌다
  if (shopFilter === "pokemon") {
    const bar = el("div", "search-row");
    bar.appendChild(
      regionEl(shopRegion, shopRegionOpen, (open) => (shopRegionOpen = open), (id) => {
        shopRegion = id;
        shopPageNo = 0;
      }),
    );
    bar.appendChild(
      searchBox("shop", shopQuery, "이름 또는 번호 검색", (q) => {
        shopQuery = q;
        shopPageNo = 0;
        draw();
      }),
    );
    bar.appendChild(
      viewToggle(shopView, (mode) => {
        shopPageNo = switchView("shop", shopView, mode, shopPageNo);
        shopView = mode;
        saveView("shop", mode);
        draw();
      }),
    );
    bodyEl.appendChild(bar);
    const found = shopPokemonShown(rows);
    if (!found.length) {
      bodyEl.appendChild(el("div", "empty-note", normQuery(shopQuery) ? "검색 결과 없음" : "해당하는 포켓몬이 없습니다."));
      return;
    }
    // 스크롤 방식 — 쪽 방식과 같은 칸 격자를 넘김 줄 없이 전부. 도감 스크롤과 같다 (2026-09-30 사용자 결정, Figma 05 `967:22565`).
    // 화면 밖 칸은 CSS content-visibility 로 그리기를 미루고, 초상은 보이는 칸만 받는다
    if (shopView === "list") {
      const grid = shopGrid(found);
      bodyEl.appendChild(grid);
      scrollListAfterSwitch("shop", grid);
      return;
    }
    const shown = pageOf(found, shopPageNo);
    shopPageNo = shown.page;
    bodyEl.appendChild(
      gridPager(shown.page, shown.pages, (page) => {
        shopPageNo = page;
        draw();
      }),
    );
    bodyEl.appendChild(shopGrid(shown.items));
    return;
  }

  // 그 밖의 탭 — 상품 줄
  const list = el("div", "rows");
  for (const item of rows) list.appendChild(shopRow(item));
  bodyEl.appendChild(list);
}

// ── 가방 ───────────────────────────────────────────────────────────────────────
// Figma 05 `Bag / Base` `381:6555` — 분류 칩, 4열 도구 칸, 고른 도구의 사용 패널(파티·박스 대상, 수량과 최대, 미리보기).
// 진화용 도구와 민트는 대상과 결과를 고르는 창이 따로 있어 그 창을 연다. 여러 개 쓰기는 경험사탕·이상한사탕만 되고 한 거래다
// (2026-09-27 사용자 결정 "수량 선택 + 최대", src/tx/handlers.ts useHandler)

// 가방 분류 — 상점(SHOP_TABS)의 도구 분류와 같다. data/items.json 의 도구는 `도구`, data/evo-items.json 의 진화용 도구는 `진화`.
// `전체` 는 두지 않고 첫 탭 `도구` 를 연다 (2026-09-30 사용자 결정 "상점이랑 가방이랑 아이템분류가 달라. 가방쪽이 안맞는거같애.")
const BAG_TABS = [
  { id: "tool", label: "도구" },
  { id: "evolution", label: "진화" },
];
let bagFilter = "tool";
let bagPick: string | null = null; // 사용 패널에 연 도구
let bagScope: "party" | "box" = "party";
let bagTarget: string | null = null;
let bagQty = 1;
// 방금 쓴 결과 한 줄 — 성공 톤 알림으로 판에 둔다. 도구·대상·범위·갈래·분류·탭을 바꾸면 지운다 (2026-09-30 사용자 결정 "추천대로 진행해")
let bagResult = "";
// 판 머리의 갈래 — 사용·판매. 판매가(sellPrice)가 있는 도구만 판매 갈래가 있다 (2026-09-30 사용자 결정, Figma 05 `Bag / Sell` `1006:20684`)
let bagMode: "use" | "sell" = "use";
let sellQty = 1;
// 대상 목록(.use-list)의 스크롤 — 판을 다시 그려도 같은 도구·같은 범위면 되돌린다. 범위를 바꾸면 맨 위 (8번 버그,
// 사용자 "스크롤 아래로 하고, 클릭하잖아. 스크롤이 제일 위로 가져.")
let bagListScroll = { key: "", top: 0 };
// 고른 줄을 목록 안에 보이게 맞출 차례 — 사용자가 줄·범위·도구를 새로 고를 때만 켠다. 그 밖의 다시 그리기(1초 시계 등)는 기억한 위치 그대로
let bagListReveal = false;

// `사용` 쪽 단추가 따로 창을 여는 도구 — 진화용 도구는 진화할 개체, 성격민트는 성격을 바꿀 개체를 고른다
const bagDialogUse = (item: BagItemView): boolean => item.evolution || item.effect === "nature";

// 도구의 분류 — 상점과 같은 기준. evolution 은 data/evo-items.json 에 있는 도구 (src/tx/lists.ts isEvoItem)
function bagCategory(item: BagItemView): string {
  return item.evolution ? "evolution" : "tool";
}
const bagMany = (item: BagItemView): boolean => item.effect === "exp" || item.effect === "level";

function bagCard(item: BagItemView): HTMLElement {
  const card = button("bag-card");
  card.setAttribute("aria-pressed", String(item.id === bagPick));
  const info = el("div", "info");
  info.append(el("div", "name", item.name), el("div", "qty", `×${item.count.toLocaleString("ko-KR")}`)); // 천 단위 쉼표
  card.append(iconOf(`item:${item.id}`, "thumb"), info);
  card.addEventListener("click", () => {
    // 어떤 도구든 판을 `사용` 쪽으로 연다 (2026-09-30 사용자 결정 "다 사용이 먼저 뜨게하면 되는거아니야?")
    bagPick = bagPick === item.id ? null : item.id;
    bagMode = "use";
    bagListReveal = true;
    bagQty = 1;
    sellQty = 1;
    notice = "";
    bagResult = "";
    draw();
  });
  return card;
}

function drawBag(v: Snapshot): void {
  bodyEl.appendChild(head("가방"));
  if (!v.bag.length) {
    bodyEl.appendChild(el("div", "empty-note", "가방이 비었습니다."));
    return;
  }
  if (!BAG_TABS.some((t) => t.id === bagFilter)) bagFilter = BAG_TABS[0]?.id ?? "tool"; // 모르는 분류(옛 `all` 등)는 첫 탭으로
  bodyEl.appendChild(
    chips(BAG_TABS, bagFilter, (id) => {
      bagFilter = id;
      bagResult = "";
      draw();
    }),
  );
  const items = v.bag.filter((i) => bagCategory(i) === bagFilter);
  if (!items.length) bodyEl.appendChild(el("div", "empty-note", "이 분류의 도구가 없습니다."));
  else {
    const grid = el("div", "bag-grid");
    for (const item of items) grid.appendChild(bagCard(item));
    bodyEl.appendChild(grid);
  }
  const picked = v.bag.find((i) => i.id === bagPick);
  if (!picked) {
    bagPick = null;
    if (bagResult) bodyEl.appendChild(alertBox("ok", "", bagResult)); // 다 써서 판이 닫혔다 — 결과는 목록 아래에 남긴다
    return;
  }
  bodyEl.appendChild(bagPanel(v, picked));
  restoreBagList();
}

// 대상 목록 스크롤 되돌리기 — 문서에 붙은 뒤에만 scrollTop 이 먹는다.
// 새로 고른 직후(bagListReveal)에만 고른 줄이 목록 밖이면 목록 안에서 맞춘다(창 전체는 움직이지 않는다)
function restoreBagList(): void {
  const rows = bodyEl.querySelector<HTMLElement>(".use-list");
  if (!rows) return;
  const key = rows.dataset.key ?? "";
  rows.scrollTop = bagListScroll.key === key ? bagListScroll.top : 0;
  const on = bagListReveal ? rows.querySelector<HTMLElement>('.use-target[aria-pressed="true"]') : null;
  bagListReveal = false;
  if (on) {
    const top = on.getBoundingClientRect().top - rows.getBoundingClientRect().top + rows.scrollTop;
    if (top < rows.scrollTop) rows.scrollTop = top;
    else if (top + on.offsetHeight > rows.scrollTop + rows.clientHeight) rows.scrollTop = top + on.offsetHeight - rows.clientHeight;
  }
  bagListScroll = { key, top: rows.scrollTop };
}

// 사탕을 qty 개 쓰면 — 경험치 곡선으로 새 레벨과 넘쳐 사라지는 경험치를 셈한다 (src/bag/use.ts 와 같은 규칙)
function candyResult(v: Snapshot, pet: PetView, item: BagItemView, qty: number): { level: number; gain: number; lost: number } {
  const curve = v.growthCurves[pet.growth] ?? [];
  const cap = curve[100] ?? pet.exp;
  if (item.effect === "level") {
    const level = Math.min(100, pet.level + qty);
    return { level, gain: Math.max(0, (curve[level] ?? pet.exp) - pet.exp), lost: 0 };
  }
  const raw = pet.exp + (item.amount ?? 0) * qty;
  const exp = Math.min(cap, raw);
  let level = pet.level;
  while (level < 100 && (curve[level + 1] ?? Infinity) <= exp) level += 1;
  return { level, gain: exp - pet.exp, lost: raw - exp };
}

// 한 번에 쓸 수 있는 최대 개수 — 가진 개수와 100레벨까지 필요한 개수 중 작은 쪽
function candyMax(v: Snapshot, pet: PetView, item: BagItemView): number {
  if (pet.level >= 100) return 0;
  if (item.effect === "level") return Math.min(item.count, 100 - pet.level);
  const cap = v.growthCurves[pet.growth]?.[100] ?? pet.exp;
  const per = item.amount ?? 0;
  return per > 0 ? Math.min(item.count, Math.ceil((cap - pet.exp) / per)) : 0;
}

// 쓸 수 없는 까닭 — 없으면 null. 실행기와 같은 규칙이다 (src/bag/use.ts)
function bagBlocked(pet: PetView, item: BagItemView): string | null {
  switch (item.effect) {
    case "exp":
    case "level":
      return pet.level >= 100 ? "이미 최고 레벨이에요." : null;
    case "fullness":
    case "fullness-full-buff":
      if (pet.fullness >= 100) return "배가 불러요.";
      return pet.feedReady ? null : `밥 주기 쿨타임이에요 (${waitWord(pet.feedInSec)}).`;
    case "shiny-on":
      return pet.shiny ? "이미 이로치예요." : null;
    case "shiny-off":
      return pet.shiny ? null : "이미 일반 색이에요.";
    default:
      return null;
  }
}

// 쓴 뒤 결과 한 줄 — 쓰기 전 값(before)과 새 스냅샷 값(after)을 견준다.
// 진화용 도구·성격민트는 따로 창 흐름이 있어 여기 오지 않는다(민트는 바꾼 뒤 개체 상세로 간다)
function bagResultText(item: BagItemView, before: PetView, after: PetView | null): string {
  const name = before.name;
  const used = `${name}에게 ${item.name}${josa(item.name, "을/를")} 썼어요`;
  if (!after) return used;
  const buffWord = (kind: string): string => {
    const hit = after.buffs.find((b) => b.kind === kind);
    return hit ? ` · ${hit.name} ${waitWord(hit.remainMin * 60)}` : "";
  };
  const fullness = `${name} 만복도 ${Math.round(before.fullness)} → ${Math.round(after.fullness)}`;
  switch (item.effect) {
    case "exp":
    case "level":
      return after.level !== before.level
        ? `${name} Lv.${before.level} → Lv.${after.level}`
        : `${name} 경험치 +${Math.max(0, after.exp - before.exp).toLocaleString("ko-KR")}`;
    case "fullness":
      return fullness;
    case "fullness-full-buff":
      return `${fullness}${buffWord("premium-food")}`;
    case "play-buff":
      return `${name}에게 ${item.name}${josa(item.name, "을/를")} 줬어요${buffWord("long-play")}`;
    case "shiny-on":
    case "shiny-off":
      return `${name}의 모습이 바뀌었어요`;
    default:
      return used;
  }
}

// 이미 걸린 버프를 다시 걸 때 — 남은 시간을 기본 지속시간으로 바꾼다. 더하지 않는다 (src/bag/use.ts setBuff).
// 쓰기는 막지 않는다 (2026-09-30 사용자 결정 "신남일때, 쓰면 시간갱신으로"). 박스 개체는 버프 시간이 멈춰 있다는 것도 적는다
function buffRefresh(pet: PetView, kind: string, full: string): string[] {
  const hit = pet.buffs.find((b) => b.kind === kind);
  const lines = hit ? [`이미 ${hit.name} · 남은 ${waitWord(hit.remainMin * 60)} → ${full}${toParticle(full)} 갱신`] : [];
  if (!partyPets().some((p) => p.id === pet.id)) lines.push("버프 시간은 파티에 있을 때만 흘러요");
  return lines;
}

function bagPreview(v: Snapshot, pet: PetView, item: BagItemView, qty: number): string[] {
  switch (item.effect) {
    case "exp":
    case "level": {
      const r = candyResult(v, pet, item, qty);
      const lost = item.effect === "exp" ? ` · 소멸 ${r.lost.toLocaleString("ko-KR")}` : "";
      return [`Lv.${pet.level} → Lv.${r.level}`, `획득 경험치 +${r.gain.toLocaleString("ko-KR")}${lost}`];
    }
    case "fullness":
      return [`만복도 ${Math.round(pet.fullness)} → ${Math.min(100, Math.round(pet.fullness + (item.amount ?? 0)))}`, "밥 주기 쿨타임이 시작돼요"];
    case "fullness-full-buff":
      return [`만복도 ${Math.round(pet.fullness)} → 100`, "든든함 · 친밀도 증가량 ×2 · 2시간", ...buffRefresh(pet, "premium-food", "2시간")];
    case "play-buff":
      return ["신남", "친밀도 증가량 ×1.5 · 30분", ...buffRefresh(pet, "long-play", "30분")];
    case "shiny-on":
      return ["이로치로 바뀌어요", "돌아오는 약으로 되돌릴 수 있어요"];
    case "shiny-off":
      return ["일반 색으로 돌아가요", "도감의 이로치 기록은 남아요"];
    default:
      return [item.name];
  }
}

function openBagDialog(item: BagItemView): void {
  open(item.evolution ? { kind: "evo-target", itemId: item.id } : { kind: "nature-target", itemId: item.id });
}

// 가방 튜토리얼 2단계 문구 — 진화용 도구·성격민트의 `사용` 쪽이면 주 단추를 가리킨다. 그 밖은 null(기본 문구)
function bagGuideWords(): { title: string; body: string } | null {
  const item = view?.bag.find((i) => i.id === bagPick);
  if (!item || bagMode !== "use" || !bagDialogUse(item)) return null;
  return item.evolution
    ? { title: "진화할 포켓몬 고르기를 눌러요", body: "창에서 진화시킬 포켓몬을 골라요." }
    : { title: "성격 바꿀 포켓몬 고르기를 눌러요", body: "창에서 성격을 바꿀 포켓몬을 골라요." };
}

// 진화용 도구·성격민트의 `사용` 쪽 — 설명 한 줄, `취소`(판 닫기)·고르는 창 열기 단추. 단추 줄은 판매 쪽과 같은 모양
function pickDetail(item: BagItemView): HTMLElement {
  const box = el("div", "use-detail pick-detail");
  const evo = item.evolution;
  box.appendChild(el("div", "use-note", evo ? `${item.name}${toParticle(item.name)} 진화할 수 있는 포켓몬을 골라요` : "성격을 바꿀 포켓몬을 골라요"));
  box.appendChild(
    actions(
      actionButton("취소", false, false, () => {
        bagPick = null;
        notice = "";
        bagResult = "";
        draw();
      }),
      actionButton(evo ? "진화할 포켓몬 고르기" : "성격 바꿀 포켓몬 고르기", true, false, () => openBagDialog(item)),
    ),
  );
  return box;
}

// 판 머리 아래 `사용 | 판매` — 고른 쪽만 톤 배경 (Figma 05 `Bag / Sell` `1006:20684`). 판매가가 없는 도구는 두지 않는다
function bagModes(item: BagItemView): HTMLElement {
  const modes = segmented(
    [
      { id: "use", label: "사용" },
      { id: "sell", label: "판매" },
    ] as const,
    bagMode,
    (id) => {
      notice = "";
      bagResult = "";
      bagMode = id;
      sellQty = 1;
      draw();
    },
  );
  modes.classList.add("use-mode");
  return modes;
}

// 판매 갈래 — 수량 줄, 받는 포인트 상자, `취소`·`N P에 팔기`. 한 거래로 판다 (src/shop/sell.ts)
function sellDetail(v: Snapshot, item: BagItemView, each: number): HTMLElement {
  const box = el("div", "use-detail sell-detail");
  const cap = Math.max(1, item.count);
  sellQty = Math.max(1, Math.min(sellQty, cap));
  const q = el("div", "qty square");
  const minus = button("", "−");
  minus.disabled = sellQty <= 1;
  minus.addEventListener("click", () => {
    sellQty -= 1;
    draw();
  });
  const plus = button("", "+");
  plus.disabled = sellQty >= cap;
  plus.addEventListener("click", () => {
    sellQty += 1;
    draw();
  });
  const max = button("max", "최대");
  max.disabled = sellQty >= cap;
  max.addEventListener("click", () => {
    sellQty = cap;
    draw();
  });
  q.append(minus, el("span", "count", sellQty.toLocaleString("ko-KR")), plus, max, el("span", "qty-hint", `최대 ${cap.toLocaleString("ko-KR")} · 보유 수`));
  box.appendChild(q);

  const earned = each * sellQty;
  const percent = Math.round((item.sellRate ?? 0) * 100);
  const summary = el("div", "use-preview");
  summary.append(
    el("strong", undefined, `받는 포인트 ${point(earned)}`),
    el("div", undefined, `1개 ${point(each)} (구매가 ${point(item.buyPrice ?? 0)}의 ${percent}%) · 판매 후 보유 ${point(v.points + earned)}`),
  );
  box.appendChild(summary);
  if (notice) box.appendChild(alertBox("bad", "", notice));
  box.appendChild(
    actions(
      actionButton("취소", false, false, () => {
        bagPick = null;
        notice = "";
        bagResult = "";
        draw();
      }),
      actionButton(`${point(earned)}에 팔기`, true, false, () => {
        void send("bag.sell", item.id, sellQty > 1 ? { count: sellQty } : {}).then((ok) => {
          if (!ok) return draw();
          sellQty = 1;
          if (!view?.bag.some((i) => i.id === item.id)) bagPick = null; // 다 팔았다
          draw();
        });
      }),
    ),
  );
  return box;
}

function bagPanel(v: Snapshot, item: BagItemView): HTMLElement {
  const panel = el("div", "use-panel");
  const top = el("div", "use-head");
  const x = button("close", "✕");
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", () => {
    bagPick = null;
    notice = "";
    bagResult = "";
    draw();
  });
  top.append(el("strong", undefined, item.name), el("span", "stock", `보유 ×${item.count.toLocaleString("ko-KR")}`), el("span", "spacer"), x);

  // 판매가가 있으면 머리 아래 `사용 | 판매`. 없으면(기본먹이·돌아오는 약) 지금처럼 사용 판만
  const each = item.sellPrice;
  if (each === undefined) bagMode = "use";
  if (each !== undefined && bagMode === "sell") {
    panel.append(top, bagModes(item), sellDetail(v, item, each));
    return panel;
  }
  // 진화용 도구·성격민트의 `사용` 쪽 — 판 안에는 설명 한 줄과 고르는 창을 여는 단추만 (Figma 05 `Bag / Use · 진화용 도구` `1043:22483`)
  if (bagDialogUse(item)) {
    if (each !== undefined) panel.append(top, bagModes(item), pickDetail(item));
    else panel.append(top, pickDetail(item));
    return panel;
  }

  const party = partyPets();
  const box = boxPets();
  const list = bagScope === "box" ? box : party;
  if (!list.some((p) => p.id === bagTarget)) bagTarget = list[0]?.id ?? null;
  const pet = list.find((p) => p.id === bagTarget) ?? null;

  const left = el("div", "use-targets");
  left.appendChild(
    segmented(
      [
        { id: "party", label: `파티 ${party.length}` },
        { id: "box", label: `박스 ${box.length}` },
      ] as const,
      bagScope,
      (id) => {
        bagScope = id;
        bagTarget = null;
        bagListReveal = true;
        bagQty = 1;
        notice = "";
        bagResult = "";
        draw();
      },
    ),
  );
  const rows = el("div", "use-list");
  const listKey = `${item.id}|${bagScope}`;
  rows.dataset.key = listKey;
  rows.addEventListener("scroll", () => {
    bagListScroll = { key: listKey, top: rows.scrollTop };
  });
  for (const p of list) {
    const row = button("use-target");
    row.setAttribute("aria-pressed", String(p.id === bagTarget));
    row.append(portraitOf(p.species, p.shiny, "use-portrait"), el("strong", undefined, p.name), el("span", "lv", `Lv.${p.level}`));
    row.addEventListener("click", () => {
      bagTarget = p.id;
      bagListReveal = true;
      bagQty = 1;
      notice = "";
      bagResult = "";
      draw();
    });
    rows.appendChild(row);
  }
  if (!list.length) rows.appendChild(el("div", "empty-note", bagScope === "box" ? "박스가 비었습니다." : "파티에 포켓몬이 없습니다."));
  left.appendChild(rows);

  const right = el("div", "use-detail");
  if (pet) {
    const blocked = bagBlocked(pet, item);
    const many = bagMany(item);
    const cap = many ? Math.max(1, candyMax(v, pet, item)) : 1;
    bagQty = Math.max(1, Math.min(bagQty, cap));
    right.appendChild(el("div", "use-current", many ? `${pet.name} Lv.${pet.level} · 다음 레벨까지 ${pet.percentToNext}%` : `${pet.name} Lv.${pet.level}`));
    if (many) {
      const q = el("div", "qty square");
      const minus = button("", "−");
      minus.disabled = bagQty <= 1 || !!blocked;
      minus.addEventListener("click", () => {
        bagQty -= 1;
        draw();
      });
      const plus = button("", "+");
      plus.disabled = bagQty >= cap || !!blocked;
      plus.addEventListener("click", () => {
        bagQty += 1;
        draw();
      });
      const max = button("max", "최대");
      max.disabled = bagQty >= cap || !!blocked;
      max.addEventListener("click", () => {
        bagQty = cap;
        draw();
      });
      q.append(minus, el("span", "count", bagQty.toLocaleString("ko-KR")), plus, max);
      right.appendChild(q);
    }
    const preview = el("div", "use-preview");
    const [lead, ...lines] = blocked ? [blocked] : bagPreview(v, pet, item, bagQty);
    preview.appendChild(el("strong", undefined, lead ?? ""));
    for (const line of lines) preview.appendChild(el("div", undefined, line));
    right.appendChild(preview);
    if (bagResult) right.appendChild(alertBox("ok", "", bagResult));
    if (notice) right.appendChild(alertBox("bad", "", notice));
    const label = many ? `${bagQty.toLocaleString("ko-KR")}개 사용` : "사용";
    right.appendChild(
      actions(
        actionButton("취소", false, false, () => {
          bagPick = null;
          notice = "";
          bagResult = "";
          draw();
        }),
        actionButton(label, true, !!blocked, () => {
          const target = pet.id;
          const before = pet; // 결과 줄은 쓰기 전 값과 새 스냅샷 값을 견준다
          bagResult = "";
          void send("bag.use", item.id, { petId: target, ...(many && bagQty > 1 ? { count: bagQty } : {}) }).then((ok) => {
            if (!ok) return draw();
            bagResult = bagResultText(item, before, petOf(target));
            bagQty = 1;
            if (!view?.bag.some((i) => i.id === item.id)) bagPick = null; // 다 썼다
            draw();
          });
        }),
      ),
    );
  }
  const cols = el("div", "use-columns");
  cols.append(left, right);
  if (each !== undefined) panel.append(top, bagModes(item), cols);
  else panel.append(top, cols);
  return panel;
}

// ── 교환 ───────────────────────────────────────────────────────────────────────
// Figma 05 Screens 섹션 `930:18244`(교환) 의 교환 모달 6화면 — Base `1036:23257`·Link Created `1036:22965`·Offer `1036:22673`·Blocked `1036:22381`·Done `1036:22089`·Error `1036:21797`.
// 값은 메인이 만든 TradeScreen(src/main/trade-screen.ts). 조작은 명령 trade.* 로 보내고, 결과와 실시간 변경은 같은 값으로 온다.
// 교환 흐름은 메인이 들고 있다. 여기서는 받은 값을 그리기만 한다.
// 그리는 곳은 교환 모달이다 — 박스 머리의 `교환` 단추가 연다(2026-09-30 사용자 결정).
// 모달을 닫아도 교환은 이어진다. 진행 중이면 `교환` 단추에 점을 둔다

let trade: TradeScreen | null = null;
let tradeLoading = false;
let tradeInput = ""; // 링크로 참가 칸에 붙여 넣은 글자
let tradeCopied = false; // 링크 복사 직후 — 단추 글자를 바꾼다

// 오류 배너 — 제목·문구 (Figma `Trade / Error` 와 주석 `633:18930`)
const TRADE_ERROR: Record<string, [string, string]> = {
  TRADE_LINK_EXPIRED: ["링크가 만료됐어요", "참가 전 10분이 지났어요. 친구에게 새 링크를 받아 주세요"],
  TRADE_LINK_USED: ["이미 사용된 링크예요", "다른 사람이 먼저 참가했어요"],
  TRADE_OWN_LINK: ["내가 만든 링크예요", "친구에게 보내 주세요"],
  TRADE_VERSION_MISMATCH: ["앱 버전이 달라요", "두 사람 모두 앱을 업데이트해 주세요"],
  NETWORK: ["서버에 연결할 수 없어요", "교환 밖의 게임은 그대로 할 수 있어요"],
  TRADE_LINK_INVALID: ["링크가 올바르지 않아요", "친구가 보낸 링크를 그대로 붙여 넣어 주세요"],
  TRADE_RATE_LIMITED: ["잠시 뒤에 다시 해 주세요", "짧은 시간에 링크를 너무 많이 만들었어요"],
  TRADE_CLOSED: ["친구가 교환을 닫았어요", "새 링크로 다시 시작해 주세요"],
  "in-trade": ["진행 중인 교환이 있어요", "지금 교환에서 나간 뒤 다시 해 주세요"],
  busy: ["잠시 뒤에 다시 해 주세요", "앞의 조작을 처리하는 중이에요"],
  "not-ready": ["아직 확정할 수 없어요", "두 사람 모두 포켓몬을 올려야 확정할 수 있어요"],
  timeout: ["응답이 늦어요", "잠시 뒤에 다시 해 주세요"],
  "cloud-wait": ["클라우드 저장이 연결되지 않았어요", "연결되면 다시 해 주세요. 계정 탭에서 저장 상태를 볼 수 있어요"],
  // 교환 규약 2 — 익명 계정 거절·원장 (design-p2.md 14절)
  "login-required": ["로그인해야 교환할 수 있어요", "계정 탭에서 로그인해 주세요"],
  TRADE_LOGIN_REQUIRED: ["로그인해야 교환할 수 있어요", "계정 탭에서 로그인해 주세요"],
  "save-wait": ["아직 저장되지 않은 포켓몬이에요", "저장이 끝나면 다시 올려 주세요"],
  TRADE_PET_NOT_SYNCED: ["아직 저장되지 않은 포켓몬이에요", "저장이 끝나면 다시 올려 주세요"],
  TRADE_PET_TRADED: ["이미 교환으로 보낸 포켓몬이에요", "다른 포켓몬을 골라 주세요"],
  // 서버 교환 중 예약 — 같은 개체가 다른 교환에 올라가 있다 (design-p2.md 17절 D31)
  TRADE_PET_BUSY: ["다른 교환에 올라가 있는 포켓몬이에요", "그 교환이 닫힌 뒤 다시 올리거나 다른 포켓몬을 골라 주세요"],
  TRADE_OFFER_INVALID: ["올릴 수 없는 포켓몬이에요", "다른 포켓몬을 골라 주세요"],
};
// 닫힌 이유 — 친구가 나갔거나 링크가 만료됐다
const TRADE_CLOSED: Record<string, [string, string]> = {
  guest_left: ["친구가 교환을 닫았어요", "새 링크로 다시 시작해 주세요"],
  host_left: ["친구가 교환을 닫았어요", "새 링크로 다시 시작해 주세요"],
  expired: ["링크가 만료됐어요", "참가 전 10분이 지났어요. 친구에게 새 링크를 받아 주세요"],
};
const TRADE_LOCAL: Record<string, string> = {
  single: "단일 포켓몬은 교환할 수 없어요",
  locked: "확정한 포켓몬은 바꿀 수 없어요",
  "no-pet": "그 포켓몬을 찾을 수 없어요",
};

async function loadTrade(): Promise<void> {
  if (tradeLoading) return;
  tradeLoading = true;
  try {
    const reply = await window.pokebuddyManage.command({ cmd: "trade.status" });
    trade = tradeOf(reply);
  } finally {
    tradeLoading = false;
  }
  syncTradeDot();
  redrawTrade();
}

// 교환 모달이 떠 있으면 다시 그린다. 본문(박스 탭)은 건드리지 않는다
function redrawTrade(): void {
  if (dialog?.kind === "trade") drawDialog();
}

// 진행 중 — 링크를 만들었거나, 친구와 고르는 중이거나, 완료 화면의 `확인` 을 아직 누르지 않았다
const tradeActive = (t: TradeScreen | null): boolean => !!t?.available && (t.phase === "hosting" || t.phase === "trading" || t.phase === "done");

// 박스 머리 `교환` 단추의 진행 중 점 — 본문을 다시 그리지 않고 점만 켜고 끈다
function syncTradeDot(): void {
  const dot = bodyEl.querySelector<HTMLElement>(".trade-open .dot");
  if (dot) dot.hidden = !tradeActive(trade);
}

// 박스 머리 오른쪽의 `교환` 단추 — Figma 05 `Box / Trade Button` `1016:1891`
function tradeOpenButton(): HTMLButtonElement {
  const b = button("act trade-open", "교환");
  const dot = el("span", "dot");
  dot.setAttribute("aria-hidden", "true");
  dot.hidden = !tradeActive(trade);
  b.appendChild(dot);
  b.addEventListener("click", () => {
    open({ kind: "trade" });
    void loadTrade();
  });
  return b;
}

// 결과의 screen 을 꺼낸다. 교환 세션이 없을 때(trade-off·sandbox)만 쓸 수 없다고 보인다.
// 그 밖의 실패(시간 초과·준비 전)는 지금 화면에 오류 배너만 더한다
const TRADE_UNAVAILABLE = new Set(["trade-off", "sandbox"]);
function tradeOf(reply: ManageReply): TradeScreen {
  const screen = reply.screen;
  if (screen && typeof screen === "object" && typeof screen.phase === "string") return screen;
  if (TRADE_UNAVAILABLE.has(reply.reason)) return { ...(trade ?? TRADE_OFF), available: false };
  return { ...(trade ?? { ...TRADE_OFF, available: true }), busy: false, error: { code: reply.reason } };
}

const TRADE_OFF: TradeScreen = {
  available: false, phase: "idle", link: null, expiresAt: null, busy: false, error: null, closedReason: null,
  friendJoined: false, friendName: null, mine: null, myPetId: null, myReady: false, friend: null, friendReady: false,
  friendBlocked: null, singles: [], received: null,
};

async function tradeSend(cmd: string, target?: string, args?: Record<string, unknown>): Promise<ManageReply> {
  const before = trade?.received?.petId ?? null;
  if (trade) {
    trade = { ...trade, busy: true };
    redrawTrade();
  }
  let reply: ManageReply;
  try {
    reply = await window.pokebuddyManage.command({ cmd, ...(target ? { target } : {}), ...(args ? { args } : {}) });
  } catch (e) {
    console.error("교환 명령을 보내지 못했다", e);
    reply = { ok: false, reason: "error" };
  }
  trade = tradeOf(reply);
  // 거절(진행 중인 교환 등)은 보기에 남지 않는다 — 배너로 보인다
  if (!reply.ok && !trade.error && trade.available) trade = { ...trade, error: { code: reply.reason, ...(typeof reply.detail === "string" ? { detail: reply.detail } : {}) } };
  if (trade.received && trade.received.petId !== before) {
    view = await window.pokebuddyManage.snapshot(); // 교환이 끝났다 — 바뀐 개체를 다시 받는다
    draw();
  }
  syncTradeDot();
  redrawTrade();
  return reply;
}

// 카드 안의 개체 한 줄 — 초상, 이름, 레벨·성격, 타입 배지 (Figma `Trade / Offer` 의 카드)
function tradePetLine(card: TradeCardView | null, empty: string): HTMLElement {
  const line = el("div", "trade-pet");
  if (!card) {
    line.appendChild(el("div", "trade-portrait"));
    if (empty) line.appendChild(el("div", "trade-empty", empty));
    return line;
  }
  const info = el("div", "trade-info");
  info.append(el("strong", undefined, card.name), el("div", "trade-meta", card.shiny ? `Lv.${card.level} · ${card.nature} · 이로치` : `Lv.${card.level} · ${card.nature}`));
  const tags = el("div", "tags");
  card.types.forEach((name, i) => tags.appendChild(typeBadge(name, card.typeIds[i])));
  info.appendChild(tags);
  line.append(portraitOf(card.species, card.shiny, "trade-portrait"), info);
  return line;
}

// 상태 점과 글자 — 분류는 점으로 보인다(색 테두리 강조 대신)
function tradeState(text: string, tone: "ok" | "wait" | "bad" | "idle"): HTMLElement {
  const box = el("span", `trade-state ${tone}`);
  box.append(el("i"), document.createTextNode(text));
  return box;
}

function tradeCardHead(title: string, right?: HTMLElement): HTMLElement {
  const row = el("div", "trade-card-head");
  row.appendChild(el("strong", undefined, title));
  if (right) row.appendChild(right);
  return row;
}

const leftText = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// 링크 만들기·참가 두 카드와 규칙 — Base·Link Created·Error
function drawTradeStart(t: TradeScreen, out: HTMLElement): void {
  const row = el("div", "trade-row");
  row.dataset.tut = "trade"; // 교환 튜토리얼이 밝히는 곳 — 링크 만들기·링크로 참가

  const host = el("div", "trade-card");
  if (t.phase === "hosting" && t.link) {
    host.appendChild(tradeCardHead("공유 채널", tradeState("친구 기다리는 중", "wait")));
    const left = el("div", "trade-desc");
    const time = el("strong", "trade-left", t.expiresAt ? leftText(t.expiresAt - Date.now()) : "");
    time.dataset.expires = String(t.expiresAt ?? "");
    left.append(document.createTextNode("참가 전 남은 시간 "), time);
    const acts = el("div", "trade-acts");
    const link = el("input", "trade-input trade-link");
    link.readOnly = true;
    link.value = `…#${t.link.slice(t.link.lastIndexOf("#") + 1, t.link.lastIndexOf("#") + 7)}`; // 앞 6자만 — 전체는 title 과 복사로 (Figma `Trade / Link Created` "…#Qm7xK2")
    link.title = t.link;
    link.setAttribute("aria-label", "내 교환 링크");
    const copy = actionButton(tradeCopied ? "복사됨" : "링크 복사", true, false, () => {
      window.pokebuddyManage.copyText(t.link ?? "");
      tradeCopied = true;
      redrawTrade();
      setTimeout(() => {
        tradeCopied = false;
        redrawTrade();
      }, 1500);
    });
    acts.append(link, copy, actionButton("취소", false, t.busy, () => void tradeSend("trade.leave")));
    host.append(left, acts);
  } else {
    host.appendChild(tradeCardHead("공유 채널 만들기"));
    const acts = el("div", "trade-acts");
    acts.appendChild(actionButton("링크 만들기", true, t.busy, () => void tradeSend("trade.create")));
    host.appendChild(acts);
  }

  const join = el("div", "trade-card");
  join.appendChild(tradeCardHead("링크로 참가"));
  const acts = el("div", "trade-acts");
  const input = liveInput("trade-link", tradeInput, "교환 링크 붙여넣기", (q) => {
    tradeInput = q;
  });
  input.type = "text";
  input.classList.add("trade-input");
  const go = actionButton("참가", false, t.busy || t.phase === "hosting", () => {
    const link = tradeInput.trim();
    if (!link) return;
    void tradeSend("trade.join", undefined, { link }).then((reply) => {
      if (reply.ok) {
        tradeInput = "";
        redrawTrade();
      }
    });
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go.click();
  });
  acts.append(input, go);
  join.appendChild(acts);

  row.append(host, join);
  out.appendChild(row);

  const rules = el("div", "trade-card");
  rules.appendChild(tradeCardHead("교환 규칙"));
  for (const line of ["한 번에 한 마리씩 맞바꿔요", "받은 포켓몬은 보낸 포켓몬이 있던 자리로 가요", "단일 포켓몬은 교환할 수 없어요"]) rules.appendChild(el("div", "trade-desc", line));
  out.appendChild(rules);
}

// 보낼 포켓몬 고르기 — 파티와 박스. 단일 포켓몬 칸은 흐리게 막는다
function tradePicker(t: TradeScreen): HTMLElement {
  const box = el("div", "trade-card");
  box.appendChild(tradeCardHead("보낼 포켓몬", el("span", "trade-hint", "흐린 칸: 단일 포켓몬, 교환 불가")));
  const singles = new Set(t.singles);
  const cell = (pet: PetView): HTMLElement => {
    const b = button("cell trade-cell");
    b.append(portraitOf(pet.species, pet.shiny, "dot"), el("div", "who", pet.name), el("div", "note", `Lv.${pet.level}`));
    const single = singles.has(pet.id);
    b.disabled = single || t.myReady || t.busy;
    if (single) b.classList.add("off");
    b.setAttribute("aria-pressed", String(pet.id === t.myPetId));
    b.addEventListener("click", () => void tradeSend("trade.offer", pet.id));
    return b;
  };
  const party = partyPets();
  if (party.length) {
    box.appendChild(el("div", "trade-group", "파티"));
    const grid = el("div", "trade-grid");
    for (const pet of party) grid.appendChild(cell(pet));
    box.appendChild(grid);
  }
  for (const b of view?.boxes ?? []) {
    const pets = b.slots.filter((p): p is PetView => p != null);
    if (!pets.length) continue;
    box.appendChild(el("div", "trade-group", b.name));
    const grid = el("div", "trade-grid");
    for (const pet of pets) grid.appendChild(cell(pet));
    box.appendChild(grid);
  }
  return box;
}

// 두 사람이 제안하고 확정하는 화면 — Offer·Blocked
function drawTradeOffer(t: TradeScreen, out: HTMLElement): void {
  const row = el("div", "trade-row");
  const mine = el("div", "trade-card");
  mine.append(tradeCardHead("내 포켓몬", t.myReady ? tradeState("확정함", "ok") : tradeState("확정 전", "idle")), tradePetLine(t.mine, "아래에서 보낼 포켓몬을 골라요"));
  const friend = el("div", "trade-card");
  const friendTitle = t.friendName ? `${t.friendName}의 포켓몬` : "친구 포켓몬";
  const friendState = t.friendBlocked ? tradeState("받을 수 없음", "bad") : t.friendReady ? tradeState("확정함", "ok") : t.friend ? tradeState("확정 전", "idle") : tradeState("고르는 중", "wait");
  friend.append(tradeCardHead(friendTitle, friendState), tradePetLine(t.friend, ""));
  row.append(mine, friend);
  out.appendChild(row);

  if (t.friendBlocked) {
    const name = t.friend?.name ?? "이 포켓몬";
    const why = t.friendBlocked === "single" ? `${name}${josa(name, "은/는")} 단일 포켓몬이라 교환할 수 없어요.` : `${name}의 정보가 올바르지 않아요.`;
    out.appendChild(alertBox("bad", "받을 수 없는 포켓몬이에요", `${why} 친구가 다른 포켓몬을 올려야 확정할 수 있어요`));
  }

  const bar = el("div", "trade-bar");
  bar.appendChild(el("div", "trade-desc", "한쪽이 포켓몬을 바꾸면 양쪽 확정이 풀려요"));
  const canReady = !!t.mine && !!t.friend && !t.friendBlocked && !t.busy;
  bar.append(
    actionButton("나가기", false, t.busy, () => void tradeSend("trade.leave")),
    t.myReady ? actionButton("확정 취소", false, t.busy, () => void tradeSend("trade.unready")) : actionButton("확정", true, !canReady, () => void tradeSend("trade.ready")),
  );
  out.appendChild(bar);
  out.appendChild(tradePicker(t));
}

// 교환 완료 — Done
function drawTradeDone(t: TradeScreen, out: HTMLElement): void {
  out.appendChild(alertBox("ok", "교환 완료"));
  const r = t.received;
  const card = el("div", "trade-card");
  card.appendChild(tradeCardHead("받은 포켓몬"));
  if (r) {
    const big = tradePetLine(r.card, "");
    big.classList.add("big");
    card.appendChild(big);
    const place = el("div", "trade-place");
    place.appendChild(el("strong", undefined, r.party != null ? `파티 ${r.party + 1}번 칸에 들어갔어요` : `${r.box ?? "박스"}에 들어갔어요`));
    if (r.sent) place.appendChild(el("div", "trade-desc", `보낸 포켓몬 ${r.sent.name} Lv.${r.sent.level}${josa(String(r.sent.level), "이/가")} 있던 자리`));
    if (r.party != null) place.appendChild(el("div", "trade-desc", r.hidden ? "숨김 상태는 그 칸 그대로" : "꺼낸 상태는 그 칸 그대로"));
    card.appendChild(place);
  }
  const acts = el("div", "trade-acts end");
  acts.appendChild(actionButton("확인", true, t.busy, () => void tradeSend("trade.leave")));
  card.appendChild(acts);
  out.appendChild(card);
}

// 교환 모달 — 머리 "친구 교환" 과 오른쪽 위 ✕, 스크롤 본문. ✕·Esc·바깥 누르기로 닫는다(모달 공통)
function drawTradeDialog(): void {
  const top = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, "친구 교환"));
  const x = button("dialog-close", "✕");
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", close);
  top.append(titles, x);
  const out = el("div", "scroll");
  dialogEl.append(top, out);
  const t = trade;
  if (!t) {
    out.appendChild(el("div", "empty-note", "교환 상태를 읽는 중이에요."));
    void loadTrade();
    return;
  }
  if (!t.available) {
    out.appendChild(el("div", "empty-note", "교환을 쓸 수 없어요."));
    return;
  }
  // 오류·닫힘 배너 — 같은 자리에 제목과 문구만 바뀐다
  const err = t.error;
  if (err) {
    const text = err.code === "LOCAL" ? [TRADE_LOCAL[err.detail ?? ""] ?? "교환을 진행하지 못했어요", err.detail === "locked" ? "" : "다른 포켓몬을 골라 주세요"] : TRADE_ERROR[err.code] ?? ["교환을 진행하지 못했어요", `잠시 뒤에 다시 해 주세요 (${err.code})`];
    out.appendChild(alertBox("bad", text[0] ?? "", text[1] ?? ""));
  } else if (t.phase === "closed") {
    const text = TRADE_CLOSED[t.closedReason ?? ""] ?? ["교환이 닫혔어요", "새 링크로 다시 시작해 주세요"];
    out.appendChild(alertBox("bad", text[0], text[1]));
  }
  if (t.phase === "trading") drawTradeOffer(t, out);
  else if (t.phase === "done") drawTradeDone(t, out);
  else if (acct?.available && !acct.signedIn) drawTradeLogin(out);
  else drawTradeStart(t, out);
}

// 로그인 전(익명·분실) — 만들기·참가 대신 로그인 안내. 진행 중인 교환은 끝까지 보인다 (design-p2.md 5절)
function drawTradeLogin(out: HTMLElement): void {
  const card = el("div", "trade-card");
  card.appendChild(tradeCardHead("교환은 로그인해야 할 수 있어요"));
  const acts = el("div", "trade-acts");
  acts.appendChild(actionButton("로그인", true, false, () => open({ kind: "user", tab: "account" })));
  card.appendChild(acts);
  out.appendChild(card);
}

// 참가 전 남은 시간 — 글자만 1초마다 바꾼다. 본문을 다시 그리지 않는다
setInterval(() => {
  for (const node of document.querySelectorAll<HTMLElement>(".trade-left")) {
    const at = Number(node.dataset.expires);
    if (at) node.textContent = leftText(at - Date.now());
  }
}, 1000);

window.pokebuddyManage.onTrade((screen) => {
  const got = screen.received?.petId !== trade?.received?.petId && screen.received != null;
  trade = screen;
  syncTradeDot();
  // 교환이 끝나 개체가 바뀌었다 — 스냅샷도 다시 받는다. 받지 않으면 보낸 개체가 파티·박스에 남아 보인다(2026-09-27 화면 E2E 에서 발견)
  if (got) void refresh().then(redrawTrade);
  else redrawTrade();
});

// ── 계정과 클라우드 저장 ──────────────────────────────────────────────────────────
// Figma 05 Screens `633:19206`(로그인)·`633:19302`(가입)·`633:19425`(로그인 뒤)·`633:19631`(삭제 확인)·`633:19744`(막힘). 헤더 저장 표시는 C-27.
// 값은 메인이 준다(src/main/online.ts). 입력한 글자는 여기 들고 있다 — 1초 시계로 다시 그려도 사라지지 않게
// 두 PC 규칙(P1): 저장은 자동으로만 올린다. 저장 단추·로그인 때 고르기·밀려남 배너는 없다.
//   다른 PC 확인(confirm)·넘겨받기 막힘(blocked)·다른 PC 에서 시작(superseded)은 앱이 네이티브 창으로 묻는다 — 여기서는 상태 글자만

let acct: AccountScreen | null = null;
let acctLoading = false;
let acctBusy = false;
let acctGithub = false; // 브라우저에서 GitHub 로그인을 기다리는 중
const acctForm = { mode: "sign-in" as "sign-in" | "sign-up", username: "", password: "", password2: "", displayName: "", error: "", check: "" as "" | "available" | "taken" | "invalid" | "NETWORK" };
let acctRename: string | null = null; // 이름 바꾸는 중이면 입력한 이름
let acctConfirm: "delete" | "sign-out" | null = null;
let checkTimer: ReturnType<typeof setTimeout> | null = null;

const saveIndicatorEl = need("save-indicator", HTMLElement);

const ACCT_ERROR: Record<string, string> = {
  AUTH_INVALID_LOGIN: "아이디 또는 비밀번호가 맞지 않아요",
  AUTH_USERNAME_TAKEN: "이미 쓰는 아이디",
  AUTH_USERNAME_INVALID: "영문 소문자로 시작, 소문자·숫자·_ 4~16자",
  AUTH_NAME_INVALID: "이름은 1~12자로 적어 주세요",
  AUTH_PASSWORD_WEAK: "비밀번호는 8자 이상이에요",
  AUTH_TRADE_ACTIVE: "교환 중에는 계정을 바꿀 수 없어요",
  AUTH_RATE_LIMITED: "잠시 뒤에 다시 해 주세요",
  AUTH_PORT_BUSY: "로그인 창을 열 수 없어요. 잠시 뒤에 다시 해 주세요",
  NETWORK: "서버에 연결할 수 없어요",
  CLOUD_LOGIN_REQUIRED: "다시 로그인해 주세요",
  CLOUD_UPDATE_REQUIRED: "업데이트해야 계정에 저장돼요",
  CLOUD_TRADE_ACTIVE: "다른 PC 에서 교환 중이라 넘겨받을 수 없어요",
  CLOUD_TRADE_UNSYNCED: "다른 PC 에서 끝낸 교환이 아직 저장되지 않았어요",
  CLOUD_OWNER_OTHER: "이 PC 진행은 다른 계정 것이라 올리지 않아요",
  CLOUD_BAD_SAVE: "계정 저장을 읽지 못해 올리지 않아요",
  CLOUD_TOO_LARGE: "저장이 너무 커서 올리지 못했어요",
  CLOUD_PET_TRADED_OUT: "교환으로 보낸 포켓몬이 남아 있어 올리지 않아요",
  CLOUD_HANDOFF_INVALID: "이 PC 진행을 계정으로 옮기지 못했어요",
  SAVE_BACKUP_FAILED: "이 PC 저장을 백업하지 못해 새로 시작하지 않았어요",
};
const acctErrorText = (code: string | null): string => (!code || code === "AUTH_CANCELLED" ? "" : ACCT_ERROR[code] ?? `계정 작업을 하지 못했어요 (${code})`);

// 마지막 저장 시각 — "3분 전"처럼 짧게
function ago(at: number | null): string {
  if (!at) return "";
  const min = Math.floor((Date.now() - at) / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  return hour < 24 ? `${hour}시간 전` : `${Math.floor(hour / 24)}일 전`;
}

// 저장 상태 글자 — 헤더 저장 표시와 계정 탭 저장 줄이 같이 쓴다. online 은 마지막 저장 시각을 붙인다
//   dot: ok 초록 · idle 회색 · warn 강조(사용자 손이 필요하거나 게임이 멈춘 상태)
const CLOUD_TEXT: Record<Exclude<CloudStatusView, "off" | "online">, { text: string; dot: "idle" | "warn" }> = {
  connecting: { text: "연결 중", dot: "idle" },
  offline: { text: "오프라인", dot: "idle" },
  "update-required": { text: "업데이트 필요", dot: "warn" },
  confirm: { text: "확인 대기", dot: "warn" },
  blocked: { text: "넘겨받지 못함", dot: "warn" },
  superseded: { text: "다른 PC 에서 시작", dot: "warn" },
};
// 상태 글자가 이미 말하는 오류 — 계정 탭에서 오류 글자를 겹쳐 붙이지 않는다
const CLOUD_SAID: Partial<Record<CloudStatusView, string>> = { "update-required": "CLOUD_UPDATE_REQUIRED" };

function cloudText(c: AccountScreen["cloud"]): { text: string; dot: "ok" | "idle" | "warn" } | null {
  if (c.status === "off") return null;
  if (c.status === "online") return { text: c.lastSavedAt ? `저장됨 · ${ago(c.lastSavedAt)}` : "저장됨", dot: "ok" };
  return CLOUD_TEXT[c.status];
}

// 저장 줄 글자 — 상태 글자와, 상태가 말하지 않는 오류. 로그인 뒤·익명 계정 탭이 같이 쓴다
function saveLine(c: AccountScreen["cloud"]): string {
  const text = cloudText(c)?.text ?? "";
  const err = c.error && c.status !== "online" && CLOUD_SAID[c.status] !== c.error ? acctErrorText(c.error) : "";
  return err ? (text ? `${text} · ${err}` : err) : text;
}

// 헤더 저장 표시 — 로그인·익명 계정이면 보인다. 저장 계정을 잃었으면(D29) 저장 꺼짐. 누르면 사용자 모달의 계정 탭을 연다
function drawSaveIndicator(): void {
  if (acct?.lost) {
    saveIndicatorEl.hidden = false;
    saveIndicatorEl.dataset.state = "warn";
    saveIndicatorEl.replaceChildren(el("i"), document.createTextNode("저장 꺼짐"));
    return;
  }
  const c = acct?.signedIn || acct?.anonymous ? acct.cloud : null;
  const shown = c ? cloudText(c) : null;
  saveIndicatorEl.hidden = !shown;
  if (!shown) return;
  saveIndicatorEl.dataset.state = shown.dot;
  saveIndicatorEl.replaceChildren(el("i"), document.createTextNode(shown.text));
}
saveIndicatorEl.addEventListener("click", () => open({ kind: "user", tab: "account" }));

async function loadAccount(): Promise<void> {
  if (acctLoading) return;
  acctLoading = true;
  try {
    const reply = await window.pokebuddyManage.account({ action: "status" });
    acct = reply?.screen ?? { ...ACCOUNT_OFF };
  } catch (e) {
    console.error("계정 상태를 읽지 못했다", e);
    acct = { ...ACCOUNT_OFF };
  } finally {
    acctLoading = false;
  }
  drawSaveIndicator();
  redrawAccount();
  redrawTrade();
}

const ACCOUNT_OFF: AccountScreen = {
  available: false, signedIn: false, method: null, username: null, displayName: null, blocked: false,
  cloud: { status: "off", lastSavedAt: null, busy: false, error: null, other: null },
};

// 계정 탭이 열려 있으면 다시 그린다
function redrawAccount(): void {
  if (dialog?.kind === "user" && dialog.tab === "account") drawDialog();
}

async function acctSend(req: AccountAction): Promise<AccountReply | null> {
  acctBusy = true;
  redrawAccount();
  let reply: AccountReply | null = null;
  try {
    reply = await window.pokebuddyManage.account(req);
  } catch (e) {
    console.error("계정 요청을 보내지 못했다", e);
  } finally {
    acctBusy = false;
  }
  if (reply) acct = reply.screen;
  acctForm.error = reply ? acctErrorText(reply.code) : acctErrorText("NETWORK");
  drawSaveIndicator();
  redrawAccount();
  draw();
  return reply;
}

// 입력칸 — liveInput 의 포커스 복원을 쓴다. 다시 그려도 커서가 그대로다
function acctInput(key: string, value: string, placeholder: string, type: "text" | "password", onChange: (v: string) => void): HTMLInputElement {
  const input = liveInput(key, value, placeholder, onChange);
  input.type = type;
  input.classList.add("acct-input");
  input.autocomplete = "off";
  input.disabled = acctBusy || !!acct?.blocked;
  return input;
}

function acctField(label: string, input: HTMLElement, note?: { text: string; tone: "ok" | "bad" | "idle" | "warn" }): HTMLElement {
  const box = el("label", "acct-field");
  box.append(el("span", "acct-label", label), input);
  if (note?.text) {
    const line = el("span", `acct-note ${note.tone}`);
    line.append(el("i"), document.createTextNode(note.text));
    box.appendChild(line);
  }
  return box;
}

function acctNotice(title: string, desc: string, tone: "warn" | "bad"): HTMLElement {
  const box = alertBox(tone, title, desc);
  box.classList.add("acct-notice");
  return box;
}

function usernameNote(): { text: string; tone: "ok" | "bad" | "idle" } | undefined {
  if (acctForm.check === "available") return { text: "사용할 수 있는 아이디", tone: "ok" };
  if (acctForm.check === "taken") return { text: "이미 쓰는 아이디", tone: "bad" };
  if (acctForm.check === "invalid") return { text: "영문 소문자로 시작, 소문자·숫자·_ 4~16자", tone: "bad" };
  return undefined;
}

// 아이디 입력을 멈추고 0.5초 뒤 중복을 묻는다. 규칙 밖이면 묻지 않는다
function scheduleUsernameCheck(): void {
  if (checkTimer) clearTimeout(checkTimer);
  const name = acctForm.username.trim().toLowerCase();
  if (!name) {
    acctForm.check = "";
    return;
  }
  if (!/^[a-z][a-z0-9_]{3,15}$/.test(name)) {
    acctForm.check = "invalid";
    return;
  }
  checkTimer = setTimeout(() => {
    checkTimer = null;
    void window.pokebuddyManage.account({ action: "check-username", username: name }).then((r) => {
      if (acctForm.username.trim().toLowerCase() !== name) return; // 그사이 바뀌었다
      acctForm.check = r?.check ?? "NETWORK";
      redrawAccount();
    });
  }, 500);
}

// 로그인 전 — 익명 저장 줄(또는 분실 안내), 로그인 권유 한 줄, GitHub·로그인 폼 (design-p2.md 5절)
function drawSignIn(scroll: HTMLElement): void {
  const a = acct;
  const blocked = !!a?.blocked;
  if (blocked) scroll.appendChild(acctNotice("교환 중에는 계정을 바꿀 수 없어요", "교환을 끝내거나 나간 뒤 다시 시도해 주세요", "warn"));
  // 분실(D29) — 창은 메인이 띄운다. 여기서는 짧은 상태만
  if (a?.lost) scroll.appendChild(acctNotice("저장 정보를 찾지 못했어요", a.lost === "member" ? "다시 로그인하면 계정 저장으로 이어서 해요" : "로그인하면 다시 계정에 저장해요", "warn"));
  else if (a) {
    const line = saveLine(a.cloud);
    if (a.anonymous || line) scroll.appendChild(acctRow(a.anonymous ? "익명으로 저장 중" : "저장", line));
  }
  if (!blocked && !a?.lost) scroll.appendChild(el("div", "acct-lead", "로그인하면 다른 PC 에서도 이어서 하고 교환할 수 있어요"));
  if (acctGithub) {
    // 기다리는 동안 다른 단추는 막히고 취소만 된다(R3-08)
    const wait = el("div", "acct-inline acct-github-wait");
    wait.append(el("span", "acct-lead", "브라우저에서 GitHub 로그인을 마쳐 주세요"), actionButton("취소", false, false, () => void window.pokebuddyManage.account({ action: "github-cancel" })));
    scroll.appendChild(wait);
  } else {
    const gh = button("act acct-github", "GitHub로 계속");
    gh.disabled = blocked || acctBusy;
    gh.addEventListener("click", () => {
      acctGithub = true;
      void acctSend({ action: "github" }).finally(() => { acctGithub = false; redrawAccount(); });
    });
    scroll.appendChild(gh);
  }
  const or = el("div", "acct-or");
  or.append(el("span"), document.createTextNode("또는"), el("span"));
  scroll.appendChild(or);
  scroll.appendChild(acctField("아이디", acctInput("acct-user", acctForm.username, "아이디", "text", (v) => { acctForm.username = v; })));
  const pass = acctInput("acct-pass", acctForm.password, "비밀번호", "password", (v) => { acctForm.password = v; });
  pass.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void signIn();
  });
  scroll.appendChild(acctField("비밀번호", pass, acctForm.error ? { text: acctForm.error, tone: "bad" } : undefined));
}

function drawSignUp(scroll: HTMLElement): void {
  const back = el("div", "acct-lead");
  const link = button("acct-back", "‹ 로그인");
  link.addEventListener("click", () => {
    acctForm.mode = "sign-in";
    acctForm.error = "";
    redrawAccount();
  });
  back.appendChild(link);
  scroll.appendChild(back);
  const grid = el("div", "acct-grid");
  const user = acctInput("acct-new-user", acctForm.username, "아이디", "text", (v) => {
    acctForm.username = v;
    const before = acctForm.check;
    scheduleUsernameCheck();
    if (acctForm.check !== before) redrawAccount();
  });
  grid.append(
    acctField("아이디", user, usernameNote()),
    acctField("이름", acctInput("acct-new-name", acctForm.displayName, "이름", "text", (v) => { acctForm.displayName = v; }), { text: "화면에 보이는 이름 · 1~12자", tone: "idle" }),
    acctField("비밀번호", acctInput("acct-new-pass", acctForm.password, "비밀번호", "password", (v) => { acctForm.password = v; }), { text: "8자 이상", tone: "idle" }),
    acctField("비밀번호 확인", acctInput("acct-new-pass2", acctForm.password2, "비밀번호 확인", "password", (v) => { acctForm.password2 = v; })),
  );
  scroll.appendChild(grid);
  const warn = el("div", "acct-note warn");
  warn.append(el("i"), document.createTextNode("비밀번호를 잊으면 찾을 수 없어요"));
  scroll.appendChild(warn);
  if (acctForm.error) {
    const err = el("div", "acct-note bad");
    err.append(el("i"), document.createTextNode(acctForm.error));
    scroll.appendChild(err);
  }
}

// 계정 탭 한 줄 — 단추가 없으면 글자만 둔다(저장 줄)
function acctRow(title: string, hint: string, control?: HTMLElement): HTMLElement {
  const row = el("div", "setting acct-row");
  const body = el("div", "body");
  body.append(el("div", "label", title), el("div", "hint", hint));
  row.appendChild(body);
  if (control) row.appendChild(control);
  return row;
}

function drawSignedIn(scroll: HTMLElement): void {
  const a = acct!;
  if (acct?.blocked) scroll.appendChild(acctNotice("교환 중에는 계정을 바꿀 수 없어요", "교환을 끝내거나 나간 뒤 다시 시도해 주세요", "warn"));
  // 이름
  const who = a.method === "github" ? `GitHub · ${a.displayName ?? ""}` : `아이디 ${a.username ?? ""}`;
  if (acctRename != null) {
    const input = acctInput("acct-rename", acctRename, "이름", "text", (v) => { acctRename = v; });
    input.disabled = acctBusy;
    const ctl = el("div", "acct-inline");
    ctl.append(
      input,
      actionButton("취소", false, acctBusy, () => { acctRename = null; redrawAccount(); }),
      actionButton("저장", true, acctBusy, () => {
        void acctSend({ action: "rename", displayName: acctRename ?? "" }).then((r) => {
          if (r?.ok) {
            acctRename = null;
            redrawAccount();
          }
        });
      }),
    );
    scroll.appendChild(acctRow(a.displayName ?? "", acctForm.error || who, ctl));
  } else {
    scroll.appendChild(acctRow(a.displayName ?? "", who, actionButton("이름 바꾸기", false, acctBusy, () => { acctRename = a.displayName ?? ""; acctForm.error = ""; redrawAccount(); })));
  }
  // 저장 — 자동으로만 올린다. 상태 글자와, 상태가 말하지 않는 오류만
  scroll.appendChild(acctRow("저장", saveLine(a.cloud)));
  // 로그아웃·삭제 — 둘 다 확인 창을 거친다. 이 PC 는 처음부터 새로 시작한다(D12)
  scroll.appendChild(acctRow("로그아웃", "이 PC 는 처음부터 새로 시작해요", actionButton("로그아웃", false, acctBusy || a.blocked, () => { acctConfirm = "sign-out"; acctForm.error = ""; redrawAccount(); })));
  scroll.appendChild(acctRow("계정 삭제", "되돌릴 수 없어요", actionButton("계정 삭제", false, acctBusy || a.blocked, () => { acctConfirm = "delete"; acctForm.error = ""; redrawAccount(); })));
}

// 사용자 모달 위의 작은 확인 창 — 로그아웃·계정 삭제
function acctOverlay(): HTMLElement | null {
  const a = acct;
  if (!a) return null;
  const box = el("div", "acct-overlay");
  const card = el("div", "acct-confirm");
  const head = el("div", "acct-confirm-head");
  const x = button("dialog-close", "✕");
  x.setAttribute("aria-label", "닫기");
  const shut = (): void => { acctConfirm = null; redrawAccount(); };
  x.addEventListener("click", shut);
  // 성공하면 앱이 다시 켜진다. 실패하면 창을 두고 이유를 보인다
  const run = (action: "delete" | "sign-out"): void => {
    void acctSend({ action }).then((r) => {
      if (r?.ok) acctConfirm = null;
      redrawAccount();
    });
  };
  // 서버에 올리지 못한 진행이 있을 수 있다 — 막지는 않고 알린다(검수 M3)
  const unsyncedNote = (): HTMLElement | null => {
    if (!a.unsynced) return null;
    const line = el("div", "acct-note warn");
    line.append(el("i"), document.createTextNode("올리지 못한 진행은 이 PC 백업에만 남아요"));
    return line;
  };
  const failed = (): HTMLElement | null => {
    if (!acctForm.error) return null;
    const line = el("div", "acct-note bad");
    line.append(el("i"), document.createTextNode(acctForm.error));
    return line;
  };
  if (acctConfirm === "delete") {
    head.append(el("h3", undefined, "계정을 삭제할까요?"), x);
    card.append(head, el("p", "acct-confirm-body", "계정과 저장을 지우고 이 PC 는 처음부터 새로 시작해요. 되돌릴 수 없어요."));
    const risk = unsyncedNote();
    if (risk) card.appendChild(risk);
    const err = failed();
    if (err) card.appendChild(err);
    card.appendChild(actions(el("div", "spacer"), actionButton("취소", false, acctBusy, shut), actionButton("삭제", true, acctBusy, () => run("delete"))));
  } else if (acctConfirm === "sign-out") {
    head.append(el("h3", undefined, "로그아웃할까요?"), x);
    card.append(head, el("p", "acct-confirm-body", "로그아웃하면 이 PC 는 처음부터 새로 시작해요. 계정 저장은 그대로라 다시 로그인하면 이어서 할 수 있어요."));
    const risk = unsyncedNote();
    if (risk) card.appendChild(risk);
    const err = failed();
    if (err) card.appendChild(err);
    card.appendChild(actions(el("div", "spacer"), actionButton("취소", false, acctBusy, shut), actionButton("로그아웃하고 새로 시작", true, acctBusy, () => run("sign-out"))));
  } else return null;
  box.appendChild(card);
  return box;
}

async function signIn(): Promise<void> {
  if (!acctForm.username.trim() || !acctForm.password) {
    acctForm.error = ACCT_ERROR.AUTH_INVALID_LOGIN ?? "";
    redrawAccount();
    return;
  }
  const r = await acctSend({ action: "sign-in", username: acctForm.username, password: acctForm.password });
  if (r?.ok) Object.assign(acctForm, { password: "", password2: "", error: "" });
}

async function signUp(): Promise<void> {
  if (acctForm.password !== acctForm.password2) {
    acctForm.error = "비밀번호가 서로 달라요";
    redrawAccount();
    return;
  }
  const r = await acctSend({ action: "sign-up", username: acctForm.username, displayName: acctForm.displayName, password: acctForm.password });
  if (r?.ok) Object.assign(acctForm, { mode: "sign-in", password: "", password2: "", displayName: "", error: "", check: "" });
}

function drawAccount(scroll: HTMLElement): void {
  if (!acct) {
    scroll.appendChild(el("div", "empty-note", "계정 상태를 읽는 중이에요."));
    void loadAccount();
    return;
  }
  if (!acct.available) {
    scroll.appendChild(el("div", "empty-note", "계정을 쓸 수 없어요."));
    return;
  }
  if (acct.signedIn) drawSignedIn(scroll);
  else if (acctForm.mode === "sign-up") drawSignUp(scroll);
  else drawSignIn(scroll);
}

// 계정 탭 바닥 단추 — 로그인 화면은 가입·로그인, 가입 화면은 가입, 로그인 뒤는 없음. 닫기 단추는 없다(✕·바깥 클릭·Esc).
// 버전·업데이트는 설정 모달 바닥에만 둔다 — 왼쪽 빈 자리(spacer)로 단추를 오른쪽에 붙인다
function accountActions(): HTMLElement | null {
  const a = acct;
  if (!a?.available || a.signedIn) return null;
  const off = acctBusy || a.blocked;
  const left = el("span", "spacer");
  if (acctForm.mode === "sign-up") return actions(left, actionButton("가입", true, off, () => void signUp()));
  return actions(left, actionButton("가입", false, off, () => { acctForm.mode = "sign-up"; acctForm.error = ""; redrawAccount(); }), actionButton("로그인", true, off, () => void signIn()));
}

// ── 우편함 ─────────────────────────────────────────────────────────────────────
// Figma 05 Screens 섹션 `10 우편함` `932:22859` — 목록 `908:5779` · 편지 로그인 전 `932:22703` · 받기 전 `908:6022` · 받은 뒤(일반 편지) `908:6232`.
// 편지는 받은 뒤에도 남는다. 선물은 로그인해야 받는다. 서버 호출과 저장은 메인이 한다(src/main/mail.ts) — 여기서는 편지 id 만 보낸다
// (2026-09-28 사용자 "a안으로 진행", 2026-09-29 "개발진행", worklog/records/post-box/record.md)
let mailView: MailScreen | null = null;
const mailBtn = need("open-mail", HTMLButtonElement);
const mailDotEl = need("mail-dot", HTMLElement);

function setMail(screen: MailScreen): void {
  mailView = screen;
  mailBtn.hidden = !screen.available;
  mailDotEl.hidden = screen.unread === 0;
  if (dialog?.kind === "mail" || dialog?.kind === "letter") drawDialog();
}

async function refreshMail(): Promise<void> {
  try {
    const r = await window.pokebuddyManage.mail({ action: "refresh" });
    if (r) setMail(r.screen);
  } catch (e) {
    console.error(e); // 메인이 답하지 못했다 — 봉투 단추는 지난 상태 그대로
  }
}

const MAIL_ERROR: Record<string, string> = {
  MAIL_LOGIN_REQUIRED: "로그인하면 받을 수 있어요.",
  MAIL_EXPIRED: "기간이 지나 받을 수 없어요.",
  MAIL_NOT_FOUND: "편지를 찾지 못했어요.",
  MAIL_NO_GIFTS: "받을 선물이 없어요.",
  NETWORK: "서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.",
  "bad-gift": "앱을 업데이트하면 받을 수 있어요.",
  "cloud-wait": "클라우드 저장이 연결되면 받을 수 있어요. 계정 탭에서 저장 상태를 확인해 주세요.",
};

const monthDay = (at: number): string => {
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};
// 남은 기간 — 하루 이상이면 날, 아래면 시간
function mailLeft(endsAt: number): string {
  const ms = endsAt - Date.now();
  if (ms <= 0) return "기간 지남";
  const days = Math.floor(ms / 86_400_000);
  return days >= 1 ? `${days}일 남음` : `${Math.max(1, Math.ceil(ms / 3_600_000))}시간 남음`;
}
const mailExpired = (l: MailLetterView): boolean => l.endsAt != null && l.endsAt <= Date.now();
// 받을 선물이 남았다 — 기간 안이고 이 저장에 넣지 않았다
const mailOpen = (l: MailLetterView): boolean => l.gifts.length > 0 && !l.applied && !mailExpired(l);
// 보낸 이 · 날짜, 받을 선물이 남은 편지는 남은 기간까지 — Figma "PokeBuddy · 9월 28일 · 7일 남음"
function mailMeta(l: MailLetterView): string {
  const parts = [l.sender, monthDay(l.startsAt)];
  if (mailOpen(l) && l.endsAt != null) parts.push(mailLeft(l.endsAt));
  return parts.join(" · ");
}
const giftIcon = (g: MailGiftView, cls: string): HTMLElement =>
  g.kind === "item" ? iconOf(`item:${g.id}`, cls) : g.kind === "pokemon" && g.id ? portraitOf(g.id, false, cls) : el("span", `${cls} gift-point`, "P");
// 받은 선물이 들어간 곳 — 가방(도구)·박스(포켓몬)·포인트
function giftWhere(gifts: readonly MailGiftView[]): string {
  const places = [gifts.some((g) => g.kind === "item") && "가방", gifts.some((g) => g.kind === "pokemon") && "박스", gifts.some((g) => g.kind === "points") && "포인트"].filter((p): p is string => !!p);
  if (places.length === 1 && places[0] === "포인트") return "포인트에 더해졌어요";
  // 앞 단어에 받침이 있으면 "과"(가방과), 없으면 "와"(박스와)
  const and = (w: string): string => ((w.charCodeAt(w.length - 1) - 0xac00) % 28 ? `${w}과` : `${w}와`);
  return `${places.map((p, i) => (i < places.length - 1 ? and(p) : p)).join(" ")}에 들어갔어요`;
}

// 봉투 — Figma `Icon / Mail` `907:578`. 헤더 단추와 같은 선 그림
function envelope(cls: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", cls);
  for (const d of ["M3.5 5.5h13v9h-13z", "M3.5 5.5l6.5 5 6.5-5"]) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

// 모달 머리 — 제목(편지면 ‹ 돌아가기)과 오른쪽 위 닫기
function mailHead(title: string, back: boolean): void {
  const head = el("div", "settings-head");
  const titles = el("div", "titles mail-titles");
  if (back) {
    const b = button("back", "‹");
    b.setAttribute("aria-label", "우편함으로");
    b.addEventListener("click", () => open({ kind: "mail" }));
    titles.appendChild(b);
  }
  titles.appendChild(el("h2", undefined, title));
  const x = button("dialog-close", "✕");
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", close);
  head.append(titles, x);
  dialogEl.appendChild(head);
}

function mailRow(l: MailLetterView): HTMLElement {
  const row = button("mail-row");
  const dot = el("span", "mail-unread");
  dot.hidden = l.read && !mailOpen(l); // 안 읽음 점 — 받을 선물이 남아도 둔다
  const text = el("div", "mail-text");
  text.append(el("div", "mail-title", l.title), el("div", "mail-meta", mailMeta(l)));
  row.append(dot, envelope("mail-icon"), text);
  const first = l.gifts[0];
  if (l.applied) row.appendChild(el("span", "mail-chip done", "받음"));
  else if (first) {
    const chip = el("span", "mail-chip");
    const more = l.gifts.length > 1 ? ` 외 ${l.gifts.length - 1}` : "";
    chip.append(giftIcon(first, "mail-chip-icon"), document.createTextNode(`${first.name} ×${first.count.toLocaleString("ko-KR")}${more}`));
    row.appendChild(chip);
  }
  row.appendChild(el("span", "mail-more", "›"));
  row.addEventListener("click", () => openLetter(l.id));
  return row;
}

function openLetter(id: string): void {
  open({ kind: "letter", id });
  const l = mailView?.letters.find((x) => x.id === id);
  if (l && !l.read)
    void window.pokebuddyManage
      .mail({ action: "read", id })
      .then((r) => r && setMail(r.screen))
      .catch((e: unknown) => console.error(e));
}

function drawMail(): void {
  mailHead("우편함", false);
  const scroll = el("div", "scroll mail-list");
  const letters = mailView?.letters ?? [];
  if (!letters.length) {
    const word = !mailView || mailView.status === "loading" ? "우편함을 읽는 중입니다." : mailView.status === "offline" ? "우편함을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요." : "받은 편지가 없어요.";
    scroll.appendChild(el("div", "empty-note", word));
  } else {
    for (const l of letters) scroll.appendChild(mailRow(l));
    scroll.appendChild(el("div", "mail-note", "선물이 든 편지는 열어서 받아요. 기간이 지나면 받을 수 없어요."));
  }
  dialogEl.appendChild(scroll);
}

// 선물 카드 — 받기 전은 `선물 N` 과 `받기`, 받은 뒤는 흐린 `받은 선물` · `받음` 과 받은 날
function giftCard(l: MailLetterView): HTMLElement {
  const done = l.applied;
  const card = el("div", done ? "gift-card done" : "gift-card");
  const head = el("div", "gift-head");
  head.append(el("strong", undefined, done ? "받은 선물" : `선물 ${l.gifts.length}`), el("span", "spacer"));
  const busy = mailView?.busy === l.id;
  if (done) head.appendChild(el("span", "gift-done", "받음"));
  else {
    const blocked = !mailView?.signedIn || mailExpired(l) || l.unsupported || busy;
    head.appendChild(
      actionButton(busy ? "받는 중" : "받기", true, blocked, () => {
        void window.pokebuddyManage
          .mail({ action: "claim", id: l.id })
          .then(async (r) => {
            if (!r) return;
            setMail(r.screen);
            if (r.ok) await refresh(); // 가방·포인트가 바뀌었다
          })
          .catch((e: unknown) => console.error(e));
      }),
    );
  }
  card.appendChild(head);
  for (const g of l.gifts) {
    const row = el("div", "gift-row");
    row.append(giftIcon(g, "gift-icon"), el("strong", undefined, g.name), el("span", "gift-count", `×${g.count.toLocaleString("ko-KR")}`));
    card.appendChild(row);
  }
  const foot = el("div", "gift-foot");
  if (done) {
    const where = giftWhere(l.gifts);
    foot.textContent = `${l.claimedAt ? `${monthDay(l.claimedAt)}에 받았어요 · ` : ""}${where}`;
  } else if (l.unsupported) foot.textContent = MAIL_ERROR["bad-gift"] ?? "";
  else if (mailExpired(l)) foot.textContent = MAIL_ERROR.MAIL_EXPIRED ?? "";
  else if (!mailView?.signedIn) {
    foot.append(el("span", undefined, "로그인하면 받을 수 있어요."), actionButton("로그인", false, false, () => open({ kind: "user", tab: "account" })));
    foot.classList.add("login");
  } else if (mailView.error && !busy) foot.textContent = MAIL_ERROR[mailView.error] ?? `받지 못했어요 (${mailView.error})`;
  if (foot.childNodes.length) card.appendChild(foot);
  return card;
}

function drawLetter(id: string): void {
  const l = mailView?.letters.find((x) => x.id === id);
  if (!l) {
    open({ kind: "mail" });
    return;
  }
  mailHead(l.title, true);
  const scroll = el("div", "scroll mail-letter");
  scroll.append(el("div", "mail-meta", mailMeta(l)), el("div", "mail-body", l.body));
  if (l.gifts.length || l.unsupported) scroll.appendChild(giftCard(l));
  dialogEl.appendChild(scroll);
}

mailBtn.addEventListener("click", () => {
  open({ kind: "mail" });
  void refreshMail();
});
window.pokebuddyManage.onMail(setMail);
void refreshMail();

window.pokebuddyManage.onAccount((screen) => {
  acct = screen;
  drawSaveIndicator();
  redrawAccount();
  redrawTrade(); // 익명·로그인이 바뀌면 교환 모달의 로그인 안내도 바뀐다
});
void loadAccount();
setInterval(drawSaveIndicator, 30_000); // "3분 전" 글자만 바꾼다

// ── 그리기 ─────────────────────────────────────────────────────────────────────

// 탭 아이콘 — Figma 03 `Primary Navigation` `208:542` 의 16px 그림 그대로(선 색은 CSS)
const TAB_ICON: Record<TabId, string> = {
  party: '<path d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z" stroke-width="1.5"/><path d="M2.7 8h3.6m3.4 0h3.6" stroke-width="1.5" stroke-linecap="round"/><path d="M8 9.7a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z" stroke-width="1.5"/>',
  box: '<path d="M3.5 2.5h9c.83 0 1.5.67 1.5 1.5v8c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5V4c0-.83.67-1.5 1.5-1.5Z" stroke-width="1.5" stroke-linecap="round"/><path d="M2 6.5h12M6.5 9.5h3" stroke-width="1.5" stroke-linejoin="round"/>',
  dex: '<path d="M4 3.25h7.25c.97 0 1.75.78 1.75 1.75v6.25c0 .97-.78 1.75-1.75 1.75h-6.5C3.78 13 3 12.22 3 11.25V5c0-.97.78-1.75 1.75-1.75H4Z" stroke-width="1.35" stroke-linejoin="round"/><path d="M4.1 3.2 5 1.9m.6 3.7h3.9M5.6 8h4.8m-4.8 2.4h3.1" stroke-width="1.35" stroke-linecap="round"/><circle cx="4.9" cy="5.6" r=".55" fill="currentColor" stroke="none"/><circle cx="4.9" cy="8" r=".55" fill="currentColor" stroke="none"/><circle cx="4.9" cy="10.4" r=".55" fill="currentColor" stroke="none"/>',
  shop: '<path d="M3.2 6.4h9.6v6.2H3.2V6.4Z" stroke-width="1.25" stroke-linejoin="round"/><path d="M2.5 6.4 3.7 3.2h8.6l1.2 3.2h-11Z" stroke-width="1.25" stroke-linejoin="round"/><path d="M6.55 12.6V9.2h2.9v3.4" stroke-width="1.25" stroke-linejoin="round"/><circle cx="8" cy="4.8" r="1.1" stroke-width="1.05"/><path d="M6.9 4.8h.55m1.1 0h.55" stroke-width="1.05" stroke-linecap="round"/>',
  bag: '<path d="M12.5 5.5h-9C2.67 5.5 2 6.17 2 7v6c0 .83.67 1.5 1.5 1.5h9c.83 0 1.5-.67 1.5-1.5V7c0-.83-.67-1.5-1.5-1.5Z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 5.5V4a2.75 2.75 0 0 1 5.5 0v1.5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
};

function drawTabs(): void {
  tabsEl.replaceChildren();
  for (const t of TABS) {
    const b = button("");
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" style="color: var(--muted)">${TAB_ICON[t.id]}</svg>`; // 고정 그림 — 사용자 값이 들어가지 않는다
    b.appendChild(el("span", undefined, t.label));
    b.setAttribute("aria-selected", String(t.id === tab));
    b.addEventListener("click", () => {
      setTab(t.id);
      draw();
    });
    tabsEl.appendChild(b);
  }
}

// 탭 옮기기 — 탭을 바꾸는 곳은 모두 여기를 거친다. 그리기는 부르는 쪽이 한다
// - 나가는 탭의 상세 기기 창을 닫는다: 파티·박스는 개체 상세, 도감은 도감 기기 창 (2026-09-30 사용자 결정 "그냥 해당 탭을 나가면 상세 닫게해.")
// - 같은 탭이면 아무것도 닫지 않는다. 다시 그 탭에 와도 상세를 다시 열지 않는다
function setTab(next: TabId): void {
  if (next === tab) return;
  detailPet = null; // 개체 상세는 파티·박스에서만 열린다 — 다음 draw 의 syncPetDevice 가 기기 창을 닫는다
  if (tab === "dex" && dexPick) {
    dexPick = null;
    window.pokebuddyManage.dexOpen(null, dexGen);
  }
  tab = next;
  bagResult = ""; // 가방 결과 줄은 탭을 떠나면 지운다
  if (next === "dex" && !dexRows) void loadDex();
}

function draw(): void {
  if (typingSearch(bodyEl)) {
    bodyHeld = true; // 검색 칸을 떠나면 그린다 (releaseHeld)
    return;
  }
  bodyHeld = false;
  const kept = focusPath();
  drawBody();
  restoreFocusPath(kept);
}

function drawBody(): void {
  drawTabs();
  bodyEl.replaceChildren();
  if (!view) {
    bodyEl.appendChild(el("div", "empty-note", "저장이 없습니다. 첫 포켓몬을 먼저 고르세요."));
    return;
  }
  pointsEl.textContent = view.points.toLocaleString("ko-KR");
  achDotEl.hidden = view.achievements.unclaimed === 0;
  // 개체 상세 — 옆 기기 창. 개체가 사라졌으면 닫는다
  if (detailPet && !petOf(detailPet)) detailPet = null;
  syncPetDevice();
  if (tab === "party") drawParty(view);
  else if (tab === "box") drawBox(view);
  else if (tab === "dex") drawDex(view);
  else if (tab === "shop") drawShop(view);
  else drawBag(view);
  drawSaveFailing();
  restoreSearchFocus();
  drawTutorial();
}

// 이어진 저장 실패 안내 — 제목 줄 바로 아래. 한 번 저장하면 다음 새로 읽기에서 사라진다. 조작은 막지 않는다
// Figma 05 `Party / Save Failing` `716:17993` (Alert Tone=Error). 2026-09-27 사용자 "그렇게해"
function drawSaveFailing(): void {
  if (!view?.saveFailing) return;
  const banner = alertBox("bad", "저장하지 못하고 있어요", "3번 이어서 저장하지 못했어요. 디스크 공간과 폴더 권한을 확인해 주세요.");
  banner.classList.add("save-failing");
  const first = bodyEl.firstElementChild;
  if (first?.classList.contains("head")) first.after(banner);
  else bodyEl.prepend(banner);
}

// ── 튜토리얼 코치마크 ───────────────────────────────────────────────────────────
// Figma `Tutorial / Shop` `399:8590` · `Hatch` `399:8901` · `Party` `399:9159`. 모두 한 단계다(2026-09-26 사용자 결정).
// 대상 둘레 8px 을 비우고 네 장의 배경막으로 덮는다. 대상은 그대로 누를 수 있다. 말풍선은 대상 바로 아래(넘치면 위).
// 무엇을 보여 줄지는 스냅샷 `tutorial` 이 정한다(src/tutorial/core.ts). 그 탭에 있을 때만 그린다 — 화면을 강제로 바꾸지 않는다.
// 문구는 Figma 그대로다 (2026-09-26 사용자 결정 "figma대로 진행")

// guide* 는 그 탭이 아닌 곳에 있을 때 탭 버튼으로 이어 주는 말풍선이다 (Figma 시안 E `514:1670` · F `514:2182`)
interface TutorialText {
  name: string;
  tab: TabId;
  title: string;
  body: string;
  guideTitle: string;
  guideBody: string;
  guideButton: string;
}
const TUTORIAL_TEXT: Record<string, TutorialText> = {
  shop: {
    name: "상점", tab: "shop", title: "시작 포인트로 랜덤알 하나를 살 수 있어요", body: "",
    guideTitle: "시작 포인트로 랜덤알 하나를 살 수 있어요", guideBody: "", guideButton: "상점으로 가기",
  },
  hatch: {
    name: "부화", tab: "box", title: "알은 5분 뒤에 준비돼요", body: "준비가 끝나면 열기를 눌러야 부화해요.", // 알 돌봄 삭제(2026-09-28) — Figma `399:8901` 문구는 튜토리얼 전수 개선 때 맞춘다
    guideTitle: "알은 박스의 돌보미집에 들어갔어요", guideBody: "", guideButton: "박스로 가기",
  },
};
// 업적 튜토리얼 — 헤더의 업적 아이콘을 밝힌다 (Figma 시안 G `514:2444`). 어느 탭에서든 보인다
const ACHIEVEMENT_GUIDE = { title: "보상을 받으면 파티 칸이 하나 열려요", body: "", button: "업적 보기" };

// 새 기능 튜토리얼 — 문구는 Figma 05 Screens 섹션 `13 튜토리얼 · 관리 창` `930:18248` 그대로다
// (2026-09-29 사용자 "새 기능 튜토리얼 8종 … 개발진행", worklog/records/tutorial-overhaul/record.md "새 기능 튜토리얼 8종 — 코드 설계").
// 파티 1/2 · 진화는 파티 카드를 밝힌다 — 상세는 옆 기기 창이다(Figma `932:17544` · `932:18610`)
interface GuideStep {
  title: string;
  body: string;
  target: () => HTMLElement | null;
  also?: () => HTMLElement | null; // 함께 밝힐 요소 — 구멍을 둘을 감싸는 사각형으로 넓힌다
  tryIt?: boolean; // 대상을 눌러야 넘어간다 — 다음 단추를 두지 않는다
  interactive?: boolean; // 대상도 눌린다(목표 행동)
  words?: () => { title: string; body: string } | null; // 화면 상태에 따라 바꿀 문구 — null 이면 title·body 그대로
}
interface Guide {
  name: string; // 말풍선 머리의 "튜토리얼 · {name}"
  tab: TabId | null; // 이 탭에서 보인다. null 이면 어느 탭이든
  go: string; // 다른 탭에 있을 때 탭 단추로 이어 주는 말풍선의 단추
  steps: GuideStep[];
  step?: () => number; // 화면 상태로 단계를 정한다(가방 — 사용 판이 열렸는가, 사용자 — 연결 탭인가)
  onNext?: () => void; // 다음 단추가 할 일 — 없으면 단계만 넘긴다
}
const firstPetCard = (): HTMLElement | null => bodyEl.querySelector<HTMLElement>(".grid .slot[data-pet]");
const tabButton = (id: TabId): HTMLElement | null => (tabsEl.children[TABS.findIndex((t) => t.id === id)] as HTMLElement | undefined) ?? null;
// 사용자 모달의 첫 블록(계정 · CLI 목록) — 스크롤 영역 전체를 밝히면 말풍선이 탭을 가린다
const dialogScroll = (): HTMLElement | null => dialogEl.querySelector<HTMLElement>(".scroll > *:first-child") ?? dialogEl.querySelector<HTMLElement>(".scroll");
// 지금 진화할 수 있는 파티 개체의 카드
const evolveCard = (): HTMLElement | null => {
  const pet = partyPets().find((p) => p.evolutions.some((e) => e.ready));
  return pet ? bodyEl.querySelector<HTMLElement>(`.slot[data-pet="${CSS.escape(pet.id)}"]`) : null;
};
const GUIDES: Record<string, Guide> = {
  growth: {
    name: "성장", tab: "party", go: "파티로 가기",
    steps: [
      { title: "친밀도는 함께한 시간만큼 올라요", body: "밥 주기·놀아주기로 더 올라요. 높을수록 포인트가 빨리 쌓여요.", target: () => firstPetCard()?.querySelector<HTMLElement>(".meters > .meter:first-child") ?? null },
      { title: "배고프면 친밀도가 덜 올라요", body: "만복도는 시간이 지나면 줄어요. 밥을 주면 채워져요.", target: () => firstPetCard()?.querySelector<HTMLElement>(".meters > .meter:last-child") ?? null },
      { title: "레벨은 사탕으로 올려요", body: "경험치는 친밀도와 따로 쌓여요. 가방의 경험사탕을 써요.", target: () => firstPetCard()?.querySelector<HTMLElement>(".top") ?? null },
    ],
  },
  points: {
    name: "포인트", tab: null, go: "",
    steps: [{ title: "파티 포켓몬이 포인트를 모아요", body: "상점에서 알과 도구를 살 때 써요.", target: () => document.querySelector<HTMLElement>(".point-chip") }],
  },
  party: {
    name: "파티", tab: "party", go: "파티로 가기",
    steps: [
      { title: "볼에 넣으면 바탕화면에서 쉬어요", body: "볼 안에서도 성장은 이어져요.", target: firstPetCard },
      { title: "박스에 보관하면 성장이 멈춰요", body: "파티 칸이 모자라면 박스에 맡겨요.", target: () => tabButton("box") },
    ],
  },
  bag: {
    name: "가방", tab: "bag", go: "가방으로 가기",
    // 도구를 눌러 사용 판이 열리면 2단계, 판을 닫으면 1단계로 돌아간다
    step: () => (bodyEl.querySelector(".use-panel") ? 1 : 0),
    steps: [
      { title: "쓸 도구를 골라요", body: "경험사탕은 레벨을, 먹이와 장난감은 친밀도를 올려요.", target: () => bodyEl.querySelector<HTMLElement>(".bag-grid"), tryIt: true },
      {
        title: "대상을 고르고 사용을 눌러요",
        body: "여러 개를 한 번에 쓸 수 있어요.",
        target: () => bodyEl.querySelector<HTMLElement>(".use-panel"),
        interactive: true,
        words: bagGuideWords, // 진화용 도구·성격민트 판에는 대상 목록·사용 단추가 없다 — 그 판의 단추를 가리키는 문구(제안, 검수 R9-1)
      },
    ],
  },
  evolution: {
    name: "진화", tab: "party", go: "파티로 가기",
    steps: [{ title: "조건을 채우면 진화할 수 있어요", body: "진화는 직접 눌러야 해요.", target: evolveCard, interactive: true }],
  },
  dex: {
    name: "도감", tab: "dex", go: "",
    steps: [{ title: "칸을 누르면 입수 방법이 보여요", body: "아직 해금하지 않은 포켓몬은 실루엣으로 보여요.", target: () => bodyEl.querySelector<HTMLElement>(".dex-grid .dex-cell"), interactive: true }],
  },
  // 교환 모달을 처음 열 때 — 모달 안의 링크 만들기·링크로 참가 줄을 밝힌다 (Figma 05 `Tutorial / Trade` `1036:24561`)
  trade: {
    name: "교환", tab: null, go: "",
    steps: [{ title: "링크로 친구와 한 마리씩 바꿔요", body: "링크를 만들어 보내거나, 받은 링크로 참가해요.", target: () => dialogEl.querySelector<HTMLElement>('[data-tut="trade"]') }],
  },
  user: {
    name: "사용자", tab: null, go: "",
    step: () => (dialog?.kind === "user" && dialog.tab === "agents" ? 1 : 0),
    onNext: () => {
      if (!agentRows) void loadAgents();
      open({ kind: "user", tab: "agents" });
    },
    steps: [
      { title: "로그인하면 다른 컴퓨터에서도 이어서 해요", body: "지금 진행도 익명 저장으로 서버에 올라가요.", target: dialogScroll },
      // CLI 목록 전체 — 첫 줄부터 아래 안내 줄까지
      { title: "CLI 를 연결하면 더 빨리 자라요", body: "에이전트가 일하는 동안 친밀도와 포인트가 두 배로 쌓여요.", target: dialogScroll, also: () => dialogEl.querySelector<HTMLElement>(".scroll .agents-note") },
    ],
  },
};
let coachId: string | null = null; // 지금 떠 있는 코치마크의 튜토리얼
let guideId: string | null = null; // 단계를 세는 튜토리얼 — 바뀌면 1단계부터
let guideStep = 0;

// 새 기능 튜토리얼 한 단계를 그린다. 대상이 없으면 그리지 않는다(다음 그리기에서 다시 본다)
function drawGuideStep(id: string): void {
  const guide = GUIDES[id];
  if (!guide) return;
  if (guideId !== id) {
    guideId = id;
    guideStep = 0;
  }
  const index = Math.min(guide.steps.length - 1, guide.step ? guide.step() : guideStep);
  const step = guide.steps[index];
  const target = step?.target() ?? null;
  if (!step || !target) return;
  const last = index === guide.steps.length - 1;
  const counter = guide.steps.length > 1 ? ` ${index + 1} / ${guide.steps.length}` : "";
  const words = step.words?.() ?? step;
  coachEl = coachLayer(id, target, {
    step: `튜토리얼 · ${guide.name}${counter}`,
    title: words.title,
    body: words.body,
    button: step.tryIt ? "" : last ? "확인" : "다음",
    onGo: () => {
      if (last) return void send("tutorial.done", id, { steps: guide.steps.length });
      if (guide.onNext) guide.onNext();
      else {
        guideStep = index + 1;
        drawTutorial();
      }
    },
    interactive: step.tryIt === true || step.interactive === true,
    also: step.also?.() ?? null,
  });
  coachId = id;
}

interface CoachSpec {
  step: string;
  title: string;
  body: string;
  button: string;
  onGo: () => void;
  // 구멍 안의 대상이 그 단계의 목표 행동인가(상점 카드·업적 아이콘·탭 버튼). 아니면 대상도 막고 다음·확인·✕ 만 받는다
  // (2026-09-28 사용자 "다음버튼이나 튜토리얼 행동이나, 아예 닫기버튼 이것들만 눌리게해줘")
  interactive?: boolean;
  also?: HTMLElement | null; // 함께 밝힐 요소 — 구멍을 둘을 감싸는 사각형으로 넓힌다(놀이공간 줄 + 화면 줄)
}
const COACH = { pad: 8, gap: 12, width: 280, margin: 8 };

let coachEl: HTMLElement | null = null;
let coachWatch: ResizeObserver | null = null; // 코치마크 대상의 크기 변화 — 바뀌면 다시 잰다
// 튜토리얼 중 초점을 둘 수 있는 곳 — 말풍선, 그리고 목표 행동이면 대상. 막 밖으로 Tab 이 나가면 말풍선 단추로 되돌린다
let coachAllows: ((n: Node) => boolean) | null = null;
let coachHome: HTMLElement | null = null;

// 개체 상세 튜토리얼은 파티 상세 기기 창이 그린다(src/renderer/pet.ts) — 끝내거나 닫으면 여기로 알려 와 기록한다

// 설정 › 화면 튜토리얼 — 줄마다 무엇인지 알리고 직접 해 보게 한다. 해 보는 단계는 다음 단추가 없고, 그 동작을 하면 넘어간다
// (2026-09-28 사용자 "화면 튜토리얼도 각각이 뭐가있고, 사용자가 직접해보는거까지 튜토리얼해").
// 바탕화면 표시 줄(포켓몬 표시·고스트 모드)이 없는 창이면 그 단계는 건너뛴다. 마지막 단계는 고른 놀이공간 방식을 설명한다
interface AreaStep {
  tut: string;
  also?: (v: Snapshot) => string | null; // 함께 밝힐 줄
  title: string;
  body: (v: Snapshot) => string;
  // 해 보는 단계 — 이 조건이 되면 넘어간다. start 는 단계에 들어온 때의 스냅샷
  until?: (v: Snapshot, start: Snapshot) => boolean;
  needsDisplay?: boolean;
}
const AREA_BODY: Record<string, string> = {
  all: "모든 화면이면 화면마다 놀아요. 끌어서 다른 화면으로 옮길 수 있어요.",
  screen: "한 화면이면 목록이나 화면에서 고르기로 놀 화면을 정해요.",
  region: "영역 지정이면 영역 그리기로 놀 곳을 직접 그려요.",
};
const AREA_STEPS: readonly AreaStep[] = [
  { tut: "set-hidden", title: "포켓몬 표시", body: () => "끄면 바탕화면의 포켓몬이 모두 숨어요. 스위치를 눌러 꺼 보세요.", until: (v) => v.display?.hidden === true, needsDisplay: true },
  { tut: "set-hidden", title: "다시 켜 보세요", body: () => "켜면 포켓몬이 다시 나와요.", until: (v) => v.display?.hidden === false, needsDisplay: true },
  { tut: "set-ghost", title: "고스트 모드", body: () => "켜면 포켓몬 위를 눌러도 뒤 창이 눌려요. 켜 보세요.", until: (v) => v.display?.clickThrough === true, needsDisplay: true },
  { tut: "set-ghost", title: "다시 꺼 보세요", body: () => "끄면 포켓몬을 다시 만질 수 있어요.", until: (v) => v.display?.clickThrough === false, needsDisplay: true },
  { tut: "area", title: "포켓몬이 놀 곳을 골라요", body: () => "모든 화면, 한 화면, 영역 지정이 있어요. 다른 칸을 눌러 보세요.", until: (v, start) => v.settings.playArea !== start.settings.playArea },
  {
    tut: "area",
    also: (v) => (v.settings.playArea === "screen" ? "area-screen" : v.settings.playArea === "region" ? "area-region" : null),
    title: "놀이공간을 바꿨어요",
    body: (v) => AREA_BODY[v.settings.playArea] ?? "",
  },
];
let areaStep = 0;
let areaStart: Snapshot | null = null; // 지금 단계에 들어온 때
// 쓸 수 있는 단계 — 바탕화면 표시 줄이 없으면 그 단계를 뺀다
const areaSteps = (v: Snapshot): AreaStep[] => AREA_STEPS.filter((st) => !st.needsDisplay || v.display != null);

function drawTutorial(): void {
  coachEl?.remove();
  coachEl = null;
  coachWatch?.disconnect();
  coachWatch = null;
  const id = view?.tutorial ?? null;
  coachAllows = null;
  coachHome = null;
  coachId = null;
  const screenTut = (tid: string): boolean => view?.screenTutorials?.includes(tid) === true;
  if (view && dialog?.kind === "user" && !dialogEl.querySelector(".acct-overlay") && screenTut("user")) {
    drawGuideStep("user"); // 사용자 모달을 처음 열 때 — 계정 → 연결
  } else if (view && dialog?.kind === "trade" && screenTut("trade")) {
    drawGuideStep("trade"); // 교환 모달을 처음 열 때
  } else if (view && !dialog && tab === "dex" && screenTut("dex")) {
    drawGuideStep("dex"); // 도감 탭을 처음 열 때
  } else if (view && dialog?.kind === "settings" && dialog.tab === "display" && view.areaTutorial) {
    // 설정 › 화면 — 줄마다 설명하고 직접 해 보게 한다. 바탕화면의 놀이공간 튜토리얼을 옮겨 왔다
    // (2026-09-28 사용자 "이 영역설명은 설정에서 설명하게 해야할거같아", Figma 99 `Tutorial / Playground · 설정`)
    const steps = areaSteps(view);
    // 해 보는 단계의 동작을 했으면 다음 단계로 — 설정이 바뀌면 스냅샷이 새로 와서 여기로 다시 온다
    for (;;) {
      const cur = steps[areaStep];
      if (!areaStart) areaStart = view;
      if (!cur?.until || !cur.until(view, areaStart) || areaStep >= steps.length - 1) break;
      areaStep += 1;
      areaStart = view;
    }
    const step = steps[areaStep];
    const target = step ? dialogEl.querySelector<HTMLElement>(`[data-tut="${step.tut}"]`) : null;
    if (step && target) {
      const alsoKey = step.also?.(view) ?? null;
      const tryIt = step.until != null;
      coachEl = coachLayer("area", target, {
        step: `튜토리얼 · 화면 ${areaStep + 1} / ${steps.length}`,
        title: step.title,
        body: step.body(view),
        button: tryIt ? "" : "확인", // 해 보는 단계는 그 동작으로만 넘어간다
        onGo: () => void send("tutorial.done", "area", { steps: steps.length }),
        interactive: tryIt,
        also: alsoKey ? dialogEl.querySelector<HTMLElement>(`[data-tut="${alsoKey}"]`) : null,
      });
    }
  } else if (id && view && !dialog && !detailPet) {
    const text = TUTORIAL_TEXT[id];
    const guide = GUIDES[id];
    if (guide && (guide.tab == null || guide.tab === tab)) {
      drawGuideStep(id);
    } else if (guide && guide.tab) {
      // 다른 탭에 있다 — 그 탭 버튼으로 이어 준다. 누를 때만 옮긴다(상점·부화 튜토리얼과 같다)
      const to = guide.tab;
      const target = tabButton(to);
      const first = guide.steps[0];
      if (target && first) {
        coachEl = coachLayer(id, target, {
          step: `튜토리얼 · ${guide.name}`,
          title: first.title,
          body: "",
          button: guide.go,
          onGo: () => {
            setTab(to);
            draw();
          },
          interactive: true,
        });
      }
    } else if (id === "achievement") {
      const done = view.achievements.list.find((a) => a.state === "achieved");
      const target = document.getElementById("open-achievements");
      if (done && target) {
        coachEl = coachLayer(id, target, { step: "튜토리얼 · 업적", ...ACHIEVEMENT_GUIDE, onGo: () => open({ kind: "achievements" }), interactive: true });
      }
    } else if (text && tab === text.tab) {
      const target = bodyEl.querySelector<HTMLElement>(`[data-tut="${id}"]`);
      // 한 단계뿐이면 "1 / 1" 을 붙이지 않고 단추는 "확인" — 바탕화면 튜토리얼과 같다
      // 상점은 랜덤알 카드를 눌러 사는 것이 목표 행동이다. 부화는 안내만 한다
      if (target) coachEl = coachLayer(id, target, { step: `튜토리얼 · ${text.name}`, title: text.title, body: text.body, button: "확인", onGo: () => void send("tutorial.done", id, { steps: 1 }), interactive: id === "shop" });
    } else if (text) {
      // 다른 탭에 있다 — 그 탭 버튼으로 이어 준다. 누를 때만 옮긴다
      const target = tabsEl.children[TABS.findIndex((t) => t.id === text.tab)] as HTMLElement | undefined;
      if (target) {
        coachEl = coachLayer(id, target, {
          step: `튜토리얼 · ${text.name}`,
          title: text.guideTitle,
          body: text.guideBody,
          button: text.guideButton,
          onGo: () => {
            setTab(text.tab);
            draw();
          },
          interactive: true,
        });
      }
    }
  }
  // OS 가 그리는 창 단추 자리도 함께 어둡게 한다 — 모달 가림막과 같은 통로
  window.pokebuddyManage.dim(dimmed || coachEl != null);
}

function coachLayer(id: string, target: HTMLElement, spec: CoachSpec): HTMLElement {
  const layer = el("div", "coach");
  const t0 = target.getBoundingClientRect();
  const t1 = spec.also?.getBoundingClientRect();
  const r = t1 ? { left: Math.min(t0.left, t1.left), top: Math.min(t0.top, t1.top), right: Math.max(t0.right, t1.right), bottom: Math.max(t0.bottom, t1.bottom) } : t0;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const hole = { l: Math.max(0, r.left - COACH.pad), t: Math.max(0, r.top - COACH.pad), r: Math.min(W, r.right + COACH.pad), b: Math.min(H, r.bottom + COACH.pad) };
  const bubble = el("div", "coach-bubble");
  // 막을 누르면 아무 일도 없고 말풍선을 한 번 흔든다 — 넘어가거나 스킵되지 않는다
  const nudge = (): void => {
    bubble.classList.remove("nudge");
    void bubble.offsetWidth; // 애니메이션을 처음부터 다시
    bubble.classList.add("nudge");
  };
  const block = (cls: string, x: number, y: number, w: number, h: number): void => {
    const dim = el("div", cls);
    Object.assign(dim.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });
    dim.addEventListener("mousedown", (e) => {
      e.preventDefault();
      nudge();
    });
    layer.appendChild(dim);
  };
  for (const [x, y, w, h] of [
    [0, 0, W, hole.t],
    [0, hole.b, W, H - hole.b],
    [0, hole.t, hole.l, hole.b - hole.t],
    [hole.r, hole.t, W - hole.r, hole.b - hole.t],
  ] as const) block("coach-dim", x, y, w, h);
  // 안내만 하는 단계는 구멍도 막는다 — 대상은 보이되 눌리지 않는다(예: 개체 상세의 박스에 보관)
  if (!spec.interactive) block("coach-block", hole.l, hole.t, hole.r - hole.l, hole.b - hole.t);
  const head = el("div", "head");
  const x = button("x", "✕");
  x.setAttribute("aria-label", "튜토리얼 닫기");
  x.addEventListener("click", () => void send("tutorial.skip", id)); // 닫기는 스킵이다
  head.append(el("span", "step", spec.step), x);
  const next = actionButton(spec.button, true, false, spec.onGo);
  bubble.append(head, el("div", "title", spec.title));
  if (spec.body) bubble.appendChild(el("div", "body", spec.body)); // 본문이 없으면 제목 아래 바로 단추
  if (spec.button) bubble.appendChild(actions(el("div", "spacer"), next)); // 해 보는 단계는 단추 없이 그 동작으로 넘어간다
  layer.appendChild(bubble);
  document.body.appendChild(layer);
  const left = Math.min(Math.max(COACH.margin, r.left), W - COACH.width - COACH.margin);
  const below = hole.b + COACH.gap;
  const above = hole.t - COACH.gap - bubble.offsetHeight;
  // 아래 → 위 → (대상이 커서 둘 다 모자라면) 창 아래쪽 안
  const top = below + bubble.offsetHeight <= H - COACH.margin ? below : above >= COACH.margin ? above : H - COACH.margin - bubble.offsetHeight;
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(Math.max(COACH.margin, top))}px`;
  coachAllows = (n) => bubble.contains(n) || (spec.interactive === true && target.contains(n));
  coachHome = spec.button ? next : x;
  const active = document.activeElement;
  if (!active || active === document.body || !coachAllows(active)) coachHome.focus({ preventScroll: true });
  // 대상이 그린 뒤에 크기가 바뀌면 다시 잰다 — 도감 칸은 어림 높이(content-visibility)로 먼저 잡혔다가 다음 프레임에 줄어든다
  coachWatch?.disconnect(); // 지난 코치마크의 관찰은 버린다 — 하나만 둔다
  const watch = new ResizeObserver(() => {
    if (coachEl !== layer) return watch.disconnect();
    const now = target.getBoundingClientRect();
    if (Math.abs(now.top - t0.top) > 1 || Math.abs(now.height - t0.height) > 1 || Math.abs(now.width - t0.width) > 1) {
      watch.disconnect();
      drawTutorial();
    }
  });
  watch.observe(target);
  coachWatch = watch;
  return layer;
}

// 튜토리얼 중에는 키보드 초점도 말풍선(과 목표 대상) 안에 둔다 — Tab·Enter 로 막 밖의 단추를 누르지 않게
document.addEventListener(
  "focusin",
  (e) => {
    if (!coachEl || !coachAllows || !coachHome) return;
    if (e.target instanceof Node && !coachAllows(e.target)) coachHome.focus({ preventScroll: true });
  },
  true,
);

// 본문·대화상자가 스크롤되거나 창 크기가 바뀌면 자리를 다시 잰다
bodyEl.addEventListener("scroll", () => {
  if (coachEl) drawTutorial();
});
dialogEl.addEventListener(
  "scroll",
  () => {
    if (coachEl) drawTutorial();
  },
  true,
);
window.addEventListener("resize", () => {
  if (coachEl) drawTutorial();
});

// ── 모달 · 공통 ────────────────────────────────────────────────────────────────

const partyPets = (): PetView[] => (view ? view.party.slots.map((s) => s.pet).filter((p): p is PetView => p != null) : []);

const boxPets = (): PetView[] => (view ? view.boxes.flatMap((b) => b.slots.filter((p): p is PetView => p != null)) : []);

const petOf = (id: string): PetView | null => [...partyPets(), ...boxPets()].find((p) => p.id === id) ?? null;

const slotOfPet = (id: string): number | null => view?.party.slots.find((s) => s.pet?.id === id)?.index ?? null;

const emptySlot = (): number | null => view?.party.slots.find((s) => s.state === "empty")?.index ?? null;

function actionButton(label: string, primary: boolean, disabled: boolean, run: () => void): HTMLButtonElement {
  const b = button(primary ? "act primary" : "act", label);
  b.disabled = disabled;
  b.addEventListener("click", run);
  return b;
}

// 제목 줄 — `back` 을 주면 돌아가기를 앞에 둔다. 모달을 겹치지 않고 안에서 화면을 바꾼다
function dialogHead(title: string, sub: string, back?: { label: string; to: Dialog }): HTMLElement[] {
  const row = el("div", "title-row");
  if (back) {
    const b = button("back", `‹ ${back.label}`);
    b.addEventListener("click", () => open(back.to));
    row.appendChild(b);
  }
  row.appendChild(el("h2", undefined, title));
  return sub ? [row, el("div", "sub", sub)] : [row];
}

function actions(...items: HTMLElement[]): HTMLElement {
  const box = el("div", "actions");
  box.append(...items);
  return box;
}

const closeButton = (label = "닫기"): HTMLButtonElement => actionButton(label, false, false, close);

// 켬·끔 스위치 — Figma `Toggle` `299:3593`
function switchButton(on: boolean, label: string, run: () => void): HTMLButtonElement {
  const b = button("switch");
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", String(on));
  b.setAttribute("aria-label", label);
  b.addEventListener("click", run);
  return b;
}

const boxNameOf = (id: string): string | null => view?.boxes.find((b) => b.slots.some((p) => p?.id === id))?.name ?? null;

// ── 파티 상세 기기 창 ─────────────────────────────────────────────────────────────
// 관리 창 옆에 붙는 창에 고른 개체를 띄운다 (src/main/pet-window.ts, Figma 05 `Party / Detail Device` `908:23772`(기기 `862:22000`)).
// 무엇을 보일지는 여기서 정해 보낸다. 기기 창의 단추는 여기로 돌아와 명령·대화상자로 처리한다

let petDeviceOpen = false;
// 기기 창 세대 번호 — 메인이 닫힘 알림에 실어 준 마지막 번호. 여는 요청에 싣는다. 닫힘을 알기 전에 보낸 요청은 메인이 버린다 (src/main/device-gen.ts)
let petGen = 0;
let petDeviceSent = ""; // 마지막으로 보낸 내용 — 같으면 다시 보내지 않는다(1초 새로 읽기마다 기기 창을 다시 그리지 않게)

function syncPetDevice(): void {
  const pet = detailPet ? petOf(detailPet) : null;
  if (!pet || !view) {
    // 늘 닫으라고 보낸다 — 기기 창의 ✕ 와 새로 읽기가 겹쳐 메인이 창을 새로 만든 경우도 닫힌다
    if (petDeviceOpen || petDeviceSent) window.pokebuddyManage.petOpen(null);
    petDeviceOpen = false;
    petDeviceSent = "";
    return;
  }
  const slot = slotOfPet(pet.id);
  const inParty = slot != null;
  const where = inParty ? `파티 ${slot + 1}번 · ${pet.hidden ? "볼 안" : "나와 있음"}` : `${boxNameOf(pet.id) ?? "박스"} · 보관 중`;
  const open = { pet, where, inParty, slotIndex: slot, emptySlot: inParty ? null : emptySlot(), sizeLevels: view.sizeLevels ?? 5, notice, tutorial: inParty && view.detailTutorial };
  const key = JSON.stringify(open);
  if (petDeviceOpen && key === petDeviceSent) return;
  window.pokebuddyManage.petOpen(open, petGen);
  petDeviceOpen = true;
  petDeviceSent = key;
}

// 이전·다음 — 파티 개체는 파티 칸 순서, 박스 개체는 박스 순서로 돈다
function stepPet(delta: -1 | 1): void {
  if (!detailPet) return;
  const list = slotOfPet(detailPet) != null ? partyPets() : boxPets();
  if (list.length < 2) return;
  const at = list.findIndex((p) => p.id === detailPet);
  const next = list[(at + delta + list.length) % list.length];
  if (!next) return;
  detailPet = next.id;
  draw();
}

// 기기 창에서 누른 단추 — 명령은 그 개체에, 대화상자는 여기서 연다
function onPetAction(action: PetDeviceAction): void {
  const id = detailPet;
  if (!id || action.petId !== id) return; // 기기 창이 다른 개체를 보이던 때 누른 것 — 버린다
  if (action.kind === "cmd") {
    void send(action.cmd, id, action.args);
    return;
  }
  if (action.kind === "tutorial") {
    void send(action.action === "done" ? "tutorial.done" : "tutorial.skip", "detail", action.action === "done" ? { steps: 5 } : undefined);
    return;
  }
  if (action.dialog === "evolve") open({ kind: "evolve", petId: id });
  else if (action.dialog === "keep") open({ kind: "keep", petId: id });
  else if (action.dialog === "nature") open({ kind: "nature", petId: id });
  else if (action.dialog === "pick-slot") open({ kind: "pick-slot", petId: id });
  else {
    const slot = slotOfPet(id);
    if (slot != null) open({ kind: "pick-box", slotIndex: slot });
  }
}

// ── 모달 · 진화 확인 ───────────────────────────────────────────────────────────
// 후보마다 결과 종과 상태를 보인다. 가능한 후보가 하나면 그것을 고른 채로 연다.
// `취소` 는 아무것도 바꾸지 않는다 (docs/specs/game.md "진화 확인 화면에서 취소한 개체는 진화 가능 상태를 유지한다")

// 지도 — 기본형 → 리전폼 진화(지도 간선)에 쓴다. 돌 간선은 돌 대신, 레벨·친밀도 간선은 조건과 함께 (src/dex/evolve.ts, worklog-mac/records/region-map/record.md)
const REGION_MAP = "region-map";

// 가방의 도구로 왔을 때 보일 후보 — 지도면 지도 간선만. 돌이면 그 돌이 조건인 후보 — 돌 대신 지도인 리전폼 후보는 조건이 지도라 빠진다
const evoByItem = (c: PetView["evolutions"][number], itemId: string): boolean => (itemId === REGION_MAP ? !!c.map : c.item === itemId);

function drawEvolve(petId: string, to?: string, itemId?: string): void {
  const pet = petOf(petId);
  if (!pet) {
    close();
    return;
  }
  // 가방의 도구로 왔으면 그 도구를 쓰는 후보만 보인다. 상세에서 오면 전부 — 조건을 못 채운 후보(지도 간선 포함)는 이유와 함께 누를 수 없게 둔다
  const list = itemId ? pet.evolutions.filter((c) => evoByItem(c, itemId)) : pet.evolutions;
  const ready = list.filter((c) => c.ready);
  const picked = list.find((c) => c.to === to && c.ready) ?? (ready.length === 1 ? ready[0] : undefined);
  const back: { label: string; to: Dialog } = itemId ? { label: "대상", to: { kind: "evo-target", itemId } } : { label: pet.name, to: { kind: "pet", petId } };
  dialogEl.append(...dialogHead("진화", ready.length > 1 ? "진화할 모습을 고르세요." : `${pet.name} · Lv.${pet.level}`, back));

  const rows = el("div", "rows");
  for (const c of list) {
    const row = button("row-card");
    const body = el("div", "body");
    // 지도 간선은 준비됐을 때도 지도를 쓴다고 적는다 — 옆의 기본형 결과와 가른다
    const readyNote = c.map ? "지도를 쓰면 진화할 수 있어요" : "진화할 수 있어요";
    body.append(el("div", "title", c.name), el("div", "note", c.ready ? readyNote : (c.need ?? "조건이 모자라요")));
    row.appendChild(body);
    row.disabled = !c.ready;
    row.setAttribute("aria-pressed", String(picked?.to === c.to));
    row.addEventListener("click", () => open({ kind: "evolve", petId, to: c.to, ...(itemId ? { itemId } : {}) }));
    rows.appendChild(row);
  }
  dialogEl.appendChild(rows);

  if (picked) {
    const info = el("div", "info-box");
    info.appendChild(el("div", undefined, `${pet.name} → ${picked.name}`));
    // 쓰는 도구 — 돌 진화의 돌, 지도 간선의 지도 하나 ("지도 1개를 씁니다.")
    const uses = [...new Set([...(picked.item ? [picked.item] : []), ...(picked.map ? [REGION_MAP] : [])])].map((id) => view?.bag.find((b) => b.id === id)?.name ?? (id === REGION_MAP ? "지도" : id));
    const useText = uses.map((name) => `${name} 1개`).join("와 "); // "1개" 뒤라 조사는 늘 "와"·"를"
    info.appendChild(el("div", "note", uses.length ? `${useText}를 씁니다. 레벨·친밀도·성격은 그대로입니다.` : "레벨·친밀도·성격은 그대로입니다."));
    // 되돌릴 수 없는 결과는 확인 창에 한 줄로 알린다 (2026-09-27 사용자 "추천대로진행", docs/specs/scenarios.md 진화 흐름)
    info.appendChild(el("div", "note", "진화는 되돌릴 수 없어요."));
    dialogEl.appendChild(info);
  }

  const go = actionButton("진화", true, !picked, () => {
    if (!picked) return;
    void send("evolve", pet.id, { to: picked.to }).then((ok) => {
      if (ok) open({ kind: "pet", petId });
    });
  });
  dialogEl.appendChild(actions(go, actionButton("취소", false, false, () => open(back.to))));
}

// 박스에 보관 확인 — 명세대로 확인한 뒤에 보낸다 (docs/specs/game.md "파티 개체의 상세에는 `교체`와 나란히 `박스에 보관`",
// 2026-09-28 사용자 "제안대로 하자"). 문구는 Figma `Detail / Box Keep Confirm` `914:22998`. 저장에 실패하면 창에 실패 문구가 남고 파티는 그대로다
function drawKeep(petId: string): void {
  const pet = petOf(petId);
  const slot = slotOfPet(petId);
  if (!pet || slot == null) {
    close();
    return;
  }
  dialogEl.append(...dialogHead(`${pet.name}${josa(pet.name, "을/를")} 박스에 보관할까요?`, ""));
  const info = el("div", "info-box");
  info.append(
    el("div", undefined, `파티 ${slot + 1}번 칸이 비워져요.`),
    el("div", "note", "박스에서는 친밀도·만복도·적립이 멈추고 값은 보존돼요."),
    el("div", "note", "박스 개체 상세의 [파티에 배치]로 다시 데려올 수 있어요."),
  );
  dialogEl.appendChild(info);
  const keep = actionButton("박스에 보관", true, false, () => {
    void send("party.keep", petId).then((ok) => {
      if (ok) close();
    });
  });
  dialogEl.appendChild(actions(el("div", "spacer"), actionButton("취소", false, false, close), keep));
}

// 가방의 진화용 도구 — 그 도구로 지금 진화할 수 있는 개체를 고른다. 박스 개체에게도 쓸 수 있다
function drawEvoTarget(itemId: string): void {
  const item = view?.bag.find((b) => b.id === itemId);
  const pets = [...partyPets(), ...boxPets()].filter((p) => p.evolutions.some((c) => evoByItem(c, itemId) && c.ready));
  const empty = itemId === REGION_MAP ? "지도를 쓸 수 있는 포켓몬이 없어요." : "이 도구로 지금 진화할 수 있는 포켓몬이 없어요.";
  dialogEl.append(...dialogHead(item ? item.name : itemId, pets.length ? "누구를 진화시킬까요?" : empty));
  const acts = pets.map((p) => actionButton(`${p.name} (Lv.${p.level})`, false, false, () => open({ kind: "evolve", petId: p.id, itemId })));
  dialogEl.appendChild(actions(...acts, closeButton()));
}

// ── 모달 · 성격 변경 ───────────────────────────────────────────────────────────
// 왼쪽은 지금, 오른쪽은 바꾼 후다. 가운데에 민트 그림을 둔다 (Figma Detail / Nature Change).
// 민트는 한 종류다. 원작 25 성격 가운데 아무 성격이나 고른다. 지금 성격은 고를 수 없다 (2026-09-29 사용자 결정).
// 성격은 원작 성격표처럼 5×5 격자로 한 번에 보인다 — 스크롤 목록을 두지 않는다. 순서는 data/natures.json(원작 성격 번호 순)이다.
// `취소` 는 아무것도 바꾸지 않는다
const MINT = "mint";

function drawNature(petId: string, pick: string | undefined, itemId: string | undefined): void {
  const pet = petOf(petId);
  if (!pet || !view) {
    close();
    return;
  }
  const picked = view.natures.find((n) => n.id === pick && n.id !== pet.natureId);
  const back: { label: string; to: Dialog } = itemId ? { label: "대상", to: { kind: "nature-target", itemId } } : { label: pet.name, to: { kind: "pet", petId } };
  const slot = slotOfPet(petId);
  dialogEl.append(...dialogHead("성격을 바꿀까요?", `${pet.name} Lv.${pet.level} · ${slot != null ? `파티 ${slot + 1}번` : "박스"}`, back));
  const redraw = (next: string): void => open({ kind: "nature", petId, ...(itemId ? { itemId } : {}), pick: next });

  const before = el("div", "nat-card");
  before.append(portraitOf(pet.species, pet.shiny, "portrait"), el("div", "name", pet.name), el("div", "note", pet.nature), el("div", "note", "지금"));

  const mid = el("div", "mint-mid");
  mid.append(iconOf(`item:${MINT}`, "thumb"), el("div", undefined, "→"));

  const after = el("div", "nat-card");
  after.append(portraitOf(pet.species, pet.shiny, "portrait"), el("div", "name", pet.name), el("div", picked ? "note picked" : "note", picked ? picked.name : "성격 고르기"), el("div", "note", "바꾼 후"));

  const row = el("div", "compare");
  row.append(before, mid, after);
  dialogEl.appendChild(row);

  // 성격표 — 5×5. 지금 성격 칸은 눌리지 않고 `지금` 을 붙인다. 고른 칸은 톤 배경
  const grid = el("div", "nature-grid");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "바꿀 성격");
  for (const n of view.natures) {
    const cell = button("nature-cell");
    const current = n.id === pet.natureId;
    cell.appendChild(el("span", undefined, n.name));
    if (current) cell.appendChild(el("span", "hint", "지금")); // 빈 줄을 두지 않는다 — 이름이 칸 가운데에 온다
    cell.disabled = current;
    cell.setAttribute("aria-pressed", String(n.id === picked?.id));
    cell.addEventListener("click", () => redraw(n.id));
    grid.appendChild(cell);
  }
  dialogEl.appendChild(grid);

  const have = view.bag.find((b) => b.id === MINT)?.count ?? 0;
  // 안내 상자 자리는 고르기 전에도 잡아 둔다(보이지 않게) — 고를 때 창 높이가 늘어 위로 튀지 않게
  const info = el("div", picked ? "info-box" : "info-box reserve");
  if (!picked) info.setAttribute("aria-hidden", "true");
  if (have > 0 || !picked) info.append(el("div", undefined, "성격민트 1개를 씁니다"), el("div", "note", `가방에 ${have.toLocaleString("ko-KR")}개 있어요 · 레벨·친밀도는 그대로`));
  else {
    const price = view.shop.find((p) => p.id === MINT)?.price;
    info.append(el("div", undefined, "성격민트가 없어요"), el("div", "note", price != null ? `상점 도구 분류에서 ${price}P 에 살 수 있어요` : "상점에서 살 수 있어요"));
  }
  dialogEl.appendChild(info);

  const change = actionButton("바꾸기", true, !picked || have === 0, () => {
    if (!picked) return;
    void send("bag.use", MINT, { petId, nature: picked.id }).then((ok) => {
      if (ok) open({ kind: "pet", petId });
    });
  });
  dialogEl.appendChild(actions(change, actionButton("취소", false, false, () => open(back.to))));
}

// 가방의 민트 — 성격을 바꿀 개체를 고른다. 파티와 박스 개체 모두 대상이다. 성격은 다음 창에서 고른다
function drawNatureTarget(itemId: string): void {
  const item = view?.bag.find((b) => b.id === itemId);
  const pets = [...partyPets(), ...boxPets()];
  dialogEl.append(...dialogHead(item ? item.name : itemId, pets.length ? "누구의 성격을 바꿀까요?" : "성격을 바꿀 포켓몬이 없어요."));
  const acts = pets.map((p) => actionButton(`${p.name} (${p.nature})`, false, false, () => open({ kind: "nature", petId: p.id, itemId })));
  dialogEl.appendChild(actions(...acts, closeButton()));
}

// ── 모달 · 구매 창 ─────────────────────────────────────────────────────────────

function drawBuy(productId: string, qty: number): void {
  const item = view?.shop.find((i) => i.id === productId);
  if (!item || !view) {
    close();
    return;
  }
  // 살 수 있는 개수는 포인트만큼이고, 도구는 가방에 더 담을 수 있는 만큼(최대 999)까지다 (2026-09-27 사용자 결정). 0P 상품은 하나씩 받는다.
  // 알은 돌보미집 빈 칸과 단일 포켓몬 알의 남은 수까지다 — 스냅샷의 room (src/tx/lists.ts)
  const afford = item.price > 0 ? Math.floor(view.points / item.price) : 1;
  const cap = Math.max(1, Math.min(afford, item.room ?? afford));
  const many = MULTI_BUY.has(item.category) && !item.blocked;
  const count = many ? Math.max(1, Math.min(qty, cap)) : 1;
  const total = item.price * count;
  const short = total > view.points;
  const egg = item.category === "egg";
  const eggFree = Math.max(0, view.eggs.size - view.eggs.used);
  // 알 수량의 상한 까닭 — 가장 작은 상한 하나 (Figma 05 `Shop / Buy Egg · 여러 개` `1006:20399` "최대 3 · 돌보미집 빈 칸 3")
  const eggWhy = (): string => {
    if (afford < (item.room ?? afford)) return "포인트";
    if ((item.room ?? eggFree) < eggFree) return `남은 포켓몬 ${(item.room ?? 0).toLocaleString("ko-KR")}`;
    return `돌보미집 빈 칸 ${eggFree.toLocaleString("ko-KR")}`;
  };

  // 머리 — 제목·보유 포인트와 오른쪽 위 ✕ (시안 `Shop / Buy` 의 head)
  const head = el("div", "buy-head");
  const titles = el("div", "titles");
  titles.append(el("h2", undefined, `${item.name} ${item.price === 0 ? "받기" : "구매"}`), el("div", "sub", `보유 ${point(view.points)}`));
  const x = button("close", "✕");
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", close);
  head.append(titles, x);
  dialogEl.appendChild(head);

  // 수량 — − · 수량 · + · 최대 · 최대 N (05 `Shop / Buy` 의 Quantity Stepper Show Max). 막혔으면 두지 않는다
  if (many) {
    const box = el("div", "qty square");
    const minus = button("", "−");
    minus.disabled = count <= 1;
    minus.addEventListener("click", () => open({ kind: "buy", productId, qty: count - 1 }));
    const plus = button("", "+");
    plus.disabled = count >= cap;
    plus.addEventListener("click", () => open({ kind: "buy", productId, qty: count + 1 }));
    const max = button("max", "최대");
    max.disabled = count >= cap;
    max.addEventListener("click", () => open({ kind: "buy", productId, qty: cap }));
    const hint = `최대 ${cap.toLocaleString("ko-KR")}${egg ? ` · ${eggWhy()}` : ""}`;
    box.append(minus, el("span", "count", count.toLocaleString("ko-KR")), plus, max, el("span", "qty-hint", hint));
    dialogEl.appendChild(box);
  }

  dialogEl.append(...shopDetailBlock(item)); // 포켓몬 — 정보 줄·진화 트리, 진화용 도구 — 진화 대상 (2026-09-30)

  // 합계 상자 — 살 수 있으면 합계와 구매 후 보유, 막혔으면 까닭과 한 줄 안내 (시안 `Shop / Buy Blocked`)
  const summary = el("div", "buy-total");
  if (item.blocked) {
    const daycare = item.category === "egg" && view.eggs.used >= view.eggs.size;
    summary.appendChild(el("strong", undefined, daycare ? `${item.blocked}. (${view.eggs.used} / ${view.eggs.size})` : item.blocked));
    if (daycare) summary.appendChild(el("div", undefined, "부화한 뒤 다시 살 수 있어요"));
  } else if (short) {
    summary.append(el("strong", undefined, "포인트가 모자라요"), el("div", undefined, `합계 ${point(total)} · 보유 ${point(view.points)}`));
  } else {
    const after = egg ? ` · 돌보미집 ${view.eggs.used + count} / ${view.eggs.size}` : "";
    summary.append(el("strong", undefined, `합계 ${point(total)}`), el("div", undefined, `구매 후 보유 ${point(view.points - total)}${after}`));
  }
  dialogEl.appendChild(summary);
  if (notice) dialogEl.appendChild(alertBox("bad", "", notice));

  // 바닥 — 왼쪽 `돌보미집 보기`(돌보미집이 찼을 때), 오른쪽 `취소`·`구매`
  const foot = el("div", "buy-foot");
  if (item.blocked && item.category === "egg") {
    foot.appendChild(
      actionButton("돌보미집 보기", false, false, () => {
        setTab("box");
        close();
      }),
    );
  }
  foot.append(el("span", "spacer"), actionButton("취소", false, false, close), actionButton(item.price === 0 ? "받기" : "구매", true, !!item.blocked || short, () => void buy(productId, count)));
  dialogEl.appendChild(foot);
}

// 사기 — 여러 개도 명령 하나다. 하나라도 못 사면 실행기가 전부 되돌린다
async function buy(productId: string, count: number): Promise<void> {
  await send("shop.buy", productId, count > 1 ? { count } : {});
}

// ── 상점 상세 — 포켓몬 진화 트리, 진화용 도구의 대상 ─────────────────────────────
// 구매 창에 합친다 (2026-09-30 사용자 결정 "합쳐도될듯"). Figma 05 `Shop / Buy Pokemon` · `… · Branch` · `… · Eevee` ·
// `Shop / Buy Evolution Item` · `… · Long`. 상품마다 한 번 받는다. 도감 해금 수가 바뀌면 다시 받는다(??? 가 풀릴 수 있다)
const shopDetails = new Map<string, ShopDetail | null>();
const shopDetailKey = (id: string): string => `${id}@${view?.dex.unlocked ?? 0}:${view?.dex.obtained ?? 0}`;

function shopDetailBlock(item: ShopItemView): HTMLElement[] {
  if (item.category !== "pokemon" && item.category !== "evolution") return [];
  const key = shopDetailKey(item.id);
  if (!shopDetails.has(key)) {
    shopDetails.set(key, null); // 받는 중 — 다시 그려도 두 번 청하지 않는다
    window.pokebuddyManage
      .shopDetail(item.id)
      .then((detail) => {
        shopDetails.set(key, detail);
        if (dialog?.kind === "buy" && dialog.productId === item.id) drawDialog();
      })
      .catch(() => shopDetails.delete(key)); // 다음에 그릴 때 다시 청한다
    return [];
  }
  const detail = shopDetails.get(key);
  if (!detail) return [];
  return detail.kind === "pokemon" ? pokemonDetail(detail) : [evoTargets(detail.pairs)];
}

const SVG_NS = "http://www.w3.org/2000/svg";

// 화살표 — 오른쪽을 가리킨다. 폭은 부르는 쪽이 정한다
function evoArrow(width: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "evo-arrow");
  svg.setAttribute("viewBox", `0 0 ${width} 8`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", "8");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M0 4H${width}M${width - 4} 0l4 4-4 4`);
  svg.appendChild(path);
  return svg;
}

// 초상 자리 — 미해금 종은 실루엣 대신 빈 원 (2026-09-30 사용자 결정 "실루엣은 안보이게")
const evoPortrait = (slug: string, locked: boolean, cls: string): HTMLElement => (locked ? el("span", `${cls} empty`) : portraitOf(slug, false, cls));

function evoNodeEl(node: EvoNodeView, withNeed: boolean): HTMLElement {
  const box = el("div", node.current ? "evo-node current" : "evo-node");
  box.append(evoPortrait(node.slug, node.locked, "portrait"), el("div", "evo-name", node.name));
  if (withNeed && node.need) box.appendChild(el("div", "evo-need", node.need));
  return box;
}

// 일직선·갈래 — 한 종 뒤에 자식 가지를 세로로 쌓는다. 가지마다 조건과 화살표, 그 뒤에 하위 트리
function evoTree(node: EvoNodeView): HTMLElement {
  const branch = el("div", "evo-branch");
  branch.appendChild(evoNodeEl(node, false));
  if (node.children.length) {
    const kids = el("div", "evo-kids");
    for (const child of node.children) {
      const step = el("div", "evo-step");
      step.append(el("div", "evo-need", child.need ?? ""), evoArrow(22));
      const row = el("div", "evo-row");
      row.append(step, evoTree(child));
      kids.appendChild(row);
    }
    branch.appendChild(kids);
  }
  return branch;
}

// 이브이처럼 갈래가 많으면 방사형 — 가운데 뿌리, 둘레에 갈래 (2026-09-30 사용자 결정 "이브이는 예외라서 방사형으로 하는게 국룰")
// 순서는 사용자가 준 참고 그림을 따른다 — 위부터 시계 방향. 표에 없는 종은 자료 순서로 뒤에 둔다
const RADIAL_MIN = 5;
const RADIAL_ORDER = ["jolteon", "flareon", "umbreon", "leafeon", "sylveon", "glaceon", "espeon", "vaporeon"];
// 창(682) 안에 구매 창이 다 들어가게 Figma(300·114)보다 조금 줄였다 — 검수에서 넘침을 찾았다 (2026-09-30)
const RADIAL = { width: 390, height: 256, radius: 98, arrowFrom: 40, arrowTo: 58, head: 6 };

function evoRadial(root: EvoNodeView): HTMLElement {
  const box = el("div", "evo-radial");
  const rank = (n: EvoNodeView): number => {
    const i = RADIAL_ORDER.indexOf(n.slug);
    return i < 0 ? RADIAL_ORDER.length + root.children.indexOf(n) : i;
  };
  const kids = [...root.children].sort((a, b) => rank(a) - rank(b));
  const cx = RADIAL.width / 2;
  const cy = RADIAL.height / 2;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "evo-radial-arrows");
  svg.setAttribute("viewBox", `0 0 ${RADIAL.width} ${RADIAL.height}`);
  svg.setAttribute("aria-hidden", "true");
  // 노드는 가운데 기준으로 놓는다 — CSS 가 translate(-50%, -50%) 로 맞춘다
  const place = (node: HTMLElement, x: number, y: number): void => {
    node.style.left = `${Math.round(x)}px`;
    node.style.top = `${Math.round(y)}px`;
  };
  kids.forEach((kid, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / kids.length;
    const hx = Math.cos(a);
    const hy = Math.sin(a);
    const x1 = cx + hx * RADIAL.arrowFrom;
    const y1 = cy + hy * RADIAL.arrowFrom;
    const x2 = cx + hx * RADIAL.arrowTo;
    const y2 = cy + hy * RADIAL.arrowTo;
    const h = RADIAL.head;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `M${x1} ${y1}L${x2} ${y2}M${x2 - hx * h - hy * h} ${y2 - hy * h + hx * h}L${x2} ${y2}L${x2 - hx * h + hy * h} ${y2 - hy * h - hx * h}`);
    svg.appendChild(path);
    const node = evoNodeEl(kid, true);
    place(node, cx + hx * RADIAL.radius, cy + hy * RADIAL.radius);
    box.appendChild(node);
  });
  const center = evoNodeEl(root, false);
  place(center, cx, cy);
  box.append(svg, center);
  return box;
}

// 포켓몬 상세 — 정보 줄(초상·번호·이름·분류·타입)과 진화
function pokemonDetail(detail: Extract<ShopDetail, { kind: "pokemon" }>): HTMLElement[] {
  const info = el("div", "shop-info");
  const text = el("div", "text");
  const types = el("div", "types");
  detail.types.forEach((name, i) => types.appendChild(typeBadge(name, detail.typeIds[i])));
  text.append(el("div", "title", `No.${dexNoText(detail.dex, detail.form, 4)}  ${detail.name}`), el("div", "genus", detail.genus), types);
  info.append(portraitOf(detail.slug, false, "portrait"), text);
  const evo = el("div", "evo-block");
  evo.appendChild(el("div", "evo-label", "진화"));
  const tree = detail.tree;
  if (!tree.children.length) evo.appendChild(el("div", "evo-none", "진화하지 않는 포켓몬이에요"));
  else evo.appendChild(tree.children.length >= RADIAL_MIN ? evoRadial(tree) : evoTree(tree));
  return [info, evo];
}

// 진화용 도구의 대상 — 진화 전 → 진화 후 한 열. 길면 목록 안에서만 스크롤한다 (2026-09-30 사용자 결정 "추천대로 진행")
function evoTargets(pairs: EvoPairView[]): HTMLElement {
  const box = el("div", "evo-block");
  box.appendChild(el("div", "evo-label", `진화 대상 ${pairs.length}종`));
  const list = el("div", "evo-pairs");
  const side = (s: EvoPairView["from"]): HTMLElement => {
    const mon = el("span", "evo-mon");
    mon.append(evoPortrait(s.slug, s.locked, "thumb round"), el("span", undefined, s.name));
    return mon;
  };
  for (const pair of pairs) {
    const row = el("div", "evo-pair");
    row.append(side(pair.from), evoArrow(14), side(pair.to));
    if (pair.note) row.appendChild(el("span", "evo-need", pair.note));
    list.appendChild(row);
  }
  box.appendChild(list);
  return box;
}

// ── 모달 · 개체와 칸 고르기 ────────────────────────────────────────────────────

function drawPickBox(slotIndex: number): void {
  const all = boxPets();
  const q = normQuery(pickQuery);
  const pets = q ? all.filter((p) => matchesName(p.name, q)) : all;
  const filled = view?.party.slots[slotIndex]?.state === "pokemon";
  dialogEl.append(...dialogHead("박스에서 고르기", filled ? `${slotIndex + 1}번 칸의 개체와 맞바꿉니다.` : `${slotIndex + 1}번 칸에 넣습니다.`));
  // 박스 탭과 같은 검색 줄 (worklog/records/s5-design-system-v2/plan.md "원작식 박스 구조와 검색")
  if (all.length) {
    const bar = el("div", "search-row");
    bar.appendChild(
      searchBox("pick", pickQuery, "이름 검색", (value) => {
        pickQuery = value;
        drawDialog();
      }),
    );
    dialogEl.appendChild(bar);
  }
  if (all.length && !pets.length) {
    dialogEl.appendChild(el("div", "empty-note", "검색 결과 없음"));
    dialogEl.appendChild(actions(closeButton()));
    return;
  }
  if (!pets.length) {
    dialogEl.appendChild(el("div", "empty-note", "박스가 비었습니다."));
    dialogEl.appendChild(actions(closeButton()));
    return;
  }
  const grid = el("div", "pick-grid");
  for (const pet of pets) {
    grid.appendChild(boxCell(pet, () => void send(filled ? "party.swap" : "party.place", pet.id, { slotIndex })));
  }
  dialogEl.appendChild(grid);
  dialogEl.appendChild(actions(closeButton()));
}

function drawPickSlot(petId: string): void {
  const pet = petOf(petId);
  if (!pet || !view) {
    close();
    return;
  }
  dialogEl.append(...dialogHead("파티 칸 고르기", `${pet.name}${josa(pet.name, "을/를")} 어느 칸에 넣을까요?`));
  const grid = el("div", "pick-grid");
  for (const slot of view.party.slots) {
    if (slot.state === "locked") {
      const locked = el("div", "cell blank");
      locked.appendChild(el("div", "note", "잠김"));
      grid.appendChild(locked);
      continue;
    }
    const cell = button("cell");
    cell.append(slot.pet ? portraitOf(slot.pet.species, slot.pet.shiny, "dot") : el("div", "dot"), el("div", "who", slot.pet ? slot.pet.name : "빈 칸"), el("div", "note", `${slot.index + 1}번`));
    cell.addEventListener("click", () => void send(slot.pet ? "party.swap" : "party.place", petId, { slotIndex: slot.index }));
    grid.appendChild(cell);
  }
  dialogEl.appendChild(grid);
  dialogEl.appendChild(actions(closeButton()));
}

// ── 모달 · 업적창 ──────────────────────────────────────────────────────────────

function achievementRow(a: AchievementView): HTMLElement {
  const row = el("div", `achievement ${a.state}`);
  row.dataset.id = a.id; // 알림 배너의 `바로가기` 가 이 줄로 옮겨 온다
  row.appendChild(el("span", "state"));
  const body = el("div", "body");
  body.appendChild(el("div", "label", a.name));
  if (a.desc) body.appendChild(el("div", "hint", a.desc));
  row.appendChild(body);
  if (a.state === "achieved") {
    const claim = button("act primary", "보상 받기");
    claim.title = a.reward;
    claim.addEventListener("click", () => void send("achievement.claim", a.id));
    row.appendChild(claim);
  } else {
    row.appendChild(el("span", "done", a.state === "claimed" ? `${a.reward} 받음` : a.reward));
  }
  return row;
}

function drawAchievements(): void {
  if (!view) {
    close();
    return;
  }
  const list = view.achievements.list;
  dialogEl.append(...dialogHead("업적", `달성 ${view.achievements.total} / ${list.length} · 미수령 ${view.achievements.unclaimed}`));
  const scroll = el("div", "scroll");
  for (const a of list) scroll.appendChild(achievementRow(a));
  dialogEl.appendChild(scroll);
  dialogEl.appendChild(actions(closeButton()));
}

// ── 모달 · 설정 ────────────────────────────────────────────────────────────────

// 설정 모달 탭 — 일반·화면 두 칸. 사용자 모달 탭 — 계정·연결 두 칸 (2026-09-28 사용자 "설정모달에서 계정은 빼고, 설정옆에 유저아이콘 추가 후 해당 메뉴에서 계정,연결 설정").
// 두 모달은 같은 틀이다. 탭을 바꿔도 모달 크기(560×500)가 같다.
// Figma 05 `Settings / General` `633:18937` · `Settings / Display` `633:19017` · `Settings / Connect` `633:19096` (worklog/records/trade/record.md "계정 탭 구조로 수정").
// 계정 탭의 내용은 교환 세션이 로그인과 함께 채운다 — 여기서는 자리만 둔다
type SettingsTab = "general" | "display";
const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "general", label: "일반" },
  { id: "display", label: "화면" },
];
type UserTab = "account" | "agents";
const USER_TABS: readonly { id: UserTab; label: string }[] = [
  { id: "account", label: "계정" },
  { id: "agents", label: "연결" },
];

// 두 칸·네 칸 전환 — 회색 틀 안에서 고른 칸만 흰 면 (docs/specs/ui-components.md C-15)
function segmented<T extends string>(items: readonly { id: T; label: string }[], current: T, pick: (id: T) => void): HTMLElement {
  const box = el("div", "segmented");
  box.setAttribute("role", "tablist");
  for (const item of items) {
    const b = button("", item.label);
    b.setAttribute("aria-pressed", String(item.id === current));
    b.addEventListener("click", () => {
      if (item.id !== current) pick(item.id);
    });
    box.appendChild(b);
  }
  return box;
}

// 설정의 고르기 — 박스 정렬과 같은 목록. 목록은 누르는 칸과 폭이 같다. 칸 폭은 가장 긴 선택지에 맞춘 고정값
let settingSelectOpen: string | null = null;
function settingSelect<T extends string>(id: string, options: readonly { value: T; label: string }[], current: T, width: number, pick: (value: T) => void): HTMLElement {
  const wrap = el("div", "box-sort setting-select");
  const now = options.find((o) => o.value === current);
  const toggle = button("sort-toggle", `${now?.label ?? current} ▾`);
  toggle.style.width = `${width}px`;
  toggle.setAttribute("aria-expanded", String(settingSelectOpen === id));
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    settingSelectOpen = settingSelectOpen === id ? null : id;
    drawDialog();
  });
  wrap.appendChild(toggle);
  if (settingSelectOpen === id) {
    const menu = el("div", "sort-menu");
    menu.setAttribute("role", "menu");
    for (const o of options) {
      const item = button(o.value === current ? "sort-item on" : "sort-item", o.label);
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(o.value === current));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        settingSelectOpen = null;
        if (o.value === current) drawDialog();
        else pick(o.value);
      });
      menu.appendChild(item);
    }
    wrap.appendChild(menu);
  }
  return wrap;
}

// 설정 한 줄. 조작이 넓으면 이름 아래에 깐다 — 옆에 두면 설명이 좁아져 여러 줄로 접힌다
// 힌트가 없으면 .hint 줄을 만들지 않는다 — 라벨 한 줄만 남는다
function settingRow(label: string, hint: string | undefined, control: HTMLElement, stack = false): HTMLElement {
  const row = el("div", stack ? "setting stack" : "setting");
  const body = el("div", "body");
  body.appendChild(el("div", "label", label));
  if (hint) body.appendChild(el("div", "hint", hint));
  row.append(body, control);
  return row;
}

// 소리 크기 — Figma `Volume Control` `645:16735`. 슬라이더 + 숫자 입력 + 스피커 단추(누르면 음소거, 다시 누르면 켬).
// 음소거는 설정의 sound 를 끈다. 크기 값은 그대로 남긴다. 슬라이더는 놓을 때, 숫자는 입력을 마칠 때 한 번 저장한다
function volumeControl(volume: number, on: boolean, set: (key: string, value: unknown) => void): HTMLElement {
  const box = el("div", on ? "volume" : "volume muted");
  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = "100";
  range.step = "1";
  range.value = String(volume);
  range.setAttribute("aria-label", "소리 크기");
  const number = document.createElement("input");
  number.type = "number";
  number.min = "0";
  number.max = "100";
  number.step = "1";
  number.value = String(volume);
  number.setAttribute("aria-label", "소리 크기 숫자");
  const paint = (v: number): void => range.style.setProperty("--p", `${v}%`);
  paint(volume);
  range.addEventListener("input", () => {
    number.value = range.value;
    paint(Number(range.value));
  });
  range.addEventListener("change", () => set("volume", Number(range.value)));
  // 숫자 칸 — 범위 밖이나 소수는 0~100 정수로 맞춘다. 빈 칸이면 원래 값으로 되돌린다
  number.addEventListener("change", () => {
    const raw = Number(number.value);
    if (number.value.trim() === "" || !Number.isFinite(raw)) {
      number.value = String(volume);
      return;
    }
    const v = Math.max(0, Math.min(100, Math.round(raw)));
    number.value = String(v);
    range.value = String(v);
    paint(v);
    if (v !== volume) set("volume", v);
  });
  number.addEventListener("keydown", (e) => {
    if (e.key === "Enter") number.blur();
  });
  const mute = button("mute", "");
  mute.setAttribute("aria-pressed", String(!on));
  mute.setAttribute("aria-label", on ? "음소거" : "소리 켜기");
  mute.title = on ? "음소거" : "소리 켜기";
  mute.appendChild(speakerIcon(!on));
  mute.addEventListener("click", () => set("sound", !on));
  box.append(range, number, mute);
  return box;
}

// 스피커 그림 16px — Figma `Icon / Sound` `645:346` (On · Muted). 선 색은 글자색을 따른다
function speakerIcon(muted: boolean): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const paths = ["M4 6 H7 L11 3 V13 L7 10 H4 Z", ...(muted ? ["M12 6 L16 10", "M16 6 L12 10"] : ["M12.5 5.5 Q14 8 12.5 10.5", "M14 3.5 Q16.5 8 14 12.5"])];
  for (const d of paths) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

const setSetting = (key: string, value: unknown): void => void send("settings.set", key, { value });

// 일반 — 잠들기 기준, 언어, 로그인 시 시작, 소리, 가이드북
function drawGeneral(scroll: HTMLElement): void {
  if (!view) return;
  const s = view.settings;
  const sleep = SLEEP_CHOICES.map((c) => ({ value: c.id, label: c.label }));
  scroll.appendChild(
    settingRow("잠들기 기준", "이 시간 동안 조작이 없으면 잠듦", settingSelect("sleep", sleep, String(s.sleepAfterMin), 104, (v) => setSetting("sleepAfterMin", Number(v)))),
  );
  const langs = [
    { value: "ko", label: "한국어" },
    { value: "en", label: "English" },
  ] as const;
  scroll.appendChild(settingRow("언어", undefined, settingSelect("language", langs, s.language === "en" ? "en" : "ko", 92, (v) => setSetting("language", v))));
  scroll.appendChild(settingRow("로그인 시 시작", undefined, switchButton(s.startOnLogin, "로그인 시 시작", () => setSetting("startOnLogin", !s.startOnLogin))));
  scroll.appendChild(settingRow("소리", "알림음과 울음소리 크기", volumeControl(s.volume, s.sound, setSetting)));
  const guide = button("act", "열기 ›");
  guide.addEventListener("click", () => open({ kind: "guide" }));
  scroll.appendChild(settingRow("가이드북", undefined, guide));
}

// 화면 — 포켓몬 표시, 클릭 통과, 놀이공간. 앞의 두 줄은 이 앱의 창 상태라 앱이 값을 줄 때만 둔다
function drawDisplay(scroll: HTMLElement): void {
  if (!view) return;
  const s = view.settings;
  const d = view.display;
  if (d) {
    const shown = settingRow("포켓몬 표시", undefined, switchButton(!d.hidden, "포켓몬 표시", () => setSetting("hidden", !d.hidden)));
    shown.dataset.tut = "set-hidden"; // 화면 탭 튜토리얼이 밝히는 곳
    const ghost = settingRow("고스트 모드", "포켓몬 위도 뒤 창을 클릭", switchButton(d.clickThrough, "고스트 모드", () => setSetting("clickThrough", !d.clickThrough)));
    ghost.dataset.tut = "set-ghost";
    scroll.append(shown, ghost);
  }
  // 놀이공간 — 모든 화면 · 한 화면 · 영역 지정 (2026-09-28 여러 화면, worklog/records/multi-display/record.md)
  const area = [
    { id: "all", label: "모든 화면" },
    { id: "screen", label: "한 화면" },
    { id: "region", label: "영역 지정" },
  ] as const;
  const hint =
    s.playArea === "all"
      ? "다른 화면으로 끌어다 놓으면 그 화면으로 옮겨 감"
      : s.playArea === "region"
        ? s.hasRegion
          ? "그려 둔 영역 안에서만 돌아다님"
          : "영역을 아직 그리지 않았음"
        : undefined;
  const areaRow = settingRow("놀이공간", hint, segmented(area, s.playArea, (id) => setSetting("playArea", id)));
  areaRow.dataset.tut = "area"; // 놀이공간 튜토리얼이 밝히는 곳
  scroll.appendChild(areaRow);
  // 한 화면 — 목록에서 고르거나 화면 위에서 눌러 고른다. 목록이 열린 동안 모든 모니터에 번호를 띄운다(syncIdentify)
  if (s.playArea === "screen") {
    void loadScreens();
    const rows = screenRows ?? [];
    const options = rows.map((r) => ({ value: String(r.ref.id), label: [`화면 ${r.number}`, r.primary ? "주 화면" : "", `${r.w}×${r.h}`].filter(Boolean).join(" · ") }));
    const now = rows.find((r) => r.current) ?? rows[0];
    const box = el("div", "screen-pick");
    if (now) box.appendChild(settingSelect("screen", options, String(now.ref.id), 224, (id) => {
      const row = rows.find((r) => String(r.ref.id) === id);
      if (row) setSetting("playScreen", row.ref);
    }));
    box.appendChild(actionButton("화면에서 고르기", false, false, () => void screenPick()));
    const screenRow = settingRow("화면", undefined, box);
    screenRow.dataset.tut = "area-screen"; // 놀이공간 튜토리얼이 함께 밝힌다
    scroll.appendChild(screenRow);
  }
  // 영역 지정일 때만 그리기 단추를 둔다. 그린 뒤에는 `다시 그리기` (docs/specs/game.md 설정 계약)
  if (s.playArea === "region") {
    const draw = actionButton(s.hasRegion ? "다시 그리기" : "영역 그리기", !s.hasRegion, false, () => void regionDraw());
    const regionRow = settingRow("영역", undefined, draw);
    regionRow.dataset.tut = "area-region"; // 화면 탭 튜토리얼이 함께 밝힌다
    scroll.appendChild(regionRow);
  }
}

// 한 화면 목록 — 그릴 때마다 새로 읽고, 바뀌었을 때만 다시 그린다(모니터를 꽂거나 뺐을 수 있다)
let screenRows: ScreenView[] | null = null;
let screensLoading = false;
async function loadScreens(): Promise<void> {
  if (screensLoading) return;
  screensLoading = true;
  try {
    const next = await window.pokebuddyManage.screens();
    const changed = JSON.stringify(next) !== JSON.stringify(screenRows);
    screenRows = next;
    if (changed && dialog?.kind === "settings" && dialog.tab === "display") drawDialog();
  } finally {
    screensLoading = false;
  }
}

// 한 화면 목록이 열린 동안만 모든 모니터에 번호 덮개 — 바뀔 때만 메인에 알린다
let identifying = false;
function syncIdentify(): void {
  const on = dialog?.kind === "settings" && dialog.tab === "display" && settingSelectOpen === "screen";
  if (on === identifying) return;
  identifying = on;
  window.pokebuddyManage.identifyScreens(on);
}

// 계정 — 로그인·계정 화면은 교환 세션이 채운다 (worklog/records/trade/record.md "계정과 로그인")

// CLI 한 줄 — 상태를 다섯 가지로 나눈다 (docs/specs/game.md "설정과 연결").
// 갱신 필요 — 연결됐지만 등록 목록·훅 파일이 지금과 다르다(옛 codex PreToolUse 등). "갱신" 이 connect 를 다시 불러 맞춘다
function agentRow(row: AgentRow): HTMLElement {
  const usage = row.usage === "transcript" ? "토큰으로 적립" : "작업 시간으로 적립";
  // 상태 글자는 시안처럼 짧게 — 연결됨만 적립 방식을 붙이고, 확인이 필요하면 이유를 붙인다
  const hint = row.error
    ? `확인 필요 · ${row.error}`
    : !row.installed
      ? "미설치"
      : row.connected && row.outdated
        ? "연결됨 · 갱신 필요"
        : row.connected
          ? `연결됨 · ${usage}`
          : "연결 안 됨";

  const control = el("div", "actions");
  control.style.margin = "0";
  if (!row.installed) control.appendChild(actionButton("다시 확인", false, false, () => void agent(row.name, "check")));
  else if (row.connected && row.outdated) control.appendChild(actionButton("갱신", true, false, () => void agent(row.name, "connect")));
  else if (row.connected) control.appendChild(actionButton("해제", false, false, () => void agent(row.name, "disconnect")));
  else control.appendChild(actionButton("연결", true, false, () => void agent(row.name, "connect")));

  // 상태는 dot(분류)과 글자로 — 연결됨은 초록, 갱신 필요는 주황 (Figma `Settings / Connect` `633:19096`)
  const line = settingRow(row.label, hint, control);
  const hintEl = line.querySelector<HTMLElement>(".hint");
  const dot = row.error || !row.connected ? "agent-dot" : row.outdated ? "agent-dot warn" : "agent-dot on";
  if (hintEl) hintEl.prepend(el("span", dot));
  // Windows codex 데몬은 훅마다 콘솔 창을 띄운다(openai/codex#44768) — 알려진 우회를 줄 아래에 둔다
  if (row.name === "codex" && row.installed && agentPlatform === "win32") {
    line.querySelector(".body")?.appendChild(el("div", "hint agent-tip", "Windows 에서 창이 깜빡이면 codex --no-daemon 으로 실행하세요"));
  }
  return line;
}

function drawAgents(scroll: HTMLElement): void {
  if (!agentRows) {
    scroll.appendChild(el("div", "empty-note", "연결 상태를 읽는 중입니다."));
    return;
  }
  for (const row of agentRows) scroll.appendChild(agentRow(row));
  scroll.appendChild(el("div", "agents-note hint", "연결하면 각 CLI 설정에 훅을 넣어요. 해제하면 다시 빼요."));
}

// 설정·사용자 모달의 틀 — 제목과 오른쪽 위 닫기, 두 칸 전환, 스크롤 본문. 바닥과 덧창은 모달마다 붙인다
function drawTabbedHead<T extends string>(title: string, tabs: readonly { id: T; label: string }[], current: T, pick: (id: T) => void): HTMLElement {
  const head = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.appendChild(el("h2", undefined, title));
  const x = button("dialog-close", "✕");
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", close);
  head.append(titles, x);
  dialogEl.appendChild(head);
  dialogEl.appendChild(segmented(tabs, current, pick));
  const scroll = el("div", "scroll");
  dialogEl.appendChild(scroll);
  return scroll;
}

function drawSettings(sub: SettingsTab): void {
  const scroll = drawTabbedHead("설정", SETTINGS_TABS, sub, (id) => {
    settingSelectOpen = null;
    open({ kind: "settings", tab: id });
  });
  if (sub === "general") drawGeneral(scroll);
  else drawDisplay(scroll);
  // 바닥 — 왼쪽은 버전·업데이트. 닫기 단추는 없다 (2026-09-28 사용자 "설정모달에서 우하단의 닫기버튼 없애자")
  dialogEl.appendChild(actions(versionFoot()));
}

// 사용자 모달 — 계정·연결. 버전·업데이트 바닥은 두지 않는다(설정 모달에만)
function drawUser(sub: UserTab): void {
  const scroll = drawTabbedHead("사용자", USER_TABS, sub, (id) => {
    if (id === "agents" && !agentRows) void loadAgents();
    open({ kind: "user", tab: id });
  });
  if (sub === "agents") {
    drawAgents(scroll);
    return;
  }
  drawAccount(scroll);
  const foot = accountActions();
  if (foot) dialogEl.appendChild(foot);
  // 계정 탭의 확인 창(삭제·로그아웃·로그인 때 고르기)은 사용자 모달 위에 뜬다
  const overlay = acctOverlay();
  if (overlay) dialogEl.appendChild(overlay);
}

// ── 모달 · 가이드북 ────────────────────────────────────────────────────────────

function drawGuide(): void {
  dialogEl.append(...dialogHead("가이드북", "", { label: "설정", to: { kind: "settings", tab: "general" } }));
  const scroll = el("div", "scroll");
  for (const topic of GUIDE) {
    const box = el("div", "topic");
    box.appendChild(el("h3", undefined, topic.title));
    for (const line of topic.lines) box.appendChild(el("p", undefined, line));
    scroll.appendChild(box);
  }
  dialogEl.appendChild(scroll);
  dialogEl.appendChild(actions(closeButton()));
}

// ── 설정 바닥 · 버전과 업데이트 ─────────────────────────────────────────────────
// Figma 05 Screens 섹션 `930:18246`(설정) 의 설정 바닥 — 바닥 왼쪽에 버전과 업데이트 상태, 그 옆에 `패치노트` (src/main/updater.ts)

let upd: UpdateView | null = null;
let patch: PatchNotesView | null = null;

function versionWord(u: UpdateView): string {
  if (u.status === "latest") return `pokebuddy ${u.version} · 최신 버전`;
  if (u.status === "downloading") return `새 버전 ${u.next ?? ""} 받는 중 ${u.percent ?? 0}%`;
  if (u.status === "ready") return `새 버전 ${u.next ?? ""} 준비됨`;
  if (u.status === "manual") return `새 버전 ${u.next ?? ""}`;
  if (u.status === "error") return "업데이트를 확인하지 못했어요";
  return `pokebuddy ${u.version}`; // 꺼 둠(개발 실행·npm 설치본)·확인 전·확인 중
}

// `다시 시작`을 눌렀다 — 앱이 꺼질 때까지 "다시 시작하는 중"과 처리 중 단추를 둔다. 클라우드 저장을 올리느라 몇 초 걸릴 수 있다
// (Figma `Settings / Version · 다시 시작하는 중`). 앱이 꺼진 뒤에는 설치 프로그램의 진행 창이 보인다 (src/main/updater.ts)
let restarting = false;

async function updateSend(action: "check" | "install"): Promise<void> {
  const restart = action === "install" && upd?.status === "ready";
  if (restart) {
    restarting = true;
    if (dialog?.kind === "settings") drawDialog();
  }
  let next: UpdateView | null = null;
  try {
    next = await window.pokebuddyManage.update(action);
  } catch (e) {
    console.error("업데이트 요청 실패", e);
  }
  if (next) upd = next;
  if (restart && !next) restarting = false; // 요청이 닿지 않았다 — 다시 누를 수 있게 되돌린다
  if (dialog?.kind === "settings") drawDialog();
}

function versionFoot(): HTMLElement {
  const box = el("div", "version-foot");
  if (upd && restarting) {
    box.appendChild(el("span", "version-word", "다시 시작하는 중"));
    const b = smallButton("다시 시작", true, () => {});
    setBusy(b, true);
    box.appendChild(b);
  } else if (upd) {
    box.appendChild(el("span", "version-word", versionWord(upd)));
    if (upd.status === "ready") box.appendChild(smallButton("다시 시작", true, () => void updateSend("install")));
    // mac 에서 앱을 그 자리에서 바꿀 수 없다(dmg 안·쓰기 불가) — 이 Mac 용 dmg 를 연다 (src/main/mac-updater.ts)
    else if (upd.status === "manual") box.appendChild(smallButton("받기", true, () => void updateSend("install")));
    else if (upd.status === "error") box.appendChild(smallButton("다시 확인", false, () => void updateSend("check")));
  }
  if (patch?.notes.length) box.appendChild(smallButton("패치노트", false, () => open({ kind: "notes" })));
  return box;
}

const smallButton = (label: string, primary: boolean, run: () => void): HTMLButtonElement => {
  const b = actionButton(label, primary, false, run);
  b.classList.add("small");
  return b;
};

async function loadUpdate(): Promise<void> {
  try {
    const [u, n] = await Promise.all([window.pokebuddyManage.update("status"), window.pokebuddyManage.notes("list")]);
    upd = u;
    patch = n;
  } catch (e) {
    console.error("버전·패치노트를 읽지 못했다", e);
    return;
  }
  if (dialog?.kind === "settings") drawDialog();
}

// 업데이트한 뒤 처음 열었다 — 그 버전의 노트를 한 번 띄운다. 다른 모달이 떠 있으면 가리지 않고 다음에 연다
function showUnseenNotes(): void {
  const v = patch?.unseen;
  if (!v || dialog) return;
  open({ kind: "notes-new", version: v });
  void window.pokebuddyManage.notes("seen").then((n) => {
    if (n) patch = n;
  });
}

window.pokebuddyManage.onUpdate((next) => {
  upd = next;
  if (dialog?.kind === "settings") drawDialog();
});

// ── 모달 · 패치노트 ────────────────────────────────────────────────────────────
// Figma `99 · 시안` `800:18345`(설정에서 연 것 — 왼쪽 버전 목록, 오른쪽 내용)·`800:18549`(업데이트 뒤 처음 켤 때)

function noteDetail(version: string): HTMLElement {
  const box = el("div", "notes-detail");
  const note = patch?.notes.find((n) => n.version === version);
  if (!note) return box;
  const head = el("div", "notes-version");
  head.append(el("h3", undefined, note.version), el("span", "notes-date", note.date));
  box.appendChild(head);
  for (const line of note.lines) box.appendChild(el("p", "notes-line", `· ${line}`));
  return box;
}

function notesHead(title: string, sub: string, onClose: () => void): HTMLElement {
  const head = el("div", "settings-head");
  const titles = el("div", "titles");
  titles.append(el("h2", undefined, title), el("div", "sub", sub));
  const x = button("dialog-close", "✕");
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", onClose);
  head.append(titles, x);
  return head;
}

// ✕ 는 설정으로 돌아간다 — 설정 바닥에서 열었다
function drawNotes(pick?: string): void {
  const notes = patch?.notes ?? [];
  const current = pick ?? notes[0]?.version ?? "";
  dialogEl.appendChild(notesHead("패치노트", "버전마다 바뀐 것", () => open({ kind: "settings", tab: "general" })));
  const body = el("div", "notes-body");
  const list = el("div", "notes-list scroll");
  for (const n of notes) {
    const item = button(n.version === current ? "notes-item on" : "notes-item");
    item.append(el("span", "notes-item-version", n.version), el("span", "notes-date", n.date));
    item.setAttribute("aria-pressed", String(n.version === current));
    item.addEventListener("click", () => {
      if (n.version !== current) open({ kind: "notes", pick: n.version });
    });
    list.appendChild(item);
  }
  body.append(list, noteDetail(current));
  dialogEl.appendChild(body);
}

function drawNotesNew(version: string): void {
  dialogEl.append(notesHead(`${version} 으로 업데이트했어요`, "이번 버전에서 바뀐 것", close), noteDetail(version));
}

// ── 모달 · 여닫기 ──────────────────────────────────────────────────────────────

// 모달마다 폭이 다르다. 고르기는 격자가 들어가서 넓고, 목록은 길어서 안에서 스크롤한다
const SHAPE: Record<Dialog["kind"], string> = {
  pet: "dialog",
  evolve: "dialog",
  "evo-target": "dialog",
  nature: "dialog",
  "nature-target": "dialog",
  buy: "dialog buy",
  "pick-box": "dialog wide",
  "pick-slot": "dialog wide",
  achievements: "dialog tall",
  settings: "dialog settings",
  user: "dialog settings",
  guide: "dialog tall",
  hatched: "dialog",
  keep: "dialog",
  form: "dialog",
  notes: "dialog settings notes",
  "notes-new": "dialog settings notes-new",
  mail: "dialog settings mail",
  letter: "dialog settings mail",
  trade: "dialog trade",
};

// 가림막 — 켜고 끌 때 메인에도 알린다. OS 가 그리는 창 단추 자리는 CSS 가 덮지 못한다
let dimmed = false;
function setScrim(on: boolean): void {
  scrimEl.classList.toggle("open", on);
  if (on === dimmed) return;
  dimmed = on;
  drawTutorial(); // 모달이 열리면 코치마크를 감추고, 닫히면 다시 그린다. 창 단추 자리 어둡게 하기도 여기서 맞춘다
}

// 다시 그린 대화상자의 스크롤 — 같은 대화상자·같은 탭이면 스크롤 위치를 되돌린다.
// 버튼을 누르거나 1초 새로 그리기 때 대화상자를 통째로 다시 만들어 맨 위로 튀던 것을 막는다 (2026-09-27 사용자 "설정에서 스크롤 내리고, 버튼 누르면 스크롤이 올라가짐")
let dialogScrollKey = "";
const dialogKeyOf = (d: Dialog): string => `${d.kind}:${"tab" in d ? String(d.tab) : ""}`;

function drawDialog(): void {
  if (dialog && typingSearch(dialogEl)) {
    dialogHeld = true;
    return;
  }
  dialogHeld = false;
  if (!dialog) {
    setScrim(false);
    dialogScrollKey = "";
    syncIdentify();
    return;
  }
  setScrim(true);
  const key = dialogKeyOf(dialog);
  const keep = key === dialogScrollKey ? (dialogEl.querySelector<HTMLElement>(".scroll")?.scrollTop ?? 0) : 0;
  dialogScrollKey = key;
  dialogEl.className = SHAPE[dialog.kind];
  dialogEl.replaceChildren();

  if (dialog.kind === "evolve") drawEvolve(dialog.petId, dialog.to, dialog.itemId);
  else if (dialog.kind === "evo-target") drawEvoTarget(dialog.itemId);
  else if (dialog.kind === "nature") drawNature(dialog.petId, dialog.pick, dialog.itemId);
  else if (dialog.kind === "nature-target") drawNatureTarget(dialog.itemId);
  else if (dialog.kind === "buy") drawBuy(dialog.productId, dialog.qty);
  else if (dialog.kind === "pick-box") drawPickBox(dialog.slotIndex);
  else if (dialog.kind === "pick-slot") drawPickSlot(dialog.petId);
  else if (dialog.kind === "achievements") drawAchievements();
  else if (dialog.kind === "settings") drawSettings(dialog.tab);
  else if (dialog.kind === "user") drawUser(dialog.tab);
  else if (dialog.kind === "hatched") drawHatched(dialog.petId, dialog.slotIndex, dialog.eggId);
  else if (dialog.kind === "keep") drawKeep(dialog.petId);
  else if (dialog.kind === "form") drawForm(dialog.petId, dialog.to);
  else if (dialog.kind === "notes") drawNotes(dialog.pick);
  else if (dialog.kind === "notes-new") drawNotesNew(dialog.version);
  else if (dialog.kind === "mail") drawMail();
  else if (dialog.kind === "letter") drawLetter(dialog.id);
  else if (dialog.kind === "trade") drawTradeDialog();
  else drawGuide();

  if (notice) dialogEl.appendChild(alertBox("bad", "", notice));
  const scroll = dialogEl.querySelector<HTMLElement>(".scroll");
  if (scroll && keep) scroll.scrollTop = keep;
  restoreSearchFocus();
  syncIdentify();
  drawTutorial(); // 대화상자 안의 튜토리얼(설정 › 화면의 놀이공간)
}

// 다른 모달로 갈 때는 지난 실패 문구를 지운다. 구매 창의 부족 안내처럼 그 화면이 다시 만드는 것은 남는다
function open(next: Dialog): void {
  // 설정 › 화면에 새로 들어오면 화면 탭 튜토리얼은 1단계부터
  if (next.kind === "settings" && next.tab === "display" && !(dialog?.kind === "settings" && dialog.tab === "display")) {
    areaStep = 0;
    areaStart = null;
  }
  // 개체 상세는 관리 창 옆의 기기 창이다 — 모달을 닫고 그 개체가 있는 탭을 그린 뒤 기기 창에 띄운다
  // (2026-09-28 사용자 "파티상세페이지도 도감상세처럼 옆에 뜨는거로 바꾸자", A안 기기형)
  if (next.kind === "pet") {
    dialog = null;
    notice = "";
    setScrim(false);
    setTab(slotOfPet(next.petId) != null ? "party" : "box");
    detailPet = next.petId;
    draw();
    return;
  }
  dialog = next;
  notice = "";
  drawDialog();
}

function close(): void {
  dialog = null;
  notice = "";
  setScrim(false);
  syncIdentify();
}

// 박스 탭을 열고 교환 모달을 띄운다 — 교환 링크(딥링크)로 왔을 때
function showTrade(): void {
  setTab("box");
  detailPet = null; // 박스 탭에 있었어도 개체 상세는 닫고 교환 모달만 띄운다
  draw();
  open({ kind: "trade" });
  void loadTrade();
}

const openPet = (id: string): void => {
  if (coachId === "evolution") void send("tutorial.done", "evolution", { steps: 1 }); // 카드를 눌러 기기 창의 진화 단추를 보는 것이 목표 행동이다
  if (detailPet === id && !dialog) {
    detailPet = null; // 이미 떠 있는 개체를 다시 누르면 기기 창을 닫는다 — 도감 칸과 같다
    draw();
    return;
  }
  open({ kind: "pet", petId: id });
};

// ── 명령 보내기 ────────────────────────────────────────────────────────────────

// 실패 이유 → 화면 문구. 모르는 이유는 그대로 보여 무엇이 빠졌는지 드러나게 한다
const REASON: Record<string, string> = {
  cooldown: "아직 쉬는 시간이에요.",
  full: "이미 배가 불러요.",
  already: "이미 그 상태예요.",
  "max-level": "이미 최고 레벨이에요.",
  "no-slot": "그 칸이 없어요.",
  "no-pet": "그 개체가 없어요.",
  "not-in-party": "파티에 없어요.",
  "not-in-box": "박스에 없어요.",
  "party-full": "파티에 빈 칸이 없어요.",
  "no-empty-slot": "파티에 빈 칸이 없어요.",
  "slot-locked": "잠긴 칸이에요.",
  "slot-not-empty": "그 칸이 이미 차 있어요.",
  "not-pokemon": "그 칸에 개체가 없어요.",
  "not-enough-points": "포인트가 모자라요.",
  "daycare-full": "돌보미집이 가득 찼어요.",
  "bag-full": "한 종류는 999개까지만 살 수 있어요.",
  "sold-out": "이 알에서 나올 포켓몬을 모두 모았어요.",
  "bad-form": "고를 수 없는 모습이에요.",
  "not-shared": "모습을 바꿀 수 없는 포켓몬이에요.",
  "max-slots": "더 열 수 있는 칸이 없어요.",
  "no-locked-slot": "더 열 수 있는 칸이 없어요.",
  "not-unlocked": "아직 해금하지 않은 종이에요.",
  "not-ready": "아직 준비되지 않았어요.",
  "no-candidate": "지금은 진화할 수 없어요.",
  "need-choice": "진화할 모습을 골라 주세요.",
  "bad-choice": "고른 모습으로는 지금 진화할 수 없어요.",
  "no-step": "더 진화하지 않아요.",
  "none-left": "가방에 남은 것이 없어요.",
  "no-item": "가방에 없어요.",
  "no-map": "지도가 있어야 이 모습으로 진화해요.",
  "not-sellable": "팔 수 없는 도구예요.",
  "not-enough-items": "가진 개수보다 많이 팔 수 없어요.",
  "bad-count": "고를 수 없는 수량이에요.",
  "unknown-item": "모르는 도구예요.",
  "bad-nature": "쓸 수 없는 성격이에요.",
  "bad-value": "고를 수 없는 값이에요.",
  "daily-cap": "오늘은 더 쓸 수 없어요.",
  "not-achieved": "아직 달성하지 않았어요.",
  "already-claimed": "이미 받았어요.",
  "save-failed": "저장하지 못했어요. 잠시 뒤 다시 해 주세요.",
  "art-missing": "바뀔 모습의 그림을 받지 못했어요. 잠시 뒤 다시 해 주세요.",
  "not-writer": "다른 창이 저장을 맡고 있어요. 잠시 뒤 다시 해 주세요.",
  halted: "다른 PC 확인이 끝날 때까지 게임이 멈춰 있어요.",
  "box-full": "그 박스는 가득 찼어요.",
  "no-box": "그 박스를 찾지 못했어요.",
  // 교환에 올려 둔 개체 — 도구 사용·진화·모습 바꾸기를 막는다 (src/tx/handlers.ts, src/trade/core.ts isLocked)
  "trade-locked": "교환에 올린 포켓몬이에요. 교환을 끝내거나 나간 뒤 다시 해 주세요.",
  timeout: "응답이 없어요. 처리됐는지 확인해 주세요. 다시 눌러도 두 번 반영되지 않아요.",
};

// 대상이 사라지거나 일이 끝나는 조작 — 결과를 보여 줄 곳이 없으므로 모달을 닫는다
const CLOSES = new Set(["party.keep", "party.place", "party.swap", "egg.open", "bag.use", "bag.sell", "shop.buy"]);

// 도감이 함께 바뀌는 조작 — 다음에 도감을 열 때 다시 읽게 비운다
const TOUCHES_DEX = new Set(["egg.open", "shop.buy", "evolve", "bag.use"]);

// 조작 하나마다 새 요청이다. 같은 순간의 두 클릭이 하나로 합쳐지지 않게 보내는 쪽이 식별자를 만든다.
// 같은 값으로 다시 보내면 실행기가 한 번만 반영한다 (docs/specs/modules.md "거래 실행기")
let seq = 0;
const nextReqId = (cmd: string, target: string): string => `ui:${Date.now()}:${++seq}:${cmd}:${target}`;

// 응답이 없던 조작(timeout)은 결과를 모른다. 같은 조작을 다시 누르면 같은 요청 ID 로 보내 실행기가 한 번만 반영하게 한다.
// 조작이 같은지는 명령·대상·인자로 본다. 답을 받으면(성공·실패) 잊는다 (worklog/records/game-runtime/record.md "결과를 모를 때")
let unknownReq: { key: string; id: string } | null = null;
function reqIdFor(cmd: string, target: string, extra: Record<string, unknown>): string {
  const key = JSON.stringify([cmd, target, extra]);
  if (unknownReq?.key === key) return unknownReq.id;
  return nextReqId(cmd, target);
}
function rememberReply(cmd: string, target: string, extra: Record<string, unknown>, id: string, reply: ManageReply): void {
  unknownReq = !reply.ok && reply.reason === "timeout" ? { key: JSON.stringify([cmd, target, extra]), id } : null;
}

// 답을 기다리는 조작이 있으면 새 조작을 받지 않는다. 빠른 두 번 클릭이 두 번 사거나 두 번 쓰지 않게 한다.
// 여러 개 사기는 앞 조작의 답을 받은 뒤 다음을 보내므로 막히지 않는다
let busy = false;
let lastReply: ManageReply | null = null; // 마지막으로 성공한 조작의 답 — 결과 창이 읽는다

// 처리 중 표시 — 답이 늦으면 누른 단추·칸에 점 세 개를 띄운다 (Figma `Button` · `Box Slot` 의 `State=Busy`).
// 빠른 답에서 깜빡이지 않게 BUSY_AFTER_MS 가 지나서야 단다 (worklog/records/response-latency/record.md "B안")
const BUSY_AFTER_MS = 300;
const PRESS_FRESH_MS = 1000; // 이보다 오래된 누름은 이번 조작의 단추가 아니다 — 튜토리얼 등 누름 없이 보낸 조작
let pressed: { button: HTMLButtonElement; at: number } | null = null;
// 조작 처리기보다 먼저 누른 단추를 기억한다 (캡처 단계). 키보드 Enter·Space 도 click 으로 온다
document.addEventListener("click", (e) => {
  const button = e.target instanceof Element ? e.target.closest("button") : null;
  pressed = button ? { button, at: Date.now() } : null;
}, true);

function setBusy(target: HTMLButtonElement, on: boolean): void {
  target.classList.toggle("is-busy", on);
  if (on) target.setAttribute("aria-busy", "true");
  else target.removeAttribute("aria-busy");
}

// 방금 누른 단추에 처리 중을 예약한다. 돌려주는 함수를 부르면 예약을 거두고 표시를 뗀다
function busyLater(): () => void {
  const target = pressed && Date.now() - pressed.at < PRESS_FRESH_MS ? pressed.button : null;
  if (!target) return () => {};
  const timer = setTimeout(() => setBusy(target, true), BUSY_AFTER_MS);
  return () => {
    clearTimeout(timer);
    setBusy(target, false);
  };
}

// 성공하면 true. 여러 번 보내는 쪽이 중간에 멈출 수 있게 돌려준다
async function send(cmd: string, target: string, extra: Record<string, unknown> = {}, opts: { keepOpen?: boolean } = {}): Promise<boolean> {
  if (busy) return false;
  busy = true;
  const unbusy = busyLater();
  let reply: ManageReply;
  try {
    const reqId = reqIdFor(cmd, target, extra);
    reply = await window.pokebuddyManage.command({ cmd, target, args: { ...extra, reqId } });
    rememberReply(cmd, target, extra, reqId, reply);
    if (reply.ok && TOUCHES_DEX.has(cmd)) dexRows = null;
    await refresh();
  } finally {
    busy = false;
    unbusy();
  }

  if (!reply.ok) {
    notice = REASON[reply.reason] ?? reply.reason;
    drawDialog();
    return false;
  }
  notice = "";
  lastReply = reply;
  if (CLOSES.has(cmd) && !opts.keepOpen) close();
  else drawDialog();
  return true;
}

// 화면 고르기 덮개를 연다. 누른 화면을 메인이 저장한다. 취소는 아무것도 바꾸지 않으므로 알리지 않는다
async function screenPick(): Promise<void> {
  if (busy) return;
  busy = true;
  let reply: ManageReply;
  try {
    reply = await window.pokebuddyManage.pickScreen();
    await refresh();
  } finally {
    busy = false;
  }
  notice = reply.ok || reply.reason === "cancelled" ? "" : REASON[reply.reason] ?? reply.reason;
  drawDialog();
}

// 영역 그리기 창을 연다. 적용하면 메인이 저장한다. 취소는 아무것도 바꾸지 않으므로 알리지 않는다
async function regionDraw(): Promise<void> {
  if (busy) return;
  busy = true;
  let reply: ManageReply;
  try {
    reply = await window.pokebuddyManage.drawRegion();
    await refresh();
  } finally {
    busy = false;
  }
  notice = reply.ok || reply.reason === "cancelled" ? "" : REASON[reply.reason] ?? reply.reason;
  drawDialog();
}

async function agent(name: string, action: "connect" | "disconnect" | "check"): Promise<void> {
  const reply = await window.pokebuddyManage.agents({ name, action });
  agentRows = reply.list;
  agentPlatform = reply.platform;
  notice = reply.ok ? "" : (REASON[reply.reason] ?? reply.reason);
  drawDialog();
}

async function loadDex(): Promise<void> {
  dexRows = await window.pokebuddyManage.dex();
  if (dexPick) window.pokebuddyManage.dexOpen(dexPick, dexGen); // 부화·해금으로 바뀐 항목을 기기 창에 다시 보낸다
  if (tab === "dex") draw();
}

async function loadAgents(): Promise<void> {
  const reply = await window.pokebuddyManage.agents();
  agentRows = reply.list;
  agentPlatform = reply.platform;
  if (dialog?.kind === "user" && dialog.tab === "agents") drawDialog();
}

async function refresh(): Promise<void> {
  view = await window.pokebuddyManage.snapshot();
  drawnStructure = structureOf(view);
  draw();
}

// ── 1초 시계 ──────────────────────────────────────────────────────────────────
// 시계가 울릴 때마다 스냅샷을 다시 읽는다 (2026-09-29 사용자 지시 — 앱 전역 타이머가 1초마다 갱신)
//   시간으로만 바뀌는 값(LIVE_KEYS)만 달라졌다   표시만 고친다(applyLive). 탭 포커스·title 툴팁·글자 선택이 남는다
//   그 밖의 모양이 바뀌었다                       전체를 다시 그린다. 포커스는 같은 자리 요소로 되돌린다(focusPath)
// 전체 다시 그리기는 끊기는 조작 중에는 미루고 다음 시계에 한다 — 끌기·박스 이름 입력·누르는 중·한글 조합 중·글자 입력 칸 포커스.
// 표시 고치기는 입력 요소를 건드리지 않으므로 그동안에도 한다.
// view 는 화면에 그린 모양의 값이다 — 처리기(단추)는 이것을 읽는다. 미루는 동안에는 새 값의 시간 표시만 먼저 보인다
const LIVE_KEYS = new Set(["feedInSec", "affinity", "mood", "moodWord", "remainSec", "percent", "remainMin"]);
// 만복도는 100 에 닿았는지만 모양이다(밥 주기 · 배부름) — 그 밖의 값은 표시만 고친다
const structureOf = (v: Snapshot | null): string =>
  JSON.stringify(v, (k: string, val: unknown) => (LIVE_KEYS.has(k) ? undefined : k === "fullness" && typeof val === "number" ? val >= 100 : val));
let drawnStructure = ""; // 마지막으로 그린 모양
let clockBusy = false;
let pointerDown = false;
let composing = false;
document.addEventListener("pointerdown", () => (pointerDown = true), true);
document.addEventListener("pointerup", () => (pointerDown = false), true);
document.addEventListener("pointercancel", () => (pointerDown = false), true);
window.addEventListener("blur", () => (pointerDown = false));
document.addEventListener("compositionstart", () => (composing = true), true);
document.addEventListener("compositionend", () => (composing = false), true);

// 글자를 치는 칸에 포커스가 있는가 — 슬라이더·체크 칸은 누르는 중에만 막는다(pointerDown). 창이 뒤에 있으면 입력 중으로 보지 않는다
const TEXT_TYPES = new Set(["text", "search", "password", "email", "number", "url", "tel"]);
const typingText = (): boolean => {
  if (!document.hasFocus()) return false;
  const a = document.activeElement;
  return (a instanceof HTMLInputElement && TEXT_TYPES.has(a.type)) || a instanceof HTMLTextAreaElement || (a instanceof HTMLElement && a.isContentEditable);
};
const holdFullDraw = (): boolean => dragFrom != null || boxRenaming || pointerDown || composing || typingText();

// 시간 표시만 고친다 — 개체 막대(data-live-pet)와 알 글자(data-live-egg)
function applyLive(v: Snapshot | null = view): void {
  if (!v) return;
  const pets = new Map<string, PetView>();
  for (const s of v.party.slots) if (s.pet) pets.set(s.pet.id, s.pet);
  for (const b of v.boxes) for (const p of b.slots) if (p) pets.set(p.id, p);
  for (const box of document.querySelectorAll<HTMLElement>("[data-live-pet]")) {
    const pet = pets.get(box.dataset.livePet ?? "");
    const field = box.dataset.liveField;
    if (!pet || (field !== "affinity" && field !== "fullness")) continue;
    const value = pet[field];
    const shown = box.querySelector<HTMLElement>(".row span:last-child");
    if (shown && shown.textContent !== `${value}/100`) shown.textContent = `${value}/100`;
    const fill = box.querySelector<HTMLElement>(".fill");
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-live-buff]")) {
    const [petId, kind] = (node.dataset.liveBuff ?? "").split("|");
    const buff = pets.get(petId ?? "")?.buffs.find((b) => b.kind === kind);
    if (buff && node.textContent !== buffBadge(buff)) node.textContent = buffBadge(buff);
  }
  const eggs = new Map(v.eggs.list.map((e) => [e.id, e]));
  for (const node of document.querySelectorAll<HTMLElement>("[data-live-egg]")) {
    const egg = eggs.get(node.dataset.liveEgg ?? "");
    if (egg && node.textContent !== eggNote(egg)) node.textContent = eggNote(egg);
  }
}

async function clockTick(): Promise<void> {
  if (clockBusy) return;
  clockBusy = true;
  try {
    const next = await window.pokebuddyManage.snapshot();
    const structure = structureOf(next);
    if (structure === drawnStructure) {
      view = next; // 모양이 같다 — 시간 값만 새것으로
      applyLive();
      syncPetDevice(); // 기기 창도 새 시간 값을 받는다. 기기 창이 표시만 고친다
      return;
    }
    if (holdFullDraw()) {
      applyLive(next); // 모양은 다음 시계에 — 시간 표시만 먼저
      return;
    }
    view = next;
    drawnStructure = structure;
    draw();
    drawDialog();
  } finally {
    clockBusy = false;
  }
}

// 전체 다시 그리기 뒤 포커스를 같은 자리로 — 탭 줄·본문 안에서 자식 번호 길과 모양(태그·클래스)이 같은 요소
// 다시 그리면 요소가 새로 생겨 키보드 포커스가 사라진다 (2026-09-29 검수 C2)
interface FocusPath {
  root: HTMLElement;
  path: number[];
  sign: string;
}
const signOf = (e: Element): string => `${e.tagName}.${e.className}`;
function focusPath(): FocusPath | null {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || a === document.body || a.dataset.search != null) return null; // 검색 칸은 searchFocus 가 맡는다
  const root = [tabsEl, bodyEl].find((r) => r.contains(a) && r !== a);
  if (!root) return null;
  const path: number[] = [];
  for (let n: Element = a; n !== root; n = n.parentElement as Element) path.unshift([...(n.parentElement?.children ?? [])].indexOf(n));
  return { root, path, sign: signOf(a) };
}
function restoreFocusPath(kept: FocusPath | null): void {
  if (!kept || (document.activeElement && document.activeElement !== document.body)) return;
  let n: Element | undefined = kept.root;
  for (const i of kept.path) n = n?.children[i];
  if (n instanceof HTMLElement && signOf(n) === kept.sign) n.focus({ preventScroll: true });
}

need("open-achievements", HTMLButtonElement).addEventListener("click", () => open({ kind: "achievements" }));
need("open-settings", HTMLButtonElement).addEventListener("click", () => open({ kind: "settings", tab: "general" }));
need("open-user", HTMLButtonElement).addEventListener("click", () => open({ kind: "user", tab: "account" }));

scrimEl.addEventListener("click", (e) => {
  if (e.target === scrimEl) close();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && dialog) close();
});

// 알림 배너의 `바로가기` — 부화는 돌보미집, 진화는 개체 상세, 업적은 업적 창의 그 줄 (docs/specs/game.md "알림 배너의 개별 표시")
function goTo(route: ManageRoute): void {
  if (route.to === "daycare") {
    close();
    setTab("box");
    draw();
    bodyEl.querySelector(".daycare")?.scrollIntoView({ block: "start" });
  } else if (route.to === "pet") {
    if (petOf(route.petId)) open({ kind: "pet", petId: route.petId }); // 이미 떠 있어도 닫지 않는다 — 우클릭 상세 보기·진화 배너
  } else if (route.to === "account") {
    detailPet = null;
    open({ kind: "user", tab: "account" });
    void loadAccount();
  } else if (route.to === "trade") {
    // 교환 링크(딥링크)로 왔다 — 박스 탭을 열고 교환 모달을 띄운다.
    // 교환 모달이 이미 떠 있으면 그대로 두고 상태만 다시 읽는다. 다른 대화상자가 떠 있으면 닫고 연다
    // (2026-09-30 사용자 결정 "ㅇㅇ 닫고 교환모달로.")
    if (dialog?.kind === "trade") void loadTrade();
    else {
      if (dialog) close();
      showTrade();
    }
  } else if (route.to === "agents") {
    // Codex 창 깜빡임 알림 — 사용자 모달의 연결 탭 (src/agents/notice.ts)
    detailPet = null;
    open({ kind: "user", tab: "agents" });
    void loadAgents();
  } else if (route.to === "bag" || route.to === "shop") {
    // 줍기 배너 — 도구·진화용 도구는 가방, 포인트는 상점 (docs/specs/game.md "줍기")
    close();
    setTab(route.to);
    detailPet = null;
    draw();
  } else {
    open({ kind: "achievements" });
    dialogEl.querySelector(`.achievement[data-id="${CSS.escape(route.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }
}

// 디스크에 있는 그림을 전부 받아 캐시에 채운다. 받은 그림은 미리 디코딩해 둔다 —
// 같은 주소의 그림은 문서가 이미 가진 그림이 되어, 칸을 그리는 순간 바로 보인다
const warmed: HTMLImageElement[] = [];
async function loadArt(): Promise<void> {
  let got: Record<string, string> = {};
  try {
    got = await window.pokebuddyManage.art();
  } catch {
    return; // 그림 없이도 창은 돈다 — 칸을 그린 뒤 하나씩 청하는 길이 남아 있다
  }
  for (const [key, uri] of Object.entries(got)) (key === "egg" || key.startsWith("item:") ? iconCache : portraitCache).set(key, uri);
  for (const uri of new Set(Object.values(got))) {
    const img = new Image();
    img.src = uri;
    warmed.push(img);
    void img.decode().catch(() => undefined);
  }
}

// 첫 화면을 그린 뒤에 옮긴다 — 창을 새로 열면서 온 목적지는 스냅샷보다 먼저 올 수 있다
const firstDraw = loadArt().then(refresh);
// 버전·패치노트 — 첫 화면 뒤에 읽는다. 업데이트한 뒤 처음이면 노트를 한 번 띄운다
void firstDraw.then(loadUpdate).then(showUnseenNotes);
// 교환 상태 — 박스 머리 `교환` 단추의 진행 중 점에 쓴다. 뒤의 변경은 onTrade 로 온다
void firstDraw.then(loadTrade);
window.pokebuddyManage.onDexStep((delta) => stepDex(delta));
window.pokebuddyManage.onDexClosed((gen) => {
  dexGen = gen;
  dexPick = null;
  markDexPick();
});
window.pokebuddyManage.onPetStep((delta) => stepPet(delta));
window.pokebuddyManage.onPetAct((action) => onPetAction(action));
window.pokebuddyManage.onPetClosed((gen) => {
  petGen = gen;
  petDeviceOpen = false;
  petDeviceSent = "";
  if (!detailPet) return;
  detailPet = null;
  draw();
});
window.pokebuddyManage.onRoute((route) => void firstDraw.then(() => refresh()).then(() => goTo(route)));
// 시간이 흐르면 만복도·쿨타임·알 준비가 바뀐다. 앱 전역 1초 시계(`manage:clock`)마다 다시 읽는다 (clockTick)
window.pokebuddyManage.onClock?.(() => void clockTick());
