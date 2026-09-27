// 도감 상세 자체 확인 — npm run build 뒤 node dist/tools/selftest-dex-detail.js
//
// 테스트 프레임워크 없이 assert 만. 한 종의 입수 방법·진화·알 행동 조건 문구를 본다.
// 계약은 docs/specs/game.md "도감", 화면은 Figma Dex / Base 와 Dex / Detail / * 다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { empty } from "../save/v3";
import type { SaveV3 } from "../shared/save-v3";
import { dexDetail } from "../tx/dex-detail";
import { iconUrl, portraitKey, portraitUrl } from "../main/portraits";
import { cryUrl } from "../main/cries";
import { dockAt } from "../main/dex-window";

const T0 = new Date(2026, 8, 25, 10, 0, 0).getTime();

function seed(): SaveV3 {
  const s = empty(T0);
  s.dex.obtained = ["charmander"];
  s.dex.unlocked = ["charmander", "charmeleon", "charizard"];
  return s;
}

// (1) 획득한 첫 선택 후보 — 파이리
{
  const d = dexDetail(seed(), "charmander");
  assert.ok(d);
  assert.equal(d.name, "파이리");
  assert.equal(d.state, "obtained");
  assert.deepStrictEqual(d.types, ["불꽃"]);
  assert.equal(d.methods, "첫 선택 후보 · 랜덤알", "첫 선택 후보이고 해금했으니 랜덤알에서도 나온다");
  assert.equal(d.evolution, "Lv.16에서 리자드 · 진화는 개체 상세에서 직접");
  assert.equal(d.eggCondition, "없음");
  assert.equal(d.gimmick, "없음");
  process.stdout.write("(1) 획득 · 첫 선택 후보와 진화 조건  ok\n");
}

// (2) 해금만 한 진화 종 — 리자드는 파이리에서 진화한다
{
  const d = dexDetail(seed(), "charmeleon");
  assert.ok(d);
  assert.equal(d.state, "unlocked");
  assert.equal(d.owned, 0);
  assert.equal(d.methods, "파이리에서 진화", "진화 전용 종은 랜덤알에서 나오지 않는다");
  assert.equal(d.evolution, "Lv.36에서 리자몽 · 진화는 개체 상세에서 직접");
  process.stdout.write("(2) 해금 · 앞 단계에서 진화  ok\n");
}

// (3) 최종 단계 — 더 진화하지 않는다
{
  const d = dexDetail(seed(), "charizard");
  assert.ok(d);
  assert.equal(d.evolution, "더 진화하지 않아요");
  process.stdout.write("(3) 최종 단계  ok\n");
}

// (4) 미해금 화석 종 — 이름·타입·진화는 숨기고 입수 방법은 보인다
{
  const d = dexDetail(seed(), "omanyte");
  assert.ok(d);
  assert.equal(d.state, "locked");
  assert.equal(d.name, "???");
  assert.deepStrictEqual(d.types, []);
  assert.equal(d.methods, "태고의돌", "해금 전이라 랜덤알은 붙지 않는다");
  assert.equal(d.evolution, "해금하면 보여요");
  process.stdout.write("(4) 미해금 · 태고의돌  ok\n");
}

// (4b) 해금한 화석 종도 랜덤알은 붙지 않는다 — 화석은 태고의돌로만 얻는다
{
  const s = seed();
  s.dex.unlocked.push("omanyte");
  assert.equal(dexDetail(s, "omanyte")?.methods, "태고의돌");
  process.stdout.write("(4b) 해금한 화석 · 태고의돌만  ok\n");
}

// (5) 알 행동 조건 종 — 발견 전은 힌트, 발견 뒤는 조건 문구
{
  const s = seed();
  const before = dexDetail(s, "arcanine");
  assert.ok(before);
  assert.ok(before.methods.includes("알 행동 조건"), before.methods);
  assert.equal(before.eggCondition, "미발견 · 알을 돌보는 방법에 따라 나올 수 있어요");
  s.dex.discovered.arcanine = "pat-3";
  const after = dexDetail(s, "arcanine");
  assert.equal(after?.eggCondition, "발견 · 쓰다듬기만 3~7회");
  process.stdout.write("(5) 알 행동 조건 · 발견 전후  ok\n");
}

