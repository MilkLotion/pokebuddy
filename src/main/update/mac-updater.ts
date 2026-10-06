// mac 앱 업데이트 엔진 — electron-updater 의 mac 쪽(Squirrel.Mac)은 정식 서명(Apple 개발자 인증서)이 없으면 새 번들을 거부한다.
// ad-hoc 서명 앱이라 직접 한다. 화면 흐름은 Windows 와 같다 — src/main/update/updater.ts 의 UpdaterLike 를 따라 같은 이벤트를 낸다.
// 설계: worklog/records/mac-app/mac-app.md "mac 자체 업데이트" (2026-09-28 사용자 승인 "그렇게 진행하자")
// 공급처·목록 풀이와 번들 위치(순수)는 src/main/update/mac-feed.ts 다
//
//   공급처  번들의 Contents/Resources/app-update.yml (electron-builder 가 publish 로 만든다) — github 또는 generic
//   확인    latest-mac.yml 의 버전이 지금보다 높으면 이 Mac 아키텍처의 zip 을 고른다
//   받기    캐시 폴더(~/Library/Caches/<updaterCacheDirName>)에 받고 sha512 를 검사한 뒤 ditto 로 푼다. 푼 앱의 버전도 본다
//   적용    분리 실행한 bash 도우미가 앱이 끝나길 기다려 같은 폴더 안에서 앱을 바꾼다. 실패하면 옛 앱을 되돌린다
//   수동    앱 폴더에 쓸 수 없거나 dmg 안·격리 실행(AppTranslocation)이면 받지 않는다. 새 버전만 알리고 `받기` 가 dmg 주소를 연다
// Electron 을 import 하지 않는다 — 경로·끝내기·외부 열기는 부르는 쪽이 넘긴다 (node 자체 시험 가능)
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { bundleOf, compareVersions, feedUrls, manualReason, parseLatestMac, parseUpdateConfig, pickFile, type FeedConfig, type FeedFile } from "./mac-feed";
import type { UpdaterLike } from "./updater";

const writable = (dir: string): boolean => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

// ── 받기 ───────────────────────────────────────────────────────────────────────

const REDIRECTS = 5;

// 주소 하나를 받는다 — http·https 둘 다, 리다이렉트를 따라간다(GitHub 는 다른 호스트로 보낸다)
function request(url: string, redirects: number, onResponse: (res: http.IncomingMessage) => void, onError: (e: Error) => void): void {
  const lib = url.startsWith("https:") ? https : http;
  const req = lib.get(url, { headers: { "User-Agent": "pokebuddy-mac-updater" } }, (res) => {
    const code = res.statusCode ?? 0;
    const next = res.headers.location;
    if (code >= 300 && code < 400 && next) {
      res.resume();
      if (redirects <= 0) return onError(new Error(`리다이렉트가 너무 많다: ${url}`));
      return request(new URL(next, url).toString(), redirects - 1, onResponse, onError);
    }
    if (code !== 200) {
      res.resume();
      return onError(new Error(`HTTP ${code}: ${url}`));
    }
    onResponse(res);
  });
  req.setTimeout(60_000, () => req.destroy(new Error(`시간 초과: ${url}`)));
  req.on("error", onError);
}

export function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    request(url, REDIRECTS, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    }, reject);
  });
}

// 파일로 받는다 — 받은 바이트 수로 진행률을 알린다. 크기를 모르면 응답 머리의 길이를 쓴다
export function downloadFile(url: string, dest: string, size: number | null, onPercent: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    request(url, REDIRECTS, (res) => {
      const total = size ?? (Number(res.headers["content-length"]) || 0);
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on("data", (c: Buffer) => {
        got += c.length;
        if (total > 0) onPercent(Math.min(100, (got / total) * 100));
      });
      res.on("error", reject);
      out.on("error", reject);
      out.on("finish", () => resolve());
      res.pipe(out);
    }, reject);
  });
}

export function sha512Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    fs.createReadStream(file).on("data", (c) => hash.update(c)).on("end", () => resolve(hash.digest("base64"))).on("error", reject);
  });
}

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8" }, (err, stdout, stderr) => (err ? reject(new Error(`${cmd}: ${stderr || err.message}`)) : resolve(stdout)));
  });

