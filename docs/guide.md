# pokebuddy 설명서

이 문서는 설치, 명령, 설정, 동작 원리, 실측 근거를 모두 담는다. 요약은 [README](../README.md)에 있다.

## 게임 — 설정창과 CLI

동반자를 실행한 뒤 트레이 메뉴나 포켓몬 우클릭 메뉴에서 `설정창 열기`를 누른다.
설정창에는 파티·박스·도감·상점·가방 다섯 탭이 있다. 헤더에서 업적창과 설정을 연다.
화면 계약은 [S5 기능 계약](specs/game.md)을 따른다. 가격과 확률은 [밸런스 수치](specs/balance.md)를 따른다.

1. 첫 실행에서 첫 포켓몬을 고른다. 시작 포인트를 한 번 받는다.
2. 상점에서 알을 산다. 알은 박스 탭의 돌보미집에 들어간다. 준비가 끝나면 직접 연다.
3. 알을 열면 부화 결과 창이 태어난 개체와 들어간 자리를 보여 준다. 파티에 들어간 개체는 꺼낸 상태로 무대에 나온다.
4. 파티나 박스의 개체를 누르면 개체 상세가 열린다. 돌봄·진화·성격 변경·크기를 여기서 한다. 상세 왼쪽 위의 돌아가기 링크(`‹ 파티로`·`‹ 박스로` 등)는 상세를 연 탭으로 돌아간다.
5. 코스모그처럼 공유 계열인 개체는 박스 칸에 모습들이 2×2 로 보인다. 칸에 마우스를 올리면 툴팁에서 모습을 바꾼다.

CLI 에서도 같은 명령을 보낸다. 아래 명령은 PowerShell 과 일반 셸에서 쓸 수 있다.
`p1` 은 예시 ID 다. 실제 ID 는 `snapshot` 의 `party` 와 `boxes` 에서 확인한다.
상점 구매는 대상 자리에 상품 ID 를 쓴다. 알은 `random`·`ancient-stone`·`legendary` 등, 파티 칸은 `party-slot`, 종은 종 이름, 도구는 도구 ID 다.

```text
pokebuddy game snapshot
pokebuddy game shop.buy random
pokebuddy game shop.buy party-slot
pokebuddy game shop.buy snorlax
pokebuddy game shop.buy rare-candy
pokebuddy game evolve p1 to=umbreon
pokebuddy game pet.form p1 species=lunala
pokebuddy game pet.set p1 size=3
pokebuddy game feed p1
pokebuddy game party.show p1
pokebuddy game --help
```

이 명령을 쓰려면 동반자가 떠 있어야 한다. 동반자가 게임 저장을 쓴다.
`pet.set size=3` 은 마리별 크기 단계(1~5)를 바꾼다. 새 포켓몬의 기본 크기는 단계 2다. 설정창 개체 상세의 크기 단추도 같은 명령이다.
`pet.form` 은 공유 계열 개체만 받는다. 고를 수 있는 모습이 아니면 `bad-form` 을 돌려준다.
가방 사용·알 열기·파티 배치는 설정창에서 한다. CLI 는 `--help` 에 나오는 명령만 받는다.

친구 교환 링크를 받았으면 `pokebuddy trade <교환 링크>` 로 참가한다. 이 명령은 떠 있는 동반자에 링크를 보낸다.

## 기본 사용

pokebuddy는 화면 위에 떠 있는 포켓몬 동반자다. 테두리 없는 투명 창이다. 항상 다른 창 위에 보인다.
macOS · Windows 에서 동작한다.

```
pokebuddy setup             # 처음 한 번 — CLI LLM 상태 훅 설치
pokebuddy companion         # 동반자 띄우기 — 첫 실행이면 선택창을 열고, 이후 저장된 파티를 복원한다
pokebuddy companion stop    # 동반자 내리기
```

