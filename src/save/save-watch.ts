// 저장 감시와 writer 역할 — 잠금을 잡아 보고, 파일이 바뀌면 다시 읽는다. 저장을 고치지 않는다
//
// 잠금 파일은 `save.lock` 이다. 기기에서 저장을 쓰는 프로세스는 하나다
// (docs/specs/modules.md "창이 여러 개여도 저장 쓰기는 주 프로세스 하나가 한다").
//   writer  잠금을 잡았다. 파손 격리와 v2 이전 파일 교체를 하며 읽는다
//   reader  못 잡았다. 읽기만 한다. reclaimMs 마다 다시 잡아 본다
//
// 파일 감시는 두 역할 모두 건다. 자기가 쓴 것도 감시로 돌아와 읽으므로 메모리와 파일이 갈라지지 않는다. reclaimMs 마다 주기로도 본다.
// 명령 보내기는 부르는 쪽(./save-party.ts)의 일이고, 무대가 읽을 모양은 화면 값(src/view/party-pet.ts)이 만든다
import fs from "node:fs";
import path from "node:path";
import type { SaveV3 } from "../shared/save-v3";
import { backupName, readSave, saveStampOf } from "./save-file.js";
import { watchDir, type DirWatch } from "../platform/watch-dir.js";
import { claimLock, ownsLock, releaseLock } from "../platform/pid-lock.js";

const SAVE_WATCH_RULES = {
  reclaimMs: 10_000, // reader 가 writer 자리를 다시 잡아 보는 간격. 같은 간격으로 파일도 다시 본다(감시를 받쳐 준다)
};

export interface SaveWatchOptions {
  paths: { save: string; saveLock: string };
  pid?: number;
  reclaimMs?: number;
  log?: ((o: Record<string, unknown>) => void) | null;
}

export interface SaveWatch {
  save(): SaveV3 | null; // 마지막으로 읽은 값
  holdsRole(): boolean; // writer 역할을 맡았다고 알고 있다 — 잠금 파일은 보지 않는다
  isWriter(): boolean; // writer 역할이고 잠금 파일에 내 pid 가 적혀 있다
  refresh(): void; // 바뀐 것이 없어도 다시 읽는다 — 명령을 보낸 뒤 감시를 기다리지 않게
  onChange(cb: () => void): () => void;
  onRole(cb: (isWriter: boolean) => void): () => void;
  stop(): void; // 감시를 멈추고 잠금을 놓는다
}

export function createSaveWatch(opts: SaveWatchOptions): SaveWatch {
  const { paths } = opts;
  const pid = opts.pid ?? process.pid;
  const log = opts.log ?? null;

  let state: SaveV3 | null = null;
  let amWriter = false;
  let closed = false;
  let cacheKey: string | null = null; // mtime·크기가 같으면 다시 파싱하지 않는다
  let watcher: DirWatch | null = null;
  let timer: NodeJS.Timeout | null = null;
  const changeCbs = new Set<() => void>();
  const roleCbs = new Set<(w: boolean) => void>();

  const emitChange = (): void => {
    for (const cb of changeCbs) cb();
  };
  const emitRole = (): void => {
    for (const cb of roleCbs) cb(amWriter);
  };

  // 파일을 다시 읽는다. 바뀐 것이 없으면 아무것도 하지 않는다
  function reload(force = false): void {
    const key = saveStampOf(paths.save);
    if (!force && key === cacheKey) return;
    if (key == null) {
      cacheKey = null;
      if (state) {
        state = null;
        emitChange();
      }
      return;
    }
    // 읽기 전용은 파손 파일을 옮기지 않는다 — writer 의 일이다
    const r = readSave(paths.save, { repair: amWriter });
    if (r.reason === "unreadable" || r.reason === "locked") return; // 잠깐 잠겼다·키 없이 암호화 파일 — 지난 값을 그대로 쓴다
    if (r.migrated) log?.({ party: "migrated-v3", backup: backupName(paths.save) });
    if (r.corrupted) log?.({ party: "save-corrupted", movedTo: r.movedTo ?? null });
    cacheKey = key;
    state = r.state;
    emitChange();
  }

  // 폴더를 본다 — 저장 파일의 이벤트만 (src/platform/watch-dir.ts). 폴더를 못 만들면 감시하지 않는다
  function watch(): void {
    if (watcher) return;
    const dir = path.dirname(paths.save);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return;
    }
    watcher = watchDir(dir, () => {
      if (!closed) reload();
    }, { only: path.basename(paths.save) });
  }

  function claim(): boolean {
    if (closed) return false;
    if (amWriter && ownsLock(paths.saveLock, pid)) return true;
    const r = claimLock(paths.saveLock, pid);
    if (!r.ok) {
      if (amWriter) resign();
      return false;
    }
    if (amWriter) return true; // 잠금 파일만 사라졌던 것 — 다시 적었다
    amWriter = true;
    reload(true); // writer 가 되면 파일을 진실로 다시 읽는다 (이전이 필요하면 여기서 일어난다)
    log?.({ party: "writer", pets: state?.pets.length ?? 0 });
    emitRole();
    return true;
  }

  function resign(): void {
    if (amWriter) releaseLock(paths.saveLock, pid);
    amWriter = false;
    cacheKey = null;
    log?.({ party: "reader" });
    emitRole();
  }

  // 파일 감시가 끊겨도(폴더가 지워졌다 다시 생김·네트워크 드라이브) 변경을 놓치지 않게 주기로도 본다 — 명령 통로·동반자 lock 과 같다.
  // mtime·크기가 같으면 다시 읽지 않는다 (src/platform/watch-dir.ts "부르는 쪽이 주기 확인으로 받쳐 준다", 94-same-feature-diffs.md 5-10)
  function tick(): void {
    if (closed) return;
    if (!amWriter) claim();
    reload();
  }

  // 처음 한 번 — 잡아 보고 파일을 읽는다
  claim();
  reload(true);
  watch();
  timer = setInterval(tick, opts.reclaimMs ?? SAVE_WATCH_RULES.reclaimMs);

  return {
    save: () => state,
    holdsRole: () => amWriter,
    isWriter: () => amWriter && ownsLock(paths.saveLock, pid),
    refresh: () => reload(true),
    onChange(cb) {
      changeCbs.add(cb);
      return () => changeCbs.delete(cb);
    },
    onRole(cb) {
      roleCbs.add(cb);
      return () => roleCbs.delete(cb);
    },
    stop() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = null;
      watcher?.stop();
      watcher = null;
      if (amWriter) releaseLock(paths.saveLock, pid);
      amWriter = false;
    },
  };
}
