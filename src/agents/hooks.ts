// 훅 등록 — CLI(claude·gemini·codex) 설정 파일에 상태 훅을 등록·해제하고, 훅 파일(~/.claude/scripts/hooks/pokebuddy-state.cjs)을 최신으로 둔다.
// 등록 상태 진단(hookInstalled)과 켤 때 정리(tidyInstalled)도 여기 있다
// (예전 cli/setup.js 의 훅 등록 부분. 도구 레인 T7b-3 에서 옮겼다 — 설정창 연결(src/agents/registry.ts)과 pokebuddy setup·status 가 같이 쓴다)
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PATHS } from "../platform/paths";
import { AGENTS, type AgentName } from "../shared/names/agents";
import type { ConnectResult, DisconnectResult, TidyResult } from "./registry"; // 결과 모양의 원본은 registry(설정창 연결이 쓴다)

// 설정 파일 JSON 의 최소 모양 — 우리가 읽고 고치는 필드만 적는다. 나머지는 그대로 둔다
interface HookEntry {
  command?: unknown;
  [k: string]: unknown;
}
interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
  [k: string]: unknown;
}
interface SettingsData {
  hooks?: Record<string, HookGroup[]>;
  hooksConfig?: { enabled?: unknown };
  [k: string]: unknown;
}

// 훅을 등록할 CLI 하나 — 아래 TARGETS 설명
interface Target {
  cli: string;
  name: string;
  dir: () => string;
  file: string;
  always?: boolean;
  events: Record<string, string | undefined>;
  handler: (command: string) => HookEntry;
}

// 읽기 실패 문구 — 빈 문자열이 될 수 없는 모양이라 `if (read.error)` 로 성공 쪽(data 있음)이 좁혀진다
type SettingsReadError = `${string} 을(를) 다룰 수 없음 (${string}) — 손대지 않고 멈춘다`;
type ReadResult = { data: SettingsData; existed: boolean; error?: undefined } | { error: SettingsReadError; data?: undefined; existed?: undefined };
type WriteResult = { backup: string | null; error?: undefined } | { error: string; backup?: undefined };

interface HookSource {
  ready: boolean;
  built?: boolean;
  willBuild?: boolean;
  note?: string;
}

interface RegisterResult {
  skipped?: string;
  error?: string;
  changed?: boolean;
  what?: string[];
  legacy?: string[];
  stale?: string[];
  added?: string[];
  fixed?: string[];
  wrote?: boolean;
  backup?: string | null;
  notes?: string[];
}

interface UnregisterResult {
  skipped?: string;
  error?: string;
  removed: string[];
  wrote?: boolean;
  backup?: string | null;
}

interface CleanLegacyResult {
  skipped?: boolean;
  error?: string;
  removed: string[];
  wrote?: boolean;
  backup?: string | null;
}

interface HookInstalledCli {
  name: string;
  used: boolean;
  error?: string;
  registered?: number;
  total?: number;
  stale?: string[];
}

interface DryRunOptions {
  dryRun?: boolean;
}

// 프로젝트 뿌리 — 산출물이 dist/agents 에 있어 두 칸 위
const PROJECT = path.join(__dirname, "..", "..");
const HOOK_NAME = "pokebuddy-state.cjs";
// 훅 원본은 TS 빌드 산출물 (src/hooks/pokebuddy-state.ts → dist/). 목적지 이름은 .cjs — 내용이 CJS 라 그대로 돈다
export const HOOK_SOURCE = path.join(PROJECT, "dist", "hooks", "pokebuddy-state.js");
// 옛 이름(termimon·pkmon) 시절에 설치한 훅 — setup 이 새 이름으로 바꾸고, uninstall 이 함께 지운다
const LEGACY_HOOK_NAMES = ["termimon-state.cjs", "pkmon-state.cjs"];

// Claude Code 는 CLAUDE_CONFIG_DIR 로 설정 폴더를 옮길 수 있다
const claudeDir = (): string => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
export const hookTarget = (): string => path.join(claudeDir(), "scripts", "hooks", HOOK_NAME);
export const legacyHookTargets = (): string[] => LEGACY_HOOK_NAMES.map((name) => path.join(claudeDir(), "scripts", "hooks", name));

