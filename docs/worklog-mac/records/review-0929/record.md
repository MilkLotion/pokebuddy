# 2026-09-29 맥 작업 통합 검수

대상: 이날 맥에서 만든 커밋 전 변경 전체. 상세 기록은 `records/party-detail-window`, `shop-species-price`, `mint-unify`, `forage`, `timer-tick`, `icon-bubble`.

## 설계

- 사용자 질문(2026-09-29): "설계-검수 제대로 다 한거 맞지?"
- Claude 답: 아니다. 설계를 구현보다 먼저 하지 않았다. 코드 검수, 문서 의미 검수, 앱 실기를 하지 않았다. 이력을 일찍 적었다.
- 사용자 승인: "그렇게해" — 독립 검수 → 실행 확인 → 문서 검수 → 피드백과 수정 → 마무리.
- 방식: 구현하지 않은 검수자 셋이 동시에 본다. 검수자는 코드와 문서를 고치지 않는다.
  - A: 저장·데이터 무결성과 게임 규칙.
  - B: 메인 런타임(전역 시계, 메모리·파일 저장, IPC, 포커스), smoke-renderer 튜토리얼 실패의 기존 여부.
  - C: 화면과 공개 문서 의미 검수.

## 검수

### A: 저장·데이터 (완료)

- 명령: `npm run build` 통과. selftest 37개(임시 HOME) exit 0(trade-net·account·cloud 서버 부분 건너뜀). `check-unlocks` 종 1025·경로 없음 0. `check-docs` exit 1(`docs/worklog-mac` 한 줄). `git diff --check` 통과.
- 직접 시험(임시 저장): 옛 저장 호환(find 없음, activeMs 있음, 옛 민트 섞임, 999 초과, 깨진 log), 상점 가격·판매 여부·`buy`, 업적 포켓몬 보상(두 번 수령 막힘), 민트 거절·소모, 줍기 몫·후보. 모두 설계와 맞다.
- 옛 앱 버전 판단(코드만 읽음): `mint`와 모르는 업적 id는 보존하고 `find`는 버린다. 저장 형식 번호 3 유지는 안전하다.

### B: 메인 런타임 (완료)

- 명령: `npm run build`, `npm run check` 통과. selftest clock, find, stage(160건), screens, save, flow, time, notify, manage, snapshot, tx 통과(임시 HOME). `git diff --check` 통과.
- smoke-renderer 튜토리얼 단언 "어두운 막 위는 아래 창으로 통과한다" 실패는 이번 변경 전부터 있다. HEAD `9662a46` worktree에서도 같은 단언이 실패했다. 전체 실행에서는 이 실패로 뒤의 아이콘 말풍선 검사가 돌지 않는다. 이 단언만 뺀 사본에서는 아이콘 말풍선이 통과한다.
- 직접 시험: 시각 1시간 역행 뒤 600틱(`probe.cjs`), 저장 폴더 쓰기 금지(`probe2.cjs`).
- 문제없음: flush 위치(`before-quit`, `lock-screen`), 강제 종료 시 최대 15초 손실, writer 이전, 클라우드 받기 뒤 pending 버림, 거래 실패 시 pending 오염 없음, 틈 처리, 시계 구독자 예외 격리, 줍기 즉시 쓰기, `POKEBUDDY_FIND_RATE` 개발 실행 한정, 아이콘 말풍선 CSP·sandbox 유지, 기기 창 포커스(같은 대상 재전송 시 포커스 안 줌).

### C: 화면·문서 의미 (완료)

- 명령: `check-docs` exit 1(`docs/worklog-mac` 한 줄). `git diff --check` 통과. diff에 TODO·FIXME·XXX·HACK 0건, `console.log/warn/debug/info` 0건.
- 임시 Electron 스모크(임시 HOME, 1초마다 `game.tick()` + `pushClock`): 상점 칩·격자 406칸·지방·검색, 도감 지방(`regionEl`), 성격 변경 창(25칸 순서, 지금 성격 막기, 가장 긴 글자 55px < 칸 63px, 682 높이 안 617px). 스크린샷은 scratchpad `review-c/`.
- 문서 의미 검수: writing.md 체크리스트를 변경 문단에 적용했다. 발견은 아래 C 행.
- 문제없음: 상점 탭 구성, 지방 목록·스크롤·검색 칸 값이 시계 틱에도 유지, 도감 지방, 성격표, 줍기 배너 대체 처리와 바로가기, 호칭 없는 문구, 줍기 수치, 민트·잠만보·럭키·라프라스·메타몽 문서 일치, 공개 문서의 worklog 링크 없음.

