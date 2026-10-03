// 메가진화 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-mega.js
//
// 테스트 프레임워크 없이 assert 만. 모습 표는 data/mega.json 의 실제 값을 쓴다.
// 계약은 docs/specs/game.md "메가진화"이다. 규칙은 src/dex/mega.ts
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { hasProfile } from "../../dex/species";
import { countCare, grantStones, megaFormsOf, megaFree, megaOf, megaSlugs, shownSpecies, tickMega } from "../../dex/mega";
import { pmdSources } from "../../main/art";
import { overworldUrl } from "../../main/overworld-art";
import { portraitIds } from "../../main/portraits";
import { petName } from "../../main/text";
import { bannerOf } from "../../notify/banner";
import { refresh } from "../../notify/queue";
import { keep, place } from "../../party/placement";
import { empty, normalize } from "../../save/v3";
import { applyTimeAndSettle as applyTime } from "../../tx/tick"; // 시간 적용 + 후처리 사슬 — 옛 applyTime 과 같은 동작
import { createExecutor } from "../../tx/executor";
import { dexDetail } from "../../tx/dex-detail";
import { dexList } from "../../tx/lists";
import { snapshot } from "../../tx/snapshot";
import { verifySave, type VerifyData } from "../../verify/save-rules";
import type { PetV3, SaveV3 } from "../../shared/save-v3";
import { appearanceOf } from "../../dex/look";
import { MEGA_RULES } from "../../dex/rules";
import { pendingOf } from "../../notify/pending";
import { megaRivals, setMega, settleMega } from "../../party/mega-form";
import { HANDLERS } from "../../tx/command-table";

const T0 = new Date(2026, 9, 2, 10, 0, 0).getTime();

