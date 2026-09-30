# 문서 이미지

이 폴더는 [README](../../README.md)와 [설명서](../guide.md)에 넣는 캡처를 둔다.
앱에는 들어가지 않는다. `package.json` 의 `files` 에 `docs/` 가 없다.

## 넣는 방법

아직 찍지 않은 이미지는 문서에 한 줄 주석으로 자리만 표시했다. GitHub 화면에는 보이지 않는다.

```text
<!-- 이미지 [hero]: 바탕화면 위에서 포켓몬 여러 마리가 돌아다니는 GIF — docs/images/README.md -->
```

1. 남은 자리를 찾는다.

   ```text
   git grep -n "<!-- 이미지 \[" -- README.md docs/guide.md
   ```

2. 아래 표에서 그 ID 의 화면을 찍는다. 파일 이름은 표의 `파일` 칸을 그대로 쓴다.
3. 파일을 이 폴더에 넣는다.
4. 주석 한 줄을 이미지 링크로 바꾼다. 경로는 문서 위치에 따라 다르다.
5. `node scripts/check-docs.cjs` 로 링크를 검사한다.

4번의 예는 다음과 같다. 첫 줄은 `README.md`, 둘째 줄은 `docs/guide.md` 에 쓴다.

```text
![바탕화면에서 노는 포켓몬](docs/images/hero.gif)
![첫 포켓몬 선택 창](images/starter.png)
```

같은 ID 가 두 문서에 있으면 두 곳을 모두 바꾼다. 예: `shop`.

## 목록

| ID | 파일 | 넣을 곳 | 찍을 화면 | 상태 |
|---|---|---|---|---|
| `install-windows-smartscreen` | `install-windows-smartscreen.png` | 설명서 설치 | "Windows의 PC 보호" 첫 화면 | 넣음 (2026-09-29) |
| `hero` | `hero.gif` | README 머리 | 에디터나 터미널 위에서 포켓몬 3~4마리가 걷고, 두리번거리고, 하나를 끌어 옮기는 장면 | 대기 |
| `settings-party` | `settings-party.png` | README 이렇게 놀아요 | 설정창 파티 탭에 3마리 이상, 옆에 파티 상세 기기 창이 붙어 열린 화면 | 넣음 (2026-09-30, `scripts/dev-manage.cjs --docs`) |
| `shop` | `shop.png` | README 설정창, 설명서 포인트와 상점 | 상점 탭 `알` 분류. 포인트가 넉넉히 보이게 | 넣음 (2026-09-30, `scripts/dev-manage.cjs --docs`) |
| `cli-state` | `cli-state.gif` | README 함께하면 더 좋은 것 | 터미널에서 Claude Code 가 일하는 동안 포켓몬이 작업 동작을 하고, 끝나면 인사하는 장면 | 대기 |
| `install-windows-run` | `install-windows-run.png` | 설명서 설치 — Windows | `추가 정보` 를 누른 뒤 `실행` 단추가 보이는 화면 | 대기 |
| `install-mac-open-anyway` | `install-mac-open-anyway.png` | 설명서 설치 — Mac | 시스템 설정 → 개인정보 보호 및 보안의 `그래도 열기` | 대기 |
| `install-mac-keychain` | `install-mac-keychain.png` | 설명서 설치 — Mac | `PokeBuddy Safe Storage` 키체인 허용 창 | 대기 |
| `starter` | `starter.png` | 설명서 처음 시작하기 | 첫 포켓몬 선택 창 | 넣음 (2026-09-30) |
| `playground` | `playground.png` | 설명서 놀이공간과 포켓몬 | 설정 모달 `화면` 탭의 놀이공간 전환 단추 | 넣음 (2026-09-30, `scripts/dev-manage.cjs --docs`) |
| `care-menu` | `care-menu.png` | 설명서 메뉴 | 포켓몬 우클릭 메뉴. 밥 주기 쿨타임 중이면 남은 시간이 보여 더 좋다 | 넣음 (2026-09-30) |
| `hatch` | `hatch.png` | 설명서 알과 부화 | 돌보미집 모달 위에 뜬 부화 결과 창 | 넣음 (2026-09-30 다시 찍음, `scripts/dev-manage.cjs --docs --scene done-all --scene hatch --tab 박스 --click-text 돌보미집 --click-text 열기`) |
| `evolve` | `evolve.png` | 설명서 성장과 진화 | 파티 상세 기기 창에서 진화 대상을 고르는 화면 | 넣음 (2026-09-30) |
| `dex` | `dex.png` | 설명서 도감과 업적 | 도감 탭 목록. 해금한 종과 해금하지 않은 종이 섞여 보이게 | 넣음 (2026-09-30, `scripts/dev-manage.cjs --docs`) |
| `trade` | `trade.png` | 설명서 친구 교환 | 교환 모달(박스 탭 `교환` 단추)의 `공유 채널 만들기`·`링크로 참가` | 넣음 (2026-09-30, `scripts/dev-manage.cjs --docs`) |
| `connect` | `connect.png` | 설명서 AI 코딩 도구 연결 | 사용자 모달 `연결` 탭. CLI 하나 이상이 `연결됨` | 넣음 (2026-09-30, `scripts/dev-manage.cjs --docs`) |

