// 랜덤 배틀 샘플 파티 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-battle-samples.js
//
// 계약은 docs/specs/adventure.md "샘플 파티". 난이도 승률은 재지 않는다(시간이 걸린다) — node dist/tools/battle/sample-rate.js
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { battleData, buildFighter } from "../../battle/fighter";
import { battleSamples, SAMPLE_LEVELS, SAMPLES_PER_LEVEL, sampleProblems, samplesForServer } from "../../battle/samples";
import { buildBattleFiles } from "../data/build-battle";

const data = battleData();
const samples = battleSamples();

// ── 난이도마다 10개, id 는 겹치지 않는다 ──
for (const level of SAMPLE_LEVELS) assert.strictEqual(samples.filter((s) => s.level === level).length, SAMPLES_PER_LEVEL, `${level} 샘플 수`);
assert.strictEqual(new Set(samples.map((s) => s.id)).size, samples.length, "샘플 id 가 겹친다");

// ── 챔피언 등급과 champion 유형은 함께 간다 ──
for (const s of samples) assert.strictEqual(s.level === "champion", s.kind === "champion", `${s.id} 챔피언 등급·유형`);

// ── 샘플마다 6칸·같은 도감 번호 없음·전투 중 모습 없음·모든 종과 메가 모습이 전투 데이터에 있음·기술 없음·출전 불가 없음 ──
for (const s of samples) {
  assert.deepStrictEqual(sampleProblems(s, data), [], `${s.id}`);
  for (const c of s.slots) assert.ok(buildFighter(c), `${s.id} ${c.species} 전투 개체`);
}

// ── 하 난이도에는 전설급·메가가 없고, 중 난이도에는 메가·초전설이 없다 ──
for (const s of samples) {
  const tiers = s.slots.map((c) => data.species[c.species]?.tier ?? null);
  if (s.level === "easy") assert.ok(tiers.every((t) => t === null) && s.slots.every((c) => !c.form), `${s.id} 하 난이도에 전설급·메가`);
  if (s.level === "normal") assert.ok(!tiers.includes("legendary") && tiers.filter(Boolean).length <= 1 && s.slots.every((c) => !c.form), `${s.id} 중 난이도 구성`);
}

// ── 서버 복사본에 실을 모양 — 칸은 종과 메가 모습만 ──
const server = samplesForServer(samples);
assert.strictEqual(server.length, samples.length);
for (const s of server) for (const c of s.slots) assert.deepStrictEqual(Object.keys(c).filter((k) => k !== "species" && k !== "form"), [], `${s.id} 칸 모양`);
const built = JSON.parse(buildBattleFiles()["battle-data.json"]!) as { samples?: unknown };
assert.deepStrictEqual(built.samples, server, "battle-data.json 의 samples 가 데이터 파일과 같다");

process.stdout.write(`배틀 샘플 파티 자체 확인 통과 (${samples.length}개)\n`);
