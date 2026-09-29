# Figma 글자 작업과 Galmuri 재배치

이 문서는 pokebuddy Figma 파일(`MA3K41Y6omAi5mRu6YDFly`)에서 글자를 만들고 Galmuri로 다시 배치하는 절차를 설명한다.

## 왜 필요한가

- 파일의 글자는 PB/Type 텍스트 스타일을 쓴다. 스타일 글꼴은 Galmuri다. Galmuri는 로컬 글꼴이다.
- 원격 도구 `use_figma`는 Galmuri를 불러오지 못한다. `figma.loadFontAsync({ family: "Galmuri11" })`는 "font family does not exist"로 실패한다.
- 그래서 `use_figma`로 만든 글자는 데이터만 Galmuri 스타일이다. 크기와 줄바꿈은 Noto Sans KR 기준으로 남는다. 예: Title 24 글자가 23×14로 남는다.
- Galmuri를 쓸 수 있는 Figma가 글자를 다시 계산하면 제 크기가 된다. 예: 23×14가 48×32가 된다.

## 방법 선택

| 방법 | 쓰는 때 | 절 |
|---|---|---|
| 로컬 개발 플러그인 | 기본 방법이다. 문구 수정, 스타일 변경, 재배치를 모두 한다 | 0장 |
| Chrome에서 스타일 값 바꾸기 | 플러그인을 실행할 수 없을 때만 쓴다 | 2·3장 |

## 역할

- 시안을 만드는 작업자는 `use_figma`로 직접 만든다.
- 글자 수정과 재배치는 작업자가 로컬 개발 플러그인으로 직접 한다.
- Chrome 재배치는 한 번에 한 작업자만 한다. 스타일 값을 동시에 바꾸면 서로 덮어쓴다.
- 재배치를 요청할 때는 파일, 페이지, 섹션과 노드 ID, 쓴 스타일, 회신받을 곳을 적는다.

## 0. 로컬 개발 플러그인

데스크톱 Figma 앱은 로컬 글꼴을 쓴다. 그래서 데스크톱 앱에서 실행한 플러그인은 `figma.loadFontAsync`로 Galmuri를 불러온다.

### 구성

플러그인은 저장소 루트의 `figma-plugin/` 폴더에 있다. 이 폴더는 저장소에 올리지 않는다. 제외 설정은 `.git/info/exclude`에 있다.

| 파일 | 내용 |
|---|---|
| `manifest.json` | 플러그인 이름 `PB Galmuri Job`, `documentAccess: dynamic-page` |
| `code.js` | 맨 위의 `JOB` 객체에 적힌 작업을 실행한다 |
| `run.ps1` | 데스크톱 Figma 창을 앞으로 가져온다. 그리고 Run last plugin 단축키 `Ctrl+Alt+P`를 보낸다 |

`JOB`의 필드는 아래와 같다.

| 필드 | 값 | 동작 |
|---|---|---|
| `edits` | `{ id, characters }` 목록 | 글자의 문구를 바꾼다 |
| `props` | `{ id, properties }` 목록 | 인스턴스의 속성을 바꾼다 |
| `styles` | `{ id, style }` 목록 | 글자에 텍스트 스타일을 연결한다. `style`은 스타일 이름이나 ID다 |
| `relayout` | `'none'`, `'selection'`, `'page'`, `'file'`, 노드 ID 목록 | 범위 안의 Galmuri 글자를 다시 배치한다 |
| `measure` | `{ key, characters, style }` 목록 | 임시 글자를 만들어 정답 폭과 높이를 기록한다. 임시 글자는 지운다 |

- 플러그인은 결과를 파일의 공유 데이터에 JSON으로 쓴다. 네임스페이스는 `pokebuddy`, 키는 `lastRun`이다.
- 결과 JSON에는 처리 개수, `measured`, `errors`가 있다.
- `edits`와 `styles`를 실행한 글자는 `relayout` 없이도 제 크기가 된다.

### 처음 한 번

1. 데스크톱 Figma 앱에서 pokebuddy 파일을 연다.
2. Plugins > Development > Import plugin from manifest…를 고른다.
3. `figma-plugin/manifest.json`을 고른다.
4. Plugins > Development > PB Galmuri Job을 한 번 실행한다.

- 브라우저 Figma에는 Development 메뉴가 없다. 개발 플러그인은 데스크톱 앱에서만 등록하고 실행한다.
- 4단계를 해야 PB Galmuri Job이 Run last plugin의 대상이 된다.

### 작업할 때

1. `code.js`의 `JOB`에 작업을 적는다.
2. `powershell -NoProfile -ExecutionPolicy Bypass -File figma-plugin/run.ps1`을 실행한다.
3. `use_figma`로 결과를 읽는다.

   ```js
   JSON.parse(figma.root.getSharedPluginData('pokebuddy', 'lastRun'))
   ```