동반자는 놀이공간 안을 가끔 돌아다니고 두리번거린다. 입력이 5분 동안 없으면 잠든다.
집어 들면 아파한다. 콕 찌르면 반응한다 — [buddy](#buddy--돌아다니고-졸고-반응하기).
맨 앞 창이 터미널이면 동반자는 그 터미널 앱에서 띄운 CLI LLM(Claude Code · Codex CLI · Gemini CLI)의 상태를 따른다(작업 중 걷기 · 승인 대기 두리번 · 실패하면 쓰러짐 …) —
[CLI LLM 상태 연동](#cli-llm-상태-연동).

포켓몬 이미지는 이 저장소에 없다. 실행할 때 한 번 내려받아 캐시한다.

그림은 [PMDCollab/SpriteCollab](https://sprites.pmdcollab.org) 한 가지뿐이다. 종마다 동작이 10~40종 있어서 상태별 동작과 buddy 동작에 쓸 수 있다. 도트가 작고 각지다.
PMD 를 못 받은 종은 무대에 나오지 않는다. 그 이유는 `~/.claude/pokebuddy/last-error.json` 에 남는다(`pokebuddy status` 의 "마지막 실패" 줄).
포켓몬 권리는 Nintendo / Game Freak / Creatures Inc. 에 있다. 이 앱은 개인 용도와 비상업 팬 용도로만 쓴다.
PMD 스프라이트는 **CC BY-NC 4.0** 이다 — [라이선스](#라이선스) 참고.

## 요구사항

- Node.js 22.12 이상 — Electron 44 설치기가 요구한다. 이보다 버전이 낮으면 설치는 끝나도 동반자가 뜨지 않는다. Windows 실행 파일은 Node.js 가 필요 없다
- macOS(Apple Silicon·Intel) 또는 Windows
- 상태 연동을 쓰려면 Claude Code, Codex CLI 0.124 이상, Gemini CLI 0.26 이상 중 하나가 있어야 한다

## 설치

두 가지 판이 있다. 두 판은 같은 저장 폴더(`~/.claude/pokebuddy`)를 쓴다. 파티와 포인트가 같다.

### Windows 실행 파일

`pokebuddy-Setup-<버전>.exe` 를 실행한다. Node.js 는 필요 없다.

- 묻지 않고 바로 설치한다(원클릭). 설치 위치는 `%LOCALAPPDATA%\Programs\pokebuddy` 다. 관리자 권한이 필요 없다.
- 설치가 끝나면 동반자로 뜬다. 처음이면 첫 포켓몬 선택 창이 뜬다.
- 시작 메뉴와 바탕화면에 바로가기를 만든다.
- 떠 있을 때 바로가기를 다시 누르면 설정창을 연다.
- 설정의 "로그인 시 시작"을 켜면 Windows 에 로그인할 때 함께 뜬다.
- 코드 서명이 없다. 처음 실행하면 SmartScreen 경고가 뜬다. "추가 정보 → 실행"을 누른다.
- 끝내기는 트레이 아이콘의 메뉴에서 한다. 제거는 Windows 설정의 앱 목록에서 한다. 제거해도 저장 폴더는 남는다.
- CLI 상태 연동(설정창 설정의 "연결")은 훅을 `node` 로 실행한다. 쓰려면 Node.js 가 있어야 한다.

### npm

```bash
npm install -g pokebuddy
pokebuddy setup
pokebuddy companion
```

(npm 에 게시하기 전에는 [배포](#배포-관리자용) 절에서 만든 `.tgz` 파일로 `npm install -g ./pokebuddy-<버전>.tgz`)

- `npm install` 이 Electron(약 100MB)까지 받는다. mac 창 추적 헬퍼는 패키지에 미리 빌드돼 있다(universal).
- `pokebuddy setup` 은 처음 한 번만 하면 된다. 하는 일은 다음과 같다:
  - Electron 확인 — 실행 파일이 없으면 받는다
  - 펫 데이터 폴더 `~/.claude/pokebuddy` 생성
  - 상태 훅 설치 — `~/.claude/scripts/hooks/pokebuddy-state.cjs` 를 복사한다. 쓰고 있는 CLI(설정 폴더가 있는 것)마다 등록한다.
    등록 위치는 다음과 같다 — Claude Code `~/.claude/settings.json`, Gemini CLI `~/.gemini/settings.json`, Codex CLI `~/.codex/hooks.json`.
    **바꾸기 전에 백업을 남긴다. 이미 있는 항목은 건드리지 않는다. 여러 번 실행해도 결과가 같다.**
    CLI 를 나중에 설치했으면 `pokebuddy setup` 을 다시 실행한다
  - 옛 에디터 확장 제거 — 예전 버전이 VS Code 계열 에디터에 설치한 확장(`local.pokebuddy-active-terminal`, 옛 이름 `local.termimon-active-terminal` · `local.pkmon-active-terminal`)이 있으면 지운다. setup 은 에디터 CLI 를 PATH 나 앱 안에서 찾는다. 열려 있는 에디터 창은 다시 불러와야 적용된다
  - 옛 확장 기록 제거 — `~/.claude/pokebuddy/cli.json` 과 `~/.claude/pokebuddy/windows/` 가 남아 있으면 지운다
- 무엇을 바꿀지 먼저 보려면 `pokebuddy setup --dry-run` 을 쓴다. 에디터를 건드리지 않으려면 `--no-editor` 를 쓴다.

지우기:

```bash
pokebuddy uninstall            # 훅 등록·훅 파일·옛 에디터 확장과 그 기록 제거 (설정·저장·그림 캐시는 남김)
pokebuddy uninstall --purge    # ~/.claude/pokebuddy 까지
npm uninstall -g pokebuddy
```

### 옛 이름에서 옮겨 오기

이전 이름은 `termimon`이었다. 그 전 이름은 `pkmon`(패키지 이름 `terminal-pkmon`)이었다.
npm 에 있는 `termimon` 패키지는 이름만 같은 다른 프로젝트(터미널 몬스터 배틀 게임)다. 그래서 이 프로젝트의 이름을 `pokebuddy` 로 바꿨다.
새로 설치하고 `pokebuddy setup` 을 한 번 실행하면 두 이름의 흔적을 함께 정리한다.

| 옛 흔적 | setup 이 하는 일 |
|---|---|
| 데이터 폴더 `~/.claude/termimon` · `~/.claude/pkmon` | 설정(`config.json`)과 그림 캐시(`pmd/`)를 `~/.claude/pokebuddy` 로 가져온다. 그 뒤 옛 폴더를 지운다. 둘 다 있으면 항목마다 `termimon` 쪽을 먼저 쓴다. 새 폴더에 없는 것이 있으면 남긴다 |
| 훅 등록 `termimon-state.cjs` · `pkmon-state.cjs` | CLI 마다 옛 등록을 걷는다. `pokebuddy-state.cjs` 로 다시 등록한다. 같은 묶음의 다른 훅은 남긴다 |
| 훅 파일 `~/.claude/scripts/hooks/` 의 위 두 파일 | 옛 등록을 다 걷었을 때만 지운다 |
| 에디터 확장 `local.termimon-active-terminal` · `local.pkmon-active-terminal` | 설치돼 있으면 제거한다. 열려 있는 창을 다시 불러오면 옛 확장이 멈춘다 |

- 데이터 폴더는 `setup` 전에 아무 `pokebuddy` 명령을 실행해도 먼저 가져온다. 옛 폴더를 지우는 것은 `setup` 만 한다
- 떠 있는 옛 펫이 있으면 Windows 에서 옛 폴더 일부(`electron/`)가 지워지지 않는다. 옛 펫을 내린 뒤 `setup` 을 다시 실행한다
- 환경변수는 `POKEBUDDY_*` 다. 옛 이름(`TERMIMON_*` · `PKMON_*`)은 읽지 않는다
- 옛 명령은 따로 지운다. `.tgz` 로 설치한 `termimon` 은 `npm uninstall -g termimon` 으로 지운다. `pkmon` 은 `npm uninstall -g terminal-pkmon` 으로 지운다.
  git clone 이면 PATH 설정의 `shell/termimon.zsh` · `shell/pkmon.zsh` 를 `shell/pokebuddy.zsh` 로 고친다

### 저장소에서 바로 쓰기 (개발용)

```bash
git clone https://github.com/MilkLotion/pokebuddy.git
cd pokebuddy
npm install              # TypeScript 빌드(prepare → npm run build)까지 한다. mac 은 Swift 컴파일러가 있으면 헬퍼를 이 컴퓨터용으로 빌드한다
bin/pokebuddy setup      # Windows cmd 는 bin\pokebuddy.cmd setup
npm start                # 빌드한 뒤 동반자를 띄운다
```

앱은 빌드 산출물 `dist/` 를 부른다. Electron 은 `dist/main/app.js`(`package.json` 의 `main`)를 연다. 명령(`cli/*.js`)은 `dist/follow/*.js` 를 부른다.
`dist/` 는 저장소에 없다. `npm install` 을 건너뛰었거나 `src/` 를 고쳤으면 `npm run build` 를 먼저 한다.
빌드 전에 `companion` · `status` · `game` · `trade` 를 치면 `bin/pokebuddy` 가 그렇게 안내하고 멈춘다.
`npm start` 로 띄운 앱도 동반자다. 이 앱은 `companion.lock` 을 스스로 만든다. 그래서 `pokebuddy companion stop` 으로 내릴 수 있다.

터미널에서 `pokebuddy` 로 부르려면 `bin/` 을 PATH 에 올린다.

- mac — `~/.zshrc` 에 `source <클론한 경로>/shell/pokebuddy.zsh`
- Windows — Git Bash 용으로는 `~/.bashrc` 에 `export PATH="<클론한 경로>/bin:$PATH"` 를 추가한다(`C:\…` 대신 `/c/…` 로 적는다).
  PowerShell 용으로는 사용자 환경 변수 `Path` 에 `<클론한 경로>\bin` 을 더한다 (`bin/pokebuddy.ps1` · `bin/pokebuddy.cmd` 가 받는다)
- PATH 없이 저장소 폴더에서는 `node bin/pokebuddy companion` 으로도 된다

## 사용

```
pokebuddy companion [buddy=on|calm|off] [click=on|off]
pokebuddy companion stop
pokebuddy setup [--dry-run] [--no-editor]
pokebuddy uninstall [--dry-run] [--purge] [--no-editor]
pokebuddy status [포켓몬]
pokebuddy game …
pokebuddy trade <교환 링크>
```

| 명령 | 결과 |
|---|---|
| `pokebuddy companion` | 동반자를 띄운다. 이미 떠 있으면 그 pid 를 알리고 끝난다. 첫 실행이면 첫 포켓몬 선택 창을 연다. 선택 창을 닫으면 시작하지 않는다 |
| `pokebuddy companion stop` | `companion.lock` 을 지운다. 동반자는 그것을 보고 스스로 끝난다 |
| `pokebuddy status [포켓몬]` | 지금 판정 상태를 보여 준다 — [문제 확인](#문제-확인) |
| `pokebuddy` (인자 없음) · `--help` | 사용법을 보여 준다 |
| `pokebuddy <모르는 단어>` | `알 수 없는 명령: … — 펫은 동반자 하나다. 띄우기: pokebuddy companion` 을 출력한다. 종료 코드는 2다 |

`pokebuddy companion` 은 동반자 창이 뜰 때까지 기다린다. 그 뒤 `동반자를 띄움: <이름>` 한 줄을 남기고 돌아온다.
처음 받는 포켓몬은 그림을 내려받느라 몇 초 걸린다.
그림을 못 받는 등 뜨지 못하면 그 자리에서 이유를 알려 준다.
동반자는 포켓몬 이름을 받지 않는다. 포켓몬은 첫 실행 선택창과 설정창에서 고른다.

Windows PowerShell 에서 `pokebuddy` 가 "이 시스템에서 스크립트를 실행할 수 없으므로" 로 막히면
npm 이 만든 `pokebuddy.ps1` 이 실행 정책에 걸린 것이다. `pokebuddy.cmd companion` 처럼 부르면 된다.
또는 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 로 풀면 된다.

### 옵션

| 옵션 | 값 | 뜻 |
|---|---|---|
| `buddy=` | `on`(기본) · `calm` · `off` | 돌아다니기·졸기·만지기 반응 |
| `click=` | `on` · `off` | 포켓몬 위 클릭을 아래 창으로 통과 |

`이름=값` 과 `--이름 값` 둘 다 받는다. `on`/`off` 자리에는 `true`/`false`, `1`/`0`, `yes`/`no` 도 쓸 수 있다.
**이번 실행에만 적용되고 설정 파일에는 저장되지 않는다.**
포켓몬 크기는 저장(`save.json`)의 마리별 크기를 쓴다. 옛 옵션 `dot=` · `keep=` 을 주면 `세션 펫 옵션은 없어졌다` 는 안내와 함께 멈춘다.

환경변수로도 같은 값을 줄 수 있다.

| 환경변수 | 대응 |
|---|---|
| `POKEBUDDY_BUDDY` | `buddy=` |
| `POKEBUDDY_CLICK_THROUGH` | `click=` |
| `POKEBUDDY_LANG` | 화면 문구 언어 (`ko` · `en`) |
| `POKEBUDDY_DEBUG=1` | 판정 로그를 `~/.claude/pokebuddy/debug-companion.log` 에 남긴다 |
| `POKEBUDDY_SLUG` | 개발 실행(`npm start`)의 첫 스타터. `pokebuddy companion` 은 이 값을 넘기지 않는다 |

- 포켓몬을 드래그해 원하는 자리에 놓으면 위치가 기억된다. 마리마다 따로 기억한다(`save.json` 의 마리 `home`, 놀이공간 오른쪽 아래 기준 오프셋). buddy 는 거기를 집으로 삼는다.
- 한 무대의 여러 마리는 겹칠 수 있다. 나중에 소환한 마리가 앞에 보인다.

### 포켓몬 이름

`pokebuddy status <포켓몬>` 과 `pokebuddy game` 의 종 자리는 PokeAPI 의 종 식별자(`pokemon_species.csv` 의 `identifier`)를 쓴다. 전국도감 1025종 전부와 고른 폼 85개다.
도감표 `lib/dex.json` 은 `npm run data:build` 의 `build-dex` 가 PokeAPI CSV 로 만든다. PMD 는 같은 이름을 도감 번호로 바꿔 받는다.
옛 codex-pokepets 폴더명의 `-3d` 이름도 받는다. `gengar` 와 `gengar-3d` 는 같은 그림이다.

| 입력 | 결과 |
|---|---|
| `pikachu` · `Pikachu` | 대문자로 적어도 소문자로 맞춘다 |
| `gengar` · `gengar-3d` | 같은 그림 — `-3d` 는 옛 codex-pokepets 이름의 그림체 구분이라 떼고 본다 |
| `rotom-wash` · `deoxys-attack` · `unown-z` | 폼은 PokeAPI 표기 |

메가·거다이맥스 폼은 없다(`charizard-mega-x` 같은 이름은 실패한다). 없는 이름을 넣으면 비슷한 이름을 알려 준다.

## 설정

게임 설정(놀이공간·로그인 시 시작·알림 소리 등)은 설정창의 설정에서 바꾼다. 이 값은 저장(`save.json`)에 있다.
그 밖의 시작 값은 **`~/.claude/pokebuddy/config.json` 한 파일**에 둔다. 앱은 이 파일에 쓰지 않는다. 바꾸려면 사용자가 직접 만든다.
설정을 프로그램 폴더가 아니라 홈 폴더에 두는 이유가 있다. npm 으로 업데이트해도 설정이 지워지지 않아야 하기 때문이다.
(예전 버전이 프로그램 폴더에 두던 `pkmon.config.json` 은 처음 실행할 때 이리로 복사해 온다. 형식은 저장소의 `pokebuddy.config.example.json` 을 참고한다)
기본값과 경로는 전부 `config.js` 한 곳에 있다. 앱(`src/main/` — `paths.ts` 가 감싸 쓴다)과 명령(`cli/`)이 모두 그것을 참고한다.

| 항목 | 기본 | 설명 |
|---|---|---|
| `slug` | `pikachu` | 이름을 모를 때 쓰는 종 슬러그 |
| `buddy` | `on` | `on` · `calm`(덜 돌아다님) · `off`(제자리) |
| `clickThrough` | `false` | `true` 면 고스트 모드를 켠 채 시작한다. 포켓몬 위를 클릭해도 아래 창이 눌린다. 대신 드래그로 못 옮긴다 |
| `lang` | `ko` | 화면 문구 언어 — `ko` · `en` |

위 네 키 밖의 키(옛 `dotSize` · `keepVisible` · `windows` 등)는 읽을 때 버린다.
트레이나 설정창에서 고스트 모드를 바꾸면 이번 실행에만 적용된다. `config.json` 에는 쓰지 않는다.
한 번만 다르게 쓰려면 위의 [옵션](#옵션)이나 환경변수를 쓴다. 둘 다 파일에는 저장되지 않는다.

## 동반자

동반자는 기기당 하나다. **항상 위**에 뜬다. 어느 터미널을 보든 그 창에서 도는 CLI LLM 의 상태를 따른다.
포켓몬은 놀이공간 안에서만 움직인다. 놀이공간은 설정창 설정에서 `화면 전체` 나 `영역 지정` 으로 고른다.
`화면 전체` 는 주 모니터의 작업 영역이다. `영역 지정` 은 드래그로 그린 사각형이다.
저장(`save.json`)의 파티 중 보이게 둔 마리(최대 6마리)를 [무대 창 하나](#화면-구조--무대-창-하나)에 함께 그린다.

### 무엇을 따르는가 — 매 폴링 다시 고른다

동반자는 0.4초마다 따를 창을 다시 고른다 (`src/follow/front.ts`, 폴링은 `src/main/anchor.ts`). 포커스 변화에도 이 폴링으로 반응한다.

1. 창 추적 헬퍼가 창 목록과 **맨 앞 앱의 pid**(`frontPid`)를 준다. 이름(`frontmost`)만으로는 펫 자신(Electron)을 가를 수 없다. 그래서 pid 로 고른다. 펫 자신이면 맨 앞 창이 없는 것으로 친다. Windows 는 포그라운드 HWND(`frontId`)가 창 목록에 있으면 그 창을 쓴다
2. 그 창의 주인이 터미널 호스트인가 (`hostOf`)
   - **(a)** 훅 기록 중 조상(`ancestors`)에 창 주인 pid 가 든 것이 있으면 → 그 앱(VS Code · iTerm2 등)에서 CLI 를 띄운 적이 있다. 창 주인 pid 를 따른다
   - **(b)** 알려진 터미널 앱 이름(`KNOWN_TERMINAL_APPS`)이면 → 붙기만 한다. 상태는 대기(`idle`)다
   - 둘 다 아니면(브라우저 등) → 따르던 pid 를 그대로 둔다. 동반자는 마지막 상태를 유지한다
3. 따르는 pid 를 조상으로 가진 **최신** 훅 기록의 상태가 동반자 상태다 (`src/follow/state.ts` `stateFor`). 조상을 못 적은 기록은 거른다. 그렇지 않으면 아무 기록에나 맞아 남의 창 상태를 따르게 된다

같은 앱의 창이나 터미널 탭이 여럿이면 동반자는 창과 탭을 가르지 않는다. 그 앱에서 띄운 최신 CLI 세션을 따른다.
(a) 는 앱 이름을 몰라도 맞는다. (b) 의 앱 이름표는 대비책이다.
Windows 프로세스 표는 읽지 않는다. 조상 체인은 훅이 세션 시작 때 이미 적어 두었기 때문이다.

### 창 목록을 읽는 방법

- mac 은 `helpers/winbounds`(Swift, `npm install` 때 자동 빌드)가 창 목록을 읽는다.
  **접근성 권한은 필요 없다.**
- Windows 는 `helpers/winbounds.ps1` 이 `EnumWindows` 로 창을 열거한다.
  - 동반자 프로세스마다 PowerShell 을 **한 번 띄워 둔다.** 그 뒤 한 줄씩 묻는다(`-Serve`, `src/follow/line-helper.ts`). 폴링마다 새로 띄우면 기동과 C# 컴파일에
    수백 ms~수 초가 걸린다. 띄워 두면 한 번에 1ms 안쪽이다
  - 잠든 UWP 앱·다른 가상 데스크톱의 창(cloaked)은 뺀다
  - 헬퍼 좌표는 물리 픽셀이다. 그래서 Electron 좌표(DIP)로 바꿔 쓴다
- 헬퍼가 연속 3번 응답하지 않으면 `창 추적 헬퍼가 응답하지 않음` 을 알린다. 동반자는 숨지 않는다. 헬퍼가 응답하지 않는 동안 따를 창을 다시 고르지 못한다.

> `moveTop()` 은 쓰면 안 된다. dock 을 숨긴 백그라운드 앱에서는 창을 활성 앱 **아래로**
> 밀어넣는다. 실측으로 재현했다.

### 수명과 충돌

- 동반자는 기기당 하나만 뜬다. Electron 단일 인스턴스 잠금과 `~/.claude/pokebuddy/companion.lock`(`pid` 한 줄, 창을 만들면 `ready`)로 막는다.
- CLI 는 파일 존재가 아니라 안에 적힌 pid 의 생존으로 "떠 있나"를 판정한다. 크래시가 남긴 lock 에 막히지 않기 위해서다.
- 동반자는 1초마다, 그리고 폴더 감시로 lock 파일을 확인한다. `pokebuddy companion stop` 이 이 파일을 지우면 동반자는 스스로 끝난다.
- 트레이 메뉴나 우클릭 메뉴의 `종료` 로도 끝난다.
- 집(자리)은 마리마다 기억한다. 집은 `save.json` 의 마리 `home`(놀이공간 오른쪽 아래 기준 오프셋 `{dx, dy}`)에 있다.

### 게임 — 친밀도와 기분

육성 규칙은 [설계의 성격과 육성](design.md#성격과-육성)에 있다. 계산값은 [상태 규칙](../src/state/rules.ts)에 있다.

친밀도는 감소하지 않는다. 기분과 배고픔은 변한다.
토큰을 읽을 수 있으면 토큰 사용량을 적립에 사용한다. 토큰을 읽지 못하면 작업 시간을 사용한다.
돌봄의 효과와 대기 시간은 상태 규칙을 따른다. 하루 첫 교감 보상도 상태 규칙에서 확인한다.

처음 실행하면 스타터를 선택한다. 저장된 파티가 있으면 파티를 복원한다.
포켓몬은 종·성격·크기·표시·집 위치를 저장한다. 저장 계약은 [공유 타입](../src/shared/types.ts)을 따른다.
저장 복구 절차는 [저장 모듈](../src/save/store.ts)을 따른다. 저장 손실이 한 가지 원인으로만 발생한다고 단정하지 않는다.

진화 조건은 [S5 기능 계약](specs/game.md)의 진화 계약에 있다. 조작은 [게임 — 설정창과 CLI](#게임--설정창과-cli)를 참고한다.

### 트레이와 우클릭 메뉴

- 동반자는 트레이 아이콘을 하나 둔다. 파티 첫 마리의 서 있는 그림 첫 프레임을 잘라 쓴다(그림이 없으면 흰 네모). 툴팁은 `pokebuddy · <이름>` 이다.
- 트레이 메뉴 구성은 다음과 같다 — 설정창 열기, 잠시 숨기기/다시 보이기, 고스트 모드(켜져 있으면 오른쪽에 `켜짐`), 종료. 왼쪽·오른쪽 클릭 모두 메뉴가 열린다.
- 메뉴는 OS 기본 메뉴가 아니라 앱이 그린다(`src/main/menu-window.ts`). 방향키·Enter·Esc 로 조작하고 바깥을 누르면 닫힌다.
- 마리마다 우클릭 메뉴가 있다. 트레이와 같은 앱이 그리는 메뉴다. 그림 위에서만 열린다.
- 우클릭 메뉴 구성은 다음과 같다 — `이름 · 성격` 과 그 아래 상태(누를 수 없는 두 줄), 밥 주기·놀아주기(못 하면 흐리게, 이유나 남은 시간을 오른쪽에), 잠시 숨기기/다시 보이기, 설정창 열기, 종료.
- 숨기기·종료는 그 마리가 아니라 동반자 전체에 걸린다. 끝내기 메뉴 항목은 "종료" 라고 쓴다. 이름은 종의 화면 이름을 쓴다.
- 고스트 모드는 우클릭 메뉴에 없다. 켜면 우클릭이 안 되어 끌 수 없기 때문이다. 트레이와 설정창 설정의 `고스트 모드` 에서 끈다. 설정창 설정에는 `포켓몬 표시` 도 있다.
- 고스트 모드 토글은 이번 실행에만 적용된다. `config.json` 에 쓰지 않는다.

### 언어와 이름

- 화면 문구는 `lib/i18n/<언어>.json` 에서 키로 가져온다 (`lib/i18n.js t()`, 메인은 `src/main/text.ts` 로 감싸 쓴다). 기본 언어는 한국어(`ko`)다. 영어(`en`)도 있다. 언어 우선순위는 `POKEBUDDY_LANG` → `config.json` 의 `lang` → `ko` 순이다. 없는 키는 한국어로 대체된다. 한국어도 없으면 키 이름을 그대로 보여준다. 그래서 화면이 비지 않는다
- 코어(명령 처리 `src/commands/`, `src/state/`)는 문구가 아니라 코드(`reason` · `nextAt`)를 돌려준다. 문구는 UI 가 만든다. 언어를 더할 때 코어를 건드리지 않기 위해서다
- 성격 이름은 `data/natures.json` 의 `name`(한국어·영어)에 있다. 언어 파일에 따로 두지 않는다
- 포켓몬 이름은 `lib/names.json` 에 있다. 슬러그(eevee · rotom-wash)를 `{ ko, en }` 로 매핑한다. `npm run data:build`(`dist/tools/build-names.js`, 원본 `src/tools/build-names.ts`) 가 PokeAPI 의 CSV(종 이름표 + 폼 이름표)에서 한 번 뽑아 동봉한다. 폼 슬러그는 폼 이름표를 따른다(워시로토무 · Wash Rotom). `-3d` 는 같은 종으로 본다. 표에 없는 이름은 슬러그 그대로 쓴다
- CLI 의 안내문은 아직 한국어 그대로다

### 제약

- Windows Git Bash 탭에서는 훅의 조상 체인이 `sh.exe` 에서 끊긴다. 그래서 체인이 터미널 앱에 닿지 않는다. 앱이 `KNOWN_TERMINAL_APPS` 에 있으면 동반자는 대기 상태로 본다. [스펙 미확정]
- 원격 창(SSH·WSL·컨테이너)은 pid 를 대조할 수 없다. 그래서 대기 상태로 본다
- Windows 에서 포커스를 받지 않는 창의 우클릭 메뉴가 바로 닫힐 수 있다. 그러면 트레이를 쓴다. [확인 필요]
- 확인은 `pokebuddy status` 의 "지금 화면 맨 앞 창" 줄과 "동반자" 줄에서 한다. 판정 로그는 `POKEBUDDY_DEBUG=1 pokebuddy companion` 으로 본다(`front` · `host` · `pids` 가 찍힌다)

## CLI LLM 상태 연동

`pokebuddy setup` 이 쓰고 있는 CLI 마다 훅을 등록한다. 동반자는 맨 앞 터미널 앱에서 띄운 CLI 의 훅 상태에 따라 동작을 바꾼다.
훅 기록이 없으면 상태별 동작 없이 기본 동작(buddy)만 돈다.
훅 스크립트는 `src/hooks/pokebuddy-state.ts` 하나다(빌드 → `dist/hooks/pokebuddy-state.js`, 설치 이름은 `pokebuddy-state.cjs`). CLI 마다 이벤트 이름만 다르다.

| 동반자 상태 | Claude Code | Codex CLI (0.124+) | Gemini CLI (0.26+) | PMD 동작 (앞에서부터 가진 것) |
|---|---|---|---|---|
| `waving` (6초·4초) → 대기 | `SessionStart` · `Stop` | `SessionStart` · `Stop` | `SessionStart` · `AfterAgent` | `Pose`(2초 되풀이) · `Charge` · `Nod` |
| `running` | `UserPromptSubmit` · `PreToolUse` · `PostToolUse` · `PostToolUseFailure`(셸 명령의 0 아닌 종료 코드) | `UserPromptSubmit` · `PreToolUse` · `PostToolUse` | `BeforeAgent` · `AfterTool` | buddy 의 [작업 모드](#buddy--돌아다니고-졸고-반응하기). `buddy=off` 면 `Walk`(옆모습) · `Hop` |
| `waiting` | `PermissionRequest` · `PreToolUse`(`AskUserQuestion` · `ExitPlanMode`) | `PermissionRequest` | `Notification`(`ToolPermission`) | `Rotate` · `LookUp` · `Nod` |
| `failed` (6~10초) | `PostToolUseFailure`(그 밖) · `StopFailure` | `PostToolUse`(종료 코드·오류 표시가 있을 때) | `AfterTool`(`tool_response.error`) | `Faint`(쓰러진 채) · `Trip` · `Cringe` · `Hurt` |
| `idle` | 그 밖 · `PostToolUseFailure`(`is_interrupt` — Esc) | `Interrupt` · `SessionEnd` | `SessionEnd` | `Idle` |

동작이 적은 포켓몬은 조용히 다음 후보로 내려간다. 끝까지 없으면 `Idle` 을 쓴다.

Claude Code 의 도구 실패(`PostToolUseFailure`)는 입력의 `error` · `is_interrupt` 로 가른다(실측).

- 셸 명령(Bash · PowerShell)이 0 아닌 코드로 끝나면 `error` 가 `Exit code N` 으로 시작한다. 검사 명령(`test` · `diff` 등)의
  흔한 결과다. 그래서 작업이 이어지는 것으로 본다. 실패로 치면 한 턴에 몇 번씩 쓰러진다. 그러면 진짜 실패가 묻힌다(최근 대화 74턴 중 53턴에 한 번 이상).
  grep 이 못 찾은 것(종료 코드 1)은 claude 가 실패로 알리지도 않는다
- `is_interrupt` 는 Esc 로 도구를 멈춘 것이다. 턴이 끝났는데 `Stop` 이 오지 않으므로 대기로 돌린다.
  도구가 돌지 않을 때(응답을 쓰는 중) Esc 를 누르면 알리는 이벤트가 없다. 그래서 작업 중 상태가 10분 뒤에야 대기로 풀린다
- 승인한 도구가 끝나면 `PostToolUse` 가 작업 중으로 되돌린다. 없으면 긴 명령이 도는 내내 기다리는 것처럼 보인다

CLI 마다 다른 점:

| CLI | 등록 위치 | 알아 둘 것 |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | `async` 훅이라 claude 를 기다리게 하지 않는다 |
| Codex CLI | `~/.codex/hooks.json` | 훅은 0.124 부터 지원한다. 0.129 이상은 새 훅을 codex 의 `/hooks` 에서 **한 번 승인해야 돈다**. 0.148 전에는 `async` 훅을 건너뛰어 동기로 등록한다 |
| Gemini CLI | `~/.gemini/settings.json` | 훅을 모두 기다린다(`async` 없음). Windows 에서 훅 한 번에 약 0.2초 걸린다(PowerShell 기동 포함 실측). 그래서 프롬프트·도구 한 번마다 그만큼 늦어진다. 도구 전·모델 호출 이벤트는 등록하지 않는다. `hooksConfig.enabled` 가 `false` 면 꺼진다 |

codex 의 API 오류로 끝난 턴과 gemini 의 API 오류는 따로 알리는 이벤트가 없다. 그래서 `failed` 로 보이지 않는다.

훅은 세션마다 `~/.claude/pokebuddy/state/<세션>.json` 에 상태를 남긴다. 자기를 띄운 프로세스 조상
(훅 → CLI → 터미널 셸 → 터미널 앱)도 함께 적는다. 동반자는 **맨 앞 창 주인이 조상에 있는 기록**만 따른다.
그래서 다른 터미널 앱에서 띄운 CLI 의 상태는 섞이지 않는다. 같은 앱 안의 여러 CLI 는 최신 기록을 따른다.
Windows 는 조상을 구하는 데 PowerShell 을 띄워야 한다(수백 ms). 그래서 세션 시작 때 한 번만 구한다. 이후 이벤트는 그 기록을 이어 쓴다.
훅은 아무것도 출력하지 않는다. claude 는 일부 훅의 출력을 대화에 넣는다. gemini 는 출력을 훅 결과로 읽는다.

훅은 마지막 프롬프트 시각(`promptAt`)도 이어서 적는다. buddy 가 "사용자가 마지막으로 뭔가 한 때"를
알아야 잠들 수 있어서다. 업데이트한 뒤에는 `pokebuddy setup` 을 다시 실행하면 훅 파일이 새 버전으로 바뀐다.

### 상태에 따라 동작이 달라지는 방식

- 상태마다 **다른 PMD 동작 시트**를 재생한다(상태 → 동작 후보는 `art/pmd.js`, 재생은 `src/renderer/sprites.ts`). 프레임마다 길이가 다른 원본 타이밍(AnimData.xml)을 그대로 쓴다.
  한 번만 보여 줄 동작(`Pose`)은 2초가 될 때까지 되풀이한 뒤 대기로 돌아간다(인사 한 번이 0.4초라 한 번만 틀면 못 본다).
  쓰러짐(`Faint`)은 마지막 자세로 멈춰 있다. 작업 중(`running`)은 buddy 가 동작을 고른다.
- 무대의 상태는 파티 전원이 같다. 모든 마리가 같은 CLI 상태를 따른다.

## buddy — 돌아다니고, 졸고, 반응하기

기본으로 켜진다(마리마다 따로 돈다). 상태 표시기가 아니라 옆에 있는 친구처럼 보이게 하는 게 목적이다.
**훅 기록이 있든 없든 똑같이 돈다.** 따르는 CLI 상태가 없으면 늘 한가한(`idle`) 것으로 본다.

두 모드로 움직인다. **작업 동작은 한가할 때 쓰지 않는다.** 보기만 해도 CLI 가 일하는 중인지 갈리게 하려는 것이다.

| | 한가 (`idle` · 훅 기록 없음) | 작업 (CLI `running`) |
|---|---|---|
| 리듬 | 3~7초 걷고, 걸어온 쪽을 잠깐 돌아본 뒤 7~20초 쉰다 | 0.5~1.8초만 숨을 고르고, 걷기와 작업 동작을 이어 간다 |
| 걷기 | 속도 0.6~1.0배. 셋 중 한 번쯤은 서지 않고 방향을 튼다 | 속도 1.3~1.8배, 1.5~4초. 묶음마다 55% 확률로 먼저 걸어간다 |
| 제자리 동작 | 쉬는 동안 0~3번 — `LookUp` · `Rotate` · `Nod` · `Sit` · `DeepBreath` · 두리번 | 한 묶음에 1~3개 — 공격(`Attack` · `Strike` · `Swing` · `Shoot` · `Hop` …)은 한 번 내지르고 0.3~0.8초 서 있고, 부드러운 동작(`Charge` · `Pull` · `Twirl` · `Appeal` …)은 1.2~2.6초 반복한다 |
| 잠 | 입력 270초 없으면 새로 움직이지 않고, 300초면 잔다(`Sleep`) | 자지 않는다. 자고 있었으면 깨서 곧바로 움직인다 |

| 언제 | 무엇을 |
|---|---|
| 한가 → 작업 | 쉬던 것 · 둘러보던 것을 접고 곧바로 작업 동작을 한다. 걷던 중이면 도착한 뒤 이어 간다 |
| 작업 → 한가 | 작업 동작을 접고 쉰다 |
| 깨는 신호 | 맨 앞 창 변화(터미널 호스트가 앞일 때) · 포켓몬을 만짐 · (CLI 훅이 있으면) 프롬프트 전송 · 작업이 끝남 · CLI 가 일을 시작함 |
| 집어 들 때 | 아파한다(`Hurt`) → 끄는 방향을 보며 버둥거린다 |
| 내려놓을 때 | 폴짝(`Hop`) · 끄덕(`Nod`) · `Pose` 중 가진 첫 것. 놓은 자리가 새 집이 된다 |
| 콕 누를 때 | `Nod`·`Pose`·`Hop`·`LookUp` 중 하나 (자고 있었으면 먼저 깬다) |
| 만지기 반응의 `Hop` | 몸 칸에 들어가는 포켓몬만 쓴다. 작업 동작으로만 담긴 동작은 반응에 쓰지 않는다. 한가할 때 작업 동작이 보이지 않게 하기 위해서다 |
| 승인 대기 · 턴 끝 · 실패 | 알림이므로 걷던 자리에 멈춘다. 상태 동작에 맡긴다. 그 사이 만지면 짧게 반응하고 돌아간다 |

훅 기록이 없으면 타이핑을 알 방법이 없다. 입력으로 치는 것은 맨 앞 창 변화와 포켓몬을 만진 것뿐이다. 그래서 한 터미널에서 계속
치고 있어도 5분이 지나면 잠든다.

걸을 때마다 속도를 새로 뽑는다. 걷는 그림도 그 속도로 재생한다. 제자리 동작은 방향과 길이를 바꿔 가며 한다
(작업 동작은 공격이 보이게 옆모습까지). 시간·속도·동작은 모두 범위 안에서 무작위로 뽑는다. 그래서 규칙적으로 보이지 않는다.
숨었다 다시 보일 때도 잠깐(한가 7초 · 작업 0.5초)은 가만히 있는다. 드래그로 놓은 자리는 집으로 기억된다. 다음에 띄울 때 거기서 시작한다.

작업 동작은 포켓몬마다 가진 것이 다르다. 예를 들어 피카츄는 `Attack` · `Swing` · `Shoot` · `Hop`(한 번) · `Charge` · `Pull`(반복)을 가진다.
썬더는 `Attack` · `Strike` · `Swing` · `Shoot` · `SpAttack` · `Hop`(한 번) · `Charge`(반복)을 가진다.
한가할 때 동작은 표본 50종 중 27종이 5개를 다 가졌다. 나머지 23종은 `Rotate` 와 두리번뿐이다.

PMD 공격 동작은 게임에서 한 번 쓰는 0.3초 안팎의 동작이다. 그래서 프레임이 17~33ms 다. 캐릭터가 칸 안에서 크게 움직인다.
그대로 반복하면 떨리거나 갈라져 보인다. 그래서 19종의 시트를 재서 동작마다 재생 방식을 정했다(`art/pmd.js` `WORK_PLAY`).
같은 이름의 동작은 종이 달라도 거의 같게 나왔다.

| 동작 | 실측 (50ms 이하 프레임 사이 중심 이동) | 처리 |
|---|---|---|
| `Attack` · `Strike` · `Swing` · `Hop` · `Shoot` | 15~22px · 11~16px · 12px · 0~17px — 내지르고 제자리로 온다 | 한 번 재생하고 서 있기 |
| `Charge` · `Pull` · `Twirl` · `Appeal` · `TailWhip` | 0~3px (`Charge` 19종 · `Pull` 11종 모두) | 반복 |
| `Double` | 33ms 마다 좌우 두 자리(37px)를 번갈아 그린다 — 19종 모두. 반복하면 두 마리로 보였다 | 쓰지 않는다 |
| `Shock` | 번개 효과로 그림 면적이 2.2배를 오간다 — 도트가 흩어져 보인다 | 쓰지 않는다 |
| `QuickStrike` | 한 프레임에 27~56px 순간이동 | 쓰지 않는다 |
| `LeapForth` | 앞으로 뛰쳐나간 자세로 끝난다(끝이 시작에서 16~25px) — 제자리로 돌아올 때 튄다 | 쓰지 않는다 |
| `Emit` | 2종 중 1종이 떤다(좌우로 5번 뒤집힘) | 쓰지 않는다 |

- `buddy=calm` — 쉬는 시간이 2.2배로 늘어난다(한가 15~44초 · 작업 1.1~4초). 한가할 때 제자리 동작 확률은 절반이 된다
- `buddy=off` — 마리가 집에 서서 상태 동작만 한다
- 포켓몬을 숨겼을 때는 돌아다니지 않는다. 자는 시계는 계속 간다
- 동작이 부족한 포켓몬은 없는 반응을 조용히 건너뛴다. `Walk` 가 없으면 산책하지 않는다(순간이동은 안 한다)
- **그림 칸은 몸보다 크다.** 공격 동작은 몸을 내밀어 칸이 크다(피카츄 `Idle` 40x56 · `Attack` 80x80 · `Swing` 80x96).
  상태 동작 칸의 2배까지 받는다. 표본 50종에서 `Attack` 40종 · `Swing` 31종이 들어온다. 칸 면적은 중앙값 2.7배다(최대 4배).
  1.5배로는 `Attack` 이 9종뿐이었다. 몸(작업 동작을 뺀 칸, 상태 동작의 1.25배까지)으로
  집·산책 범위·무대 안에 가두기·저장하는 자리·여러 마리 간격을 모두 계산한다. 큰 칸은 몸 칸 가운데에 맞춰 몸 밖으로 넘치게 그린다.
  칸이 커져도 포켓몬이 서는 자리는 같다. 무대는 놀이공간 크기다. 그래서 창 크기는 칸 크기와 무관하다
- **고스트 모드(`click=on`)를 켜면 그림 위 클릭도 아래로 간다.** 그래서 만지기 반응이 없다. 옮길 수도 없다
- 그림이 없는 곳의 클릭이 아래 창으로 가는 방식은 [화면 구조](#화면-구조--무대-창-하나)에 있다

판단은 `src/motion/brain.ts` 에 있다(창·Electron 을 모르는 순수 로직). 규칙표는 `src/motion/rules.ts` 에 있다.
마리 하나에 신호(상태·포커스·만짐)를 모으는 층은 `src/motion/pet-motion.ts` 에 있다. 무대 틱에 붙이는 층은 `src/main/stage.ts` 에 있다.
성격 배율(`src/motion/params.ts`)은 [성격 다섯 축](design.md)의 배율이다. 마리마다 성격에 따라 다르게 움직인다.
시험할 때는 `POKEBUDDY_BUDDY_TIMESCALE=0.05` 로 시간을 20배 빠르게 돌릴 수 있다(15초 만에 잠든다).

## 화면 구조 — 무대 창 하나

동반자 프로세스 하나는 **투명한 무대 창 하나**를 띄운다. 보일 마리를 전부 그 위의 캔버스 하나에 그린다.
마리마다 창을 두지 않는다. 여러 마리여도 창 추적·프로세스는 하나다.

- **무대의 마리** — 저장(`save.json`) 파티 중 보이게 둔 마리다. 슬롯 수까지, 최대 6마리다 (`src/save/rules.ts` 의 `slots.max`).
- **무대 = 놀이공간 ∩ 그 놀이공간이 있는 디스플레이.** 화면 밖 부분은 보이지도 않는다. GPU 만 먹는다. 그래서 잘라 낸다. 창은 `setBounds` 로만 옮긴다.
  사각형이 바뀔 때만 부른다. 400ms 폴링마다 부르면 mac 에서 깜빡일 수 있기 때문이다
- **자리는 메인이 정한다.** 마리 위치·집·들고 있는 마리 정보는 메인(`src/main/stage.ts`)에 있다. 40ms(25fps)마다 무대 프레임
  (마리별 id · 모습 · 배율 · 자리 · 동작)을 렌더러에 보낸다. 렌더러(`src/renderer/stage.ts`)는 받은 대로 그린다. 애니 프레임 진행만 스스로 한다.
  렌더러가 죽었다 다시 떠도 메인이 크기 · 시트 · 마지막 프레임을 다시 보내 복구된다
- **그림이 없는 곳의 클릭은 아래 창으로 통과한다.** 무대는 놀이공간만큼 크지만 마리 위만 클릭을 받는다. 커서가 무대 위에 있으면 메인이 40ms 마다
  렌더러에 커서 자리를 묻는다. 렌더러는 그 둘레 3px 안에 투명하지 않은 픽셀이 있는 마리의 id 를 답한다(위에 그려진 마리부터 — `src/renderer/hit.ts`).
  답이 `null` 이면 클릭을 아래 창으로 넘긴다. 통과 중에는 마우스 이벤트가 오지 않는다. 포켓몬이 걷거나 그림이 바뀌어 커서 밑이 달라져도
  이벤트는 생기지 않는다. 그래서 메인이 주기적으로 묻는다. 누르고 있거나 들고 있는 동안은 통과로 바꾸지 않는다. 그러지 않으면 떼기가 아래 창으로 가서 들린 채 남는다
- **드래그는 마리별이다.** 창은 그대로다. 그 마리만 무대 안에서 옮긴다(끄는 중에도 무대 안에 가둔다). 4px 이상 끌면 드래그다.
  0.5초 안에 눌렀다 떼면 클릭이다(콕 찌르기). 우클릭하면 그 마리의 메뉴가 열린다. 놓은 자리는 놀이공간 오른쪽 아래 기준 오프셋으로 그 마리의 집이 된다
- **겹침을 허용한다.** 시작할 때와 쉬는 동안 강제로 밀어내지 않는다.
- **그리는 순서는 소환 순서다.** 나중에 소환한 마리가 앞에 보인다. 드래그와 모습 변경은 순서를 바꾸지 않는다.
  숨긴 뒤 다시 소환하면 앞에 보인다. 앱을 다시 시작하면 저장된 파티 순서로 소환한다.
- Windows 는 `backgroundThrottling` 을 켜 둔다. 끄면 렌더러가 숨김 상태로 가지 않는다. 그러면 창을 숨길 때 내려간 입력용 자식 창
  (`Chrome_RenderWidgetHostHWND`)이 다시 보일 때 올라오지 않는다. 누르기가 부모 창에 떨어진다. 포커스를 받지 않는 창
  (`focusable: false`)이므로 Chromium 이 누르기를 버린다. 그래서 떼기만 온다. 이것이 숨겼다 다시 보이면 잡기·클릭이 안 되던 원인이다(최소 시험 창으로 재현).
  켜 두면 숨은 동안만 타이머가 초당 1회로 느려진다. 다시 보이면 곧바로 제 속도로 돈다

### 계약과 코드 자리

메인 · preload · 렌더러가 주고받는 모양은 선언 파일 `src/shared/stage.d.ts` 한 곳에 있다. 이 파일에는 채널 이름
(`stage:init` · `stage:sheets` · `stage:frame` · `stage:hover` · `stage:click-through` · `stage:cry` · `stage:coach` · `stage:coach-action` · `stage:ready` · `stage:hit` · `stage:pointer` · `stage:log`,
선택 창 `picker:list` · `picker:start` · `picker:portraits`)과 프레임 · 포인터 · 시트의 모양이 있다. 메인 빌드와 렌더러 빌드가 함께 읽어야 한다. 그래서 `.d.ts` 로 둔다
(`.ts` 면 렌더러 빌드가 rootDir 밖 소스라고 거부한다). preload 는 샌드박스다. 그래서 렌더러에 `window.pokebuddy` 다리만 내놓는다.

| 폴더 | 하는 일 |
|---|---|
| `src/main/` | 메인 프로세스 — `app.ts`(기동 · 종료 배선) · `anchor.ts`(창 추적 폴링) · `stage-window.ts`(무대 창 · 클릭 통과 · 항상 위) · `stage.ts`(마리 자리 · 25fps 틱 · 포인터) · `layout.ts`(자리 · 놀이공간 계산) · `save-party.ts`(저장 파티) · `art.ts`(PMD 그림) · `lifetime.ts`(`companion.lock` · 끝날 조건) · `commands.ts` · `menus.ts` · `menu-window.ts` · `tray.ts` · `picker-window.ts`(첫 실행 선택 창) · `manage-window.ts`(설정창) · `region-window.ts`(놀이공간 영역 그리기) · `paths.ts` · `text.ts` · `preload.ts` 등 |
| `src/follow/` | 어느 창 · 어느 세션을 따를지 — `state.ts`(훅 상태 기록 · 판정) · `front.ts`(맨 앞 창 · 터미널 호스트) · `winbounds.ts` · `line-helper.ts`(창 추적 헬퍼). `pokebuddy status` 가 같은 코드를 부른다 |
| `src/motion/` | 마리 하나의 움직임 — `brain.ts` · `pet-motion.ts` · `rules.ts` · `params.ts` |
| `src/renderer/` | 무대 `stage.html` · `stage.ts` · `sprites.ts` · `hit.ts` · `pointer.ts`, 선택 창 `picker.html` · `picker.ts`, 설정창 `manage.html` · `manage.ts`, 메뉴 `menu.html` · `menu.ts`, 놀이공간 영역 `region.html` · `region.ts` 등 |

- 빌드는 `npm run build` 로 한다. `tsconfig.json` 이 메인·CLI 가 부르는 모듈·도구를 `dist/` 로 만든다(CJS). `tsconfig.renderer.json` 이 화면 스크립트를
  `dist/renderer/` 로 만든다(ESM). HTML 은 빌드하지 않는다. `src/renderer/*.html` 에 그대로 둔다. 이 HTML 은 `../../dist/renderer/*.js` 를 부른다
- 무대·선택 창 문서에는 CSP 가 있다. 스크립트는 자기 파일에서만 부른다. 그림은 data URL 만 쓴다(`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:`)
- 창 아이콘은 다음과 같다 — Windows 는 `assets/logo/out/logo-256.png` 를 쓴다. mac 은 Dock 아이콘을 `logo-512.png` 로 정한다. 그 뒤 Dock 에서 숨긴다. 트레이 아이콘은 첫 마리 그림을 쓴다
- 자체 확인은 `npm run selftest` 로 한다. 검사 목록은 `package.json` 의 `selftest` 스크립트에 있다
- 형 검사만 하려면 `npm run check` 를 쓴다. 산출물을 만들지 않는다
- 동반자 흐름 검사는 `npm run test:e2e` 로 한다. 빌드한 뒤 `scripts/e2e-companion.cjs` 가 CLI → 선택 창 → 저장 → 종료·복원을 확인한다
- 실기 확인용 저장은 다음 명령으로 만든다 — `node dist/tools/dev-save.js <HOME> <종>[,<종>…] [--same-home]` 이 그 HOME 아래 `.claude/pokebuddy/save.json` 을 저장 v3 로 만든다.
  마리는 60px 씩 벌려 둔다. `--same-home` 이면 전부 기본 집이다(겹침 확인). 진짜 저장은 건드리지 않는다
- 시험 중 동반자를 끝낼 때는 프로세스를 죽이지 않는다. `~/.claude/pokebuddy/companion.lock` 을 지운다(`pokebuddy companion stop` 과 같다)

### 시험용 HOME 에서 실기 확인

튜토리얼처럼 한 번 끝나면 다시 안 뜨는 화면은 진짜 저장으로 다시 볼 수 없다. 시험용 HOME 에서 동반자를 따로 띄운다.
도구는 `src/tools/dev-test.ts` 다.

- 시험용 HOME 은 `POKEBUDDY_TEST_HOME` 이다. 없으면 `<임시 폴더>/pokebuddy-test-home` 이다.
- 저장·잠금·단일 실행 잠금이 모두 이 HOME 아래에 생긴다. 그래서 진짜 저장을 건드리지 않고, 쓰던 동반자와 나란히 뜬다.
- 저장소의 `electron .` 은 로그인 시 시작을 등록하지 않는다(`src/main/app.ts` `syncLoginItem`).
- 작업 트리의 미커밋 변경을 빼고 시험하려면 HEAD 를 `git worktree add --detach <폴더> HEAD` 로 따로 꺼낸다.
  그 폴더의 `node_modules` 는 저장소의 것을 링크(Windows 는 junction)하고, 그 폴더에서 `npm run build` 한 뒤 도구를 부른다.

```powershell
npm run build
node dist/tools/dev-test.js start --fresh      # HOME 을 비우고 첫 포켓몬 선택부터
node dist/tools/dev-test.js show               # 포인트·개체·알·튜토리얼 상태
node dist/tools/dev-test.js stop               # companion.lock 을 지워 스스로 저장하고 끝나게 한다
node dist/tools/dev-test.js scene hatch        # 앱이 꺼진 상태에서만 저장을 고친다
node dist/tools/dev-test.js start              # 고친 저장으로 다시 띄운다
```

장면은 쉼표로 이어 줄 수 있다(`scene done-all,rich`). 튜토리얼 장면은 그 튜토리얼 앞의 것을 완료로, 그 튜토리얼과 뒤의 것을 미시작으로 둔다.
첫 포켓몬이 없으면 `charmander` 로 시작 절차(`src/party/starter.ts` `begin`)를 밟는다.

| 장면 | 저장을 이렇게 고친다 |
|---|---|
| `tutorials` | 튜토리얼 기록만 비운다. 나머지 진행은 그대로 둔다 |
| `first-care` | 밥 주기·놀아주기 누계를 0 으로 둔다 |
| `shop` | 알과 알 번호를 비우고, 포인트를 1000 이상으로 둔다 |
| `hatch` | 준비된 랜덤알 하나를 넣는다 |
| `party` | 숨긴 채 파티 칸에 든 새 개체 하나를 넣는다. 랜덤알은 뺀다 |
| `achievement` | `show-two` 를 달성·미수령으로 두고, 받은 업적 기록을 지운다 |
| `playground` | 놀이공간을 화면 전체로 둔다 |
| `box` | 레벨·친밀도가 다른 개체 8마리를 박스에 넣는다(박스 정렬·끌기 확인) |
| `boxes` | 박스를 비우고 첫 박스 30칸을 채운 뒤 둘째 박스에 3마리를 넣는다(`◀`·`▶` 로 보내기·가득 참 확인) |
| `done-all` | 튜토리얼을 모두 완료로 둔다 |
| `rich` | 포인트를 10000 이상으로 둔다 |

- 앱이 떠 있으면 `scene` 은 저장을 고치지 않고 멈춘다. 앱이 메모리의 저장으로 파일을 덮어쓰기 때문이다.
- `stop` 이 10초 안에 끝내지 못하면 트레이에서 끝낸다. 프로세스를 죽이지 않는다.
- 확인이 끝나면 시험용 HOME 폴더를 지워도 된다.

## 그림에 대한 메모

실측해서 정한 동작들이라 근거를 남겨 둔다.

### 설정창의 초상

설정창과 첫 포켓몬 선택 창의 원형 초상은 [PokeAPI sprites](https://github.com/PokeAPI/sprites) 의 기본 그림(`sprites/pokemon/<도감>.png`, 96 × 96)이다. 이로치는 `sprites/pokemon/shiny/<도감>.png` 를 쓰고, 없으면 보통 그림을 쓴다. 저장소는 CC0 이고 그림 저작권은 The Pokémon Company 에 있다. 둘레 여백은 잘라 원을 채운다. 설치 파일에는 그림을 넣지 않는다. 저작권 때문에 공개 릴리스로 재배포하지 않는다. 동반자가 켜질 때 빠진 초상(보통·이로치)·도구·알 그림을 뒤에서 모두 받아 `~/.claude/pokebuddy/sprites/` 에 캐시한다. 첫 실행이면 첫 포켓몬을 고르는 동안 받는다. 약 2천 장, 2MB 이고 이 개발 PC 에서 15초 안팎이었다. 그림이 없는 도구(404)는 `missing.json` 에 적어 다시 묻지 않는다. 설정창은 열 때 디스크에 있는 그림을 한 번에 모두 읽은 뒤 첫 화면을 그린다. 그래서 상점·상세에 들어가면 그림이 바로 보인다. 저장소 실행은 `scripts/fetch-sprites.cjs` 가 받아 둔 `.cache/sprites/` 도 앱 안 그림으로 쓴다. 받지 못하면 빈 원이 남는다. 미해금 도감 칸은 그림을 보이지 않는다(`src/main/portraits.ts`).

### 도구·알 그림, 도감 설명, 울음소리

- 가방·상점의 도구 그림은 PokeAPI `sprites/items/<식별자>.png` 다. 우리 도구 중 이상한사탕과 진화의 돌 10종만 있다. 없는 도구는 빈 칸이다. 돌보미집과 상점 랜덤알은 `sprites/pokemon/egg.png` 를 쓴다. 캐시는 `~/.claude/pokebuddy/sprites/`.
- 도감 상세의 분류(쥐포켓몬)와 설명문은 `data/dex-text.json` 이다. `npm run data:build` 의 `build-dex-text` 가 PokeAPI CSV 로 만든다. 한국어 설명문은 898번까지만 있어 그 뒤는 영어 설명을 보인다. 미해금 종은 보이지 않는다.
- 포켓몬을 클릭하거나 놀아주기가 성공하면 PokeAPI cries 의 울음소리(`cries/pokemon/latest/<도감>.ogg`)를 무대에서 한 번 낸다. 놀아주기가 쉬는 시간이어도 클릭하면 운다. 같은 포켓몬은 1.5초 안에 다시 울지 않는다. 설정의 "알림 소리"가 꺼져 있으면 내지 않는다. 경로는 `.ogg` 지만 옛 종은 내용이 MP3 라 둘 다 받는다. 캐시는 `~/.claude/pokebuddy/cries/`.

### PMD 를 쓰는 이유

애니메이션이 하나뿐인 그림으로는 상태를 그림으로 나눌 수 없다. CSS 로 누르거나 흔들어 흉내 내 보았다. 어색해서 뺐다.
PMDCollab 은 종마다 동작이 따로 있는 거의 유일한 오픈 스프라이트 모음이다(1025종 중 979종, 이브이 34종).
무대는 캔버스 하나에 동작마다 시트를 미리 풀어 둔다. 그 시트로 그린다.

- `https://spriteserver.pmdcollab.org/assets/<도감4자리>/sprites.zip` 을 받는다. `~/.claude/pokebuddy/pmd/` 에 캐시한다.
  풀지 않고 메모리에서 읽는다(`art/pmd-load.js` · `art/pmd.js`, 무대 쪽 감싸기는 `src/main/art.ts`). 같은 종 여러 마리는 한 번만 받는다. 시트를 같이 쓴다
- 스프라이트가 없는 종은 404 가 아니라 **200 + 빈 ZIP** 을 준다. 크기·내용을 검사한다. 그래서 캐시에 눌러앉지 않는다
- 저작자 목록(`credits.txt`)은 ZIP 에 없다. 그래서 GitHub 에서 따로 받는다. `pokebuddy status <포켓몬>` 이 보여 준다
- 칸 크기가 동작마다 달라도 기준점은 `(칸너비/2, 칸높이/2+4)` 로 같다. 그래서 몸 칸 가운데에 맞춰 그리면 발 위치가 맞는다
- 캔버스 크기를 바꾸면 2D 컨텍스트가 기본값으로 돌아간다. 그러면 보간이 다시 켜진다. 정수 배율에서도 도트가 번진다(인접한 검정·흰색 픽셀이
  `[0,0,32,96,159,223,255,255]` 처럼 그라데이션이 된다). CSS `image-rendering: pixelated` 로는 못 막는다. 그래서 크기를 바꿀 때마다 보간을 다시 끈다(`src/renderer/stage.ts`)

## 문제 확인

```
pokebuddy status
```

터미널에서 실행한다. 이 명령을 친 터미널 창이 그 순간 맨 앞 창이다. 그래서 그 창의 판정이 나온다. 이 명령은 다음을 한 번에 보여 준다.

- 설정 파일 경로와 값
- 상태 훅 파일과 CLI 별 훅 등록 상태
- 마지막 실패(동반자가 스스로 끝난 이유)
- 지금 화면 맨 앞 창, 그 창이 터미널 호스트인지, 동반자가 보일 동작
- 세션 상태 기록(최신 10건 — 어느 CLI 기록인지, 마지막 프롬프트, 조상 수)
- PMD 캐시·저작자
- 동반자 pid
- 게임 요약(파티 칸 · 포인트 · 마리 수 · 알 수, 파티 마리별 상태)

`pokebuddy status eevee` 처럼 포켓몬 이름을 주면 그 포켓몬의 PMD 저작자를 보여 준다. 이름이 없으면 파티 첫 마리를 본다.
판정 로직은 동반자와 **같은 코드**(`src/follow/state.ts` · `src/follow/front.ts` — 빌드 산출물 `dist/follow/`)를 쓴다. 그래서 실제 동작과 어긋나지 않는다.
동반자의 폴링마다 판정을 보려면 디버그 모드로 띄운다.

```
POKEBUDDY_DEBUG=1 pokebuddy companion               # bash · zsh
$env:POKEBUDDY_DEBUG=1; pokebuddy companion         # PowerShell
```

로그는 `~/.claude/pokebuddy/debug-companion.log` 에 쌓인다. 명령이 이 경로를 알려 준다.

폴링마다 `{want, visible, front, host, pids, state, target}` 를 찍는다.
`front` 는 맨 앞 창 번호다. `host` 는 `hook` · `known` · `null` 중 하나다. `pids` 는 따르는 창 주인 pid 다. `target` 은 마지막으로 따른 터미널 창이다(`fake: true` 면 아직 터미널 창을 못 본 것이다).
buddy 가 켜져 있으면 마리마다 `{pet: 마리, motion: 단계, rhythm: idle|work, act: 동작/방향/방식, idleSec, roam}` 도 단계나 동작이 바뀔 때마다 찍는다.
`roam` 은 집에서 산책 나간 거리다. 그림 밖 클릭 통과가 바뀔 때마다 `{passing: true|false}` 를 남긴다.
무대 쪽은 `{stage: "pet" | "burst" | "drop" | "bounds", …}` 를 남긴다(마리 추가·벌리기·놓은 자리와 저장 여부·무대 사각형). 렌더러 진단은 `{from: "renderer", …}` 를 남긴다.
디버그 모드에서는 무대 왼쪽 위에 무대 크기 · 시트 · 상태 · 커서 밑 마리 · 마리별 자리를 글자로도 보여 준다.

## 배포 (관리자용)

```bash
npm pack          # mac 에서 — TypeScript 빌드(dist/) · universal 헬퍼를 만들어 넣는다 (prepack)
npm install -g ./pokebuddy-<버전>.tgz   # 올리기 전에 이 파일로 설치해 확인
```

- **mac 에서 만든다.** 헬퍼는 Swift·lipo·codesign 이 필요하다. 그래서 다른 OS 에서는 `npm pack` 이 멈춘다
- `.ps1` 파일(`helpers/winbounds.ps1` · `bin/pokebuddy.ps1`)은 **UTF-8 BOM 을 유지한다.** Windows PowerShell 5.1 은
  BOM 없는 스크립트를 시스템 코드 페이지로 읽는다(한국어 Windows 는 CP949). 그러면 한국어 주석이 줄바꿈을 삼킨다.
  다음 코드 줄이 주석이 된다. 헬퍼는 C# 컴파일이 실패한다. 창 목록이 빈다. 동반자가 창을 따르지 못한다
- 게시 전에는 다음을 확인한다:
  - `package.json` 의 `"private": true` 를 제거한다(실수로 게시하지 않게 막아 둔 줄이다)
  - 버전을 올린다
  - Windows 실기에서 다음을 확인한다: `pokebuddy setup`, `pokebuddy companion`, claude·codex·gemini 의 상태 반응, 트레이의 종료, `pokebuddy companion stop`
- Electron 은 시험한 버전으로 고정해 두었다(`dependencies.electron`). 올릴 때는 동반자 실행·드래그·산책을 다시 확인한다
- PMD 그림은 패키지에 들어가지 않는다(CC BY-NC). 받는 사람 컴퓨터에서 실행할 때 내려받는다

### Windows 실행 파일 만들기

```powershell
npm run dist:win    # release/pokebuddy-Setup-<버전>.exe
```

- `scripts/build-exe.cjs` 가 실행에 필요한 파일(`package.json` 의 `files`)만 `release/app/` 에 모은다. 그다음 `electron-builder` 로 묶는다.
- 처음 만들 때 Electron 과 NSIS 를 내려받는다. 인터넷이 필요하다.
- 설치 파일에는 포켓몬 그림을 넣지 않는다. 앱이 처음 켜질 때 받는다. `scripts/fetch-sprites.cjs` 는 저장소 실행용으로 `.cache/sprites/`(git 제외)에 받는다.
- 코드 서명을 하지 않는다. 설치 확인은 `release/win-unpacked/pokebuddy.exe` 를 먼저 띄워 본 뒤 설치 파일로 한다.

### 로고

앱 아이콘은 공식 SVG 로고 한 장에서 만든다. 그림 파일을 직접 고치지 않는다.

- 원본은 `assets/logo/src/logo.svg` 다. 터미널 창 모서리에 걸친 몬스터볼이다(위 빨강, 아래 흰색).
- `npm run logo:build` 가 `scripts/sync-official-logo.js` 로 `assets/logo/out/` 에 `logo-16 … 1024.png` · `logo.svg` · `logo.ico`(Windows) · `logo.icns`(mac) 를 만든다.
  macOS 의 `sips`·`qlmanage`·`iconutil` 이 필요하다. 그래서 mac 에서만 다시 만든다. out/ 도 함께 올린다
- 로고가 쓰이는 곳은 다음과 같다:
  - README 머리(`logo.svg`)
  - 앱 아이콘(`logo.icns` mac · `logo.ico` Windows)

  실행 중인 동반자는 PNG 를 쓴다. Windows 창 아이콘은 `logo-256.png` 다. mac Dock 아이콘은 `logo-512.png` 다

## 라이선스

코드는 MIT 라이선스다. 자세한 내용은 [LICENSE](../LICENSE) 를 참고한다. 포켓몬 이미지는 이 저장소에 포함되어 있지 않다.

PMD 스프라이트는 [PMDCollab/SpriteCollab](https://github.com/PMDCollab/SpriteCollab) 기여자들의 작품이다.
라이선스는 **CC BY-NC 4.0**(저작자 표시·비상업)이다. MIT 와 섞일 수 없다. 그래서 저장소에 넣지 않는다. 실행할 때 사용자 컴퓨터로
받아 캐시만 한다. 포켓몬별 저작자는 `pokebuddy status <포켓몬>` 으로 확인한다. 이 도구로 만든 화면을 공유할 때는
저작자와 출처를 함께 밝힌다.

## 돌봄

우클릭 메뉴에서 밥 주기와 놀아주기를 쓸 수 있다. 첫 줄 아래 상태 줄에는 만복도 구간과 기분이 보인다(`src/main/status.ts` `petStatus`). 밥을 주면 열매로 다가가 먹는다. 놀아주면 잠깐 커서를 따라간다.
밥 주기와 놀아주기의 쿨타임은 각각 10분이다. 두 쿨타임은 따로 센다. 수치는 [밸런스 수치](specs/balance.md)를 따른다.

친밀도는 줄지 않는다. 만복도와 기분만 오르내린다. 적립 규칙은 [게임 — 친밀도와 기분](#게임--친밀도와-기분)을 따른다. `pokebuddy status`에서 파티 마리별 상태를 확인할 수 있다.