// 훅을 등록할 CLI — 설정 파일 모양이 셋 다 { hooks: { 이벤트: [{ matcher?, hooks: [{ type: "command", command, … }] }] } } 다.
//   events   이벤트 → matcher (undefined 면 넣지 않는다 — 모든 경우에 맞는다)
//   handler  우리 훅 한 항목. 타임아웃 단위가 CLI 마다 다르다 (claude·codex 초, gemini ms)
//   always   설정 폴더가 없어도 등록한다 — 펫 데이터가 ~/.claude 아래라 claude 만
// 표시 이름의 원본은 src/shared/names/agents.ts 다 — 연결 상태(hookInstalled 의 clis[].name)와 연결 탭이 같은 글자를 쓴다
const labelOf = (cli: AgentName): string => AGENTS.find((a) => a.name === cli)?.label ?? cli;

export const TARGETS: Target[] = [
  {
    cli: "claude",
    name: labelOf("claude"),
    dir: claudeDir,
    file: "settings.json",
    always: true,
    events: {
      SessionStart: undefined,
      UserPromptSubmit: "",
      PreToolUse: ".*",
      PermissionRequest: ".*",
      // 승인한 도구가 끝나면 작업 중으로 돌아간다 — 없으면 긴 명령이 도는 내내 기다리는 것처럼 보인다
      PostToolUse: ".*",
      PostToolUseFailure: ".*",
      Stop: undefined,
      StopFailure: undefined,
    },
    // claude 는 async 훅을 기다리지 않는다
    handler: (command) => ({ type: "command", command, async: true, timeout: 5 }),
  },
  {
    cli: "gemini",
    name: labelOf("gemini"),
    dir: () => path.join(os.homedir(), ".gemini"),
    file: "settings.json",
    // gemini 는 훅을 모두 기다린다(async 없음) — 도구 전·모델 호출처럼 잦은 이벤트는 빼고 상태가 바뀌는 곳만.
    // 승인 대기는 Notification(ToolPermission), 승인 뒤 작업으로 돌아가는 건 AfterTool 이 알린다
    events: {
      SessionStart: undefined,
      BeforeAgent: undefined,
      Notification: undefined,
      AfterTool: undefined,
      AfterAgent: undefined,
      SessionEnd: undefined,
    },
    handler: (command) => ({ name: "pokebuddy-state", type: "command", command, timeout: 5000 }),
  },
  {
    cli: "codex",
    name: labelOf("codex"),
    dir: () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    file: "hooks.json",
    // 훅은 codex 0.124 부터 (Interrupt 0.150 · SessionEnd 0.145). 옛 버전은 모르는 이벤트 이름을 무시한다.
    // async 는 넣지 않는다 — 0.148 전에는 async 훅을 "지원 안 함"으로 통째로 건너뛴다
    // PreToolUse 는 넣지 않는다 — codex 에서는 running 을 다시 알릴 뿐인데 도구마다 한 번 더 돈다.
    // Windows codex 데몬은 훅을 부를 때마다 콘솔 창을 띄운다(openai/codex#44768) — 도구당 실행을 반으로 줄인다 (2026-09-28 사용자 결정).
    // 옛 등록에 남은 PreToolUse 는 연결 탭 "갱신"(connectCli)이 걷는다
    events: {
      SessionStart: undefined,
      UserPromptSubmit: undefined,
      PermissionRequest: undefined,
      PostToolUse: undefined,
      Stop: undefined,
      Interrupt: undefined,
      SessionEnd: undefined,
    },
    handler: (command) => ({ type: "command", command, timeout: 5 }),
  },
];
const CODEX_HOOKS_SINCE = [0, 124, 0];

export const settingsFile = (target: Target): string => path.join(target.dir(), target.file);

export const isOurs = (hook: HookEntry | null | undefined): boolean => typeof hook?.command === "string" && hook.command.includes(HOOK_NAME);
export const isLegacy = (hook: HookEntry | null | undefined): boolean =>
  typeof hook?.command === "string" && LEGACY_HOOK_NAMES.some((name) => (hook.command as string).includes(name));

// 경로에 공백이 있어도(Windows 사용자 이름 등) 깨지지 않게 따옴표로 감싼다.
// claude 는 인자 없이 — 예전 등록과 같은 모양이라야 이미 등록됨으로 보인다
const hookCommand = (target: Target): string => `node "${hookTarget()}"${target.cli === "claude" ? "" : ` --cli ${target.cli}`}`;

