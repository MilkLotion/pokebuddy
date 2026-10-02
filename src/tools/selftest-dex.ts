// 도감 모듈 자체 확인 — npm run build 뒤 node dist/tools/selftest-dex.js (npm run selftest 가 넷을 차례로 돈다)
//
// 테스트 프레임워크 없이 assert 만. data/*.json 을 읽기만 하고 저장·네트워크는 없다
// 확인: 25 성격 · 축 합 · 중립 5 · 프로필 합치기(override · 기본값 · -3d) · 진화 사슬 · 해금 조건 종류마다 참/거짓 · evaluate
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import path from "node:path";
import * as data from "../dex/data";
import * as evo from "../dex/evo";
import * as gender from "../dex/gender";
import * as natures from "../dex/natures";
import * as species from "../dex/species";
import * as unlocks from "../dex/unlocks";
import * as regional from "../dex/regional";
import type { UnlockRules } from "../dex/unlocks";
import type { Pet, SaveV2, World } from "../shared/types";

// 배럴 없이 모듈을 직접
const dex = { ...data, ...natures, ...species, ...evo, ...unlocks };

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const T0 = new Date(2026, 8, 17, 10, 0, 0).getTime(); // 2026-09-17 10:00 로컬
const DATA_DIR = path.join(__dirname, "..", "..", "data");

// 있어야 하는 값 — 없으면 여기서 실패한다 (없는 값에 점을 찍어 TypeError 로 죽는 대신)
function some<T>(v: T | null | undefined, what = "값"): T {
  assert.ok(v != null, `${what} 이(가) 없다`);
  return v;
}

