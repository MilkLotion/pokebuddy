// 저장소 실행에서 쓸 그림을 미리 받는다 — `node dist/tools/data/fetch-sprites.js` (개발용)
// 2026-09-26 부터 설치 파일에는 그림을 넣지 않는다. 앱이 처음 켜질 때 받는다 (src/main/art/portraits.ts prefetch).
// 관리 창은 앱 안 sprites/ 가 없으면 여기서 받은 .cache/sprites/ 를 앱 안 그림으로 쓴다 (src/main/manage/window.ts)
//
// 출처: PokeAPI sprites (https://github.com/PokeAPI/sprites — 저장소 CC0, 그림 저작권은 The Pokémon Company)
//   초상    sprites/pokemon/<도감>.png · sprites/pokemon/shiny/<도감>.png  (data/dex.json 의 도감 번호 전부)
//   도구    sprites/items/<식별자>.png  (data/items.json · data/evo-items.json 의 키 중 그림이 있는 것)
//   알      sprites/pokemon/egg.png
// 결과: .cache/sprites/ — 앱의 캐시(~/.claude/pokebuddy/sprites/)와 같은 이름이다 (src/main/art/portraits.ts)
//   <4자리>.png · <4자리>-shiny.png · items/<식별자>.png · egg.png
// 이미 받은 파일은 건너뛴다. 저장소에는 넣지 않는다(.gitignore)
// (예전 scripts/fetch-sprites.cjs. 타입 검사를 받게 src/tools 로 옮겼다)
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..", "..", "..");
const OUT = path.join(root, ".cache", "sprites");
const BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites";
const PARALLEL = 16;

const isPng = (buf: Buffer) => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

async function get(url: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(String(res.status));
      return Buffer.from(await res.arrayBuffer());
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error(`받지 못함: ${url}`);
}

async function main() {
  const dex = [...new Set(Object.values(JSON.parse(fs.readFileSync(path.join(root, "data", "dex.json"), "utf8")) as Record<string, number>))].sort((a, b) => a - b);
  const items = [
    ...Object.keys(JSON.parse(fs.readFileSync(path.join(root, "data", "items.json"), "utf8")) as Record<string, unknown>),
    ...Object.keys(JSON.parse(fs.readFileSync(path.join(root, "data", "evo-items.json"), "utf8")) as Record<string, unknown>),
  ].filter((k) => /^[a-z0-9-]+$/.test(k));

  const jobs: { rel: string; url: string }[] = [];
  for (const n of dex) {
    const d = String(n).padStart(4, "0");
    jobs.push({ rel: `${d}.png`, url: `${BASE}/pokemon/${n}.png` });
    jobs.push({ rel: `${d}-shiny.png`, url: `${BASE}/pokemon/shiny/${n}.png` });
  }
  for (const id of new Set(items)) jobs.push({ rel: `items/${id}.png`, url: `${BASE}/items/${id}.png` });
  jobs.push({ rel: "egg.png", url: `${BASE}/pokemon/egg.png` });

  let got = 0;
  let had = 0;
  const missing: string[] = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const file = path.join(OUT, job.rel);
      if (fs.existsSync(file)) {
        had++;
        continue;
      }
      const buf = await get(job.url);
      if (!buf || !isPng(buf)) {
        missing.push(job.rel);
        continue;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      got++;
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  let bytes = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else bytes += fs.statSync(p).size;
    }
  };
  if (fs.existsSync(OUT)) walk(OUT);
  process.stdout.write(`그림: ${OUT} — 새로 받음 ${got} · 이미 있음 ${had} · 없음 ${missing.length} · 합 ${(bytes / 1024 / 1024).toFixed(1)}MB\n`);
  const shownMissing = missing.filter((m) => !m.startsWith("items/"));
  if (shownMissing.length) process.stdout.write(`  그림이 없는 초상: ${shownMissing.join(", ")}\n`);
}

main().catch((e) => {
  process.stderr.write(`그림을 받지 못했다: ${e && e.message ? e.message : String(e)}\n`);
  process.exit(1);
});
