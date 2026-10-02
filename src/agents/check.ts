// CLI 훅 연결 점검 — 연결 탭의 가벼운 확인·`점검`·마지막 신호 (worklog/records/hook-check/record.md)
//
// 훅은 CLI 가 `node "<~/.claude/scripts/hooks/pokebuddy-state.cjs>" [--cli x]` 로 부른다. 설치본에는 Node.js 가 없으므로
// 사용자 PC 에 node 가 없으면 CLI 이벤트마다 훅이 실패하고 앱에 신호가 오지 않는다 — 그래서 node 를 먼저 찾는다.
//   node 찾기   앱 PATH → 흔한 설치 자리 → (mac·Linux) 로그인 셸. Finder 로 켠 mac 앱은 PATH 가 짧아 앱 PATH 만 보면 틀린다
//   마지막 신호 훅이 세션마다 쓰는 state/<세션>.json 의 at(초) 가운데 CLI 별 가장 늦은 값
//   점검        등록한 것과 같은 명령을 가짜 이벤트(SessionEnd — 무대가 움직이지 않는 대기 상태)로 한 번 돌리고, 기록이 생기는지 본다.
//               확인한 기록은 바로 지운다 — 무대가 따라가거나 마지막 신호에 섞이지 않게. 앱의 환경에서 돌리므로 CLI 의 환경과 다를 수 있다
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HookStateRead } from "../shared/hook-record";

export interface NodeInfo {
  path: string;
  version: string;
}
export type ProbeReason = "ok" | "node-missing" | "hook-missing" | "exit" | "no-record" | "timeout" | "spawn-failed";
export interface ProbeResult {
  ok: boolean;
  reason: ProbeReason;
  detail?: string; // exit — 종료 코드
}

const CHECK_RULES = {
  nodeCacheMs: 30_000, // 연결 탭을 열 때마다 셸을 띄우지 않게
  shellMs: 2_000, // 로그인 셸로 물을 때의 제한
  versionMs: 2_000,
  probeMs: 5_000, // 점검 한 번의 제한 — Windows 는 훅이 조상 프로세스를 PowerShell 로 읽어 수백 ms 걸린다
  session: "pokebuddy-check", // 점검 기록의 세션 이름 앞부분 — 훅이 영문·숫자·_- 만 남긴다
} as const;

const run = (file: string, args: string[], timeout: number): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, encoding: "utf8" }, (err, out) => resolve(err ? null : String(out).trim()));
  });

// 흔한 설치 자리 — 앱 PATH 에 없을 때 본다
function extraDirs(): string[] {
  const home = os.homedir();
  if (process.platform === "win32") {
    const env = process.env;
    return [
      env.NVM_SYMLINK,
      env.ProgramFiles && path.join(env.ProgramFiles, "nodejs"),
      env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"]!, "nodejs"),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "nodejs"),
      env.APPDATA && path.join(env.APPDATA, "npm"),
    ].filter((d): d is string => !!d);
  }
  const dirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", path.join(home, ".volta", "bin"), path.join(home, ".local", "bin")];
  // nvm — 버전 폴더가 여럿이면 이름이 가장 뒤인(대개 가장 새) 것
  try {
    const base = path.join(home, ".nvm", "versions", "node");
    const versions = fs.readdirSync(base).sort();
    const last = versions[versions.length - 1];
    if (last) dirs.push(path.join(base, last, "bin"));
  } catch {
    // nvm 없음
  }
  return dirs;
}

async function locateNode(): Promise<string | null> {
  const exe = process.platform === "win32" ? "node.exe" : "node";
  const onPath = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of [...onPath, ...extraDirs()]) {
    const file = path.join(dir, exe);
    if (fs.existsSync(file)) return file;
  }
  if (process.platform === "win32") return null;
  // 로그인 셸의 PATH — Homebrew·nvm 설정은 셸 설정 파일에만 있는 일이 많다
  const found = await run(process.env.SHELL || "/bin/zsh", ["-lc", "command -v node"], CHECK_RULES.shellMs);
  const line = found?.split("\n").pop()?.trim();
  return line && fs.existsSync(line) ? line : null;
}

let cached: { at: number; node: NodeInfo | null } | null = null;
// node 가 있는가 — 찾으면 경로와 버전. 30초 동안 결과를 쓴다(fresh 면 다시 찾는다: `다시 확인`)
export async function findNode(fresh = false): Promise<NodeInfo | null> {
  if (!fresh && cached && Date.now() - cached.at < CHECK_RULES.nodeCacheMs) return cached.node;
  const file = await locateNode();
  const version = file ? await run(file, ["--version"], CHECK_RULES.versionMs) : null;
  const node = file && version ? { path: file, version } : null;
  cached = { at: Date.now(), node };
  return node;
}

// CLI 별 마지막 신호 시각(ms) — 훅이 쓴 state/<세션>.json 의 at(초). 점검 기록은 세지 않는다
export function lastSignals(stateDir: string): Record<string, number> {
  const out: Record<string, number> = {};
  let names: string[] = [];
  try {
    names = fs.readdirSync(stateDir).filter((n) => n.endsWith(".json") && !n.startsWith(CHECK_RULES.session));
  } catch {
    return out;
  }
  for (const name of names) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(stateDir, name), "utf8")) as HookStateRead;
      const cli = typeof rec.cli === "string" ? rec.cli : "claude";
      if (typeof rec.at !== "number") continue;
      const ms = Math.round(rec.at * 1000);
      if (ms > (out[cli] ?? 0)) out[cli] = ms;
    } catch {
      // 쓰는 중이거나 깨진 파일 — 건너뛴다
    }
  }
  return out;
}

// 점검 — command 는 그 CLI 에 등록하는 것과 같은 명령, hookFile 은 그 명령이 부르는 훅 파일
export async function probe(cli: string, command: string, hookFile: string, node: NodeInfo | null, stateDir: string): Promise<ProbeResult> {
  if (!node) return { ok: false, reason: "node-missing" };
  if (!fs.existsSync(hookFile)) return { ok: false, reason: "hook-missing" };
  const session = `${CHECK_RULES.session}-${Date.now()}`;
  const record = path.join(stateDir, `${session}.json`);
  // 찾은 node 의 폴더를 PATH 앞에 둔다 — 앱 PATH 에 없던 node 도 명령의 `node` 로 불린다
  const env = { ...process.env, PATH: `${path.dirname(node.path)}${path.delimiter}${process.env.PATH ?? ""}` };
  const exit = await new Promise<{ code: number | null; timedOut: boolean; failed: boolean }>((resolve) => {
    let child;
    try {
      child = spawn(command, { shell: true, env, windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      resolve({ code: null, timedOut: false, failed: true });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, timedOut: true, failed: false });
    }, CHECK_RULES.probeMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, timedOut: false, failed: true });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false, failed: false });
    });
    child.stdin?.end(JSON.stringify({ hook_event_name: "SessionEnd", session_id: session, cwd: "" }));
  });
  let wrote = false;
  try {
    const rec = JSON.parse(fs.readFileSync(record, "utf8")) as HookStateRead;
    wrote = rec.cli === cli;
  } catch {
    wrote = false;
  }
  fs.rmSync(record, { force: true });
  if (wrote) return { ok: true, reason: "ok" };
  if (exit.failed) return { ok: false, reason: "spawn-failed" };
  if (exit.timedOut) return { ok: false, reason: "timeout" };
  if (exit.code !== 0) return { ok: false, reason: "exit", detail: String(exit.code) };
  return { ok: false, reason: "no-record" };
}
