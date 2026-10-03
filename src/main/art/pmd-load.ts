// PMD 자산을 받아 캐시하고 클립으로 만든다.
// (예전 art/pmd-load.js. 도구 레인 T7a 에서 타입 검사를 받게 옮겼다. 저작자 풀이(parseCredits)는 T7b-3 에서 src/shared/pmd-credits.ts 로 — pokebuddy status 와 같이 쓴다)
import fs from "node:fs";
import path from "node:path";
import { dexPath } from "../../dex/dex-number";
import { parseCredits } from "../../shared/pmd-credits";
import type { PmdArt } from "./stage-art";
import { fetchBuffer, fetchCached, readCache, saveAtomic } from "./fetch";
import { readZipClips } from "./pmd";

// loadPmd·prefetchPmd 가 읽는 설정 값 — 저장의 마리가 아니라 그림을 고르는 데 쓰는 것만
export interface PmdConfig {
  slug: string;
  spritePath?: string;
  dotSize?: number;
  buddy?: string;
}
// 캐시 폴더 — PATHS.pmd
export interface PmdPaths {
  pmd: string;
}

const ZIP_URL = (d: string): string => `https://spriteserver.pmdcollab.org/assets/${d}/sprites.zip`;
// credits.txt 는 ZIP 에 없다. GitHub raw 에만 있다 (CC BY-NC 의 저작자 표시에 필요)
const CREDITS_URL = (d: string): string =>
  `https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite/${d}/credits.txt`;

// ★ 스프라이트가 없는 종은 404 가 아니라 200 + 22바이트 빈 ZIP 을 돌려준다.
// res.ok 만 보면 통과해서 빈 ZIP 이 캐시에 영구히 눌러앉고 그 펫은 영원히 안 뜬다.
function looksLikeSprites(buf: Buffer): boolean {
  if (!buf || buf.length < 1024) return false;
  try {
    return !!readZipClips(buf);
  } catch {
    return false;
  }
}

// 저작자 파일을 받아 캐시에 둔다. 못 받으면 null
async function fetchCredits(d: string, credFile: string): Promise<Buffer | null> {
  const got = await fetchBuffer(CREDITS_URL(d), { timeout: 4000 });
  if (got) saveAtomic(credFile, got);
  return got;
}

export async function loadPmd(config: PmdConfig, PATHS: PmdPaths): Promise<PmdArt | null> {
  const d = config.spritePath || dexPath(config.slug);
  if (!d) return null; // 모르는 이름

  // 저작자 표시 — 받아두되 실패해도 그림은 보여준다.
  // zip 과 동시에 받는다 — 차례로 받으면 처음 나오는 종이 0.2~0.3초 더 늦게 뜬다 (worklog/records/response-latency/record.md)
  const credFile = path.join(PATHS.pmd, `${d}.credits.txt`);
  let credText = readCache(credFile);
  const credJob = credText ? null : fetchCredits(d, credFile);

  const zipFile = path.join(PATHS.pmd, `${d}.zip`);
  const hit = await fetchCached(zipFile, ZIP_URL(d), looksLikeSprites);
  if (!hit) return null; // 없는 종이거나 못 받음 — 호출한 쪽이 다른 그림으로 넘어간다

  // 작업 동작은 buddy 가 켜져 있을 때만 — 꺼져 있으면 상태 동작만 돌아 쓸 일이 없다
  const built = readZipClips(hit.buf, { work: config.buddy !== "off" });
  if (!built) return null;

  if (credJob) credText = await credJob;

  // PMD 프레임은 gen5 GIF 보다 작아서 같은 dotSize 면 작아 보인다 — 3~4 를 권한다.
  // 상한은 몸 칸으로 잰다 — 작업 동작이 칸을 키웠다고 펫이 작아지지 않게 (창은 몸의 최대 2배까지 커진다)
  const zoom = Math.max(1, Math.min(Math.round(config.dotSize ?? NaN) || 2, Math.floor(480 / built.body.w), Math.floor(420 / built.body.h)));

  return {
    kind: "pmd",
    cell: built.cell,
    body: built.body,
    work: built.work,
    workOnly: built.workOnly,
    zoom,
    anims: built.anims,
    clips: built.clips,
    credits: parseCredits(credText && credText.toString("utf8")),
    dex: d,
    from: hit.from,
  };
}

// 디스크에 받아 두기만 한다 — 해석하지 않고 메모리에도 올리지 않는다. 무대에 처음 나올 때 받느라 기다리지 않게 하려는 것이다.
// 이미 zip 이 있으면 검사 없이 넘어간다(오염된 캐시는 loadPmd 가 읽을 때 고친다). 받았거나 이미 있으면 true.
// 서두를 일이 아니라 저작자 파일은 zip 이 있을 때만 받는다 — 그림이 없는 종의 저작자 파일이 캐시에 쌓이지 않게
export async function prefetchPmd(config: PmdConfig, PATHS: PmdPaths): Promise<boolean> {
  const d = config.spritePath || dexPath(config.slug);
  if (!d) return false;
  const zipFile = path.join(PATHS.pmd, `${d}.zip`);
  const ok = fs.existsSync(zipFile) || !!(await fetchCached(zipFile, ZIP_URL(d), looksLikeSprites));
  const credFile = path.join(PATHS.pmd, `${d}.credits.txt`);
  if (ok && !fs.existsSync(credFile)) await fetchCredits(d, credFile);
  return ok;
}
