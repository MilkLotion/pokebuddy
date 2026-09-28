// 무대 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다 (런타임 값 없음)
// 선언 파일인 이유: 렌더러 tsconfig(rootDir src/renderer)와 메인 tsconfig(rootDir src)가 함께 읽어야 하는데
//   .ts 면 렌더러 빌드가 rootDir 밖 소스로 거부한다(TS6059). 선언 파일은 rootDir 검사와 emit 이 없다
// 다른 파일을 import 하지 않는다 — 렌더러 프로그램에 rootDir 밖 .ts 가 끌려 들어오지 않게
// StageState 는 shared/types.ts 의 AgentState 와 같은 값 — selftest-stage 가 서로 대입해 어긋남을 잡는다

export type StageState = "idle" | "running" | "waiting" | "waving" | "failed";
export type PlayMode = "loop" | "hold" | "once";

export interface StageSize {
  w: number; // DIP
  h: number;
}

export interface StageInit {
  size: StageSize;
  debug: boolean;
}

// PMD 시트 하나 — art/pmd.js sheetOf 의 결과 모양
export interface SpriteSheet {
  fw: number;
  fh: number;
  rows: number;
  frames: { x: number; ms: number }[]; // x 는 열 번호(픽셀 아님) — 렌더러가 x × fw 로 자른다
  dataUrl: string;
}

// 모습(look) 하나의 그림 묶음 — 렌더러가 look 키로 캐시한다
export interface LookSheets {
  look: string; // Pet.look ?? Pet.species
  cell: StageSize; // 담긴 동작 전부를 덮는 칸 (도트, 배율 전)
  body: StageSize; // 작업 동작을 뺀 몸 칸 — 자리 계산의 기준
  anims: Record<string, SpriteSheet>;
  clips: Record<string, { anim: string; mode: PlayMode; row: number }>; // 상태 → 동작 (StageState 키)
}

// 지금 재생할 동작 — 움직임 모듈이 고른 것. rate 는 재생 속도 배율(걷는 속도)
export interface Play {
  anim: string;
  row: number; // PMD 방향 행 0~7
  mode: PlayMode;
  rate: number;
}

// 무대 위 마리 하나 — x·y 는 무대 안 좌표(DIP)의 "몸" 좌상단. 그림은 몸 칸 가운데에 맞춰 렌더러가 그린다
export interface StagePet {
  evolution?: number; // 진화 연출의 남은 비율 0~1
  berry?: { x: number; y: number };
  bubble?: string; // 머리 위 말풍선 글 — 배고픔 구간에 들어갈 때 잠깐 (Figma `Speech Bubble` `338:733`)
  id: string;
  look: string;
  zoom: number; // 도트 배율 (Pet.size 를 그림 크기로 가둔 값)
  x: number;
  y: number;
  play: Play | null; // null 이면 상태 동작 clips[state]
  held: boolean;
}

export interface StageFrame {
  at: number; // 메인 시각 ms
  state: StageState; // 상태 동작의 기준 (S2 는 전원 공통)
  pets: StagePet[]; // 그리는 순서 = 배열 순서 (뒤가 위)
}

export interface HoverQuery {
  x: number; // 무대 안 좌표
  y: number;
}
export type HitReply = string | null; // 마리 id

export type PointerType = "grab" | "drag" | "drop" | "click" | "menu";
export interface PointerMsg {
  type: PointerType;
  id: string; // 어느 마리
  x: number; // drag: 몸 좌상단이 놓일 무대 안 자리. 나머지: 커서 자리
  y: number;
}

