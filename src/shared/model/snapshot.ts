// 화면 모델 — 설정창의 스냅샷과 스냅샷이 가리키는 값. 타입만 둔다 (런타임 값 없음)
// 화면이 읽는 값은 src/tx/snapshot.ts 가 만든다. 그 파일이 여기 타입을 가져다 쓴다 — 모양의 출처는 한 곳이다.

import type { FullnessZone, SlotState } from "../save-v3.js";



export interface ViewBuff {
  kind: string;
  name: string; // 화면 이름 — 든든함 · 신남
  remainMin: number; // 남은 분(반올림). 시간으로만 바뀌는 값이라 1초 시계가 표시만 고친다
  text: string; // 배지 글자 — "신남 12분" · "든든함 2시간" (src/shared/count-text.ts buffText)
}

// 진화 후보 하나 — 화면이 그대로 보인다. 낮·밤은 스냅샷을 만든 시각으로 정했다
export interface EvolutionView {
  to: string; // 결과 종 슬러그 — evolve 명령의 args.to 로 보낸다
  name: string; // 결과 종의 화면 이름. 도감에서 해금 안 된 종이면 "???"
  known: boolean; // 도감에서 해금(또는 획득)한 종 — 아니면 이름·그림을 가린다 (2026-10-01 사용자 결정)
  ready: boolean;
  need?: string; // 모자란 조건의 화면 문구 — "Lv.16 필요", "물의돌 필요", "밤에만"
  genderBlocked?: true; // 성별이 맞지 않아 이 개체는 갈 수 없는 후보 — 진화 창은 흐리게 "암컷만", 파티 상세 진화 줄은 세지 않는다 (2026-10-07)
  item?: string; // 진화용 도구가 조건이면 그 도구 id. 가방의 돌로 대상을 고를 때 쓴다
  map?: true; // 지도 간선(기본형 → 리전폼) — 지도도 쓴다. 가방의 지도로 대상을 고를 때 쓴다
  uses: string[]; // 진화에 쓰는 도구의 화면 이름 — 돌·지도. 진화 창 안내와 진화 확인 창의 화살표가 읽는다
  types: string[]; // 결과 종의 화면 타입 이름 — 해금 안 된 종이면 비어 있다(이름처럼 가린다)
  typeIds: string[];
}

