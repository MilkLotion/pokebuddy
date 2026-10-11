// 경로 — 하드코딩을 한 곳에 모은다. 메인·CLI·도구가 같이 쓴다
// (예전 config.js 의 PATHS. 도구 레인 T7b-1 에서 옮겼다. 사용자 설정 읽기는 ./user-config.ts)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { liveLockOwner } from "./pid-lock.js";

export interface Paths {
  project: string;
  config: string;
  legacyConfig: string;
  legacyHomes: string[];
  lastError: string; // 펫이 못 떴을 때의 이유 — 펫 출력은 버려지므로 여기 남긴다
  electronData: string;
  home: string;
  claudeHome: string; // 옛 자리(<홈>/.claude/pokebuddy) — 옮기지 못했으면 home 과 같다. uninstall --purge 가 남은 것을 지운다
  state: string; // 훅이 세션 상태를 적는 곳
  pmd: string; // PMD 스프라이트 묶음 캐시
  overworld: string; // 걷기 대체 그림 캐시 (src/main/art/overworld-art.ts)
  companionLock: string; // 동반자 — 기기당 하나
  legacyCli: string; // 옛 VS Code 확장의 실행 경로 기록 — setup 이 지운다
  legacyWindows: string; // 옛 VS Code 확장의 창 기록 폴더 — setup 이 지운다
  save: string; // 저장 (src/save/save-file.ts). 옛 v1·v2 파일은 처음 열 때 v3 로 옮긴다
  saveLock: string; // 저장을 쓰는 프로세스의 pid (./pid-lock.ts, 잡는 쪽은 src/save/save-watch.ts)
  mailbox: string; // 명령 통로 (src/save/command-channel.ts)
}

// 프로젝트 뿌리 — dist/platform 에서 두 칸 위(예전 config.js 의 __dirname 과 같은 폴더)
const PROJECT_DIR = path.join(__dirname, "..", "..");
// 업데이트 실기 시험 빌드(scripts/build-exe.cjs PB_UPDATE_TEST)만 표시 파일의 임시 홈을 쓴다.
// 업데이트 설치 파일이 앱을 다시 켤 때는 시험의 환경 변수를 물려받지 않아 사용자의 홈으로 켜진다(2026-09-28 실기에서 확인)
function updateTestHome(): string | null {
  try {
    const home: unknown = (JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "update-test.json"), "utf8")) as { home?: unknown }).home;
    return typeof home === "string" && path.isAbsolute(home) ? home : null;
  } catch {
    return null; // 보통 빌드 — 표시 파일이 없다
  }
}
const USER_HOME = updateTestHome() ?? os.homedir();

// ── 데이터 폴더 ───────────────────────────────────────────────────────────────
// OS 의 앱 데이터 자리. 0.19.5 까지는 <홈>/.claude/pokebuddy 였다 (worklog/records/data-home/data-home.md)
// 홈에서 계산한다 — APPDATA 를 보면 HOME·USERPROFILE 만 바꾼 자체 시험이 사용자의 진짜 폴더에 쓴다
export function dataHomeOf(userHome: string, platform: NodeJS.Platform | string = process.platform): string {
  if (platform === "win32") return path.join(userHome, "AppData", "Roaming", "pokebuddy");
  if (platform === "darwin") return path.join(userHome, "Library", "Application Support", "pokebuddy");
  return path.join(userHome, ".config", "pokebuddy");
}
// 옛 자리 — 새 자리가 없을 때만 본다
export const claudeDataHomeOf = (userHome: string): string => path.join(userHome, ".claude", "pokebuddy");

