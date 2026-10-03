// 파일 쓰기 도구와 옛 저장(v2) 파일 읽기·쓰기 — 지금 저장은 v3 이다(src/save/v3.ts · store.ts). v2 의 모양과 정규화는 ./v2/ 에 있다
// 원자적 쓰기(writeAtomic·sleepSync)는 src/platform/atomic-write.ts 다
// v2 파일의 파손은 save.json.bak 으로 옮기고 state:null — 부르는 쪽이 새로 시작한다
import fs from "node:fs";
import { writeAtomic } from "../platform/atomic-write.js";
import type { SaveV2 } from "./v2/types.js";
import { normalizeSaveV2 } from "./v2/normalize.js";

// [임시] 원자적 쓰기의 옛 자리 — src/tools 의 dev-manage · selftest-clock · legacy · play 가 legacy.* 로 읽는다. 원본은 src/platform/atomic-write.ts
export { sleepSync, writeAtomic } from "../platform/atomic-write.js";
// [임시] v2 정규화의 옛 이름 — src/tools/selftest/selftest-legacy·save·stage 가 legacy.* 로 읽는다. 원본은 ./v2/normalize.ts
export { emptyPet, emptySaveV2 as empty, emptyTotals, freshPetDaily, normalizeSaveV2 as normalize, type PetInit } from "./v2/normalize.js";

export interface ReadOptions {
  repair?: boolean; // 파손이면 .bak 으로 옮긴다 — writer 만. 읽기 전용은 false
}

export interface ReadResult {
  state: SaveV2 | null;
  corrupted: boolean; // 파손을 만났다 (repair 면 .bak 으로 옮겼다)
  reason?: "unreadable"; // 잠김·권한 — 다음에 다시 읽는다
}

const errCode = (e: unknown): string | undefined => (e != null && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : undefined);

// ── 파일 ───────────────────────────────────────────────────────────────────────

// 파손 파일을 .bak 으로 — 덮어쓴다 (두 번 깨지면 마지막 것만 남는다). 못 옮기면 복사 후 삭제, 그것도 안 되면 그대로 둔다
export function quarantine(file: string): boolean {
  const bak = `${file}.bak`;
  try {
    fs.renameSync(file, bak);
    return true;
  } catch {
    try {
      fs.copyFileSync(file, bak);
      fs.unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  }
}

// 읽기 — { state, corrupted }
//   없음        { state: null, corrupted: false }
//   정상        { state, corrupted: false } — v1 이면 v2 로 이전한 값
//   파손        { state: null, corrupted: true } — repair 면 .bak 으로 옮긴다 (writer 만). 읽기 전용은 손대지 않는다
export function read(file: string, { repair = true }: ReadOptions = {}): ReadResult {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (errCode(e) === "ENOENT") return { state: null, corrupted: false };
    return { state: null, corrupted: false, reason: "unreadable" }; // 잠김·권한 — 다음에 다시 읽는다
  }
  let state: SaveV2 | null = null;
  try {
    state = normalizeSaveV2(JSON.parse(text.replace(/^﻿/, "")));
  } catch {
    state = null;
  }
  if (state) return { state, corrupted: false };
  if (repair) quarantine(file);
  return { state: null, corrupted: true };
}

// 쓰기 — 성공 여부만. 실패는 무시하고 다음 갱신에 다시 쓴다 (config 저장과 같은 태도)
export function write(file: string, state: SaveV2): boolean {
  return writeAtomic(file, state);
}
