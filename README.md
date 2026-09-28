<div align="center">

<img src="assets/logo/out/logo.svg" width="96" alt="pokebuddy">

# pokebuddy

**화면 위에 떠 있는 포켓몬 동반자**

화면 위를 돌아다니고, 졸고, 만지면 반응한다.<br>
Claude Code · Codex CLI · Gemini CLI 를 쓰면 맨 앞 터미널에서 그 CLI 가 일하는 상태에 따라 동작이 바뀐다.

![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-555)
![node](https://img.shields.io/badge/node-%E2%89%A5%2022.12-339933)
![electron](https://img.shields.io/badge/electron-44-47848F)
![license](https://img.shields.io/badge/license-MIT-blue)

[설치](#설치) · [사용](#사용) · [옵션](#옵션) · [설명서](docs/guide.md)

</div>

---

## 설치

Windows 는 설치 파일 `pokebuddy-Setup-<버전>.exe` 로도 설치한다. 누르면 동반자로 뜬다 — [Windows 실행 파일](docs/guide.md#windows-실행-파일).
만드는 방법은 `npm run dist:win` 이다.
Mac 은 `PokeBuddy-<버전>-<arm64|x64>.dmg` 로 설치한다 — [Mac 앱](docs/guide.md#mac-앱). 만드는 방법은 `npm run dist:mac` 이다.

```bash
npm install -g pokebuddy
pokebuddy setup
pokebuddy companion
```

`setup` 은 처음 한 번만 실행한다. 바꾸기 전에 백업을 남기고, 여러 번 실행해도 결과가 같다.

- **상태 훅** — 쓰고 있는 CLI(claude · codex · gemini)마다 `pokebuddy-state.cjs` 를 등록
- **데이터 폴더** — `~/.claude/pokebuddy` (설정·저장·그림 캐시)
- **옛 흔적 정리** — 예전 버전이 설치한 VS Code 계열 확장과 그 기록(`cli.json` · `windows/`)이 있으면 지운다

미리 보기는 `pokebuddy setup --dry-run`, 되돌리기는 `pokebuddy uninstall [--purge]`.
npm 게시 전에는 `npm pack` 으로 만든 `.tgz` 를 설치한다 — [배포](docs/guide.md#배포-관리자용).
git clone 으로 쓰려면 [저장소에서 바로 쓰기](docs/guide.md#저장소에서-바로-쓰기-개발용) — 클론한 폴더의 `npm install` 이 TypeScript 빌드(`dist/`)까지 한다. 예전 `termimon` · `pkmon` 을 쓰고 있었다면 [옛 이름에서 옮겨 오기](docs/guide.md#옛-이름에서-옮겨-오기).

## 사용

```bash
pokebuddy companion           # 동반자 띄우기 — 첫 실행이면 포켓몬 선택 창, 이후에는 저장된 파티를 복원
pokebuddy companion stop      # 동반자 내리기
pokebuddy status              # 지금 판정 상태 보기
```

| 명령 | 하는 일 |
|---|---|
| `pokebuddy companion [buddy=값 click=값]` | 동반자를 띄운다. 기기당 하나다. 포켓몬은 첫 실행 선택창에서 고르고, 이후 저장된 파티를 복원한다 |
| `pokebuddy companion stop` | 동반자를 내린다 |
| `pokebuddy status [포켓몬]` | 훅 등록, 맨 앞 창 판정, 상태 기록, 동반자 pid, PMD 저작자, 게임 요약을 한 번에 보여 준다 |
| `pokebuddy game …` | 육성·상점·진화 명령. 목록은 `pokebuddy game --help` |
| `pokebuddy trade <교환 링크>` | 친구 교환 링크로 참가한다 |
| `pokebuddy setup` · `pokebuddy uninstall` | 설치 · 되돌리기 |

세션 펫(`pokebuddy <종>` · `!pokebuddy <종>` · `pokebuddy stop`)과 VS Code 확장은 2026-09-27 에 지웠다. 모르는 명령을 주면 `pokebuddy companion` 을 안내한다.

## 무엇을 하나

- **항상 위에 뜬다** — 포켓몬은 놀이공간 안에서 논다. 놀이공간은 설정창에서 화면 전체나 영역 지정으로 고른다
- **맨 앞 터미널을 따른다** — 맨 앞 창이 터미널(VS Code · iTerm2 · Windows Terminal …)이면 그 앱에서 띄운 CLI 의 상태를 따른다. 브라우저를 봐도 마지막 상태를 유지한다. 같은 앱의 창·탭이 여럿이면 최신 CLI 세션을 따른다
- **돌아다니고 존다** — 한가할 때는 가끔 천천히 걷고 두리번거린다. 입력이 5분 없으면 잠들고, 집어 들면 버둥거리고, 누르면 반응한다
- **CLI 가 일하면 바빠진다** — 훅이 알려 주는 상태를 따른다. 작업 중에는 빠르게 걷고 공격 · 기 모으기 같은, 한가할 때는 안 하는 동작을 이어 간다
- **여러 마리가 한 무대에** — 파티 중 보이게 둔 마리(최대 6)를 놀이공간 크기의 투명한 무대 창 하나에 함께 그린다. 마리마다 따로 끌어 옮긴다
- **돌본다** — 밥 주기·놀아주기로 돌본다. 친밀도는 줄지 않고 만복도와 기분만 오르내린다. 모은 포인트로 상점에서 알·파티 칸·도구를 산다. 규칙은 [S5 기능 계약](docs/specs/game.md)을 따른다

| 상태 | 언제 | 동작 (PMD) |
|---|---|---|
| `running` | 프롬프트 전송 · 도구 실행 · 승인한 도구가 끝남 | 빠른 걸음 · 작업 동작 (공격 · 기 모으기 …) |
| `waiting` | 승인 대기 · 질문에 답하기 | 두리번 |
| `waving` | 세션 시작 · 턴 끝 | 인사 (2초) |
| `failed` | 도구 · 턴 실패 (셸 명령의 0 아닌 종료 코드는 빼고) | 쓰러짐 |
| `idle` | 그 밖 · Esc 로 도구를 멈춤 | 대기 · 느린 산책 · 수면 |

훅 기록이 없는 터미널에서는 늘 한가한 것으로 보고 산책 · 수면 · 만지기 반응만 한다.
무대 창은 놀이공간만큼 크지만 그림이 없는 곳의 클릭은 아래 창으로 통과한다.

## 옵션

`이름=값` 또는 `--이름 값`. **이번 실행에만 적용되고 설정 파일에는 저장되지 않는다.**

| 옵션 | 값 | 뜻 |
|---|---|---|
| `buddy=` | `on` · `calm` · `off` | 돌아다니기 · 졸기 · 만지기 반응 |
| `click=` | `on` · `off` | 포켓몬 위 클릭을 아래 창으로 통과 |

포켓몬 크기는 저장된 마리별 크기를 쓴다. 같은 값을 환경변수 `POKEBUDDY_*` 로도 줄 수 있다. 전체 목록과 설정 파일은 [설명서 — 설정](docs/guide.md#설정).

## 트레이와 우클릭 메뉴

트레이 메뉴에는 설정창 열기 · 잠시 숨기기 · 클릭 통과(마우스 클릭을 뒤의 창으로 넘김) · 종료가 있다.
포켓몬 위 우클릭 메뉴에는 `이름 · 성격` 과 상태 · 밥 주기 · 놀아주기 · 잠시 숨기기 · 설정창 열기 · 종료가 있다.
메뉴 문구는 한국어가 기본이고 `config.json` 의 `lang` 을 `en` 으로 두면 영어를 쓴다.

## 그림

그림은 [PMDCollab/SpriteCollab](https://sprites.pmdcollab.org) 한 가지다. 종마다 동작이 10~40종이라 상태 동작 · buddy 가 된다.
포켓몬 이미지는 저장소에 없다. 처음 띄울 때 `~/.claude/pokebuddy/pmd/` 로 내려받아 캐시하고, 못 받은 종은 무대에 나오지 않는다(이유는 `pokebuddy status`).

## 요구사항

- Node.js 22.12 이상 (Electron 44 설치기 요구). Windows 실행 파일은 필요 없다
- macOS (Apple Silicon · Intel) 또는 Windows
- 상태 연동: Claude Code · Codex CLI 0.124+ · Gemini CLI 0.26+ 중 하나

## 설명서

| 주제 | 내용 |
|---|---|
| [설치](docs/guide.md#설치) | setup 이 바꾸는 파일, git clone 설치, PATH 설정 |
| [사용](docs/guide.md#사용) | 명령, 옵션 · 환경변수 전체 |
| [동반자](docs/guide.md#동반자) | 놀이공간 · 따르는 창 판정 · 수명 · 트레이와 메뉴 |
| [CLI LLM 상태 연동](docs/guide.md#cli-llm-상태-연동) | CLI 별 훅 이벤트와 상태 매핑 |
| [buddy](docs/guide.md#buddy--돌아다니고-졸고-반응하기) | 산책 · 수면 · 반응 타이밍 |
| [화면 구조](docs/guide.md#화면-구조--무대-창-하나) | 무대 창 하나 · 여러 마리 · 클릭 통과 · 코드 자리 · 자체 확인 |
| [문제 확인](docs/guide.md#문제-확인) | `pokebuddy status`, 디버그 로그 |
| [배포 (관리자용)](docs/guide.md#배포-관리자용) | `npm pack`, 게시 전 확인 |
| 진행 현황 | 설계 단계별 진행 · 다음 작업 · 작업 방식 (개발용) |
| [설계 — 상주 동반자와 육성](docs/design.md) | 현재 구조, S4 구현과 S5 목표, Figma 디자인 시스템 v2 |

## 라이선스

코드는 [MIT](LICENSE).

PMD 스프라이트는 [PMDCollab/SpriteCollab](https://github.com/PMDCollab/SpriteCollab) 기여자들의 작품이며 **CC BY-NC 4.0** 이다.
저장소에 넣지 않고 실행할 때 사용자 컴퓨터로 받아 캐시만 한다. 포켓몬별 저작자는 `pokebuddy status <포켓몬>` 으로 확인한다.

설정창의 초상·도구·알 그림은 [PokeAPI sprites](https://github.com/PokeAPI/sprites)(저장소 CC0)에서, PokeAPI 에 없는 경험사탕·민트·일부 진화 도구는 [msikma/pokesprite](https://github.com/msikma/pokesprite)(코드 MIT)에서 받는다. 두 곳 모두 그림 저작권은 Nintendo · Creatures · GAME FREAK 에 있다. 설치 파일과 저장소에 넣지 않고 첫 실행에 받아 캐시만 한다.

화면 글꼴은 [Galmuri](https://github.com/quiple/galmuri)(© Lee Minseo)이며 **SIL Open Font License 1.1** 이다. 전문은 [assets/fonts/OFL.txt](assets/fonts/OFL.txt).
포켓몬 권리는 Nintendo · Game Freak · Creatures Inc. 에 있으며, 개인 · 비상업 팬 용도로만 쓴다.