// 폴더에 무언가 있나 — 빈 새 자리는 없는 것으로 본다. 무엇이 빈 폴더를 먼저 만들어도 옛 자리를 버리지 않게
function hasEntries(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

// 지금 쓰는 데이터 폴더 — 옮기지 않고 찾기만 한다. 새 자리가 비었고 옛 자리에 무언가 있으면 옛 자리. 시험·개발 도구가 쓴다
export function findDataHome(userHome: string, platform: NodeJS.Platform | string = process.platform, used: (dir: string) => boolean = hasEntries): string {
  const next = dataHomeOf(userHome, platform);
  const old = claudeDataHomeOf(userHome);
  return !used(next) && used(old) ? old : next;
}

export interface DataHomeOptions {
  userHome: string;
  platform?: NodeJS.Platform | string;
  migrate: boolean; // 옛 자리를 옮겨도 되는 프로세스인가 — 앱 메인만
  busy?: (oldHome: string) => boolean; // 옛 자리를 쓰는 프로세스가 떠 있다
  used?: (dir: string) => boolean; // 폴더에 무언가 있다 — 자체 시험은 가짜를 넘긴다
  move?: (from: string, to: string) => void;
}

// 데이터 폴더를 정한다. 옛 자리만 있으면 통째로 옮긴다 — save.key 와 electron/Local State(Windows 저장 키)가 같이 움직여야 저장을 푼다.
// 옮기지 못하면(떠 있는 옛 앱·EPERM·EXDEV) 이번 실행은 옛 자리를 쓰고 다음 실행에 다시 옮긴다
export function pickDataHome(o: DataHomeOptions): string {
  const used = o.used ?? hasEntries;
  const next = dataHomeOf(o.userHome, o.platform);
  const old = claudeDataHomeOf(o.userHome);
  if (used(next) || !used(old)) return next;
  if (!o.migrate || o.busy?.(old)) return old;
  try {
    (o.move ?? moveDir)(old, next);
    return next;
  } catch {
    // 동시에 뜬 다른 프로세스가 먼저 옮겼으면 새 자리에 있다
    return used(next) || !used(old) ? next : old;
  }
}

// 폴더 하나를 이름 바꾸기로 옮긴다. 빈 새 자리가 있으면 먼저 지운다 — Windows 는 있는 폴더 자리로 이름을 바꾸지 못한다
function moveDir(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) fs.rmdirSync(to); // 비었을 때만 지워진다 — 무언가 있으면 예외로 멈춘다
  fs.renameSync(from, to);
}

// 옛 자리의 잠금 pid 가 살아 있나 — 동반자(companion.lock)·저장 writer(save.lock).
// mac 은 열린 파일이 있어도 이름 바꾸기가 성공한다. 떠 있는 옛 앱이 옛 자리에 계속 쓰면 판이 둘로 갈린다
export const oldHomeBusy = (oldHome: string): boolean =>
  ["companion.lock", "save.lock"].some((name) => liveLockOwner(path.join(oldHome, name)) !== null);

// 앱을 켠 Electron 메인인가 — src/main/app.ts 의 첫 import(src/main/app/main-mark.ts)가 남긴 표시를 본다.
// CLI·도구(node)와 Electron 으로 도는 시험 도구(src/tools/dev·smoke)는 옮기지 않는다 — 진짜 홈을 읽은 채 불러와도 사용자의 폴더를 옮기지 않게
const isAppMain = (): boolean =>
  (process as { type?: string }).type === "browser" && (globalThis as Record<symbol, unknown>)[Symbol.for("pokebuddy.appMain")] === true;

const POKEBUDDY_HOME = pickDataHome({ userHome: USER_HOME, migrate: isAppMain(), busy: oldHomeBusy });