// ── 픽스처 ─────────────────────────────────────────────────────────────────────
let seq = 0;
function pet(species: string, affinity: number, extra: Partial<Pet> = {}): Pet {
  seq += 1;
  return {
    id: `p${seq}`,
    species,
    shiny: false,
    nature: "hardy",
    nick: null,
    size: 1,
    shown: true,
    home: { dx: 0, dy: 0 },
    hunger: 0,
    mood: 60,
    affinity,
    stage: 0,
    since: T0,
    fedAt: null,
    playedAt: null,
    daily: { date: "2026-09-17", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
    evolved: [],
    ...extra,
  };
}

const DAY = T0 + 10 * 60_000; // 게임 시간 낮 (매시 0~29분)
const NIGHT = T0 + 40 * 60_000; // 게임 시간 밤 (매시 30~59분)

function world(over: Partial<Pick<World, "now">> = {}, save: Partial<SaveV2> = {}): World {
  return {
    now: DAY,
    ...over,
    save: {
      v: 2,
      points: 0,
      slots: 1,
      party: [],
      daily: { date: "2026-09-17", streak: 0, interacted: false },
      totals: { workMs: 0, presenceMs: 0, tokens: 0, turns: 0, days: 0, fed: 0, played: 0 },
      agents: {},
      unlocked: [],
      inventory: {},
      acc: {},
      log: [],
      ...save,
    },
  };
}

// ── 성격 ───────────────────────────────────────────────────────────────────────
{
  const all = dex.natures();
  assert.strictEqual(all.length, 25, "성격 25개");
  assert.strictEqual(new Set(all.map((n) => n.id)).size, 25, "id 중복 없음");
  let neutral = 0;
  for (const n of all) {
    assert.ok(n.name.ko && n.name.en, `${n.id} 이름 ko·en`);
    const vals = dex.AXES.map((a) => n.axes[a]);
    assert.strictEqual(vals.length, 5, `${n.id} 축 5개`);
    for (const v of vals) assert.ok([-1, 0, 1].includes(v), `${n.id} 축 값은 -1·0·1`);
    const sum = vals.reduce<number>((a, b) => a + b, 0);
    assert.strictEqual(sum, 0, `${n.id} 축 합 0`);
    const nonzero = vals.filter((v) => v !== 0).length;
    assert.ok(nonzero === 0 || nonzero === 2, `${n.id} 는 중립(0개) 또는 +1/−1 한 쌍`);
    if (nonzero === 0) neutral += 1;
  }
  assert.strictEqual(neutral, 5, "중립 5개");
  assert.deepStrictEqual(
    all.filter((n) => Object.values(n.axes).every((v) => v === 0)).map((n) => n.id).sort(),
    ["bashful", "docile", "hardy", "quirky", "serious"],
    "중립은 대각선 다섯",
  );
  assert.strictEqual(some(dex.nature("quirky")).quirk, "random", "변덕만 quirk");
  assert.strictEqual(all.filter((n) => n.quirk).length, 1, "quirk 는 하나");
  const brave = some(dex.nature("brave"));
  assert.strictEqual(brave.axes.boldness, 1);
  assert.strictEqual(brave.axes.activity, -1);
  assert.strictEqual(brave.name.ko, "용감");
  assert.deepStrictEqual(dex.axesOf("umbreon-is-not-a-nature"), { activity: 0, boldness: 0, steadiness: 0, sociability: 0, patience: 0 }, "모르는 성격은 전부 0");
  assert.strictEqual(dex.nature("nope"), undefined);
  assert.strictEqual(dex.isNatureId("calm"), true);
  assert.strictEqual(dex.isNatureId("Calm"), false);
  assert.strictEqual(dex.randomNature(() => 0).id, "hardy", "rng 0 → 첫 성격");
  assert.strictEqual(dex.randomNature(() => 0.9999).id, "quirky", "rng 끝 → 마지막 성격");
  assert.strictEqual(dex.randomNature(() => 1).id, "quirky", "rng 1 도 범위 안으로");
  // 축 복사본 — 돌려받은 것을 고쳐도 표는 그대로
  const ax = dex.axesOf("brave");
  ax.boldness = 0;
  assert.strictEqual(dex.axesOf("brave").boldness, 1);
  // 경로 주입
  assert.strictEqual(dex.natures({ dataDir: DATA_DIR }).length, 25, "dataDir 주입");
  out("성격 ok");
}

// ── 종 프로필 ──────────────────────────────────────────────────────────────────
{
  const pika = dex.profile("pikachu");
  assert.strictEqual(pika.slug, "pikachu");
  assert.strictEqual(pika.dex, 25);
  assert.deepStrictEqual(pika.likes, ["work", "play"], "overrides 의 likes");
  assert.deepStrictEqual(pika.types, ["electric"], "defaults 의 타입은 그대로");
  assert.strictEqual(pika.baseSpeed, 90);
  assert.strictEqual(pika.weightKg, 6);
  assert.deepStrictEqual(dex.profile("pikachu-3d"), pika, "-3d 는 같은 종");
  assert.deepStrictEqual(dex.profile("  PIKACHU "), pika, "공백·대소문자 정규화");
  assert.deepStrictEqual(dex.profile("eevee").likes, ["company", "play"]);
  assert.deepStrictEqual(dex.profile("squirtle").likes, ["food", "company"]);
  assert.strictEqual(dex.profile("rowlet").sleepiness, 1.3, "override 의 부분 필드");
  assert.strictEqual(dex.profile("rowlet").moodBase, 60 + 2 + 2, "override 에 없는 필드는 defaults (grass+flying)");

  const unknown = dex.profile("not-a-mon");
  assert.deepStrictEqual(unknown, { slug: "not-a-mon", dex: 0, growthRate: "medium-fast", bst: 0, stage: 1, rank: 1, genderRate: 4, sleepiness: 1, moodBase: 60, moodSwing: 1, likes: ["play"], types: [] }, "모르는 슬러그는 기본 프로필");

  // 성별 — 원작 성비 (2026-09-30 사용자 결정). 무성·한 성별 종은 그 성별, 옛 개체는 반반이고 열 때마다 같다
  assert.strictEqual(dex.profile("salandit").genderRate, 1, "야도뉴 암컷 1/8");
  assert.strictEqual(gender.fixedGender("magnemite"), "none", "코일은 무성");
  assert.strictEqual(gender.fixedGender("chansey"), "female", "럭키는 암컷만");
  assert.strictEqual(gender.fixedGender("gallade"), "male", "엘레이드는 수컷만");
  assert.strictEqual(gender.fixedGender("pikachu"), null);
  assert.strictEqual(gender.rollGender("salandit", () => 0.1), "female", "0.1 × 8 < 1 → 암컷");
  assert.strictEqual(gender.rollGender("salandit", () => 0.2), "male");
  assert.strictEqual(gender.rollGender("magnemite", () => 0.1), "none");
  let draws = 0;
  gender.rollGender("chansey", () => (draws++, 0.5));
  assert.strictEqual(draws, 1, "한 성별 종도 난수를 하나 쓴다");
  const old = { id: "p1", species: "pikachu", since: 1_700_000_000_000 };
  assert.strictEqual(gender.legacyGender(old), gender.legacyGender({ ...old }), "옛 개체 성별은 열 때마다 같다");
  assert.strictEqual(gender.legacyGender({ ...old, species: "salazzle" }), "female", "염뉴트로 진화한 옛 개체는 암컷");
  assert.strictEqual(gender.legacyGender({ ...old, species: "voltorb" }), "none");
  const halves = { male: 0, female: 0, none: 0 };
  for (let i = 0; i < 1000; i++) halves[gender.legacyGender({ id: `p${i}`, species: "pikachu", since: i * 7919 })]++;
  assert.ok(halves.male > 400 && halves.female > 400, `옛 개체는 반반 — ${halves.male}:${halves.female}`);
  assert.strictEqual(dex.hasProfile("pikachu"), true);
  assert.strictEqual(dex.hasProfile("pikachu-3d"), true);
  assert.strictEqual(dex.hasProfile("not-a-mon"), false);
  assert.strictEqual(dex.hasProfile("_comment"), false, "메모 키는 종이 아니다");
  assert.strictEqual(dex.profile("_comment").likes[0], "play");
  // 돌려받은 배열을 고쳐도 표는 그대로
  pika.likes.push("food");
  assert.deepStrictEqual(dex.profile("pikachu").likes, ["work", "play"]);
  assert.strictEqual(dex.slugs().length, 1178, "표의 종 수 — PokeAPI 종 1025 + 폼 83 + 리전폼 57 + 특수 폼 13 (배쓰나이(청색근의 모습)와 기라티나(오리진폼)는 폼에서 특수 폼으로 옮겼다)");
  assert.ok(!dex.slugs().includes("_comment"));
  // 모든 종의 값 범위
  for (const s of dex.slugs()) {
    const p = dex.profile(s);
    assert.ok(p.dex > 0, `${s} 도감번호`);
    assert.ok(!("affinityRate" in p) && !("hungerRate" in p), `${s} 종별 배율은 없다 (2026-09-27)`);
    assert.ok(p.sleepiness >= 0.7 && p.sleepiness <= 1.3, `${s} sleepiness`);
    assert.ok(p.moodBase >= 55 && p.moodBase <= 65, `${s} moodBase`);
    assert.ok([0.8, 1, 1.2].includes(p.moodSwing), `${s} moodSwing`);
    assert.ok(p.likes.length >= 1 && p.likes.length <= 2, `${s} likes 1~2`);
    for (const l of p.likes) assert.ok(["work", "play", "company", "food"].includes(l), `${s} like ${l}`);
  }
  out("종 프로필 ok");
}

// ── 진화 사슬 ──────────────────────────────────────────────────────────────────
{
  const eevee = dex.nextOf("eevee");
  assert.strictEqual(eevee.length, 8, "이브이 진화 8종");
  assert.deepStrictEqual(eevee.map((s) => s.to).sort(), ["espeon", "flareon", "glaceon", "jolteon", "leafeon", "sylveon", "umbreon", "vaporeon"]);
  assert.strictEqual(eevee.find((s) => s.to === "umbreon")?.when, "night");
  assert.strictEqual(eevee.find((s) => s.to === "espeon")?.when, "day");
  assert.strictEqual(eevee.find((s) => s.to === "vaporeon")?.when, undefined);
  assert.deepStrictEqual(dex.nextOf("umbreon"), []);
  assert.deepStrictEqual(dex.nextOf("ditto"), []);
  assert.deepStrictEqual(dex.nextOf("not-a-mon"), []);
  assert.deepStrictEqual(dex.nextOf("charmander").map((s) => s.to), ["charmeleon"]);

  const line = dex.lineOf("umbreon");
  assert.ok(line.includes("eevee"), "lineOf(umbreon) 에 eevee");
  assert.strictEqual(line[0], "eevee", "뿌리가 먼저");
  assert.strictEqual(line.length, 9, "이브이 사슬 9종");
  assert.deepStrictEqual(dex.lineOf("eevee"), line, "어디서 보나 같은 사슬");
  assert.deepStrictEqual(dex.lineOf("sylveon"), line);
  assert.deepStrictEqual(dex.lineOf("charizard"), ["charmander", "charmeleon", "charizard"]);
  assert.deepStrictEqual(dex.lineOf("ditto"), ["ditto"], "사슬에 없는 종은 자기만");
  assert.deepStrictEqual(dex.lineOf("not-a-mon"), ["not-a-mon"]);
  // 폼 — 같은 도감번호는 사슬의 모습으로 붙는다
  const rotom = dex.lineOf("rotom");
  assert.ok(rotom.includes("rotom") && rotom.includes("rotom-wash") && rotom.includes("rotom-heat"), "로토무 폼");
  assert.deepStrictEqual(dex.lineOf("rotom-wash"), rotom, "폼에서 봐도 같은 목록");
  assert.deepStrictEqual(dex.lineOf("deoxys-attack")[0], "deoxys");

  assert.strictEqual(dex.stageOf("eevee"), 0);
  assert.strictEqual(dex.stageOf("umbreon"), 1);
  assert.strictEqual(dex.stageOf("charmander"), 0);
  assert.strictEqual(dex.stageOf("charmeleon"), 1);
  assert.strictEqual(dex.stageOf("charizard"), 2);
  assert.strictEqual(dex.stageOf("pichu"), 0);
  assert.strictEqual(dex.stageOf("pikachu"), 1, "사슬 사실 — 피츄가 뿌리");
  assert.strictEqual(dex.stageOf("raichu"), 2);
  assert.strictEqual(dex.stageOf("ditto"), 0);
  assert.strictEqual(dex.stageOf("not-a-mon"), 0);
  assert.strictEqual(dex.stageOf("umbreon-3d"), 1, "-3d");
  assert.strictEqual(dex.prevOf("umbreon"), "eevee");
  assert.strictEqual(dex.prevOf("eevee"), null);
  assert.strictEqual(dex.rootOf("charizard"), "charmander");
  assert.strictEqual(dex.rootOf("ditto"), "ditto");
  assert.strictEqual(dex.inChain("eevee"), true);
  assert.strictEqual(dex.inChain("ditto"), false);
  // 돌려받은 것을 고쳐도 표는 그대로
  some(eevee[0]).to = "mutated";
  assert.notStrictEqual(some(dex.nextOf("eevee")[0]).to, "mutated");
  out("진화 사슬 ok");
}

// ── 리전폼 (data/regional.json) ───────────────────────────────────────────────
// 도감 번호가 같아도 다른 종이다. 기본 종으로 풀지 않고, 같은 결과로 가면 부모는 기본형이다
{
  const table = regional.regionalTable();
  const forms = Object.entries(table.forms);
  const edges = Object.entries(table.edges).flatMap(([from, steps]) => steps.map((st) => ({ from, ...st })));
  assert.strictEqual(forms.filter(([, f]) => !f.special).length, 57, "리전폼 57종");
  const specials = forms.filter(([, f]) => f.special);
  assert.deepStrictEqual(
    specials.map(([slug, f]) => `${slug}:${f.get}`),
    ["pichu-spiky-eared:gift", "dialga-origin:base", "palkia-origin:base", "giratina-origin:shift", "basculin-blue-striped:variant", "basculin-white-striped:variant", "floette-eternal:base", "lycanroc-midnight:branch", "lycanroc-dusk:branch", "magearna-original:gift", "toxtricity-low-key:branch", "urshifu-rapid-strike:branch", "ursaluna-bloodmoon:base"],
    "특수 폼 13종과 얻는 방법",
  );
  const isSpecial = (slug: string): boolean => table.forms[slug]?.special === true;
  const specialEdge = (e: { from: string; to: string }): boolean => isSpecial(e.to) || isSpecial(e.from);
  assert.strictEqual(edges.filter((e) => !specialEdge(e)).length, 38, "리전폼 간선 38개");
  assert.strictEqual(edges.filter(specialEdge).length, 5, "특수 폼 간선 5개");
  const count = (get: string): number => forms.filter(([, f]) => f.get === get && !f.special).length;
  assert.deepStrictEqual([count("map"), count("base"), count("path")], [12, 28, 17]);
  const names = require(path.join(__dirname, "..", "..", "lib", "names.json")) as Record<string, { ko: string; en: string }>;
  for (const [slug, f] of forms) {
    const p = dex.profile(slug);
    assert.ok(dex.hasProfile(slug), `${slug} 프로필`);
    assert.strictEqual(p.dex, dex.profile(f.base).dex, `${slug} 도감 번호는 기본 종과 같다`);
    assert.ok(p.types.length >= 1, `${slug} 타입`);
    assert.strictEqual(names[slug]?.ko, f.ko, `${slug} 이름표`);
    assert.match(regional.dexLabel(slug, p.dex), /^\d+-\d+$/, `${slug} 표시 번호`);
    if (f.pmd) assert.match(f.pmd, /^\d{4}\/\d{4}$/, `${slug} PMD 경로`);
    assert.strictEqual(dex.stageOf(slug) === 0, f.get === "base" || f.get === "gift" || f.get === "variant" || f.get === "shift", `${slug} 진화 전 종은 base · gift · variant · shift 뿐`);
  }
  for (const e of edges) {
    assert.ok(dex.hasProfile(e.from) && dex.hasProfile(e.to), `${e.from}→${e.to} 도감표`);
    assert.strictEqual(Boolean(e.map), table.forms[e.to]?.get === "map", `${e.from}→${e.to} 지도 간선은 map 결과로만`);
    assert.ok(dex.nextOf(e.from).some((st) => st.to === e.to && Boolean(st.map) === Boolean(e.map)), `${e.from}→${e.to} 가 evo.json 에 있다`);
  }
  assert.strictEqual(regional.dexLabel("raichu-alola", 26, 4), "0026-1");
  assert.strictEqual(regional.dexLabel("tauros-paldea-aqua-breed", 128), "128-3");
  assert.strictEqual(regional.dexLabel("raichu", 26), "26");
  assert.strictEqual(dex.profile("raichu-alola").types.join("/"), "electric/psychic");
  // 부모는 기본형 — 지방 전용 진화는 기본형에서도 리전폼에서도 간다
  assert.strictEqual(dex.prevOf("perrserker"), "meowth");
  assert.strictEqual(dex.prevOf("sirfetchd"), "farfetchd");
  assert.strictEqual(dex.prevOf("obstagoon"), "linoone");
  assert.strictEqual(dex.prevOf("raichu-alola"), "pikachu");
  assert.strictEqual(dex.prevOf("meowth-galar"), null, "리전폼 진화 전 종은 뿌리");
  assert.strictEqual(dex.rootOf("ninetales-alola"), "vulpix-alola");
  assert.strictEqual(dex.rootOf("raichu-alola"), "pichu");
  assert.strictEqual(dex.stageOf("golem-alola"), 2);
  // 리전폼은 자기 자신으로 풀린다 — 기본형 간선을 받지 않는다
  assert.deepStrictEqual(dex.nextOf("meowth-galar").map((st) => st.to), ["perrserker"]);
  assert.deepStrictEqual(dex.nextOf("meowth").map((st) => st.to), ["persian", "perrserker"]);
  assert.deepStrictEqual(dex.nextOf("stunfisk-galar"), [], "간선 없는 리전폼");
  assert.deepStrictEqual(dex.nextOf("articuno-galar"), []);
  assert.deepStrictEqual(dex.nextOf("tauros-paldea-blaze-breed"), []);
  assert.deepStrictEqual(dex.nextOf("pikachu").map((st) => [st.to, st.map ?? false]), [["raichu", false], ["raichu-alola", true]]);
  assert.deepStrictEqual(dex.nextOf("vulpix-alola").map((st) => [st.to, st.map ?? false]), [["ninetales-alola", false]], "리전폼의 다음 진화는 지도 없음");
  assert.ok(!dex.lineOf("rattata").includes("rattata-alola"), "리전폼은 사슬의 모습이 아니다");
  // 기본 야돈 → 야도킹은 교환(연결의끈). 가라두구머리장식은 가라르 야도킹 전용 (2026-09-30 사용자 결정)
  assert.deepStrictEqual(dex.nextOf("slowpoke").find((st) => st.to === "slowking")?.need, { kind: "item", item: "bond-cord" });
  assert.deepStrictEqual(dex.nextOf("slowpoke-galar").find((st) => st.to === "slowking-galar")?.need, { kind: "item", item: "galarica-wreath" });
  // 특수 폼 — 리전폼처럼 다른 종이다. 간선이 없고 기본형의 간선도 그대로다. 수집 난이도는 준전설과 같은 5 (worklog/records/extra-evolution 특수 폼 설계)
  assert.strictEqual(regional.dexLabel("floette-eternal", 670), "670-1");
  assert.strictEqual(regional.dexLabel("ursaluna-bloodmoon", 901), "901-1");
  assert.deepStrictEqual([regional.regionalOf("floette-eternal")?.region, regional.regionalOf("ursaluna-bloodmoon")?.region], ["kalos", "paldea"], "도감 지방 칸");
  for (const slug of ["floette-eternal", "ursaluna-bloodmoon"]) {
    assert.deepStrictEqual(dex.nextOf(slug), [], `${slug} 는 진화하지 않는다`);
    assert.strictEqual(dex.prevOf(slug), null, `${slug} 는 진화로 얻지 않는다`);
    assert.strictEqual(dex.profile(slug).rank, 5, `${slug} 수집 난이도`);
  }
  assert.deepStrictEqual(dex.nextOf("floette").map((st) => st.to), ["florges"]);
  assert.deepStrictEqual(dex.nextOf("ursaring").map((st) => st.to), ["ursaluna"]);
  assert.ok(!dex.lineOf("floette").includes("floette-eternal"), "특수 폼은 사슬의 모습이 아니다");
  // 진화로 얻는 특수 폼 — 암멍이는 낮에 루가루암, 밤에 루가루암(한밤중의 모습). 루가루암(황혼의 모습)은 낮·밤과 관계없이 Lv.25 와 친밀도 100 ("추천대로 하자"). 일레즌은 둘 가운데 고른다.
  // 치고마의 두 간선은 모두 악의 족자다("족자는 하나만 하자") (2026-10-03 사용자 결정)
  assert.deepStrictEqual(dex.nextOf("rockruff").map((st) => [st.to, st.when ?? "", st.need]), [["lycanroc", "day", { kind: "level", level: 25 }], ["lycanroc-midnight", "night", { kind: "level", level: 25 }], ["lycanroc-dusk", "", { kind: "level", level: 25 }]]);
  assert.deepStrictEqual(dex.nextOf("rockruff").map((st) => st.affinity ?? 0), [0, 0, 100], "황혼만 친밀도 100 을 더 본다");
  assert.deepStrictEqual(dex.nextOf("toxel").map((st) => [st.to, st.when ?? ""]), [["toxtricity", ""], ["toxtricity-low-key", ""]]);
  assert.deepStrictEqual(dex.nextOf("kubfu").map((st) => [st.to, st.need]), [["urshifu", { kind: "item", item: "scroll-of-darkness" }], ["urshifu-rapid-strike", { kind: "item", item: "scroll-of-darkness" }]]);
  assert.deepStrictEqual([regional.dexLabel("lycanroc-midnight", 745), regional.dexLabel("lycanroc-dusk", 745)], ["745-1", "745-2"]);
  assert.strictEqual(dex.prevOf("lycanroc-midnight"), "rockruff");
  assert.deepStrictEqual([dex.prevOf("lycanroc-dusk"), dex.nextOf("lycanroc-dusk")], ["rockruff", []]);
  assert.strictEqual(dex.profile("urshifu-rapid-strike").types.join("/"), "fighting/water");
  assert.deepStrictEqual([dex.profile("lycanroc-midnight").rank, dex.profile("toxtricity-low-key").rank], [2, 3], "진화로 얻는 특수 폼의 수집 난이도는 다른 종과 같은 규칙");
  // 우편으로만 받는 특수 폼 — 간선이 없고 수집 난이도 5
  for (const slug of ["magearna-original", "pichu-spiky-eared"]) {
    assert.deepStrictEqual(dex.nextOf(slug), [], `${slug} 는 진화하지 않는다`);
    assert.strictEqual(dex.prevOf(slug), null);
    assert.strictEqual(dex.profile(slug).rank, 5);
  }
  assert.deepStrictEqual(dex.nextOf("pichu").map((st) => st.to), ["pikachu"]);
  // 배쓰나이 — 알에서 적색근 45 · 청색근 45 · 백색근 10, 백색근만 대쓰여너로 진화한다 (2026-10-03 사용자 결정)
  assert.deepStrictEqual(regional.hatchVariants("basculin"), [["basculin", 45], ["basculin-blue-striped", 45], ["basculin-white-striped", 10]]);
  assert.deepStrictEqual(regional.hatchVariants("pikachu"), []);
  assert.deepStrictEqual([regional.hatchBaseOf("basculin-white-striped"), regional.hatchBaseOf("basculin-blue-striped"), regional.hatchBaseOf("basculin"), regional.hatchBaseOf("raichu-alola")], ["basculin", "basculin", null, null]);
  assert.deepStrictEqual([dex.nextOf("basculin"), dex.nextOf("basculin-blue-striped")], [[], []], "적색근과 청색근은 진화하지 않는다");
  assert.deepStrictEqual(dex.nextOf("basculin-white-striped"), [{ to: "basculegion", need: { kind: "affinity", value: 100 } }]);
  assert.strictEqual(dex.prevOf("basculegion"), "basculin-white-striped");
  assert.deepStrictEqual([regional.dexLabel("basculin-blue-striped", 550), regional.dexLabel("basculin-white-striped", 550)], ["550-1", "550-2"]);
  // 지방 전용 진화의 기본형 간선은 그대로다 — 특수 폼 거르기에 걸리지 않는다
  assert.deepStrictEqual(dex.nextOf("corsola").map((st) => st.to), ["cursola"]);
  // 디아루가(오리진폼)·펄기아(오리진폼) — 가라르 파이어처럼 전설 규칙을 따르는 다른 종이다 (2026-10-03 사용자 결정). 원시 디아루가(PMD 전용)는 넣지 않는다
  assert.deepStrictEqual([regional.dexLabel("dialga-origin", 483), regional.dexLabel("palkia-origin", 484)], ["483-1", "484-1"]);
  assert.deepStrictEqual([dex.profile("dialga-origin").types.join("/"), dex.profile("palkia-origin").types.join("/")], ["steel/dragon", "water/dragon"]);
  for (const slug of ["dialga-origin", "palkia-origin"]) {
    assert.strictEqual(dex.profile(slug).rank, 5, `${slug} 수집 난이도`);
    assert.deepStrictEqual([dex.nextOf(slug), dex.prevOf(slug)], [[], null]);
  }
  assert.ok(!dex.hasProfile("dialga-primal"), "원시 디아루가는 없다");
  // 기라티나(오리진폼) — 기라티나 개체가 모습 바꾸기로 오간다 (2026-10-03 사용자 결정 "이거는 모습변경으로하자.")
  assert.deepStrictEqual([regional.shiftGroupOf("giratina"), regional.shiftGroupOf("giratina-origin"), regional.shiftGroupOf("dialga")], [["giratina", "giratina-origin"], ["giratina", "giratina-origin"], []]);
  assert.strictEqual(regional.dexLabel("giratina-origin", 487), "487-1");
  assert.deepStrictEqual([dex.nextOf("giratina-origin"), dex.prevOf("giratina-origin")], [[], null]);
  // 성별 그림 — 대쓰여너 암컷은 종은 그대로이고 그림 이름만 다르다 (2026-10-03)
  assert.deepStrictEqual([regional.genderLookOf("basculegion", "female"), regional.genderLookOf("basculegion", "male"), regional.genderLookOf("basculegion", "none"), regional.genderLookOf("pikachu", "female")], ["basculegion-female", null, null, null]);
  assert.strictEqual(regional.genderLookInfo("basculegion-female")?.species, "basculegion");
  assert.strictEqual(regional.genderLookInfo("basculegion"), null);
  assert.ok(!dex.hasProfile("basculegion-female"), "성별 그림은 종이 아니다");
  // 이름 — 괄호 안에 공식 도감의 모습 이름을 적는다. 기본형도 모습 이름이 있으면 적는다 (2026-10-03 사용자 결정 "다 적고, 괄호로 그 모습을 적자.")
  assert.deepStrictEqual([names["basculin"]?.ko, names["basculin-blue-striped"]?.ko, names["basculin-white-striped"]?.ko], ["배쓰나이(적색근의 모습)", "배쓰나이(청색근의 모습)", "배쓰나이(백색근의 모습)"]);
  assert.deepStrictEqual([names["lycanroc"]?.ko, names["lycanroc-midnight"]?.ko, names["lycanroc-dusk"]?.ko], ["루가루암(한낮의 모습)", "루가루암(한밤중의 모습)", "루가루암(황혼의 모습)"]);
  assert.deepStrictEqual([names["toxtricity"]?.ko, names["toxtricity-low-key"]?.ko], ["스트린더(하이한 모습)", "스트린더(로우한 모습)"]);
  assert.deepStrictEqual([names["giratina"]?.ko, names["giratina-origin"]?.ko], ["기라티나(어나더폼)", "기라티나(오리진폼)"]);
  assert.deepStrictEqual([names["dialga"]?.ko, names["magearna"]?.ko, names["magearna-original"]?.ko], ["디아루가", "마기아나", "마기아나(500년 전의 색)"], "공식 도감에 모습 이름이 없는 기본형은 종 이름 그대로");
  assert.deepStrictEqual([names["urshifu"]?.ko, names["urshifu-rapid-strike"]?.ko], ["우라오스(일격의 태세)", "우라오스(연격의 태세)"], "우라오스는 두 태세 모두 이름에 적는다");
  // 표가 없는 dataDir — 빈 표로 본다
  assert.deepStrictEqual(regional.regionalTable({ dataDir: path.join(__dirname, "no-such-dir") }), { forms: {}, edges: {}, hatch: {}, shift: {}, gender: {} });
  out("리전폼 ok");
}

// ── 해금 조건 ──────────────────────────────────────────────────────────────────
{
  // 게임 시간 — 매시 0~29분 낮, 30~59분 밤. 진화와 같은 기준
  assert.strictEqual(dex.dayPartOf(T0), "day");
  assert.strictEqual(dex.dayPartOf(T0 + 29 * 60_000 + 59_000), "day");
  assert.strictEqual(dex.dayPartOf(T0 + 30 * 60_000), "night");
  assert.strictEqual(dex.dayPartOf(T0 + 59 * 60_000), "night");
  assert.strictEqual(dex.dayPartOf(T0 + 12 * 3600_000 + 40 * 60_000), "night", "시각(22시)이 아니라 분으로 가른다");

  // starter — 표시, 항상 참
  assert.strictEqual(dex.check({ starter: true }, world()), true);

  // evolve — 종·친밀도·시간대
  const umbreon = { evolve: { from: "eevee", affinity: 500, when: "night" as const } };
  assert.strictEqual(dex.check(umbreon, world({ now: NIGHT }, { party: [pet("eevee", 500)] })), true, "밤 + 500");
  assert.strictEqual(dex.check(umbreon, world({ now: DAY }, { party: [pet("eevee", 500)] })), false, "낮이면 거짓");
  assert.strictEqual(dex.check(umbreon, world({ now: NIGHT }, { party: [pet("eevee", 499)] })), false, "499 는 거짓");
  assert.strictEqual(dex.check(umbreon, world({ now: NIGHT }, { party: [pet("pikachu", 900)] })), false, "다른 종은 거짓");
  assert.strictEqual(dex.check(umbreon, world({ now: NIGHT }, { party: [pet("eevee-3d", 500)] })), true, "-3d 도 같은 종");
  assert.strictEqual(dex.check(umbreon, world({ now: NIGHT }, { party: [pet("eevee", 100), pet("eevee", 600)] })), true, "여러 마리 중 하나면 참");
  const raichu = { evolve: { from: "pikachu", affinity: 500 } };
  assert.strictEqual(dex.check(raichu, world({ now: NIGHT }, { party: [pet("pikachu", 500)] })), true, "when 없으면 시간대 무관");
  assert.strictEqual(dex.check(raichu, world({ now: DAY }, { party: [pet("pikachu", 500)] })), true);
  assert.strictEqual(dex.check(raichu, world({}, { party: [] })), false, "빈 파티");
  assert.deepStrictEqual(dex.evolvers(umbreon, world({ now: NIGHT }, { party: [pet("eevee", 100), pet("eevee", 600), pet("eevee", 700)] })).map((p) => p.affinity), [600, 700], "진화할 마리 — 임계 이상인 마리 모두");
  assert.deepStrictEqual(dex.evolvers(umbreon, world({ now: DAY }, { party: [pet("eevee", 600)] })), [], "조건이 거짓이면 아무도");

  // party · work · streak 조건은 2026-09-29 뺐다 — 메타몽·라프라스는 업적 보상, 럭키는 핑복 진화 (selftest-achievement · selftest-unlocks)

  // bond — 종과 친밀도
  const bond = { bond: { of: "pikachu", affinity: 1500 } };
  assert.strictEqual(dex.check(bond, world({}, { party: [pet("pikachu", 1500)] })), true);
  assert.strictEqual(dex.check(bond, world({}, { party: [pet("pikachu", 1499)] })), false);
  assert.strictEqual(dex.check(bond, world({}, { party: [pet("raichu", 9999)] })), false, "진화한 뒤엔 그 종이 아니다");

  // time
  assert.strictEqual(dex.check({ time: "night" }, world({ now: NIGHT })), true);
  assert.strictEqual(dex.check({ time: "night" }, world({ now: DAY })), false);
  assert.strictEqual(dex.check({ time: "day" }, world({ now: DAY })), true);

  // event — 로컬 날짜
  const xmas = new Date(2026, 11, 25, 9, 0, 0).getTime();
  assert.strictEqual(dex.check({ event: { date: "12-25" } }, world({ now: xmas })), true);
  assert.strictEqual(dex.check({ event: { date: "12-25" } }, world({ now: T0 })), false);
  assert.strictEqual(dex.check({ event: { date: "09-17" } }, world({ now: T0 })), true);

  // 여러 조건 — 전부 만족
  const alola = { bond: { of: "pikachu", affinity: 1500 }, time: "night" as const };
  assert.strictEqual(dex.check(alola, world({ now: NIGHT }, { party: [pet("pikachu", 1500)] })), true);
  assert.strictEqual(dex.check(alola, world({ now: NIGHT }, { party: [pet("pikachu", 10)] })), false, "bond 가 거짓이면 time 이 참이어도 거짓");
  assert.strictEqual(dex.check(alola, world({ now: DAY }, { party: [pet("pikachu", 1500)] })), false, "time 이 거짓이면 bond 가 참이어도 거짓");
  assert.strictEqual(dex.check({}, world()), false, "빈 규칙은 거짓");
  out("해금 조건 ok");
}

// ── evaluate · starters · 표 ───────────────────────────────────────────────────
{
  const rules: UnlockRules = {
    _comment: { starter: true },
    a: { starter: true },
    b: { bond: { of: "zz", affinity: 1 } },
    c: { base: true },
    d: { time: "night" },
  };
  assert.deepStrictEqual(dex.evaluate(rules, world({ now: DAY })), ["a", "c"], "만족하는 것만, 표 순서, 메모 키 제외");
  assert.deepStrictEqual(dex.evaluate(rules, world({ now: DAY }, { unlocked: ["a"] })), ["c"], "이미 해금된 것은 뺀다");
  assert.deepStrictEqual(dex.evaluate(rules, world({ now: DAY }, { unlocked: ["A-3d", "c"] })), [], "정규화해 비교");
  assert.deepStrictEqual(dex.evaluate(rules, world({ now: NIGHT }, { unlocked: ["a", "c"] })), ["d"]);
  assert.deepStrictEqual(dex.starters(rules), ["a"]);

  const table = dex.unlockRules();
  const st = dex.starters(table);
  assert.strictEqual(st.length, 29, "스타터 29");
  assert.ok(st.includes("pichu") && st.includes("eevee") && st.includes("bulbasaur") && !st.includes("pikachu"), "2026-09-27 피카츄 대신 피츄");
  assert.deepStrictEqual(table.pichu, { starter: true }, "스타터는 starter 만");
  assert.deepStrictEqual(table.pikachu, { evolve: { from: "pichu", affinity: 500 } }, "피카츄는 피츄 진화로 해금");
  assert.deepStrictEqual(table.raichu, { evolve: { from: "pikachu", affinity: 500 } }, "아기 포켓몬은 단계에 안 센다");
  assert.deepStrictEqual(table.umbreon, { evolve: { from: "eevee", affinity: 500, when: "night" } });
  assert.deepStrictEqual(table.charizard, { evolve: { from: "charmeleon", affinity: 1500 } });
  assert.deepStrictEqual(table.snorlax, { evolve: { from: "munchlax", affinity: 500 } }, "잠만보는 먹고자 진화로 해금 (2026-09-29 사용자 결정)");
  assert.strictEqual(table.ditto, undefined, "메타몽은 업적 보상 — 규칙표에 없다 (2026-09-29 사용자 결정)");
  assert.strictEqual(table.lapras, undefined, "라프라스는 업적 보상 — 규칙표에 없다");
  assert.deepStrictEqual(table.chansey, { evolve: { from: "happiny", affinity: 500, when: "day" } }, "럭키는 핑복 진화(낮)로 해금 (2026-09-29 사용자 결정)");
  assert.strictEqual(table.mewtwo, undefined, "전설·환상은 기본형 규칙을 받지 않는다 — 해금 길 없는 종은 표에 없다");
  assert.deepStrictEqual(table.cleffa, { base: true }, "아기 포켓몬도 진화 전 첫 단계라 기본형"); // 피츄는 2026-09-27 스타터가 됐다
  assert.deepStrictEqual(table.rattata, { base: true }, "기본형은 처음부터 해금 (2026-09-25 사용자 결정)");
  // 표의 모든 규칙이 아는 조건만 쓰고, evolve 의 from·to 가 evo.json 과 맞는다
  const known = ["starter", "base", "evolve", "bond", "time", "event"];
  for (const [slug, rule] of Object.entries(table)) {
    for (const k of Object.keys(rule)) assert.ok(known.includes(k), `${slug} 모르는 조건 ${k}`);
    if (rule.evolve) {
      assert.ok(dex.nextOf(rule.evolve.from).some((s) => s.to === slug), `${slug} ← ${rule.evolve.from} 가 evo.json 에`);
      assert.ok([500, 1500].includes(rule.evolve.affinity), `${slug} affinity`);
      assert.ok(dex.hasProfile(slug) && dex.hasProfile(rule.evolve.from), `${slug} 프로필`);
    }
  }
  // 첫 실행 세상 — 스타터·기본형은 해금, 진화·조건 종은 아직
  const fresh = dex.evaluate(table, world());
  assert.ok(fresh.includes("bulbasaur") && fresh.includes("munchlax") && fresh.includes("rattata"), "첫 실행에 스타터·기본형 종");
  assert.ok(!fresh.includes("snorlax") && !fresh.includes("umbreon") && !fresh.includes("ditto") && !fresh.includes("lapras") && !fresh.includes("chansey"));
  const baseCount = Object.values(table).filter((r) => r.base).length;
  assert.strictEqual(fresh.length, 29 + baseCount, "스타터 29 + 기본형");
  // 이브이 500 · 밤 — 진화 규칙이 살아난다
  const night = dex.evaluate(table, world({ now: NIGHT }, { party: [pet("eevee", 500)], unlocked: fresh }));
  assert.ok(night.includes("umbreon") && night.includes("vaporeon") && !night.includes("espeon"), "밤에는 블래키, 에브이는 아니다");
  out("evaluate ok");
}

out("통과");
