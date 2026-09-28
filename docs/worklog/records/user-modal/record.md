# 헤더 로고·톱니바퀴·사용자 모달

- 날짜: 2026-09-28
- 컴퓨터: Mac. 집 PC 에서 `worklog/records/user-modal/record.md` 로 옮긴다. 설정 모달의 옛 기록(`worklog/records/trade/record.md` "계정 탭 구조로 수정")과 이어진다.

## 설계

- 사용자 요청(2026-09-28, 설정창 스크린숏과 함께): "1. 타이틀 아이콘 추가. 2. 설정아이콘 변경. 3. 설정모달에서 계정은 빼고, 설정옆에 유저아이콘 추가 후 해당 메뉴에서 계정,연결 설정"
- 범위: 설정창 헤더와 설정 모달(`src/renderer/manage.ts`, `src/renderer/manage.html`), 관련 명세.
- 결정(이번 작업의 제안, 사용자 확인 전):

| 항목 | 결정 | 근거 |
|---|---|---|
| 타이틀 아이콘 | 앱 로고 20×20 을 `PokeBuddy` 왼쪽에, 간격 8px | 창 CSP 가 `img-src data:` 뿐이다. `assets/logo/src/logo.svg`(1.4KB)를 인라인 SVG 로 넣는다 |
| 설정 아이콘 | 슬라이더 → 톱니바퀴(선 아이콘) | "설정 아이콘 변경"의 흔한 모양. 다른 헤더 아이콘과 같은 20×20 선 스타일 |
| 유저 아이콘 | 설정 아이콘 오른쪽. 사람 모양(머리 원 + 어깨 곡선). 툴팁 `사용자` | "설정옆에 유저아이콘" |
| 사용자 모달 | 제목 `사용자`, 탭 `계정`(기본)·`연결`. 설정 모달과 같은 틀·크기(560×500). 버전 줄은 두지 않는다 | 버전·업데이트·패치노트는 앱 설정이라 설정 모달에 남긴다 |
| 설정 모달 | 탭 `일반`·`화면` 두 개 | "설정모달에서 계정은 빼고" + 연결도 사용자 모달로 |
| 계정으로 가는 길 | 헤더 저장 표시, `{ to: "account" }` 라우트(로그인 뒤 돌아옴)는 사용자 모달의 계정 탭 | 계정 탭이 옮겨 갔다 |

## 작업

- 코드(서브 에이전트 작성, 검수 후 툴팁 한 단어 수정):
  - `src/renderer/manage.html`: 브랜드 로고 인라인 SVG, 톱니바퀴 SVG, `#open-user` 버튼
  - `src/renderer/manage.ts`: Dialog 에 `{ kind: "user"; tab: UserTab }`. `SettingsTab` = `general | display`, `UserTab` = `account | agents`. 두 모달이 `drawTabbedHead` 로 제목·닫기·두 칸 전환·스크롤 틀을 같이 쓴다. 로그인 전 계정 탭 바닥은 가입·로그인 단추만
  - `scripts/e2e-account.cjs`: 계정 탭을 찾기 전에 누르는 버튼을 `open-settings` → `open-user`
- 문서: `docs/specs/game.md`(설정창 표, 설정·사용자 모달 절), `docs/specs/ui-components.md`(C-01, C-02, C-03, C-15 네 칸 변형), `docs/specs/scenarios.md`, `docs/design.md`, `docs/terms.md`(`설정` 뜻 수정, `사용자` 추가), `docs/guide.md`

## 검수

| 명령·확인 | 결과 |
|---|---|
| `npm run build`, `npm run selftest` (서브 에이전트) | 종료 코드 0 |
| `npx electron scripts/dev-manage.cjs --shot` — 헤더 / 설정 / 사용자 계정 탭 / 사용자 연결 탭 | 로고·톱니바퀴·유저 아이콘 표시. 설정 `일반·화면`, 사용자 `계정·연결`. 계정 탭은 개발 실행기에 서버가 없어 "계정을 쓸 수 없어요"(정상). 창 오류 없음 |
| `node scripts/check-docs.cjs`, `git diff --check` | 통과 |

`scripts/e2e-account.cjs` 는 돌리지 않았다.

## 피드백

- 명세 C-02 의 "모달이 열린 동안 헤더 아이콘 진한 배경"은 지금 코드의 업적·설정 버튼에도 없다. 유저 버튼에도 넣지 않았다. 명세와 코드가 어긋난 채로 남아 있다. [스펙 미확정]
- Figma(`App Header`, `Header Icon Button`, `Settings / *`)에 로고·톱니바퀴·유저 아이콘·사용자 모달을 반영하지 않았다. [스펙 미확정]
- 첫 계정 탭 캡처가 모달이 그려지기 전에 찍혔다(`--wait` 없음). 기다린 뒤 다시 찍어 확인했다. 앱 문제는 아니다.