// 설정 파일을 읽는다. 우리가 이해하지 못하는 모양이면 고치려 들지 않고 멈춘다 —
// 남의 설정 파일을 "알아서" 바로잡다가 사용자 훅을 날리는 것보다 멈추고 알리는 편이 낫다
export function readSettings(target: Target): ReadResult {
  const file = settingsFile(target);
  if (!fs.existsSync(file)) return { data: {}, existed: false };
  const stop = (why: string): ReadResult => ({ error: `${file} 을(를) 다룰 수 없음 (${why}) — 손대지 않고 멈춘다` });
  let data: unknown;
  try {
    // 윈도우 편집기가 붙이는 BOM 은 벗긴다
    const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    data = text.trim() ? JSON.parse(text) : {};
  } catch (e) {
    return stop((e as Error).message);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return stop("최상위가 객체가 아님");
  if ("hooks" in data) {
    if (!data.hooks || typeof data.hooks !== "object" || Array.isArray(data.hooks)) return stop("hooks 가 객체가 아님");
    for (const [event, groups] of Object.entries(data.hooks)) {
      if (!Array.isArray(groups)) return stop(`hooks.${event} 가 배열이 아님`);
    }
  }
  return { data: data as SettingsData, existed: true };
}

// 등록된 훅 명령이 가리키는 파일 — `node <경로>` · `node "<경로>"` (뒤에 --cli 인자) 모양일 때만.
// 그 밖(환경변수·플래그·래퍼)은 null
function hookPathOf(command: string): string | null {
  const m = command.trim().match(/^node\s+(?:"([^"]+)"|(\S+))(?:\s+--cli\s+\S+)?$/);
  if (!m) return null;
  const p = (m[1] || m[2]) as string;
  return p.replace(/^~(?=[\\/])/, os.homedir()).replace(/^\$HOME(?=[\\/])/, os.homedir());
}

// 훅 등록을 더한다 — 이미 우리 훅이 있는 이벤트는 그대로 둔다.
// 단 없는 파일을 가리키는 옛 등록(다른 경로에 설치했다 지운 경우)은 지금 경로로 고친다 — 두면 훅이 조용히 죽는다.
// 반환: { added: 더한 이벤트, fixed: 경로를 고친 이벤트 }
function addHooks(data: SettingsData, target: Target): { added: string[]; fixed: string[] } {
  const added: string[] = [];
  const fixed: string[] = [];
  if (!data.hooks) data.hooks = {}; // 모양 검사는 readSettings 가 했다
  for (const [event, matcher] of Object.entries(target.events)) {
    const groups = data.hooks[event] || [];
    const ours = groups.flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks.filter(isOurs) : []));
    if (ours.length) {
      for (const hook of ours) {
        const file = hookPathOf(hook.command as string); // isOurs 를 지났으니 문자열
        // 모양을 알아볼 수 있고 그 파일이 없을 때만 고친다 — 사용자가 감싼 명령은 그대로 둔다.
        // 지금 설치하는 자리는 setup 이 먼저 복사하므로 있는 것으로 본다 (미리 보기에서도 같은 판정이 나오게)
        if (file && path.resolve(file) !== path.resolve(hookTarget()) && !fs.existsSync(file)) {
          hook.command = hookCommand(target);
          if (!fixed.includes(event)) fixed.push(event);
        }
      }
      continue;
    }
    const group: HookGroup = { hooks: [target.handler(hookCommand(target))] };
    if (matcher !== undefined) group.matcher = matcher;
    data.hooks[event] = [...groups, group];
    added.push(event);
  }
  return { added, fixed };
}

// 우리 훅만 걷어낸다 — 같은 묶음에 남의 훅이 있으면 그건 남긴다. match 로 옛 이름 훅만 고를 수 있다.
// keepEvent 가 참인 이벤트는 건드리지 않는다 — 지금 목록에 없는 이벤트의 우리 등록만 걷을 때 쓴다
export function removeHooks(
  data: SettingsData,
  match: (hook: HookEntry) => boolean = isOurs,
  keepEvent: (event: string) => boolean = () => false,
): string[] {
  const removed: string[] = [];
  if (!data.hooks || typeof data.hooks !== "object") return removed;
  for (const [event, groups] of Object.entries(data.hooks)) {
    if (!Array.isArray(groups) || keepEvent(event)) continue;
    let touched = false;
    const kept: HookGroup[] = [];
    for (const g of groups) {
      if (!Array.isArray(g?.hooks) || !g.hooks.some(match)) {
        kept.push(g);
        continue;
      }
      touched = true;
      const rest = g.hooks.filter((h) => !match(h));
      if (rest.length) kept.push({ ...g, hooks: rest });
    }
    if (!touched) continue;
    removed.push(event);
    if (kept.length) data.hooks[event] = kept;
    else delete data.hooks[event];
  }
  if (data.hooks && !Object.keys(data.hooks).length) delete data.hooks;
  return removed;
}