넣은 뒤에는 `상태` 칸을 `넣음 (날짜)` 로 바꾼다.

## 찍기 전에 준비할 것

진짜 저장을 건드리지 않으려면 시험용 HOME 을 쓴다. 방법은 [개발과 배포 — 시험용 HOME 에서 실기 확인](../contributing/development.md#시험용-home-에서-실기-확인)에 있다.

| 필요한 상태 | 명령 |
|---|---|
| 첫 포켓몬 선택 창 (`starter`) | `node dist/tools/dev-test.js start --fresh` |
| 포인트가 많은 상점 (`shop`) | 앱을 끈 뒤 `node dist/tools/dev-test.js scene shop` |
| 준비된 알 (`hatch`) | 앱을 끈 뒤 `node dist/tools/dev-test.js scene hatch` |
| 튜토리얼 없이 깨끗한 화면 | 앱을 끈 뒤 `node dist/tools/dev-test.js scene done-all,rich` |
| 관리 창 화면을 앱 없이 (`settings-party`·`shop`·`dex`·`trade`·`playground`·`connect`·`hatch`·`evolve`) | `npm run build` 뒤 `npx electron scripts/dev-manage.cjs --docs --scene done-all --shot <파일>` 에 `--tab`·`--click`·`--click-text`·`--detail --pet-shot` 을 더한다. 연결 탭은 `--agents-connected`, 진화는 `--detail --pet-click-text 진화 --pet-shot <파일>` |

- 장면을 바꾼 뒤 `node dist/tools/dev-test.js start` 로 다시 띄운다.
- 튜토리얼 코치마크가 화면을 가리면 `done-all` 장면을 먼저 쓴다.

## 찍을 때 지킬 것

- 개인 정보를 가린다. 계정 아이디, 파일 경로의 사용자 이름, 터미널의 대화 내용, 교환 링크가 대상이다.
- PNG 는 Retina(2배)로 찍어도 된다. 가로 1600px 을 넘으면 줄인다.
- GIF 는 가로 800px 이하, 5MB 이하로 만든다. 10초 안쪽으로 자른다.
- 캡처 도구의 예: Mac 은 `Cmd+Shift+5`, Windows 는 `Win+Shift+S` 다. GIF 는 Mac 의 Kap, Windows 의 ScreenToGif 로 만든다.
- 앱 화면 대신 Figma 시안을 쓰지 않는다. 문서는 지금 앱의 모습을 보여 준다. 화면 모양의 근거는 Figma 파일 `MA3K41Y6omAi5mRu6YDFly` 의 `05 · Screens` 섹션이다. 앱과 시안이 다르면 앱을 찍고, 차이는 따로 알린다.
