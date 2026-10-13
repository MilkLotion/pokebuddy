// 상속 이름과 정규화 — constructor·toString·__proto__ 같은 이름을 표의 키로 보지 않고, 받은 종 이름은 정규화해 받는다
// (worklog/records/perf-refactor 5-1·5-2·5-3)
//
//   node dist/tools/selftest/selftest-proto-keys.js
//
// 보는 곳: 종 표(hasProfile·profileOf), 도구 가격(toolPrice), 명령 표(hasCommandFlag), 교환 받기(validateReceived), 편지 선물(parseGifts),
// 서버 검증(verifySave — 편지 id 가 상속 이름이어도 던지지 않고 위반으로 끝난다)
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { hasProfile, profileOf } from "../../dex/species";
import { toolPrice } from "../../shop/catalog";
import { hasCommandFlag } from "../../shared/names/commands";
import { validateReceived } from "../../trade/exchange";
import { parseGifts } from "../../mail/gifts";
import { emptySave } from "../../save/normalize";
import { newPet } from "../../party/create";
import { verifySave, type VerifyContext, type VerifyData } from "../../verify/save-rules";
import { okCounter, printLine } from "../harness/report";

const INHERITED = ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"];
const ROOT = path.resolve(__dirname, "..", "..", "..");
const T0 = new Date(2026, 8, 30, 10, 0, 0).getTime();
const t = okCounter();

// 교환으로 받는 값 — 규칙 안의 이브이
const eevee = { species: "eevee", evolved: [], level: 10, exp: 1000, nature: "hardy", shiny: false, size: 2, affinity: 10, fullness: 50, stage: 0, gender: "male" };

t.ok("종 표 — 상속 이름은 종이 아니다", () => {
  for (const k of INHERITED) {
    assert.equal(hasProfile(k), false, k);
    assert.equal(profileOf(k).dex, 0, `${k} 의 도감 번호`);
  }
  assert.equal(hasProfile("pikachu"), true);
});

t.ok("도구 가격 — 상속 이름은 null", () => {
  for (const k of INHERITED) assert.equal(toolPrice(k), null, k);
});

t.ok("명령 표 — 상속 이름은 명령이 아니다", () => {
  for (const k of INHERITED) assert.equal(hasCommandFlag(k, "cli"), false, k);
});

t.ok("교환 받기 — 상속 이름 종은 거절한다", () => {
  for (const k of INHERITED) {
    assert.equal(validateReceived({ ...eevee, species: k }).ok, false, `종 ${k}`);
    assert.equal(validateReceived({ ...eevee, evolved: [k] }).ok, false, `거쳐 온 종 ${k}`);
  }
});

t.ok("교환 받기 — 종 이름을 정규화해 받고, 대문자·-3d 로 단일 포켓몬 검사를 피하지 못한다", () => {
  const r = validateReceived({ ...eevee, species: "Eevee" });
  assert.ok(r.ok && r.pet.species === "eevee", "대문자는 정규화한다");
  const r3d = validateReceived({ ...eevee, species: "eevee-3d", evolved: [" EEVEE "] });
  assert.ok(r3d.ok && r3d.pet.species === "eevee" && r3d.pet.evolved[0] === "eevee", "-3d·공백도 정규화한다");
  for (const s of ["mewtwo", "Mewtwo", "mewtwo-3d"]) assert.deepStrictEqual(validateReceived({ ...eevee, species: s, level: 70 }), { ok: false, reason: "single" }, s);
});

t.ok("편지 선물 — 상속 이름 종은 편지째 거절하고, 종 이름은 정규화해 받는다", () => {
  for (const k of INHERITED) assert.equal(parseGifts([{ kind: "pokemon", species: k, count: 1 }]), null, k);
  const got = parseGifts([{ kind: "pokemon", species: "Pikachu-3d", count: 1 }]);
  assert.ok(got && got[0]?.kind === "pokemon" && got[0].species === "pikachu");
});

t.ok("서버 검증 — 편지 id 가 상속 이름이어도 던지지 않고 위반으로 끝난다(예전에는 TypeError 로 500)", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "supabase/functions/_shared/verify-data.json"), "utf8")) as VerifyData;
  const ctx: VerifyContext = { gapMs: 60_000, margin: 1.1, letters: {}, received: [], receivedBefore: {}, seed: null };
  const prev = emptySave(T0);
  prev.pets.push(newPet({ id: "p1", species: "bulbasaur", shiny: false, nature: "hardy", gender: "male", now: T0 }));
  for (const k of INHERITED) {
    const next = structuredClone(prev);
    next.mail = { applied: [k], read: [] };
    const out = verifySave(prev, next, ctx, data);
    assert.ok(out.some((v) => v.rule === "mail"), `${k} 는 받지 않은 편지로 위반`);
  }
});

printLine(`selftest-proto-keys: 통과 (${t.count()}건)`);
