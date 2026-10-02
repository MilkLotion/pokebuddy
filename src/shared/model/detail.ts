// 화면 모델 — 칸을 누를 때 따로 읽는 값(도감 목록·도감 상세·상점 상세). 타입만 둔다

export type DexState = "obtained" | "unlocked" | "locked";

export interface DexEntry {
  slug: string;
  dex: number;
  form?: number; // 리전폼의 폼 순번 — `#0026-1`. 정렬은 번호, 그다음 폼 순번 (src/dex/regional.ts)
  region?: string; // 리전폼의 지방 — 지방 필터가 번호 구간 대신 이것으로 거른다
  name: string;
  state: DexState;
  shiny: boolean;
  mega?: true; // 내 개체에 메가스톤이 생긴 적이 있는 종 — 얻음 표식 옆에 메가스톤 표식 (2026-10-02 사용자 결정)
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
  mega?: { label: string; names: string }; // 얻은 종이 메가진화하는 종일 때만 — 줄 머리(`메가진화`·`원시회귀`)와 메가 모습의 이름(`메가리자몽X · 메가리자몽Y`)
}

// 상점 상세 — 구매 창을 열 때 상품 하나만 만든다 (src/tx/shop-detail.ts, 2026-09-30 사용자 결정 "상점에서 포켓몬 상세 추가")
// 진화 사슬의 한 종. 미해금이면 name 이 "???" 이고 화면은 그림을 검은 실루엣으로 그린다(2026-10-02). 조건 문구는 미해금이어도 준다
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