export interface PetView {
  id: string;
  species: string;
  name: string; // 화면에 보이는 종 이름
  nameParts: { name: string; form?: string }; // name 을 이름과 모습으로 나눈 것 — 파티 상세 기기 창의 두 줄 (src/view/text.ts petNameParts)
  shiny: boolean;
  level: number;
  percentToNext: number; // 다음 레벨까지 백분율
  exp: number; // 누적 경험치 — 가방 사용 패널이 사탕 미리보기와 최대 개수를 셈한다
  growth: string; // 경험치 타입 (src/dex/growth.ts) — 가방 기기 창의 사탕 미리보기가 곡선을 찾는다 (src/view/device-bag.ts)
  types: string[]; // 화면에 보이는 타입 이름
  typeIds: string[]; // types 와 같은 순서의 타입 키 (grass 등) — 타입 배지 색을 고른다
  nature: string; // 화면에 보이는 성격 이름
  gender: "male" | "female" | "none"; // 성별 — 무성은 아이콘을 두지 않는다 (src/dex/gender.ts)
  size: number; // 그림 크기 단계 번호 1~sizeLevels
  natureId: string; // 성격 id — 성격 변경 창이 지금 성격을 막을 때 쓴다
  affinity: number;
  fullness: number;
  zone: FullnessZone;
  zoneText: string; // 만복도 구간 낱말 — "배부름" · "보통" · "배고픔" · "매우 배고픔"
  debuffs: { label: string; tone: "warning" | "danger"; note: string }[]; // 디버프 배지 — 배고픔(배고픔·매우 배고픔), 그다음 심심함(심심해·지루해). 없으면 빈 목록 (2026-10-05 사용자 결정 "그 2개도")
  boredom: number; // 심심함 0~100. 높을수록 심심하다 (2026-10-05 — 기분을 대신한다)
  boredWord: string; // 심심함 단계 말 — "보통" · "심심해" · "지루해" 를 화면에 그대로 쓴다
  hidden: boolean;
  feedBlock: "full" | "cooldown" | null; // 밥 주기를 막는 까닭 — 없으면 null. 판정은 src/state/care-block.ts feedBlock 하나
  feedInSec: number;
  playBlock: "cooldown" | null; // 놀아주기를 막는 까닭 (src/state/care-block.ts playBlock)
  feedText: string; // 밥 주기 단추 글자 — "밥 주기" · "밥 주기 · 3분" · "밥 주기 · 배부름". 박스 개체는 화면이 "밥 주기" 로 둔다
  playText: string; // 놀아주기 단추 글자 — "놀아주기" · "놀아주기 · 3분" (밥 주기와 같은 꼴, 94 항목 5-1)
  longPlay: boolean; // 신남(장난감)이 켜져 있다 — 그동안 심심함이 쌓이지 않는다
  buffs: ViewBuff[]; // 켜진 버프만 — buffNames 와 같은 순서
  buffNames: string[]; // 켜진 버프의 화면 이름 — 든든함 · 신남 순서
  evolutions: EvolutionView[]; // 다음 한 단계의 후보. 최종 단계면 비어 있다
  forms?: FormView[]; // 공유 sid 계열의 고를 수 있는 종 — 그 밖의 개체에는 없다 (src/dex/forms.ts)
  shiftForms?: FormView[]; // 모습 바꾸기 종(로토무)의 고를 수 있는 모습 — 해금 뒤에만. 박스 칸은 지금 종 그대로라 forms 와 나눈다
  formItem?: { name: string; base: string; oneWay?: true }; // 모습 바꾸기에 쓰는 도구의 이름과 도구 없이 돌아가는 기본 종(로토무 — 로토무카탈로그). 확인 창 안내 줄이 쓴다. oneWay 는 돌아가지 않는 모습(플라엣테(영원의 꽃))
  look: string; // 초상에 쓰는 종 — 메가 모습이면 그 슬러그, 아니면 species 와 같다. name·types 도 이 모습을 따른다
  mega?: MegaView; // 메가스톤을 지닌 개체만 (src/dex/mega.ts)
  megaGoal?: MegaGoalView; // 메가진화하는 종인데 메가스톤이 아직 없는 개체만
  care: CareView; // 포인트 적립 배율의 내역 — 버프(+)와 배고픔·심심함(−). 친밀도와 상관없다 (2026-10-05)
}

// 포인트 적립 배율의 내역 — 파티 상세 기기 창의 `포인트 적립` 줄이 쓴다 (src/state/time.ts pointParts, docs/specs/balance.md "포인트 적립 배율")
// 필드 이름을 percent 로 두지 않는다 — 기기 창이 percent 를 시간으로만 바뀌는 값으로 보고 다시 그리지 않는다 (src/shared/live-keys.ts LIVE_KEYS)
export interface CareView {
  bonus: number; // 합(백분율) — 버프는 +, 손해는 −. 바닥(−90)에서 멈춘다. 0 이면 기본 속도다
  parts: { kind: string; name: string; bonus: number }[]; // 내역 — kind 는 버프 종류·만복도 구간(hungry·starving)·심심함 단계(bored·tired). name 은 화면 이름
}

// 메가진화 — 파티 상세 기기 창의 메가스톤 표식과 확인·고르기 창이 쓴다
export interface MegaView {
  kind: "mega" | "primal"; // 원시회귀는 문구만 다르다
  on: string | null; // 지금 메가 모습의 슬러그. 기본 모습이면 null
  baseName: string; // 기본 모습의 이름 — 메가 모습일 때 "리자몽으로 돌아가요" 에 쓴다
  baseTypes: string[];
  baseTypeIds: string[];
  forms: FormView[]; // 고를 수 있는 메가 모습 — 리자몽·뮤츠는 둘
  canChange: boolean; // 프리셋 칸에 든 개체만 메가진화한다. 박스 개체는 false
  rivals: string[]; // 같은 프리셋에서 지금 메가 모습인 다른 개체의 이름 — 이 개체가 메가진화하면 원래 모습으로 돌아간다
}

