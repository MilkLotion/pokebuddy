// 동반자가 못 뜬 까닭의 기록 — 동반자의 출력은 평소 버려지므로 파일에 남긴다. pokebuddy 명령(src/cli/run.ts)과 pokebuddy status(src/cli/status.ts)가 읽는다.
// 모양: { at: 초(Date.now() / 1000), slug, message, reason? }. 지금 src/main/app/lifetime.ts reportFailure·clearFailure 와 같은 파일·모양이다. 실패해도 조용히
import fs from "node:fs";
import { writeAtomic } from "./atomic-write.js";
import { readJsonFile } from "./json-file.js";
import type { Paths } from "./paths.js";

export interface LastError {
  at: number; // 초
  slug: string;
  message: string;
  reason?: string;
}

// 까닭을 남긴다 — 덮어쓴다. 시각은 지금. 원자적 쓰기 — 저장과 같이 tmp + rename, Windows 에서 잠깐 막히면 다시 (94-same-feature-diffs.md 5-9)
export function writeLastError(paths: Pick<Paths, "home" | "lastError">, error: Omit<LastError, "at">): void {
  try {
    writeAtomic(paths.lastError, JSON.stringify({ at: Date.now() / 1000, slug: error.slug, message: error.message, reason: error.reason }));
  } catch {
    // 기록 실패는 무시
  }
}

// 이 펫이 떴으니 이 펫의 옛 기록은 지운다 — 다른 펫의 기록은 건드리지 않는다. 읽기는 readLastError 와 같다(BOM·모양 검사)
export function clearLastError(paths: Pick<Paths, "lastError">, slug: string): void {
  if (readLastError(paths.lastError)?.slug !== slug) return;
  try {
    fs.rmSync(paths.lastError, { force: true });
  } catch {
    // 지우지 못하면 다음에 다시
  }
}

// 남은 기록 — 없거나 모양이 틀리면 null
export function readLastError(file: string): LastError | null {
  const raw = readJsonFile(file);
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.at !== "number" || typeof e.slug !== "string" || typeof e.message !== "string") return null;
  return { at: e.at, slug: e.slug, message: e.message, ...(typeof e.reason === "string" ? { reason: e.reason } : {}) };
}