const pet = (over: Partial<PetV3> = {}): PetV3 => ({
  id: "p1", species: "charizard", shiny: false, nature: "hardy", gender: "male", size: 2,
  level: 60, exp: 0, affinity: 100, affinityProgressMs: 0, fullness: 100, fullnessProgressMs: 0,
  mood: 60, moodProgressMs: 0, feedCooldownMs: 0, playCooldownMs: 0, playWindowMs: 0, playStreak: 0, buffs: [], home: { dx: -24, dy: -60 }, since: T0, stage: 2, evolved: ["charmander", "charmeleon"],
  daily: { date: "2026-10-02", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  ...over,
});

// 파티 칸에 차례로 넣는다. 칸이 모자라면 박스로 간다
function seed(...pets: PetV3[]): SaveV3 {
  const s = empty(T0);
  for (const slot of s.party.slots) if (slot.state === "locked") slot.state = "empty";
  pets.forEach((p, i) => {
    s.pets.push(p);
    const slot = s.party.slots[i];
    if (slot) s.party.slots[i] = { state: "pokemon", petId: p.id, hidden: false };
    else s.boxes[0]!.slots[i - s.party.slots.length] = p.id;
  });
  return s;
}

const full = { bondMs: MEGA_RULES.bondMs, care: MEGA_RULES.care };

// (1) 모습 표 — 60개, 기본 종 58종. 기본 종은 모두 게임에 있는 종이다
{
  const slugs = megaSlugs();
  assert.equal(slugs.length, 60);
  assert.equal(new Set(slugs.map((s) => megaOf(s)?.base)).size, 58);
  for (const slug of slugs) {
    const f = megaOf(slug)!;
    assert.ok(hasProfile(f.base), `${slug} 의 기본 종 ${f.base}`);
    assert.ok(!hasProfile(slug), `${slug} 는 도감 종이 아니다`);
    assert.ok(f.pmd || f.overworld, `${slug} 의 무대 그림`);
    assert.ok(f.types.length >= 1 && f.ko && f.en && f.pokemonId > 10000, `${slug} 의 값`);
  }
  assert.deepStrictEqual(megaFormsOf("charizard"), ["charizard-mega-x", "charizard-mega-y"]);
  assert.deepStrictEqual(megaFormsOf("mewtwo"), ["mewtwo-mega-x", "mewtwo-mega-y"]);
  assert.deepStrictEqual(megaFormsOf("tatsugiri"), ["tatsugiri-curly-mega"], "싸리용은 하나로 합쳤다");
  // 메가플라엣테는 플라엣테(영원의 꽃)만 (2026-10-03 사용자 결정 "영꽃전용으로.")
  assert.deepStrictEqual(megaFormsOf("floette-eternal"), ["floette-mega"]);
  assert.deepStrictEqual(megaFormsOf("floette"), [], "일반 플라엣테는 메가진화하지 않는다");
  assert.deepStrictEqual(megaFormsOf("pikachu"), []);
  assert.equal(megaOf("groudon-primal")?.kind, "primal");
  process.stdout.write("(1) 모습 표 60개 · 기본 종 58종  ok\n");
}

// (2) 이름과 그림 — 메가 모습은 표의 이름, PMD 폼 폴더, expansion 폼 폴더, PokeAPI 폼 번호
{
  assert.equal(petName("charizard-mega-x", "ko"), "메가리자몽X");
  assert.equal(petName("groudon-primal", "ko"), "원시그란돈");
  assert.equal(petName("charizard", "ko"), "리자몽");
  assert.deepStrictEqual(pmdSources("charizard-mega-x").map((s) => s.spritePath), ["0006/0001"]);
  assert.deepStrictEqual(pmdSources("charizard-mega-x:shiny").map((s) => s.spritePath), ["0006/0001/0001", "0006/0001"], "이로치 폴더가 없으면 폼의 보통 색");
  assert.deepStrictEqual(pmdSources("charizard-mega-y"), [], "PMD 가 없는 모습은 걷기 그림으로 넘어간다");
  assert.ok(overworldUrl("charizard-mega-y", "overworld.png").endsWith("/graphics/pokemon/charizard/mega_y/overworld.png"));
  assert.ok(overworldUrl("mr-rime", "overworld.png").endsWith("/graphics/pokemon/mr_rime/overworld.png"), "다른 종은 그대로");
  assert.deepStrictEqual(portraitIds("charizard-mega-x"), [10034, 6]);
  assert.deepStrictEqual(portraitIds("zygarde-mega"), [10301, 718], "초상이 없으면 기본 종 초상");
  assert.equal(appearanceOf(pet({ mega: { ...full, stone: true, on: "charizard-mega-x" }, shiny: true })), "charizard-mega-x:shiny");
  assert.equal(appearanceOf(pet()), "charizard");
  // 성별 그림 — 대쓰여너 암컷은 암컷 그림이다. 종·이름은 그대로다 (data/regional.json 의 gender)
  assert.equal(appearanceOf(pet({ species: "basculegion", gender: "female" })), "basculegion-female");
  assert.equal(appearanceOf(pet({ species: "basculegion", gender: "female", shiny: true })), "basculegion-female:shiny");
  assert.equal(appearanceOf(pet({ species: "basculegion", gender: "male" })), "basculegion");
  assert.deepStrictEqual(pmdSources("basculegion-female").map((s) => s.spritePath), ["0902/0000/0000/0002", undefined], "암컷 폴더 → 종의 기본 그림");
  assert.deepStrictEqual(pmdSources("basculegion-female:shiny").map((s) => s.spritePath), ["0902/0000/0001/0002", "0902/0000/0000/0002", "0902/0000/0001"]);
  assert.deepStrictEqual(portraitIds("basculegion-female"), [10248, 902]);
  {
    const g = empty(T0);
    g.pets.push(pet({ id: "g1", species: "basculegion", gender: "female", evolved: ["basculin-white-striped"] }), pet({ id: "g2", species: "basculegion", gender: "male", evolved: ["basculin-white-striped"] }));
    g.boxes[0]!.slots[0] = "g1";
    g.boxes[0]!.slots[1] = "g2";
    const [f, m] = snapshot(g, T0).boxes[0]!.slots;
    assert.deepStrictEqual([f?.look, f?.name, f?.species], ["basculegion-female", "대쓰여너", "basculegion"], "초상만 암컷 그림");
    assert.deepStrictEqual([m?.look, m?.name], ["basculegion", "대쓰여너"]);
  }
  process.stdout.write("(2) 이름 · 무대 그림 · 초상 · 성별 그림  ok\n");
}

// (3) 조건 — 친밀도 100 뒤의 시간과 돌봄 횟수를 센다. 메가 모습이 없는 종과 친밀도 100 미만은 세지 않는다
{
  const a = pet();
  tickMega(a, 60_000);
  countCare(a);
  assert.deepStrictEqual(a.mega, { bondMs: 60_000, care: 1 });
  const low = pet({ affinity: 99 });
  tickMega(low, 60_000);
  countCare(low);
  assert.equal(low.mega, undefined, "친밀도 100 미만은 세지 않는다");
  const plain = pet({ species: "pikachu" });
  tickMega(plain, 60_000);
  countCare(plain);
  assert.equal(plain.mega, undefined, "메가 모습이 없는 종은 세지 않는다");
  tickMega(a, MEGA_RULES.bondMs * 2);
  assert.equal(a.mega?.bondMs, MEGA_RULES.bondMs, "조건 값에서 멈춘다");
  process.stdout.write("(3) 시간 · 돌봄 횟수 적립  ok\n");
}

// (4) 메가스톤 — 네 조건을 모두 채워야 생긴다. 종을 도감 기록에 적는다
{
  for (const [over, why] of [
    [{ level: 59 }, "레벨 59"],
    [{ affinity: 99 }, "친밀도 99"],
    [{ mega: { bondMs: MEGA_RULES.bondMs - 1, care: MEGA_RULES.care } }, "시간 부족"],
    [{ mega: { bondMs: MEGA_RULES.bondMs, care: MEGA_RULES.care - 1 } }, "횟수 부족"],
  ] as [Partial<PetV3>, string][]) {
    const s = seed(pet({ mega: { ...full }, ...over }));
    assert.deepStrictEqual(grantStones(s), [], why);
    assert.equal(s.pets[0]?.mega?.stone, undefined, why);
  }
  const s = seed(pet({ mega: { ...full } }), pet({ id: "p2", species: "pikachu" }));
  assert.deepStrictEqual(grantStones(s), ["p1"]);
  assert.equal(s.pets[0]?.mega?.stone, true);
  assert.deepStrictEqual(s.dex.megaOpened, ["charizard"]);
  assert.deepStrictEqual(grantStones(s), [], "두 번 주지 않는다");
  process.stdout.write("(4) 메가스톤 지급과 도감 기록  ok\n");
}

// (5) 시간 적용 — 파티 칸의 개체만 시간이 흐른다. 조건을 채운 틱에 메가스톤이 생긴다
{
  const s = seed(pet({ mega: { bondMs: MEGA_RULES.bondMs - 10_000, care: MEGA_RULES.care } }));
  s.pets.push(pet({ id: "box", mega: { bondMs: 0, care: 0 } }));
  s.boxes[0]!.slots[0] = "box";
  applyTime(s, 5_000, T0 + 5_000);
  assert.equal(s.pets[0]?.mega?.stone, undefined);
  assert.equal(s.pets[1]?.mega?.bondMs, 0, "박스에서는 흐르지 않는다");
  applyTime(s, 5_000, T0 + 10_000);
  assert.equal(s.pets[0]?.mega?.stone, true);
  process.stdout.write("(5) 시간 적용과 지급  ok\n");
}

// (6) 켜고 끄기 — 메가스톤이 있어야 하고, 한 프리셋에 한 마리다
{
  const s = seed(pet({ mega: { ...full, stone: true } }), pet({ id: "p2", species: "gengar", evolved: [], mega: { ...full, stone: true } }), pet({ id: "p3", species: "lucario", evolved: [] }));
  assert.equal(setMega(s, "p3", "lucario-mega").reason, "no-stone");
  assert.equal(setMega(s, "p1", "gengar-mega").reason, "bad-form", "다른 종의 모습");
  assert.equal(setMega(s, "p1", null).reason, "already");
  assert.deepStrictEqual(setMega(s, "p1", "charizard-mega-x"), { ok: true, petId: "p1", on: "charizard-mega-x", reverted: [] });
  assert.equal(shownSpecies(s.pets[0]!), "charizard-mega-x");
  assert.equal(s.pets[0]?.species, "charizard", "종은 그대로다");
  assert.equal(setMega(s, "p1", "charizard-mega-x").reason, "already");
  assert.deepStrictEqual(setMega(s, "p1", "charizard-mega-y").on, "charizard-mega-y", "X 에서 Y 로 바로");
  const res = setMega(s, "p2", "gengar-mega");
  assert.deepStrictEqual(res.reverted, ["p1"], "먼저 켠 개체가 기본 모습으로 돌아간다");
  assert.equal(s.pets[0]?.mega?.on, undefined);
  assert.equal(s.pets[0]?.mega?.stone, true, "메가스톤은 남는다");
  assert.deepStrictEqual(setMega(s, "p2", null), { ok: true, petId: "p2", on: null, reverted: [] });
  process.stdout.write("(6) 켜기 · 끄기 · 프리셋당 한 마리  ok\n");
}

// (6b) 원시회귀와 메가레쿠쟈는 한 마리 제한에서 빠진다 — 다른 개체를 풀지 않고, 다른 개체 때문에 풀리지도 않는다
{
  assert.deepStrictEqual(megaSlugs().filter((s) => megaFree(s)), ["kyogre-primal", "groudon-primal", "rayquaza-mega"]);
  const stone = { ...full, stone: true as const };
  const s = seed(pet({ mega: { ...stone } }), pet({ id: "p2", species: "groudon", evolved: [], mega: { ...stone } }), pet({ id: "p3", species: "rayquaza", evolved: [], mega: { ...stone } }), pet({ id: "p4", species: "gengar", evolved: [], mega: { ...stone } }));
  setMega(s, "p1", "charizard-mega-x");
  assert.deepStrictEqual(setMega(s, "p2", "groudon-primal").reverted, [], "원시회귀는 메가리자몽X 를 풀지 않는다");
  assert.deepStrictEqual(setMega(s, "p3", "rayquaza-mega").reverted, [], "메가레쿠쟈도 풀지 않는다");
  assert.deepStrictEqual(s.pets.map((p) => p.mega?.on ?? null), ["charizard-mega-x", "groudon-primal", "rayquaza-mega", null]);
  assert.deepStrictEqual(megaRivals(s, "p2"), [], "원시회귀의 확인 창에는 풀리는 개체가 없다");
  assert.deepStrictEqual(megaRivals(s, "p4").map((p) => p.id), ["p1"], "팬텀이 메가진화하면 리자몽만 풀린다");
  assert.deepStrictEqual(setMega(s, "p4", "gengar-mega").reverted, ["p1"]);
  assert.deepStrictEqual(s.pets.map((p) => p.mega?.on ?? null), [null, "groudon-primal", "rayquaza-mega", "gengar-mega"], "원시회귀와 메가레쿠쟈는 그대로다");
  assert.deepStrictEqual(settleMega(s), []);
  process.stdout.write("(6b) 원시회귀 · 메가레쿠쟈는 제한 밖  ok\n");
}

// (7) 박스 개체는 켜지 못한다. 프리셋을 떠나면 풀린다. 종이 바뀌어도 풀린다
{
  const s = seed(pet({ mega: { ...full, stone: true } }));
  s.pets.push(pet({ id: "box", species: "gengar", evolved: [], mega: { ...full, stone: true } }));
  s.boxes[0]!.slots[0] = "box";
  assert.equal(setMega(s, "box", "gengar-mega").reason, "not-in-party");
  setMega(s, "p1", "charizard-mega-x");
  assert.deepStrictEqual(settleMega(s), [], "제자리면 그대로");
  assert.ok(keep(s, "p1").ok);
  assert.deepStrictEqual(settleMega(s), ["p1"]);
  assert.equal(s.pets[0]?.mega?.on, undefined);
  assert.ok(place(s, "p1").ok);
  setMega(s, "p1", "charizard-mega-x");
  s.pets[0]!.species = "pikachu";
  assert.deepStrictEqual(settleMega(s), ["p1"], "종이 바뀌면 풀린다");
  process.stdout.write("(7) 박스 · 프리셋 이탈 · 종 변경  ok\n");
}

// (8) 명령 — pet.form 이 메가 모습을 켜고 끈다. 박스에 보관하면 같은 거래에서 풀린다. 돌봄이 횟수를 센다
{
  let save: SaveV3 = seed(pet({ mega: { bondMs: MEGA_RULES.bondMs, care: MEGA_RULES.care - 2 } }));
  let n = 0;
  const ex = createExecutor({ read: () => save, write: (next) => ((save = next), true), now: () => T0 }, HANDLERS);
  const run = (name: string, args: unknown) => ex.run({ id: `t${(n += 1)}`, name, args });
  assert.equal(run("pet.form", { petId: "p1", species: "charizard-mega-x" }).ok, false, "메가스톤이 없으면 거절");
  save.pets[0]!.fullness = 50;
  assert.ok(run("feed", { petId: "p1" }).ok);
  assert.equal(save.pets[0]?.mega?.care, MEGA_RULES.care - 1);
  assert.equal(save.pets[0]?.mega?.stone, undefined);
  assert.ok(run("play", { petId: "p1" }).ok);
  assert.equal(save.pets[0]?.mega?.stone, true, "횟수를 채운 거래에서 메가스톤이 생긴다");
  assert.deepStrictEqual(save.dex.megaOpened, ["charizard"]);
  const on = run("pet.form", { petId: "p1", species: "charizard-mega-x" });
  assert.ok(on.ok);
  assert.equal(save.pets[0]?.mega?.on, "charizard-mega-x");
  assert.ok(run("party.keep", { petId: "p1" }).ok);
  assert.equal(save.pets[0]?.mega?.on, undefined, "박스로 가면 기본 모습");
  assert.ok(run("party.place", { petId: "p1" }).ok);
  assert.ok(run("pet.form", { petId: "p1", species: "charizard-mega-y" }).ok);
  assert.ok(run("pet.form", { petId: "p1", species: "charizard" }).ok, "지금 종을 주면 기본 모습으로");
  assert.equal(save.pets[0]?.mega?.on, undefined);
  process.stdout.write("(8) 명령 — pet.form · 돌봄 횟수 · 박스 보관  ok\n");
}

// (9) 화면 모델 — 메가 모습의 이름·타입·그림, 메가진화 정보, 도감 표식
{
  const s = seed(pet({ mega: { ...full, stone: true, on: "charizard-mega-x" } }), pet({ id: "p2", species: "gengar", evolved: [], mega: { ...full, stone: true } }), pet({ id: "p3", species: "pikachu", evolved: [] }));
  s.dex.megaOpened = ["charizard", "gengar"];
  s.dex.obtained = ["charizard", "gengar", "pikachu"];
  const v = snapshot(s, undefined, undefined, undefined, T0);
  const [a, b, c] = v.party.slots.map((x) => x.pet);
  assert.equal(a?.species, "charizard");
  assert.equal(a?.look, "charizard-mega-x");
  assert.equal(a?.name, "메가리자몽X");
  assert.deepStrictEqual(a?.typeIds, ["fire", "dragon"]);
  assert.deepStrictEqual(a?.mega?.forms.map((f) => f.name), ["메가리자몽X", "메가리자몽Y"]);
  assert.equal(a?.mega?.on, "charizard-mega-x");
  assert.equal(a?.mega?.baseName, "리자몽");
  assert.deepStrictEqual(a?.mega?.rivals, []);
  assert.equal(b?.look, "gengar");
  assert.equal(b?.mega?.on, null);
  assert.deepStrictEqual(b?.mega?.rivals, ["메가리자몽X"], "팬텀이 메가진화하면 리자몽이 돌아간다");
  assert.equal(b?.mega?.canChange, true);
  assert.equal(c?.mega, undefined);
  assert.equal(c?.look, "pikachu");
  const dex = dexList(s);
  assert.equal(dex.find((d) => d.slug === "charizard")?.mega, true);
  assert.equal(dex.find((d) => d.slug === "pikachu")?.mega, undefined);
  assert.equal(dex.some((d) => megaOf(d.slug) !== null), false, "메가 모습은 도감 항목이 아니다");
  // 도감 상세 — 얻은 종에만 메가진화 줄. 메가스톤이 없어도 보인다. 해금만 한 종과 메가진화하지 않는 종에는 없다
  s.dex.obtained = ["charizard", "pikachu", "groudon"];
  s.dex.unlocked = ["gengar"];
  assert.deepStrictEqual(dexDetail(s, "charizard")?.mega, { label: "메가진화", names: "메가리자몽X · 메가리자몽Y" });
  assert.deepStrictEqual(dexDetail(s, "groudon")?.mega, { label: "원시회귀", names: "원시그란돈" });
  assert.equal(dexDetail(s, "gengar")?.mega, undefined, "해금만 한 종");
  assert.equal(dexDetail(s, "pikachu")?.mega, undefined, "메가진화하지 않는 종");
  assert.equal(dexDetail(s, "mewtwo")?.mega, undefined, "미해금 종");
  process.stdout.write("(9) 화면 모델과 도감 표식 · 도감 상세의 메가진화 줄  ok\n");
}

// (10) 배너 — 메가스톤이 생기면 한 번. 레쿠쟈와 원시회귀는 제목이 다르다
{
  const s = seed(pet({ mega: { ...full } }), pet({ id: "p2", species: "rayquaza", evolved: [], mega: { ...full } }), pet({ id: "p3", species: "groudon", evolved: [], mega: { ...full } }));
  let state = refresh(null, s, T0);
  assert.deepStrictEqual(state.queue, []);
  grantStones(s);
  assert.deepStrictEqual(pendingOf(s, T0).filter((p) => p.kind === "mega").map((p) => p.key), ["mega:p1", "mega:p2", "mega:p3"]);
  state = refresh(state, s, T0 + 1);
  assert.deepStrictEqual(state.queue.map((q) => q.key), ["mega:p1", "mega:p2", "mega:p3"]);
  const banner = bannerOf(s, "mega:p1");
  assert.equal(banner?.title, "메가스톤 획득");
  assert.equal(banner?.target, "리자몽 Lv.60");
  assert.deepStrictEqual(banner?.route, { to: "pet", petId: "p1" });
  assert.equal(bannerOf(s, "mega:p2")?.title, "메가진화 가능");
  assert.equal(bannerOf(s, "mega:p3")?.title, "원시회귀 가능");
  process.stdout.write("(10) 메가스톤 배너  ok\n");
}

// (11) 저장 — 메가 칸을 읽고 쓴다. 옛 저장은 칸 없이 그대로다
{
  const s = seed(pet({ mega: { ...full, stone: true, on: "charizard-mega-x" } }), pet({ id: "p2", species: "pikachu", evolved: [] }));
  s.dex.megaOpened = ["charizard"];
  const back = normalize(JSON.parse(JSON.stringify(s)), T0);
  assert.deepStrictEqual(back?.pets[0]?.mega, { ...full, stone: true, on: "charizard-mega-x" });
  assert.equal(back?.pets[1]?.mega, undefined);
  assert.deepStrictEqual(back?.dex.megaOpened, ["charizard"]);
  const old = normalize(JSON.parse(JSON.stringify(seed(pet()))), T0);
  assert.equal(old?.pets[0]?.mega, undefined);
  assert.equal("megaOpened" in (old?.dex ?? {}), false);
  process.stdout.write("(11) 저장 읽기 · 쓰기  ok\n");
}

// (12) 서버 검증 — 메가스톤은 친밀도 100·Lv.60 인 개체만, 메가 모습은 메가스톤이 있고 그 종의 모습일 때만
{
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "supabase/functions/_shared/verify-data.json"), "utf8")) as VerifyData;
  assert.deepStrictEqual(data.megaForms?.charizard, ["charizard-mega-x", "charizard-mega-y"]);
  assert.equal(data.rules.megaLevel, MEGA_RULES.level);
  const megaRule = (p: PetV3): number => {
    const prev = seed(pet({ level: p.level, exp: p.exp, affinity: p.affinity, species: p.species }));
    const next = seed(p);
    return verifySave(prev, next, { gapMs: 60_000, margin: 1.1, letters: {}, received: [], receivedBefore: {}, seed: null }, data).filter((v) => v.rule === "mega").length;
  };
  assert.equal(megaRule(pet({ mega: { ...full, stone: true, on: "charizard-mega-x" } })), 0, "조건을 채운 개체");
  assert.equal(megaRule(pet({ mega: { ...full } })), 0, "진행 중인 개체");
  assert.equal(megaRule(pet({ level: 59, mega: { ...full, stone: true } })), 1, "레벨 59 에 메가스톤");
  assert.equal(megaRule(pet({ affinity: 99, mega: { ...full, stone: true } })), 1, "친밀도 99 에 메가스톤");
  assert.equal(megaRule(pet({ mega: { ...full, on: "charizard-mega-x" } })), 1, "메가스톤 없이 메가 모습");
  assert.equal(megaRule(pet({ mega: { ...full, stone: true, on: "gengar-mega" } })), 1, "다른 종의 모습");
  process.stdout.write("(12) 서버 검증 mega 규칙  ok\n");
}

process.stdout.write("통과\n");
