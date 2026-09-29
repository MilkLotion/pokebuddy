# 상세 기기 창 자동 포커스 (2026-09-29, 맥)

기존 `worklog/records/party-detail-window/record.md`에 덧붙일 항목이다.

## 피드백

- 사용자 보고(2026-09-29): "상세 열고나서 옆의 창 눌러야 scope됨. 자동 필요."
- 증상: 관리 창에서 상세를 열면 옆 기기 창이 뜬다. 그러나 키보드 포커스는 관리 창에 남는다. 기기 창을 한 번 눌러야 ←/→(이전·다음)과 Esc가 먹는다.
- 원인: 파티 상세 기기 창(`src/main/pet-window.ts`)과 도감 상세 기기 창(`src/main/dex-window.ts`)은 첫 표시를 `size` 처리기의 `showInactive()`로 한다. 이미 보이는 창에 다른 대상을 보낼 때도 포커스를 주지 않는다.

## 수정

- `src/main/dex-window.ts`에 공용 함수 `bringUp(w)`를 더했다. 숨은 창이면 `show()`를 부른 뒤 `focus()`와 `webContents.focus()`를 부른다.
- 두 창 모두 `focusNext` 상태를 둔다. `show()`가 새 대상이나 새 창일 때만 포커스를 준다.
  - 창이 이미 보이면 그 자리에서 `bringUp`을 부른다.
  - 아직 안 보이면 `focusNext`를 켠다. 렌더러가 높이를 보낸 뒤 `size` 처리기가 `bringUp`을 부른다.
- 같은 대상을 다시 보낼 때는 포커스를 주지 않는다. 관리 창은 5초마다 새로 읽을 때와 명령 뒤에 같은 개체를 다시 보낸다(`src/renderer/manage.ts` `syncPetDevice`). 도감은 부화·해금 뒤 같은 종을 다시 보낸다(`loadDex`). 이때 관리 창의 포커스를 빼앗으면 안 된다.
- 관리 창 최소화 뒤 복원(`showWithOwner`)은 지금처럼 `showInactive()`를 쓴다.
- 렌더러는 고치지 않았다. `src/renderer/pet.ts`와 `src/renderer/dex.ts`의 keydown은 `document`에 걸려 있어 창 포커스로 충분하다. 튜토리얼 코치의 포커스 가두기는 그대로 적용된다.

## 검수

- `npm run check`: 오류 없음.
- `git diff --check`: 문제 없음.
- 앱 실기: 확인 전. `src/tools/selftest-dex-detail.ts`는 `dockAt`만 검사한다. 창 포커스는 자체 확인 범위 밖이다.

## 남은 확인 (사용자 실기, macOS·Windows 각각)

1. 파티 칸을 누르면 기기 창이 뜨고, 바로 ←/→와 Esc가 먹는다.
2. 기기 창이 떠 있을 때 관리 창에서 다른 칸을 누르면 포커스가 기기 창으로 간다.
3. 도감 칸도 1과 2를 확인한다.
4. 기기 창이 떠 있을 때 관리 창 검색창에 입력한다. 5초 새로 읽기나 명령 뒤에 포커스가 기기 창으로 튀지 않는다.
5. 관리 창을 최소화했다가 복원한다. 기기 창은 다시 보이고 포커스는 가져가지 않는다.
6. 상세 튜토리얼이 뜬 개체를 연다. Enter는 말풍선 단추에 먹고 방향키와 Esc는 무시된다.