// 메가스톤 조건과 진행 — 파티 상세 기기 창의 흐린 메가스톤 표식과 조건 말풍선이 쓴다 (docs/specs/game.md "조건 말풍선")
// 값은 [지금, 기준]. 시간과 횟수는 친밀도 100 뒤부터 센다. 시간은 시간 단위로 내림한다
export interface MegaGoalView {
  kind: "mega" | "primal" | "rayquaza"; // 말풍선 머리 — 메가스톤 조건 · 원시회귀 조건 · 메가진화 조건
  affinity: [number, number];
  level: [number, number];
  hours: [number, number];
  care: [number, number];
}

// 공유 sid 계열의 모습 하나 — 박스 칸의 단체사진·툴팁과 바꾸기 확인 창이 쓴다
export interface FormView extends SpeciesLine {
  species: string;
}

// 종 한 줄 — 화면 이름과 타입. 모습(FormView)과 교환 카드(TradeCardView)가 같이 쓴다
export interface SpeciesLine {
  name: string; // 화면에 보이는 종 이름
  types: string[]; // 화면에 보이는 타입 이름
  typeIds: string[]; // types 와 같은 순서의 타입 키 (grass 등)
}

export interface SlotView {
  index: number;
  state: SlotState;
  pet?: PetView;
}

// 프리셋 한 개 — 프리셋 전체보기 모달이 쓴다. 칸은 파티 순서다 (src/party/presets.ts allPresets)
export interface PresetView {
  index: number;
  name: string;
  slots: SlotView[];
}

// 기술 한 개 — 모험 칸 카드의 작은 기술 칸과 배틀 파티 상세 기기 창이 쓴다 (src/view/battle.ts)
export interface MoveView {
  id: string;
  name: string;
  typeId: string; // 타입 키 (electric 등) — 타입 조각 색과 타입 아이콘을 고른다
  typeName: string;
  meta: string; // 분류·위력·명중·쿨타임 한 줄 — "물리 · 위력 120 · 명중 100 · 쿨타임 8초"
  text: string | null; // 원작 설명 — 없는 기술은 null (말풍선에 이름만)
}

// 배틀 파티 한 칸 (docs/specs/adventure.md "배틀 파티", "출전 불가")
export interface BattleSlotView {
  index: number;
  pet?: PetView; // 빈 칸이면 없다
  moves: MoveView[]; // 개체의 기술 순서대로 (PetV3.moves·moveSwap)
  options?: MoveView[]; // 고를 수 있는 기술 — 기본 2개 뒤에 후보 4개. 진화 전 종은 기본 2개뿐 (기술 바꾸기 모달). 빈 칸이면 없다
  blocked: string | null; // 출전 불가 글자 — "출전 불가 · 초전설 1마리까지". 없으면 null
  stats: { label: string; value: number }[]; // 실제 능력치 6개 — HP·공격·방어·스피드·특수방어·특수공격 (방사형 그래프의 꼭짓점 순서). 종족값이 없으면 빈 목록
  ability: string | null; // 특성 이름 — 표에 없으면 null
}

export interface BattleView {
  slots: BattleSlotView[]; // 6칸
  canStart: boolean; // 배틀을 시작할 수 있다 — 지금은 배틀이 없어 화면이 늘 막는다
}

