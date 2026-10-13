// 시간 진행 말고 바뀐 것이 남았는가 — 마지막으로 올린 저장 뒤에 명령(change)이나 사건(event) 쓰기가 있었는지 센다 (./cloud.ts flushChanges)
// 배틀은 서버 저장의 배틀 파티로 싸운다. 시간 진행만 바뀌었으면 배틀 파티는 서버와 같아 올리기를 기다리지 않는다 (worklog/records/perf-refactor 2-9)
// 저장을 읽지 않는다 — 자체 검사가 그대로 부른다
import type { SaveKind } from "./cloud-state.js";

export interface ChangeMark {
  note(kind: SaveKind): void; // 로컬 저장을 썼다
  start(): number; // 올리기를 시작한다 — 그때까지의 표시. 올리기가 끝나면 done 에 넘긴다
  done(mark: number): void; // 올리기가 성공했다 — 그 표시까지는 서버에 있다
  pending(): boolean; // 서버에 없는 명령·사건 쓰기가 있다
}

// dirtyAtStart — 지난 실행에서 올리지 못한 저장이 남았다. 무엇이 바뀌었는지 모르므로 바뀐 것으로 본다
export function createChangeMark(dirtyAtStart: boolean): ChangeMark {
  let seq = dirtyAtStart ? 1 : 0;
  let uploaded = 0;
  return {
    note(kind) {
      if (kind !== "tick") seq += 1;
    },
    start: () => seq,
    done(mark) {
      if (mark > uploaded) uploaded = mark;
    },
    pending: () => seq > uploaded,
  };
}
