// 수명 — 동반자 lock 파일 규약(claim · ready · watch) · 실패 기록. 펫을 끝내 줄 부모가 없으므로 스스로 본다
//
// lock 파일 companion.lock — pokebuddy companion 이 만든다. 직접 실행(npm start·설치한 앱)이면 스스로 만든다.
// 끝날 조건: lock 파일이 사라짐 (companion stop) · 트레이·메뉴의 종료
import fs from "node:fs";
import path from "node:path";
import type { Paths } from "./paths";

export const LIFETIME_RULES = {
  checkMs: 1000, // lock 파일이 남아 있는지 확인하는 주기 (옛 LIFE_CHECK_MS)
};

export interface LifetimeOptions {
  lockFile: string;
  pidAlive: (pid: number) => boolean;
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

const firstPid = (file: string): number => Number(fs.readFileSync(file, "utf8").split("\n")[0]);

export function createLifetime(opts: LifetimeOptions): Lifetime {
  const { lockFile: file, pidAlive, hasWindow, quit } = opts;
  const pid = opts.pid ?? process.pid;
  let seen = false; // 한 번도 못 봤으면 끝내지 않는다 — lock 을 적기 전에 곧바로 끝나지 않게
  let ready = false;
  let timer: NodeJS.Timeout | null = null;
  let watcher: fs.FSWatcher | null = null;

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
      // 내리기는 바로 반응한다
      try {
        watcher = fs.watch(path.dirname(file), () => check());
      } catch {
        // 감시 실패해도 주기 확인이 받쳐 준다
      }
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      try {
        watcher?.close();
      } catch {
        // 이미 닫혔다
      }
      watcher = null;
    },
    // lock 에 살아 있는 다른 pid 가 적혀 있으면 그쪽이 먼저다 — 단일 인스턴스 잠금이 막지 못한 경우의 마지막 방어
    claim() {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (fs.existsSync(file)) {
          const other = firstPid(file);
          if (other > 0 && other !== pid && pidAlive(other)) return false;
        }
        fs.writeFileSync(file, `${pid}\n`);
        return true;
      } catch {
        return true; // 못 만들면 파일 감시 없이 산다 — 트레이로만 끝난다
      }
    },
    owns() {
      try {
        return firstPid(file) === pid;
      } catch {
        return false;
      }
    },
    check,
    // lock 은 내 pid 일 때만 지운다 — 새 동반자가 다시 적은 것을 지우면 그쪽이 끝난다
    release() {
      if (this.owns()) fs.rmSync(file, { force: true });
    },
  };
}

// 펫이 못 뜬 이유를 남긴다 — 펫의 출력은 평소 버려지므로 pokebuddy 명령과 pokebuddy status 가 읽을 수 있게. 실패해도 조용히
export function reportFailure(paths: Pick<Paths, "home" | "lastError">, slug: string, message: string, reason?: string): void {
  try {
    fs.mkdirSync(paths.home, { recursive: true });
    fs.writeFileSync(paths.lastError, JSON.stringify({ at: Date.now() / 1000, slug, message, reason }));
  } catch {
    // 기록 실패는 무시
  }
}

// 이 펫이 떴으니 이 펫의 옛 실패 기록은 지운다 — 남겨 두면 status 가 해결된 문제를 계속 보여 준다. 다른 펫의 기록은 건드리지 않는다
export function clearFailure(paths: Pick<Paths, "lastError">, slug: string): void {
  try {
    const e = JSON.parse(fs.readFileSync(paths.lastError, "utf8")) as { slug?: unknown };
    if (e.slug === slug) fs.rmSync(paths.lastError, { force: true });
  } catch {
    // 기록 없음
  }
}