## 피드백과 수정

수정 배분: 메인 쪽(B1~B8, A3, A4, A6, A8/C14 코드, C7)은 줍기 에이전트가 맡는다(2026-09-29 시작). 화면(C2~C6, 페이지 넘김, Enter 한 번 검색)은 검색 수정을 끝낸 상점 에이전트가 맡는다(2026-09-29 시작). 문서(A1·A2·A9, C8~C15)는 코드 수정이 끝난 뒤 한 번에 맡긴다.

| ID | 심각도 | 위치 | 문제 | 조치 |
|---|---|---|---|---|
| A1 | 중간 | `docs/specs/game.md` "줍기 > 저장", `docs/specs/modules.md:38`, `src/find/core.ts:6·9` | 줍기 저장을 `game.ts` `tick`이 한다고 적는다. 실제는 1초 틱의 `game.find`다. core.ts는 "폴링 0.5초"로 적는다 | 대기 |
| A2 | 중간 | `docs/specs/game.md:374` | 라프라스·메타몽 랜덤알 제외를 `[스펙 미확정]`으로 적었다. 사용자는 승인했다(결정 8) | 대기 |
| A3 | 낮음 | `src/main/game.ts` pending 주석, `src/main/app.ts:868` | 밖에서 파일을 바꿔 pending을 버리면 파일에 안 쓴 workMs가 사라진다(재현: 0/1000). 주석은 시간 진행을 잃는다고 잘못 적는다 | 수정: 파일에 안 쓴 작업 시간을 따로 세어 다음 틱에 다시 넣는다. 주석 정정. selftest-clock (3d) |
| A4 | 낮음 | `src/save/migrate-v3.ts:96` | v2 이전의 옛 민트 합계를 999로 자르지 않는다 | 수정. selftest-save 700+700 → 999 |
| A5 | 낮음 | 옛 앱과 섞어 쓰기 | 새 판 mint 999일 때 옛 앱이 산 `<성격>-mint`가 새 판에서 잘려 사라진다(추론) | 기록만 |
| A6 | 낮음 | `src/find/core.ts:92` | `placeNew`가 `src/shop/buy.ts`와 중복이다 | 수정: buy.ts의 것을 import |
| A7 | 낮음 | `docs/worklog-mac/` | 커밋하면 비공개 기록이 공개된다 | C1 참고 |
| A8 | 낮음 | `docs/specs/balance.md` "틱 상한" | 60초 상한은 5초 초과 틈을 굴리지 않아 실제로 쓰이지 않는다 | 코드 수정: `maxMsPerTick` → `FIND_RULES.maxGapMs`(5초). 문서는 문서 단계에서 |
| A9 | 낮음 | `docs/specs/game.md:223-224` | "알 전용 종은 상점에서 구매하지 않는다"가 새 규칙과 맞지 않는다 | 대기 |
| B1 | 중간 | `src/main/game.ts:117` | 시스템 시각을 뒤로 돌리면 15초 파일 쓰기가 멈춘다. 1시간 역행 뒤 10분 동안 쓰기 0번(재현). 강제 종료 시 최대 1시간 손실 | 수정: 쓰기 간격을 단조 시계(`performance.now`, 옵션 `mono`)로 잰다. selftest-clock (3b) 1시간 역행 뒤 60초에 4번 쓰기 |
| B2 | 중간 | `src/main/game.ts:117-124` | 15초 쓰기가 실패하면 매초 다시 쓰고 3초 만에 저장 실패 안내가 뜬다(전에는 약 45초). 실패마다 pending을 버려 화면 값이 최대 15초 되돌아간다(재현) | 수정: 실패해도 메모리 값 유지, 재시도 15초 뒤, 실패는 주기마다 한 번 센다(안내 45초). selftest-clock (3c), selftest-play (8) 조정 |
| B3 | 낮음 | `src/main/commands.ts:246`, `src/main/app.ts:588`, `app.ts:290` | CLI 스냅샷·무대 우클릭 메뉴·점프 목록이 파일 사본을 읽어 최대 15초 옛 값을 본다. 관리 창과 어긋난다. 회귀는 아니다 | 수정: 세 곳 모두 `game.read()`(writer 아니면 저장 감시 값) |
| B4 | 낮음 | `src/main/game.ts:106-110`, `80-83` | writer가 아닌 프로세스의 관리 창은 15초마다만 바뀐다 | 고치지 않음: reader도 1초마다 디스크를 읽는다(약 0.27ms). 값은 writer의 15초 쓰기에 묶인다. 1초 갱신은 1초 쓰기(기각)나 이중 적용 위험이 따른다. 동반자는 기기당 하나라 드문 경우 |
| B5 | 낮음 | `src/main/game.ts:74-77` | `readDisk`가 파일을 읽은 뒤 수정 시각을 잰다. 사이에 바뀌면 외부 변경을 덮을 수 있다(추정) | 수정: 수정 시각을 먼저 잰다. 읽으며 이전·격리로 다시 썼으면 그 뒤 시각을 쓴다 |
| B6 | 낮음 | 전원 이벤트 | `powerMonitor` `suspend`와 Windows `session-end`에 flush가 없다(설계 한도 안) | 수정: `suspend`·`shutdown`에 `game.flush()`. `session-end`는 `browser-window-created`로 창마다 건다 |
| B7 | 낮음 | `src/main/pet-window.ts` show, `src/renderer/manage.ts:2977` | 기기 창 ✕와 1초 다시 보내기가 겹치면 새 창이 잠깐 떠서 포커스를 가져갈 수 있다(추정, 1초로 줄어 확률 5배) | 수정: 세대 번호 방식(`src/main/device-gen.ts` `createGenGate`). 기기 창이 닫힐 때마다 번호를 올려 `onPetClosed(gen)`·`onDexClosed(gen)`으로 주고, 관리 창은 `petOpen(open, gen)`·`dexOpen(slug, gen)`에 싣는다. 낡은 번호는 버린다. 1.5초 무시 제거. 도감 기기 창도 같다. 관리 창을 다시 읽으면 번호를 0으로. selftest-manage (14) |
| B8 | 정보 | `game.tick`, 스냅샷 | 틱의 `now` 대신 자기 `Date.now()`를 쓴다. 사용자 결정 2("그 시간값을 보게")를 글자 그대로 따르지 않는다 | 수정: 게임에 `clock.last()?.now`를 준다. 게임 시간·스냅샷·줍기 저장·배너(notifier)가 틱 시각을 본다. 틱 밖 명령도 마지막 틱 시각 |
| B9 | 낮음 | `records/icon-bubble/record.md` | "smoke 아이콘 말풍선 통과"는 전체 실행으로 재현되지 않는다(튜토리얼 단언이 먼저 실패) | 기록 정정 |
| C1 | 높음 | `docs/worklog-mac/` | 추적하지 않고 gitignore에도 없다. `git add docs/` 한 번이면 공개된다(A7과 같은 건) | 사용자 결정(2026-09-29): "그냥 커밋". 코드와 같이 올리고 집에서 정리 후 지운다 |
| C2 | 중간 | `src/renderer/manage.ts` `clockTick`·`draw`·`drawTabs` | 카운트다운 중 매초 화면 전체를 다시 만든다. 탭 포커스 2.5초 뒤 사라짐, title 툴팁 교체, 텍스트 선택 해제. 기기 창도 매초 다시 그린다(확인) | 수정: `LIVE_KEYS`(feedInSec·affinity·mood·moodWord·remainSec·percent·remainMin) 값만 바뀌면 `applyLive()`가 해당 요소만 고친다. 구조가 바뀌면 전체 draw 후 `restoreFocusPath`로 포커스 복원. pet.ts 같은 방식. smoke-manage: 2.6초 뒤 탭 단추·포커스·title 요소 동일 |
| C3 | 낮음 | `manage.ts` `editing()` | 입력 칸·슬라이더에 포커스가 남으면 시간 표시가 멈춘다. 슬라이더는 놓은 뒤에도 포커스가 남는다(확인) | 수정: 표시 고치기는 늘 한다. 전체 draw만 끌기·이름 입력·누르는 중·한글 조합 중·글자 입력 칸 포커스일 때 미룬다. 슬라이더·체크는 누르는 중에만 |
| C4 | 낮음 | `manage.ts` `clockTick` | 쉬는 동안에도 `view`를 새 값으로 바꿔 화면과 처리기 값이 다르다(추론) | 수정: `view`는 화면에 그린 모양의 값이다. 전체 draw를 미루는 동안 `view`를 두고 시간 표시만 먼저 보인다 |
| C5 | 낮음 | 상점 포켓몬 탭 | 지방 `전체` 스크롤 높이 11,492px. 긴 스크롤 지양과 충돌 | 사용자 결정(2026-09-29): 페이지 넘김 추가. 수정: 도감·상점 포켓몬 한 쪽 15칸(5×3, `GRID_PAGE`), `◀ 2 / 28 ▶`(박스 `.pager` 재사용). 지방·검색·칩 바뀌면 1쪽, 1초 갱신에도 쪽 유지, 682px 창 넘침 0. Claude가 스크린샷 확인 |
| C6 | 낮음 | 성격 변경 창 | 빈 hint 줄로 이름이 칸 위쪽에 붙는다. 성격을 고르면 창 높이가 547 → 617px로 늘어 위로 튄다 | 수정: `지금` 줄은 지금 성격 칸에만. 안내 상자 자리를 처음부터 확보. 고르기 전후 614 → 614px. Claude가 스크린샷 확인 |
| C7 | 낮음 | `src/shared/josa.ts` (렌더러 사본 `manage.ts` `josa`도 같은 규칙으로 수정) | 라틴 끝 글자를 받침 없음으로 본다. "경험사탕M를", "경험사탕L를"(확인) | 수정(메인): M·N 받침 있음, L·R ㄹ 받침(R은 Claude 지시 밖 판단), 나머지 없음. selftest-find (10). 렌더러 사본 `src/renderer/manage.ts:801`은 화면 쪽에서 |
| C8 | 중간 | `docs/specs/game.md:160-161`, `docs/specs/modules.md:38` | 줍기 저장 경로(A1과 같은 건) | 대기 |
| C9 | 중간 | `docs/specs/game.md:374` | 결정 상태 모순(A2와 같은 건) | 대기 |
| C10 | 중간 | `docs/terms.md:76`, `game.md:223-224·230·247·515`, `design.md:306·310-311` | "알 전용"이 새 상점 규칙과 충돌. `design.md:306`과 `:217`이 정면 충돌(A9 확장) | 대기 |
| C11 | 중간 | `docs/design.md:108`, `docs/terms.md:51` | 업적 보상을 모두 칸 +1로 적는다. 포켓몬 보상 업적과 어긋난다 | 대기 |
| C12 | 낮음 | `docs/specs/game.md:81`, `ui-components.md` C-19 | 배너 순서에 줍기가 빠졌다. C-19에 줍기 배너가 없다 | 대기 |
| C13 | 낮음 | `game.md:101·181`, `ui-components.md:130`, `terms.md:115` | 결정과 제안 구분 오류: 15초 파일 쓰기(Claude 판단), "전역 타이머 1초" 인용(원문 아님), 스냅샷 같으면 생략(구현 판단), 첫 탭 `알`(사용자는 "전체는 없애"만 말함), 줍기 "깨어 있는" 조건 | 대기 |
| C14 | 낮음 | `balance.md:144`, `src/find/rules.ts:15` | 60초 상한이 닿지 않는다(A8과 같은 건). rules.ts 주석 "폴링 간격(최대 5초)"은 옛 설명 | 코드·주석 수정. 문서는 문서 단계에서 |
| C15 | 낮음 | `game.md:679` | "상점은 알에서 얻을 수 있는 종을 판다"가 단일 알 종까지 포함해 넓다 | 대기 |