4. `job`이 이번 작업 이름인지 본다. `errors`가 비었는지 본다.
5. 크기를 확인할 때는 같은 문구를 `measure`에 넣는다. 글자의 폭과 높이를 `measured` 값과 비교한다.
6. 끝나면 `JOB`을 빈 작업(`name: 'idle'`)으로 되돌린다.

- Figma는 실행할 때마다 `code.js`를 다시 읽는다. 다시 등록하지 않는다.
- `run.ps1`을 실행하면 Figma 창이 앞으로 온다. 사용자가 다른 창에서 입력 중이면 키가 섞일 수 있다.

### 실행 조건과 실패

| 증상 | 원인 | 대처 |
|---|---|---|
| `run.ps1`이 "Figma 데스크톱 창 없음"을 낸다 | 데스크톱 Figma가 꺼져 있다 | 사용자에게 데스크톱 Figma 실행을 요청한다 |
| `lastRun`의 `job`이 바뀌지 않는다 | 마지막 플러그인이 다른 플러그인이다. 또는 다른 파일 탭이 열려 있다 | 사용자에게 pokebuddy 탭에서 PB Galmuri Job을 한 번 실행하도록 요청한다 |
| `errors`에 "노드 없음"이 있다 | 노드 ID가 틀렸다 | `use_figma`로 ID를 다시 찾는다 |

## 1. `use_figma`로 새 글자를 만들 때

1. 글자를 Noto Sans KR로 만든다.
2. `characters`, `fills`(색 변수), `textAutoResize`, `resize`, `layoutSizing*`를 먼저 정한다.
3. 마지막에 `await text.setTextStyleIdAsync(<PB/Type 스타일 ID>)`를 부른다.
4. 스타일을 연결한 뒤에는 그 글자의 속성을 바꾸지 않는다. 바꾸면 글꼴 없음 오류가 난다.
5. 글자를 감싼 틀은 내용 높이(HUG)로 둔다. 고정 높이를 피한다.
6. 창 조작 기호(─ ☐ ✕, Inter)는 재배치 대상이 아니다.

- 글자를 다 만든 뒤 플러그인의 `relayout`에 섹션이나 노드 ID를 넣고 실행한다.
- 기존 Galmuri 글자의 문구를 바꿀 때는 플러그인의 `edits`를 쓴다.
- 재배치를 마친 뒤 `use_figma`로 글자를 새로 만들거나 바꾸면 그 글자는 다시 옛 배치가 된다. 그 글자를 다시 `relayout`한다.
- 플러그인을 실행할 수 없으면 Chrome에서 직접 입력한다. 글자를 고르고 Enter로 편집을 시작한다. Ctrl+A로 전체를 고르고 입력한 뒤 Esc를 누른다.

## 2. Chrome 재배치 준비 조건

2·3장은 플러그인을 실행할 수 없을 때의 대안이다.

| 조건 | 확인 방법 |
|---|---|
| Galmuri가 설치됐다 | `C:\Windows\Fonts`에 Galmuri 파일이 있다 |
| Figma Agent(`%LOCALAPPDATA%\FigmaAgent\figma_agent.exe`)가 실행 중이다 | `curl -H "Origin: https://www.figma.com" http://127.0.0.1:44950/figma/font-files`가 200과 Galmuri7·9·11·11-Bold·14를 돌려준다. Origin 헤더가 없으면 403이다 |
| Chrome이 figma.com에 로컬 네트워크 액세스를 허용했다 | Figma 탭의 JS에서 `fetch('http://127.0.0.1:44950/figma/font-files')`가 200이다 |
| Claude in Chrome 탭 묶음에서도 허용이 적용됐다 | 위 `fetch`를 Claude가 연 탭에서 실행한다 |

- 권한 요청 창이 떠 있으면 `fetch`가 응답 없이 멈춘다. 사용자에게 허용을 요청한다.
- Claude in Chrome은 여러 세션이 함께 쓸 수 있다. 탭 묶음은 세션마다 따로다.
- UI로도 확인할 수 있다. 글자를 고르고 스타일 연결을 푼다. 글꼴 칸에 노란 `A?`(글꼴 없음)가 없어야 한다. 확인한 뒤 Ctrl+Z로 되돌린다.

## 3. Chrome 재배치 절차

Chrome UI에서 한다. Figma 웹 페이지의 JS에는 `figma` 객체가 없다.

### 시작 전 기록

1. `use_figma`로 스타일 값을 기록한다.

   ```js
   (await figma.getLocalTextStylesAsync()).map((s) => s.name + ' ' + s.lineHeight.value)
   ```

2. 결과가 아래 원래 값과 같은지 본다.