// 지금 이벤트 목록에 없는데 우리 훅이 남아 있는 이벤트 — 옛 버전이 등록한 것(예: codex PreToolUse)
function staleEvents(data: SettingsData, target: Target): string[] {
  const hooks: Record<string, HookGroup[]> = data.hooks && typeof data.hooks === "object" ? data.hooks : {};
  return Object.keys(hooks).filter(
    (e) => !(e in target.events) && Array.isArray(hooks[e]) && hooks[e].some((g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs)),
  );
}

// 백업을 남기고 원자적으로 쓴다 — 쓰다 죽어도 반쪽 파일이 남지 않는다.
//   심링크(dotfiles 저장소로 관리)면 링크가 아니라 실제 파일을 바꾼다 — rename 은 링크를 일반 파일로 덮어쓴다
//   권한을 유지한다 — API 키가 들어 있을 수 있어 0600 인 파일을 0644 로 만들면 안 된다
// 실패하면 { error } — 백신이 파일을 잡고 있는 Windows 등
export function writeSettings(target: Target, data: SettingsData, existed: boolean): WriteResult {
  const link = settingsFile(target);
  try {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    const file = existed ? fs.realpathSync(link) : link;
    const mode = existed ? fs.statSync(file).mode & 0o777 : 0o600;
    let backup: string | null = null;
    if (existed) {
      backup = `${link}.pokebuddy-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.copyFileSync(file, backup);
    }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode });
    fs.chmodSync(tmp, mode); // umask 가 깎은 권한을 되돌린다
    fs.renameSync(tmp, file);
    return { backup };
  } catch (e) {
    try {
      for (const f of fs.readdirSync(path.dirname(link))) {
        if (f.endsWith(`.${process.pid}.tmp`)) fs.rmSync(path.join(path.dirname(link), f), { force: true }); // 쓰다 만 임시 파일
      }
    } catch {
      // 정리 실패는 무시
    }
    const err = e as NodeJS.ErrnoException;
    return { error: `${link} 에 쓰지 못함 (${err.code || err.message}) — 에디터·백신이 파일을 잡고 있으면 닫고 다시 실행` };
  }
}

// 훅 원본(dist/)이 있게 한다 — git clone 으로 받았으면 dist/ 가 없다 (빌드 산출물이라 저장소에 넣지 않는다. npm 배포본에는 prepack 이 넣는다).
// tsc 가 있으면(개발 의존성 설치됨) npm run build 를 돌린다. 미리 보기에서는 만들지 않고 예정으로만 둔다.
// 없는 원본을 등록하면 CLI 이벤트마다 없는 파일을 실행하게 되므로, 못 만들면 부르는 쪽이 훅 단계(파일·등록)를 건너뛴다
// 반환: { ready: true, built? } · { ready: false, willBuild: true } (미리 보기) · { ready: false, note } (못 만듦)
const TSC = path.join(PROJECT, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
export function ensureHookSource({ dryRun = false }: DryRunOptions = {}): HookSource {
  if (fs.existsSync(HOOK_SOURCE)) return { ready: true };
  if (!fs.existsSync(TSC)) return { ready: false, note: `${HOOK_SOURCE} 없음 — 빌드가 필요하다 (npm run build)` };
  if (dryRun) return { ready: false, willBuild: true };
  try {
    // npm 은 셸을 거쳐 찾는다 (Windows 의 npm.cmd). 출력은 버린다 — 실패는 파일 유무로 판정
    execSync("npm run build", { cwd: PROJECT, stdio: "ignore", timeout: 180_000, windowsHide: true });
  } catch {
    // 아래에서 파일 유무로 판정
  }
  if (fs.existsSync(HOOK_SOURCE)) return { ready: true, built: true };
  return { ready: false, note: "npm run build 가 실패 — 직접 돌려 오류를 확인한다" };
}

// CLI 하나에 훅을 등록한다 — setup 이 전부에, 설정창 "연결" 버튼이 하나에 쓴다. 출력하지 않고 결과만 돌려준다.
// 반환: { skipped } (CLI 를 안 씀) · { error, wrote:false } (설정 파일을 못 읽음) ·
//       { changed, what[], legacy[], added[], fixed[], wrote, backup?, error?, notes[] }
function registerTarget(t: Target, { dryRun = false }: DryRunOptions = {}): RegisterResult {
  if (!t.always && !fs.existsSync(t.dir())) return { skipped: `설치 안 됨 (${t.dir()} 없음) — 건너뜀` };
  const read = readSettings(t);
  if (read.error) return { error: read.error, wrote: false };
  // 옛 이름 등록은 걷고 새 훅으로 다시 등록한다 — 두면 옛 훅과 새 훅이 함께 돈다
  const legacy = removeHooks(read.data, isLegacy);
  // 목록에서 빠진 이벤트의 우리 등록을 걷는다 — 우리 명령만. 남의 훅은 그대로
  const stale = removeHooks(read.data, isOurs, (e) => e in t.events);
  const { added, fixed } = addHooks(read.data, t);
  const what = [
    legacy.length ? `옛 이름(termimon·pkmon) 훅 ${legacy.length}개 걷음${dryRun ? " 예정" : ""}` : "",
    stale.length ? `목록에 없는 이벤트 ${stale.length}개 걷음${dryRun ? " 예정" : ""}: ${stale.join(", ")}` : "",
    added.length ? `이벤트 ${added.length}개 추가${dryRun ? " 예정" : ""}: ${added.join(", ")}` : "",
    fixed.length ? `없는 경로를 가리키던 ${fixed.length}개 고침${dryRun ? " 예정" : ""}: ${fixed.join(", ")}` : "",
  ].filter(Boolean);
  const out: RegisterResult = { changed: what.length > 0, what, legacy, stale, added, fixed, wrote: false, notes: hookNotes(t, read.data, added.length > 0) };
  if (out.changed && !dryRun) {
    const wrote = writeSettings(t, read.data, read.existed);
    out.wrote = !wrote.error;
    if (wrote.error) out.error = wrote.error;
    else out.backup = wrote.backup;
  }
  return out;
}

// CLI 하나의 훅 등록을 걷는다 (옛 이름 등록도 함께). 반환: { skipped } · { error } · { removed[], wrote, backup? }
function unregisterTarget(t: Target, { dryRun = false }: DryRunOptions = {}): UnregisterResult {
  if (!fs.existsSync(settingsFile(t))) return { skipped: "설정 파일 없음", removed: [] };
  const read = readSettings(t);
  if (read.error) return { error: read.error, removed: [] };
  const removed = removeHooks(read.data, (h) => isOurs(h) || isLegacy(h));
  const out: UnregisterResult = { removed, wrote: false };
  if (removed.length && !dryRun) {
    const wrote = writeSettings(t, read.data, read.existed);
    out.wrote = !wrote.error;
    if (wrote.error) out.error = wrote.error;
    else out.backup = wrote.backup;
  }
  return out;
}

// CLI 하나의 옛 이름 훅 등록만 걷는다 — setup 이 쓴다. 우리 훅은 등록하지도 걷지도 않는다.
// 반환: { skipped } · { error, removed:[] } (설정 파일을 못 읽음) · { removed[], wrote, backup?, error? }
export function cleanLegacyTarget(t: Target, { dryRun = false }: DryRunOptions = {}): CleanLegacyResult {
  if (!fs.existsSync(settingsFile(t))) return { skipped: true, removed: [] };
  const read = readSettings(t);
  if (read.error) return { error: read.error, removed: [] };
  const removed = removeHooks(read.data, isLegacy);
  const out: CleanLegacyResult = { removed, wrote: false };
  if (removed.length && !dryRun) {
    const wrote = writeSettings(t, read.data, read.existed);
    out.wrote = !wrote.error;
    if (wrote.error) out.error = wrote.error;
    else out.backup = wrote.backup;
  }
  return out;
}

const targetOf = (cli: string): Target | null => TARGETS.find((t) => t.cli === cli) || null;

// 훅 파일을 최신으로 둔다 — 등록만 있고 파일이 없으면 CLI 이벤트마다 없는 파일을 실행한다.
// 반환: "최신" | "복사함" | "바꿈" | "빌드 뒤 복사 예정"(미리 보기, dist 없음) | null (원본을 만들 수 없다 — 부르는 쪽이 등록도 멈춘다)
function ensureHookFile({ dryRun = false }: DryRunOptions = {}): "최신" | "복사함" | "바꿈" | "빌드 뒤 복사 예정" | null {
  const source = ensureHookSource({ dryRun });
  if (!source.ready) return source.willBuild ? "빌드 뒤 복사 예정" : null;
  const target = hookTarget();
  const exists = fs.existsSync(target);
  const same = exists && fs.readFileSync(target).equals(fs.readFileSync(HOOK_SOURCE));
  if (same) return "최신";
  if (!dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(HOOK_SOURCE, target);
  }
  return exists ? "바꿈" : "복사함";
}

// 에이전트 연결 — 설정창 "연결" 탭의 버튼이 manage:agents 로 부른다 (src/agents/registry.ts connectAgent). 훅 파일을 두고 그 CLI 에 등록한다
export function connectCli(cli: string, { dryRun = false }: DryRunOptions = {}): ConnectResult {
  const t = targetOf(cli);
  if (!t) return { ok: false, reason: "unknown-cli" };
  if (!fs.existsSync(PATHS.home) && !dryRun) fs.mkdirSync(PATHS.home, { recursive: true }); // 훅은 이 폴더가 없으면 아무것도 안 한다
  const hookFile = ensureHookFile({ dryRun });
  // 훅 원본이 없으면 등록하지 않는다 — 없는 파일을 등록하면 CLI 이벤트마다 죽은 명령이 돈다. reason 은 ConnectResult(src/agents/registry.ts)의 것만
  if (hookFile === null) return { ok: false, reason: "settings-error", detail: `훅 파일을 만들 수 없음 — ${ensureHookSource({ dryRun }).note}`, hookFile: "없음" };
  const r = registerTarget(t, { dryRun });
  if (r.skipped) return { ok: false, reason: "not-installed", detail: r.skipped, hookFile };
  if (r.error && !r.wrote) return { ok: false, reason: "settings-error", detail: r.error, hookFile };
  return { ok: true, reason: "ok", changed: r.changed, added: r.added, fixed: r.fixed, stale: r.stale, backup: r.backup || null, notes: r.notes, hookFile, error: r.error || null };
}

// 에이전트 연결 해제 — 그 CLI 의 훅 등록만 걷는다. 훅 파일은 다른 CLI 가 쓰고 있을 수 있어 남긴다
export function disconnectCli(cli: string, { dryRun = false }: DryRunOptions = {}): DisconnectResult {
  const t = targetOf(cli);
  if (!t) return { ok: false, reason: "unknown-cli" };
  const r = unregisterTarget(t, { dryRun });
  if (r.skipped) return { ok: true, reason: "ok", removed: [], detail: r.skipped };
  if (r.error) return { ok: false, reason: "settings-error", detail: r.error, removed: r.removed };
  return { ok: true, reason: "ok", removed: r.removed, backup: r.backup || null };
}

// codex --version → [주, 부, 수]. 못 알아내면 null (설치 안 됨·PATH 밖)
function codexVersion(): number[] | null {
  try {
    // Windows 의 codex 는 npm 이 만든 codex.cmd 라 셸을 거쳐야 한다. 인자가 고정이라 셸에 넘겨도 안전하다
    const out = execSync("codex --version", { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    const m = out.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? m.slice(1).map(Number) : null;
  } catch {
    return null;
  }
}
// 세 자리 모두 있는 배열만 들어온다 (codexVersion 의 정규식 · 상수)
const olderThan = (a: number[], b: number[]): boolean =>
  ((a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number) || (a[2] as number) - (b[2] as number)) < 0;

// 등록은 됐지만 CLI 쪽 사정으로 안 돌 수 있는 경우를 알린다
function hookNotes(target: Target, data: SettingsData, added: boolean): string[] {
  const notes: string[] = [];
  if (target.cli === "gemini" && data.hooksConfig && data.hooksConfig.enabled === false) {
    notes.push("hooksConfig.enabled 가 false 라 gemini 훅이 꺼져 있다 — 상태에 반응하지 않는다");
  }
  if (target.cli === "codex") {
    const v = codexVersion();
    if (v && olderThan(v, CODEX_HOOKS_SINCE)) {
      notes.push(`codex ${v.join(".")} 에는 훅이 없다 — ${CODEX_HOOKS_SINCE.join(".")} 이상으로 올리면 상태에 반응한다 (npm i -g @openai/codex)`);
    } else if (v && added && !olderThan(v, [0, 129, 0])) {
      notes.push("codex 는 새 훅을 한 번 승인해야 돌린다 — codex 에서 /hooks");
    }
  }
  return notes;
}

// 진단용 — 훅 파일이 최신인가, CLI 마다 등록돼 있는가
// 반환: { file, current, clis: [{ name, used, error?, registered?, total?, stale? }] } — used 가 false 면 그 CLI 를 안 쓴다.
// stale 은 지금 목록에 없는데 우리 훅이 남은 이벤트 — 연결 탭 "갱신" 이 걷는다
export function hookInstalled(): { file: boolean; current: boolean; source: boolean; clis: HookInstalledCli[] } {
  const file = fs.existsSync(hookTarget());
  // 업데이트 뒤 훅 파일이 옛 버전인지 — 내용이 번들(dist/)과 다르면 pokebuddy setup 으로 바꿔야 한다. dist/ 가 없으면(빌드 전) 최신으로 볼 수 없다
  const current = file && fs.existsSync(HOOK_SOURCE) && fs.readFileSync(hookTarget()).equals(fs.readFileSync(HOOK_SOURCE));
  const clis = TARGETS.map((t): HookInstalledCli => {
    if (!t.always && !fs.existsSync(t.dir())) return { name: t.name, used: false };
    const read = readSettings(t);
    if (read.error) return { name: t.name, used: true, error: read.error };
    const hooks: Record<string, HookGroup[]> = read.data.hooks || {};
    const events = Object.keys(t.events);
    const registered = events.filter(
      (e) => Array.isArray(hooks[e]) && hooks[e].some((g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs)),
    ).length;
    return { name: t.name, used: true, registered, total: events.length, stale: staleEvents(read.data, t) };
  });
  // source — 비교할 원본(dist/)이 있는가. 없으면(개발 실행에서 빌드 전) 옛 버전인지 판정하지 않는다
  return { file, current, source: fs.existsSync(HOOK_SOURCE), clis };
}

// 앱이 켤 때 부르는 정리 — 새로 등록하지 않는다 (2026-09-28 사용자 결정 "기존 훅 사용자 자동 정리").
//   CLI 등록  우리 훅이 남은 설정 파일에서 지금 목록에 없는 우리 이벤트만 걷는다(예: 옛 codex PreToolUse). 남의 훅·백업 규칙 그대로. 걷을 게 없으면 쓰지 않는다
//   훅 파일   이미 있을 때만 원본과 다르면 새 버전으로 바꾼다. 없으면 만들지 않는다 — 연결은 연결 탭 버튼으로만 한다
// 반환: { clis: [{ cli, removed[], backup?, error? }] (걷은 CLI 만), hookFile: "최신" | "바꿈" | "없음" | "원본 없음" | "실패", error? }
export function tidyInstalled({ dryRun = false }: DryRunOptions = {}): TidyResult {
  const clis: TidyResult["clis"] = [];
  for (const t of TARGETS) {
    if (!fs.existsSync(settingsFile(t))) continue;
    const read = readSettings(t);
    if (read.error) {
      clis.push({ cli: t.cli, removed: [], error: read.error });
      continue;
    }
    if (!staleEvents(read.data, t).length) continue;
    const removed = removeHooks(read.data, isOurs, (e) => e in t.events);
    const out: TidyResult["clis"][number] = { cli: t.cli, removed };
    if (!dryRun) {
      const wrote = writeSettings(t, read.data, read.existed);
      if (wrote.error) out.error = wrote.error;
      else out.backup = wrote.backup;
    }
    clis.push(out);
  }
  const target = hookTarget();
  if (!fs.existsSync(target)) return { clis, hookFile: "없음" };
  if (!fs.existsSync(HOOK_SOURCE)) return { clis, hookFile: "원본 없음" };
  if (fs.readFileSync(target).equals(fs.readFileSync(HOOK_SOURCE))) return { clis, hookFile: "최신" };
  try {
    if (!dryRun) fs.copyFileSync(HOOK_SOURCE, target);
    return { clis, hookFile: "바꿈" };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return { clis, hookFile: "실패", error: `${target} 에 쓰지 못함 (${err.code || err.message})` };
  }
}

// 연결 점검(src/agents/check.ts) — 그 CLI 에 등록하는 것과 같은 명령과 훅 파일 자리
export const hookCommandFor = (cli: string): string | null => {
  const t = targetOf(cli);
  return t ? hookCommand(t) : null;
};
