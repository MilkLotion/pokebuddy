// 받기·캐시 한 벌 자체 확인 (src/main/art/asset-cache.ts) — 네트워크 없이 돈다. 받는 주소는 닫힌 로컬 포트라 곧 실패한다
//   npm run build 뒤 node dist/tools/selftest/selftest-asset-cache.js
// 확인: 앱에 든 폴더 먼저, 캐시 다음, 검증에 안 맞는 파일은 넘김, 메모, 못 받은 것 기억(retryMs null·0·양수), has·names, data URI
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createAssetCache, dataUriOf } from "../../main/art/asset-cache";
import { makeTmp } from "../harness/tmp-dir";

const DEAD = "http://127.0.0.1:9/none"; // 받을 곳 없음 — 곧 실패한다
const good = (text: string): Buffer => Buffer.from(`OK:${text}`);
const isGood = (buf: Buffer): boolean => buf.toString("ascii", 0, 3) === "OK:";

async function main(): Promise<void> {
  const root = makeTmp("asset-cache");
  const dir = path.join(root, "cache");
  const bundled = path.join(root, "bundled");
  fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
  fs.mkdirSync(path.join(bundled, "sub"), { recursive: true });
  fs.writeFileSync(path.join(bundled, "a.bin"), good("bundled-a"));
  fs.writeFileSync(path.join(dir, "a.bin"), good("cache-a"));
  fs.writeFileSync(path.join(dir, "b.bin"), good("cache-b"));
  fs.writeFileSync(path.join(bundled, "bad.bin"), Buffer.from("no"));
  fs.writeFileSync(path.join(dir, "bad.bin"), good("cache-bad"));
  fs.writeFileSync(path.join(bundled, "sub", "x.bin"), good("x"));
  fs.writeFileSync(path.join(dir, "sub", "y.bin"), good("y"));
  try {
    const cache = createAssetCache({ dir, bundled, validate: isGood, mime: () => "application/test", parallel: 2, retryMs: null });

    // (1) 읽는 순서 — 앱에 든 폴더 → 캐시. 검증에 안 맞으면 다음 폴더
    assert.equal(await cache.fetchUri("a.bin", DEAD), dataUriOf("application/test", good("bundled-a")), "앱에 든 폴더가 먼저");
    assert.equal(await cache.fetchUri("b.bin", DEAD), dataUriOf("application/test", good("cache-b")), "앱에 없으면 캐시");
    assert.equal(await cache.readUri("bad.bin"), dataUriOf("application/test", good("cache-bad")), "검증에 안 맞는 앱 폴더 파일은 넘긴다");
    assert.equal((await cache.fetchBuffer("b.bin", DEAD))?.toString(), "OK:cache-b", "fetchBuffer 는 캐시를 읽는다");
    process.stdout.write("(1) 읽는 순서  ok\n");

    // (2) 메모 — 디스크가 바뀌어도 이미 만든 data URI 를 준다
    fs.writeFileSync(path.join(dir, "b.bin"), good("changed"));
    assert.equal(await cache.fetchUri("b.bin", DEAD), dataUriOf("application/test", good("cache-b")), "메모한 값");
    process.stdout.write("(2) 메모  ok\n");

    // (3) 못 받은 것 — retryMs null 이면 다시 받지 않는다. 그 뒤 파일이 생겨도 이 프로세스에서는 null
    assert.equal(await cache.fetchUri("c.bin", DEAD), null, "받을 곳이 없으면 null");
    fs.writeFileSync(path.join(dir, "c.bin"), good("late"));
    assert.equal(await cache.fetchUri("c.bin", DEAD), null, "retryMs null — 다시 청하지 않는다");
    const always = createAssetCache({ dir, validate: isGood, mime: () => "application/test", retryMs: 0 });
    fs.rmSync(path.join(dir, "c.bin"));
    assert.equal(await always.fetchUri("c.bin", DEAD), null);
    fs.writeFileSync(path.join(dir, "c.bin"), good("late"));
    assert.equal(await always.fetchUri("c.bin", DEAD), dataUriOf("application/test", good("late")), "retryMs 0 — 늘 다시 본다");
    const later = createAssetCache({ dir, validate: isGood, mime: () => "application/test", retryMs: 60_000 });
    assert.equal(await later.fetchUri("d.bin", DEAD), null);
    fs.writeFileSync(path.join(dir, "d.bin"), good("d"));
    assert.equal(await later.fetchUri("d.bin", DEAD), null, "retryMs 안에는 다시 청하지 않는다");
    process.stdout.write("(3) 못 받은 것 기억  ok\n");

    // (4) 같은 파일을 동시에 청하면 한 번만 — 같은 약속을 받는다
    const p1 = cache.fetchBuffer("e.bin", DEAD);
    const p2 = cache.fetchBuffer("e.bin", DEAD);
    assert.equal(p1, p2, "받는 중인 파일은 같은 약속");
    assert.equal(await p1, null);
    process.stdout.write("(4) 겹쳐 받기 막기  ok\n");

    // (5) has·names — 두 폴더의 합
    assert.equal(cache.has("sub/x.bin"), true);
    assert.equal(cache.has("sub/y.bin"), true);
    assert.equal(cache.has("sub/z.bin"), false);
    assert.deepEqual(cache.names("sub").sort(), ["x.bin", "y.bin"]);
    assert.deepEqual(cache.names("none"), []);
    process.stdout.write("(5) has·names  ok\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write("selftest-asset-cache: 통과 (읽는 순서·메모·못 받은 것 기억·겹쳐 받기 막기·has·names)\n");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
