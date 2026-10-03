// 실기 확인 전용 — 진짜 저장(~/.claude/pokebuddy)과 떨어진 시험용 HOME 에서 동반자를 띄우고, 확인할 장면에 맞게 저장을 고친다
//   node dist/tools/dev/dev-test.js start [--fresh]     시험용 HOME 으로 동반자 실행 (--fresh 면 HOME 을 비우고 첫 포켓몬 선택부터)
//   node dist/tools/dev/dev-test.js stop                시험 동반자 종료 — companion.lock 을 지우면 스스로 저장하고 끝난다
//   node dist/tools/dev/dev-test.js scene <장면>        저장을 그 장면으로 고친다 — 앱이 꺼져 있어야 한다(저장은 앱 하나만 쓴다)
//   node dist/tools/dev/dev-test.js show                저장 요약
// 시험 계정 — 명령 끝에 --account 를 붙이면 임시 폴더 대신 시험 계정의 HOME(저장소의 .claude/dev-account)을 쓴다. `npm run dev:account` 가 이 계정으로 띄운다.
//   운영 서버의 익명 계정 하나를 계속 쓴다. 세션이 이 HOME 에 있어 --fresh 는 받지 않는다. start 는 떠 있으면 내렸다가 다시 띄운다
//   저장을 고친 뒤에는 서버 저장도 같이 바꾼다 — 로컬만 고치면 서버 검증이 위반으로 적는다(src/verify/save-rules.ts):
//     node --env-file=admin/.env.local admin/admin.cjs save put --home <시험 계정 HOME> --yes   (admin/README.md)
// 시험용 HOME 은 POKEBUDDY_TEST_HOME, 없으면 저장소의 .claude/test-home/default (2026-10-03 사용자 결정 — 시험 폴더는 저장소의 .claude 아래에 둔다). 앱은 이 파일이 든 저장소(dist 빌드)를 띄운다.
// 저장소의 `electron .` 은 로그인 시 시작을 등록하지 않는다(src/main/app.ts syncLoginItem). 절차는 docs/contributing/development.md "시험용 HOME 에서 실기 확인"
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as store from "../../save/store";
import { empty } from "../../save/v3";
import { PARTY_RULES } from "../../party/rules";
import { TUTORIALS } from "../../tutorial/conditions";
import { applyScene, SCENES } from "../harness/scenes";

// 장면(SCENES·applyScene)은 공용 틀 src/tools/harness/scenes.ts 에 있다
const DEV_TEST_RULES = {
  stopWaitMs: 10000,
};

const PROJECT = path.resolve(__dirname, "..", "..", "..");
export const testHome = (): string => path.resolve(process.env.POKEBUDDY_TEST_HOME || path.join(PROJECT, ".claude", "test-home", "default"));
// 시험 계정의 HOME — 저장소의 .claude/dev-account (2026-10-03 사용자 결정 "여기 .claude에 정리"). .claude/ 는 git 이 추적하지 않는다.
// 임시 폴더가 비워지면 익명 계정의 세션을 잃으므로 임시 폴더에는 두지 않는다.
// worktree 에서 돌릴 때는 POKEBUDDY_ACCOUNT_HOME 으로 저장소의 폴더를 준다 — 주지 않으면 그 worktree 아래를 본다
export const accountHome = (): string => path.resolve(process.env.POKEBUDDY_ACCOUNT_HOME || path.join(PROJECT, ".claude", "dev-account"));
const dataDir = (home: string): string => path.join(home, ".claude", "pokebuddy");
const saveFile = (home: string): string => path.join(dataDir(home), "save.json");

function alive(pid: number): boolean {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// 저장을 쓰는 프로세스가 살아 있는가 (src/save/writer.ts 의 save.lock)
export function running(home: string): boolean {
  try {
    return alive(Number(fs.readFileSync(path.join(dataDir(home), "save.lock"), "utf8").split("\n")[0]));
  } catch {
    return false;
  }
}

// ── 명령 ───────────────────────────────────────────────────────────────────────
async function start(home: string, fresh: boolean, restart: boolean): Promise<void> {
  if (running(home)) {
    if (!restart) throw new Error("시험 동반자가 이미 떠 있다 — stop 먼저");
    await stop(home);
    if (running(home)) throw new Error("시험 동반자를 내리지 못했다");
  }
  if (fresh) fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  // Windows: USERPROFILE 을 바꾸면 PowerShell 이 로컬 앱 데이터 폴더를 이 HOME 아래에서 찾는다. 폴더가 없으면 경로가 비어
  // 창 추적 헬퍼(helpers/winbounds.ps1)의 모듈 캐시가 작업 폴더(저장소)에 Microsoft/ 로 생긴다 — 미리 만들어 둔다
  if (process.platform === "win32") fs.mkdirSync(path.join(home, "AppData", "Local"), { recursive: true });
  const electron = require("electron") as unknown as string; // node 에서 require 하면 실행 파일 경로를 준다
  const child = spawn(electron, [PROJECT], {
    cwd: PROJECT,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, HOME: home, USERPROFILE: home, POKEBUDDY_SAVE_CRYPT: "off" }, // scene·show 가 저장을 직접 고치고 읽는다 — 평문
  });
  child.unref();
  process.stdout.write(`시작 pid=${child.pid} HOME=${home}\n`);
}

