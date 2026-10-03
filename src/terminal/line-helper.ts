// 한 번 띄워 두고 줄 단위로 묻는 헬퍼 프로세스 — 빈 줄 하나를 보내면 답 한 줄이 온다.
// 쓰는 곳: Windows 창 추적 헬퍼 (helpers/winbounds.ps1 -Serve)
// lib/line-helper.js 를 타입만 붙여 옮긴 것 — 동작은 그대로
//
// 폴링마다 새로 띄우면 PowerShell 기동·C# 컴파일에 수백 ms~수 초가 든다. 느린 컴퓨터에서는 타임아웃이 연달아 나
// "헬퍼 응답 없음 → 펫 숨김" 으로 빠지고, 답을 기다리는 사이 다음 폴링이 또 PowerShell 을 띄워 쌓인다.
// 헬퍼는 표준입력이 닫히면 스스로 끝나야 한다 — 그래야 펫이 강제 종료돼도 남지 않는다.
// Electron 을 모르는 코드라 Node 만으로 시험할 수 있다
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { LineHelper, LineHelperOptions } from "./types";

const MAX_RETRY_MS = 60_000;
const FIRST_RETRY_MS = 2000;

interface Pending {
  cb: (err: Error | null, line?: string) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface Proc {
  child: ChildProcessByStdio<Writable, Readable, null>;
  buf: string;
  ready: boolean; // 답 한 줄을 받은 적이 있다 — 그 뒤 타임아웃은 기동 실패로 세지 않는다
  pending: Pending | null;
}

// timeoutMs      답 한 줄을 기다리는 시간
// startTimeoutMs 막 띄운 헬퍼의 첫 답 — 기동·컴파일이 끼어 훨씬 오래 걸린다
export function createLineHelper(cmd: string, args: string[], { timeoutMs = 2000, startTimeoutMs = 20000 }: LineHelperOptions = {}): LineHelper {
  let proc: Proc | null = null;
  // 답 한 줄 못 하고 끝난 횟수 — 헬퍼가 망가졌으면(컴파일 실패 등) 폴링마다 다시 띄우지 않게 간격을 벌린다
  let failures = 0;
  let retryAt = 0;

  const settle = (p: Proc, err: Error | null, line?: string): void => {
    const q = p.pending;
    if (!q) return;
    p.pending = null;
    clearTimeout(q.timer);
    q.cb(err, line);
  };

  const ended = (p: Proc): void => {
    if (p.ready) return;
    failures += 1;
    retryAt = Date.now() + Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (failures - 1));
  };

  const stop = (): void => {
    const p = proc;
    if (!p) return;
    proc = null;
    ended(p);
    try {
      p.child.kill();
    } catch {
      // 이미 끝남
    }
    settle(p, new Error("헬퍼 중단"));
  };

  const start = (): Proc => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    const p: Proc = { child, buf: "", ready: false, pending: null };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      p.buf += chunk;
      for (let nl = p.buf.indexOf("\n"); nl >= 0; nl = p.buf.indexOf("\n")) {
        const line = p.buf.slice(0, nl);
        p.buf = p.buf.slice(nl + 1);
        p.ready = true;
        failures = 0;
        settle(p, null, line);
      }
    });
    const gone = (): void => {
      if (proc !== p) return; // stop 이 이미 정리했다
      proc = null;
      ended(p);
      settle(p, new Error("헬퍼가 끝남"));
    };
    child.on("error", gone);
    child.on("exit", gone);
    child.stdin.on("error", () => {}); // 헬퍼가 먼저 끝나면 쓰기가 EPIPE 를 낸다 — exit 에서 처리한다
    return p;
  };

  return {
    // 답이 오면 cb(null, 한 줄), 실패하면 cb(err). 앞 질문의 답을 기다리는 중이면 겹쳐 묻지 않는다 (cb 를 부르지 않음)
    query(cb) {
      if (proc && proc.pending) return;
      if (!proc && Date.now() < retryAt) {
        cb(new Error("헬퍼 재시도 대기"));
        return;
      }
      if (!proc) proc = start();
      const p = proc;
      // 늦게 온 답이 다음 질문의 답으로 섞이지 않게, 시간을 넘기면 헬퍼를 통째로 버리고 다음에 새로 띄운다
      const timer = setTimeout(stop, p.ready ? timeoutMs : startTimeoutMs);
      p.pending = { cb, timer };
      p.child.stdin.write("\n");
    },
    stop,
  };
}
