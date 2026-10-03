// 도감 상세 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-dex-detail.js
//
// 테스트 프레임워크 없이 assert 만. 한 종의 입수 방법·진화 문구를 본다.
// 계약은 docs/specs/game.md "도감", 화면은 Figma Dex / Base 와 도감 기기 창이다(설정창 안의 옛 Dex / Detail / * 는 2026-09-29 지웠다).
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { empty } from "../../save/v3";
import type { SaveV3 } from "../../shared/save-v3";
import { dexDetail } from "../../view/dex-detail";
import { onlyStepText, stepText } from "../../view/evo-text";
import { evoItemNote, shopDetail } from "../../view/shop-detail";
import { josa } from "../../shared/josa";
import { iconUrl, portraitKey, portraitUrl } from "../../main/art/portraits";
import { cryUrl } from "../../main/art/cries";
import { dockAt } from "../../main/windows/placement";

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
  assert.equal(d.methods, "첫 선택 후보 · 랜덤알", "첫 선택 후보이고 해금했으니 랜덤알에서 나온다. 상점 줄은 잠시 숨김");
  assert.equal(d.evolution, "Lv.16에서 리자드로 진화");
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
  assert.equal(d.evolution, "Lv.36에서 리자몽으로 진화");
  process.stdout.write("(2) 해금 · 앞 단계에서 진화  ok\n");
}

// (3) 최종 단계 — 더 진화하지 않는다
{
  const d = dexDetail(seed(), "charizard");
  assert.ok(d);
  assert.equal(d.evolution, "더 진화하지 않아요");
  process.stdout.write("(3) 최종 단계  ok\n");
}

// (3b) 갈래가 여럿이면 단계 문구만 잇는다. 조사는 도구 이름 받침에 맞춘다
{
  const s = seed();
  s.dex.unlocked.push("gloom", "poliwhirl");
  assert.equal(dexDetail(s, "gloom")?.evolution, "리프의돌로 라플레시아 · 태양의돌로 아르코");
  assert.equal(dexDetail(s, "poliwhirl")?.evolution, "물의돌로 강챙이 · 연결의끈으로 왕구리");
  assert.deepStrictEqual(
    ["박스 3", "박스 1", "박스 2", "피카츄", "리자몽"].map((w) => [josa(w, "으로/로"), josa(w, "을/를"), josa(w, "은/는")]),
    [["으로", "을", "은"], ["로", "을", "은"], ["로", "를", "는"], ["로", "를", "는"], ["으로", "을", "은"]],
  );
  process.stdout.write("(3b) 여러 갈래 진화와 조사  ok\n");
}

// (4) 미해금 화석 종 — 이름·타입·진화는 숨기고 입수 방법은 보인다
{
  const d = dexDetail(seed(), "omanyte");
  assert.ok(d);
  assert.equal(d.state, "locked");
  assert.equal(d.name, "???");
  assert.deepStrictEqual(d.types, []);
  assert.equal(d.methods, "태고의돌", "화석은 랜덤알이 붙지 않는다. 상점 줄은 잠시 숨김");
  assert.equal(d.evolution, "???");
  process.stdout.write("(4) 미해금 · 태고의돌  ok\n");
}

// (4b) 해금한 화석 종도 랜덤알은 붙지 않는다 — 화석은 태고의돌과 상점으로 얻는다 (2026-09-29 사용자 결정)
{
  const s = seed();
  s.dex.unlocked.push("omanyte", "aerodactyl");
  assert.equal(dexDetail(s, "omanyte")?.methods, "태고의돌");
  assert.equal(dexDetail(s, "aerodactyl")?.methods, "태고의돌", "상점 줄은 잠시 숨김");
  process.stdout.write("(4b) 해금한 화석 · 태고의돌과 상점  ok\n");
}