## Figma 반영 — 남은 일 (집 PC 에서)

2026-09-28 Mac 에서 시도했으나 막혔다. Mac 의 Figma MCP 는 `hyunsoo.noh.quantum@gmail.com` 으로 로그인돼 있다. 이 계정은 파일 `MA3K41Y6omAi5mRu6YDFly` 편집 권한이 없다("You don't have edit access to this file"). 파일에는 아무것도 바꾸지 않았다.

**시작 전 확인.**

1. Figma MCP `whoami` 가 파일 소유 계정인지 본다. 아니면 `/mcp` 에서 figma 를 다시 인증한다.
2. `use_figma` 전에 figma-use 가이드(`skill://figma/figma-use/SKILL.md`)를 읽는다. 호출마다 `skillNames` 를 넣는다.
3. [docs/contributing/figma.md](../../../contributing/figma.md) 의 글자 규칙을 따른다. Galmuri 는 `use_figma` 에서 불러오지 못한다.

**할 일.** 기준은 코드다. 모양이 애매하면 해당 파일을 읽어 맞춘다.

| # | 대상 | 할 일 | 기준 코드 |
|---|---|---|---|
| 1 | `App Header` `154:1017` | 브랜드 `PokeBuddy` 왼쪽에 앱 로고 20×20(간격 8). `assets/logo/src/logo.svg` 를 `createNodeFromSvg` 로 넣고 가능하면 `Icon / Logo` 컴포넌트로 만든다 | `src/renderer/manage.html` `header .brand` |
| 2 | `Header Icon Button` `295:3083` | Icon 교체 후보에 `Icon / Settings`(톱니바퀴)와 `Icon / User`(사람 모양)를 추가한다. 기존 `Icon / Options`·`Icon / Achievement` 와 같은 20×20 선 아이콘. `Open` 상태 흰색 덮어쓰기가 먹게 벡터를 하나로 합친다(명세 C-02 주의) | `manage.html` `#open-settings`·`#open-user` SVG |
| 3 | `App Header` `header-actions` | 순서를 업적, 설정(톱니바퀴), 유저로. 유저 버튼 인스턴스를 더하고 설정 버튼 아이콘을 톱니바퀴로 바꾼다 | 같음 |
| 4 | `Settings / General` `633:18937`, `Settings / Display` `633:19017` | 두 칸 전환을 `일반 \| 화면` 두 칸(`Count=2`)으로 | `src/renderer/manage.ts` `SETTINGS_TABS` |
| 5 | 새 `User / Account`, `User / Connect` | 제목 `사용자`, 두 칸 전환 `계정 \| 연결`, 크기 560×500, 바닥 버전 줄 없음. `Settings / Connect` `633:19096` 은 이름을 `User / Connect` 로 바꿔 재사용한다(중복 프레임을 남기지 않는다). Account 는 기존 계정 탭 프레임이 있으면 그 내용, 없으면 로그인 전 화면 | `manage.ts` `USER_TABS`, `drawUser`, `drawAccount` |
| 6 | `Context Menu` `338:738` 과 이 메뉴를 쓰는 화면 인스턴스 | 구성을 이름·상태 / 밥 주기·놀아주기·볼에 넣기 / 상세 보기로. `잠시 숨기기`·`다시 보이기`·`종료` 를 지우고 `설정창 열기` → `상세 보기`. 트레이 메뉴 시안은 그대로 둔다 | `src/main/menus.ts` `petMenu`, `src/main/app.ts` `showPetMenu` |

**글자 처리 순서.** (a) 컴포넌트 속성·variant·인스턴스 교체·숨김/삭제 → (b) 같은 문구의 기존 글자 노드 복제 → (c) figma.md §1 절차로 새 글자. (c)로 만든 글자는 노드 ID·문구·스타일을 이 기록에 적는다. 끝나면 Chrome 에서 Galmuri 재배치를 한다(figma.md §3). 새 글자 후보: `사용자`, `상세 보기`.

**끝나면.**

- 바뀐 프레임을 `node.screenshot()` 으로 한 번씩 확인한다. 넘침·겹침은 Chrome 화면으로 본다(서버 캡처는 Galmuri 가 아니다).
- 명세의 `[스펙 미확정]` 표시를 실제 노드 ID 로 바꾼다: `docs/specs/ui-components.md` C-01 "로고·톱니바퀴·유저 아이콘은 Figma 에 아직 반영하지 않았다", C-02 아이콘 목록, C-15 네 칸 변형 설명.
- 이 기록의 "피드백"에서 Figma 항목을 닫는다.
