# 놀아주기·먹이 버프 이름과 들뜸 단계 (2026-09-29, 맥)

## 설계

### 사용자 요청과 결정

- 요청(2026-09-29): "오래 놀아주기 버프 이름을 신남 이런 식으로 바꿀까 하는데 고민이네. 이름후보 리스트업해봐."
- Claude가 후보를 냈고, 기분 상태 이름(신남)과 먹이 버프 이름 짝 맞추기를 제안했다.
- 사용자 결정(2026-09-29): "그렇게하자. 2스택 1.2배 는 들뜸 으로. 3스택 1.5배는 신남으로."
- 결정 1: 놀아주기 2중첩이면 버프 `들뜸`(친밀도 증가량 ×1.2)이 켜진다. 새 단계다.
- 결정 2: 놀아주기 3중첩이면 버프 `신남`(×1.5)이다. 지금 "오래 놀아주기 버프"의 새 이름이다.
- 결정 3: 프리미엄먹이 버프(×2, 2시간)의 이름은 `든든함`이다. Claude 권장안을 사용자가 골랐다.
- 결정 4: 들뜸의 지속시간은 30분이다. Claude 권장안을 사용자가 골랐다.

### 제안 (Claude, 사용자 확인 전)

- 3중첩이 되면 들뜸은 신남으로 바뀐다. 배율을 곱하지 않는다.
- 장난감은 지금처럼 신남(×1.5, 30분)을 준다.
- 들뜸이 남아 있을 때 다시 2중첩을 달성하면 기본 지속시간으로 갱신한다. 신남이 남아 있으면 들뜸을 새로 걸지 않는다(더 높은 버프 유지).
- 든든함과 들뜸·신남이 함께 있으면 기존 규칙(프리미엄먹이 버프와 놀아주기 버프의 관계)을 그대로 따른다.
- "오래 놀아주기"라는 말은 동작 이름으로도 쓰지 않는다. 용어는 `신남`, `들뜸`, `든든함`으로 바꾼다.

### 범위

- 규칙과 수치: `src/state/`(돌봄·버프), `src/bag/use.ts`(`play-buff`, 프리미엄먹이), `src/save/rules.ts` 또는 버프 수치 위치, 저장 호환(옛 버프 식별자).
- 화면 문구: `lib/i18n/ko.json`·`en.json`, `src/renderer/manage.ts`·`pet.ts`(버프 표시), 배너·튜토리얼 문구.
- 문서: `docs/terms.md`, `docs/specs/game.md`, `docs/specs/balance.md`, `docs/specs/scenarios.md`, `docs/design.md`, `docs/guide.md`, `docs/specs/ui-components.md`.
- 제외: Figma.

### 위험

- 옛 저장에 남은 버프 식별자(오래 놀아주기)를 새 이름으로 읽어야 한다.
- 버프 판정 순서(들뜸 → 신남 교체)와 장난감 경로가 어긋날 수 있다.

### 수용 조건

- 놀아주기 2중첩에서 들뜸(×1.2, 30분), 3중첩에서 신남(×1.5, 30분)이 켜진다.
- 장난감은 신남을 준다.
- 프리미엄먹이 버프는 든든함으로 보인다.
- 옛 저장의 오래 놀아주기 버프는 신남으로 이어진다.
- 문서와 화면에 "오래 놀아주기" 버프 이름이 남지 않는다.

## 작업

- 규칙: 2중첩 들뜸(×1.2, 30분), 3중첩 신남(×1.5, 30분), 장난감 신남, 프리미엄먹이 든든함(×2, 2시간). 제안 절의 교체·유지·갱신 규칙을 구현하고 코드 주석과 문서에 "제안"으로 표시했다.
- 든든함과의 관계: 기존 규칙대로 배율을 더한다(든든함+신남 250%, 든든함+들뜸 220%). `buffPercent`는 신남이 있으면 들뜸을 세지 않는다.
- 수치: `src/save/rules.ts` `SAVE_V3_RULES.shortPlayAt: 2`, `TIME_V3_RULES.buffBonusPercent`, `BAG_V3_RULES.buffMs`에 `short-play`.
- 식별자: 바꾸지 않았다. `premium-food` = 든든함, `long-play` = 신남, 새 `short-play` = 들뜸. 이유(서브 에이전트 판단): 식별자를 바꾸면 클라우드로 같은 저장을 읽는 옛 판 앱이 신남을 버린다. 옛 판은 `short-play`만 버린다(들뜸 30분 손실). 정규화: 신남과 들뜸이 함께면 들뜸을 뺀다.
- 화면: 스냅샷 개체 보기에 `buffNames`(든든함·신남·들뜸 순). i18n `buff.<식별자>`(영어 Well-fed, Excited, Giddy). 설정창 개체 태그와 파티 상세 기기 창 칩이 켜진 버프를 모두 보인다(전에는 오래 놀아주기 하나만, 이제 든든함도). 가방 미리보기, 가이드북 돌봄 문구.
- 파일: `src/save/rules.ts`, `src/shared/save-v3.ts`, `src/save/v3.ts`, `src/state/time.ts`, `src/state/care.ts`, `src/bag/use.ts`(`setBuff` export), `src/tx/snapshot.ts`, `src/shared/manage.d.ts`, `lib/i18n/ko.json`·`en.json`, `src/renderer/manage.ts`, `src/renderer/pet.ts`, selftest-bag·time·snapshot.
- 문서: `docs/terms.md`(들뜸·신남·든든함 세 행, 장난감 행), `docs/specs/game.md`, `docs/specs/balance.md`, `docs/specs/scenarios.md`, `docs/design.md`, `docs/guide.md`, `docs/specs/ui-components.md`.

## 검수

- 서브 에이전트: build, check, selftest bag·time·snapshot·manage·play·save·screens·tx·flow·notify·find·clock 통과, smoke-manage 통과, `git diff --check` 통과, check-docs는 worklog-mac 한 줄.
- Claude 직접(임시 HOME): check, build 통과. selftest bag·time·snapshot·play·save·manage 통과. smoke-manage exit 0. `git diff --check` 통과. "오래 놀아주기"는 옛 이름 설명(terms.md 신남 행, game.md 식별자 설명, 코드 주석 3곳)에만 남는다.
- 앱 실기: 하지 않았다.

## 피드백과 수정

### 사용자 확인 대기

- 제안: 들뜸 → 신남 교체, 신남 중 2중첩 무시, 들뜸 갱신.
- 영어 이름 Well-fed, Excited, Giddy.

### 실기 확인 항목

1. 놀아주기 2번째 중첩에서 들뜸, 3번째에서 신남 태그가 보인다.
2. 장난감을 쓰면 신남이 보인다.
3. 프리미엄먹이를 쓰면 든든함 태그가 보인다.
4. 옛 저장에서 켜져 있던 오래 놀아주기 버프가 신남으로 보인다.
