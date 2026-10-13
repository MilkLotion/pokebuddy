// 자료 메모 — 메모한 값이 메모 전의 계산과 같은지 (실행 규칙 R6, worklog/records/perf-refactor 1-7)
//
//   node dist/tools/selftest/selftest-memo.js
//
// 메모 전의 계산은 이 파일에 그대로 옮겨 두고 견준다(참값). 자료의 모든 종과 모든 묶음을 돈다.
// 메모는 자료 폴더(dataDir)마다 한 번 만든다 — 다른 자료 폴더는 다른 값을 준다
import assert from "node:assert";
import { isMetaKey, loadJson, normalizeSlug, type DexOptions } from "../../dex/data";
import { fixedEggs, isSingleEgg, rewardSpecies, singleSpecies } from "../../dex/obtain";
import { allRiders, regionalTable, shiftGroupOf } from "../../dex/regional";
import { okCounter, printLine } from "../harness/report";

// 메모 전의 shiftGroupOf — 표를 앞에서부터 훑는다
function shiftGroupRef(slug: string, opts?: DexOptions): string[] {
  const key = normalizeSlug(slug);
  for (const [base, list] of Object.entries(regionalTable(opts).shift)) {
    if (isMetaKey(base) || !Array.isArray(list)) continue;
    if (base === key || list.includes(key)) return [base, ...list.filter((s) => typeof s === "string")];
  }
  return [];
}

// 메모 전의 singleSpecies
function singleRef(opts?: DexOptions): Set<string> {
  const out = new Set<string>();
  for (const [kind, pool] of fixedEggs(opts)) if (isSingleEgg(kind, opts)) for (const slug of pool) out.add(slug);
  for (const [slug, form] of Object.entries(regionalTable(opts).forms)) if (!isMetaKey(slug) && form.get === "gift") out.add(slug);
  for (const slug of rewardSpecies(opts)) out.add(slug);
  for (const slug of allRiders(opts)) out.add(slug);
  for (const slug of [...out]) for (const form of shiftGroupRef(slug, opts)) out.add(form);
  return out;
}

const t = okCounter();

// 자료의 모든 이름 — 해금 표의 종, 지방 모습, 모습 묶음의 이름, 없는 이름과 대문자
const table = regionalTable();
const names = new Set<string>([
  ...Object.keys(loadJson<Record<string, unknown>>("unlocks.json")).filter((k) => !isMetaKey(k)),
  ...Object.keys(table.forms),
  ...Object.entries(table.shift).flatMap(([base, list]) => [base, ...(Array.isArray(list) ? list : [])]),
  "no-such-species",
  "GIRATINA-Origin",
  " rotom-wash ",
]);

t.ok(`shiftGroupOf — ${names.size}개 이름에서 메모 전과 같다`, () => {
  for (const n of names) assert.deepStrictEqual(shiftGroupOf(n), shiftGroupRef(n), n);
});

t.ok("shiftGroupOf — 돌려준 배열을 고쳐도 다음 답이 그대로다", () => {
  const first = shiftGroupOf("giratina");
  first.push("bad");
  first[0] = "bad";
  assert.deepStrictEqual(shiftGroupOf("giratina"), ["giratina", "giratina-origin"]);
});

t.ok("singleSpecies — 메모 전과 같은 집합이다", () => {
  assert.deepStrictEqual([...singleSpecies()].sort(), [...singleRef()].sort());
});

t.ok("singleSpecies — 두 번 불러도 같은 값을 다시 만들지 않는다", () => {
  assert.strictEqual(singleSpecies(), singleSpecies());
});

t.ok("자료 폴더가 다르면 따로 메모한다", () => {
  const empty = { dataDir: "no-such-data-dir" };
  assert.deepStrictEqual(shiftGroupOf("giratina", empty), []);
  assert.deepStrictEqual(shiftGroupOf("giratina"), ["giratina", "giratina-origin"]);
});

printLine(`selftest-memo: 통과 (${t.count()}건)`);