// (5) 알 행동 조건은 없다 — 윈디는 가디에서 진화, 가디는 랜덤알 (2026-09-28 알 행동 조건 삭제)
{
  const s = seed();
  s.dex.discovered.arcanine = "pat-3"; // 옛 저장의 발견 기록은 입수 방법에 드러나지 않는다
  const arcanine = dexDetail(s, "arcanine");
  assert.ok(arcanine);
  assert.ok(!arcanine.methods.includes("알 행동 조건"), arcanine.methods);
  assert.ok(!arcanine.methods.includes("랜덤알"), "진화형은 랜덤알에서 나오지 않는다");
  assert.ok(dexDetail(s, "growlithe")?.methods.includes("랜덤알"));
  process.stdout.write("(5) 알 행동 조건 없음 · 진화형은 진화로만  ok\n");
}

// (6) 전설 종 — 해금 규칙이 없어도 단일 포켓몬 알이 입수 방법이다 (2026-09-26 사용자 결정).
// 미해금 랜덤알 후보는 "랜덤알(해금 후)", 경로가 없으면 "획득 방법 준비 중" 이다(src/tx/dex-detail.ts)
{
  const d = dexDetail(seed(), "cosmog");
  assert.ok(d);
  assert.equal(d.state, "locked");
  assert.equal(d.methods, "랜덤전설알");
  process.stdout.write("(6) 전설 종 · 랜덤전설알  ok\n");
}

// (6b) 미해금 랜덤알 후보 — 랜덤알과 상점 줄에 "해금 후"를 붙여 보인다
{
  assert.equal(dexDetail(seed(), "abra")?.methods, "랜덤알(해금 후)");
  process.stdout.write("(6b) 미해금 랜덤알 후보  ok\n");
}

