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
  DexEntry,
  EggView,
  FormView,
  ManageReply,
  ManageRoute,
  PatchNotesView,
  PetView,
  PortraitAsk,
  ScreenView,
  ShopItemView,
  SlotView,
  SaveSummaryView,
  Snapshot,
  TradeCardView,
  TradeScreen,
  UpdateView,
} from "../shared/manage.js";

type TabId = "party" | "box" | "dex" | "shop" | "bag" | "trade";

const TABS: { id: TabId; label: string }[] = [
  { id: "party", label: "파티" },
  { id: "box", label: "박스" },
  { id: "dex", label: "도감" },
  { id: "shop", label: "상점" },
  { id: "bag", label: "가방" },
  { id: "trade", label: "교환" }, // 친구 교환 — 가방 옆 (worklog/records/trade/record.md, 2026-09-26 사용자 결정)
];

// 만복도 구간 → 화면 낱말. 계약의 구간 이름과 1:1 이다
const ZONE_WORD: Record<string, string> = { full: "배부름", normal: "보통", hungry: "배고픔", starving: "매우 배고픔" };
// 만복도 구간별 디버프 — 파티 칸의 상태 배지 (Figma `Party Slot Card` 의 debuff 자리)
const DEBUFF: Record<string, { label: string; tone: "warning" | "danger"; note: string }> = {
  hungry: { label: "배고픔", tone: "warning", note: "친밀도 증가량 −30%" },
  starving: { label: "매우 배고픔", tone: "danger", note: "친밀도 증가량 −60%" },
};

