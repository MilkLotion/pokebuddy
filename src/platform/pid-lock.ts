// pid 잠금 파일 — 파일에 pid 를 적어 "이 일을 하는 프로세스는 하나"를 지킨다. 저장 쓰기(save.lock)가 쓴다
//
// 살아 있는 다른 pid 가 있으면 실패, 죽은 pid 의 잠금은 덮어쓴다. 놓기는 내 pid 일 때만 지운다.
// 파일은 'wx'(없을 때만 만들기)로 만든다 — 동시에 뜬 둘이 "없네" 하고 같이 쓰는 것을 막는다.
// 첫 낱말이 pid 다 — "<pid>\n" 과 "<pid>\nready\n" 을 둘 다 읽는다
import fs from "node:fs";
import path from "node:path";
import { isPidAlive } from "./pid.js";

export type ClaimReason = "ok" | "busy" | "error";

export interface ClaimResult {
  ok: boolean;
  owner: number | null; // ok 면 내 pid, busy 면 살아 있는 상대 pid
  reason: ClaimReason;
}

// lock 에 적힌 pid — 없거나 파손이면 null
export function readLockPid(lockFile: string): number | null {
  try {
    const pid = Number(String(fs.readFileSync(lockFile, "utf8")).trim().split(/\s+/)[0]);
    return pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

// 살아 있는 소유자 pid — 죽었거나 없으면 null
export function liveLockOwner(lockFile: string): number | null {
  const pid = readLockPid(lockFile);
  return pid != null && isPidAlive(pid) ? pid : null;
}

// 잡기 — { ok, owner, reason }. reason: ok · busy(살아 있는 다른 pid) · error
export function claimLock(lockFile: string, pid: number = process.pid): ClaimResult {
  // 폴더를 못 만들면 잠금을 쓸 수 없다 — error. 폴더 자리에 파일이 있어 EEXIST 가 나도 "잠금이 이미 있다"로 읽지 않게 따로 본다
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  } catch {
    return { ok: false, owner: null, reason: "error" };
  }
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      try {
        fs.writeSync(fd, `${pid}\n`);
      } finally {
        fs.closeSync(fd);
      }
      return { ok: true, owner: pid, reason: "ok" };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return { ok: false, owner: null, reason: "error" };
    }
    const cur = readLockPid(lockFile);
    if (cur === pid) return { ok: true, owner: pid, reason: "ok" }; // 이미 내 것
    if (cur != null && isPidAlive(cur)) return { ok: false, owner: cur, reason: "busy" };
    try {
      fs.unlinkSync(lockFile); // 죽은 pid · 파손 — 지우고 한 번 더
    } catch {
      // 사이에 누가 지웠다 — 다음 회차의 wx 가 가른다
    }
  }
  return { ok: false, owner: readLockPid(lockFile), reason: "busy" };
}

// 그 pid 가 준비를 마쳤다고 적었나 — "<pid>\nready\n". 다른 pid 의 ready 는 보지 않는다
export function isLockReady(lockFile: string, pid: number): boolean {
  try {
    const words = String(fs.readFileSync(lockFile, "utf8")).trim().split(/\s+/);
    return Number(words[0]) === pid && words.includes("ready");
  } catch {
    return false;
  }
}

// 내 pid 가 적혀 있나 — 파일을 매번 읽는다 (누가 지웠거나 가로챘으면 바로 안다)
export function ownsLock(lockFile: string, pid: number = process.pid): boolean {
  return readLockPid(lockFile) === pid;
}

// 놓기 — 내 것일 때만 지운다. 남의 lock 은 건드리지 않는다
export function releaseLock(lockFile: string, pid: number = process.pid): boolean {
  if (!ownsLock(lockFile, pid)) return false;
  try {
    fs.unlinkSync(lockFile);
    return true;
  } catch {
    return false;
  }
}
