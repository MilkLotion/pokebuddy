// 화면 모델 — 설정창의 스냅샷과 스냅샷이 가리키는 값. 타입만 둔다 (런타임 값 없음)
// 화면이 읽는 값은 src/tx/snapshot.ts 가 만든다. 그 파일이 여기 타입을 가져다 쓴다 — 모양의 출처는 한 곳이다.
// ViewZone 은 src/state/time.ts 의 FullnessZone 과 같은 값이다. 자체 검사가 서로 대입해 어긋남을 잡는다

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
  look: string; // 초상에 쓰는 종 — 메가 모습이면 그 슬러그, 아니면 species 와 같다. name·types 도 이 모습을 따른다
  mega?: MegaView; // 메가스톤을 지닌 개체만 (src/dex/mega.ts)
  care: CareView | null; // 돌봄 보너스 — 친밀도가 100 미만이면 null
}

// 돌봄 보너스 — 파티 상세 기기 창의 `포인트 적립` 줄이 쓴다 (src/state/time.ts careParts, docs/specs/balance.md "돌봄 보너스")
// 필드 이름을 percent 로 두지 않는다 — 기기 창이 percent 를 시간으로만 바뀌는 값으로 보고 다시 그리지 않는다 (src/renderer/pet.ts LIVE_KEYS)
export interface CareView {
  bonus: number; // 보너스 합(백분율). 0 이면 기본 속도다
  parts: { kind: string; name: string; bonus: number }[]; // 내역 — kind 는 mood 또는 버프 종류. name 은 기분 단계 말이나 버프 이름
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
  pool?: EggPoolView; // 알 — 종 목록이 정해진 알(단일 포켓몬 알·태고의돌)만. 랜덤알에는 없다
}

// 알에서 나오는 포켓몬 — 상점 기기 창의 `나오는 포켓몬` 줄과 목록 창이 쓴다 (2026-10-03 사용자 결정, worklog/records/egg-pool/record.md)
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

// 초상 요청 한 건 — 열쇠는 slug, 이로치면 `slug:shiny`
export interface PortraitAsk {
  slug: string;
  shiny: boolean;
}
