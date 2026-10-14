// 훅 상태 파일(state/<세션>.json) 읽기 한 벌 — 동반자의 따라가기(src/main/stage/host-watch.ts), 진단(src/cli/status.ts),
// 연결 탭의 마지막 신호(./check.ts lastSignals)가 같이 쓴다.
// 쓰는 쪽은 훅(src/hooks/pokebuddy-state.ts)이고 모양은 src/shared/hook-record.ts 다. 읽는 쪽은 모든 필드를 의심한다.
// 쓰는 중이거나 깨진 파일은 그 파일만 건너뛴다. 폴더가 없으면 빈 목록이다
// (설계 worklog/records/code-structure/design/40-contracts-save-online.md 3.8절. 상태 환산 agentStateOf 는 따라가기 쪽 src/terminal/state.ts 에 둔다 — 층이 같아 서로 가져오지 않는다)
import fs from "node:fs";
import path from "node:path";
import type { HookStateRead } from "../shared/hook-record";

export interface HookFile {
  session: string; // 파일 이름에서 .json 을 뗀 것 — 세션 id
  record: HookStateRead;
}

export interface HookReadOptions {
  skipPrefix?: string; // 이 글자로 시작하는 파일은 읽지 않는다(연결 점검이 남긴 기록)
  newestFirst?: boolean; // 고친 시각(mtime) 최신순 — 파일마다 stat 을 한 번 더 한다
}

// 기록 파일 전부 — 세션 id 와 같이
export function readHookFiles(stateDir: string, { skipPrefix, newestFirst = false }: HookReadOptions = {}): HookFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(stateDir).filter((n) => n.endsWith(".json") && !(skipPrefix && n.startsWith(skipPrefix)));
  } catch {
    return []; // 폴더 없음
  }
  if (newestFirst) {
    const mtimeOf = (n: string): number => {
      try {
        return fs.statSync(path.join(stateDir, n)).mtimeMs;
      } catch {
        return 0;
      }
    };
    const at = new Map(names.map((n) => [n, mtimeOf(n)]));
    names.sort((a, b) => (at.get(b) ?? 0) - (at.get(a) ?? 0));
  }
  const out: HookFile[] = [];
  for (const name of names) {
    try {
      out.push({ session: name.slice(0, -".json".length), record: JSON.parse(fs.readFileSync(path.join(stateDir, name), "utf8")) as HookStateRead });
    } catch {
      // 쓰는 중·파손 — 이 파일만 건너뛴다
    }
  }
  return out;
}

// 기록 전부 — 최신(mtime)순. 동반자는 폴링마다 한 번 읽어 호스트 판정과 상태 판정에 같이 쓴다
export const readHookRecords = (stateDir: string, opts: Omit<HookReadOptions, "newestFirst"> = {}): HookStateRead[] =>
  readHookFiles(stateDir, { ...opts, newestFirst: true }).map((f) => f.record);

// 기록 전부를 되풀이해 읽는 쪽 — 결과는 readHookRecords 와 같다(최신순). 파일마다 수정 시각·크기를 기억해, 바뀐 파일만 다시 읽고 파싱한다.
// 동반자가 400ms 마다 부른다(src/main/stage/host-watch.ts) — 폴더 목록과 파일 stat 은 그대로 하고 읽기·파싱만 줄인다 (worklog/records/perf-refactor 2-6, G02-1)
export function hookRecordReader(stateDir: string, opts: Omit<HookReadOptions, "newestFirst"> = {}): () => HookStateRead[] {
  const cache = new Map<string, { key: string; mtimeMs: number; record: HookStateRead }>();
  return () => {
    let names: string[];
    try {
      names = fs.readdirSync(stateDir).filter((n) => n.endsWith(".json") && !(opts.skipPrefix && n.startsWith(opts.skipPrefix)));
    } catch {
      cache.clear();
      return []; // 폴더 없음
    }
    const seen = new Set(names);
    for (const name of [...cache.keys()]) if (!seen.has(name)) cache.delete(name);
    const rows: { mtimeMs: number; record: HookStateRead }[] = [];
    for (const name of names) {
      const file = path.join(stateDir, name);
      try {
        const st = fs.statSync(file);
        const key = `${st.mtimeMs}:${st.size}`;
        const hit = cache.get(name);
        if (hit && hit.key === key) {
          rows.push(hit);
          continue;
        }
        const row = { key, mtimeMs: st.mtimeMs, record: JSON.parse(fs.readFileSync(file, "utf8")) as HookStateRead };
        cache.set(name, row);
        rows.push(row);
      } catch {
        cache.delete(name); // 쓰는 중·파손·사라짐 — 이 파일만 건너뛴다. 다음에 다시 읽는다
      }
    }
    return rows.sort((a, b) => b.mtimeMs - a.mtimeMs).map((r) => r.record);
  };
}

// 기록의 CLI — 없던 옛 등록은 claude
const cliOf = (record: HookStateRead): string => (typeof record.cli === "string" && record.cli ? record.cli : "claude");

// CLI 별 마지막 신호 시각(ms) — 기록의 at(초) 가운데 가장 늦은 것
export function lastSignalsOf(records: readonly HookStateRead[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rec of records) {
    if (typeof rec.at !== "number") continue;
    const cli = cliOf(rec);
    const ms = Math.round(rec.at * 1000);
    if (ms > (out[cli] ?? 0)) out[cli] = ms;
  }
  return out;
}
