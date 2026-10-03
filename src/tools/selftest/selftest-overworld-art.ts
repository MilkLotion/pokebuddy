// 걷기 대체 그림 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-overworld-art.js (npm run selftest 가 차례로 돈다)
//
// 테스트 프레임워크 없이 assert 만. 네트워크·Electron 없이 시험이 만든 팔레트 PNG 로 본다.
// 확인하는 것 (worklog/records/fallback-art/record.md 수용 조건)
//   (1) 6칸 팔레트 PNG → 8행 × 2열 시트 둘(Idle·Walk). 팔레트 0번 점은 투명이다
//   (2) 행마다 쓰는 칸 — 0 아래 · 4 위 · 5~7 왼쪽 · 1~3 왼쪽 칸의 좌우 반전. 8칸 PNG 는 1~3 이 오른쪽 전용 칸이다
//   (3) Idle 은 첫 칸을 1도트 올려 번갈아 그린다
//   (4) 팔레트 파일을 주면 같은 번호의 색으로 칠한다. 팔레트가 없거나 깨졌으면 PNG 의 색이다
//   (5) 6칸·8칸이 아닌 PNG · 팔레트가 아닌 PNG · 깨진 입력 · 빈 그림은 null
//   (6) 그림 고르는 순서 — PMD 실패 → 걷기 대체 → 초상 대체 → null (가짜 공급자)
// 끝에 "통과 (N건)". 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import zlib from "node:zlib";
import { createArtLoader, type PmdArt } from "../../main/art";
import { looksLikeOverworld, looksLikePal, overworldArt, overworldDir, overworldUrl, parsePal, OVERWORLD_RULES } from "../../main/overworld-art";
import type { Paths } from "../../main/paths";
import { decodePng, encodePng, pngChunk, PNG_SIGNATURE } from "../../main/png";

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// 팔레트 PNG(8비트 번호, 필터 없음)를 만든다 — idx 는 줄 순서의 팔레트 번호
function indexedPng(w: number, h: number, palette: number[][], idx: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) Buffer.from(idx.subarray(y * w, (y + 1) * w)).copy(raw, y * (w + 1) + 1);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", Buffer.from(palette.flat())),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// 시험 시트 — 칸 8 × 8. 칸 n 의 가운데 4 × 4(x 2~5, y 2~5)를 팔레트 n+1 번으로 칠하고, 왼쪽 위 모서리 점(2,2)만 9번으로 찍는다.
// 좌우 반전이면 9번 점이 오른쪽 위로 간다
const CELL = 8;
const PALETTE = [
  [200, 0, 200], // 0 배경
  [10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0], [70, 0, 0], [80, 0, 0], // 1~8 칸 색
  [0, 255, 0], // 9 모서리 표시
];
function sheet(count: number): Buffer {
  const w = CELL * count;
  const idx = new Uint8Array(w * CELL);
  for (let c = 0; c < count; c++) {
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) idx[y * w + c * CELL + x] = c + 1;
    idx[2 * w + c * CELL + 2] = 9;
  }
  return indexedPng(w, CELL, PALETTE, idx);
}

// 만든 시트의 (row, col) 칸에서 (x, y) 점의 RGBA
function pixel(art: PmdArt, anim: string, row: number, col: number, x: number, y: number): number[] {
  const a = art.anims[anim]!;
  const img = decodePng(Buffer.from(a.dataUrl.slice(a.dataUrl.indexOf(",") + 1), "base64"))!;
  const o = ((row * a.fh + y) * img.w + col * a.fw + x) * 4;
  return [...img.px.subarray(o, o + 4)];
}

const FAKE_PATHS = { pmd: "", overworld: "" } as unknown as Paths;
const SHINY_PAL = Buffer.from(["JASC-PAL", "0100", "16", "200 0 200", "0 0 11", "0 0 22", "0 0 33", "0 0 44", "0 0 55", "0 0 66", "0 0 77", "0 0 88", "0 0 99"].join("\r\n"));

