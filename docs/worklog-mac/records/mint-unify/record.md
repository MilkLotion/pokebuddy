# 민트 한 종류로 통일 (2026-09-29, 맥)

## 설계

- 사용자 지시(2026-09-29): "민트는 그냥 지금것도 한 종류로 통일하고, 원하는 성격으로 바꿀 수 있게하자. 초록색민트 이미지만 사용."
- 결정 1: 성격별 민트 21종을 민트 하나로 합친다. 가격은 지금 민트 가격 100P를 유지한다(Claude 제안).
- 결정 2: 민트 하나로 원작 25 성격 중 원하는 성격을 고른다.
- 결정 3: 그림은 초록 민트 한 장만 쓴다.
- 옛 저장의 민트 개수는 합친다. 옛 우편함 식별자는 새 식별자로 바꿔 받는다(Claude 제안).

## 작업

- `data/items.json`: 민트 21종을 `mint`(민트/Mint, 100P, effect `nature`) 하나로 합쳤다. PokeAPI items.csv에 `mint` 식별자가 없어 `src/tools/build-items.ts`는 주석만 고쳤다.
- `src/bag/mint.ts`(새 파일): `MINT_ID`, `isOldMint`, `currentItemId`. 옛 식별자 `<성격>-mint`와 `mint-<성격>`을 `mint`로 바꾼다.
- `src/bag/use.ts`: 25 성격 중 아무 성격이나 받는다. 성격이 없거나 모르면 `bad-nature`, 지금 성격이면 `already`로 거절한다. 거절하면 민트를 쓰지 않는다. `mintFor`와 도구의 `natures` 필드를 없앴다.
- 옛 저장: `src/save/v3.ts` `normalizeBag`이 옛 민트를 합치고 합친 민트만 999로 자른다. `src/save/migrate-v3.ts`의 v2 변환도 `mint`로 넣는다.
- 우편함: `src/mail/core.ts` `parseGifts`가 옛 민트 식별자를 `mint`로 바꿔 받는다.
- `src/tx/snapshot.ts`, `src/shared/manage.d.ts`: 성격 선택지는 `{id, name}`만 보낸다.
- 그림: pokesprite mint 6장의 픽셀 색조를 셌다. `speed.png`가 녹색(주색 #65C65D)이다. 나머지는 attack 빨강, defense 파랑, special-attack 하늘, special-defense 분홍, neutral 노랑이다. `src/main/portraits.ts`는 `mint` → `items/mint/speed.png` 하나만 쓴다.
- 성격 변경 창(`src/renderer/manage.ts`, `manage.html`)
  - 전: [지금 카드] [민트 이름 →] [바꾼 후 카드 + 드롭다운]. 드롭다운은 스크롤 목록이었다.
  - 후: 가운데는 초록 민트 그림 + "→"다. 카드 아래에 5×5 성격표 격자를 둔다(원작 성격표 순서, 스크롤 없음). 지금 성격 칸은 눌리지 않고 `지금`이 붙는다. 고른 칸은 톤 배경이다(컬러 테두리 없음).
  - 안내: "민트 1개를 씁니다 / 가방에 N개" 또는 "민트가 없어요 / 상점 100P".
- 줍기: `src/find/core.ts`의 민트 묶음 처리를 없앴다. `mint`는 도구 후보 하나(가중치 1/100)다.
- `scripts/dev-manage.cjs`: 시험 가방을 `mint: 2`로 바꿨다.
- 문서: `docs/specs/game.md`, `docs/design.md`, `docs/specs/balance.md`, `docs/terms.md`, `docs/specs/scenarios.md`, `docs/specs/ui-components.md`.

## 검수

- `npm run build`, `npm run check`: 통과.
- selftest 25개 통과(find, bag, snapshot, mail, save, legacy, tx, manage 등). Claude가 find, bag, mail, snapshot을 다시 돌려 통과를 확인했다(2026-09-29).
- `scripts/selftest-cli.cjs`, `git diff --check`: 통과.
- `node scripts/check-docs.cjs`: `docs/worklog-mac` 줄 하나만 남는다.
- 앱 실기: 하지 않았다.

## 피드백과 수정

### 실기 확인 항목

1. 성격 변경 창이 창 높이(682)에 스크롤 없이 들어간다. 격자 칸 글자(`장난꾸러기` 등)가 잘리지 않는다.
2. 가운데, 가방, 상점의 민트 그림이 초록이다.
3. 옛 민트를 가진 저장을 열면 가방에 "민트 ×합계" 하나로 보인다.

### Figma

- Figma의 성격 변경 창과 상점·가방의 민트 그림은 고치지 않았다. 코드와 다르다.