### 메인 쪽 수정 검수 (2026-09-29)

- `npm run build`, `npm run check` 통과. selftest 26개(clock, find, save, flow, time, notify, manage, snapshot, tx, legacy, bag, play, commands, stage, screens, shop, egg, evolve, achievement, dex, dex-detail, unlocks, mail, trade, box, hook-upkeep) 통과. `scripts/selftest-cli.cjs` 통과. `git diff --check` 통과.
- 문서 단계로 넘길 것: balance.md 줍기 틱 상한(5초 틈 규칙), 쓰기 실패 안내 약 45초, B7의 1.5초 재오픈 무시.

### 화면 쪽 수정 검수 (2026-09-29)

- 추가 수정: 조합 중 Enter는 검색을 예약하고 `compositionend` 직후 한 번 거른다(Enter 한 번).
- 렌더러·메인 tsc 오류 0. selftest-manage·screens·snapshot 통과. `electron dist/tools/smoke-manage.js` 통과(부분 갱신 요소 유지, 포커스 복원, 도감 `1 / 69` → `2 / 69` 유지, 검색 규칙, 상점 쪽 유지, 성격 창 높이). `git diff --check` 통과.
- B7: 렌더러만으로는 막을 수 없다(관리 창이 ✕를 아는 길은 `onPetClosed`뿐). 세대 번호 방식으로 메인·렌더러를 함께 고쳤다. build, check, selftest-manage·screens·snapshot, smoke-manage, `git diff --check` 통과. 남은 틈: 관리 창이 닫기를 보낸 뒤 닫힘 알림이 오기 전(수 ms)에 같은 개체를 다시 누르면 버려질 수 있다(사람 손으로는 사실상 없음).
- 남은 점: 가방 사용 패널 "밥 주기 쿨타임이에요 (N분)"은 부분 갱신 대상이 아니다(분 단위). 포인트 변화는 전체 draw(포커스 복원).
- 문서 수정(A1·A2·A9, C8~C15, 메인·화면 수정 반영)을 새 에이전트에 맡겼다(2026-09-29).

