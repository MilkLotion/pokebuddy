<div align="center">

<img src="assets/logo/out/logo.svg" width="96" alt="pokebuddy">

# pokebuddy

**일하는 동안 바탕화면에서 노는 포켓몬 육성 게임**

켜 두면 포켓몬이 화면 위를 돌아다니고, 졸고, 만지면 반응한다.<br>
가끔 밥을 주고 놀아 주면 친해지고, 모은 포인트로 알을 사서 동료를 늘린다.

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-555)
![license](https://img.shields.io/badge/license-MIT-blue)

[다운로드](#다운로드) · [이렇게 놀아요](#이렇게-놀아요) · [설명서](docs/guide.md)

</div>

<!-- 이미지 [hero]: 바탕화면 위에서 포켓몬 여러 마리가 돌아다니는 GIF — docs/images/README.md -->

---

## 다운로드

[최신 릴리스](https://github.com/MilkLotion/pokebuddy/releases/latest)에서 내 컴퓨터에 맞는 파일을 받는다.

| 컴퓨터 | 받을 파일 |
|---|---|
| Windows | `pokebuddy-Setup-<버전>.exe` |
| Mac (Apple Silicon) | `PokeBuddy-<버전>-arm64.dmg` |
| Mac (Intel) | `PokeBuddy-<버전>-x64.dmg` |

코드 서명이 없어서 처음 실행할 때 경고가 한 번 뜬다.

- **Windows** — 파란 "Windows의 PC 보호" 창에서 `추가 정보` → `실행` 을 누른다.
- **Mac** — 시스템 설정 → 개인정보 보호 및 보안 → 아래쪽 `그래도 열기` 를 누른다.
- **Mac 키체인 창** — 키체인 허용 창이 뜨면 로그인 암호를 넣고 `항상 허용` 을 누른다. 그 뒤로는 묻지 않는다.

한 번 설치하면 새 버전은 앱이 알아서 받는다. 자세한 내용은 [설명서 — 설치](docs/guide.md#설치)에 있다.

## 이렇게 놀아요

1. **첫 포켓몬 고르기** — 역대 스타터와 피츄, 이브이 가운데 한 마리를 고른다.
2. **구경하기** — 포켓몬은 놀이공간 안을 걷고, 두리번거리고, 한참 가만히 두면 잠든다. 콕 누르면 반응하고, 끌어서 옮길 수 있다.
3. **돌보기** — 우클릭 메뉴에서 밥 주기와 놀아주기를 한다. 배가 고프면 작은 말풍선을 띄우지만, 돌볼 때는 내가 정한다.
4. **포인트 모으기** — 파티에 있는 포켓몬은 친해질수록 포인트를 더 빨리 모은다. 가끔 바닥에서 무언가를 주워 오기도 한다.
5. **알 부화** — 상점에서 알을 사서 돌보미집에 맡기고, 준비가 끝나면 직접 연다.
6. **키우고 진화** — 경험사탕으로 레벨을 올리고, 원할 때 진화시킨다. 진화의돌·민트 같은 도구도 쓴다.
7. **파티 꾸리기** — 바탕화면에는 파티의 최대 6마리가 함께 나온다. 나머지는 박스에 보관한다.
8. **도감 채우기** — 종마다 얻는 방법과 진화 조건을 확인한다.

<!-- 이미지 [settings-party]: 설정창 파티 탭과 옆에 붙은 파티 상세 기기 창 — docs/images/README.md -->

게임 시간은 컴퓨터를 켜 두고 앱이 떠 있을 때만 흐른다. PC 를 잠그거나 앱을 끄면 멈추고, 다시 켜면 그대로 이어진다.
배틀은 없다.

## 설정창

트레이(Mac 은 메뉴 막대) 아이콘 메뉴에서 `설정창 열기` 를 누른다. 앱이 떠 있을 때 앱을 한 번 더 실행해도 설정창이 열린다.

| 탭 | 하는 일 |
|---|---|
| 파티 | 함께 나온 포켓몬 여섯 칸. 칸을 누르면 상세 창에서 돌봄·진화·크기·교체를 한다 |
| 박스 | 파티 밖 포켓몬 보관, 알을 맡기는 돌보미집 |
| 도감 | 전체 종의 등록 상태, 얻는 방법, 진화 조건 |
| 상점 | 알·포켓몬·도구·진화 도구·파티 칸을 포인트로 산다 |
| 가방 | 산 도구를 골라 쓴다 |
| 교환 | 친구와 링크 하나로 포켓몬을 한 마리씩 바꾼다 |

헤더에서 업적, 설정, 우편함, 사용자(계정·CLI 연결)를 연다. 처음 쓰는 기능은 튜토리얼이 짚어 주고, 다시 보고 싶으면 설정의 가이드북을 연다.

<!-- 이미지 [shop]: 상점 탭 알 분류 — docs/images/README.md -->

## 함께하면 더 좋은 것

- **친구 교환** — 교환 탭에서 링크를 만들어 보내면 친구와 한 마리씩 바꾼다. 로그인은 필요 없다.
- **계정** — 로그인하면 저장이 서버에도 올라가고, 우편함 선물을 받는다. 로그인하지 않아도 게임은 전부 된다.
- **AI 코딩 도구 연결** — Claude Code · Codex CLI · Gemini CLI 를 연결하면, 맨 앞 터미널에서 AI 가 일하는 동안 포켓몬도 바쁘게 움직이고, 승인을 기다리면 두리번거리고, 실패하면 쓰러진다. 사용자 → `연결` 탭에서 켠다. 연결하려면 Node.js 가 있어야 한다.

<!-- 이미지 [cli-state]: 터미널에서 AI 가 일하는 동안 포켓몬이 작업 동작을 하는 GIF — docs/images/README.md -->

## 문서

| 문서 | 내용 |
|---|---|
| [설명서](docs/guide.md) | 설치, 게임 방법, 설정, 문제 해결 |
| [개발과 배포](docs/contributing/development.md) | 저장소에서 실행하기, CLI 명령, 빌드와 릴리스 |
| [문서 안내](docs/README.md) | 설계, 게임 규칙, 용어 등 전체 문서 목록 |

## 라이선스

코드는 [MIT](LICENSE) 다.

포켓몬 권리는 Nintendo · Game Freak · Creatures Inc. 에 있다. 이 앱은 개인 · 비상업 팬 용도로만 쓴다.

포켓몬 그림은 저장소와 설치 파일에 들어 있지 않다. 처음 실행할 때 받아서 내 컴퓨터에만 캐시한다.

- 움직이는 그림은 [PMDCollab/SpriteCollab](https://github.com/PMDCollab/SpriteCollab) 기여자들의 작품이며 **CC BY-NC 4.0** 이다.
- 설정창의 초상·도구·알 그림은 [PokeAPI sprites](https://github.com/PokeAPI/sprites)(저장소 CC0)에서 받는다. PokeAPI 에 없는 경험사탕·민트·일부 진화 도구는 [msikma/pokesprite](https://github.com/msikma/pokesprite)(코드 MIT)에서 받는다. 두 곳 모두 그림 저작권은 Nintendo · Creatures · GAME FREAK 에 있다.
- 화면 글꼴은 [Galmuri](https://github.com/quiple/galmuri)(© Lee Minseo)이며 **SIL Open Font License 1.1** 이다. 전문은 [assets/fonts/OFL.txt](assets/fonts/OFL.txt).
