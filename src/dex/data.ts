// 도감 모듈의 데이터 읽기 — data/*.json 을 한 번 읽어 캐시한다. 경로는 주입 가능(시험에서 다른 표를 꽂는다)
// 기본 경로는 dist/dex 에서 프로젝트/data. 배포 패키지의 files 에 data/ 가 들어간다 (package.json)

import { readFileSync } from "node:fs";
import * as path from "node:path";

export interface DexOptions {
  dataDir?: string;
}

export const DEFAULT_DATA_DIR = path.join(__dirname, "..", "..", "data");

// 파일 절대 경로 → 파싱 결과. 같은 경로는 다시 읽지 않는다
const cache = new Map<string, unknown>();

export const dataDirOf = (opts?: DexOptions): string => opts?.dataDir ?? DEFAULT_DATA_DIR;

export function loadJson<T>(name: string, opts?: DexOptions): T {
  const file = path.join(dataDirOf(opts), name);
  const hit = cache.get(file);
  if (hit !== undefined) return hit as T;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as T;
  cache.set(file, parsed);
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