### 문서 수정 (2026-09-29)

- 조치: A1/C8, A2/C9, A9/C10, C11, C12, C13, A8/C14, C15 완료. 메인·화면 수정(저장 시점, 1초 틱 시각, 쓰기 실패 안내 약 45초, 검색 규칙, 15칸 쪽 넘김, 부분 갱신, 기기 창 포커스와 세대 번호)을 game.md·modules.md·guide.md·terms.md·design.md·balance.md·ui-components.md에 반영했다.
- writing.md 의미 검수: 고친 문단 전부에 적용했다(긴 문장 분리, 주체 명시, 결정·관찰·제안 구분, "설정창"·"일반 알(랜덤알·태고의돌)" 통일).
- 남긴 것: `src/find/core.ts:6` 주석 "무대 폴링(0.5초)"(코드 범위), 경험사탕·이상한사탕을 "업적 보상으로 얻는다"는 문장(terms 99-100, design 224, scenarios 179·209, 설계 의도 미확인), game.md 711·783의 "관리 창"(고친 문단 밖).
- 옛 값 grep: 잠만보 800P, streak, 5초 새로 읽기, `maxMsPerTick`, 60초 상한은 없다. 대체된 값은 "대체됐다"는 설명 안에만 있다.

### 병렬 세션 관찰 (2026-09-29)