// 앱 번들의 버전 (Info.plist CFBundleShortVersionString)
export async function bundleVersion(appPath: string): Promise<string> {
  return (await run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", path.join(appPath, "Contents", "Info.plist")])).trim();
}

// ── 적용 도우미 ────────────────────────────────────────────────────────────────

// 인자: 지금 앱, 새 앱, 기다릴 pid, 다시 켜기(1·0). 같은 폴더 안에서 이름만 바꿔 교체한다 — 중간에 멈춰도 원래 앱 또는 옛 앱이 남는다
export const INSTALL_SCRIPT = `#!/bin/bash
APP="$1"; NEW="$2"; WAIT_PID="$3"; RELAUNCH="$4"
DIR="$(dirname "$APP")"; BASE="$(basename "$APP")"
STAGED="$DIR/.$BASE.new"; OLD="$DIR/.$BASE.old"
say() { echo "$(date '+%Y-%m-%dT%H:%M:%S') $*"; }
# 앱이 끝나길 기다린다 — 최대 120초. 끝나지 않으면 바꾸지 않는다
for _ in $(seq 1 600); do kill -0 "$WAIT_PID" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$WAIT_PID" 2>/dev/null; then say "fail: 앱이 끝나지 않음 pid=$WAIT_PID"; exit 1; fi
rm -rf "$STAGED" "$OLD"
if ! ditto "$NEW" "$STAGED"; then say "fail: 새 앱 복사"; rm -rf "$STAGED"; exit 1; fi
if ! mv "$APP" "$OLD"; then say "fail: 지금 앱 옮기기"; rm -rf "$STAGED"; exit 1; fi
if ! mv "$STAGED" "$APP"; then say "fail: 새 앱 놓기 — 되돌림"; mv "$OLD" "$APP"; rm -rf "$STAGED"; exit 1; fi
rm -rf "$OLD"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
say "ok: $APP"
if [ "$RELAUNCH" = "1" ]; then open "$APP"; fi
exit 0
`;

// 도우미를 분리 실행한다 — 앱이 끝나도 산다. 출력은 로그 파일로
export function startInstaller(o: { cacheDir: string; app: string; next: string; pid: number; relaunch: boolean }): void {
  fs.mkdirSync(o.cacheDir, { recursive: true });
  const script = path.join(o.cacheDir, "install.sh");
  fs.writeFileSync(script, INSTALL_SCRIPT, { mode: 0o755 });
  const log = fs.openSync(path.join(o.cacheDir, "install.log"), "a");
  const child = spawn("/bin/bash", [script, o.app, o.next, String(o.pid), o.relaunch ? "1" : "0"], { detached: true, stdio: ["ignore", log, log] });
  child.unref();
  fs.closeSync(log);
}

// ── 엔진 ───────────────────────────────────────────────────────────────────────

export interface MacUpdaterDeps {
  version: string; // 지금 버전 (app.getVersion())
  resourcesPath: string; // app-update.yml 이 있는 곳
  exePath: string; // 지금 실행 파일 — 번들 위치를 여기서 찾는다
  arch: string; // process.arch
  home: string; // 캐시 폴더 기준 (~/Library/Caches)
  pid: number;
  quit: () => void; // 다시 시작 — 앱을 끝낸다
  onWillQuit: (fn: () => void) => void; // 끌 때 적용
  openExternal: (url: string) => void; // 수동 받기
  canWrite?: (dir: string) => boolean;
  startInstaller?: typeof startInstaller;
}

export class MacUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  logger: unknown = null;
  private readonly deps: MacUpdaterDeps;
  private ready: { version: string; app: string } | null = null;
  private manual: { version: string; url: string } | null = null;
  private busy = false; // 받는 중
  private installing = false;

  constructor(deps: MacUpdaterDeps) {
    super();
    this.deps = deps;
    // 끌 때 적용 — 준비된 새 버전이 있고 다시 시작으로 이미 적용하지 않았으면 다시 켜지 않고 바꾼다
    deps.onWillQuit(() => {
      if (this.ready && this.autoInstallOnAppQuit && !this.installing) this.apply(false);
    });
  }

  private config(): FeedConfig {
    const file = path.join(this.deps.resourcesPath, "app-update.yml");
    const cfg = fs.existsSync(file) ? parseUpdateConfig(fs.readFileSync(file, "utf8")) : null;
    if (!cfg) throw new Error("app-update.yml 을 읽지 못했다");
    return cfg;
  }

  cacheDir(cfg: FeedConfig): string {
    return path.join(this.deps.home, "Library", "Caches", cfg.cacheName ?? "pokebuddy-updater");
  }

  async checkForUpdates(): Promise<unknown> {
    if (this.busy || this.ready) return null;
    this.emit("checking-for-update");
    const cfg = this.config();
    const urls = feedUrls(cfg);
    const latest = parseLatestMac(await fetchText(urls.latest));
    if (!latest) throw new Error("latest-mac.yml 모양이 다르다");
    if (compareVersions(latest.version, this.deps.version) <= 0) {
      this.emit("update-not-available", { version: latest.version });
      return null;
    }
    // 그 자리에서 바꿀 수 없다 — 받지 않고 알리기만
    const reason = manualReason(bundleOf(this.deps.exePath), this.deps.canWrite ?? writable);
    if (reason) {
      const dmg = pickFile(latest.files, this.deps.arch, "dmg");
      this.manual = { version: latest.version, url: dmg ? urls.file(latest.version, dmg.url) : urls.page(latest.version) };
      this.emit("update-manual", { version: latest.version, reason });
      return null;
    }
    const zip = pickFile(latest.files, this.deps.arch, "zip");
    if (!zip) throw new Error(`이 Mac(${this.deps.arch})용 zip 이 목록에 없다`);
    if (!this.autoDownload) return null;
    this.busy = true;
    this.emit("update-available", { version: latest.version });
    // 받기는 기다리지 않는다 — electron-updater 처럼 확인은 곧 끝나고 받기 결과는 이벤트로 온다
    void this.download(cfg, urls.file(latest.version, zip.url), zip, latest.version)
      .then((app) => {
        this.ready = { version: latest.version, app };
        this.emit("update-downloaded", { version: latest.version });
      })
      .catch((e: unknown) => this.emit("error", e instanceof Error ? e : new Error(String(e))))
      .finally(() => {
        this.busy = false;
      });
    return null;
  }

  private async download(cfg: FeedConfig, url: string, file: FeedFile, version: string): Promise<string> {
    const dir = this.cacheDir(cfg);
    // 지난 받기의 남은 것을 지운다 — 도우미 로그는 남긴다
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (name !== "install.log") fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const zipPath = path.join(dir, "update.zip");
    await downloadFile(url, zipPath, file.size, (percent) => this.emit("download-progress", { percent }));
    if ((await sha512Of(zipPath)) !== file.sha512) throw new Error("받은 파일의 sha512 가 목록과 다르다");
    const out = path.join(dir, "extract");
    fs.mkdirSync(out, { recursive: true });
    await run("/usr/bin/ditto", ["-x", "-k", zipPath, out]);
    fs.rmSync(zipPath, { force: true });
    const app = fs.readdirSync(out).find((n) => n.endsWith(".app"));
    if (!app) throw new Error("받은 zip 에 앱이 없다");
    const got = await bundleVersion(path.join(out, app));
    if (got !== version) throw new Error(`받은 앱의 버전이 다르다: ${got} ≠ ${version}`);
    return path.join(out, app);
  }

  private apply(relaunch: boolean): boolean {
    const bundle = bundleOf(this.deps.exePath);
    if (!this.ready || !bundle) return false;
    this.installing = true;
    (this.deps.startInstaller ?? startInstaller)({ cacheDir: this.cacheDir(this.config()), app: bundle, next: this.ready.app, pid: this.deps.pid, relaunch });
    return true;
  }

  // 다시 시작 — 도우미를 띄우고 앱을 끝낸다. 도우미가 앱이 끝나길 기다려 바꾸고 다시 켠다
  quitAndInstall(_isSilent?: boolean, isForceRunAfter?: boolean): void {
    if (this.installing || !this.apply(isForceRunAfter !== false)) return;
    this.deps.quit();
  }

  // 수동 받기 — 이 Mac 아키텍처의 dmg(없으면 릴리스 페이지)를 연다
  openDownload(): void {
    if (this.manual) this.deps.openExternal(this.manual.url);
  }
}

export const createMacUpdater = (deps: MacUpdaterDeps): MacUpdater => new MacUpdater(deps);
