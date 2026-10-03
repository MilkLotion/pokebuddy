# 개발과 배포

이 문서는 저장소에서 앱을 실행하고, 시험하고, 설치 파일을 만드는 방법을 적는다.
대상 독자는 개발자다. 설치 파일로 쓰는 방법은 [설명서](../guide.md)에 있다.
동반자의 내부 동작은 [동반자 동작](../specs/companion.md)에 있다.

요구사항은 다음과 같다.

- Node.js 22.12 이상이 필요하다. Electron 44 설치기가 요구한다. 이보다 버전이 낮으면 설치는 끝나도 동반자가 뜨지 않는다.
- macOS(Apple Silicon·Intel) 또는 Windows 에서 동작한다.
- 상태 연동을 쓰려면 Claude Code, Codex CLI 0.124 이상, Gemini CLI 0.26 이상 중 하나가 있어야 한다.

## 저장소에서 바로 쓰기


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

## npm 패키지

npm 레지스트리에는 게시하지 않았다(2026-09-29 `npm view pokebuddy` 결과 404). `package.json` 의 `"private": true` 가 게시를 막는다.
[배포](#배포) 절에서 만든 `.tgz` 파일로 설치한다.

```bash
npm install -g ./pokebuddy-<버전>.tgz
pokebuddy setup
pokebuddy companion
```

- `npm install` 이 Electron(약 100MB)까지 받는다. mac 창 추적 헬퍼는 패키지에 미리 빌드돼 있다(universal).
- `pokebuddy setup` 은 처음 한 번만 하면 된다. 하는 일은 다음과 같다:
  - Electron 확인 — 실행 파일이 없으면 받는다
  - 펫 데이터 폴더 `~/.claude/pokebuddy` 생성
  - 상태 훅 파일 준비 — `~/.claude/scripts/hooks/pokebuddy-state.cjs` 를 복사한다. **CLI 마다 훅을 등록하지는 않는다** (2026-09-28 사용자 결정).
    CLI 연결은 설정창 → 사용자 → `연결` 탭의 버튼으로 CLI 마다 한다. 이미 등록된 훅은 건드리지 않는다
  - 옛 이름 훅 정리 — 예전 이름(termimon·pkmon)으로 등록된 훅이 있으면 걷는다. 바꾸기 전에 백업을 남긴다
  - 옛 에디터 확장 제거 — 예전 버전이 VS Code 계열 에디터에 설치한 확장(`local.pokebuddy-active-terminal`, 옛 이름 `local.termimon-active-terminal` · `local.pkmon-active-terminal`)이 있으면 지운다. setup 은 에디터 CLI 를 PATH 나 앱 안에서 찾는다. 열려 있는 에디터 창은 다시 불러와야 적용된다
  - 옛 확장 기록 제거 — `~/.claude/pokebuddy/cli.json` 과 `~/.claude/pokebuddy/windows/` 가 남아 있으면 지운다
- 무엇을 바꿀지 먼저 보려면 `pokebuddy setup --dry-run` 을 쓴다. 에디터를 건드리지 않으려면 `--no-editor` 를 쓴다.

지우기:

```bash
pokebuddy uninstall            # 훅 등록·훅 파일·옛 에디터 확장과 그 기록 제거 (설정·저장·그림 캐시는 남김)
pokebuddy uninstall --purge    # ~/.claude/pokebuddy 까지
npm uninstall -g pokebuddy
```

## 옛 이름에서 옮겨 오기


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

## 명령


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

`pokebuddy companion` 은 동반자 창이 뜰 때까지 기다린다. 그 뒤 `동반자를 띄움` 한 줄을 남기고 돌아온다.
CLI 는 저장 내용을 읽지 않는다. 저장은 앱이 암호화한다. 첫 실행 여부는 `save.json` 이 있는지로 본다.
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

교환·계정·클라우드 저장 서버를 바꾸는 `POKEBUDDY_SUPABASE_URL`·`POKEBUDDY_SUPABASE_KEY` 와 시험용 `POKEBUDDY_TRADE_*`·`POKEBUDDY_CLOUD_*` 는 저장소에서 직접 띄운 개발 실행에서만 읽는다. exe 설치본과 npm 설치본은 무시한다. 판정 기준은 앱 폴더에 `src/main/app.ts` 원본이 있는가다(`src/trade/config.ts` `devRunAt`). 설치본에는 이 파일이 들어가지 않는다.

- 포켓몬을 드래그해 원하는 자리에 놓으면 위치가 기억된다. 마리마다 따로 기억한다(`save.json` 의 마리 `home`, 놀이공간 오른쪽 아래 기준 오프셋). buddy 는 거기를 집으로 삼는다.
- 한 무대의 여러 마리는 겹칠 수 있다. 나중에 소환한 마리가 앞에 보인다.

## 게임 명령

CLI 에서도 같은 명령을 보낸다. 아래 명령은 PowerShell 과 일반 셸에서 쓸 수 있다.
`p1` 은 예시 ID 다. 실제 ID 는 `snapshot` 의 `party` 와 `boxes` 에서 확인한다.
상점 구매는 대상 자리에 상품 ID 를 쓴다. 알은 `random`·`ancient-stone`·`legendary` 등, 파티 칸은 `party-slot`, 종은 종 이름, 도구는 도구 ID 다.

```text
pokebuddy game snapshot
pokebuddy game shop.buy random
pokebuddy game shop.buy party-slot
pokebuddy game shop.buy rattata
pokebuddy game shop.buy rare-candy
pokebuddy game evolve p1 to=umbreon
pokebuddy game pet.form p1 species=lunala
pokebuddy game pet.set p1 size=3
pokebuddy game feed p1
pokebuddy game party.show p1
pokebuddy game --help
```

이 명령을 쓰려면 동반자가 떠 있어야 한다. 동반자가 게임 저장을 쓴다.
`pet.set size=3` 은 마리별 크기 단계(1~5)를 바꾼다. 새 포켓몬의 기본 크기는 단계 2다. 파티 상세 기기 창의 크기 단추도 같은 명령이다.
`pet.form` 은 공유 계열 개체만 받는다. 고를 수 있는 모습이 아니면 `bad-form` 을 돌려준다.
가방 사용·알 열기·파티 배치는 설정창에서 한다. CLI 는 `--help` 에 나오는 명령만 받는다.

친구 교환 링크를 받았으면 `pokebuddy trade <교환 링크>` 로 참가한다. 이 명령은 떠 있는 동반자에 링크를 보낸다.

## 포켓몬 이름


`pokebuddy status <포켓몬>` 과 `pokebuddy game` 의 종 자리는 PokeAPI 의 종 식별자(`pokemon_species.csv` 의 `identifier`)를 쓴다. 전국도감 1025종 전부와 고른 폼 85개다.
도감표 `lib/dex.json` 은 `npm run data:build` 의 `build-dex` 가 PokeAPI CSV 로 만든다. PMD 는 같은 이름을 도감 번호로 바꿔 받는다.
옛 codex-pokepets 폴더명의 `-3d` 이름도 받는다. `gengar` 와 `gengar-3d` 는 같은 그림이다.

| 입력 | 결과 |
|---|---|
| `pikachu` · `Pikachu` | 대문자로 적어도 소문자로 맞춘다 |
| `gengar` · `gengar-3d` | 같은 그림 — `-3d` 는 옛 codex-pokepets 이름의 그림체 구분이라 떼고 본다 |
| `rotom-wash` · `deoxys-attack` · `unown-z` | 폼은 PokeAPI 표기 |

메가·거다이맥스 폼은 종 이름으로 넣을 수 없다(`charizard-mega-x` 같은 이름은 실패한다). 메가 모습은 종이 아니라 개체의 모습이다(`data/mega.json`, [메가진화](../specs/game.md#메가진화)). 없는 이름을 넣으면 비슷한 이름을 알려 준다.

## 설정 파일


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
- 저장 파일이 있는지(`저장 있음` · `저장 없음`). 저장 내용은 암호화되어 있어 보이지 않는다

`pokebuddy status eevee` 처럼 포켓몬 이름을 주면 그 포켓몬의 PMD 저작자를 보여 준다. 이름이 없으면 설정 파일의 `slug` 를 본다.
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

## 빌드와 검사

- 빌드는 `npm run build` 로 한다. `tsconfig.json` 이 메인·CLI 가 부르는 모듈·도구를 `dist/` 로 만든다(CJS). `tsconfig.renderer.json` 이 화면 스크립트를
  `dist/renderer/` 로 만든다(ESM). HTML 은 빌드하지 않는다. `src/renderer/*.html` 에 그대로 둔다. 이 HTML 은 `../../dist/renderer/*.js` 를 부른다
- 무대·선택 창 문서에는 CSP 가 있다. 스크립트는 자기 파일에서만 부른다. 그림은 data URL 만 쓴다(`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:`)
- 창 아이콘은 다음과 같다 — Windows 는 `assets/logo/out/logo-256.png` 를 쓴다. mac 은 Dock 아이콘을 `logo-512.png` 로 정한다. 그 뒤 Dock 에서 숨긴다. 트레이 아이콘은 첫 마리 그림을 쓴다
- 자체 확인은 `npm run selftest` 로 한다. 검사 목록은 `src/tools/selftest/list.ts` 의 `SELFTESTS` 에 있다. 실행기는 `src/tools/selftest/run.ts` 다
  - 목록에 없는 `selftest-*.ts` 가 하나라도 있으면 검사를 하나도 돌리지 않고 실패한다. 새 검사를 만들면 목록에 더한다
  - 검사가 하나라도 실패하면 종료 코드는 1 이다. 실패한 검사의 종료 코드를 그대로 내지 않는다
  - `--keep-going` 은 실패한 뒤에도 나머지를 돌린다. `--reverse` 는 거꾸로 돌린다(순서 의존 확인). `--list` 는 목록만 적는다
  - 클라우드·교환·계정 검사는 로컬 Supabase(`npx supabase start`)와 로컬 함수 서버(`npx supabase functions serve`)가 있어야 한다. 올리기가 Edge Function `upload-save` 를 거친다
  - 함수 서버가 "No such container" 로 바로 끝나면 한 번 더 띄운다
- 서버 검증 규칙(`src/verify/save-rules.ts`)이나 가격·진화 데이터를 바꾸면 빌드한 뒤 `node dist/tools/data/build-verify.js` 로 `supabase/functions/_shared/` 를 다시 만든다. `selftest-verify` 가 최신인지 본다
- 형 검사만 하려면 `npm run check` 를 쓴다. 산출물을 만들지 않는다
- 동반자 흐름 검사는 `npm run test:e2e` 로 한다. 빌드한 뒤 `dist/tools/e2e/e2e-companion.js` 가 CLI → 선택 창 → 저장 → 종료·복원을 확인한다
- 실기 확인용 저장은 다음 명령으로 만든다 — `node dist/tools/dev/dev-save.js <HOME> <종>[,<종>…] [--same-home]` 이 그 HOME 아래 `.claude/pokebuddy/save.json` 을 저장 v3 로 만든다.
  마리는 60px 씩 벌려 둔다. `--same-home` 이면 전부 기본 집이다(겹침 확인). 진짜 저장은 건드리지 않는다
- 시험 중 동반자를 끝낼 때는 프로세스를 죽이지 않는다. `~/.claude/pokebuddy/companion.lock` 을 지운다(`pokebuddy companion stop` 과 같다)

## 시험용 HOME 에서 실기 확인


튜토리얼처럼 한 번 끝나면 다시 안 뜨는 화면은 진짜 저장으로 다시 볼 수 없다. 시험용 HOME 에서 동반자를 따로 띄운다.
도구는 `src/tools/dev/dev-test.ts` 다.

- 시험용 HOME 은 `POKEBUDDY_TEST_HOME` 이다. 없으면 저장소의 `.claude/test-home/default` 다. `.claude/` 는 git 이 추적하지 않는다.
- 저장·잠금·단일 실행 잠금이 모두 이 HOME 아래에 생긴다. 그래서 진짜 저장을 건드리지 않고, 쓰던 동반자와 나란히 뜬다.
- 저장소의 `electron .` 은 로그인 시 시작을 등록하지 않는다(`src/main/app.ts` `syncLoginItem`).
- 도구는 `POKEBUDDY_SAVE_CRYPT=off` 로 동반자를 띄운다. 그래서 새 HOME 의 저장은 평문으로 남고 `scene`·`show` 가 직접 읽고 고친다.
  이 값은 개발 실행과 업데이트 시험 빌드만 받는다. 이미 `save.key` 가 있는 HOME 에서는 그 키로 계속 암호화한다.
- 작업 트리의 미커밋 변경을 빼고 시험하려면 HEAD 를 `git worktree add --detach <폴더> HEAD` 로 따로 꺼낸다.
  그 폴더의 `node_modules` 는 저장소의 것을 링크(Windows 는 junction)하고, 그 폴더에서 `npm run build` 한 뒤 도구를 부른다.

```powershell
npm run build
node dist/tools/dev/dev-test.js start --fresh      # HOME 을 비우고 첫 포켓몬 선택부터
node dist/tools/dev/dev-test.js show               # 포인트·개체·알·튜토리얼 상태
node dist/tools/dev/dev-test.js stop               # companion.lock 을 지워 스스로 저장하고 끝나게 한다
node dist/tools/dev/dev-test.js scene hatch        # 앱이 꺼진 상태에서만 저장을 고친다
node dist/tools/dev/dev-test.js start              # 고친 저장으로 다시 띄운다
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
| `playground` | 놀이공간을 한 화면(주 화면)으로 둔다 |
| `box` | 레벨·친밀도가 다른 개체 8마리를 박스에 넣는다(박스 정렬·끌기 확인) |
| `boxes` | 박스를 비우고 첫 박스 30칸을 채운 뒤 둘째 박스에 3마리를 넣는다(`◀`·`▶` 로 보내기·가득 참 확인) |
| `done-all` | 튜토리얼을 모두 완료로 둔다(개체 상세·화면·도감·교환·사용자 포함) |
| `rich` | 포인트를 10000 이상으로 둔다 |
| `showcase` | 시험 계정용이다. 튜토리얼을 모두 완료로 두고, 파티 4칸과 박스에 여러 종을 넣는다. 대체 그림 종·리전폼·이로치가 들어 있다. 도구는 종류마다 20개, 포인트는 50000 이상, 준비된 랜덤알 하나를 둔다 |
| `forms` | 특수 폼 확인용이다. 튜토리얼을 모두 완료로 둔다. 파티에 진화 직전의 암멍이(Lv.25, 친밀도 100)·치고마·일레즌과 기라티나, 메가스톤을 지닌 플라엣테(영원의 꽃)를 넣는다. 박스에 대쓰여너 암컷·수컷과 나머지 특수 폼을 넣는다. 가방에 악의 족자 2개, 돌보미집에 배쓰나이만 나오는 준비된 알 3개를 넣는다 |

- 앱이 떠 있으면 `scene` 은 저장을 고치지 않고 멈춘다. 앱이 메모리의 저장으로 파일을 덮어쓰기 때문이다.
- `stop` 이 10초 안에 끝내지 못하면 트레이에서 끝낸다. 프로세스를 죽이지 않는다.
- 확인이 끝나면 시험용 HOME 폴더를 지워도 된다.
- Windows 에서 `start` 는 시험용 HOME 아래에 `AppData/Local` 을 만든다. 이 폴더가 없으면 창 추적 헬퍼의 PowerShell 캐시가 저장소에 `Microsoft/` 로 생긴다.

### 작업 전용 시험 HOME 실기

실기는 작업마다 전용 시험 HOME 에서 한다(2026-10-02 사용자 결정). 다른 작업의 실기와 저장·계정이 겹치지 않는다. 아래 순서를 기본 방식으로 쓴다.

1. 시험 HOME 을 정한다. 위치는 저장소의 `.claude/test-home/<작업명>` 이다(2026-10-03 사용자 결정). `.claude/` 는 git 이 추적하지 않는다. 사용자 홈의 `~/.claude` 아래에는 만들지 않는다. 모든 명령에 `POKEBUDDY_TEST_HOME` 으로 준다.
2. 띄울 코드를 정한다. 작업 트리에 다른 작업의 미커밋 변경이 있으면 HEAD 를 worktree 로 꺼내 빌드한다(위 목록의 worktree 항목).
3. 앱을 띄우기 전에 저장을 만든다. `scene <장면>` 을 쓴다. 장면에 없는 값은 `dist/save/store.js` 의 `read`·`write` 로 고친다.
4. 서버를 쓸지 정한다.
   - 서버가 필요 없는 확인은 `POKEBUDDY_ONLINE=off` 로 띄운다. 계정이 생기지 않는다. 서버 검증 위반이 생길 수 없다.
   - 온라인이 필요한 확인은 그대로 띄운다. 운영 서버에 새 익명 계정이 생긴다. 서버는 첫 올리기를 직전 저장과 견주지 않는다. 그래서 3번에서 만든 저장은 위반이 아니다.
   - 띄운 뒤에는 온라인 HOME 의 저장 파일을 고치지 않는다. 고쳐야 하면 [시험 계정](#시험-계정)의 `save put` 절차를 따른다.
   - 배포 전의 규칙(확률표·가격 등)이 운영 서버의 `upload-save` 와 다르면 온라인 실기는 위반을 기록한다. 그런 확인은 오프라인으로 한다. 또는 `upload-save` 를 재배포한 뒤에 한다.
5. `start` 로 띄운다. 명령은 `node bin/pokebuddy game <명령> …` 으로 보낸다. `HOME` 과 `USERPROFILE` 을 시험 HOME 으로 준다. CLI 가 받지 않는 명령(`egg.open`·`bag.use` 등)은 `dist/save/mailbox.js` 의 `send(PATHS.mailbox, { cmd, target, args, from: "cli" })` 로 보낸다.
6. 결과는 저장 파일로 확인한다. `show` 와 평문 `save.json` 을 읽는다.
7. 실제 창은 아래 "창 확인"으로 본다.
8. 끝나면 `stop` 으로 내린다. 온라인이었으면 관리자 CLI `violations <uuid>` 로 위반이 없는지 본다. uuid 는 시험 HOME 의 `cloud.json` `userId` 다.
9. 작업 기록에 시험 HOME, 계정 uuid, 띄운 커밋, 명령, 결과 표를 적는다.
10. 확인이 끝나면 시험 HOME 폴더를 지운다(2026-10-03 사용자 결정). 지우기 전에 앱이 내려갔는지 본다. 온라인 HOME 을 지우면 그 익명 계정으로 다시 들어갈 수 없다. 계정 uuid 는 9번에서 적어 둔다. worktree 를 썼으면 `node_modules` 링크를 먼저 끊고 worktree 를 지운다.

```powershell
$env:POKEBUDDY_TEST_HOME = "$PWD/.claude/test-home/<작업명>"
$env:POKEBUDDY_ONLINE = "off"                      # 서버가 필요 없을 때만
node dist/tools/dev/dev-test.js scene showcase
node dist/tools/dev/dev-test.js start
node dist/tools/dev/dev-test.js show
node dist/tools/dev/dev-test.js stop
```

창 확인(Windows):

- 설정창은 같은 HOME 으로 앱을 한 번 더 실행하면 열린다(`src/main/app.ts` second-instance). 두 번째 프로세스는 바로 끝난다.
- `scripts/dev-winshot.ps1 -ProcId <pid> -OutDir <폴더>` 가 그 앱의 창만 찍는다(`PrintWindow`). pid 는 시험 HOME 의 `.claude/pokebuddy/save.lock` 첫 줄이다. `-List` 는 창 핸들과 사각형만 보인다. `-Restore` 는 최소화된 창을 포커스 없이 되살린다.
- `scripts/dev-winclick.ps1 -Hwnd <핸들> -X <x> -Y <y>` 가 창에 클릭 메시지를 보낸다(`PostMessage`). 마우스는 움직이지 않는다. 좌표는 찍은 그림에서 읽는다. 설정창은 보이지 않는 왼쪽 테두리 8 px 을 x 에서 뺀다. 화면 배율 100% 기준이다.
- 화면 전체를 캡처하지 않는다. 사용자의 다른 앱이 찍힌다. 무대의 포켓몬은 작은 사각형만 찍는다.
- 다른 창에 가려진 창은 그리기를 멈춘다. 이때 `dev-winshot` 은 옛 그림이나 검은 그림을 준다. 가려져도 그리게 하려면 앱을 `--disable-features=CalculateNativeWinOcclusion` 으로 띄운다. `dev-test.js start` 대신 저장소에서 `npx electron --disable-features=CalculateNativeWinOcclusion .` 을 실행한다. `HOME`·`USERPROFILE` 을 시험 HOME 으로, `POKEBUDDY_SAVE_CRYPT=off` 를 함께 준다. 설정창을 여는 두 번째 실행에도 같은 값을 준다. 내릴 때는 `dev-test.js stop` 을 쓴다.
- 이 옵션 없이 띄웠으면 누른 결과는 저장 파일로 확인한다. 화면 변화는 `dist/tools/dev/dev-manage.js` 로 따로 찍는다.

### 임시 폴더

시험과 개발 도구가 쓰고 버리는 폴더는 시스템 임시 폴더의 `pokebuddy/` 아래에 만든다(2026-10-03 사용자 결정). 저장소 안에는 만들지 않는다. 들여다보거나 이어 쓰는 시험 HOME 과 시험 계정만 저장소의 `.claude/` 에 둔다.

- 폴더는 `src/tools/harness/tmp-dir.ts` 의 `makeTmp(<이름>)` 으로 만든다. 경로는 `<임시 폴더>/pokebuddy/<이름>-XXXXXX` 다. `fs.mkdtempSync(path.join(os.tmpdir(), …))` 를 직접 부르지 않는다.
- 임시 폴더를 쓰는 도구는 모두 `src/tools/` 의 TypeScript 다. 그래서 `npm run build` 뒤에 `dist/tools/` 에서 실행한다.
- 프로세스가 종료 코드 0 으로 끝나면 만든 폴더를 지운다. 실패하면 남긴다. 원인을 볼 수 있다.
- 남은 폴더는 다음에 `makeTmp` 를 처음 부를 때 치운다. 만든 프로세스가 끝난 폴더는 바로 지운다. 프로세스 번호는 폴더 옆의 `<폴더 이름>.pid` 파일에 있다. 이 파일이 없는 폴더는 하루 뒤에 지운다.
- Electron 으로 도는 도구(`smoke-*`, `dev-manage`)는 끝날 때 자식 프로세스가 파일을 잡고 있다. 그래서 스스로 다 지우지 못한다. 다음 실행이 치운다.
- 커밋만 꺼낸 worktree 는 이 폴더에 두지 않는다. worktree 에는 저장소의 `node_modules` 로 가는 링크가 있다. `<임시 폴더>/pokebuddy-worktree/<이름>` 에 두고 끝나면 링크를 먼저 끊은 뒤 지운다.
- 한꺼번에 정리하려면 `<임시 폴더>/pokebuddy` 폴더를 지운다. 떠 있는 시험이 없을 때 한다.

### 시험 계정

온라인 기능(클라우드 저장·우편·교환)을 실기로 볼 때는 시험 계정을 쓴다. 자기 계정을 쓰지 않는다.

- 시험 계정은 운영 서버의 익명 계정 하나다. 세션은 시험 계정 HOME 인 저장소의 `.claude/dev-account` 에 있다(2026-10-03 사용자 결정, 옛 위치는 `~/.claude/pokebuddy-dev-account`). `.claude/` 는 git 이 추적하지 않는다. 이 폴더를 지우면 그 계정으로 다시 들어갈 수 없다. 작업 전용 시험 HOME 과 달리 확인 뒤에도 지우지 않는다.
- worktree 에서 `dev-test` 를 돌릴 때는 `POKEBUDDY_ACCOUNT_HOME` 에 저장소의 `.claude/dev-account` 경로를 준다. 주지 않으면 그 worktree 아래의 폴더를 본다.
- `npm run dev:account` 가 빌드한 뒤 이 계정으로 동반자를 띄운다. 이미 떠 있으면 내렸다가 다시 띄운다.
- `dev-test` 의 다른 명령은 끝에 `--account` 를 붙이면 이 HOME 을 쓴다. `--fresh` 는 받지 않는다.
- 임시 폴더 HOME 으로 `start` 하면 띄울 때마다 운영 서버에 익명 계정이 하나 생긴다. 서버가 필요 없는 확인은 `POKEBUDDY_ONLINE=off` 를 주고 띄운다.

```powershell
npm run dev:account                               # 시험 계정으로 띄운다
node dist/tools/dev/dev-test.js show --account        # 계정·포인트·개체
node dist/tools/dev/dev-test.js stop --account        # 내린다
```

시험 계정의 저장을 고칠 때는 서버 저장도 같이 바꾼다. 서버는 올라온 저장을 직전 서버 저장과 비교한다(`src/verify/save-rules.ts`). 로컬 저장만 고치면 위반으로 기록한다.

1. `stop --account` 로 앱을 내린다.
2. `scene <장면> --account` 로 저장을 고친다. 개체의 레벨을 올리면 경험치도 그 레벨에 맞춘다.
3. 관리자 CLI 의 `save put --home <시험 계정 HOME>` 으로 바꿀 내용을 본다. `--yes` 를 붙여 서버 저장에 쓴다. 이 명령은 익명 계정만 받는다. 관리자 키(`admin/.env.local`)가 필요하다.
4. `npm run dev:account` 로 띄운다. 앱은 서버 저장을 받아 잇는다.

## 배포


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
- 설치 파일에는 포켓몬 그림을 넣지 않는다. 앱이 처음 켜질 때 받는다. `dist/tools/data/fetch-sprites.js` 는 저장소 실행용으로 `.cache/sprites/`(git 제외)에 받는다.
- 코드 서명을 하지 않는다. 설치 확인은 `release/win-unpacked/pokebuddy.exe` 를 먼저 띄워 본 뒤 설치 파일로 한다.
- 릴리스 전에 `data/patch-notes.json` 맨 앞에 새 버전의 날짜와 바뀐 것을 적는다. `selftest-patch-notes` 는 `package.json` 버전의 노트가 없으면 실패한다.
- GitHub Release 에는 설치 파일과 함께 `release/latest.yml` 과 `release/pokebuddy-Setup-<버전>.exe.blockmap` 을 올린다. 설치본은 이 `latest.yml` 로 새 버전을 찾는다. 올린 파일 이름은 `latest.yml` 안의 이름과 같아야 한다.
- 업데이트 실기 시험은 `node dist/tools/e2e/e2e-update-win.js` 다. 시험용 설치본(`pokebuddy-update-test`)을 조용히 설치해 로컬 서버의 다음 버전으로 업데이트한 뒤 제거한다. 사용자의 설치본과 섞이지 않는다.

### Mac 앱 만들기

```bash
npm run dist:mac    # release/PokeBuddy-<버전>-arm64.dmg · release/PokeBuddy-<버전>-x64.dmg
```

- **mac 에서 만든다.** universal 헬퍼(`scripts/build-helper.js`)를 먼저 만든 뒤 `scripts/build-exe.cjs --mac` 으로 묶는다. 모으는 파일은 Windows 실행 파일과 같다.
- 헬퍼에 arm64·x86_64 가 모두 없으면 멈춘다. Intel 용 dmg 가 창 추적 없이 나가지 않게 하기 위해서다.
- 서명은 이 Mac 로그인 키체인의 자체 서명 인증서 `PokeBuddy Code Signing` 으로 한다(`scripts/build-exe.cjs` `signMac`, electron-builder 서명은 끄고 `afterPack` 에서 직접). Apple 개발자 인증서와 공증은 없다.
  - 인증서로 서명하면 macOS 가 앱을 `identifier + certificate leaf` 로 알아본다. 버전이 바뀌어도 같은 앱이라, 사용자가 키체인 허용을 한 번 하면 업데이트 뒤에도 다시 묻지 않는다. ad-hoc 서명은 빌드마다 해시가 바뀌어 업데이트마다 `PokeBuddy Safe Storage` 허용 창이 떴다.
  - 인증서가 키체인에 없으면 Mac 빌드는 멈춘다. 개인키는 저장소에 넣지 않는다. 키체인 접근 앱에서 `.p12` 로 내보내 따로 보관한다. 키를 잃으면 새 인증서를 만들어야 하고, 그때 사용자에게 허용 창이 한 번 더 뜬다.
  - 새 Mac 에 인증서를 가져오면 `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -l "PokeBuddy Code Signing" ~/Library/Keychains/login.keychain-db` 를 한 번 실행한다(로그인 암호). 하지 않으면 서명할 파일마다 키체인 창이 뜬다.
- zip 두 개(`PokeBuddy-<버전>-arm64.zip`·`-x64.zip`)와 `release/latest-mac.yml` 도 함께 만든다. GitHub Release 에는 dmg·zip 네 개와 `latest-mac.yml` 을 올린다. Mac 앱은 `latest-mac.yml` 로 새 버전을 찾고 zip 으로 바꾼다.
- 릴리스의 Mac 파일은 `.github/workflows/release-mac.yml` 이 올린다. GitHub Release 가 게시되면 macOS 러너가 `npm run dist:mac` 을 돌린다. 그다음 dmg·zip 네 개와 `latest-mac.yml` 을 같은 릴리스에 덮어 올린다. 그래서 Windows 에서 릴리스를 만들어도 Mac 파일이 붙는다.
  - Windows 에서 릴리스를 만들 때 `latest-mac.yml` 을 올리지 않는다. 옛 `latest-mac.yml` 이 올라가면 Mac 앱이 옛 버전을 최신으로 본다. 0.10.0~0.11.1 릴리스가 이 상태였다.
  - 서명 인증서는 저장소 Secrets 두 개로 넘긴다. `MAC_SIGNING_P12` 는 `.p12` 의 base64 값이고, `MAC_SIGNING_PASSWORD` 는 그 `.p12` 의 암호다. 두 값이 없으면 워크플로가 멈춘다.
  - 이미 있는 태그에 Mac 파일을 다시 올릴 때는 Actions 에서 `release-mac` 을 수동 실행하고 `tag` 에 태그를 적는다.
- Mac 업데이트는 electron-updater 를 쓰지 않는다. electron-updater 의 mac 설치기(Squirrel.Mac)는 정식 서명이 있어야 새 버전을 설치하기 때문이다. `src/main/mac-updater.ts` 가 같은 이벤트를 내는 자체 엔진이다. 받은 zip 은 sha512 로 검사하고, 앱이 끝난 뒤 도우미 스크립트가 같은 폴더 안에서 앱을 바꾼다. 실패하면 옛 앱을 되돌린다.
- 업데이트 실기 시험은 `node dist/tools/e2e/e2e-update-mac.js` 다. 임시 폴더에 시험 앱(`pokebuddy-update-test.app`)을 두고 로컬 서버의 다음 버전으로 바꾼다. 사용자의 앱·저장·키체인은 건드리지 않는다.
- `pokebuddy://` 링크는 앱의 `Info.plist` 에 등록한다. mac 은 여기에 적힌 스킴만 앱에 넘긴다.
- 확인은 `release/mac-arm64/PokeBuddy.app` 을 먼저 띄워 본 뒤 dmg 로 한다.

### 로고

앱 아이콘은 공식 SVG 로고 한 장에서 만든다. 그림 파일을 직접 고치지 않는다.

- 원본은 `assets/logo/src/logo.svg` 다. 터미널 창 모서리에 걸친 몬스터볼이다(위 빨강, 아래 흰색).
- `npm run logo:build` 가 `scripts/sync-official-logo.js` 로 `assets/logo/out/` 에 `logo-16 … 1024.png` · `logo.svg` · `logo.ico`(Windows) · `logo.icns`(mac) 를 만든다.
  macOS 의 `sips`·`qlmanage`·`iconutil` 이 필요하다. 그래서 mac 에서만 다시 만든다. out/ 도 함께 올린다
- 로고가 쓰이는 곳은 다음과 같다:
  - README 머리(`logo.svg`)
  - 앱 아이콘(`logo.icns` mac · `logo.ico` Windows)

  실행 중인 동반자는 PNG 를 쓴다. Windows 창 아이콘은 `logo-256.png` 다. mac Dock 아이콘은 `logo-512.png` 다