- 문서 에이전트가 "다른 에이전트가 같은 시각에 guide.md를 재구성하고 ui-components.md C-07의 관리 창을 설정창으로 바꾸고 있었다"고 보고했다. 이 세션이 띄운 에이전트의 작업이 아니다.
- `ListAgents`에 같은 저장소의 다른 세션 `terminal-pkmon-0c`가 있다.
- 이 세션이 만들지 않은 변경(관찰): `AGENTS.md`, `README.md`, `docs/README.md`, `scripts/check-docs.cjs`(`images` 루트 폴더 허용), 새 파일 `docs/images/`, `docs/specs/companion.md`, `docs/contributing/development.md`. `docs/guide.md`와 `docs/specs/ui-components.md`에는 두 세션의 변경이 섞여 있다.
- 커밋 범위는 사용자에게 확인한다.

### 최종 검사 (Claude 직접, 2026-09-29, 임시 HOME)

- `npm run check`: 통과.
- `npm run selftest`: 1차 exit 1 — selftest-stage "mailbox → dispatcher → 실행기 → 저장 왕복" 실패. 단독 3회 통과, 전체 2차 exit 0. 부하에 따른 간헐 실패로 본다. 원인은 확인하지 않았다(이번 변경 전에도 간헐이었는지 모른다).
- `electron dist/tools/smoke-manage.js`: exit 0.
- `electron dist/tools/smoke-renderer.js`: exit 1, "어두운 막 위는 아래 창으로 통과한다"(검수 B가 HEAD에서도 실패함을 확인).
- `node scripts/check-docs.cjs`: `docs/worklog-mac` 루트 위치 오류 한 줄.
- `git diff --check`: 통과.
- 앱 실기: 하지 않았다.

