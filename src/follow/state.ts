// 동반자(main)와 진단 도구(pokebuddy status)가 똑같은 판정을 쓰도록 공통 부분만 모은 곳
// 로직이 두 벌이 되면 진단이 실제와 다른 답을 낸다 — 그래서 여기 한 곳에만 둔다
// cli/*.js 가 dist/follow/state.js 를 이름으로 부른다
import fs from "node:fs";
import path from "node:path";
import type { AgentState } from "../shared/types";
import type { StateInfo, StateRecord } from "./types";

export const STALE_SEC = 600; // 작업 중·기다림이 이만큼 갱신 없으면 대기로 — Esc 중단 시 Stop 훅이 안 온다

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // 남의 소유 프로세스 — 살아 있다
  }
}

// 기록 하나를 지금 보여야 할 상태로 환산
export function resolveState(record: StateRecord): AgentState {
  const age = Date.now() / 1000 - (record.at || 0);
  let state: AgentState = record.state || "idle";
  if (record.hold != null && age >= record.hold) state = record.then || "idle";
  if ((state === "running" || state === "waiting") && age > STALE_SEC) state = "idle";
  return state;
}

// 훅이 남긴 세션 상태 기록 전부 — 최신(mtime)순. 폴더가 없으면 []
// 동반자는 폴링마다 한 번 읽어 호스트 판정(front.ts hostOf)과 상태 판정(stateFor)에 같이 쓴다
export function readStateRecords(stateDir: string): StateRecord[] {
  const records: StateRecord[] = [];
  try {
    const files = fs
      .readdirSync(stateDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(stateDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const file of files) {
      try {
        records.push(JSON.parse(fs.readFileSync(file, "utf8")) as StateRecord);
      } catch {
        // 쓰는 중·파손 — 이 파일만 건너뛴다
      }
    }
  } catch {
    // 폴더 없음 — 기본값
  }
  return records;
}

// 동반자가 따를 상태 — pids(맨 앞 터미널 창 주인 pid) 중 하나를 조상으로 가진 최신 기록.
// 조상을 못 적은 기록은 거른다 — pid 하나로 고르는데 "아무 기록에나 맞음"이 되면 남의 창 상태를 따른다.
// pids 가 비면(알려진 터미널 앱만) 대기
export function stateFor(records: StateRecord[], pids: Iterable<number> | null | undefined): StateInfo {
  const want = pids instanceof Set ? (pids as Set<number>) : new Set(pids || []);
  if (!want.size) return { state: "idle", promptAt: null };
  const record = records.find((r) => Array.isArray(r.ancestors) && r.ancestors.some((pid) => want.has(pid)));
  if (!record) return { state: "idle", promptAt: null };
  return { state: resolveState(record), promptAt: Number(record.promptAt) || null, ...(record.usage ? { tokenWork: true } : {}) };
}
