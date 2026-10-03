// 받기 → 캐시 → 못 받은 것 기억 한 벌 — 초상·도구 그림, 울음소리, 걷기 대체 그림이 쓴다
// (worklog/records/code-structure/design/10-main.md 3.11절 art/asset-cache.ts)
//
// 읽는 순서: 앱에 든 폴더(bundled) → 사용자 캐시(dir) → 네트워크. 받은 것은 검증을 지나야 캐시에 둔다(./fetch.ts fetchCached)
// 같은 파일을 동시에 청하면 한 번만 받는다. 못 받은 파일은 retryMs 동안 다시 청하지 않는다
// PMD 묶음(./pmd-load.ts)과 무대 그림 로더(./stage-art.ts)의 기억은 여기에 넣지 않는다 — 묶음 단위이고 실패 기억의 뜻이 다르다
import fs from "node:fs";
import path from "node:path";
import { fetchCached } from "./fetch";

export interface AssetCacheOptions {
  dir: string; // 사용자 캐시 폴더
  bundled?: string; // 앱에 든 폴더(없어도 된다). dir 보다 먼저 본다
  validate(buf: Buffer): boolean;
  mime(buf: Buffer): string; // data URI 의 형식
  parallel?: number; // fetchUri 가 한 번에 받는 수. 없으면 제한 없음
  retryMs: number | null; // 못 받은 뒤 다시 청하기까지. null 이면 이 프로세스에서는 다시 받지 않는다. 0 이면 늘 다시
}

export interface AssetCache {
  // 캐시 → 네트워크. 같은 파일은 한 번만 받는다. 앱에 든 폴더는 보지 않는다(부르는 쪽이 먼저 has 로 본다)
  fetchBuffer(rel: string, url: string): Promise<Buffer | null>;
  // 앱에 든 폴더 → 캐시 → 네트워크, data URI 로. 메모하고, 못 받은 것은 retryMs 동안 기억한다. parallel 만큼만 동시에 받는다
  fetchUri(rel: string, url: string): Promise<string | null>;
  // fetchUri 와 같은 순서·규칙(앱에 든 폴더 → 캐시 → 네트워크, 못 받은 것 기억, parallel)으로 받아 버퍼로. data URI 메모는 하지 않는다
  fetchFile(rel: string, url: string): Promise<Buffer | null>;
  readUri(rel: string): Promise<string | null>; // 디스크만(앱에 든 폴더 → 캐시). 메모를 함께 쓴다
  has(rel: string): boolean; // 디스크에 있는가(앱에 든 폴더 또는 캐시)
  names(sub: string): string[]; // 두 폴더의 sub 안 파일 이름(합집합)
  fileOf(rel: string): string; // 캐시 안의 경로
}

// 못 받은 그림·소리를 다시 청하기까지 — 첫 실행의 네트워크 혼잡·끊김이 영영 빈 칸·무음으로 남지 않게.
// 초상·도구 그림과 울음소리가 같은 값을 쓴다 (94 문서 5-12). 걷기 대체 그림은 늘 다시 본다(0)
export const ASSET_RULES = { retryMs: 15_000 } as const;

export const dataUriOf = (mime: string, buf: Buffer): string => `data:${mime};base64,${buf.toString("base64")}`;

export function createAssetCache(o: AssetCacheOptions): AssetCache {
  const roots = o.bundled ? [o.bundled, o.dir] : [o.dir];
  const memo = new Map<string, string>(); // 캐시 경로 → 이미 만든 data URI
  const missing = new Map<string, number>(); // 못 받은 캐시 경로 → 시각
  const inflight = new Map<string, Promise<Buffer | null>>(); // 받는 중인 파일
  let running = 0;
  const waiting: (() => void)[] = [];
  const slot = async <T>(job: () => Promise<T>): Promise<T> => {
    if (o.parallel == null) return job();
    if (running >= o.parallel) await new Promise<void>((r) => waiting.push(r));
    running++;
    try {
      return await job();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };

  const fileOf = (rel: string): string => path.join(o.dir, rel);

  function fetchBuffer(rel: string, url: string): Promise<Buffer | null> {
    const file = fileOf(rel);
    const going = inflight.get(file);
    if (going) return going;
    const job = fetchCached(file, url, o.validate)
      .then((got) => got?.buf ?? null)
      .finally(() => inflight.delete(file));
    inflight.set(file, job);
    return job;
  }

  const gaveUp = (file: string): boolean => {
    const at = missing.get(file);
    if (at == null) return false;
    if (o.retryMs == null) return true;
    return Date.now() - at < o.retryMs;
  };

  // 앱에 든 폴더 → 캐시 → 네트워크. 앱에 든 그림은 바로(동기로) 읽는다 — 옮기기 전 portraits.ts 와 같은 순서
  async function fetchFile(rel: string, url: string): Promise<Buffer | null> {
    const file = fileOf(rel);
    if (gaveUp(file)) return null;
    if (o.bundled) {
      try {
        const buf = fs.readFileSync(path.join(o.bundled, rel));
        if (o.validate(buf)) return buf;
      } catch {
        // 앱에 없는 그림 — 캐시와 네트워크로 간다
      }
    }
    const got = await slot(() => fetchBuffer(rel, url));
    if (!got) {
      missing.set(file, Date.now());
      return null;
    }
    missing.delete(file);
    return got;
  }

  return {
    fetchBuffer,
    fetchFile,
    fileOf,
    async fetchUri(rel, url) {
      const file = fileOf(rel);
      const known = memo.get(file);
      if (known) return known;
      const got = await fetchFile(rel, url);
      if (!got) return null;
      const uri = dataUriOf(o.mime(got), got);
      memo.set(file, uri);
      return uri;
    },
    // 비동기다 — 창을 처음 열 때 메인이 멈추지 않게
    async readUri(rel) {
      const file = fileOf(rel);
      const known = memo.get(file);
      if (known) return known;
      for (const root of roots) {
        try {
          const buf = await fs.promises.readFile(path.join(root, rel));
          if (!o.validate(buf)) continue;
          const uri = dataUriOf(o.mime(buf), buf);
          memo.set(file, uri);
          return uri;
        } catch {
          // 이 폴더에 없는 것
        }
      }
      return null;
    },
    has: (rel) => roots.some((root) => fs.existsSync(path.join(root, rel))),
    names(sub) {
      const out = new Set<string>();
      for (const root of roots) {
        try {
          for (const n of fs.readdirSync(path.join(root, sub))) out.add(n);
        } catch {
          // 폴더 없음
        }
      }
      return [...out];
    },
  };
}