// (6) 전설 종 — 해금 규칙이 없어도 단일 포켓몬 알이 입수 방법이다 (2026-09-26 사용자 결정).
// 지금 데이터에는 경로가 없는 종이 없다. 경로가 없으면 "획득 방법 준비 중" 이다(src/tx/dex-detail.ts)
{
  const d = dexDetail(seed(), "cosmog");
  assert.ok(d);
  assert.equal(d.state, "locked");
  assert.equal(d.methods, "랜덤전설알");
  process.stdout.write("(6) 전설 종 · 랜덤전설알  ok\n");
}

// (7) 상점 종 — 해금 전에는 "해금 후"를 붙인다. 모르는 종은 null
{
  const d = dexDetail(seed(), "snorlax");
  assert.ok(d?.methods.includes("상점 구매 800P(해금 후)"), d?.methods);
  assert.equal(dexDetail(seed(), "없는종"), null);
  process.stdout.write("(7) 상점 종과 모르는 종  ok\n");
}

// (8) 타입 키와 초상 경로 — 배지 색은 타입 키로, 초상은 4자리 도감 번호 경로로 고른다
{
  const d = dexDetail(seed(), "charmander");
  assert.deepStrictEqual(d?.typeIds, ["fire"]);
  assert.deepStrictEqual(dexDetail(seed(), "omanyte")?.typeIds, [], "미해금은 타입을 숨긴다");
  assert.equal(portraitUrl(25, false), "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png");
  assert.equal(portraitUrl(25, true), "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/25.png");
  assert.equal(portraitKey({ slug: "eevee", shiny: true }), "eevee:shiny");
  assert.equal(iconUrl("item:rare-candy"), "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/rare-candy.png");
  assert.equal(iconUrl("egg"), "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/egg.png");
  assert.equal(iconUrl("item:../x"), null, "식별자 모양이 아니면 받지 않는다");
  assert.equal(cryUrl(25), "https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/25.ogg");
  process.stdout.write("(8) 타입 키와 초상 경로  ok\n");
}

// (9) 공식 분류와 설명 — 해금한 종만. 한국어 설명이 없는 종은 영어로 대신한다
{
  const d = dexDetail(seed(), "charmander");
  assert.equal(d?.genus, "도롱뇽포켓몬");
  assert.ok((d?.flavor ?? "").length > 10, d?.flavor);
  const locked = dexDetail(seed(), "omanyte");
  assert.deepStrictEqual([locked?.genus, locked?.flavor], ["", ""], "미해금은 숨긴다");
  const late = seed();
  late.dex.unlocked.push("pecharunt");
  const p = dexDetail(late, "pecharunt");
  assert.equal(p?.genus, "지배포켓몬");
  assert.ok(/[A-Za-z]/.test(p?.flavor ?? ""), "899번부터는 영어 설명");
  process.stdout.write("(9) 공식 분류와 설명  ok\n");
}

// (10) 키·몸무게 — 도감 기기 창. 소수 한 자리, 미해금은 숨긴다
{
  const d = dexDetail(seed(), "charmander");
  assert.deepStrictEqual([d?.height, d?.weight], ["0.6m", "8.5kg"]);
  const locked = dexDetail(seed(), "omanyte");
  assert.deepStrictEqual([locked?.height, locked?.weight], ["", ""], "미해금은 숨긴다");
  // 붙일 자리 — 오른쪽에 자리가 없으면 왼쪽. 아래가 모자라면 위로 올린다
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepStrictEqual(dockAt({ x: 100, y: 50, width: 640, height: 780 }, area, { width: 380, height: 508 }), { x: 740, y: 50, side: "right" });
  assert.deepStrictEqual(dockAt({ x: 1400, y: 50, width: 640, height: 780 }, area, { width: 380, height: 508 }), { x: 1020, y: 50, side: "left" });
  assert.equal(dockAt({ x: 100, y: 800, width: 640, height: 780 }, area, { width: 380, height: 508 }).y, 532);
  process.stdout.write("(10) 키·몸무게 · 기기 창 자리  ok\n");
}

process.stdout.write("selftest-dex-detail: 통과 (획득·해금·최종·미해금·알 조건·경로 없음·상점·타입 키·그림·소리 주소·공식 설명·키 몸무게·기기 창 자리)\n");
