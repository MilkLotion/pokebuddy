// 화면 모델 — 기기 창 다섯(도감·파티 상세·상점·가방·파티 교체)이 받는 값과 돌려보내는 단추. 타입만 둔다

import type { DexDetail, EvoNodeView } from "./detail.js";
import type { PetView } from "./snapshot.js";
import type { SlotState } from "../save-v3.js";

// ── 도감 기기 창 ────────────────────────────────────────────────────────────────
// 관리 창 옆에 붙어 한 종의 도감 항목을 보이는 창 — Figma `99 · 시안` `579:17691` (worklog/records/play-bugs/play-bugs.md)
export interface DexDeviceView {
  detail: DexDetail;
  portrait: string | null; // data URI. 미해금이면 화면이 검은 실루엣으로 칠한다
  side: "right" | "left"; // 관리 창의 어느 쪽에 붙었나 — 경첩 면을 관리 창 쪽에 그린다
  volume: number; // 울음소리 음량 0~1 — 0 이면 울음소리 단추를 막는다
  // 진화 트리 — 상점 구매 창과 같은 사슬이다(src/tx/shop-detail.ts). 미해금 종도 보낸다 — 트리 안의 미해금 종은 기기 창이 ??? 와 검은 실루엣으로 그린다. 사슬이 없으면 null
  tree: EvoNodeView | null;
  treePortraits: Record<string, string>; // 트리의 종 그림 — slug → data URI. 미해금 종의 그림도 든다(실루엣으로 그린다)
  beside: boolean; // 파티 상세 기기 창 옆에 붙었다 — 바닥 단추 줄(이전·울음소리·다음)을 두지 않는다
}

// 파티 상세 기기 창 — 관리 창이 정해 보내는 것(PetDeviceOpen)에 메인이 그림·붙은 쪽·음량을 더한다 (src/main/windows/devices.ts petDeviceOf)
export interface PetDeviceOpen {
  pet: PetView;
  where: string; // "파티 1번 · 나와 있음" · "박스 1 · 보관 중"
  inParty: boolean;
  slotIndex: number | null; // 파티 칸 — 교체 대화상자가 쓴다
  sizeLevels: number;
  notice: string; // 마지막 실패 문구
  tutorial: boolean; // 개체 상세 튜토리얼을 보일 차례 — 파티 개체이고 아직 끝내거나 건너뛰지 않았다
  dexOpen: boolean; // 옆에 이 종의 도감 기기 창이 떠 있다 — `도감 보기` 줄을 톤 배경으로
  careLine: { title: string; desc: string }; // `포인트 적립` 줄 — 제목(합)과 설명(버프·손해 내역)
  bars: { affinity: string; fullness: string; boredom: string }; // 막대 오른쪽 글자 — "80" · "55 · 보통" · "20 · 보통". 시간으로만 바뀌어 1초 시계가 글자만 고친다
  busy: string | null; // 처리 중인 단추의 열쇠(src/shared/device-busy.ts petBusyKey) — 그 단추만 점 세 개
}

export interface PetDeviceView extends PetDeviceOpen {
  portrait: string | null; // data URI
  megaIcon: string | null; // 메가스톤 표식 그림(키스톤) data URI — 메가스톤을 지녔거나 메가진화하는 종의 개체일 때만 받는다
  side: "right" | "left";
  volume: number; // 울음소리 음량 0~1 — 0 이면 울음소리 단추를 막는다
}

// 기기 창에서 누른 단추. 명령은 관리 창의 명령 경로로, 대화상자는 관리 창에서 연다
// petId 는 기기 창에 떠 있던 개체 — 관리 창의 지금 개체와 다르면 버린다(빠르게 넘길 때 다른 개체에 쓰이지 않게)
export type PetDeviceAction = { petId: string } & (
  | { kind: "cmd"; cmd: "feed" | "play" | "party.show" | "party.hide" | "pet.set"; args?: Record<string, unknown> }
  | { kind: "dialog"; dialog: "evolve" | "nature" | "mega" } // mega — 초상의 메가스톤 표식을 눌렀다 (src/dex/mega.ts)
  | { kind: "tutorial"; action: "done" | "skip" } // 개체 상세 튜토리얼을 끝냈다·닫았다
  | { kind: "dex" } // 도감 보기 — 기기 창을 닫고 그 종의 도감 기기 창을 연다 (2026-09-30)
);

