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
import type { BridgeOf, Invoke, Push, PushOf, Send } from "./kinds.js";

// 화면이 보내는 요청 — 이름과 인자는 src/tx/args.ts argsFromCommand 가 푼다.
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

// 설정창의 계약 — 메인이 두 곳에서 걸기 때문에 둘로 적는다

// 스냅샷·명령과 스냅샷에 담지 않는 것들.
// 도감은 종이 1000개를 넘어 스냅샷에 담지 않는다. 탭을 열 때만 따로 부른다. CLI 연결은 저장 밖을 보므로 역시 따로 부른다
export type ManageCoreIpc = {
  "manage:snapshot": Invoke<"snapshot", [], Snapshot | null>; // 저장이 없으면 null
  "manage:command": Invoke<"command", [req: ManageRequest], ManageReply>;
  "manage:dex": Invoke<"dex", [], DexEntry[]>;
  "manage:dex-detail": Invoke<"dexDetail", [slug: string], DexDetail | null>; // 도감 칸 하나의 상세
  "manage:shop-detail": Invoke<"shopDetail", [productId: string], ShopDetail | null>; // 상점 구매 창의 상세 — 포켓몬 진화 트리, 진화용 도구의 대상
  "manage:agents": Invoke<"agents", [req?: { name: string; action: AgentAction }], AgentReply>; // 인자가 없으면 읽기만 한다
  "manage:route": Push<"onRoute", [route: ManageRoute]>; // 알림 배너의 `바로가기` 가 설정창을 어디로 옮길지 알린다
  "manage:pet-menu": Invoke<"petMenu", [petId: string], boolean>; // 파티 카드·박스 칸을 눌렀다 — 메인이 커서 자리에 포켓몬 메뉴를 띄운다. 띄울 길이 없으면 false
  "manage:draw-region": Invoke<"drawRegion", [], ManageReply>; // 설정의 `영역 그리기` — 영역 그리기 창을 열고 끝나면 답한다. 적용하면 ok, 취소하면 reason "cancelled"
  "manage:screens": Invoke<"screens", [], ScreenView[]>; // 지금 화면 목록 — 번호 순. 화면을 모르면(개발 실행기 등) 빈 목록
  "manage:identify-screens": Send<"identifyScreens", [on: boolean]>; // 모든 화면에 번호 덮개를 띄운다·치운다 — 한 화면 목록이 열린 동안
  "manage:pick-screen": Invoke<"pickScreen", [], ManageReply>; // 화면 위에서 눌러 고른다. 고르면 저장하고 ok, 취소하면 reason "cancelled"
  "manage:dim": Send<"dim", [on: boolean]>; // 모달 가림막이 켜졌다·꺼졌다. OS 가 그리는 창 단추 자리도 같은 색으로 어둡게 한다
  "manage:portraits": Invoke<"portraits", [asks: PortraitAsk[]], Record<string, string | null>>; // 초상 — 열쇠(slug 또는 slug:shiny)별 data URI. 못 받으면 null
  "manage:icons": Invoke<"icons", [keys: string[]], Record<string, string | null>>; // 도구·알 그림 — 열쇠는 "egg" 또는 "item:<식별자>"
  "manage:art": Invoke<"art", [], Record<string, string>>; // 디스크에 이미 있는 초상·도구·알 그림 전부 — 창을 열 때 한 번 받아 첫 화면부터 그림을 채운다
  "manage:trade": Push<"onTrade", [screen: TradeScreen]>; // 교환 보기가 바뀌었다(실시간 신호·주기 새로 고침·조작 결과)
  "manage:copy": Send<"copyText", [text: string]>; // 교환 링크 복사 — 메인의 clipboard 로 쓴다
  "manage:account": Invoke<"account", [req: AccountAction], AccountReply>;
  "manage:account-view": Push<"onAccount", [screen: AccountScreen]>; // 계정·저장 상태가 바뀌었다
  "manage:mail": Invoke<"mail", [req: MailAction], MailReply | null>; // 우편함 — 서버 설정이 없으면 null
  "manage:mail-view": Push<"onMail", [screen: MailScreen]>; // 목록·받기 상태가 바뀌었다
  "manage:update": Invoke<"update", [action: UpdateAction], UpdateView | null>; // 업데이트가 연결되지 않았으면 null
  "manage:update-view": Push<"onUpdate", [view: UpdateView]>; // 버전·업데이트 상태가 바뀌었다
  "manage:notes": Invoke<"notes", [action: "list" | "seen"], PatchNotesView | null>; // seen 은 안 본 노트를 띄웠다고 알린다
  "manage:clock": Push<"onClock", [tick: { now: number }]>; // 앱 전역 1초 시계 — 받을 때마다 스냅샷을 다시 읽는다 (2026-09-29 사용자 결정 "전역 타이머 1초")
};