async function stop(home: string): Promise<void> {
  fs.rmSync(path.join(dataDir(home), "companion.lock"), { force: true });
  const until = Date.now() + DEV_TEST_RULES.stopWaitMs;
  while (running(home) && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
  process.stdout.write(running(home) ? "아직 떠 있다 — 트레이에서 끝내 주세요\n" : "끝남\n");
}

function scene(home: string, names: string[]): void {
  if (running(home)) throw new Error("시험 동반자가 떠 있다 — stop 한 뒤 장면을 바꾼다(앱이 저장을 덮어쓴다)");
  const file = saveFile(home);
  const now = Date.now();
  const save = store.read(file).state ?? empty(now);
  for (const name of names) applyScene(save, name, now);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!store.write(file, save)) throw new Error(`쓰지 못함: ${file}`);
  process.stdout.write(`${names.join(", ")} → ${file}\n`);
}

// 이 HOME 의 저장이 올라가는 계정 — cloud.json (src/online/cloud.ts). 계정 번호는 앞 8자만 보인다
function cloudLine(home: string): string {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dataDir(home), "cloud.json"), "utf8")) as { userId?: string | null; ownerKind?: string | null; syncedRev?: number; dirty?: boolean };
    return c.userId ? `계정 ${c.ownerKind ?? "?"} ${c.userId.slice(0, 8)}… 서버 rev ${c.syncedRev ?? 0}${c.dirty ? " (올리지 않은 변경 있음)" : ""}` : "계정 없음";
  } catch {
    return "계정 없음 — 온라인으로 한 번 띄우면 익명 계정이 생긴다";
  }
}

function show(home: string): void {
  const save = store.read(saveFile(home), { repair: false }).state;
  if (!save) {
    process.stdout.write(`저장 없음 (HOME=${home}) — 다음 실행은 첫 포켓몬 선택부터\n`);
    return;
  }
  const lines = [
    `HOME=${home} 실행 중=${running(home)}`,
    cloudLine(home),
    `포인트 ${save.points.balance}`,
    `개체 ${save.pets.map((p) => `${p.id}:${p.species}`).join(" ")}`,
    `알 ${save.eggs.map((e) => `${e.id}:${e.kind}${e.ready ? "(준비)" : ""}`).join(" ") || "-"}`,
    `튜토리얼 ${TUTORIALS.map((t) => `${t.id}=${save.tutorials[t.id]?.state ?? "-"}${save.tutorials[t.id]?.queuedAt ? "(대기)" : ""}`).join(" ")}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

const USAGE = [
  "사용법: node dist/tools/dev/dev-test.js start [--fresh] | stop | show | scene <장면>[,<장면>…]   (끝에 --account 를 붙이면 시험 계정 HOME)",
  "장면:",
  ...Object.entries(SCENES).map(([name, s]) => `  ${name.padEnd(12)} ${s.note}`),
  `시작 포인트는 첫 포켓몬 선택 때 ${PARTY_RULES.startPoints}`,
].join("\n");

async function main(argv: string[]): Promise<void> {
  const account = argv.includes("--account");
  const home = account ? accountHome() : testHome();
  const [cmd, arg] = argv.filter((a) => !a.startsWith("--"));
  if (account && argv.includes("--fresh")) throw new Error("시험 계정 HOME 은 비우지 않는다 — 익명 계정의 세션이 들어 있다");
  if (cmd === "start") await start(home, argv.includes("--fresh"), account);
  else if (cmd === "stop") await stop(home);
  else if (cmd === "show") show(home);
  else if (cmd === "scene" && arg) scene(home, arg.split(","));
  else {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
  }
}

if (require.main === module)
  main(process.argv.slice(2)).catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
