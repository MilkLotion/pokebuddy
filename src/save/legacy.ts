// 파일 쓰기 도구와 옛 저장(v2) 파일 읽기·쓰기 — 지금 저장은 v3 이다(src/save/v3.ts · store.ts). v2 의 모양과 정규화는 ./v2/ 에 있다
// writeAtomic·sleepSync 는 mailbox 등 다른 파일 통로도 쓴다. [리팩토링 대상] 플랫폼 층(src/platform/atomic-write.ts)으로 간다
//
// 쓰기는 tmp 에 쓰고 rename (config.js save 와 같다) — 쓰다 죽어도 반쪽 파일이 남지 않는다.
// Windows 는 읽는 쪽이 파일을 열고 있으면 rename 이 EPERM/EBUSY 를 낸다 — 50ms 뒤 다시 (확장 extension.js write 의 패턴).
//   기다림은 동기(Atomics.wait) — 부르는 쪽(tick·act)이 동기라 짧게 멈추는 쪽을 택했다. 최악 150ms, 그것도 Windows 충돌 때만
// v2 파일의 파손은 save.json.bak 으로 옮기고 state:null — 부르는 쪽이 새로 시작한다
import fs from "node:fs";
import path from "node:path";
import type { SaveV2 } from "./v2/types.js";
import { normalizeSaveV2 } from "./v2/normalize.js";
import { SAVE_RULES } from "./rules.js";

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

// 동기 대기 — 메인 스레드에서도 된다. setTimeout 을 쓰면 write 가 async 가 되어 부르는 쪽이 전부 번진다
export function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // 못 기다리면 바로 다시 시도한다
  }
}

// 파일 하나를 원자적으로 쓴다 — tmp + rename, 실패하면 잠깐 뒤 다시. 끝내 실패하면 false (조용히)
// 문자열·Buffer(암호화한 저장, src/save/crypt.ts)는 그대로, 그 밖은 JSON 으로 쓴다
export function writeAtomic(file: string, data: unknown): boolean {
  const text = typeof data === "string" || Buffer.isBuffer(data) ? data : `${JSON.stringify(data, null, 2)}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    return false;
  }
  const { writeRetries, writeRetryMs } = SAVE_RULES.io;
  for (let i = 0; i < writeRetries; i++) {
    try {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      const code = errCode(e);
      if (i === writeRetries - 1 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        try {
          fs.unlinkSync(tmp);
        } catch {
          // 이미 없다
        }
        return false;
      }
      sleepSync(writeRetryMs);
    }
  }
  return false;
}

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
