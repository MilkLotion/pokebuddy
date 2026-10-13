// 도감 모듈의 데이터 읽기 — data/*.json 을 한 번 읽어 캐시한다. 경로는 주입 가능(시험에서 다른 표를 꽂는다)
// 기본 경로는 dist/dex 에서 프로젝트/data. 배포 패키지의 files 에 data/ 가 들어간다 (package.json)

import { readFileSync } from "node:fs";
import * as path from "node:path";

export interface DexOptions {
  dataDir?: string;
}

export const DEFAULT_DATA_DIR = path.join(__dirname, "..", "..", "data");

// 자료 폴더 → 파일 이름 → 파싱 결과. 같은 파일은 다시 읽지 않는다.
// 맞을 때는 경로를 만들지 않는다 — 스냅샷 한 번에 수천 번 불려 path.join 이 스냅샷 시간의 3할이었다 (worklog/records/perf-refactor 3-1)
const cache = new Map<string, Map<string, unknown>>();

export const dataDirOf = (opts?: DexOptions): string => opts?.dataDir ?? DEFAULT_DATA_DIR;

export function loadJson<T>(name: string, opts?: DexOptions): T {
  const dir = dataDirOf(opts);
  let byName = cache.get(dir);
  if (!byName) {
    byName = new Map();
    cache.set(dir, byName);
  }
  const hit = byName.get(name);
  if (hit !== undefined) return hit as T;
  const parsed = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as T;
  byName.set(name, parsed);
  return parsed;
}

// 슬러그 정규화 — 공백·대소문자, codex 팩의 `-3d`(같은 종의 다른 그림체)를 뗀다 (src/dex/dex-number.ts 도 이 함수로 슬러그를 맞춘다)
export const normalizeSlug = (slug: string): string =>
  String(slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/-3d$/, "");

// JSON 표의 메모 키(`_comment` 처럼 밑줄로 시작) — 데이터가 아니다
export const isMetaKey = (key: string): boolean => key.startsWith("_");
