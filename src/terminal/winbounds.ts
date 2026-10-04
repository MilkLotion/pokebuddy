// 앵커 앱의 창 위치를 읽는 헬퍼(helpers/winbounds) 를 고르고 묻고 답을 푼다 — Electron 을 모른다.
// main.js 의 helperCommand · queryHelper · 출력 JSON 파싱을 옮긴 것. 좌표는 헬퍼가 준 그대로 넘긴다.
// Space 전환 표본 버리기(offScreen)는 Electron 의 screen 이 필요해 메인에 남는다.
//
// 헬퍼 출력 (helpers/winbounds.swift · winbounds.ps1 머리 참고):
//   {"frontmost":"Code","frontPid":2108,"frontId":123456,"windows":[{"app":"Code","pid":2108,"id":12345,"x":0,"y":30,"w":2560,"h":1324}]}
//   frontPid 는 mac, frontId 는 Windows 만 준다. windows 는 전역 z-order(앞→뒤) 전체 — 앵커 판정에는 앵커 앱 창만 쓰고,
//   가림 판정에는 전체가 필요하다
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createLineHelper } from "./line-helper";
import type { HelperCommand, HelperInfo, HelperReply, HelperWindow, LineHelper, LineHelperOptions } from "./types";

const HELPER_TIMEOUT_MS = 2000; // 답 한 번을 기다리는 시간
const HELPER_START_TIMEOUT_MS = 20000; // 막 띄운 serve 헬퍼의 첫 답 — PowerShell 기동·C# 컴파일이 낀다

// 헬퍼 실행 명령 — mac 은 컴파일된 Swift, Windows 는 PowerShell. 그 밖의 플랫폼·파일 없음이면 null (추적 수단 없음)
// env.POKEBUDDY_WINBOUNDS 로 다른 실행 파일을 가리킬 수 있다 (테스트가 실제 헬퍼를 건드리지 않도록)
// serve 면 한 번 띄워 두고 한 줄씩 묻는다 (line-helper.ts). 목록은 늘 전체로 받는다
export function helperCommand(platform: NodeJS.Platform, projectDir: string, env: NodeJS.ProcessEnv = process.env): HelperCommand | null {
  const args: string[] = [];
  const override = env.POKEBUDDY_WINBOUNDS;
  if (override) return fs.existsSync(override) ? { cmd: override, args } : null;
  if (platform === "darwin") {
    const bin = path.join(projectDir, "helpers", "winbounds");
    return fs.existsSync(bin) ? { cmd: bin, args } : null;
  }
  if (platform === "win32") {
    const ps1 = path.join(projectDir, "helpers", "winbounds.ps1");
    return fs.existsSync(ps1)
      ? { cmd: "powershell", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Serve", ...args], serve: true }
      : null;
  }
  return null;
}

// serve 헬퍼는 하나만 띄워 두고 재사용한다 (옛 main.js servedHelper). 끝낼 때 stopHelper 로 멈춘다 —
// "끝내는 중에는 묻지 않는다" 판정(quitting)은 부르는 쪽(메인)이 한다: before-quit 에서 멈춘 헬퍼를
// 다음 질문이 다시 띄우면 펫보다 오래 남는다
let servedHelper: LineHelper | null = null;

// 헬퍼에게 창 목록을 한 번 묻는다 — cb(err, stdout). stdout 은 JSON 한 줄 (parseInfo 로 푼다)
export function queryHelper(
  helper: HelperCommand,
  cb: HelperReply,
  { timeoutMs = HELPER_TIMEOUT_MS, startTimeoutMs = HELPER_START_TIMEOUT_MS }: LineHelperOptions = {},
): void {
  if (!helper.serve) {
    execFile(helper.cmd, helper.args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => cb(err, stdout));
    return;
  }
  if (!servedHelper) servedHelper = createLineHelper(helper.cmd, helper.args, { timeoutMs, startTimeoutMs });
  servedHelper.query(cb);
}

// 띄워 둔 serve 헬퍼를 멈춘다 — before-quit 에서. 없으면 아무 일도 없다
export function stopHelper(): void {
  const h = servedHelper;
  servedHelper = null;
  h?.stop();
}

// 헬퍼 출력 → HelperInfo. JSON 이 아니면 null (쓰는 중 잘린 줄 등 — 그 표본은 버린다)
// windows 는 id 가 숫자인 항목만 남긴다 (옛 main.js 의 필터 그대로). 좌표는 헬퍼가 준 그대로 — Windows 는 물리 픽셀
export function parseInfo(stdout: string | null | undefined): HelperInfo | null {
  let raw: unknown;
  try {
    raw = JSON.parse(String(stdout ?? ""));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const info = raw as Partial<HelperInfo> & { windows?: unknown };
  const list = Array.isArray(info.windows) ? (info.windows as unknown[]) : [];
  const windows = list.filter((w): w is HelperWindow => !!w && typeof (w as HelperWindow).id === "number");
  return { ...info, windows };
}