async function main(): Promise<void> {
  const six = overworldArt(sheet(6), null, "0999");
  const eight = overworldArt(sheet(8), null, "0591");

  await check("(1) 6칸 → 8행 2열 시트 둘, 칸은 보이는 영역 + 들썩임 1도트", () => {
    assert.ok(six);
    assert.strictEqual(six.kind, "overworld");
    assert.deepStrictEqual(Object.keys(six.anims).sort(), ["Idle", "Walk"]);
    for (const a of Object.values(six.anims)) {
      assert.deepStrictEqual([a.fw, a.fh, a.rows, a.frames.length], [4, 4 + OVERWORLD_RULES.bob, 8, 2]);
      const img = decodePng(Buffer.from(a.dataUrl.slice(a.dataUrl.indexOf(",") + 1), "base64"))!;
      assert.deepStrictEqual([img.w, img.h], [8, 40]);
    }
    assert.deepStrictEqual(six.cell, { w: 4, h: 5 });
    assert.deepStrictEqual(six.body, six.cell);
    assert.deepStrictEqual(six.anims.Walk!.frames.map((f) => f.ms), OVERWORLD_RULES.walkMs);
    assert.deepStrictEqual(six.anims.Idle!.frames.map((f) => f.ms), OVERWORLD_RULES.idleMs);
  });

  await check("(1) 팔레트 0번 점은 투명 — 배경색이 시트에 남지 않는다", () => {
    const a = six!.anims.Walk!;
    const img = decodePng(Buffer.from(a.dataUrl.slice(a.dataUrl.indexOf(",") + 1), "base64"))!;
    for (let o = 0; o < img.px.length; o += 4) {
      if (img.px[o + 3] === 0) continue;
      assert.notDeepStrictEqual([img.px[o], img.px[o + 1], img.px[o + 2]], PALETTE[0], "배경색 점이 남았다");
    }
    // Walk 의 첫 줄은 들썩임 자리라 비어 있다
    assert.strictEqual(pixel(six!, "Walk", 0, 0, 1, 0)[3], 0);
  });

  await check("(2) 6칸 — 행 0 은 칸 0·1, 행 4 는 칸 2·3, 행 5~7 은 칸 4·5", () => {
    // 칸 n 의 몸 색은 R = (n+1)*10. Walk 는 1도트 아래에서 시작한다 → 몸 안의 점 (1, 2)
    const body = (row: number, col: number): number => pixel(six!, "Walk", row, col, 1, 2)[0]!;
    assert.deepStrictEqual([body(0, 0), body(0, 1)], [10, 20]);
    assert.deepStrictEqual([body(4, 0), body(4, 1)], [30, 40]);
    for (const row of [5, 6, 7]) assert.deepStrictEqual([body(row, 0), body(row, 1)], [50, 60]);
    for (const row of [1, 2, 3]) assert.deepStrictEqual([body(row, 0), body(row, 1)], [50, 60], "6칸은 오른쪽도 칸 4·5");
  });

  await check("(2) 6칸 — 행 1~3 은 좌우 반전, 나머지는 그대로", () => {
    // 모서리 표시(초록)는 원본에서 왼쪽 위 (0, 0). Walk 는 1도트 아래 → (0, 1), 반전이면 (3, 1)
    const green = [0, 255, 0, 255];
    for (const row of [0, 4, 5, 6, 7]) assert.deepStrictEqual(pixel(six!, "Walk", row, 0, 0, 1), green, `행 ${row}`);
    for (const row of [1, 2, 3]) {
      assert.deepStrictEqual(pixel(six!, "Walk", row, 0, 3, 1), green, `행 ${row} 반전`);
      assert.notDeepStrictEqual(pixel(six!, "Walk", row, 0, 0, 1), green, `행 ${row} 는 왼쪽 위에 표시가 없어야 한다`);
    }
  });

  await check("(2) 8칸 — 행 1~3 은 오른쪽 전용 칸 6·7, 반전 없음", () => {
    assert.ok(eight);
    for (const row of [1, 2, 3]) {
      assert.deepStrictEqual([pixel(eight, "Walk", row, 0, 1, 2)[0], pixel(eight, "Walk", row, 1, 1, 2)[0]], [70, 80]);
      assert.deepStrictEqual(pixel(eight, "Walk", row, 0, 0, 1), [0, 255, 0, 255]);
    }
    assert.deepStrictEqual([pixel(eight, "Walk", 6, 0, 1, 2)[0], pixel(eight, "Walk", 6, 1, 1, 2)[0]], [50, 60]);
  });

  await check("(3) Idle — 열 0 은 제자리, 열 1 은 같은 칸을 1도트 위", () => {
    const green = [0, 255, 0, 255];
    assert.deepStrictEqual(pixel(six!, "Idle", 0, 0, 0, 1), green);
    assert.deepStrictEqual(pixel(six!, "Idle", 0, 1, 0, 0), green);
    // 두 열 모두 칸 0 이다 (걷는 칸 1 을 쓰지 않는다)
    assert.strictEqual(pixel(six!, "Idle", 0, 0, 1, 2)[0], 10);
    assert.strictEqual(pixel(six!, "Idle", 0, 1, 1, 1)[0], 10);
    assert.strictEqual(pixel(six!, "Idle", 0, 1, 1, 4)[3], 0, "올린 열의 맨 아래 줄은 비어 있다");
  });

  await check("상태 clip — running 만 Walk 오른쪽 행, 나머지는 Idle 정면", () => {
    assert.deepStrictEqual(six!.clips.running, { anim: "Walk", mode: "loop", row: 2 });
    for (const s of ["idle", "waiting", "waving", "failed", "review"]) assert.deepStrictEqual(six!.clips[s], { anim: "Idle", mode: "loop", row: 0 });
  });

  await check("(4) 팔레트 파일 — 같은 번호의 색으로 칠한다", () => {
    const shiny = overworldArt(sheet(6), SHINY_PAL, "0999");
    assert.ok(shiny);
    assert.deepStrictEqual(pixel(shiny, "Walk", 0, 0, 1, 2), [0, 0, 11, 255]);
    assert.deepStrictEqual(pixel(shiny, "Walk", 0, 1, 1, 2), [0, 0, 22, 255]);
    assert.deepStrictEqual(pixel(shiny, "Walk", 0, 0, 0, 1), [0, 0, 99, 255]);
    assert.deepStrictEqual(shiny.cell, six!.cell);
  });

  await check("(4) 깨진 팔레트는 PNG 의 색", () => {
    const art = overworldArt(sheet(6), Buffer.from("not a palette"), "0999");
    assert.ok(art);
    assert.deepStrictEqual(pixel(art, "Walk", 0, 0, 1, 2), [10, 0, 0, 255]);
  });

  await check("parsePal — JASC-PAL 만 읽는다", () => {
    assert.deepStrictEqual(parsePal("JASC-PAL\n0100\n2\n1 2 3\n4 5 6\n"), [[1, 2, 3], [4, 5, 6]]);
    assert.strictEqual(parsePal("JASC-PAL\n0100\n1\n1 2 300\n"), null);
    assert.strictEqual(parsePal("GIMP Palette\n"), null);
    assert.strictEqual(parsePal(""), null);
  });

  await check("(5) 받지 않는 입력은 null", () => {
    assert.strictEqual(overworldArt(sheet(5), null, "0001"), null, "5칸");
    assert.strictEqual(overworldArt(sheet(7), null, "0001"), null, "7칸");
    assert.strictEqual(overworldArt(Buffer.from("not a png"), null, "0001"), null, "깨진 입력");
    assert.strictEqual(overworldArt(sheet(6).subarray(0, 60), null, "0001"), null, "잘린 PNG");
    const rgba = encodePng({ w: 48, h: 8, px: Buffer.alloc(48 * 8 * 4, 255) });
    assert.strictEqual(overworldArt(rgba, null, "0001"), null, "팔레트가 아닌 PNG");
    const empty = indexedPng(48, 8, PALETTE, new Uint8Array(48 * 8));
    assert.strictEqual(overworldArt(empty, null, "0001"), null, "전부 배경");
  });

  await check("캐시 검증 — 머리말로 걷기 시트·팔레트를 가린다", () => {
    assert.strictEqual(looksLikeOverworld(sheet(6)), true);
    assert.strictEqual(looksLikeOverworld(sheet(8)), true);
    assert.strictEqual(looksLikeOverworld(sheet(5)), false);
    assert.strictEqual(looksLikeOverworld(encodePng({ w: 48, h: 8, px: Buffer.alloc(48 * 8 * 4) })), false);
    assert.strictEqual(looksLikeOverworld(Buffer.from("404: Not Found")), false);
    assert.strictEqual(looksLikePal(SHINY_PAL), true);
    assert.strictEqual(looksLikePal(Buffer.from("404: Not Found")), false);
  });

  await check("주소 — 종 이름의 - 를 _ 로, 태그 고정", () => {
    assert.strictEqual(overworldDir("mr-rime"), "mr_rime");
    assert.strictEqual(
      overworldUrl("mr-rime", "overworld.png"),
      `https://raw.githubusercontent.com/rh-hideout/pokeemerald-expansion/${OVERWORLD_RULES.ref}/graphics/pokemon/mr_rime/overworld.png`,
    );
  });

  // (6) 도감에 없는 이름은 PMD 가 네트워크 없이 null 이다 (art/pmd-load.js dexPath) — 그 뒤 순서만 본다
  const walkArt = six!;
  const portraitPng = encodePng({ w: 8, h: 8, px: Buffer.alloc(8 * 8 * 4, 255) });
  await check("(6) PMD 실패 → 걷기 대체 그림", async () => {
    const asked: string[] = [];
    const loader = createArtLoader(FAKE_PATHS, {
      overworld: { load: async (look) => (asked.push(look), walkArt), prefetch: async () => true },
      portrait: async () => assert.fail("초상까지 가면 안 된다"),
    });
    const look = await loader.loadLook("zz-none");
    assert.strictEqual(look?.art.kind, "overworld");
    assert.deepStrictEqual(asked, ["zz-none"]);
    assert.strictEqual(loader.cached("zz-none"), look);
    await loader.loadLook("zz-none");
    assert.deepStrictEqual(asked, ["zz-none"], "같은 모습은 한 번만 받는다");
  });

  await check("(6) 걷기 대체 실패 → 초상 대체 그림", async () => {
    const loader = createArtLoader(FAKE_PATHS, {
      overworld: { load: async () => null, prefetch: async () => false },
      portrait: async () => portraitPng,
    });
    assert.strictEqual((await loader.loadLook("zz-none"))?.art.kind, "portrait");
  });

  await check("(6) 걷기 대체가 던져도 초상으로 넘어간다", async () => {
    const loader = createArtLoader(FAKE_PATHS, {
      overworld: { load: async () => Promise.reject(new Error("net")), prefetch: async () => false },
      portrait: async () => portraitPng,
    });
    assert.strictEqual((await loader.loadLook("zz-none"))?.art.kind, "portrait");
  });

  await check("(6) 둘 다 실패 → null, 공급자가 없어도 null", async () => {
    const loader = createArtLoader(FAKE_PATHS, { overworld: { load: async () => null, prefetch: async () => false }, portrait: async () => null });
    assert.strictEqual(await loader.loadLook("zz-none"), null);
    assert.strictEqual(await createArtLoader(FAKE_PATHS).loadLook("zz-none"), null);
  });

  if (failures.length) {
    for (const f of failures) out(`실패 — ${f}`);
    process.exit(1);
  }
  out(`통과 (${passed}건)`);
}

void main();