export const PATHS: Paths = {
  project: PROJECT_DIR,
  // 사용자 설정은 홈에 둔다. 프로그램 폴더 안에 두면 npm 으로 업데이트할 때마다 지워지고,
  // Node 버전 관리자(nvm)로 버전을 바꾸면 설정이 따로 논다
  config: path.join(POKEBUDDY_HOME, "config.json"),
  legacyConfig: path.join(PROJECT_DIR, "pkmon.config.json"), // 예전 위치 — 처음 읽을 때 한 번 가져온다
  // 옛 이름 시절의 데이터 폴더 — 최근 이름부터 (termimon ← pkmon). migrateLegacyHome
  legacyHomes: ["termimon", "pkmon"].map((name) => path.join(USER_HOME, ".claude", name)),
  lastError: path.join(POKEBUDDY_HOME, "last-error.json"),
  electronData: path.join(POKEBUDDY_HOME, "electron"), // Electron 캐시·세션 — uninstall --purge 로 같이 지워지게 홈 아래에
  home: POKEBUDDY_HOME,
  claudeHome: claudeDataHomeOf(USER_HOME),
  state: path.join(POKEBUDDY_HOME, "state"),
  pmd: path.join(POKEBUDDY_HOME, "pmd"), // CC BY-NC — 저장소엔 넣지 않는다
  overworld: path.join(POKEBUDDY_HOME, "overworld"), // pokeemerald-expansion, 저장소엔 넣지 않는다
  // 동반자(pokebuddy companion) — 기기당 하나. 내용은 `pid\nready`. 지우면 동반자가 스스로 끝난다.
  // CLI 는 이 파일의 pid 가 살아 있는지로 "동반자가 떠 있나"를 판정한다 (파일 존재가 아니라 pid 생존)
  companionLock: path.join(POKEBUDDY_HOME, "companion.lock"),
  // 옛 VS Code 확장이 쓰던 실행 경로 기록과 창 기록 폴더 — setup·uninstall 이 남아 있으면 지운다 (2026-09-27 창 모드 삭제)
  legacyCli: path.join(POKEBUDDY_HOME, "cli.json"),
  legacyWindows: path.join(POKEBUDDY_HOME, "windows"),
  // 저장 (src/save/) — 저장은 writer 프로세스 하나만 쓴다. 나머지는 mailbox 로 요청한다
  save: path.join(POKEBUDDY_HOME, "save.json"),
  saveLock: path.join(POKEBUDDY_HOME, "save.lock"),
  mailbox: path.join(POKEBUDDY_HOME, "mailbox"),
};
export const PROJECT: string = PATHS.project;


// ── 사용자 홈 아래 캐시 폴더 ───────────────────────────────────────────────────
// 받아 둔 그림(초상·도구·알)과 울음소리. 지우면 다시 받는다
export const spriteCacheDir = (home: string = PATHS.home): string => path.join(home, "sprites");
export const cryCacheDir = (home: string = PATHS.home): string => path.join(home, "cries");

// 앱 안 그림 폴더 — 설치본은 <앱>/sprites, 저장소 실행은 그 폴더가 없어 scripts 가 받아 둔 <앱>/.cache/sprites
export function bundledSpritesDir(project: string = PROJECT, exists: (file: string) => boolean = fs.existsSync): string {
  const packed = path.join(project, "sprites");
  return exists(packed) ? packed : path.join(project, ".cache", "sprites");
}

// ── 저장(save.json) 옆 파일 ───────────────────────────────────────────────────
// 게임 저장에 필드를 더하지 않고 같은 폴더에 따로 둔다. 자체 검사는 임시 저장 파일로 부른다
export const cloudFileOf = (saveFile: string): string => path.join(path.dirname(saveFile), "cloud.json"); // 클라우드 맞추기 상태 — 읽고 쓰기는 src/online/cloud-file.ts
export const noticesFileOf = (saveFile: string): string => path.join(path.dirname(saveFile), "notices.json"); // 한 번 띄운 안내 (src/agents/notice.ts)
export const notifyFileOf = (saveFile: string): string => path.join(path.dirname(saveFile), "notify.json"); // 알림 배너 줄 (src/notify/notifier.ts)
export const notesSeenFileOf = (saveFile: string): string => path.join(path.dirname(saveFile), "notes-seen.json"); // 본 패치 노트 판 (src/main/update/patch-notes.ts)
