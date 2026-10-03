// 폴더 하나를 본다 — fs.watch 의 이벤트를 한 틱으로 묶어 부른다. 파일을 직접 보면 원자적 쓰기(rename) 뒤에 감시가 끊긴다.
// tmp + rename 은 이벤트를 여러 번 낸다 — 같은 틱의 이벤트는 한 번만 부른다. 감시를 못 걸거나 폴더가 사라지면 조용히 멈춘다 —
// 부르는 쪽이 주기 확인(폴링)으로 받쳐 준다
import fs from "node:fs";

export interface WatchDirOptions {
  only?: string; // 이 파일 이름의 이벤트만 본다. 이름 없는 이벤트(일부 OS)는 늘 본다
}

export interface DirWatch {
  stop(): void;
}

export function watchDir(dir: string, onChange: () => void, { only }: WatchDirOptions = {}): DirWatch {
  let closed = false;
  let pending = false;
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(dir, (_event, filename) => {
      if (pending || closed) return;
      if (only && filename && filename !== only) return;
      pending = true;
      setImmediate(() => {
        pending = false;
        if (!closed) onChange();
      });
    });
    watcher.on("error", () => {
      // 폴더가 사라졌다 — 부르는 쪽의 주기 확인이 받쳐 준다
    });
  } catch {
    watcher = null;
  }
  return {
    stop() {
      closed = true;
      try {
        watcher?.close();
      } catch {
        // 이미 닫혔다
      }
      watcher = null;
    },
  };
}