export interface EggView {
  id: string;
  kind: string;
  icon: string; // 그림 열쇠 egg:<종류>(태고의돌은 item:ancient-stone)
  name: string;
  ready: boolean;
  remainSec: number;
  percent: number;
  noteText: string; // 알 칸 아래 글자 — "준비 완료" · "40% · 3분"
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
  icon: string; // 그림 열쇠 item:<id>
  name: string;
  count: number;
  evolution: boolean; // 진화용 도구 — 누르면 진화할 개체를 고른다
  effect?: string; // 효과 종류 (src/bag/use.ts ItemEffect) — 가방 분류 칩과 사용 패널의 미리보기가 쓴다. 진화용 도구는 없다
  amount?: number; // 효과의 양 — 경험사탕은 경험치, 기본먹이는 만복도
  sellPrice?: number; // 하나의 판매가 (src/shop/sell.ts sellPrice). 없으면 팔 수 없다 — 가격이 없거나 0P 인 도구
  buyPrice?: number; // 판매가의 바탕인 구매가 — 판매 안내 "구매가 Y P의 60%" 가 쓴다. sellPrice 가 있을 때만
  sellRate?: number; // 판매 비율 (SHOP_RULES.sellRate) — 판매 안내의 백분율. sellPrice 가 있을 때만
  about?: ItemAbout; // 가방 기기 창의 설명 (src/tx/lists.ts itemAbout)
  riders?: RiderCallView; // 유대의고삐(효과 call-rider)만 — 부를 말과 쓸 수 있는지 (src/party/riders.ts riderCall)
}

// 유대의고삐로 부를 말 — 가방 기기 창의 "부를 말" 줄 (docs/specs/game.md "버드렉스의 말 부르기")
export interface RiderCallView {
  horses: { to: string; name: string; owned: boolean }[]; // 이미 가진 말은 owned — 흐리고 못 고른다
  block: "not-rider-owner" | "already" | "box-full" | null; // 쓸 수 없는 까닭 — 버드렉스 없음 · 부를 말 없음 · 박스 빈칸 없음
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
  icon: string | null; // 그림 열쇠 — 알 egg:<종류>(태고의돌은 item:ancient-stone), 도구 item:<id>, 포켓몬 portrait:<slug>, 파티 칸은 null (src/view/device-art.ts)
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
  pool?: EggPoolView; // 알 — 종 목록이 정해진 알(단일 포켓몬 알·태고의돌)만. 랜덤알에는 없다
}

// 알에서 나오는 포켓몬 — 상점 기기 창의 `나오는 포켓몬` 줄과 목록 창이 쓴다 (2026-10-03 사용자 결정, worklog/records/egg-pool/egg-pool.md)
// 종은 도감 번호 순이다. 얻지 않은 종은 화면이 실루엣과 `???` 로 보인다 — 도감의 미해금 칸과 같다
export interface EggPoolView {
  single: boolean; // 단일 포켓몬 알 — 얻은 종은 다시 나오지 않는다. 태고의돌은 false 다
  entries: { slug: string; dex: number; form?: number; name: string; obtained: boolean }[];
}

// 상점 기기 창이 보일 상품 설명 (src/tx/lists.ts, Figma 05 `Shop / Device / …`). 문구는 화면이 그대로 쓴다
export interface ShopAbout extends ItemAbout {
  spec: [string, string]; // 가격 아래 둘째 줄 — ["보유", "3개"] · ["준비", "5분"]
}

// 달성 전 · 달성했고 보상이 남음 · 보상까지 받음
export type AchievementState = "locked" | "achieved" | "claimed";

// 업적창의 분류 칩 (data/achievements.json 의 group) — dex 도감 · grow 육성 · egg 알 · find 탐색 · together 함께
export type AchievementGroup = "dex" | "grow" | "egg" | "find" | "together";

export interface AchievementView {
  id: string;
  name: string;
  desc: string; // 빈 문자열이면 설명 줄을 그리지 않는다
  reward: string; // 보상 설명. 화면이 그대로 보여 준다
  state: AchievementState;
  group: AchievementGroup;
  progress?: { now: number; goal: number; unit: string }; // 미달성인 셀 수 있는 업적의 진행도 — `131 / 150`, `64 / 100시간`. 없으면 진행도 줄을 그리지 않는다
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
  sleepChoices: { value: number; label: string }[]; // 잠들기 기준 선택지 — 0 은 잠들지 않음 (src/state/settings.ts SETTING_CHOICES)
  notifyOff: string[]; // 끈 알림 종류 — hatch · evolve · achievement · find (src/shared/names/banners.ts NOTIFY_KINDS)
}

