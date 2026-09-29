// 도감 모듈 자체 확인 — npm run build 뒤 node dist/tools/selftest-dex.js (npm run selftest 가 넷을 차례로 돈다)
//
// 테스트 프레임워크 없이 assert 만. data/*.json 을 읽기만 하고 저장·네트워크는 없다
// 확인: 25 성격 · 축 합 · 중립 5 · 프로필 합치기(override · 기본값 · -3d) · 진화 사슬 · 해금 조건 종류마다 참/거짓 · evaluate
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import path from "node:path";
import * as data from "../dex/data";
import * as evo from "../dex/evo";
import * as natures from "../dex/natures";
import * as species from "../dex/species";
import * as unlocks from "../dex/unlocks";
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
  assert.deepStrictEqual(unknown, { slug: "not-a-mon", dex: 0, growthRate: "medium-fast", bst: 0, stage: 1, rank: 1, sleepiness: 1, moodBase: 60, moodSwing: 1, likes: ["play"], types: [] }, "모르는 슬러그는 기본 프로필");
  assert.strictEqual(dex.hasProfile("pikachu"), true);
  assert.strictEqual(dex.hasProfile("pikachu-3d"), true);
  assert.strictEqual(dex.hasProfile("not-a-mon"), false);
  assert.strictEqual(dex.hasProfile("_comment"), false, "메모 키는 종이 아니다");
  assert.strictEqual(dex.profile("_comment").likes[0], "play");
  // 돌려받은 배열을 고쳐도 표는 그대로
  pika.likes.push("food");
  assert.deepStrictEqual(dex.profile("pikachu").likes, ["work", "play"]);
  assert.strictEqual(dex.slugs().length, 1110, "표의 종 수 — PokeAPI 종 1025 + 폼 85");
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