const SHOP_TABS = [
  { id: "all", label: "전체" },
  { id: "egg", label: "알" },
  { id: "pokemon", label: "포켓몬" },
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


// 여러 개 살 수 있는 상품 — 알·포켓몬·파티 칸은 하나씩만 산다
const MULTI_BUY = new Set(["tool", "evolution"]);

// 성격을 골라야 하는 도구 — 고르는 화면이 아직 없어 여기서 막는다

// 가이드북 — 구성은 docs/specs/game.md "튜토리얼과 가이드북" 의 다섯 주제다.
// 숫자는 적지 않는다. 밸런스 값이 바뀌어도 이 문구가 어긋나지 않게 한다
const GUIDE: { title: string; lines: string[] }[] = [
  {
    title: "돌봄",
    lines: [
      "밥을 주면 만복도가 오른다. 쿨타임이 지나야 다시 줄 수 있다.",
      "놀아주면 친밀도가 오른다. 쿨타임이 지난 뒤 남은 시간 안에 이어서 놀아주면 중첩이 오른다.",
      "세 번 이어서 놀아주면 오래 놀아주기가 되고 친밀도 증가량이 늘어난다.",
      "PC 잠금·절전·앱 종료 중에는 시간이 흐르지 않는다.",
    ],
  },
  {
    title: "상점과 알",
    lines: [
      "포인트로 알, 포켓몬, 도구, 진화용 도구, 파티 칸을 산다.",
      "산 알은 돌보미집으로 간다. 쓰다듬기와 노래로 준비 시간을 줄인다.",
      "돌봄 행동의 종류와 횟수가 나오는 종을 바꾼다. 어떤 조합이 어떤 종을 부르는지는 직접 찾는다.",
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
  | { kind: "nature"; petId: string; pick?: string; itemId?: string; listOpen?: boolean } // 성격 변경 — pick 은 고른 성격, itemId 는 가방의 민트로 왔을 때
  | { kind: "nature-target"; itemId: string } // 가방의 민트 — 성격을 바꿀 개체를 고른다
  | { kind: "buy"; productId: string; qty: number }
  | { kind: "pick-box"; slotIndex: number } // 칸이 정해졌고 넣을 박스 개체를 고른다
  | { kind: "pick-slot"; petId: string } // 개체가 정해졌고 넣을 파티 칸을 고른다
  | { kind: "achievements" }
  | { kind: "settings"; tab: SettingsTab }
  | { kind: "user"; tab: UserTab } // 사용자 — 계정·연결 (헤더 유저 아이콘)
  | { kind: "guide" }
  | { kind: "hatched"; petId?: string; slotIndex?: number; eggId?: string } // 부화 결과 — 태어난 개체 또는 포켓몬 대신 나온 알
  | { kind: "form"; petId: string; to: string } // 공유 sid 계열의 모습 바꾸기 확인
  | { kind: "notes"; pick?: string } // 패치노트 — 설정 바닥의 `패치노트`. pick 은 왼쪽 목록에서 고른 버전
  | { kind: "notes-new"; version: string }; // 업데이트 뒤 처음 켤 때 한 번 — 그 버전만

let tab: TabId = "party";
let view: Snapshot | null = null;
let detailPet: string | null = null; // 개체 상세 페이지에 띄운 개체 — 있으면 탭 본문 대신 상세를 그린다
let dexRows: DexEntry[] | null = null;
// 도감에서 고른 칸 — 상세는 관리 창 옆 도감 기기 창이 보인다 (src/main/dex-window.ts)
let dexPick: string | null = null;
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
let shopFilter = "all";
let dexFilter = "all";
// 도감 지방 — 최초 등장 지방 기준의 전국도감 번호 구간 (Figma 05 `Dex / Base` `381:6028` 의 "지방: 전체 ▾").
// 지방 폼은 도감 자료에 따로 없어 번호 구간만으로 나눈다. 폼 항목이 생기면 번호로만 판정하지 않는다(스펙)
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

const button = (cls: string, text?: string): HTMLButtonElement => {
  const b = el("button", cls || undefined, text);
  b.type = "button";
  return b;
};

const point = (n: number): string => `${n.toLocaleString("ko-KR")}P`;

// 값 막대 하나 — 이름, 현재/최대, 채움
function meter(label: string, value: number, zone?: string): HTMLElement {
  const box = el("div", "meter");
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

  // 레벨과 이름을 한 줄에 — Figma `Party Slot Card` 123:149. 다음 레벨까지는 칸의 title 로 옮겼다
  const info = el("div", "info");
  const top = el("div", "top");
  top.append(el("span", undefined, `Lv.${pet.level}`), el("div", "name", pet.name));
  info.appendChild(top);

  const tags = el("div", "tags");
  pet.types.forEach((name, i) => tags.appendChild(typeBadge(name, pet.typeIds[i])));
  tags.appendChild(el("span", "tag nature", pet.nature));
  if (pet.longPlay) tags.appendChild(el("span", "tag", "오래 놀아주기"));
  info.appendChild(tags);

  const meters = el("div", "meters");
  meters.append(meter("친밀도", pet.affinity), meter("만복도", pet.fullness, pet.zone));
  info.appendChild(meters);

  card.appendChild(info);
  // 디버프 배지 — 배고픔 −30%, 매우 배고픔 −60% (docs/specs/balance.md). 디버프가 없으면 두지 않는다
  const debuff = DEBUFF[pet.zone];
  if (debuff) {
    const box = el("div", "debuffs");
    const badge = el("span", `debuff ${debuff.tone}`, debuff.label);
    badge.title = debuff.note;
    box.appendChild(badge);
    card.appendChild(box);
  }
  card.addEventListener("click", () => openPet(pet.id));
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

function blankCard(slot: SlotView): HTMLElement {
  const card = button("slot blank");
  if (slot.state === "locked") {
    card.classList.add("locked");
    card.disabled = true;
    card.append(el("strong", undefined, "잠긴 칸"));
    return card;
  }
  card.append(el("strong", undefined, "빈 칸"), el("small", undefined, "박스에서 고르기"));
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

function eggCard(egg: EggView): HTMLElement {
  const card = el("div", "egg");
  card.appendChild(eggIcon(egg.kind, "shell"));
  card.appendChild(el("div", undefined, egg.name));
  card.appendChild(el("div", "note", egg.ready ? "준비 완료" : `${egg.percent}% · ${waitWord(egg.remainSec)}`));
  card.appendChild(el("div", "note", `쓰다듬기 ${egg.actions.pat} · 노래 ${egg.actions.song}`));

  // 열기는 한 줄을 혼자 쓴다. 돌봄 두 개와 나란히 두면 글자가 줄바꿈된다
  if (egg.ready) {
    const row = el("div", "acts");
    const openEgg = button("primary", "열기");
    openEgg.addEventListener("click", () => void openEggAndShow(egg.id));
    row.appendChild(openEgg);
    card.appendChild(row);
  }
  const acts = el("div", "acts");
  for (const [action, label] of [["pat", "쓰다듬기"], ["song", "노래"]] as const) {
    const b = button("", label);
    b.disabled = !egg.careReady;
    b.addEventListener("click", () => void send("egg.care", egg.id, { action }));
    acts.appendChild(b);
  }
  card.appendChild(acts);
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
// 한글은 조합 중인 글자가 있다. 조합 중에는 다시 그리지 않고, 조합이 끝나면 그린다

function searchBox(key: string, value: string, placeholder: string, onChange: (q: string) => void): HTMLInputElement {
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

// 이름은 부분 일치, 숫자만 넣으면 도감 번호 앞자리 일치("025" 와 "25" 가 같다)
function matchesName(name: string, q: string): boolean {
  return name.toLowerCase().includes(q);
}
function matchesDex(row: DexEntry, q: string): boolean {
  if (/^\d+$/.test(q)) return String(row.dex).startsWith(String(Number(q)));
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
type JosaPair = "은/는" | "이/가" | "을/를" | "으로/로" | "과/와";
function josa(word: string, pair: JosaPair): string {
  const [withBatchim, without] = pair.split("/") as [string, string];
  const last = word.trim().slice(-1);
  let b: "none" | "rieul" | "other" = "none";
  if (/[0-9]/.test(last)) b = "178".includes(last) ? "rieul" : "036".includes(last) ? "other" : "none";
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
  bodyEl.appendChild(head("박스", `보관 ${kept}마리 · 박스 ${v.boxes.length}개`));

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
  if (!boxSortOpen && !dexRegionOpen) return;
  boxSortOpen = false;
  dexRegionOpen = false;
  draw();
});

// ── 도감 ───────────────────────────────────────────────────────────────────────

function dexCell(row: DexEntry): HTMLElement {
  const cell = button(row.state === "locked" ? "dex-cell locked" : "dex-cell");
  cell.dataset.slug = row.slug;
  cell.setAttribute("aria-pressed", String(row.slug === dexPick));
  cell.addEventListener("click", () => pickDex(row.slug));
  // 미해금 종은 그림을 검은 실루엣으로 보인다 — CSS .dex-cell.locked .art (2026-09-27 사용자 결정 "모든 미해금에 다 하자")
  cell.append(el("div", "no", `#${String(row.dex).padStart(4, "0")}`), portraitOf(row.slug, false, "dot", "", true));
  cell.appendChild(el("div", undefined, row.state === "locked" ? "???" : row.name));
  if (row.state === "obtained") cell.appendChild(el("div", "no", row.shiny ? "이로치 획득" : "획득"));
  if (row.condition) cell.title = `발견한 조건: ${row.condition}`;
  return cell;
}

// 고른 칸 표시만 바꾼다 — 격자를 다시 그리면 스크롤이 튄다 (worklog/records/play-bugs/record.md)
function markDexPick(): void {
  for (const cell of bodyEl.querySelectorAll<HTMLElement>(".dex-cell")) cell.setAttribute("aria-pressed", String(cell.dataset.slug === dexPick));
}

// 칸을 누르면 도감 기기 창에 그 종을 띄운다. 같은 칸을 다시 누르면 닫는다
function pickDex(slug: string): void {
  dexPick = dexPick === slug ? null : slug;
  window.pokebuddyManage.dexOpen(dexPick);
  markDexPick();
}

// 지금 격자에 보이는 목록 — 지방, 검색어, 등록 상태 칩을 함께 적용한다. 기기 창의 이전·다음도 이 순서를 따른다
function dexShown(): DexEntry[] {
  if (!dexRows) return [];
  const q = normQuery(dexQuery);
  const region = DEX_REGIONS.find((r) => r.id === dexRegion) ?? DEX_REGIONS[0];
  const inRegion = (dex: number): boolean => !region || (dex >= region.from && dex <= region.to);
  return dexRows.filter((r) => inRegion(r.dex) && (dexFilter === "all" || r.state === dexFilter) && (!q || matchesDex(r, q)));
}

// 지방 고르기 — 박스 정렬과 같은 모양의 목록. 바깥을 누르면 닫힌다
function dexRegionEl(): HTMLElement {
  const wrap = el("div", "box-sort left");
  const current = DEX_REGIONS.find((r) => r.id === dexRegion) ?? DEX_REGIONS[0];
  const toggle = button("sort-toggle", `지방: ${current?.label ?? "전체"} ▾`);
  toggle.setAttribute("aria-expanded", String(dexRegionOpen));
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    dexRegionOpen = !dexRegionOpen;
    draw();
  });
  wrap.appendChild(toggle);
  if (dexRegionOpen) {
    const menu = el("div", "sort-menu");
    menu.setAttribute("role", "menu");
    for (const r of DEX_REGIONS) {
      const item = button(r.id === dexRegion ? "sort-item on" : "sort-item", r.label);
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(r.id === dexRegion));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        dexRegion = r.id;
        dexRegionOpen = false;
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
  window.pokebuddyManage.dexOpen(dexPick);
  markDexPick();
  bodyEl.querySelector<HTMLElement>(`.dex-cell[data-slug="${CSS.escape(dexPick)}"]`)?.scrollIntoView({ block: "nearest" });
}

function drawDex(v: Snapshot): void {
  bodyEl.appendChild(head("도감", `획득 ${v.dex.obtained} · 해금 ${v.dex.unlocked} · 이로치 ${v.dex.shiny}`));
  // 지방·이름·번호 검색 — 등록 상태 칩과 함께 적용한다
  const bar = el("div", "search-row");
  bar.appendChild(dexRegionEl());
  bar.appendChild(
    searchBox("dex", dexQuery, "이름 또는 번호 검색", (q) => {
      dexQuery = q;
      draw();
    }),
  );
  bodyEl.appendChild(bar);
  bodyEl.appendChild(
    chips(DEX_TABS, dexFilter, (id) => {
      dexFilter = id;
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
  // 전부 그린다(2026-09-25 사용자 요청). 화면 밖 칸은 CSS content-visibility 로 그리기를 미루고, 초상은 보이는 칸만 받는다
  const grid = el("div", "dex-grid");
  for (const row of rows) grid.appendChild(dexCell(row));
  bodyEl.appendChild(grid);
}

// ── 상점 ───────────────────────────────────────────────────────────────────────

// 상점 줄의 그림 — 포켓몬 상품은 초상, 랜덤알은 알, 도구는 도구 그림. 칸 늘리기처럼 그림이 없는 상품은 빈 칸
function shopThumb(item: ShopItemView): HTMLElement {
  if (item.category === "pokemon") return portraitOf(item.id, false, "thumb round");
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
  card.append(body, el("div", "price", point(item.price)));
  // 살 수 없어도 누를 수 있다. 이유는 구매 창이 보여 준다
  card.addEventListener("click", () => open({ kind: "buy", productId: item.id, qty: 1 }));
  if (item.id === "random") card.dataset.tut = "shop"; // 상점 튜토리얼이 밝히는 곳
  return card;
}

function drawShop(v: Snapshot): void {
  bodyEl.appendChild(head("상점"));
  bodyEl.appendChild(
    chips(SHOP_TABS, shopFilter, (id) => {
      shopFilter = id;
      draw();
    }),
  );
  const rows = v.shop.filter((i) => shopFilter === "all" || i.category === shopFilter);
  if (!rows.length) {
    bodyEl.appendChild(el("div", "empty-note", "파는 것이 없습니다."));
    return;
  }
  const list = el("div", "rows");
  for (const item of rows) list.appendChild(shopRow(item));
  bodyEl.appendChild(list);
}

// ── 가방 ───────────────────────────────────────────────────────────────────────
// Figma 05 `Bag / Base` `381:6555` — 분류 칩, 4열 도구 칸, 고른 도구의 사용 패널(파티·박스 대상, 수량과 최대, 미리보기).
// 진화용 도구와 민트는 대상과 결과를 고르는 창이 따로 있어 그 창을 연다. 여러 개 쓰기는 경험사탕·이상한사탕만 되고 한 거래다
// (2026-09-27 사용자 결정 "수량 선택 + 최대", src/tx/handlers.ts useHandler)

const BAG_TABS = [
  { id: "all", label: "전체" },
  { id: "candy", label: "사탕" },
  { id: "food", label: "먹이" },
  { id: "evolution", label: "진화의돌" },
  { id: "mint", label: "민트" },
  { id: "toy", label: "장난감" },
  { id: "potion", label: "약" },
];
let bagFilter = "all";
let bagPick: string | null = null; // 사용 패널에 연 도구
let bagScope: "party" | "box" = "party";
let bagTarget: string | null = null;
let bagQty = 1;

function bagCategory(item: BagItemView): string {
  if (item.evolution) return "evolution";
  if (item.natures) return "mint";
  if (item.effect === "exp" || item.effect === "level") return "candy";
  if (item.effect === "fullness" || item.effect === "fullness-full-buff") return "food";
  if (item.effect === "play-buff") return "toy";
  return "potion";
}
const bagMany = (item: BagItemView): boolean => item.effect === "exp" || item.effect === "level";

function bagCard(item: BagItemView): HTMLElement {
  const card = button("bag-card");
  card.setAttribute("aria-pressed", String(item.id === bagPick));
  const info = el("div", "info");
  info.append(el("div", "name", item.name), el("div", "qty", `×${item.count.toLocaleString("ko-KR")}`)); // 천 단위 쉼표
  card.append(iconOf(`item:${item.id}`, "thumb"), info);
  card.addEventListener("click", () => {
    if (item.evolution) return open({ kind: "evo-target", itemId: item.id });
    if (item.natures) return open({ kind: "nature-target", itemId: item.id });
    bagPick = bagPick === item.id ? null : item.id;
    bagQty = 1;
    notice = "";
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
  bodyEl.appendChild(
    chips(BAG_TABS, bagFilter, (id) => {
      bagFilter = id;
      draw();
    }),
  );
  const items = v.bag.filter((i) => bagFilter === "all" || bagCategory(i) === bagFilter);
  if (!items.length) bodyEl.appendChild(el("div", "empty-note", "이 분류의 도구가 없습니다."));
  else {
    const grid = el("div", "bag-grid");
    for (const item of items) grid.appendChild(bagCard(item));
    bodyEl.appendChild(grid);
  }
  const picked = v.bag.find((i) => i.id === bagPick);
  if (!picked) {
    bagPick = null;
    return;
  }
  bodyEl.appendChild(bagPanel(v, picked));
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
      return [`만복도 ${Math.round(pet.fullness)} → 100`, "친밀도 증가량 ×2 · 2시간"];
    case "play-buff":
      return ["오래 놀아주기", "친밀도 증가량 ×1.5 · 30분"];
    case "shiny-on":
      return ["이로치로 바뀌어요", "돌아오는 약으로 되돌릴 수 있어요"];
    case "shiny-off":
      return ["일반 색으로 돌아가요", "도감의 이로치 기록은 남아요"];
    default:
      return [item.name];
  }
}

function bagPanel(v: Snapshot, item: BagItemView): HTMLElement {
  const panel = el("div", "use-panel");
  const top = el("div", "use-head");
  const x = button("close", "✕");
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", () => {
    bagPick = null;
    notice = "";
    draw();
  });
  top.append(el("strong", undefined, item.name), el("span", "stock", `보유 ×${item.count.toLocaleString("ko-KR")}`), el("span", "spacer"), x);

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
        bagQty = 1;
        notice = "";
        draw();
      },
    ),
  );
  const rows = el("div", "use-list");
  for (const p of list) {
    const row = button("use-target");
    row.setAttribute("aria-pressed", String(p.id === bagTarget));
    row.append(portraitOf(p.species, p.shiny, "use-portrait"), el("strong", undefined, p.name), el("span", "lv", `Lv.${p.level}`));
    row.addEventListener("click", () => {
      bagTarget = p.id;
      bagQty = 1;
      notice = "";
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
    if (notice) right.appendChild(el("div", "notice bad", notice));
    const label = many ? `${bagQty.toLocaleString("ko-KR")}개 사용` : "사용";
    right.appendChild(
      actions(
        actionButton("취소", false, false, () => {
          bagPick = null;
          notice = "";
          draw();
        }),
        actionButton(label, true, !!blocked, () => {
          const target = pet.id;
          void send("bag.use", item.id, { petId: target, ...(many && bagQty > 1 ? { count: bagQty } : {}) }).then((ok) => {
            if (!ok) return draw();
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
  panel.append(top, cols);
  return panel;
}

// ── 교환 ───────────────────────────────────────────────────────────────────────
// Figma 05 Screens `633:18522` 의 교환 6화면 — Base·Link Created·Offer·Blocked·Done·Error.
// 값은 메인이 만든 TradeScreen(src/main/trade-screen.ts). 조작은 명령 trade.* 로 보내고, 결과와 실시간 변경은 같은 값으로 온다.
// 교환 흐름은 메인이 들고 있다. 여기서는 받은 값을 그리기만 한다

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
  if (tab === "trade") draw();
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
    draw();
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
  if (trade.received && trade.received.petId !== before) view = await window.pokebuddyManage.snapshot(); // 교환이 끝났다 — 바뀐 개체를 다시 받는다
  draw();
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

// 설명이 없으면 제목 줄만 그린다
function tradeBanner(title: string, desc: string, tone: "ok" | "bad"): HTMLElement {
  const box = el("div", "trade-card trade-banner");
  const head = el("div", "trade-banner-title");
  head.append(el("i", tone), document.createTextNode(title));
  box.appendChild(head);
  if (desc) box.appendChild(el("div", "trade-desc", desc));
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
function drawTradeStart(t: TradeScreen): void {
  const row = el("div", "trade-row");

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
      draw();
      setTimeout(() => {
        tradeCopied = false;
        if (tab === "trade") draw();
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
  const input = searchBox("trade-link", tradeInput, "교환 링크 붙여넣기", (q) => {
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
        draw();
      }
    });
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go.click();
  });
  acts.append(input, go);
  join.appendChild(acts);

  row.append(host, join);
  bodyEl.appendChild(row);

  const rules = el("div", "trade-card");
  rules.appendChild(tradeCardHead("교환 규칙"));
  for (const line of ["한 번에 한 마리씩 맞바꿔요", "받은 포켓몬은 보낸 포켓몬이 있던 자리로 가요", "단일 포켓몬은 교환할 수 없어요"]) rules.appendChild(el("div", "trade-desc", line));
  bodyEl.appendChild(rules);
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
function drawTradeOffer(t: TradeScreen): void {
  const row = el("div", "trade-row");
  const mine = el("div", "trade-card");
  mine.append(tradeCardHead("내 포켓몬", t.myReady ? tradeState("확정함", "ok") : tradeState("확정 전", "idle")), tradePetLine(t.mine, "아래에서 보낼 포켓몬을 골라요"));
  const friend = el("div", "trade-card");
  const friendTitle = t.friendName ? `${t.friendName}의 포켓몬` : "친구 포켓몬";
  const friendState = t.friendBlocked ? tradeState("받을 수 없음", "bad") : t.friendReady ? tradeState("확정함", "ok") : t.friend ? tradeState("확정 전", "idle") : tradeState("고르는 중", "wait");
  friend.append(tradeCardHead(friendTitle, friendState), tradePetLine(t.friend, ""));
  row.append(mine, friend);
  bodyEl.appendChild(row);

  if (t.friendBlocked) {
    const name = t.friend?.name ?? "이 포켓몬";
    const why = t.friendBlocked === "single" ? `${name}${josa(name, "은/는")} 단일 포켓몬이라 교환할 수 없어요.` : `${name}의 정보가 올바르지 않아요.`;
    bodyEl.appendChild(tradeBanner("받을 수 없는 포켓몬이에요", `${why} 친구가 다른 포켓몬을 올려야 확정할 수 있어요`, "bad"));
  }

  const bar = el("div", "trade-bar");
  bar.appendChild(el("div", "trade-desc", "한쪽이 포켓몬을 바꾸면 양쪽 확정이 풀려요"));
  const canReady = !!t.mine && !!t.friend && !t.friendBlocked && !t.busy;
  bar.append(
    actionButton("나가기", false, t.busy, () => void tradeSend("trade.leave")),
    t.myReady ? actionButton("확정 취소", false, t.busy, () => void tradeSend("trade.unready")) : actionButton("확정", true, !canReady, () => void tradeSend("trade.ready")),
  );
  bodyEl.appendChild(bar);
  bodyEl.appendChild(tradePicker(t));
}

// 교환 완료 — Done
function drawTradeDone(t: TradeScreen): void {
  bodyEl.appendChild(tradeBanner("교환 완료", "", "ok"));
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
  bodyEl.appendChild(card);
}

function drawTrade(): void {
  bodyEl.appendChild(head("교환"));
  const t = trade;
  if (!t) {
    bodyEl.appendChild(el("div", "empty-note", "교환 상태를 읽는 중이에요."));
    void loadTrade();
    return;
  }
  if (!t.available) {
    bodyEl.appendChild(el("div", "empty-note", "교환을 쓸 수 없어요."));
    return;
  }
  // 오류·닫힘 배너 — 같은 자리에 제목과 문구만 바뀐다
  const err = t.error;
  if (err) {
    const text = err.code === "LOCAL" ? [TRADE_LOCAL[err.detail ?? ""] ?? "교환을 진행하지 못했어요", err.detail === "locked" ? "" : "다른 포켓몬을 골라 주세요"] : TRADE_ERROR[err.code] ?? ["교환을 진행하지 못했어요", `잠시 뒤에 다시 해 주세요 (${err.code})`];
    bodyEl.appendChild(tradeBanner(text[0] ?? "", text[1] ?? "", "bad"));
  } else if (t.phase === "closed") {
    const text = TRADE_CLOSED[t.closedReason ?? ""] ?? ["교환이 닫혔어요", "새 링크로 다시 시작해 주세요"];
    bodyEl.appendChild(tradeBanner(text[0], text[1], "bad"));
  }
  if (t.phase === "trading") drawTradeOffer(t);
  else if (t.phase === "done") drawTradeDone(t);
  else drawTradeStart(t);
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
  // 교환이 끝나 개체가 바뀌었다 — 스냅샷도 다시 받는다. 받지 않으면 보낸 개체가 파티·박스에 남아 보인다(2026-09-27 화면 E2E 에서 발견)
  if (got) void refresh();
  else if (tab === "trade" && !detailPet) draw();
});

// ── 계정과 클라우드 저장 ──────────────────────────────────────────────────────────
// Figma 05 Screens `633:19206`(로그인)·`633:19302`(가입)·`633:19425`(로그인 뒤)·`633:19529`(저장 필요)·`633:19631`(삭제 확인)·
// `633:19744`(막힘)·`633:19841`(밀려남 배너)·`633:19895`(로그아웃 확인)·`633:20029`(로그인 때 고르기). 헤더 저장 표시는 C-27.
// 값은 메인이 준다(src/main/online.ts). 입력한 글자는 여기 들고 있다 — 5초마다 다시 그려도 사라지지 않게

let acct: AccountScreen | null = null;
let acctLoading = false;
let acctBusy = false;
let acctGithub = false; // 브라우저에서 GitHub 로그인을 기다리는 중
const acctForm = { mode: "sign-in" as "sign-in" | "sign-up", username: "", password: "", password2: "", displayName: "", error: "", check: "" as "" | "available" | "taken" | "invalid" | "NETWORK" };
let acctRename: string | null = null; // 이름 바꾸는 중이면 입력한 이름
let acctConfirm: "delete" | "logout" | null = null;
let acctPick: "server" | "local" = "server"; // 로그인 때 고르기 — 기본은 계정 저장
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
  CLOUD_TRADE_ACTIVE: "다른 PC 에서 교환 중이라 넘겨받을 수 없어요",
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

// 헤더 저장 표시 — 로그인하지 않았으면 숨긴다. 누르면 사용자 모달의 계정 탭을 연다
function drawSaveIndicator(): void {
  const c = acct?.signedIn ? acct.cloud : null;
  // 고르기를 기다리는 동안은 "저장 고르기"를 강조해 보인다 — 끄고 다시 켜도 기다리는 것을 알게(R3-07). 누르면 계정 탭
  const state = !c || c.status === "off" ? null : c.status === "choose" ? "need" : c.status === "save-needed" ? "need" : c.status === "online" ? "ok" : "offline";
  saveIndicatorEl.hidden = !state;
  if (!state || !c) return;
  saveIndicatorEl.dataset.state = state;
  const text = state === "need" ? (c.status === "choose" ? "저장 고르기" : "저장 필요") : state === "ok" ? (c.lastSavedAt ? `저장됨 · ${ago(c.lastSavedAt)}` : "저장됨") : c.status === "connecting" ? "연결 중" : "오프라인";
  saveIndicatorEl.replaceChildren(el("i"), document.createTextNode(text));
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
}

const ACCOUNT_OFF: AccountScreen = {
  available: false, signedIn: false, method: null, username: null, displayName: null, blocked: false, kicked: false,
  cloud: { status: "off", lastSavedAt: null, busy: false, error: null, choice: null },
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

// 입력칸 — searchBox 의 포커스 복원을 쓴다. 다시 그려도 커서가 그대로다
function acctInput(key: string, value: string, placeholder: string, type: "text" | "password", onChange: (v: string) => void): HTMLInputElement {
  const input = searchBox(key, value, placeholder, onChange);
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
  const box = el("div", "trade-card trade-banner acct-notice");
  const head = el("div", "trade-banner-title");
  head.append(el("i", tone === "warn" ? "warn" : "bad"), document.createTextNode(title));
  box.append(head, el("div", "trade-desc", desc));
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

function drawSignIn(scroll: HTMLElement): void {
  const blocked = !!acct?.blocked;
  if (blocked) scroll.appendChild(acctNotice("교환 중에는 계정을 바꿀 수 없어요", "교환을 끝내거나 나간 뒤 다시 시도해 주세요", "warn"));
  else scroll.appendChild(el("div", "acct-lead", "로그인하지 않아도 교환할 수 있어요"));
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

function acctRow(title: string, hint: string, control: HTMLElement): HTMLElement {
  const row = el("div", "setting acct-row");
  const body = el("div", "body");
  body.append(el("div", "label", title), el("div", "hint", hint));
  row.append(body, control);
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
  // 저장
  const c = a.cloud;
  const need = c.status === "save-needed";
  const saveHint = need ? "저장하지 않은 진행이 있어요"
    : c.status === "online" ? (c.lastSavedAt ? `계정에 저장됨 · ${ago(c.lastSavedAt)}` : "계정에 저장됨")
    : c.status === "offline" ? "오프라인이에요 · 게임은 그대로 할 수 있어요"
    : "연결하는 중이에요";
  const save = button(need ? "act primary acct-save need" : "act", need ? "" : "지금 저장");
  if (need) save.append(el("i"), document.createTextNode("저장"));
  save.disabled = acctBusy || c.busy || !(c.status === "online" || need);
  save.addEventListener("click", () => void acctSend({ action: "save-now" }));
  scroll.appendChild(acctRow("저장", c.error && c.status !== "online" ? `${saveHint} · ${acctErrorText(c.error)}` : saveHint, save));
  // 로그아웃·삭제
  scroll.appendChild(acctRow("로그아웃", "게임 진행은 그대로예요", actionButton("로그아웃", false, acctBusy || a.blocked, () => {
    if (a.cloud.status === "save-needed") {
      acctConfirm = "logout";
      redrawAccount();
    } else void acctSend({ action: "sign-out" });
  })));
  scroll.appendChild(acctRow("계정 삭제", "되돌릴 수 없어요", actionButton("계정 삭제", false, acctBusy || a.blocked, () => { acctConfirm = "delete"; redrawAccount(); })));
}

// 사용자 모달 위의 작은 확인 창 — 계정 삭제·로그아웃·로그인 때 고르기
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
  if (a.cloud.status === "choose" && a.cloud.choice) {
    const choice = a.cloud.choice;
    // 고르지 않고 닫으면 로그인하지 않은 것으로 — 로그아웃한다
    const cancel = (): void => void acctSend({ action: "sign-out" });
    x.onclick = cancel;
    head.append(el("h3", undefined, "어느 저장을 쓸까요?"), x);
    card.append(head, el("p", "acct-confirm-body", "이 계정에 이미 저장이 있어요. 고르지 않은 쪽은 백업 파일로 남아요."));
    if (a.cloud.error) {
      const err = el("div", "acct-note bad");
      err.append(el("i"), document.createTextNode(a.cloud.error === "CLOUD_BAD_SAVE" ? "계정 저장을 읽을 수 없어요. 이 PC 저장을 골라 주세요" : acctErrorText(a.cloud.error)));
      card.appendChild(err);
    }
    // "오늘 09:12 저장"·"어제 21:40 저장"·"9월 25일 18:03 저장" (Figma `633:20029`)
    const when = (at: number | null): string => {
      if (!at) return "";
      const d = new Date(at);
      const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
      const diff = Math.round((day(new Date()) - day(d)) / 86_400_000);
      return `${diff === 0 ? "오늘" : diff === 1 ? "어제" : `${d.getMonth() + 1}월 ${d.getDate()}일`} ${hm} 저장`;
    };
    const option = (id: "server" | "local", title: string, s: SaveSummaryView | null): HTMLElement => {
      const b = button("acct-option", "");
      b.setAttribute("aria-pressed", String(acctPick === id));
      b.append(el("strong", undefined, title), el("span", undefined, s ? [`포켓몬 ${s.pets}마리`, point(s.points), when(s.savedAt)].filter(Boolean).join(" · ") : "저장 없음"));
      b.disabled = acctBusy || (id === "local" && !s);
      b.addEventListener("click", () => { acctPick = id; redrawAccount(); });
      return b;
    };
    card.append(option("server", "계정 저장", choice.server), option("local", "이 PC 저장", choice.local));
    card.appendChild(actions(el("div", "spacer"), actionButton("취소", false, acctBusy, cancel), actionButton("이 저장으로 계속", true, acctBusy, () => void acctSend({ action: "choose", which: acctPick }))));
  } else if (acctConfirm === "delete") {
    head.append(el("h3", undefined, "계정을 삭제할까요?"), x);
    const who = a.method === "github" ? `GitHub 계정 ${a.displayName ?? ""}` : `아이디 ${a.username ?? ""}`;
    card.append(head, el("p", "acct-confirm-body", `${who}${josa(who, "을/를")} 지워요. 게임 진행은 그대로예요.\n교환이 끝나지 않은 친구의 포켓몬은 그대로 받아요.`));
    card.appendChild(actions(el("div", "spacer"), actionButton("취소", false, acctBusy, shut), actionButton("삭제", true, acctBusy, () => {
      void acctSend({ action: "delete" }).then(() => { acctConfirm = null; redrawAccount(); });
    })));
  } else if (acctConfirm === "logout") {
    head.append(el("h3", undefined, "저장하지 않은 진행이 있어요"), x);
    card.append(head, el("p", "acct-confirm-body", "그냥 로그아웃하면 오프라인 진행은 이 PC에만 남아요."));
    card.appendChild(actions(el("div", "spacer"),
      actionButton("그냥 로그아웃", false, acctBusy, () => void acctSend({ action: "sign-out" }).then(() => { acctConfirm = null; redrawAccount(); })),
      actionButton("저장하고 로그아웃", true, acctBusy, () => void acctSend({ action: "sign-out", save: true }).then(() => { acctConfirm = null; redrawAccount(); }))));
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

// 밀려남 배너 — 탭 본문 맨 위. 닫을 때까지 남는다
function kickedBanner(): HTMLElement | null {
  if (!acct?.kicked) return null;
  const box = el("div", "trade-card trade-banner kicked-banner");
  const head = el("div", "trade-banner-title");
  head.append(el("i", "warn"), document.createTextNode("다른 PC에서 로그인해 로그아웃됐어요"));
  const x = button("dialog-close", "✕");
  x.setAttribute("aria-label", "닫기");
  x.addEventListener("click", () => void acctSend({ action: "dismiss-kicked" }));
  box.append(head, el("div", "trade-desc", "이 PC의 진행은 계정에 저장되지 않아요"), x);
  return box;
}

window.pokebuddyManage.onAccount((screen) => {
  const wasKicked = acct?.kicked;
  acct = screen;
  drawSaveIndicator();
  redrawAccount();
  if (screen.kicked !== wasKicked) draw();
});
void loadAccount();
setInterval(drawSaveIndicator, 30_000); // "3분 전" 글자만 바꾼다

// ── 그리기 ─────────────────────────────────────────────────────────────────────

function drawTabs(): void {
  tabsEl.replaceChildren();
  for (const t of TABS) {
    const b = button("", t.label);
    b.setAttribute("aria-selected", String(t.id === tab));
    b.addEventListener("click", () => {
      tab = t.id;
      detailPet = null;
      if (t.id === "dex" && !dexRows) void loadDex();
      if (t.id === "trade") void loadTrade();
      draw();
    });
    tabsEl.appendChild(b);
  }
}

function draw(): void {
  drawTabs();
  bodyEl.replaceChildren();
  if (!view) {
    bodyEl.appendChild(el("div", "empty-note", "저장이 없습니다. 첫 포켓몬을 먼저 고르세요."));
    return;
  }
  pointsEl.textContent = view.points.toLocaleString("ko-KR");
  achDotEl.hidden = view.achievements.unclaimed === 0;
  // 개체 상세 페이지 — 개체가 사라졌으면 탭으로 돌아간다
  const detail = detailPet ? petOf(detailPet) : null;
  if (detail) {
    drawPetPage(detail);
    restoreSearchFocus();
    drawTutorial();
    return;
  }
  detailPet = null;
  const kicked = kickedBanner();
  if (kicked) bodyEl.appendChild(kicked);
  if (tab === "party") drawParty(view);
  else if (tab === "box") drawBox(view);
  else if (tab === "dex") drawDex(view);
  else if (tab === "shop") drawShop(view);
  else if (tab === "trade") drawTrade();
  else drawBag(view);
  drawSaveFailing();
  restoreSearchFocus();
  drawTutorial();
}

// 이어진 저장 실패 안내 — 제목 줄 바로 아래. 한 번 저장하면 다음 새로 읽기에서 사라진다. 조작은 막지 않는다
// Figma 99 `Party / Save Failing` `716:17993` (Status Banner Tone=Error). 2026-09-27 사용자 "그렇게해"
function drawSaveFailing(): void {
  if (!view?.saveFailing) return;
  const banner = tradeBanner("저장하지 못하고 있어요", "3번 이어서 저장하지 못했어요. 디스크 공간과 폴더 권한을 확인해 주세요.", "bad");
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
    name: "부화", tab: "box", title: "알을 돌보면 더 빨리 준비돼요", body: "준비가 끝나면 열기를 눌러야 부화해요.",
    guideTitle: "알은 박스의 돌보미집에 들어갔어요", guideBody: "", guideButton: "박스로 가기",
  },
};
// 업적 튜토리얼 — 헤더의 업적 아이콘을 밝힌다 (Figma 시안 G `514:2444`). 어느 탭에서든 보인다
const ACHIEVEMENT_GUIDE = { title: "보상을 받으면 파티 칸이 하나 열려요", body: "", button: "업적 보기" };

interface CoachSpec {
  step: string;
  title: string;
  body: string;
  button: string;
  onGo: () => void;
}
const COACH = { pad: 8, gap: 12, width: 280, margin: 8 };

let coachEl: HTMLElement | null = null;

// 개체 상세 튜토리얼 — 파티 개체 상세를 처음 열면 위에서 아래로 다섯 곳을 차례로 밝힌다 (Figma 99 766:17274 ~ 770:709)
const DETAIL_STEPS = [
  { tut: "detail-ball", title: "볼을 눌러 넣고 꺼낼 수 있어요", body: "볼에 넣어도 파티에 남아 계속 자라요." },
  { tut: "detail-care", title: "여기서도 돌볼 수 있어요", body: "바탕화면 우클릭 메뉴의 밥 주기·놀아주기와 같아요." },
  { tut: "detail-growth", title: "진화와 성격", body: "조건을 채우면 진화를 눌러 직접 진화해요. 성격은 민트로 바꿔요." },
  { tut: "detail-size", title: "바탕화면 크기", body: "이 포켓몬의 크기만 바뀌어요." },
  { tut: "detail-manage", title: "교체와 박스 보관", body: "박스에 보관하면 성장이 멈춰요." },
] as const;
let detailStep = 0;

function drawTutorial(): void {
  coachEl?.remove();
  coachEl = null;
  const id = view?.tutorial ?? null;
  const detailInParty = detailPet != null && slotOfPet(detailPet) != null;
  if (view && !dialog && detailInParty && view.detailTutorial) {
    const step = DETAIL_STEPS[detailStep];
    const target = step ? bodyEl.querySelector<HTMLElement>(`[data-tut="${step.tut}"]`) : null;
    if (step && target) {
      const last = detailStep === DETAIL_STEPS.length - 1;
      coachEl = coachLayer("detail", target, {
        step: `튜토리얼 · 개체 상세 ${detailStep + 1} / ${DETAIL_STEPS.length}`,
        title: step.title,
        body: step.body,
        button: last ? "확인" : "다음",
        onGo: () => {
          if (last) void send("tutorial.done", "detail", { steps: DETAIL_STEPS.length });
          else {
            detailStep += 1;
            drawTutorial();
          }
        },
      });
    }
  } else if (id && view && !dialog && !detailPet) {
    const text = TUTORIAL_TEXT[id];
    if (id === "achievement") {
      const done = view.achievements.list.find((a) => a.state === "achieved");
      const target = document.getElementById("open-achievements");
      if (done && target) {
        coachEl = coachLayer(id, target, { step: "튜토리얼 · 업적", ...ACHIEVEMENT_GUIDE, onGo: () => open({ kind: "achievements" }) });
      }
    } else if (text && tab === text.tab) {
      const target = bodyEl.querySelector<HTMLElement>(`[data-tut="${id}"]`);
      // 한 단계뿐이면 "1 / 1" 을 붙이지 않고 단추는 "확인" — 바탕화면 튜토리얼과 같다
      if (target) coachEl = coachLayer(id, target, { step: `튜토리얼 · ${text.name}`, title: text.title, body: text.body, button: "확인", onGo: () => void send("tutorial.done", id, { steps: 1 }) });
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
            tab = text.tab;
            detailPet = null;
            draw();
          },
        });
      }
    }
  }
  // OS 가 그리는 창 단추 자리도 함께 어둡게 한다 — 모달 가림막과 같은 통로
  window.pokebuddyManage.dim(dimmed || coachEl != null);
}

function coachLayer(id: string, target: HTMLElement, spec: CoachSpec): HTMLElement {
  const layer = el("div", "coach");
  const r = target.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const hole = { l: Math.max(0, r.left - COACH.pad), t: Math.max(0, r.top - COACH.pad), r: Math.min(W, r.right + COACH.pad), b: Math.min(H, r.bottom + COACH.pad) };
  for (const [x, y, w, h] of [
    [0, 0, W, hole.t],
    [0, hole.b, W, H - hole.b],
    [0, hole.t, hole.l, hole.b - hole.t],
    [hole.r, hole.t, W - hole.r, hole.b - hole.t],
  ] as const) {
    const dim = el("div", "coach-dim");
    Object.assign(dim.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });
    layer.appendChild(dim);
  }
  const bubble = el("div", "coach-bubble");
  const head = el("div", "head");
  const x = button("x", "✕");
  x.setAttribute("aria-label", "튜토리얼 닫기");
  x.addEventListener("click", () => void send("tutorial.skip", id)); // 닫기는 스킵이다
  head.append(el("span", "step", spec.step), x);
  const next = actionButton(spec.button, true, false, spec.onGo);
  bubble.append(head, el("div", "title", spec.title));
  if (spec.body) bubble.appendChild(el("div", "body", spec.body)); // 본문이 없으면 제목 아래 바로 단추
  bubble.appendChild(actions(el("div", "spacer"), next));
  layer.appendChild(bubble);
  document.body.appendChild(layer);
  const left = Math.min(Math.max(COACH.margin, r.left), W - COACH.width - COACH.margin);
  const below = hole.b + COACH.gap;
  const top = below + bubble.offsetHeight > H - COACH.margin ? hole.t - COACH.gap - bubble.offsetHeight : below;
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(Math.max(COACH.margin, top))}px`;
  return layer;
}

// 본문이 스크롤되거나 창 크기가 바뀌면 자리를 다시 잰다
bodyEl.addEventListener("scroll", () => {
  if (coachEl) drawTutorial();
});
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

// ── 개체 상세 페이지 ───────────────────────────────────────────────────────────
// Figma `08 · 개체 상세 시안` 의 시안 C(2단) `453:946` — 2026-09-25 사용자 선택. 모달이 아니라 탭 본문을 차지하는 페이지다.
// 왼쪽 기둥은 프로필(초상·이름·레벨·성격·타입·네 막대), 오른쪽은 돌봄·성장·표시·관리를 짧게 쌓는다.
// 박스 개체는 돌봄·표시가 없다(계약: 박스 상세에는 표시 항목을 두지 않는다). 진화·성격 모달은 이 페이지 위에 뜨고 돌아온다

function pageButton(label: string, primary: boolean, disabled: boolean, run: () => void): HTMLButtonElement {
  const b = button(primary ? "page-btn primary" : "page-btn", label);
  b.disabled = disabled;
  b.addEventListener("click", run);
  return b;
}

// 목록 카드의 한 줄 — 왼쪽에 이름과 설명, 오른쪽에 딸린 것. run 이 있으면 줄 전체를 누른다
function listRow(title: string, desc: string | null, right: HTMLElement[], run?: () => void): HTMLElement {
  const row = run ? button("list-row") : el("div", "list-row");
  const copy = el("div", "copy");
  copy.appendChild(el("div", "title", title));
  if (desc) copy.appendChild(el("div", "desc", desc));
  row.appendChild(copy);
  row.append(...right);
  if (run) {
    row.appendChild(el("span", "chev", "›"));
    row.addEventListener("click", run);
  }
  return row;
}

function listCard(...rows: HTMLElement[]): HTMLElement {
  const box = el("div", "list-card");
  box.append(...rows);
  return box;
}

// 켬·끔 스위치 — Figma `Toggle` `299:3593`
function switchButton(on: boolean, label: string, run: () => void): HTMLButtonElement {
  const b = button("switch");
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", String(on));
  b.setAttribute("aria-label", label);
  b.addEventListener("click", run);
  return b;
}

// 크기 단계 1~sizeLevels — 누를 때마다 한 번 저장한다. 고른 단계는 채운 단추다. 단계 수는 스냅샷이 준다
function sizeButtons(pet: PetView): HTMLElement {
  const group = el("div", "sizes");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "크기");
  const levels = view?.sizeLevels ?? 5;
  for (let n = 1; n <= levels; n++) {
    const b = button("size", String(n));
    b.setAttribute("aria-pressed", String(n === pet.size));
    b.addEventListener("click", () => {
      if (n !== pet.size) void send("pet.set", pet.id, { size: n });
    });
    group.appendChild(b);
  }
  return group;
}

const boxNameOf = (id: string): string | null => view?.boxes.find((b) => b.slots.some((p) => p?.id === id))?.name ?? null;

const BACK_TO: Record<string, string> = { party: "파티로", box: "박스로", dex: "도감으로", shop: "상점으로", bag: "가방으로", trade: "교환으로" };

function drawPetPage(pet: PetView): void {
  const slot = slotOfPet(pet.id);
  const inParty = slot != null;
  const where = inParty ? `파티 ${slot + 1}번` : (boxNameOf(pet.id) ?? "박스");
  const page = el("div", "pet-page");

  // 돌아가기 줄 — 왼쪽 링크, 오른쪽 자리와 상태
  const back = el("div", "back-row");
  // 돌아갈 곳은 연 탭이다 — 개체가 지금 있는 곳이 아니다. 파티에서 박스로 보관해도 파티 탭으로 돌아간다
  const link = button("back-link", `‹  ${BACK_TO[tab] ?? "돌아가기"}`);
  link.addEventListener("click", () => {
    detailPet = null;
    draw();
  });
  back.append(link, el("span", "where", inParty ? `${where} · ${pet.hidden ? "볼 안" : "나와 있음"}` : `${where} · 보관 중`));
  page.appendChild(back);

  const cols = el("div", "pet-cols");

  // 왼쪽 기둥 — 초상, 이름, 레벨·성격, 타입, 네 막대
  const side = el("div", "pet-side");
  const portrait = portraitOf(pet.species, pet.shiny, "portrait big", pet.shiny ? "이로치" : "");
  side.appendChild(portrait);
  // 볼 토글 — 열린 볼은 바탕화면에 나와 있음, 닫힌 볼은 볼 안. 이름은 누르면 일어날 일
  if (inParty) {
    const action = pet.hidden ? "꺼내기" : "볼에 넣기";
    const ball = button(`ball-toggle ${pet.hidden ? "closed" : "open"}`);
    ball.dataset.tut = "detail-ball";
    ball.title = action;
    ball.setAttribute("aria-label", action);
    ball.addEventListener("click", () => void send(pet.hidden ? "party.show" : "party.hide", pet.id));
    side.appendChild(ball);
  }
  side.appendChild(el("div", "name", pet.name));
  side.appendChild(el("div", "sub", `Lv.${pet.level} · ${pet.nature}`));
  const badges = el("div", "badges");
  pet.types.forEach((name, i) => badges.appendChild(typeBadge(name, pet.typeIds[i])));
  side.appendChild(badges);
  const bars = el("div", "bars");
  const bar = (label: string, value: number, shown: string, cls = ""): HTMLElement => {
    const box = el("div", "bar");
    const head = el("div", "head");
    head.append(el("span", undefined, label), el("strong", undefined, shown));
    const track = el("div", "track");
    const fill = el("div", cls ? `fill ${cls}` : "fill");
    fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    track.appendChild(fill);
    box.append(head, track);
    return box;
  };
  bars.append(
    bar("경험치", pet.percentToNext, `${pet.percentToNext}%`),
    bar("친밀도", pet.affinity, `${pet.affinity}`),
    bar("만복도", pet.fullness, `${pet.fullness} · ${ZONE_WORD[pet.zone] ?? pet.zone}`, pet.zone === "hungry" || pet.zone === "starving" ? pet.zone : ""),
    bar("기분", pet.mood, `${pet.mood} · ${pet.moodWord}`, "mood"),
  );
  side.appendChild(bars);
  if (inParty && pet.longPlay) side.appendChild(el("span", "chip-note", "오래 놀아주기"));
  cols.appendChild(side);

  // 오른쪽 — 돌봄, 성장, 표시, 관리
  const main = el("div", "pet-main");
  const label = (s: string): HTMLElement => el("div", "section-label", s);
  if (inParty) {
    main.appendChild(label("돌봄"));
    const care = el("div", "care-row");
    care.dataset.tut = "detail-care";
    const full = pet.fullness >= 100;
    care.append(
      pageButton(full ? "밥 주기 · 배부름" : pet.feedReady ? "밥 주기" : `밥 주기 · ${waitWord(pet.feedInSec)}`, true, !pet.feedReady || full, () => void send("feed", pet.id)),
      pageButton(pet.playReady ? "놀아주기" : "놀아주기 · 쉬는 중", false, !pet.playReady, () => void send("play", pet.id)),
    );
    main.appendChild(care);
  }

  main.appendChild(label("성장"));
  const ready = pet.evolutions.filter((e) => e.ready);
  const evolve = (): void => open({ kind: "evolve", petId: pet.id });
  const evoRow = !pet.evolutions.length
    ? listRow("진화", "더 진화하지 않아요", [])
    : ready.length
      ? listRow(`진화 · ${ready.map((e) => e.name).join(" · ")}`, null, [el("span", "chip-ready", "진화 가능")], evolve)
      : listRow(`진화 · ${pet.evolutions.map((e) => e.name).join(" · ")}`, pet.evolutions.map((e) => e.need ?? "").filter(Boolean).join(" · ") || null, [], evolve); // 필요 조건은 화면에 없는 조건이라 남긴다
  const growth = listCard(evoRow, listRow(`성격 · ${pet.nature}`, null, [], () => open({ kind: "nature", petId: pet.id })));
  growth.dataset.tut = "detail-growth";
  main.appendChild(growth);

  if (inParty) {
    main.appendChild(label("표시"));
    const size = listCard(listRow("크기", null, [sizeButtons(pet)]));
    size.dataset.tut = "detail-size";
    main.appendChild(size);
  }

  const manage = el("div", "manage-row");
  manage.dataset.tut = "detail-manage";
  if (inParty) {
    manage.append(pageButton("교체", false, false, () => open({ kind: "pick-box", slotIndex: slot })), pageButton("박스에 보관", false, false, () => void send("party.keep", pet.id)));
  } else {
    const free = emptySlot();
    manage.appendChild(
      free != null
        ? pageButton("파티에 배치", true, false, () => void send("party.place", pet.id, { slotIndex: free }))
        : pageButton("교체", true, false, () => open({ kind: "pick-slot", petId: pet.id })),
    );
  }
  main.appendChild(manage);
  if (notice) main.appendChild(el("div", "notice bad", notice));
  cols.appendChild(main);
  page.appendChild(cols);
  bodyEl.appendChild(page);
}

// ── 모달 · 진화 확인 ───────────────────────────────────────────────────────────
// 후보마다 결과 종과 상태를 보인다. 가능한 후보가 하나면 그것을 고른 채로 연다.
// `취소` 는 아무것도 바꾸지 않는다 (docs/specs/game.md "진화 확인 화면에서 취소한 개체는 진화 가능 상태를 유지한다")

function drawEvolve(petId: string, to?: string, itemId?: string): void {
  const pet = petOf(petId);
  if (!pet) {
    close();
    return;
  }
  // 가방의 돌로 왔으면 그 돌이 조건인 후보만 보인다
  const list = itemId ? pet.evolutions.filter((c) => c.item === itemId) : pet.evolutions;
  const ready = list.filter((c) => c.ready);
  const picked = list.find((c) => c.to === to && c.ready) ?? (ready.length === 1 ? ready[0] : undefined);
  const back: { label: string; to: Dialog } = itemId ? { label: "대상", to: { kind: "evo-target", itemId } } : { label: pet.name, to: { kind: "pet", petId } };
  dialogEl.append(...dialogHead("진화", ready.length > 1 ? "진화할 모습을 고르세요." : `${pet.name} · Lv.${pet.level}`, back));

  const rows = el("div", "rows");
  for (const c of list) {
    const row = button("row-card");
    const body = el("div", "body");
    body.append(el("div", "title", c.name), el("div", "note", c.ready ? "진화할 수 있어요" : (c.need ?? "조건이 모자라요")));
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
    const item = picked.item ? view?.bag.find((b) => b.id === picked.item) : undefined;
    info.appendChild(el("div", "note", item ? `${item.name} 1개를 씁니다. 레벨·친밀도·성격은 그대로입니다.` : "레벨·친밀도·성격은 그대로입니다."));
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

// 가방의 진화용 도구 — 그 도구로 지금 진화할 수 있는 개체를 고른다. 박스 개체에게도 쓸 수 있다
function drawEvoTarget(itemId: string): void {
  const item = view?.bag.find((b) => b.id === itemId);
  const pets = [...partyPets(), ...boxPets()].filter((p) => p.evolutions.some((c) => c.item === itemId && c.ready));
  dialogEl.append(...dialogHead(item ? item.name : itemId, pets.length ? "누구를 진화시킬까요?" : "이 도구로 지금 진화할 수 있는 포켓몬이 없어요."));
  const acts = pets.map((p) => actionButton(`${p.name} (Lv.${p.level})`, false, false, () => open({ kind: "evolve", petId: p.id, itemId })));
  dialogEl.appendChild(actions(...acts, closeButton()));
}

// ── 모달 · 성격 변경 ───────────────────────────────────────────────────────────
// 왼쪽은 지금, 오른쪽은 바꾼 후다. 오른쪽에서 성격을 고르면 필요한 민트가 가운데에 보인다 (Figma Detail / Nature Change).
// 보정 없는 성격은 모두 성실민트다. 가방의 민트로 왔으면 그 민트가 바꿀 수 있는 성격만 고른다.
// `취소` 는 아무것도 바꾸지 않는다

function drawNature(petId: string, pick: string | undefined, itemId: string | undefined, listOpen: boolean): void {
  const pet = petOf(petId);
  if (!pet || !view) {
    close();
    return;
  }
  const item = itemId ? view.bag.find((b) => b.id === itemId) : undefined;
  const options = view.natures.filter((n) => !item?.natures || item.natures.includes(n.id));
  // 민트 하나로 성격이 정해지면 고른 채로 연다
  const only = options.length === 1 ? options[0] : undefined;
  const chosen = pick ?? (only && only.id !== pet.natureId ? only.id : undefined);
  const picked = options.find((n) => n.id === chosen && n.id !== pet.natureId);
  const back: { label: string; to: Dialog } = itemId ? { label: "대상", to: { kind: "nature-target", itemId } } : { label: pet.name, to: { kind: "pet", petId } };
  const slot = slotOfPet(petId);
  dialogEl.append(...dialogHead("성격을 바꿀까요?", `${pet.name} Lv.${pet.level} · ${slot != null ? `파티 ${slot + 1}번` : "박스"}`, back));
  const redraw = (next: { pick?: string; listOpen?: boolean }): void => open({ kind: "nature", petId, ...(itemId ? { itemId } : {}), ...(chosen ? { pick: chosen } : {}), listOpen: false, ...next });

  const before = el("div", "nat-card");
  before.append(portraitOf(pet.species, pet.shiny, "portrait"), el("div", "name", pet.name), el("div", "note", pet.nature), el("div", "note", "지금"));

  const mid = el("div", "mint-mid");
  mid.append(el("div", undefined, picked ? picked.mintName : "민트"), el("div", undefined, "→"));

  const select = el("div", "select");
  const trigger = button("select-btn");
  trigger.append(el("span", undefined, picked ? picked.name : "성격 고르기"), el("span", "chev", listOpen ? "▴" : "▾"));
  trigger.setAttribute("aria-expanded", String(listOpen));
  trigger.addEventListener("click", () => redraw({ listOpen: !listOpen }));
  select.appendChild(trigger);
  if (listOpen) {
    const list = el("div", "select-list");
    for (const n of options) {
      const opt = button("select-opt");
      const current = n.id === pet.natureId;
      opt.append(el("span", undefined, n.name), el("span", "hint", current ? "지금" : n.mintName));
      opt.disabled = current;
      opt.setAttribute("aria-pressed", String(n.id === picked?.id));
      opt.addEventListener("click", () => redraw({ pick: n.id }));
      list.appendChild(opt);
    }
    select.appendChild(list);
  }
  const after = el("div", "nat-card");
  after.append(portraitOf(pet.species, pet.shiny, "portrait"), el("div", "name", pet.name), select, el("div", "note", "바꾼 후"));

  const row = el("div", "compare");
  row.append(before, mid, after);
  dialogEl.appendChild(row);

  const have = picked ? (view.bag.find((b) => b.id === picked.mint)?.count ?? 0) : 0;
  if (picked) {
    const info = el("div", "info-box");
    if (have > 0) info.append(el("div", undefined, `${picked.mintName} 1개를 씁니다`), el("div", "note", `가방에 ${have.toLocaleString("ko-KR")}개 있어요 · 레벨·친밀도는 그대로`));
    else {
      const price = view.shop.find((p) => p.id === picked.mint)?.price;
      info.append(el("div", undefined, `${picked.mintName}가 없어요`), el("div", "note", price != null ? `상점 도구 분류에서 ${price}P 에 살 수 있어요` : "상점에서 살 수 있어요"));
    }
    dialogEl.appendChild(info);
  }

  const change = actionButton("바꾸기", true, !picked || have === 0, () => {
    if (!picked) return;
    void send("bag.use", picked.mint, { petId, nature: picked.id }).then((ok) => {
      if (ok) open({ kind: "pet", petId });
    });
  });
  dialogEl.appendChild(actions(change, actionButton("취소", false, false, () => open(back.to))));
}

// 가방의 민트 — 성격을 바꿀 개체를 고른다. 파티와 박스 개체 모두 대상이다. 이미 그 성격이면 고를 수 없다
function drawNatureTarget(itemId: string): void {
  const item = view?.bag.find((b) => b.id === itemId);
  const allowed = item?.natures ?? [];
  const pets = [...partyPets(), ...boxPets()];
  dialogEl.append(...dialogHead(item ? item.name : itemId, pets.length ? "누구의 성격을 바꿀까요?" : "성격을 바꿀 포켓몬이 없어요."));
  const acts = pets.map((p) => {
    const same = allowed.length === 1 && allowed[0] === p.natureId;
    return actionButton(`${p.name} (${p.nature})`, false, same, () => open({ kind: "nature", petId: p.id, itemId }));
  });
  dialogEl.appendChild(actions(...acts, closeButton()));
}

// ── 모달 · 구매 창 ─────────────────────────────────────────────────────────────

function drawBuy(productId: string, qty: number): void {
  const item = view?.shop.find((i) => i.id === productId);
  if (!item || !view) {
    close();
    return;
  }
  // 살 수 있는 개수는 포인트만큼이고, 도구는 가방에 더 담을 수 있는 만큼(최대 999)까지다 (2026-09-27 사용자 결정). 0P 상품은 하나씩 받는다
  const afford = item.price > 0 ? Math.floor(view.points / item.price) : 1;
  const cap = Math.max(1, Math.min(afford, item.room ?? afford));
  const many = MULTI_BUY.has(item.category) && !item.blocked;
  const count = many ? Math.max(1, Math.min(qty, cap)) : 1;
  const total = item.price * count;
  const short = total > view.points;

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
    box.append(minus, el("span", "count", count.toLocaleString("ko-KR")), plus, max, el("span", "qty-hint", `최대 ${cap.toLocaleString("ko-KR")}`));
    dialogEl.appendChild(box);
  }

  // 합계 상자 — 살 수 있으면 합계와 구매 후 보유, 막혔으면 까닭과 한 줄 안내 (시안 `Shop / Buy Blocked`)
  const summary = el("div", "buy-total");
  if (item.blocked) {
    const daycare = item.category === "egg" && view.eggs.used >= view.eggs.size;
    summary.appendChild(el("strong", undefined, daycare ? `${item.blocked}. (${view.eggs.used} / ${view.eggs.size})` : item.blocked));
    if (daycare) summary.appendChild(el("div", undefined, "부화한 뒤 다시 살 수 있어요"));
  } else if (short) {
    summary.append(el("strong", undefined, "포인트가 모자라요"), el("div", undefined, `합계 ${point(total)} · 보유 ${point(view.points)}`));
  } else {
    summary.append(el("strong", undefined, `합계 ${point(total)}`), el("div", undefined, `구매 후 보유 ${point(view.points - total)}`));
  }
  dialogEl.appendChild(summary);
  if (notice) dialogEl.appendChild(el("div", "notice bad", notice));

  // 바닥 — 왼쪽 `돌보미집 보기`(돌보미집이 찼을 때), 오른쪽 `취소`·`구매`
  const foot = el("div", "buy-foot");
  if (item.blocked && item.category === "egg") {
    foot.appendChild(
      actionButton("돌보미집 보기", false, false, () => {
        tab = "box";
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
    scroll.appendChild(settingRow("포켓몬 표시", undefined, switchButton(!d.hidden, "포켓몬 표시", () => setSetting("hidden", !d.hidden))));
    scroll.appendChild(settingRow("고스트 모드", "포켓몬 위도 뒤 창을 클릭", switchButton(d.clickThrough, "고스트 모드", () => setSetting("clickThrough", !d.clickThrough))));
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
  scroll.appendChild(settingRow("놀이공간", hint, segmented(area, s.playArea, (id) => setSetting("playArea", id))));
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
    scroll.appendChild(settingRow("화면", undefined, box));
  }
  // 영역 지정일 때만 그리기 단추를 둔다. 그린 뒤에는 `다시 그리기` (docs/specs/game.md 설정 계약)
  if (s.playArea === "region") {
    const draw = actionButton(s.hasRegion ? "다시 그리기" : "영역 그리기", !s.hasRegion, false, () => void regionDraw());
    scroll.appendChild(settingRow("영역", undefined, draw));
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
// Figma `99 · 시안` 업데이트 시안 `789:17471` — 바닥 왼쪽에 버전과 업데이트 상태, 그 옆에 `패치노트` (src/main/updater.ts)

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

async function updateSend(action: "check" | "install"): Promise<void> {
  const next = await window.pokebuddyManage.update(action);
  if (next) upd = next;
  if (dialog?.kind === "settings") drawDialog();
}

function versionFoot(): HTMLElement {
  const box = el("div", "version-foot");
  if (upd) {
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
  form: "dialog",
  notes: "dialog settings notes",
  "notes-new": "dialog settings notes-new",
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
// 버튼을 누르거나 5초 새로 그리기 때 대화상자를 통째로 다시 만들어 맨 위로 튀던 것을 막는다 (2026-09-27 사용자 "설정에서 스크롤 내리고, 버튼 누르면 스크롤이 올라가짐")
let dialogScrollKey = "";
const dialogKeyOf = (d: Dialog): string => `${d.kind}:${"tab" in d ? String(d.tab) : ""}`;

function drawDialog(): void {
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
  else if (dialog.kind === "nature") drawNature(dialog.petId, dialog.pick, dialog.itemId, dialog.listOpen === true);
  else if (dialog.kind === "nature-target") drawNatureTarget(dialog.itemId);
  else if (dialog.kind === "buy") drawBuy(dialog.productId, dialog.qty);
  else if (dialog.kind === "pick-box") drawPickBox(dialog.slotIndex);
  else if (dialog.kind === "pick-slot") drawPickSlot(dialog.petId);
  else if (dialog.kind === "achievements") drawAchievements();
  else if (dialog.kind === "settings") drawSettings(dialog.tab);
  else if (dialog.kind === "user") drawUser(dialog.tab);
  else if (dialog.kind === "hatched") drawHatched(dialog.petId, dialog.slotIndex, dialog.eggId);
  else if (dialog.kind === "form") drawForm(dialog.petId, dialog.to);
  else if (dialog.kind === "notes") drawNotes(dialog.pick);
  else if (dialog.kind === "notes-new") drawNotesNew(dialog.version);
  else drawGuide();

  if (notice) dialogEl.appendChild(el("div", "notice bad", notice));
  const scroll = dialogEl.querySelector<HTMLElement>(".scroll");
  if (scroll && keep) scroll.scrollTop = keep;
  restoreSearchFocus();
  syncIdentify();
}

// 다른 모달로 갈 때는 지난 실패 문구를 지운다. 구매 창의 부족 안내처럼 그 화면이 다시 만드는 것은 남는다
function open(next: Dialog): void {
  // 개체 상세는 모달이 아니라 페이지다 — 모달을 닫고 그 개체가 있는 탭에서 상세를 그린다
  if (next.kind === "pet") {
    dialog = null;
    notice = "";
    setScrim(false);
    detailPet = next.petId;
    tab = slotOfPet(next.petId) != null ? "party" : "box";
    draw();
    bodyEl.scrollTop = 0;
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

const openPet = (id: string): void => open({ kind: "pet", petId: id });

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
  "unknown-item": "모르는 도구예요.",
  "bad-nature": "쓸 수 없는 성격이에요.",
  "bad-value": "고를 수 없는 값이에요.",
  "daily-cap": "오늘은 더 쓸 수 없어요.",
  "not-achieved": "아직 달성하지 않았어요.",
  "already-claimed": "이미 받았어요.",
  "save-failed": "저장하지 못했어요. 잠시 뒤 다시 해 주세요.",
  "art-missing": "바뀔 모습의 그림을 받지 못했어요. 잠시 뒤 다시 해 주세요.",
  "not-writer": "다른 창이 저장을 맡고 있어요. 잠시 뒤 다시 해 주세요.",
  "box-full": "그 박스는 가득 찼어요.",
  "no-box": "그 박스를 찾지 못했어요.",
  timeout: "응답이 없어요. 처리됐는지 확인해 주세요. 다시 눌러도 두 번 반영되지 않아요.",
};

// 대상이 사라지거나 일이 끝나는 조작 — 결과를 보여 줄 곳이 없으므로 모달을 닫는다
const CLOSES = new Set(["party.keep", "party.place", "party.swap", "egg.open", "bag.use", "shop.buy"]);

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

// 성공하면 true. 여러 번 보내는 쪽이 중간에 멈출 수 있게 돌려준다
async function send(cmd: string, target: string, extra: Record<string, unknown> = {}, opts: { keepOpen?: boolean } = {}): Promise<boolean> {
  if (busy) return false;
  busy = true;
  let reply: ManageReply;
  try {
    const reqId = reqIdFor(cmd, target, extra);
    reply = await window.pokebuddyManage.command({ cmd, target, args: { ...extra, reqId } });
    rememberReply(cmd, target, extra, reqId, reply);
    if (reply.ok && TOUCHES_DEX.has(cmd)) dexRows = null;
    await refresh();
  } finally {
    busy = false;
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
  if (dexPick) window.pokebuddyManage.dexOpen(dexPick); // 부화·해금으로 바뀐 항목을 기기 창에 다시 보낸다
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
  draw();
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
    tab = "box";
    draw();
    bodyEl.querySelector(".daycare")?.scrollIntoView({ block: "start" });
  } else if (route.to === "pet") {
    if (petOf(route.petId)) openPet(route.petId);
  } else if (route.to === "account") {
    detailPet = null;
    open({ kind: "user", tab: "account" });
    void loadAccount();
  } else if (route.to === "trade") {
    close();
    tab = "trade";
    detailPet = null;
    void loadTrade();
    draw();
  } else if (route.to === "agents") {
    // Codex 창 깜빡임 알림 — 사용자 모달의 연결 탭 (src/agents/notice.ts)
    detailPet = null;
    open({ kind: "user", tab: "agents" });
    void loadAgents();
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
window.pokebuddyManage.onDexStep((delta) => stepDex(delta));
window.pokebuddyManage.onDexClosed(() => {
  dexPick = null;
  markDexPick();
});
window.pokebuddyManage.onRoute((route) => void firstDraw.then(() => refresh()).then(() => goTo(route)));
// 시간이 흐르면 만복도·쿨타임·알 준비가 바뀐다. 창이 떠 있는 동안 주기적으로 다시 읽는다
// 박스 칸을 끄는 중이거나 박스 이름을 입력하는 중에는 쉰다 — 다시 그리면 끌기와 입력이 끊긴다
setInterval(() => {
  if (dragFrom || boxRenaming) return;
  void refresh().then(drawDialog);
}, 5000);
