// 수명 — 동반자 lock 파일 규약(claim · ready · watch). 펫을 끝내 줄 부모가 없으므로 스스로 본다
//
// lock 파일 companion.lock — pokebuddy companion 이 만든다. 직접 실행(npm start·설치한 앱)이면 스스로 만든다.
// 잡기는 저장 잠금과 같은 규약이다(src/platform/pid-lock.ts — 없을 때만 만들기 'wx'). 동시에 뜬 둘 가운데 하나만 이긴다 (2026-10-03 X6)
// 끝날 조건: lock 파일이 사라짐 (companion stop) · 트레이·메뉴의 종료
import fs from "node:fs";
import path from "node:path";
import { clearLastError, writeLastError } from "../platform/last-error.js";
import { claimLock, ownsLock, releaseLock } from "../platform/pid-lock.js";
import { watchDir, type DirWatch } from "../platform/watch-dir.js";
import type { Paths } from "./paths";

export const LIFETIME_RULES = {
  checkMs: 1000, // lock 파일이 남아 있는지 확인하는 주기 (옛 LIFE_CHECK_MS)
};

export interface LifetimeOptions {
  lockFile: string;
  hasWindow: () => boolean; // 창이 생긴 뒤에만 ready 를 적는다
  quit: () => void;
  pid?: number;
}

export interface Lifetime {
  start(): void; // 주기 확인 + lock 파일 폴더 감시
  stop(): void;
  claim(): boolean; // lock 파일을 스스로 적는다. false 면 살아 있는 다른 동반자가 있다 — 끝내야 한다
  owns(): boolean; // lock 파일이 내 것인가 — 새 동반자가 다시 적었을 수 있다
  check(): void; // 창이 생겼으면 ready 를 적고, 파일이 사라졌으면 끝낸다
  release(): void; // will-quit — 내 것일 때만 지운다
}

export function createLifetime(opts: LifetimeOptions): Lifetime {
  const { lockFile: file, hasWindow, quit } = opts;
  const pid = opts.pid ?? process.pid;
  let seen = false; // 한 번도 못 봤으면 끝내지 않는다 — lock 을 적기 전에 곧바로 끝나지 않게
  let ready = false;
  let timer: NodeJS.Timeout | null = null;
  let watcher: DirWatch | null = null;

  // 창을 만들었으면 ready 를 적어 pokebuddy companion 이 기다림을 끝내게 하고, 파일이 사라졌으면(companion stop) 스스로 끝난다
  function check(): void {
    if (!fs.existsSync(file)) {
      if (seen) quit();
      return;
    }
    seen = true;
    if (ready || !hasWindow()) return;
    let fd: number | null = null;
    try {
      // r+ 는 없는 파일을 만들지 않는다 — 방금 내려진 동반자가 파일을 되살리지 않게
      fd = fs.openSync(file, "r+");
      fs.ftruncateSync(fd);
      fs.writeSync(fd, `${pid}\nready\n`);
      ready = true;
    } catch {
      // 방금 지워졌다 — 다음 확인에서 끝난다
    } finally {
      if (fd != null) fs.closeSync(fd);
    }
  }

  return {
    start() {
      check();
      timer = setInterval(check, LIFETIME_RULES.checkMs);
      // 내리기는 바로 반응한다. 감시를 못 걸어도 주기 확인이 받쳐 준다 (src/platform/watch-dir.ts)
      watcher = watchDir(path.dirname(file), () => check());
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      watcher?.stop();
      watcher = null;
    },
    // lock 에 살아 있는 다른 pid 가 적혀 있으면 그쪽이 먼저다 — 단일 인스턴스 잠금이 막지 못한 경우의 마지막 방어.
    // 이미 내 pid 면(pokebuddy companion 이 먼저 적었다) 그대로 잡은 것이다. 죽은 pid 의 lock 은 지우고 다시 잡는다
    claim() {
      const r = claimLock(file, pid);
      return r.ok || r.reason === "error"; // 못 만들면 파일 감시 없이 산다 — 트레이로만 끝난다
    },
    owns: () => ownsLock(file, pid),
    check,
    // lock 은 내 pid 일 때만 지운다 — 새 동반자가 다시 적은 것을 지우면 그쪽이 끝난다
    release() {
      releaseLock(file, pid);
    },
  };
}

// 펫이 못 뜬 이유의 기록은 src/platform/last-error.ts 다(CLI 와 같이 쓴다).
// [임시] 옛 이름 — src/main/app.ts 의 부르는 줄 여섯이 이 이름을 쓴다. 메인 레인 M7 이 writeLastError·clearLastError 로 바꾸면 걷는다
export const reportFailure = (paths: Pick<Paths, "home" | "lastError">, slug: string, message: string, reason?: string): void =>
  writeLastError(paths, { slug, message, ...(reason !== undefined ? { reason } : {}) });
export const clearFailure = clearLastError;
