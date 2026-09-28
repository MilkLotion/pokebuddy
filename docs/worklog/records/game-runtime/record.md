# 포켓몬 우클릭 메뉴를 그 포켓몬 기능만으로 (추가분)

- 날짜: 2026-09-28
- 이 파일은 추가분이다. 집 PC 의 `worklog/records/game-runtime/record.md` 끝에 한 절로 붙인다.

## 설계

- 사용자 질문(2026-09-28): "볼에넣기랑 잠시숨기기랑 같은기능아니야?"
- 조사 결과: 두 기능은 다르다. `볼에 넣기` 는 그 포켓몬 하나를 저장에 숨김(`party.hide`)으로 남긴다. `잠시 숨기기` 는 모든 포켓몬의 표시를 끈다. 앱이 켜져 있는 동안만 유효하다(`src/main/app.ts` `userHidden`).
- 사용자 결정(2026-09-28): "포켓몬 우클릭에 대상으로 나온 메뉴인데 잠시숨기기가 있는건 이상해"
- 범위: 포켓몬 우클릭 메뉴에서 `잠시 숨기기`/`다시 보이기` 를 뺀다. 트레이 메뉴와 설정창 `포켓몬 표시` 는 그대로다.
- 근거 보강: 숨긴 동안에는 포켓몬이 보이지 않는다. 그래서 우클릭 메뉴의 `다시 보이기` 는 원래 누를 수 없는 항목이었다.

## 작업

- `src/main/menus.ts`: `petMenu` 에서 숨기기 항목과 그 구분선을 뺐다. `PetMenuModel.hidden` 을 지웠다.
- `src/main/app.ts`: `showPetMenu` 의 모델에서 `hidden` 을 지웠다.
- `src/tools/selftest-stage.ts`: 메뉴 순서, 숨기기 없음, 구분선 수(2 → 1), 튜토리얼 흐린 항목 수(3 → 2) 기대값을 고쳤다.
- `scripts/dev-menu.cjs`: `petMenu` 호출에서 `hidden` 을 지웠다.
- `docs/guide.md`: "트레이와 우클릭 메뉴" 절의 우클릭 메뉴 구성.

메뉴 결과: 이름·상태 / 밥 주기·놀아주기·볼에 넣기 / 설정창 열기 / 종료.

## 검수

| 명령 | 결과 |
|---|---|
| `npm run build` | 통과 |
| `node dist/tools/selftest-stage.js` | 통과 (151건) |
| `node scripts/check-docs.cjs`, `git diff --check` | 통과 |

전체 `npm run selftest` 와 실기 우클릭 확인은 하지 않았다.

## 피드백과 수정

1. 포켓몬 우클릭 메뉴에 `종료` 가 있었다(코드와 사용자 스크린숏). `docs/specs/game.md` 의 우클릭 메뉴 절과 `docs/specs/ui-components.md` C-21 은 "종료를 두지 않는다"고 적는다. 코드와 명세가 어긋났다.
   - 사용자 결정(2026-09-28): "그것도 빼자 포켓몬대상 우클릭은 해당 포켓몬 관련기능만 할거야"
   - 조치: `petMenu` 에서 `종료` 를 뺐다. 동작 타입을 `MenuActions`(트레이: 숨기기·고스트·종료)와 `PetMenuActions`(포켓몬: 밥·놀이·볼)로 나눴다. 포켓몬 메뉴는 앱 전체 조작을 받을 수 없다.
   - `app.ts` 는 `설정창 열기` 를 `종료` 앞에 끼우던 `splice` 대신 끝에 붙인다(`push`). `scripts/dev-menu.cjs` 도 같게 고쳤다.
   - 시험: 메뉴에 숨기기·종료가 없음, 끝 구분선 제거, 트레이 클릭 세 동작(숨기기·고스트·종료)을 본다. `selftest-stage` 통과(151건).
   - 문서: `docs/guide.md` 의 우클릭 메뉴 구성과 "`종료` 로도 끝난다" 문장. 명세는 이미 이 결정과 같아 고치지 않았다.
2. `설정창 열기` 는 마지막 탭을 열었다(`openManageWindow()`). 명세(`docs/specs/game.md` "우클릭 메뉴는 개체 상세를 연다")와 사용자 원칙에 어긋났다.
   - 사용자 결정(2026-09-28): 그 포켓몬의 상세를 열고 문구를 맞춘다("ㅇㅇ 그거로 바꾸자" — `상세 보기` 제안에 대한 답)
   - 조치: `app.ts` 가 `상세 보기`(`menu.detail`, 새 i18n 키: ko `상세 보기`, en `View details`)를 붙이고 `openManageWindow({ to: "pet", petId: id })` 를 부른다. 진화 배너가 쓰는 경로와 같다.
   - 문서: `docs/specs/game.md`(두 곳), `docs/specs/ui-components.md` C-21, `docs/guide.md`(머리·우클릭 메뉴 구성)
   - 시험: `npm run build`, 전체 `npm run selftest` 통과(종료 코드 0). 이 항목은 `app.ts` 에서 붙어 자체 시험에서 누르지 않는다. 실기 우클릭 확인은 하지 않았다.

## Figma

- `Context Menu` `338:738` 시안은 아직 옛 구성이다. 반영 할 일은 `worklog/records/user-modal/record.md` "Figma 반영 — 남은 일" 6번에 모았다(Mac 의 Figma 계정 권한 문제, 2026-09-28).