export interface Snapshot {
  points: number;
  // preset 은 지금 적용한 파티 프리셋 — 번호(0 부터), 가진 수, 최대 수, 이름 (src/party/presets.ts)
  // presets 는 가진 프리셋 전부 — 번호 순. 적용한 프리셋도 들고 칸은 slots 와 같다 (2026-10-07 프리셋 전체보기)
  party: { slots: SlotView[]; shown: number; usable: number; preset: { index: number; count: number; max: number; name: string }; presets: PresetView[] };
  boxes: BoxView[];
  battle: BattleView; // 배틀 파티 — 모험 탭 (2026-10-08)
  eggs: { list: EggView[]; used: number; size: number };
  bag: BagItemView[];
  dex: { unlocked: number; obtained: number; shiny: number };
  shop: ShopItemView[];
  achievements: { total: number; unclaimed: number; list: AchievementView[] };
  settings: SettingsView;
  natures: NatureOption[];
  sellDuplicates: { petId: string; price: number }[]; // 중복 팔기 후보 — 박스 순서. 같은 종에서 한 마리를 남긴 나머지 (src/shop/sell-pet.ts duplicateCandidates, 2026-10-05)
  limits: { boxNameMax: number; presetNameMax: number }; // 이름 칸 글자 수 상한 (src/box/rules.ts BOX_RULES.nameMax — 프리셋 이름도 같다)
  sizeLevels: number; // 그림 크기 단계 수 — 상세의 크기 단추 수 (src/party/size.ts SIZE_STEPS)
  tutorial: string | null; // 관리 창에 지금 보여 줄 튜토리얼 id(shop · hatch · achievement). 해당 탭에 있을 때만 화면이 코치마크를 그린다 (src/tutorial/queue.ts)
  detailTutorial: boolean; // 개체 상세 튜토리얼을 아직 끝내거나 건너뛰지 않았다 — 파티 개체 상세를 처음 열면 화면이 4단계를 보여 준다(볼·돌봄·성장·크기, docs/specs/game.md 개체 상세 튜토리얼)
  areaTutorial: boolean; // 놀이공간 튜토리얼을 아직 끝내거나 건너뛰지 않았다 — 설정 › 화면을 처음 열면 놀이공간 줄을 밝힌다 (2026-09-28 바탕화면에서 옮김)
  screenTutorials: string[];
  replayTutorials: string[]; // 가이드북에서 지금 다시 볼 수 있는 튜토리얼(뜰 대상이 있는 것) — 나머지는 `다시 보기` 가 흐리다 (src/tutorial/queue.ts replayableNow) // 화면을 처음 열 때 띄우는 튜토리얼 가운데 아직 끝내거나 건너뛰지 않은 것 — area · dex · trade · user (src/tutorial/conditions.ts SCREEN_TUTORIALS)
  // 포켓몬 표시·클릭 통과 — 저장이 아니라 이 앱 프로세스의 창 상태다. 앱이 채운다. 없으면 설정에 두 줄을 두지 않는다
  display?: DisplayView;
  saveFailing?: boolean; // 저장이 이어서 3번 실패했다 — 모든 탭 위쪽에 안내를 띄운다 (src/tx/game.ts)
}

export interface DisplayView {
  hidden: boolean; // 잠시 숨김 (트레이의 잠시 숨기기와 같다)
  clickThrough: boolean; // 클릭 통과
}

// 초상 요청 한 건 — 열쇠는 slug, 이로치면 `slug:shiny`
export interface PortraitAsk {
  slug: string;
  shiny: boolean;
}

// 그림에서 불투명한 영역 — 알파 128 이상인 점을 모두 담는 네모(px). width·height 는 그림 전체 크기
export interface OpaqueBox {
  x: number;
  y: number;
  w: number;
  h: number;
  width: number;
  height: number;
}

// 디스크에 있는 그림 하나 — data URI 와 불투명 영역. box 가 null 이면 재지 않았거나 빈 그림이다(받는 쪽이 그림을 읽어 잰다)
export interface ArtImage {
  uri: string;
  box: OpaqueBox | null;
}