// 상점 기기 창 — 관리 창이 정해 보내는 것(ShopDeviceOpen)에 메인이 붙은 쪽을 더한다 (src/main/windows/devices.ts shopDeviceOf, Figma 05 `Shop / Device / Tool`)
// 구매도 이 창에서 한다(2026-10-01 사용자 결정 A안). 수량·구매 단추는 관리 창으로 돌아가 관리 창이 명령을 보낸다
// 상점·가방 기기 창이 같이 그리는 화면 필드 — 머리 줄, 그림, 기록 칸
export interface ItemFace {
  kind: string; // 머리 줄 첫 글자 — 도구 · 알 · 진화 · 파티 칸 · 포켓몬
  name: string;
  state: string; // 머리 줄 오른쪽 — 상점 "살 수 있음" · 살 수 없는 짧은 이유(돌보미집 가득 등), 가방 "보유 ×3"
  group: string;
  art: string | null; // 그림 data URI. 없으면 빈 칸
  spec: [string, string][]; // 상점 가격·보유 두 줄, 가방 판매가·구매가
  desc: string;
  rows: [string, string][]; // 효과·쓰는 곳
}

export interface ShopDeviceOpen extends ItemFace {
  productId: string;
  link: { label: string; value: string } | null; // 정보 줄 아래의 누르는 줄 — 알의 `나오는 포켓몬`. 없으면 null
  qty: { count: number; cap: number; hint: string } | null; // 여러 개 살 수 있는 상품만. 살 수 없으면 cap 0 — 줄은 그대로 두고 단추만 막는다
  total: { lead: string; line: string; tone: "" | "ok" | "bad" | "warn" }; // 합계 상자 — 산 직후는 초록 결과, 실패는 빨강
  buy: { label: string; disabled: boolean; busy: boolean };
}

export interface ShopDeviceView extends ShopDeviceOpen {
  side: "right" | "left";
}

// 기기 창에서 누른 단추 — productId 가 관리 창의 지금 상품과 다르면 버린다
export type ShopDeviceAction = { productId: string } & ({ kind: "qty"; qty: number } | { kind: "buy" } | { kind: "pool" });

// 가방 기기 창 — 상점 기기 창과 같은 틀 (src/main/windows/devices.ts bagDeviceOf, Figma 05 `Bag / Device / Use`, 2026-10-01 사용자 결정 C안).
// 도구는 파티 개체에게만 쓴다. 진화용 도구는 가방에서 쓰지 않는다(판매만). 단추는 관리 창으로 돌아가 관리 창이 명령을 보낸다
export interface BagDeviceOpen extends ItemFace {
  itemId: string;
  title: string; // 조작 칸 머리 — 사용 쪽은 지금 프리셋 이름, 판매 쪽은 "판매하기"
  pager: boolean; // 사용 쪽 파티 줄 양끝에 ◀ ▶ 를 둔다 — 프리셋이 둘 이상일 때. 누르면 앞·뒤 프리셋을 적용한다 (2026-10-02 사용자 결정)
  mode: "use" | "sell";
  modes: boolean; // 사용·판매 전환을 둔다 — 사용도 판매도 되는 도구만
  party: { petId: string; name: string; level: string; art: string | null; picked: boolean; dim?: boolean }[] | null; // 사용 쪽 파티 줄. 유대의고삐는 부를 말 — petId 가 말 종, level 이 말 이름, dim 은 이미 가진 말(못 고른다)
  riders?: true; // 파티 줄 자리가 유대의고삐의 부를 말이다 — 칸 아래 글자가 레벨 대신 이름이라 칸 폭을 이름에 맞춘다
  qty: { count: number; cap: number; hint: string } | null;
  preview: { lead: string; line: string; tone: "" | "ok" | "bad" | "warn" }; // warn — 쓰면 손해가 있다(남은 버프 시간이 사라짐)
  go: { label: string; disabled: boolean; busy: boolean }; // 바닥 가운데 주 단추 — `N개 사용` · `NP에 팔기`
}

