// 그림을 받아 캐시하는 공통 부분. pmd(ZIP)·울음소리·걷기 대체 그림·초상이 쓴다.
//
// 지금까지 이 프로젝트의 받기 코드에는 타임아웃이 없었다. 응답이 영영 안 오면
// 그림 로더(src/main/art/stage-art.ts → loadPmd)의 await 가 막혀 마리가 무대에 영영 안 나온다. 여기서 상한을 건다.
// (예전 art/fetch.js. 도구 레인 T7a 에서 타입 검사를 받게 옮겼다. 받기→캐시→없음 기록 한 벌(asset-cache)로 합치는 일은 파트 1 M5 다)
import fs from "node:fs";
import path from "node:path";

const TIMEOUT_MS = 8000;

type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

// Electron 메인 프로세스에서는 net.fetch 를 쓴다 — 시스템 프록시·인증서 설정을 따른다.
// Node 의 fetch 는 따르지 않아 회사 프록시 뒤에서는 그림을 못 받고 펫이 조용히 안 뜬다.
// Electron 밖(진단 도구·시험)에서는 require("electron") 이 실행 파일 경로만 주므로 Node fetch 로 간다
const httpFetch: HttpFetch = (() => {
  if (!process.versions.electron) return fetch;
  try {
    const { net } = require("electron") as typeof import("electron");
    return net && typeof net.fetch === "function" ? (url: string, init: RequestInit) => net.fetch(url, init) : fetch;
  } catch {
    return fetch;
  }
})();
// User-Agent 가 없으면 Showdown 이 403 으로 막는다
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export interface GetOptions {
  timeout?: number;
}

// 받기의 결과 — 받았다, 서버에 없다(404·410), 지금은 못 받았다(네트워크 없음·타임아웃·그 밖의 HTTP 오류).
// 없는 것과 못 받은 것을 가른다 — 예전에는 둘 다 null 이라 첫 실행이 오프라인이면 그림 목록이 "없음" 으로 영구 기록됐다 (worklog/records/perf-refactor 5-5, G18-1)
export type FetchOutcome = { buf: Buffer } | { absent: boolean };

export async function fetchOutcome(url: string, { timeout = TIMEOUT_MS }: GetOptions = {}): Promise<FetchOutcome> {
  try {
    const res = await httpFetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return { absent: res.status === 404 || res.status === 410 };
    return { buf: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return { absent: false }; // 네트워크 없음·타임아웃·중단
  }
}

// 받아서 Buffer 로. 실패하면 null — 왜 실패했는지가 필요하면 fetchOutcome
export async function fetchBuffer(url: string, opts: GetOptions = {}): Promise<Buffer | null> {
  const got = await fetchOutcome(url, opts);
  return "buf" in got ? got.buf : null;
}

// 원자적으로 저장한다. 중간에 죽으면 .tmp 만 남고 정상 파일은 생기지 않는다
export function saveAtomic(file: string, buf: Buffer): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file); // 같은 파일시스템이라 원자적이다
    return true;
  } catch {
    return false;
  }
}

export function readCache(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

export interface CachedHit {
  buf: Buffer;
  from: string;
  cached: boolean;
}

// 캐시 → 없으면 받기. validate 가 false 를 주면 캐시하지 않고 버린다.
// 검증을 읽을 때도 돌리므로, 옛 버전이 남긴 오염된 캐시는 저절로 복구된다
export async function fetchCached(file: string, url: string, validate: (buf: Buffer) => boolean = () => true, opts?: GetOptions): Promise<CachedHit | null> {
  const got = await fetchCachedOutcome(file, url, validate, opts);
  return "buf" in got ? got : null;
}

// fetchCached 와 같고, 못 받았을 때 없는 것(absent: 404·410·받았는데 검증 실패)인지 지금 못 받은 것인지를 준다
export async function fetchCachedOutcome(file: string, url: string, validate: (buf: Buffer) => boolean = () => true, opts?: GetOptions): Promise<CachedHit | { absent: boolean }> {
  const hit = readCache(file);
  if (hit && validate(hit)) return { buf: hit, from: file, cached: true };

  const got = await fetchOutcome(url, opts);
  if (!("buf" in got)) return got;
  if (!validate(got.buf)) return { absent: true };
  saveAtomic(file, got.buf);
  return { buf: got.buf, from: url, cached: false };
}
