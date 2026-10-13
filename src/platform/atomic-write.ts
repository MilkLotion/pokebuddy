// 파일 하나를 원자적으로 쓴다 — 저장·설정·기록 파일이 같이 쓴다. Node 만 쓰고 Electron 을 모른다
//
// 쓰기는 tmp 에 쓰고 rename (옛 config.js 의 save 와 같은 방식) — 쓰다 죽어도 반쪽 파일이 남지 않는다.
// Windows 는 읽는 쪽이 파일을 열고 있으면 rename 이 EPERM/EBUSY 를 낸다 — 잠깐 뒤 다시 (확장 extension.js write 의 패턴).
//   기다림은 동기(Atomics.wait) — 부르는 쪽(tick·act)이 동기라 짧게 멈추는 쪽을 택했다. 최악 150ms, 그것도 Windows 충돌 때만
import fs from "node:fs";
import path from "node:path";

export const IO_RULES = {
  writeRetries: 3, // Windows 는 읽는 쪽이 열고 있으면 rename 이 막힌다 — 잠깐 뒤 다시
  writeRetryMs: 50,
} as const;

const errCode = (e: unknown): string | undefined => (e != null && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : undefined);

// 동기 대기 — 메인 스레드에서도 된다. setTimeout 을 쓰면 write 가 async 가 되어 부르는 쪽이 전부 번진다
export function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // 못 기다리면 바로 다시 시도한다
  }
}

// 파일 하나를 원자적으로 쓴다 — tmp + rename, 실패하면 잠깐 뒤 다시. 끝내 실패하면 false (조용히)
// 문자열·Buffer(암호화한 저장, src/save/crypt.ts)는 그대로, 그 밖은 JSON 으로 쓴다.
// mode 를 주면 tmp 를 그 권한으로 만든다 — rename 뒤 파일도 그 권한이다(평문 세션 파일 0600, src/online/session-storage.ts)
// beforeRename 을 주면 tmp 를 다 쓴 뒤 rename 직전에 부른다 — 저장이 자기 쓰기의 stamp 를 tmp 에서 잰다(rename 은 수정 시각·크기·파일 번호를 지킨다).
// rename 뒤에 재면 그 사이 다른 곳의 쓰기를 자기 것으로 볼 수 있다 (worklog/records/perf-refactor 2-1, G80 R1)
export function writeAtomic(file: string, data: unknown, { mode, beforeRename }: { mode?: number; beforeRename?: (tmp: string) => void } = {}): boolean {
  const text = typeof data === "string" || Buffer.isBuffer(data) ? data : `${JSON.stringify(data, null, 2)}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    return false;
  }
  const { writeRetries, writeRetryMs } = IO_RULES;
  for (let i = 0; i < writeRetries; i++) {
    try {
      fs.writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
      beforeRename?.(tmp);
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      const code = errCode(e);
      if (i === writeRetries - 1 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        try {
          fs.unlinkSync(tmp);
        } catch {
          // 이미 없다
        }
        return false;
      }
      sleepSync(writeRetryMs);
    }
  }
  return false;
}
