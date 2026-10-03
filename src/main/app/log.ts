// 메인 프로세스의 출력과 판정 로그 (worklog/records/code-structure/design/10-main.md 1.1절 app/log.ts)
//
//   POKEBUDDY_LOG    출력(console·stderr)을 그 파일에 이어 쓴다 — pokebuddy 는 펫에 출력 핸들을 넘기지 않는다
//                    (Windows 는 Start-Process 로 띄워 넘길 수도 없다. src/cli/run.ts launchPet)
//   POKEBUDDY_DEBUG  판정 로그를 JSON 한 줄씩 (POKEBUDDY_LOG 가 있으면 그 파일로). console.log 대신 stdout 직접
import fs from "node:fs";

export type DebugLog = ((o: Record<string, unknown>) => void) | null;

// 출력을 file 로 돌린다. 파일을 못 열면 출력은 원래대로 버려진다
export function redirectOutput(file: string | undefined): void {
  if (!file) return;
  try {
    const logFd = fs.openSync(file, "w");
    const write = (chunk: unknown, encoding?: unknown, done?: unknown): boolean => {
      try {
        if (typeof chunk === "string") fs.writeSync(logFd, chunk);
        else fs.writeSync(logFd, Buffer.from(chunk as Uint8Array));
      } catch {
        // 로그 실패는 무시
      }
      const cb = typeof encoding === "function" ? encoding : done;
      if (typeof cb === "function") (cb as () => void)();
      return true;
    };
    process.stdout.write = write as typeof process.stdout.write;
    process.stderr.write = write as typeof process.stderr.write;
  } catch {
    // 로그 파일을 못 열면 출력은 원래대로 버려진다
  }
}

// 디버그 실행이 아니면 null — 부르는 쪽은 log?.(…) 로 쓴다
export function createDebugLog(debug: boolean): DebugLog {
  return debug ? (o) => void process.stdout.write(`${JSON.stringify(o)}\n`) : null;
}