| 스타일 | 크기 / 줄 높이 |
|---|---|
| Title | 24 / 32 |
| Heading | 15 / 22 |
| Body | 12 / 18 |
| Label/Semibold | 12 / 18 |
| Label/Regular | 12 / 18 |
| Caption/Regular | 12 / 16 |
| Caption/Semibold | 12 / 16 |
| Badge/Semibold | 10 / 14 |
| Micro/Semibold | 10 / 14 |

3. 옛 배치 글자가 쓰는 스타일을 센다(아래 "끝났는지 확인"의 기준). 그 스타일만 재배치한다.
4. Micro 글자를 새로 만들었으면 Micro도 재배치한다. Micro는 옛 배치도 높이가 14라 높이로 구분되지 않는다.

### 스타일 하나 재배치

1. 캔버스 빈 곳을 누르거나 Esc를 눌러 선택을 푼다. 오른쪽 패널에 Text styles > PB > Type 목록이 보인다.
2. 대상 스타일 행에 마우스를 올린다. 오른쪽 끝의 편집 아이콘을 누른다. 첫 클릭에 툴팁만 뜨면 한 번 더 누른다.
3. 'Edit text style' 창의 Line height 칸을 더블클릭한다. Ctrl+A를 누르고 원래 값+1을 입력한 뒤 Tab을 누른다.
4. 2초 기다린다. `use_figma`로 값이 +1이 됐는지 확인한다.
5. 같은 칸을 다시 더블클릭한다. Ctrl+A를 누르고 원래 값을 입력한 뒤 Tab을 누른다.
6. `use_figma`로 원래 값으로 돌아왔는지 확인한다.

- 입력은 한 번에 하나씩 하고 매번 데이터로 확인한다. +1과 원래 값을 한 번에 연달아 넣으면 두 번째 입력이 자주 빠진다.
- Enter보다 Tab이 안정적이다.
- 패널 표시는 몇 초 늦게 바뀔 수 있다. 데이터 값을 기준으로 판단한다.

### 끝났는지 확인

1. `use_figma`로 페이지의 글자 가운데 `textStyleId`가 있고 `lineHeight`가 PIXELS인 것을 고른다.
2. 높이가 줄 높이의 배수가 아닌 글자는 옛 배치다. 예: Caption 글자 높이 14, 줄 높이 16.
3. 옛 배치 글자가 0개가 될 때까지 해당 스타일을 재배치한다.
4. Title 24 글자는 크기로 바로 보인다. 옛 배치는 23×14, 재배치 뒤는 48×32다.
5. Chrome 화면 캡처로 넘침과 겹침을 본다. `get_screenshot`은 서버에서 그려 Galmuri가 아닌 글꼴로 보인다. 넘침 판단에 쓰지 않는다.

## 4. 재배치 뒤 정리

이 장은 두 방법에 모두 적용한다.

- 스타일 값 변경은 파일 전체에 적용된다. 그 스타일을 쓰는 모든 글자가 다시 배치된다. 이미 맞던 글자는 결과가 같다.
- 글자가 커져 고정 높이 틀에서 넘칠 수 있다. 예: 떼어 낸 Dialog의 Body, 말풍선의 body.
  - 틀의 `layoutSizingVertical`을 `HUG`로 바꾼다.
  - 고정 높이 자동 배치 틀은 `primaryAxisSizingMode`를 `AUTO`로 바꾼다. 예: Dialog Wide는 고정 높이 620이었다.
- 인스턴스 안 글자는 컴포넌트 기준으로 배치된다. 대개 이미 맞다.

## 5. 실패 증상과 대처

| 증상 | 원인 | 대처 |
|---|---|---|
| 노란 `A?`가 뜬다. 굵기·크기 칸이 흐리다 | 브라우저가 Figma Agent에 닿지 못한다 | 2장의 준비 조건을 확인한다 |
| JS `fetch`가 멈춘다 | 권한 요청 창이 떠 있다 | 사용자에게 허용을 요청한다 |
| 줄 높이를 바꿨는데 글자 크기가 그대로다 | 그 글자가 다른 스타일이거나 스타일 연결이 없다 | 글자의 `textStyleId`를 확인한다 |
| 값이 +1로 남았다 | 두 번째 입력이 빠졌다 | 편집 창을 다시 열어 원래 값을 넣고 데이터로 확인한다 |
| 편집 창이 사라졌다 | 좌표가 빗나가 캔버스를 눌렀다 | 창 크기가 바뀌면 좌표도 바뀐다. 캡처로 좌표를 다시 잡는다 |

## 하지 않는 것

- 파일 전체 스타일을 Inter 등으로 잠시 바꾸지 않는다. 되돌리는 작업이 따로 생긴다.
- 두 작업자가 같은 스타일 값을 동시에 바꾸지 않는다. 서로 덮어쓴다.