// 바탕화면 튜토리얼 코치마크 — 첫 돌봄(포켓몬 둘레를 비우고 어둡게), 놀이공간(놀이공간 테두리). 모두 한 단계다
// Figma `Tutorial / First Care` `397:8552`, `Tutorial / Playground` `397:8596`. 문구는 메인이 i18n 에서 채운다
export interface CoachView {
  id: string; // 튜토리얼 id — first-care · playground
  kind: "pet" | "area";
  step: string; // "튜토리얼 · 첫 돌봄 1 / 2"
  title: string;
  body: string;
  button: string; // 확인 — 빈 글이면 버튼을 그리지 않는다(행동으로만 넘어가는 단계)
  petId?: string; // kind pet — 밝힐 마리
  areaLabel?: string; // kind area — "지금 · 화면 전체"
  avoid?: { x: number; y: number; w: number; h: number }; // kind pet — 말풍선이 덮지 않을 사각형(무대 좌표). 첫 돌봄 2/2 의 열린 메뉴
  passive?: boolean; // 할 수 있는 행동이 없는 단계(첫 돌봄 쉬는 중) — 창이 클릭을 가로채지 않고 말풍선만 받는다
}
export interface CoachAction {
  id: string;
  action: "done" | "skip"; // 버튼은 완료, ✕ 는 스킵
}
// 말풍선 위라는 히트 답은 문자열 "coach" 다 — 마리 id(p숫자)와 겹치지 않는다. 선언 파일이라 상수를 두지 못한다

// 첫 포켓몬 선택 창 — Figma `First Run / Starter Selected` `402:9417`, `Starter Empty` `402:9579`
export interface PickerItem {
  slug: string;
  name: string;
  evolution: string; // 고르면 아래 줄에 보이는 진화 문구 — "진화: 리자드 → 리자몽"
}
export interface PickerPayload {
  title: string; // 첫 포켓몬 선택
  start: string; // 함께하기
  empty: string; // 고르기 전 아래 줄 문구
  items: PickerItem[]; // data/unlocks.json 의 starter 순서 (세대별 3종 × 9 + 피카츄·이브이)
}

// 채널 이름 — preload 와 메인이 같은 문자열을 쓰도록 유니언으로 묶는다 (런타임 상수는 양쪽이 각자 satisfies 로 검사)
export type StageChannel =
  | "stage:init" // M→R  StageInit
  | "stage:sheets" // M→R  LookSheets
  | "stage:frame" // M→R  StageFrame
  | "stage:hover" // M→R  HoverQuery
  | "stage:click-through" // M→R  boolean
  | "stage:cry" // M→R  울음소리 { uri: data URI, volume: 0~1 }
  | "stage:coach" // M→R  CoachView | null
  | "stage:coach-action" // R→M  CoachAction
  | "stage:ready" // R→M  없음
  | "stage:hit" // R→M  HitReply
  | "stage:pointer" // R→M  PointerMsg
  | "stage:log" // R→M  Record<string, unknown> — 렌더러 진단(시트 디코드 실패 등)을 메인 로그로
  | "picker:list" // R→M invoke → PickerPayload
  | "picker:start" // R→M  slug
  | "picker:portraits"; // R→M invoke slug[] → slug 별 data URI (못 받으면 null)

// preload 가 window.pokebuddy 로 내놓는 것 — 무대와 선택 창이 같은 preload 를 쓴다
export interface StageBridge {
  ready(): void;
  onInit(cb: (init: StageInit) => void): void;
  onSheets(cb: (sheets: LookSheets) => void): void;
  onFrame(cb: (frame: StageFrame) => void): void;
  onHover(cb: (q: HoverQuery) => void): void;
  onClickThrough(cb: (on: boolean) => void): void;
  onCry(cb: (uri: string, volume: number) => void): void; // 울음소리 한 번 — 놀아주기가 성공했을 때
  onCoach(cb: (coach: CoachView | null) => void): void; // 바탕화면 튜토리얼 — null 이면 지운다
  coachAction(action: CoachAction): void;
  hit(id: HitReply): void;
  pointer(msg: PointerMsg): void;
  log(entry: Record<string, unknown>): void;
  pickerList(): Promise<PickerPayload>;
  pickerStart(slug: string): void;
  pickerPortraits(slugs: string[]): Promise<Record<string, string | null>>; // 선택 창 카드의 초상
}
