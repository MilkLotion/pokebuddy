# 진행 현황 — 맥에서 반영할 줄 (2026-09-29)

`worklog/progress.md`에 해당 줄만 반영한다.

## 상태

- 구현·검수·수정 완료(커밋 전): 상세 창 포커스와 세대 번호, 상점 포켓몬·해금 정리·쪽 넘김, 민트 통일, 줍기, 아이콘 말풍선, 전역 1초 시계·검색 방식.
- 검사: `npm run check`, `npm run selftest`(2차 통과, 1차 selftest-stage 간헐 실패), smoke-manage 통과, `git diff --check` 통과. smoke-renderer 튜토리얼 단언 실패는 이전부터 있다.
- 앱 실기: 전부 하지 않았다. 항목은 각 기록의 "실기 확인 항목"에 있다.
- 커밋: `78d710d`(2026-09-29 사용자 지시 "너가 먼저 다 커밋하고, 그 세션에 메시지 날려서 알려"). 병렬 세션(`terminal-pkmon-0c`)의 파일 9개는 뺐다. 섞인 파일(`docs/guide.md`, `docs/terms.md`, `docs/specs/ui-components.md`, `src/main/portraits.ts`)은 그쪽 변경까지 들어갔다. 그 세션에 메시지로 알렸다. 푸시는 하지 않았다.
- 커밋 뒤 정정: `records/review-0929/record.md`에 영문 미완성 태그 단어가 들어가 있어 고쳤다. 이 정정과 이 파일 갱신은 커밋 전이다.

## 다음 행동

1. macOS·Windows에서 실기 확인을 한다. 줍기는 `POKEBUDDY_FIND_RATE=100 npm start`로 빨리 본다.
2. 사용자 확인 대기 값: 줍기 도구 후보(200P 이하·가중치 1/가격), 줍기 배너 배치(제목 `줍기`, 문구 본문), 상점 첫 탭 `알`, 15초 파일 쓰기 주기.
3. 남은 문서: 경험사탕·이상한사탕 "업적 보상으로 얻는다" 문장(업적 보상은 지금 파티 칸·포켓몬뿐), game.md "관리 창" 명칭 2곳, `src/find/core.ts:6` 옛 주석.
4. Figma: 상점 격자·쪽 넘김, 성격표, 민트 그림, 아이콘 말풍선, 검색 단추가 코드와 다르다.
5. smoke-renderer 튜토리얼 단언 실패와 selftest-stage 간헐 실패의 원인을 본다.
6. 이 폴더(`docs/worklog-mac/`)를 `worklog/`로 옮긴다. 옮기면 `check-docs`의 루트 위치 오류가 사라진다.
