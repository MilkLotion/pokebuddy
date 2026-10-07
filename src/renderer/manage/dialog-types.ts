// 설정창의 탭과 대화상자 타입 — 값이 없는 파일이다. 모든 기능 파일이 읽는다

export type TabId = "party" | "box" | "dex" | "shop" | "bag" | "adventure";

// 설정 모달의 탭 · 사용자 모달의 탭
export type SettingsTab = "general" | "display";
export type UserTab = "account" | "agents";

// 알 하나를 연 결과 — 태어난 개체, 또는 포켓몬 대신 나온 알
export type AllCaught = { kind: string; points: number }; // 다 모은 단일 포켓몬 알 대신 받은 포인트 (src/egg/open.ts)
export type Hatched = { petId: string; slotIndex?: number } | { eggId: string } | { allCaught: AllCaught };

// 모달 하나. 어느 것인지와 그 모달만 쓰는 값을 함께 담는다
export type Dialog =
  | { kind: "pet"; petId: string }
  | { kind: "evolve"; petId: string; to?: string } // 진화 창 — to 는 고른 후보
  | { kind: "evolve-confirm"; petId: string; to: string } // 진화 확인 — 진화 창의 `진화` 가 연다. `취소` 는 진화 창으로
  | { kind: "nature"; petId: string; pick?: string; itemId?: string } // 성격 변경 — pick 은 고른 성격, itemId 는 가방의 민트로 왔을 때
  | { kind: "nature-target"; itemId: string } // 가방의 민트 — 성격을 바꿀 개체를 고른다
  | { kind: "achievements" }
  | { kind: "settings"; tab: SettingsTab }
  | { kind: "user"; tab: UserTab } // 사용자 — 계정·연결 (헤더 유저 아이콘)
  | { kind: "guide"; pick?: string } // 가이드북 — 설정의 `가이드북`. pick 은 왼쪽 목록에서 고른 주제·튜토리얼
  // 부화 결과 — 태어난 개체 또는 포켓몬 대신 나온 알. over 면 돌보미집 모달 위에 겹친다.
  // 모두 열기면 queue 에 결과 전부, at 은 지금 보이는 차례(0 부터) — `다음 (1 / N)` 으로 하나씩 넘긴다
  | { kind: "hatched"; petId?: string; slotIndex?: number; eggId?: string; allCaught?: AllCaught; over?: "daycare"; queue?: Hatched[]; at?: number }
  | { kind: "daycare" } // 돌보미집 — 박스 넘김 줄의 집 아이콘 단추
  | { kind: "box-order" } // 박스 순서 — 박스 머리 메뉴의 `박스 순서`
  | { kind: "preset-overview"; battle?: true } // 프리셋 전체보기 — 파티 탭 머리의 `전체보기`. battle 이면 모험 탭의 `가져오기`(기존 파티 가져오기)
  | { kind: "battle-pick"; slot: number; page: number } // 배틀 파티 칸에 넣을 개체 고르기 — page 는 고르기판 쪽(프리셋 → 박스)
  | { kind: "pool"; productId: string; page: number } // 알에서 나오는 포켓몬 — 상점 기기 창의 `나오는 포켓몬` 줄
  | { kind: "form"; petId: string; to: string } // 공유 sid 계열의 모습 바꾸기 확인
  | { kind: "mega"; petId: string; to?: string } // 메가진화 — 확인(모습 하나)·고르기(모습 둘)·원래 모습으로. to 는 고른 모습
  | { kind: "sell-pet"; petId: string; price: number } // 포켓몬 팔기 확인 — 포켓몬 메뉴의 `팔기`
  | { kind: "sell-dup"; off?: string[] } // 중복 팔기 — 박스 머리 메뉴의 `중복 팔기`. off 는 판매에서 뺀 개체
  | { kind: "notes"; pick?: string } // 패치노트 — 설정 바닥의 `패치노트`. pick 은 왼쪽 목록에서 고른 버전
  | { kind: "notes-new"; version: string } // 업데이트 뒤 처음 켤 때 한 번 — 그 버전만
  | { kind: "mail" } // 우편함 — 헤더 봉투 단추
  | { kind: "letter"; id: string } // 우편함의 편지 한 통
  | { kind: "trade" }; // 친구 교환 — 박스 머리 메뉴의 `교환`