// (7) 잠만보는 먹고자 진화로만 얻는다 — 상점 줄이 없다 (2026-09-29 사용자 결정). 모르는 종은 null
{
  assert.equal(dexDetail(seed(), "snorlax")?.methods, "먹고자에서 진화");
  assert.equal(dexDetail(seed(), "cosmog")?.methods.includes("상점"), false, "단일 포켓몬 알의 종은 팔지 않는다");
  assert.equal(dexDetail(seed(), "lapras")?.methods, "업적 보상(함께 100시간 일하기)", "라프라스는 업적 보상 (2026-09-29 사용자 결정)");
  assert.equal(dexDetail(seed(), "ditto")?.methods, "업적 보상(파티 세 마리 모으기)");
  assert.equal(dexDetail(seed(), "chansey")?.methods, "핑복에서 진화", "럭키는 핑복 진화");
  assert.equal(dexDetail(seed(), "없는종"), null);
  process.stdout.write("(7) 잠만보 · 진화만, 모르는 종  ok\n");
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

// (9) 공식 분류와 설명 — 해금한 종만. 899번부터의 한국어 설명은 보충 파일에서 온다
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
  assert.ok(/[가-힣]/.test(p?.flavor ?? "") && !/[A-Za-z]{3,}/.test(p?.flavor ?? ""), "899번부터도 한국어 설명 — data/dex-text.ko.json 으로 채운다 (2026-10-03)");
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

// (10b) 리전폼 — 폼 순번, 폼 타입·키·몸무게, 설명문은 기본형 것 (data/regional.json · data/dex-text.json)
{
  const s = seed();
  s.dex.unlocked.push("raichu", "raichu-alola", "meowth-galar");
  const a = dexDetail(s, "raichu-alola");
  const base = dexDetail(s, "raichu");
  assert.deepStrictEqual([a?.dex, a?.form, a?.name], [26, 1, "알로라 라이츄"]);
  assert.deepStrictEqual(a?.typeIds, ["electric", "psychic"]);
  assert.deepStrictEqual([a?.height, a?.weight], ["0.7m", "21.0kg"], "키·몸무게는 폼 값");
  assert.equal(a?.flavor, base?.flavor, "설명문은 기본형 것");
  assert.equal(base?.form, undefined, "기본형에는 폼 순번이 없다");
  assert.equal(a?.methods, "피카츄에서 진화 (지도)", "지도 간선 결과는 얻는 방법에 지도를 적는다");
  assert.equal(base?.methods, "피카츄에서 진화", "기본형 결과는 지도 없이");
  assert.equal(dexDetail(s, "perrserker")?.methods, "나옹에서 진화", "지방 전용 진화는 지도 간선이 아니다");
  // 가라르 나옹 — 진화는 나이킹 하나. 기본형 간선(페르시온)을 받지 않는다
  assert.equal(dexDetail(s, "meowth-galar")?.evolution, "Lv.28에서 나이킹으로 진화");
  process.stdout.write("(10b) 리전폼 상세  ok\n");
}

// (11) 도구로 한 단계 진화 — 조건 뒤에 '로'가 겹치지 않는다
{
  const s = seed();
  s.dex.unlocked.push("pikachu");
  s.dex.unlocked.push("magneton");
  assert.equal(dexDetail(s, "magneton")?.evolution, "천둥의돌을 쓰면 자포코일로 진화");
  // 피카츄는 지도 간선(알로라 라이츄)이 함께 있어 갈래 문구가 된다. 알로라 라이츄는 돌 대신 지도 (data/regional.json, "지도 1개 소비로 변경")
  assert.equal(dexDetail(s, "pikachu")?.evolution, "천둥의돌로 라이츄 · 지도로 알로라 라이츄");
  // 레벨 지도 간선은 조건 뒤에 지도 표시를 붙인다
  s.dex.unlocked.push("quilava");
  assert.equal(dexDetail(s, "quilava")?.evolution, "Lv.36에서 블레이범 · Lv.36에서 히스이 블레이범 (지도)");
  process.stdout.write("(11) 도구 한 단계 진화 문구  ok\n");
}

// (12) 상점 상세 — 포켓몬 진화 트리, 진화용 도구의 대상, 진화 탭 줄 문구 (2026-09-30 사용자 결정 "상점에서 포켓몬 상세 추가")
{
  const s = seed();
  const d = shopDetail(s, "charmander");
  assert.ok(d && d.kind === "pokemon");
  assert.equal(d.name, "파이리");
  assert.equal(d.genus, "도롱뇽포켓몬");
  const t = d.tree;
  assert.deepStrictEqual([t.slug, t.current, t.need], ["charmander", true, undefined], "뿌리는 파이리이고 지금 보는 종");
  assert.deepStrictEqual(t.children.map((c) => [c.name, c.need, c.current]), [["리자드", "Lv.16", false]]);
  assert.deepStrictEqual(t.children[0]?.children.map((c) => [c.name, c.need]), [["리자몽", "Lv.36"]], "일직선 3단");
  // 갈래·미해금 — 랄토스만 해금. 이름은 ??? 로 숨기고 조건은 보인다 (사용자 결정 "다 보여줘")
  s.dex.unlocked.push("ralts");
  const r = shopDetail(s, "ralts");
  assert.ok(r && r.kind === "pokemon");
  const kirlia = r.tree.children[0];
  assert.deepStrictEqual([kirlia?.name, kirlia?.locked, kirlia?.need], ["???", true, "Lv.20"]);
  assert.deepStrictEqual(kirlia?.children.map((c) => [c.name, c.need]), [["???", "Lv.30"], ["???", "각성의돌 · 수컷"]], "킬리아 갈래 — 엘레이드는 수컷만");
  // 도감 문장도 성별 조건을 적는다 — 친밀도 조건처럼 결과 뒤 괄호 (94 항목 2-3)
  assert.strictEqual(stepText({ to: "gallade", need: { kind: "item", item: "dawn-stone" }, gender: "male" }), "각성의돌로 엘레이드 (수컷)");
  assert.strictEqual(onlyStepText({ to: "vespiquen", need: { kind: "level", level: 21 }, gender: "female" }), "Lv.21에서 비퀸 (암컷)", "한 단계뿐이어도 괄호 꼴");
  // 이브이 8갈래 — 친밀도·시간대 조건
  s.dex.unlocked.push("eevee", "espeon");
  const e = shopDetail(s, "eevee");
  assert.ok(e && e.kind === "pokemon");
  assert.equal(e.tree.children.length, 8);
  assert.deepStrictEqual(e.tree.children.find((c) => c.slug === "espeon")?.need, "친밀도 65 · 낮");
  assert.equal(e.tree.children.find((c) => c.slug === "espeon")?.name, "에브이", "해금한 갈래는 이름을 보인다");
  // 사려는 종이 사슬 가운데여도 뿌리부터 그린다
  const mid = shopDetail(s, "charmeleon");
  assert.ok(mid && mid.kind === "pokemon");
  assert.deepStrictEqual([mid.tree.slug, mid.tree.current, mid.tree.children[0]?.current], ["charmander", false, true]);
  // 진화용 도구 — 천둥의돌 7쌍(알로라 라이츄는 지도 쌍이라 빠진다), 진화 전 도감 번호순
  s.dex.unlocked.push("pikachu", "raichu", "magneton");
  const th = shopDetail(s, "thunder-stone");
  assert.ok(th && th.kind === "evolution");
  assert.equal(th.pairs.length, 7);
  assert.deepStrictEqual(th.pairs.slice(0, 2).map((p) => [p.from.name, p.to.name]), [["피카츄", "라이츄"], ["레어코일", "???"]], "자포코일은 미해금");
  assert.ok(!th.pairs.some((p) => p.to.slug === "raichu-alola"), "천둥의돌로는 알로라 라이츄로 가지 않는다");
  const dawn = shopDetail(s, "dawn-stone");
  assert.ok(dawn && dawn.kind === "evolution");
  assert.deepStrictEqual(dawn.pairs.map((p) => p.note), ["수컷", "암컷"], "도구 밖 조건은 note 로");
  // 진화 탭 줄 문구 — 해금한 진화 전 종만 이름으로
  assert.equal(evoItemNote(s, "thunder-stone"), "피카츄·레어코일 외 5종");
  assert.equal(evoItemNote(s, "dawn-stone"), "대상 2종", "해금한 진화 전 종이 없으면 수만");
  // 가라두구머리장식은 가라르 야돈 → 가라르 야도킹 한 쌍이다. 기본 야돈 → 야도킹은 연결의끈 (2026-09-30 사용자 결정)
  s.dex.unlocked.push("slowpoke");
  assert.equal(evoItemNote(s, "galarica-wreath"), "??? → ???", "한 쌍이면 진화 전 → 진화 후");
  s.dex.unlocked.push("slowpoke-galar");
  assert.equal(evoItemNote(s, "galarica-wreath"), "가라르 야돈 → ???");
  // 지도 — map 간선 12쌍. 트리의 지금 칸은 슬러그로 가린다(라이츄와 알로라 라이츄는 번호가 같다)
  const map = shopDetail(s, "region-map");
  assert.ok(map && map.kind === "evolution");
  assert.equal(map.pairs.length, 12);
  assert.deepStrictEqual([map.pairs[0]?.from.slug, map.pairs[0]?.to.slug, map.pairs[0]?.note], ["pikachu", "raichu-alola", undefined], "돌 대신 지도인 쌍은 설명 없음");
  assert.equal(map.pairs.find((p) => p.to.slug === "typhlosion-hisui")?.note, "Lv.36", "레벨 지도 쌍은 레벨");
  const rai = shopDetail(s, "raichu");
  assert.ok(rai && rai.kind === "pokemon");
  const raichus = rai.tree.children[0]?.children ?? [];
  assert.deepStrictEqual(raichus.map((c) => [c.slug, c.current, c.need]), [["raichu", true, "천둥의돌"], ["raichu-alola", false, "지도"]], "트리 화살표는 지도 하나");
  const qui = shopDetail(s, "quilava");
  assert.ok(qui && qui.kind === "pokemon");
  assert.equal(qui.tree.children[0]?.children.find((c) => c.slug === "typhlosion-hisui")?.need, "Lv.36 · 지도", "레벨 지도 간선은 레벨 뒤에 지도");
  assert.equal(shopDetail(s, "not-a-thing"), null);
  process.stdout.write("(12) 상점 상세 · 진화 트리·대상·줄 문구  ok\n");
}

process.stdout.write("selftest-dex-detail: 통과 (획득·해금·최종·미해금·알 조건·경로 없음·상점·타입 키·그림·소리 주소·공식 설명·키 몸무게·기기 창 자리)\n");
