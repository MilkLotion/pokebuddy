// 횟수 세기 — 운영 코드에 계측 분기를 넣지 않고, 시험이 파일 함수·복제·모듈 내보내기를 감싸 센다 (worklog/records/perf-refactor 0-1)
//
// 감싸는 것
//   fs        readFileSync · writeFileSync · statSync · renameSync — 경로가 within 아래인 호출만 센다
//   복제      globalThis.structuredClone
//   내보내기   watch(모듈, 이름) 으로 고른 함수 — 다른 파일이 부르는 호출만 잡힌다(빌드 결과가 CommonJS 라 부를 때 내보내기를 읽는다).
//            같은 파일 안의 호출은 잡히지 않는다
// 시각은 재지 않는다 — ms 는 PC 마다 달라 시험이 흔들린다. 시각은 부르는 쪽이 따로 적는다
import fs from "node:fs";
import path from "node:path";

export type Counts = Record<string, number>;

export interface PerfCounter {
  watch(mod: object, name: string, label?: string): void; // 모듈 내보내기 하나를 센다
  reset(): void;
  counts(): Counts; // 0 인 것도 싣는다 — 줄 모양이 실행마다 같게
  stop(): void; // 감싼 것을 모두 되돌린다
}

const FS_CALLS = ["readFileSync", "writeFileSync", "statSync", "renameSync"] as const;

export function perfCounter(within: string): PerfCounter {
  const root = path.resolve(within);
  const counts: Counts = {};
  const undo: (() => void)[] = [];
  const bump = (key: string): void => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const inside = (p: unknown): boolean => typeof p === "string" && path.resolve(p).startsWith(root);

  const fsObj = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of FS_CALLS) {
    const orig = fsObj[name]!;
    counts[`fs.${name}`] = 0;
    fsObj[name] = function (this: unknown, ...args: unknown[]) {
      if (inside(args[0]) || (name === "renameSync" && inside(args[1]))) bump(`fs.${name}`);
      return orig.apply(this, args);
    };
    undo.push(() => (fsObj[name] = orig));
  }

  const clone = globalThis.structuredClone;
  counts.structuredClone = 0;
  globalThis.structuredClone = ((value: unknown, opts?: StructuredSerializeOptions) => {
    bump("structuredClone");
    return clone(value, opts);
  }) as typeof structuredClone;
  undo.push(() => (globalThis.structuredClone = clone));

  return {
    watch(mod, name, label = name) {
      const target = mod as Record<string, unknown>;
      const orig = target[name];
      if (typeof orig !== "function") throw new Error(`함수가 아니다: ${name}`);
      counts[label] = 0;
      const fn = orig as (...args: unknown[]) => unknown;
      target[name] = function (this: unknown, ...args: unknown[]) {
        bump(label);
        return fn.apply(this, args);
      };
      undo.push(() => (target[name] = orig));
    },
    reset() {
      for (const k of Object.keys(counts)) counts[k] = 0;
    },
    counts: () => ({ ...counts }),
    stop() {
      while (undo.length) undo.pop()!();
    },
  };
}
