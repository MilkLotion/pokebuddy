# 모듈 책임과 저장 구조

이 문서는 모듈 책임과 경계, 저장 구조, 명령 계약을 적는다.

## 읽는 기준

이 문서는 규칙을 어느 모듈이 소유하고 어디에 저장하는지 정한다. 게임 규칙 자체는 [현재 설계](../design.md)와 [게임 규칙](game.md)을 따른다. 화면은 [UI 컴포넌트 계약](ui-components.md)을 따른다. 저장과 명령의 기능 계약은 [저장과 명령](game.md#8-저장과-명령)을 따른다.
`[스펙 미확정]`은 제안이다. 구현 전에 확정한다.

## 경계 원칙

| 원칙 | 내용 |
|---|---|
| 규칙은 메인 프로세스 | 메인 프로세스가 잔액, 대상, 소유, 조건을 검사한다. 렌더러는 저장을 직접 다루지 않는다. |
| 도메인 모듈은 순수 함수 | 도메인 모듈은 현재 상태와 입력을 받아 결과와 바뀔 상태를 계산한다. 파일을 읽거나 쓰지 않는다. 시각은 인자로 받는다. |
| 저장 쓰기는 거래 실행기만 | 거래 실행기가 검사 결과를 모아 한 번에 저장한다. 요청 ID로 중복 반영을 막는다. |
| 데이터는 `data/` | 종, 가격, 조건표 같은 콘텐츠는 데이터 파일에 둔다. 규칙 코드에 숫자를 직접 쓰지 않는다. |
| 창은 표시만 | 놀이공간 창과 설정창은 상태를 그린다. 상태 변경은 명령으로 보낸다. |

## 모듈 표

| 폴더 | 책임 | 소유하지 않는 것 | 흐름 |
|---|---|---|---|
| `src/tx` | 거래 실행과 커맨드 처리기(`dispatcher.ts` — 메뉴·트레이·설정창·CLI 의 요청을 한 곳에서 받아 나눈다). 명령 검사 순서, 상태 반영, 저장 쓰기, 요청 ID 기록, 실패 시 이전 상태 유지 | 게임 규칙 계산 | SC-01~11 |
| `src/party` | 파티 칸 수와 잠금, 칸 배치·교체, 표시·숨김, 박스 보관 | 개체 육성 수치 | SC-05, 07, 09 |
| `src/box` | 박스 여러 개와 30칸, 박스 더하기와 순서, 빈 칸 수 | 파티 배치 | SC-07, 09 |
| `src/egg` | 알별 타이머, 부화 가능 상태, 직접 열기 결과 판정 | 개체 생성 후 배치 | SC-03, 04 |
| `src/bag` | 도구 재고, 사용 대상과 조건 검사, 사용 결과 계산 | 상점 가격 | SC-02, 06 |
| `src/achievement` | 업적 조건 달성 판정, 미수령·수령 완료 상태, 보상 내용 | 보상 지급 실행 | SC-05, 09 |
| `src/tutorial` | 튜토리얼 시작 계기, 진행·스킵·완료 상태, 동시 조건의 순서 | 화면 그리기 | SC-01, 03, 04, 05, 10 |
| `src/state` | 시간에 따른 친밀도·만복도·포인트 적립, 밥 주기 쿨타임, 버프 잔여 시간, 실행 상태별 정지 | 파티 배치, 재고 | SC-02, 07, 10 |
| `src/dex` | 도감 해금·획득 기록, 종 데이터, 진화 조건 판정, 이로치 기록 | 개체 보유 | SC-04, 06, 09 |
| `src/shop` | 상품 목록, 가격, 구매 가능 여부 | 포인트 차감 실행 | SC-03, 06, 09 |
| `src/save` | 저장 파일 읽기·쓰기, 정규화, 백업, 손상 격리, 버전 변환 | 게임 규칙 | SC-10 |
| `src/terminal` | 놀이공간 표시 위치, 창 추적, 영역 | 게임 규칙 | SC-02, 08 |
| `src/motion` | 움직임과 반응 | 게임 규칙 | SC-02 |
| `src/agents` | 에이전트 감지와 사용량 | 보상 지급 | SC-11 |
| `src/find` | 줍기 — 마리별로 조건을 채운 시간으로 주울지 판정, 결과 고르기(포인트·도구·진화용 도구·포켓몬), 반영과 최근 기록. 수치는 `rules.ts` | 저장 쓰기(주운 틱에 `src/tx/game.ts` `find` 가 쓴다), 1초 틱마다 굴림 호출과 깨어 있는 마리 판정(`src/main/app/ticks.ts` `clock`, 무대) | — |
| `src/notify` | 알림 배너 줄 세우기, 같은 상태 한 번 규칙, 표시 순서 | 상태 판정 | SC-04, 05, 06, 10 |
| `src/main` | 창, 트레이, 우클릭 메뉴, 명령 수신, 전역 시계(`app/clock.ts`) | 게임 규칙 계산, 배너 순서 | 전체 |
| `src/renderer` | 설정창, 놀이공간, 도감·파티 상세 기기 창 그리기 | 저장 접근 | 전체 |
| `src/cli` | `pokebuddy game` 게임 명령 진입. 명령 통로 `mailbox` 로 보낸다 | 저장 쓰기 | SC-11 |
| `src/hooks` | CLI 훅 이벤트를 세션별 상태 파일로 남긴다 | 게임 규칙 | SC-11 |
| `src/shared` | 모듈 사이의 공유 타입과 시계 | 규칙 | 전체 |
| `src/tools` | 데이터 빌드와 자체 검사(`selftest-*`) | 앱 실행 | — |
| `src/online` | 온라인 공통과 계정. `client`는 교환·계정·클라우드 저장이 함께 쓰는 Supabase 클라이언트, `account`는 아이디 가입·로그인·로그아웃·이름·삭제 요청, `github`는 GitHub 로그인(`127.0.0.1` 임시 서버 PKCE), `cloud`는 클라우드 저장(활성 기기·자동 저장·오프라인·다른 PC 에서 시작·연결 끊김 확인·잠듦·업데이트 필요·저장 정보 분실), `session`은 익명·로그인 세션을 한 곳에서 만들고 부팅 때 세션 유무를 확인한다(`probe`), `handoff`는 로그인 직전 익명 저장 이관 티켓을 받고 로그인 뒤 익명 저장을 옮긴다(`begin_handoff`·`adopt_anonymous`) | 저장 파일 쓰기(메인이 받은 저장을 검사·백업 뒤 바꾼다), 창 | — |
| `src/mail` | 우편함의 선물 검사와 저장에 넣기·읽음 기록(순수 함수). 명령 통로 `src/save/command-channel.ts` 와 다르다 | 서버 호출(`src/online/mail-inbox.ts` 가 한다), 창 | — |
| `src/trade` | 친구 교환. `core`는 올리기·받기 검사와 로컬 잠금·반영(순수 함수), `net`은 Supabase 호출과 실시간 신호, `session`은 교환 흐름(확정·완료·닫힘·복구), `config`는 서버 설정·데이터 버전·링크 | 저장 쓰기(거래 실행기의 `trade.*`가 한다), 창 | — |

친구 교환의 Electron 쪽 입구는 `src/main/services/trade.ts`(개발용 시험 장치)이고, 교환 모달 화면 값은 `src/view/trade-screen.ts` 가 만든다. 서버 SQL 은 `supabase/migrations/`에 있다.
교환 제안의 값은 서버가 만든다(`set_offer`). 앱이 보낸 개체 값은 서버 저장에 올렸는지 확인하는 데만 쓴다 — 종·이로치·성격이 다르거나 레벨·경험치가 서버보다 크면 `TRADE_PET_NOT_SYNCED`다. 채널에는 지문(`id`·`since`)으로 찾은 서버 저장 개체의 값을 넣는다. 서버 저장이 검증받지 않은 계정(`trust = unverified` — 첫 저장 분류·관찰 모드 위반)은 `TRADE_SAVE_UNVERIFIED`로 제안하지 못한다. 교환이 끝나는 순간 두 사람이 받은 제안을 `cloud_private.trade_receipts`에 남긴다 — 두 사람이 반영하면 채널의 제안 값은 지워진다.
우편함의 받기 흐름은 `src/online/mail-inbox.ts`(`createMailInbox`)다. 메인이 넘긴 공유 클라이언트로 `list_mail`·`claim_mail` 을 부르고, 받은 선물을 거래 실행기의 `mail.apply` 로 넣는다. 우편함 모달의 화면 값은 `src/view/mail.ts` 가 만든다. 서버 SQL 은 `supabase/migrations/20260929100000_mail.sql` 이다.
계정·클라우드 저장의 Electron 쪽 입구는 `src/main/services/online.ts`다. 공유 클라이언트를 한 번 만들어 교환에 넘기고, `cloud.json` 읽기·쓰기와 받은 저장의 v3 검사·백업·교체를 맡는다. 계정 삭제는 서비스 역할 키가 필요해 Edge Function `supabase/functions/delete-account`가 한다. 앱과 저장소에는 서비스 역할 키가 없다.
클라우드 저장 올리기는 Edge Function `supabase/functions/upload-save`를 거친다(`src/online/cloud.ts`). 앱이 `upload_save` RPC 를 직접 부르면 `CLOUD_UPDATE_REQUIRED`다. 검증은 아래 [서버 저장 검증](#서버-저장-검증)을 따른다.
부팅하면 `src/main/services/online.ts`가 세션을 확인한다. 세션이 있으면 그 계정(익명·로그인)으로 클라우드 저장을 켠다. 세션이 없고 `cloud.json`의 `owner`도 없으면 익명 계정을 만든다. 세션이 없는데 `owner`가 있으면 저장 정보 분실로 보고 앱이 분실 창을 띄운다. 망 오류로 확인하지 못하면 분실로 보지 않고 60초 뒤 다시 확인한다.
로그아웃·계정 삭제·분실 창 `처음부터`는 `save.json`을 `save.json.<signout|delete|fresh>-<시각>.bak`으로 옮기고 `cloud.json`을 비운 뒤 앱을 다시 켠다. 백업하지 못하면 새로 시작하지 않는다(`SAVE_BACKUP_FAILED`).
세션 저장 `createSessionStorage`(`src/online/session-storage.ts`)는 `~/.claude/pokebuddy/online/session.bin`을 OS 키 저장소로 암호화한다. 키 저장소는 메인이 Electron `safeStorage`로 채운다(`src/main/services/vault.ts`). 저장 키도 같은 키 저장소를 쓴다. 풀지 못한 파일은 첫 쓰기 전에 `session.bin.unreadable-<시각>.bak`으로 옮긴다. 암호화를 쓸 수 없는 환경이면 같은 폴더의 `session.json`(권한 0600)에 평문으로 둔다.
앱 업데이트는 `src/main/update/updater.ts`가 맡는다. `electron-updater`로 GitHub Release 의 `latest.yml`을 보고 새 버전을 받는다. Windows 설치본과 Mac 앱에서 켠다. Windows 는 `electron-updater`, Mac 은 자체 엔진 `src/main/update/mac-updater.ts` 다. Mac 앱은 ad-hoc 서명이라 electron-updater 의 mac 설치기(Squirrel.Mac)를 쓸 수 없다. 두 엔진은 같은 이벤트를 내고 화면 흐름은 하나다. 서버가 이 앱 버전을 거절하면(`CLOUD_UPDATE_REQUIRED`) 앱은 주기를 기다리지 않고 실행마다 한 번 바로 확인한다(`urgentStep`). 새 버전이 준비되면(`ready`·`manual`) `새 버전으로 바꿔야 해요` 알림 창을 실행마다 한 번 띄운다(`src/main/app/halt-dialog.ts` `askUpdateRequired`). `지금 다시 시작`(mac 수동은 `받기`)은 설정의 `다시 시작`과 같다. `나중에`(Esc)는 닫기만 하고 게임을 멈추지 않는다.
두 PC 멈춤·저장 정보 분실·저장 잠김·이용 정지·업데이트 필요 창은 게임 디자인의 알림 창으로 띄운다(`src/main/windows/alert-window.ts`, `src/renderer/alert.html`). 테두리 없는 항상 위 창이 주 화면 가운데 위쪽에 뜬다. 단추 답·Esc(취소 단추)·시간 초과·밖에서 닫기의 뜻은 `src/main/app/halt-dialog.ts`가 정한다. 단추에는 처음 포커스를 두지 않아 Enter 로는 답하지 않는다(OS 대화상자는 Enter 가 0 번 단추였다). 알림 창이 3초 안에 그려지지 않거나 렌더러가 죽으면 OS 대화상자로 띄운다(`src/main/windows/alert-ask.ts`). 창의 글자는 `src/view/halt.ts`가 만든다. 보이기 전에 밖에서 닫히면(앱 종료) 닫힘으로 끝낸다.
패치노트는 `src/main/update/patch-notes.ts`가 `data/patch-notes.json`에서 읽는다. 업데이트 뒤 처음 띄울 버전은 `save.json`과 같은 폴더의 `notes-seen.json`(`seen`: 마지막으로 띄운 버전)으로 가린다.

알림 배너의 상태 판정은 도메인 모듈이 한다. `src/notify`는 줄 세우기와 표시만 맡는다.

## 전역 시계

앱의 시간·확률 계산은 전역 시계(`src/main/app/clock.ts`)의 1초 틱을 본다(2026-09-29 사용자 결정 "앱 자체의 전역으로 타이머 기능 만들고, 그게 1초마다 갱신").
틱마다 그 순간의 시각 `now` 와 앞 틱과의 간격 `gap` 을 준다. 큰 틈은 있는 그대로 주고, 자르는 규칙은 받는 쪽이 가진다.

| 1초 틱이 하는 일 | 주기 |
|---|---|
| 게임 시간 적용(`game.tick`) — 만복도·친밀도·포인트·쿨타임·버프·알 준비 | 1초. 파일은 15초 |
| 줍기 굴림(`src/find/roll.ts` `rollHits`)과 그 자리 저장(`game.find`) | 1초 |
| 에이전트 작업 시간 적립 | 1초 |
| 배고픔 말풍선, 알림 배너 줄(`src/notify`), 바탕화면 튜토리얼 | 1초 |
| 설정창에 `manage:clock`(`{ now }`) 보내기 — 설정창이 스냅샷을 다시 읽는다. 파티 상세 기기 창은 설정창이 바뀐 값을 다시 보낸다 | 1초 |
| 저장 다시 읽기, 남은 안내(`hook-upkeep`), 놀이공간·점프 목록·트레이 | 15초 |

예외: 무대 그리기 40ms(`STAGE_RULES.tickMs`)와 에이전트 상태 폴링 500ms(`STAGE_RULES.statePollMs`)는 화면·입력용이라 이 시계를 쓰지 않는다. 둘 다 게임 값을 바꾸지 않는다.
스냅샷 한 번은 약 5ms 다(상점 목록 포함, 2026-09-29 측정). 설정창이 떠 있을 때만 1초마다 만든다.

## 거래 실행기

거래 실행기는 명령 하나를 다음 순서로 처리한다.

1. 요청 ID를 확인한다. 이미 완료한 요청이면 저장된 결과를 그대로 돌려준다.
2. 현재 저장 상태를 읽는다.
3. 도메인 모듈로 검사와 결과를 계산한다.
4. 모든 검사를 통과하면 바뀔 상태를 한 번에 저장한다.
5. 실패하면 아무 상태도 바꾸지 않고 실패로 끝낸다. 재시도 버튼은 제공하지 않는다.

거래로 묶는 동작과 실패 시 유지할 상태는 [거래 실패 원칙](game.md#구매사용보상-거래의-실패-원칙)을 따른다.
저장 명령은 저장이 끝나면 답한다. 무대 다시 그리기는 기다리지 않는다. 진화와 모습 바꾸기는 예외다. 바뀔 모습의 그림을 먼저 받고, 받지 못하면 저장을 바꾸지 않는다.
요청 ID와 결과는 저장의 `tx` 영역에 둔다. 최근 200건 또는 24시간 중 큰 쪽을 남긴다. 거래는 한 번에 하나만 처리한다. 들어온 순서대로 줄을 세운다. 창이 여러 개여도 저장 쓰기는 주 프로세스 하나가 한다.

## 저장 구조

저장 형식은 `SaveV3`다. 기존 `SaveV2` 파일은 열 때 한 번 변환한다. 변환 전 원본을 백업한다.

| 영역 | 담는 것 |
|---|---|
| `pets` | 개체별 식별자, 종, 이로치, 성격, 레벨, 누적 경험치, 친밀도, 만복도, 남은 버프, 밥 주기 쿨타임 |
| `party` | 칸 수, 칸별 개체 식별자 또는 빈 칸, 숨김 여부, 잠긴 칸의 해제 출처 |
| `boxes` | 박스 목록, 박스별 30칸의 개체 식별자 |
| `eggs` | 알별 식별자, 후보 종 범위, 준비 시간, 부화 가능 여부 |
| `bag` | 도구별 보유 수량 |
| `points` | 보유 포인트와 적립 부분 진행 |
| `dex` | 종별 해금·획득·이로치 획득 |
| `achievements` | 업적별 달성·미수령·수령 완료 |
| `tutorials` | 튜토리얼별 미시작·진행 중·스킵·완료 |
| `settings` | 표시, 동작, 언어, 시작, 놀이공간 영역, 알림 소리 |
| `tx` | 완료한 요청 ID와 결과 |
| `trade` | 확정했지만 아직 반영하지 않은 교환 하나 |
| `find` | 최근 줍기 기록 |

로그인·클라우드 동기화 정보는 `save.json`과 같은 폴더의 `cloud.json`에 둔다. `save.json`에는 필드를 더하지 않는다(`src/online/cloud.ts`).

| `cloud.json` 필드 | 뜻 |
|---|---|
| `deviceId` | 설치마다 한 번 만드는 무작위 ID. 서버의 활성 기기와 견준다 |
| `userId` | 이 저장을 올리는 계정. 로그아웃하면 `null`. 다른 PC 에서 시작해도 남긴다 |
| `owner` | 로컬 저장이 속한 계정. 로그아웃하면 새로 시작하며 비운다. 다른 계정으로 로그인했고 그 계정의 서버 저장이 없으면 이 PC 저장을 올리지 않는다(`CLOUD_OWNER_OTHER`). 주인이 익명 계정이면 로그인 계정 첫 저장으로 다시 묶는다 |
| `ownerKind` | `owner`의 종류. `anonymous` 또는 `member`. 저장 정보 분실 창의 단추를 가른다 |
| `handoff` | 옮기지 못한 익명 저장 이관 티켓(`ticket`·`anon`·`expiresAt`). 로그인 계정으로 켤 때 다시 옮긴다 |
| `syncedRev` | 마지막으로 서버와 맞춘 판 번호. 서버 판 번호가 다르면 서버 저장을 받는다 |
| `dirty` | 마지막 올리기 뒤 저장이 바뀌었다. 연결되면 자동으로 올린다 |
| `superseded` | 다른 PC 에서 시작했다. 다음 실행은 판 번호와 관계없이 서버 저장을 받는다 |
| `pendingOp` | 보냈지만 결과를 모르는 올리기의 멱등 키. 다시 보낼 때 같은 키를 쓴다 |
| `lastSavedAt` | 마지막으로 올린 시각 |

옛 `cloud.json` 의 `offlineDirty` 는 읽지 않는다. 옛 파일에 `owner` 가 없으면 `userId` 를 `owner` 로 본다. 옛 파일에 `ownerKind` 가 없으면 `member` 로 본다.
받은 서버 저장으로 로컬 저장을 바꾸기 전 `save.json.cloud-<시각>.bak`을 남긴다.

### 저장 파일 암호화

`save.json`은 AES-256-GCM 으로 암호화한다(`src/save/crypt.ts`). 목적은 메모장으로 저장을 고치지 못하게 하는 것이다. 앱을 분석하면 키를 찾을 수 있다. `save.key`를 지우고 평문 저장을 넣으면 새 키가 그 평문을 기존 저장으로 받는다. 조작한 값은 서버 검증이 막는다.

| 항목 | 규칙 |
|---|---|
| 파일 형식 | `PBS1` 머리 4바이트, IV 12바이트, 인증 태그 16바이트, 암호문. 한 바이트라도 바뀌면 풀지 못한다 |
| 키 | 설치마다 무작위 32바이트. Electron `safeStorage`(Windows DPAPI, mac 키체인)로 감싸 `save.json`과 같은 폴더의 `save.key`(`v`·`key`)에 둔다. 감싼 값 안에 키와 `migrated`(기존 평문 저장을 옮겼나)가 있다 |
| 키 준비 | 앱이 켜질 때 게임을 만들기 전에 한 번 푼다(`src/save/key.ts`). 그 뒤 저장 읽기·쓰기는 메모리의 키로 동기 처리한다 |
| 기존 평문 저장 | `migrated`가 거짓이면 `save.json.plain-<시각>.bak`을 남기고 암호화해 다시 쓴다. 옮기지 못하면 이번 실행은 평문으로 돌고 다음 실행에 다시 옮긴다 |
| 풀지 못한 저장 | 파손과 같다. `save.json.broken-<시각>.bak`으로 옮기고 `save.json.lost`에 격리 시각(ms)을 남긴다. 이름에 시각이 있어 앞선 격리 파일을 덮지 않는다 |
| 키가 있는데 평문 | 손으로 고친 저장으로 본다. 파손과 같게 옮기고 표시를 남긴다 |
| `save.key`를 읽지 못함 | 잠김·권한 오류다. 이번 실행은 키 없이 돈다. 저장은 옮기지 않고 `locked`로 지킨다. 다음 실행에 다시 읽는다 |
| `save.key`를 풀지 못함 | 키 저장소가 풀기를 거부했다(허용 창 거부·키체인 초기화). 저장을 옮기지 않고 이번 실행은 키 없이 돈다(`denied`) |
| `save.key` 모양이 틀림 | 키와 저장을 `.unreadable-<시각>.bak`으로 옮기고 새 키로 시작한다(`reset`). 표시를 남긴다. 옮기지 못하면 옛 키를 덮지 않고 키 없이 돈다 |
| 저장 잠김 창 | 키 없이 도는데(`denied`·`busy`·`unavailable`) 암호화 저장이 있으면 게임을 만들기 전에 `저장을 열지 못했어요` 창을 띄운다. `종료`(Esc)는 저장을 그대로 두고 끝낸다. `새로 시작`은 키와 저장을 `.unreadable-<시각>.bak`으로 옮기고 표시를 남긴 뒤 키를 다시 준비한다(`src/main/app.ts`, `src/main/app/halt-dialog.ts` `askSaveLocked`) |
| 키 저장소 없음 | 평문으로 돈다. 이미 암호화된 저장은 읽지 않고 덮어쓰지도 않는다(`locked`) |
| `save.json.lost` | 클라우드가 `cloud.json`을 읽을 때 처리한다(`src/online/cloud-file.ts`). `syncedRev`를 `-1`로 바꾼 상태를 `cloud.json`에 먼저 쓰고 표시를 지운다. 서버 저장이 있으면 다음 맞추기에서 받는다. 격리 뒤에 올린 적이 있으면(`lastSavedAt` > 격리 시각) 표시만 지운다. 격리 뒤 새로 고른 첫 포켓몬 저장은 `save.json.cloud-<시각>.bak`으로 남는다 |

### 서버 저장 검증

올린 저장은 Edge Function `upload-save`가 직전 서버 저장과 비교한다. 규칙은 `src/verify/save-rules.ts`이고, 상한 수치는 [밸런스 수치](balance.md#서버-검증-상한)에 있다.

| 항목 | 규칙 |
|---|---|
| 순서 | 토큰으로 사용자 확인 → `save_verify_context`(직전 저장·rev·틈·받은 편지·받은 교환 제안·시드·정지·설정) → 규칙 비교 → `accept_save`. rev CAS·활성 기기·교환 원장은 `accept_save` 안에서 본다 |
| 틈 | 서버 시각 기준. `cloud_saves.last_accepted_at`부터 지금까지, 72시간(`verify_max_gap_hours`)에서 자른다 |
| 비교 대상 | 같은 rev 위의 요청만 비교한다. rev 가 다르면 멱등 재전송(마지막 op)만 받고 나머지는 `CLOUD_REV_CONFLICT`다. `accept_save` 는 비교에 쓴 rev(`p_checked_rev`)가 지금 rev 와 같을 때만 기존 행에 쓴다. 첫 저장은 `trust`(fresh·legacy·unverified) 분류만 한다 |
| 오류 | `CLOUD_*` 코드, 토큰 무효 401 `AUTH_TOKEN`, 잠깐 답 없음 503 `SERVER_BUSY`, 그 밖 500 `SERVER_ERROR`. 앱은 502·503·504·전송 실패만 오프라인으로 본다 |
| 관찰 모드 | `verify_mode = observe`(기본). 위반이 있어도 받는다. `cloud_private.save_violations`에 적고 `trust`를 `unverified`로 둔다 |
| 거부 모드 | `verify_mode = enforce`. 위반을 적고 계정을 이용 정지한 뒤 `CLOUD_SAVE_REJECTED`(409)를 돌려준다. 앱은 정지와 같게 멈춘다 |
| 권한 | `accept_save`·`save_verify_context`·`reject_save`·`admin_*`는 service_role 전용이다 |
| 규칙 복사본 | Edge Function(Deno)은 `supabase/functions/_shared/save-rules.ts`·`verify-data.json`을 쓴다. `node dist/tools/data/build-verify.js`(빌드 뒤)가 `src/verify/save-rules.ts`와 `data/`·규칙표에서 만든다. `selftest-verify`가 최신인지 본다 |
| 관리 | `admin/admin.cjs violations`(위반 목록), `verify [--mode] [--margin] [--yes]`(설정) |
| 이용 정지 | 서버 `cloud_private.account_holds`. 거부 모드에서 `reject_save`가 위반을 적고 정지를 건다. 계정 도우미(`require_account`)·교환 도우미(`require_uid`)·편지 받기·`upload-save`가 정지된 계정을 `CLOUD_ACCOUNT_HELD`로 거절한다. `delete-account`도 정지 중이면 거절한다. 앱은 이 코드(또는 `CLOUD_SAVE_REJECTED`)를 받으면 `cloud.json`의 `accountHeld`를 켜고 맞춘 rev 를 잊은 뒤(풀리면 서버 저장을 받는다) 게임을 멈추고 정지 창을 띄운 뒤 끝난다. 서버에 닿기 전(오프라인·세션 분실)에 `accountHeld`가 켜져 있어도 같다. 기기 연결(claim)이 계정 확인을 통과하면 `accountHeld`를 지운다. 관리: `admin.cjs holds`·`hold add|release <계정> --yes` |
| 계정 시드 | 서버 `cloud_private.account_seeds`에 계정마다 시드가 있다. 앱은 온라인이 되면 `account_seed()`로 받아 `cloud.json`의 `seed`·`seedOwner`에 둔다. 알 열기 난수는 `seededRand(seed, "egg:<알 id>")`다(`src/verify/save-rules.ts`). 검증은 열린 알마다 `rollEgg`로 다시 계산해 새 저장과 대조한다(`egg-roll`). 직전에 받은 저장보다 나중에 만든 시드는 문맥에 싣지 않는다 — 시드를 받기 전에 연 알은 대조하지 않는다. 시드는 사용자 PC 에 있어 다음 결과를 미리 계산할 수 있다. 알의 id·종류·후보를 고치면 `egg` 위반이다 |

백업 파일은 `save.json`을 복사하거나 옮겨 만든다. 그래서 키를 쓴 뒤의 백업도 암호화되어 있다. 암호화 전에 만든 평문 백업은 앱이 읽지 않으므로 그대로 둔다.
CLI(`pokebuddy status`·`companion`)는 저장 내용을 읽지 않는다. 첫 실행 여부는 `save.json`이 있는지로 본다.
개발 실행과 업데이트 시험 빌드는 `POKEBUDDY_SAVE_CRYPT=off`이면 새 키를 만들지 않는다. 저장을 직접 읽는 E2E·개발 도구가 쓴다. 이미 `save.key`가 있으면 그 키를 쓴다.

### 영역별 필드

필드의 기준은 [저장 v3 타입](../../src/shared/save-v3.ts)이다. 시각은 ms다. 멈추는 값은 남은 시간으로 저장한다. 멈춤 규칙은 [실행 상태별 시간](game.md#실행-상태별-시간)을 따른다.

| 영역 | 필드 |
|---|---|
| `meta` | `v: 3`, `savedAt`, `lastTickAt` |
| `pets[]` | `id`, `species`, `stage`, `shiny`, `nature`, `gender`(`male`·`female`·`none`, 2026-09-30 추가. 옛 저장은 열 때 정한다), `size`, `level`, `exp`, `affinity`(친밀도 누적), `fullness`(만복도 0~100), `mood`, `feedCooldownMs`(남은 시간), `buffs[]`(`kind`, `remainMs`), `since`, `evolved[]`, `daily`, `mega`(선택 필드, 2026-10-02 추가: `bondMs` 친밀도 100 뒤 파티에서 보낸 시간, `care` 친밀도 100 뒤 돌봄 횟수, `stone` 메가스톤, `on` 지금 메가 모습의 슬러그) |
| `party` | `slots[6]`. 칸마다 `state`(`pokemon`·`empty`·`locked`), `petId`, `hidden`, `unlockBy`(`shop`·`achievement`). `unlockBy` 는 경로별로 더 열 수 있는 칸 수만 센다. 칸은 앞에서부터 연다(`src/party/slots.ts`) |
| `boxes[]` | `id`, `name`, `slots[30]`(개체 식별자 또는 빈 칸) |
| `eggs[]` | `id`, `boughtAt`, `remainMs`(준비 남은 시간), `ready`, `candidates[]`(구매 당시 후보 종). `actions`·`careCooldownMs`는 옛 판 호환용이며 쓰지 않는다 |
| `bag` | 도구 식별자별 보유 수량 |
| `points` | `balance`, `progressMs`(다음 1포인트까지의 부분 진행) |
| `dex` | `unlocked[]`, `obtained[]`, `shinyObtained[]`, `discovered`(옛 판 호환용. 쓰지 않으며 읽은 값을 그대로 둔다), `megaOpened[]`(선택 필드, 2026-10-02 추가: 메가스톤이 생긴 적이 있는 종) |
| `achievements` | 업적 식별자별 `achievedAt`, `claimedAt` |
| `tutorials` | 튜토리얼 식별자별 `state`(`none`·`active`·`skipped`·`done`)와 `steps`(단계별 완료 여부) |
| `settings` | `language`, `startOnLogin`, `sound`, `sleepAfterMin`, `playArea`(`mode`, `rect`), `display` |
| `agents` | 기존 `AgentStats`를 유지한다 |
| `totals` · `log` | 기존 구조를 유지한다. `log`는 최근 200건 |
| `tx` | 완료한 요청의 `id`, `at`, `result`. 최근 200건 또는 24시간 중 큰 쪽을 남긴다 |
| `legacy` | `nick`, `look`처럼 새 화면에서 쓰지 않는 값. 지우지 않고 보존한다 |
| `mail` | `applied`: 선물을 넣은 편지 id, `read`: 읽은 편지 id. 각각 최근 200개. 선택 필드다 |
| `find` | `seq`(지금까지 만든 기록 수), `log[]`(최근 20건: `id`, `at`, `petId`(주운 개체), `species`(그때 종), `kind`(`points`·`item`·`evo`·`pokemon`), `ref`(도구 식별자·종), `amount`(포인트 양, 그 밖은 1), `newPetId`(데려온 개체)). 알림 배너 키는 `find:<id>` 다. 옛 판의 `activeMs` 는 읽을 때 버린다. 선택 필드라 저장 형식 번호는 그대로 3이다 |
| `trade` | `pending`: 없으면 `null`. 있으면 `channelId`(서버 채널), `petId`(올린 개체), `offerRev`(확정한 제안 판), `received`(받은 개체 값). 확정할 때 쓰고, 반영하거나 닫히면 `null`로 돌린다. 걸린 개체에는 값을 바꾸는 명령(`bag.use`·`evolve`·`pet.form`)이 `trade-locked`로 거절된다. 자리만 바꾸는 명령과 돌봄·숨기기는 막지 않는다 — 반영은 그때의 자리를 찾아 들어간다. 선택 필드라 저장 형식 번호는 그대로 3이다 |

### V2 → V3 변환 규칙

| V2 | V3 | 규칙 |
|---|---|---|
| `party: Pet[]` | `pets[]` + `party.slots` | 개체는 `pets`로 옮긴다. 순서대로 칸에 넣는다. `shown`은 칸의 `hidden`으로 뒤집어 옮긴다 |
| `slots` | `party.slots` 길이 | 남은 칸은 `locked`로 둔다. 기본 2칸을 넘는 칸은 `unlockBy: shop`으로 본다 |
| `hunger` | `fullness` | `fullness = 100 − hunger`. 코드 용어를 용어사전의 만복도로 맞춘다 |
| `fedAt` · `playedAt` | `feedCooldownMs` | 남은 쿨타임으로 바꾼다. 남은 시간이 없으면 0 |
| `inventory` | `bag` · `legacy` | 도구 수량은 `bag`으로 옮긴다. `shiny:<개체 식별자>` 키는 도구가 아니라서 `legacy`에 보존한다 |
| `unlocked` | `dex.unlocked` | 그대로 옮긴다. 보유 개체의 종은 `dex.obtained`에도 넣는다 |
| `acc` | `points.progressMs` | 부분 진행을 옮긴다. 값이 없으면 0 |
| `nick` · `look` | `legacy` | 값이 있으면 보존한다 |
| 없음 | `boxes`, `eggs`, `achievements`, `tutorials`, `tx` | 빈 값으로 시작한다 |

V2 `inventory`에는 먹이 재고가 없다. 유일한 키는 `shiny:<개체 식별자>`다. 이 키는 이로치로 바꿀 권리를 산 기록이다. 모습이 바뀌는 약은 1회 소모품이다. 그래서 이 기록은 `bag`으로 옮기지 않고 `legacy`에 보존한다. 이미 이로치인 개체는 `pets[].shiny`로 그대로 남는다.

변환 검사: 개체 수, 개체 식별자, 친밀도 합계, 포인트, 해금 종 수가 변환 전후로 같아야 한다. 칸에 없는 개체는 박스 1에 넣는다. 하나라도 어긋나면 원본을 유지한다.

변환 절차: 원본 백업 → 변환 → 검사 → 성공 시 교체. 검사에 실패하면 원본을 유지하고 변환 결과를 버린다.
보존 대상: 개체 식별자, 친밀도, 성격, 레벨, 포인트, 파티 순서, 표시 상태, 도감 기록, 구매 권리다.

### 시간 처리 순서

멈춰 있던 시간이 있으면 한 번에 처리한다. 순서는 시간 적용 → 값 변경(만복도·친밀도·포인트·쿨타임·버프·알 준비) → 상태 판정(부화 가능·진화 가능·업적 달성·배고픔 구간) → 알림 배너 생성이다. 같은 순간의 배너는 부화 → 진화 → 업적 → 줍기 → 메가스톤 순서다. 메가스톤 지급은 값 변경 뒤, 상태 판정 앞에 한다(`src/dex/mega.ts` `grantStones`). 거래 실행기도 명령마다 메가 모습을 정리하고 메가스톤 지급을 본다(`src/party/mega-form.ts` `settleMega`, `src/dex/mega.ts` `grantStones`).

### 저장 시점

거래는 성공한 순간에 저장한다. 줍기는 주운 틱에 저장한다(`src/tx/game.ts` `find`). 줍기 저장에 실패하면 그 건은 버린다.
시간에 따른 값은 전역 시계의 1초 틱마다 메모리에 적용한다. 계산에는 그 틱의 시각을 쓴다. 틱 밖에서 처리하는 명령도 마지막 틱의 시각을 쓴다(`src/main/app.ts` `clock.last()`).
메모리 값은 15초(`CLOCK_RULES.saveMs`, `src/main/app/clock.ts`)마다 파일에 쓴다(`src/tx/game.ts` `flushMs`). 쓰기 간격은 단조 시계(`performance.now`)로 잰다. 그래서 시스템 시각을 뒤로 돌려도 주기 쓰기가 멈추지 않는다.
명령과 줍기가 저장할 때는 메모리 값도 함께 쓴다. 아래 직전에도 쓴다(`game.flush`): 앱 끄기(`before-quit`), 화면 잠금(`lock-screen`), 절전(`suspend`), 시스템 종료(`powerMonitor` `shutdown`, Windows 창 `session-end`).
15초 주기는 Claude 가 쓰기 비용을 측정한 뒤 정한 구현 판단이다. 사용자가 확인하기 전이다. 강제 종료되면 최대 15초의 시간 진행을 잃는다.
1초마다 파일을 쓰지 않는 이유: 쓰기 자체는 약 0.4ms 였다(58KB 저장, 2026-09-29 측정). 그러나 켜 둔 8시간에 약 1.7GB 를 쓰고, 저장 감시(`src/save/save-watch.ts`)와 클라우드 표시 파일(`cloud.json`)이 1초마다 돈다.
메모리 값은 쓰는 프로세스만 가진다. 명령·스냅샷·CLI 스냅샷·무대 우클릭 메뉴·점프 목록은 그 사본을 읽는다. 다른 곳이 파일을 바꾸면(클라우드 저장 받기 등) 메모리 값을 버리고 파일을 따른다.
시간 값은 ms 단위 정수로 저장한다. 소수점을 남기지 않는다. 화면 표기는 초·분 단위 정수로 올림한다. 기다리는 동안 0 을 보이지 않는다.
저장이 3회(`SAVE_RULES.saveFailNotifyAfter`) 이어서 실패하면 설정창의 상태 안내에 남긴다. 조작은 막지 않는다.
주기 쓰기가 실패해도 메모리 값은 버리지 않는다. 다음 시도는 15초 뒤다. 실패는 쓰기 주기마다 한 번 센다. 그래서 주기 쓰기만 실패하면 안내는 약 45초 뒤에 뜬다.

## 명령 계약

모든 명령의 이름과 역할은 다음과 같다.

| 명령 | 역할 | 모듈 |
|---|---|---|
| `settings:snapshot` | 파티·박스·알·가방·도감·업적·설정 조회 | `src/tx` |
| `party.place` | 빈 파티 칸에 박스 개체를 꺼낸 상태로 배치 | `src/party`, `src/box` |
| `party.swap` | 파티 개체와 박스 개체를 한 번에 맞바꿈 | `src/party`, `src/box` |
| `party.move` | 파티 개체를 다른 파티 칸으로 옮김. 개체 칸이면 맞바꿈 | `src/party` |
| `party.keep` | 파티 개체를 박스에 보관 | `src/party`, `src/box` |
| `party.show` / `party.hide` | 표시와 숨김 | `src/party` |
| `egg.open` | 직접 열기. 결과 종과 이로치 판정, 개체 생성과 배치 | `src/egg`, `src/dex`, `src/party` |
| `bag.use` | 도구와 대상 검사, 적용과 차감 | `src/bag` |
| `bag.sell` | 도구 판매. 판매가 검사, 보유 차감, 포인트 더하기. `count` 개를 한 거래로 | `src/shop` |
| `shop.buy` | 구매 검사, 포인트 차감, 알·개체·도구·칸 반영. 도구와 알은 `count` 개를 한 거래로 | `src/shop` |
| `achievement.claim` | 보상 수령. 업적당 1회 | `src/achievement` |
| `tutorial.skip` / `tutorial.done` | 튜토리얼 상태 기록 | `src/tutorial` |
| `feed` / `play` | 돌봄. 쿨타임과 버프 | `src/state` |
| `evolve` | 진화. 실행 시점 조건으로 결과 판정 | `src/dex` |
| `pet.set` | 놓아 둔 자리와 크기 단계 | `src/party` |
| `pet.form` | 공유 sid 계열의 모습 바꾸기. 메가진화와 되돌리기([메가진화](game.md#메가진화)) | `src/dex`, `src/party` |
| `pet.sell` | 포켓몬 판매. 판매 가능 검사, 개체와 칸 비우기, 포인트 더하기 | `src/shop` |
| `starter.pick` | 첫 선택 | `src/party` |
| `box.sort` / `box.move` / `box.rename` / `box.order` | 박스 정렬·칸 옮기기·이름 바꾸기·박스 순서 바꾸기 | `src/box` |
| `trade.create` / `trade.join` / `trade.offer` / `trade.ready` / `trade.unready` / `trade.leave` / `trade.status` | 친구 교환 조작과 상태. 서버를 타므로 교환 세션(`src/online/trade-session.ts`)이 받는다. 저장은 아래 로컬 거래로만 바꾼다. writer 만 처리하고 reader 는 명령 통로 `mailbox` 로 넘긴다 | `src/trade`, `src/main` |
| `trade.lock` / `trade.unlock` / `trade.apply` | 교환의 로컬 거래 — 확정 때 잠금, 닫힘 때 풀기, 완료 때 같은 칸에 받은 개체 반영. 교환 세션만 부른다 | `src/trade`, `src/tx` |
| `mail.apply` / `mail.read` | 우편함 선물 넣기·읽음 기록. 우편함(`src/online/mail-inbox.ts`)만 부른다. 명령 처리기에 등록하지 않아 설정창·CLI 는 부를 수 없다 | `src/mail`, `src/tx` |
| `settings.set` | 설정 변경. 설정 창은 명령이 아니라 설정창이 연다 | `src/state`, `src/main` |

저장을 바꾸는 명령은 거래 실행기를 지난다. 실행기를 지난 요청은 다시 보내도 중복 반영하지 않는다.
실행기를 지나지 않는 명령은 다음과 같다(`src/main/app/commands.ts`).
- `display.set`: 저장 밖의 창 표시 설정을 바꾼다.
- `trade.create`·`trade.join`·`trade.offer`·`trade.ready`·`trade.unready`·`trade.leave`·`trade.status`: 교환 세션이 서버와 주고받는다. 교환 결과를 저장에 반영하는 `trade.lock`·`trade.unlock`·`trade.apply` 는 실행기를 지난다.
- `quit`: 앱을 끝낸다.
- `snapshot`: 화면 값을 읽기만 한다.
명령을 보내는 곳은 메뉴·트레이·설정창·CLI 다.

## 남은 일

이 문서에 남은 미정 항목은 없다.
