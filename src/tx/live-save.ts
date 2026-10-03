// 쓰기 캐시 — 저장 값을 메모리에 두고, 정해진 간격과 명령·줍기 때 파일에 쓴다. 저장 값을 쥐는 곳은 실행기 쪽이다
//
// 1초 틱마다 적용한 값은 메모리(pending)에 두고, 파일은 flushMs 마다와 명령·줍기 때 쓴다. 1초마다 파일을 쓰면 하루 수 GB 를 쓰고
// 저장 감시(src/save/save-watch.ts)·클라우드 표시(cloud.json)가 1초마다 돈다. 읽는 쪽(명령·스냅샷)은 pending 의 사본을 본다.
// 다른 곳이 파일을 바꾸면(클라우드 저장 받기 등) pending 을 버리고 파일을 따른다. 시간 진행은 잃지 않는다 — 다음 틱이
// 파일의 lastTickAt 부터 다시 적용한다(flushMs 15초 < 시간 적용 상한 30초). 파일에 아직 안 쓴 작업 시간(workMs)은
// 따로 들고 있다가(carriedWorkMs) 다음 틱에 다시 넘긴다.
// 쓰기 간격은 단조 시계(mono)로 잰다 — 시스템 시각을 뒤로 돌려도 쓰기가 멈추지 않는다.
// 쓰기는 잠금을 잡은 프로세스만 한다. `canWrite` 를 주지 않으면 늘 쓴다 (자체 검사와 개발용 실행기).
import type { SaveV3 } from "../shared/save-v3";
import { readSave, saveStampOf, writeSave } from "../save/save-file.js";
import { SAVE_V3_RULES } from "../save/rules.js";

export interface LiveSaveOptions {
  file: string;
  canWrite?: () => boolean; // 잠금을 잡은 프로세스만 쓴다. 없으면 늘 쓴다
  flushMs?: number; // 시간 진행을 파일에 쓰는 간격. 0 이면 틱마다 쓴다
  mono?: () => number; // 단조 시계 ms. 기본 performance.now
  onWrite?: (name: string | undefined) => void; // 쓴 뒤 — name 은 거래 이름·FIND_POKEMON, 시간 진행은 없음. 올리기 종류는 받는 쪽이 가른다
}

export interface LiveSave {
  read(): SaveV3 | null; // 읽는 쪽에 주는 사본 — 거래가 검사 중에 값을 바꾸고 실패해도 메모리 값이 더럽혀지지 않게
  writable(): boolean; // 쓰는 프로세스인가 — 아니면 메모리 진행을 버리고 false
  edit(): SaveV3 | null; // 틱이 고칠 값. 메모리 값이 없으면 파일에서 읽는다
  carriedWorkMs(): number; // 파일이 밖에서 바뀌어 메모리 값을 버릴 때 건진 작업 시간
  keep(save: SaveV3, usedWorkMs: number): boolean; // 틱이 고친 값을 메모리에 두고, 간격이 됐으면 쓴다. 건진 작업 시간은 비운다
  write(save: SaveV3, name?: string): boolean; // 지금 쓴다 — 명령·줍기
  flush(): boolean; // 메모리 값이 있으면 지금 쓴다
  failing(): boolean; // 이어서 실패한 횟수가 SAVE_V3_RULES.saveFailNotifyAfter 이상이다
}

export function createLiveSave({ file, canWrite, flushMs = 0, mono = () => performance.now(), onWrite }: LiveSaveOptions): LiveSave {
  // 메모리에만 있는 시간 진행 — 파일보다 새 저장. diskKey 는 그 저장의 바탕이 된 파일의 수정 시각·크기다
  let pending: SaveV3 | null = null;
  let diskKey: string | null = null;
  let lastFlushMono: number | null = null; // 마지막 주기 쓰기(성공·실패)의 단조 시각. null 이면 아직 없다 — 첫 틱은 쓴다
  let pendingWorkMs = 0; // pending 에 넣었지만 파일에 아직 안 쓴 작업 시간
  let carried = 0; // 밖에서 파일이 바뀌어 pending 을 버릴 때 건진 작업 시간 — 다음 틱에 다시 넘긴다
  // 이어서 실패한 횟수 — 명령과 주기 저장(tick)을 함께 센다. writer 가 아니어서 쓰지 않은 것은 세지 않는다
  let failStreak = 0;

  const statKey = (): string | null => saveStampOf(file);
  // pending 이 아직 파일 위에 있는가 — 다른 곳이 파일을 바꿨으면 버린다
  const livePending = (): SaveV3 | null => {
    if (pending && statKey() !== diskKey) {
      pending = null;
      carried += pendingWorkMs; // 작업 시간은 파일에 없다 — 다음 틱이 다시 넣는다
      pendingWorkMs = 0;
    }
    return pending;
  };
  // 메모리 진행을 버린다 — 쓰는 프로세스가 아니게 됐다. reader 는 작업 시간도 들고 있지 않는다
  const dropPending = (): void => {
    pending = null;
    pendingWorkMs = 0;
    carried = 0;
  };
  // 파손 격리와 v2 이전 파일 교체는 쓰는 프로세스만 한다.
  // 수정 시각을 읽기보다 먼저 잰다 — 읽는 사이에 다른 곳이 쓰면 다음 확인에서 알아챈다. 읽으면서 이전·격리로 다시 썼으면 그 뒤 값을 쓴다
  const readDisk = (): SaveV3 | null => {
    const before = statKey();
    const r = readSave(file, { repair: canWrite ? canWrite() : true });
    diskKey = r.migrated || r.corrupted ? statKey() : before;
    return r.state;
  };
  const read = (): SaveV3 | null => {
    const p = livePending();
    return p ? structuredClone(p) : readDisk();
  };
  const write = (s: SaveV3, name?: string): boolean => {
    if (canWrite && !canWrite()) {
      dropPending(); // 쓰는 프로세스가 아니다 — 메모리 진행도 들고 있지 않는다
      return false;
    }
    const ok = writeSave(file, s);
    failStreak = ok ? 0 : failStreak + 1;
    if (ok) {
      pending = null; // 파일이 가장 새 저장이다
      pendingWorkMs = 0;
      diskKey = statKey();
      onWrite?.(name);
    }
    return ok;
  };

  return {
    read,
    writable() {
      if (canWrite && !canWrite()) {
        dropPending();
        return false;
      }
      return true;
    },
    edit: () => livePending() ?? readDisk(),
    carriedWorkMs: () => carried,
    // 주기 쓰기가 실패해도 pending 은 들고 있다(화면 값이 되돌아가지 않게). 다음 시도는 flushMs 뒤다 — 실패는 쓰기 주기마다 한 번 센다
    keep(save, usedWorkMs) {
      carried = 0;
      pendingWorkMs += usedWorkMs;
      pending = save; // 읽는 쪽은 이 값을 본다
      const m = mono();
      if (lastFlushMono !== null && m - lastFlushMono < flushMs) return true;
      lastFlushMono = m;
      return write(save); // 실패해도 pending 을 버리지 않는다 — 다음 쓰기 주기에 다시 쓴다
    },
    write,
    flush() {
      const p = livePending();
      if (!p) return true;
      lastFlushMono = mono();
      return write(p);
    },
    failing: () => failStreak >= SAVE_V3_RULES.saveFailNotifyAfter,
  };
}
