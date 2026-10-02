// 설정창 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다 (런타임 값 없음)

import type { CommandResult } from "../command.js";
import type { AccountAction, AccountReply, AccountScreen, PatchNotesView, UpdateAction, UpdateView } from "../model/account.js";
import type { AgentAction, AgentReply } from "../model/agents.js";
import type { DexDetail, DexEntry, ShopDetail } from "../model/detail.js";
import type { BagDeviceAction, BagDeviceOpen, PartyDeviceAction, PartyDeviceOpen, PetDeviceAction, PetDeviceOpen, ShopDeviceAction, ShopDeviceOpen } from "../model/devices.js";
import type { MailAction, MailReply, MailScreen } from "../model/mail.js";
import type { ScreenView } from "../model/overlays.js";
import type { ManageRoute } from "../model/route.js";
import type { PortraitAsk, Snapshot } from "../model/snapshot.js";
import type { TradeScreen } from "../model/trade.js";

// 화면이 보내는 요청 — 이름과 인자는 src/tx/bridge.ts 가 푼다.
// 조작 하나마다 `args.reqId` 를 새로 붙인다. 없으면 같은 순간의 두 조작이 하나로 합쳐진다
export interface ManageRequest {
  cmd: string;
  target?: string;
  args?: Record<string, unknown>;
}

// 결과는 문구가 아니라 코드 — 문구는 화면이 만든다. 코드의 목록은 ../names/reasons.ts 와 ../names/online-codes.ts
export type ManageReply = CommandResult & {
  screen?: TradeScreen; // trade.* 명령의 결과 — 교환 모달이 그리는 값
};

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