export interface BagDeviceView extends BagDeviceOpen {
  side: "right" | "left";
}

export type BagDeviceAction = { itemId: string } & ({ kind: "mode"; mode: "use" | "sell" } | { kind: "target"; petId: string } | { kind: "qty"; qty: number } | { kind: "go" } | { kind: "preset"; delta: -1 | 1 });

// 파티 기기 창 — 교체 화면. 박스 탭 옆에 붙어 지금 프리셋의 파티 칸과 프리셋 칩을 보인다
// (src/main/windows/devices.ts partyDeviceOf, Figma 05 `Party / Swap · Open` `1248:2567`, 2026-10-02 사용자 결정).
// 칸과 칩을 누르면 관리 창으로 돌아가 관리 창이 명령을 보낸다. 눌러서 들고 눌러서 놓는다 — 포켓몬 메뉴의 `옮기기` 와 같다
export interface PartyDeviceSlot {
  index: number;
  state: SlotState;
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
  busy: string | null; // 처리 중인 칸·칩의 열쇠(src/shared/device-busy.ts partyBusyKey) — 그것만 점 세 개
}

export interface PartyDeviceView extends PartyDeviceOpen {
  side: "right" | "left";
}

export type PartyDeviceAction = { kind: "slot"; index: number } | { kind: "preset"; index: number };

// 성공한 명령의 결과 두 줄 — 기기 창의 초록 상자 (src/view/result-lines.ts)
export interface ResultLine {
  lead: string;
  line: string;
}

// ── 기기 창 입력 — 설정창이 고른 값 ─────────────────────────────────────────────
// 설정창은 이것만 보내고, 메인이 모델을 만든다 (src/view/device-*.ts). 메인은 바로잡은 입력(수량을 상한으로 자르기, 없는 대상 바꾸기)을 돌려준다

export interface BagDeviceInput {
  itemId: string;
  mode: "use" | "sell";
  targetPetId: string | null; // 사용 쪽 대상 개체. 파티에 없으면 첫 개체로 바꾼다
  qty: number; // 사용 수량(사탕만)
  sellQty: number;
  notice: string; // 마지막 사용·판매 실패 — 미리보기 상자가 빨강
  result: ResultLine | null; // 방금 쓴 결과 — 미리보기 상자가 초록
  busy: boolean; // 0.3초 넘게 답이 없다 — 주 단추가 점 세 개
}

export interface ShopDeviceInput {
  productId: string;
  qty: number;
  notice: string; // 마지막 구매 실패 — 합계 상자가 빨강
  done: ResultLine | null; // 방금 산 결과 — 합계 상자가 초록
  busy: boolean; // 0.3초 넘게 답이 없다 — 구매 단추가 점 세 개
}

export interface PartyDeviceInput {
  heldPetId: string | null; // 파티 기기 창에서 든 파티 개체. 파티에서 빠졌으면 놓는다
  heldFromBox: boolean; // 박스 개체를 들었다 — 빈 칸이 놓을 칸이 된다
  notice: string; // 마지막 교체 실패 — 머리 줄의 이름 옆 자리
  busy: string | null; // 0.3초 넘게 답이 없는 칸·칩의 열쇠. 없으면 null
}

export interface PetDeviceInput {
  petId: string;
  notice: string; // 마지막 실패 문구
  dexOpen: boolean; // 옆에 이 종의 도감 기기 창이 떠 있다
  busy: string | null; // 0.3초 넘게 답이 없는 단추의 열쇠. 없으면 null
}
