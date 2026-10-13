// 초상 캐시의 순서 — 최근에 쓴 것부터 남고, 상한을 넘으면 가장 오래 안 쓴 것을 버린다 (worklog/records/perf-refactor 1-2)
//
//   node dist/tools/selftest/selftest-portrait-cache.js
//
// 렌더러의 createLru(src/renderer/ui/lru.ts)를 그대로 부른다. 그림을 칠하는 부분(spriteCanvas)은 DOM 이 있어야 해 숨긴 창 smoke 가 본다
import assert from "node:assert";
import { webModule } from "../harness/web-module";
import { okCounter, printLine } from "../harness/report";

interface Lru<V> {
  has(key: string): boolean;
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  size(): number;
  keys(): string[];
}
const { createLru } = webModule<{ createLru: <V>(max: number) => Lru<V> }>("renderer/ui/lru.js");

const t = okCounter();

t.ok("상한을 넘으면 가장 오래된 것을 버린다", () => {
  const lru = createLru<number>(3);
  for (const k of ["a", "b", "c", "d"]) lru.set(k, k.charCodeAt(0));
  assert.deepStrictEqual(lru.keys(), ["b", "c", "d"]);
  assert.equal(lru.size(), 3);
});

t.ok("꺼낸 것은 가장 최근 것이 되어 남는다", () => {
  const lru = createLru<number>(3);
  for (const k of ["a", "b", "c"]) lru.set(k, 1);
  assert.equal(lru.get("a"), 1);
  lru.set("d", 1);
  assert.deepStrictEqual(lru.keys(), ["c", "a", "d"]);
});

t.ok("빈 그림(null)도 기억한다 — 다시 읽지 않는다", () => {
  const lru = createLru<null>(2);
  lru.set("blank", null);
  assert.equal(lru.has("blank"), true);
  assert.equal(lru.get("blank"), null);
});

t.ok("같은 열쇠를 다시 넣으면 값을 바꾸고 최근 것이 된다", () => {
  const lru = createLru<number>(2);
  lru.set("a", 1);
  lru.set("b", 2);
  lru.set("a", 3);
  lru.set("c", 4);
  assert.deepStrictEqual(lru.keys(), ["a", "c"]);
  assert.equal(lru.get("a"), 3);
});

printLine(`selftest-portrait-cache: 통과 (${t.count()}건)`);