// 기기 창 다섯과 설정창 사이 — 열기는 렌더러 → 메인, 이전·다음·누른 단추·닫힘은 메인 → 렌더러.
//   open    기기 창에 이것을 띄운다. null 이면 닫는다. gen 은 마지막으로 받은 닫힘 세대 번호 — 낡으면 메인이 버린다
//   step    기기 창의 이전·다음. 순서는 설정창의 지금 목록(검색·칩 적용)이 정한다
//   act     기기 창에서 누른 단추 — 설정창이 처리한다
//   closed  기기 창이 닫혔다 — 새 세대 번호 (src/main/device-gen.ts). 고른 칸 표시를 지운다
export type ManageDeviceLinkIpc = {
  "manage:dex-open": Send<"dexOpen", [slug: string | null, gen?: number, beside?: boolean]>; // beside 면 파티 상세 기기 창 옆에 붙인다
  "manage:dex-step": Push<"onDexStep", [delta: -1 | 1]>;
  "manage:dex-closed": Push<"onDexClosed", [gen: number]>;
  "manage:pet-open": Send<"petOpen", [open: PetDeviceOpen | null, gen?: number]>;
  "manage:pet-step": Push<"onPetStep", [delta: -1 | 1]>;
  "manage:pet-act": Push<"onPetAct", [action: PetDeviceAction]>;
  "manage:pet-closed": Push<"onPetClosed", [gen: number]>;
  "manage:shop-open": Send<"shopOpen", [open: ShopDeviceOpen | null, gen?: number]>;
  "manage:shop-step": Push<"onShopStep", [delta: -1 | 1]>;
  "manage:shop-act": Push<"onShopAct", [action: ShopDeviceAction]>;
  "manage:shop-closed": Push<"onShopClosed", [gen: number]>;
  "manage:bag-open": Send<"bagOpen", [open: BagDeviceOpen | null, gen?: number]>;
  "manage:bag-step": Push<"onBagStep", [delta: -1 | 1]>;
  "manage:bag-act": Push<"onBagAct", [action: BagDeviceAction]>;
  "manage:bag-closed": Push<"onBagClosed", [gen: number]>;
  "manage:party-open": Send<"partyOpen", [open: PartyDeviceOpen | null, gen?: number]>; // 파티 기기 창(교체 화면)
  "manage:party-act": Push<"onPartyAct", [action: PartyDeviceAction]>; // 누른 칸·칩
  "manage:party-step": Push<"onPartyStep", [delta: -1 | 1]>; // 방향키 — 앞·뒤 프리셋
  "manage:party-closed": Push<"onPartyClosed", [gen: number]>;
};

export type ManageIpc = ManageCoreIpc & ManageDeviceLinkIpc;
export type ManageChannel = keyof ManageIpc;
export type ManageBridge = BridgeOf<ManageIpc>;
export type ManagePush = PushOf<ManageIpc>; // 메인이 설정창에 보내는 채널과 그 인자
