// mac 자체 업데이트 엔진 — 목록 읽기·파일 고르기·주소·버전 비교·수동 판정, 로컬 서버로 받기(리다이렉트·진행률·sha512),
// 도우미 스크립트의 앱 교체·되돌리기를 본다. 가짜 앱 번들(Info.plist 만)을 임시 폴더에 만들어 실제 bash·ditto 로 돌린다
//   npm run build && node dist/tools/selftest/selftest-mac-updater.js   (mac 에서만 — 다른 OS 는 건너뛴다)
import assert from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { bundleOf, compareVersions, feedUrls, manualReason, parseLatestMac, parseUpdateConfig, pickFile } from "../../main/update/mac-feed";
import { INSTALL_SCRIPT, MacUpdater, startInstaller } from "../../main/update/mac-updater";
import { makeTmp } from "../harness/tmp-dir";
import { sleep, until } from "../harness/wait";

const LATEST = `version: 0.9.0
files:
  - url: PokeBuddy-0.9.0-arm64-mac.zip
    sha512: AAA=
    size: 1234
  - url: PokeBuddy-0.9.0-arm64.dmg
    sha512: BBB=
    size: 5678
  - url: PokeBuddy-0.9.0-x64-mac.zip
    sha512: CCC=
    size: 99
  - url: PokeBuddy-0.9.0-x64.dmg
    sha512: DDD=
path: PokeBuddy-0.9.0-arm64-mac.zip
sha512: AAA=
releaseDate: '2026-09-28T00:00:00.000Z'
`;

const work = makeTmp("mac-updater");

// 가짜 앱 번들 — Info.plist 의 버전과 표시 파일 하나
function fakeApp(dir: string, name: string, version: string): string {
  const app = path.join(dir, `${name}.app`);
  fs.mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(
    path.join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`,
  );
  fs.writeFileSync(path.join(app, "Contents", "MacOS", name), `version ${version}\n`);
  return app;
}
const marker = (app: string, name: string): string => fs.readFileSync(path.join(app, "Contents", "MacOS", name), "utf8").trim();

function pureChecks(): void {
  // (1) app-update.yml
  assert.deepEqual(parseUpdateConfig("owner: MilkLotion\nrepo: pokebuddy\nprovider: github\nupdaterCacheDirName: pokebuddy-updater\n"), {
    kind: "github", owner: "MilkLotion", repo: "pokebuddy", cacheName: "pokebuddy-updater",
  });
  assert.deepEqual(parseUpdateConfig("provider: generic\nurl: http://127.0.0.1:1/\nupdaterCacheDirName: 'x-updater'\n"), { kind: "generic", url: "http://127.0.0.1:1/", cacheName: "x-updater" });
  assert.equal(parseUpdateConfig("provider: gitlab\n"), null, "모르는 공급처");
  process.stdout.write("(1) app-update.yml — github·generic·모름  ok\n");

  // (2) latest-mac.yml
  const latest = parseLatestMac(LATEST);
  assert.equal(latest?.version, "0.9.0");
  assert.equal(latest?.files.length, 4);
  assert.deepEqual(latest?.files[0], { url: "PokeBuddy-0.9.0-arm64-mac.zip", sha512: "AAA=", size: 1234 });
  assert.equal(latest?.files[3]?.size, null, "크기 없는 항목");
  assert.deepEqual(parseLatestMac("version: 1.0.0\npath: a.zip\nsha512: Z=\n")?.files, [{ url: "a.zip", sha512: "Z=", size: null }], "옛 모양");
  assert.equal(parseLatestMac("files:\n"), null, "버전 없음");
  process.stdout.write("(2) latest-mac.yml — 파일 목록·옛 모양·깨짐  ok\n");

  // (3) 아키텍처별 파일
  const files = latest!.files;
  assert.equal(pickFile(files, "arm64", "zip")?.url, "PokeBuddy-0.9.0-arm64-mac.zip");
  assert.equal(pickFile(files, "x64", "zip")?.url, "PokeBuddy-0.9.0-x64-mac.zip");
  assert.equal(pickFile(files, "arm64", "dmg")?.url, "PokeBuddy-0.9.0-arm64.dmg");
  assert.equal(pickFile(files, "x64", "dmg")?.url, "PokeBuddy-0.9.0-x64.dmg");
  assert.equal(pickFile([{ url: "a-arm64-mac.zip", sha512: "", size: null }], "x64", "zip"), null, "x64 파일이 없으면 arm64 를 고르지 않는다");
  process.stdout.write("(3) 아키텍처별 zip·dmg  ok\n");

  // (4) 주소
  const gh = feedUrls({ kind: "github", owner: "o", repo: "r", cacheName: null });
  assert.equal(gh.latest, "https://github.com/o/r/releases/latest/download/latest-mac.yml");
  assert.equal(gh.file("0.9.0", "P B.zip"), "https://github.com/o/r/releases/download/v0.9.0/P%20B.zip");
  assert.equal(gh.page("0.9.0"), "https://github.com/o/r/releases/tag/v0.9.0");
  const gen = feedUrls({ kind: "generic", url: "http://h:1/feed", cacheName: null });
  assert.equal(gen.latest, "http://h:1/feed/latest-mac.yml");
  assert.equal(gen.file("0.9.0", "a.zip"), "http://h:1/feed/a.zip");
  process.stdout.write("(4) 주소 — github·generic  ok\n");

  // (5) 버전 비교
  assert.equal(compareVersions("0.8.10", "0.8.9"), 1);
  assert.equal(compareVersions("0.8.0", "0.8"), 0);
  assert.equal(compareVersions("0.7.9", "0.8.0"), -1);
  assert.equal(compareVersions("1.0.0-beta", "1.0.0"), 0);
  process.stdout.write("(5) 버전 비교  ok\n");

  // (6) 번들 위치와 수동 판정
  assert.equal(bundleOf("/Applications/PokeBuddy.app/Contents/MacOS/PokeBuddy"), "/Applications/PokeBuddy.app");
  assert.equal(bundleOf("/usr/local/bin/node"), null);
  const yes = (): boolean => true;
  assert.equal(manualReason("/Applications/PokeBuddy.app", yes), null);
  assert.equal(manualReason("/Applications/PokeBuddy.app", () => false), "read-only");
  assert.equal(manualReason("/private/var/folders/x/AppTranslocation/Y/d/PokeBuddy.app", yes), "translocated");
  assert.equal(manualReason("/Volumes/PokeBuddy 0.9.0/PokeBuddy.app", yes), "disk-image");
  assert.equal(manualReason(null, yes), "not-bundle");
  process.stdout.write("(6) 번들 위치·수동 판정(쓰기 불가·격리·dmg 안)  ok\n");
}

// 도우미 — 교체, 앱이 끝나길 기다림, 새 앱이 없으면 그대로
async function installerChecks(): Promise<void> {
  const dir = path.join(work, "inst");
  const apps = path.join(dir, "Applications");
  fs.mkdirSync(apps, { recursive: true });
  const cache = path.join(dir, "cache");

  // (7) 앱이 살아 있는 동안은 바꾸지 않고, 끝나면 바꾼다. 옛 앱·임시 앱은 남지 않는다
  const app = fakeApp(apps, "Pb", "0.8.0");
  const next = fakeApp(path.join(dir, "new"), "Pb", "0.9.0");
  const holder = spawn("/bin/sleep", ["1.2"], { stdio: "ignore" });
  startInstaller({ cacheDir: cache, app, next, pid: holder.pid!, relaunch: false });
  await sleep(500);
  assert.equal(marker(app, "Pb"), "version 0.8.0", "앱이 켜져 있는 동안은 그대로");
  await until(() => fs.existsSync(app) && marker(app, "Pb") === "version 0.9.0", "교체");
  await until(() => fs.readFileSync(path.join(cache, "install.log"), "utf8").includes("ok:"), "도우미 로그");
  assert.deepEqual(fs.readdirSync(apps).sort(), ["Pb.app"], "옛 앱·임시 앱이 남지 않는다");
  assert.equal(fs.readFileSync(path.join(cache, "install.sh"), "utf8"), INSTALL_SCRIPT);
  process.stdout.write("(7) 도우미 — 앱이 끝나길 기다려 교체, 남는 것 없음  ok\n");

  // (8) 새 앱이 없다(복사 실패) — 지금 앱을 건드리지 않는다. pid 999999 는 없는 프로세스라 기다리지 않는다
  const script = path.join(cache, "install.sh");
  const done = spawnSync("/bin/bash", [script, app, path.join(dir, "none.app"), "999999", "0"], { encoding: "utf8" });
  assert.notEqual(done.status, 0);
  assert.match(done.stdout, /fail: 새 앱 복사/);
  assert.equal(marker(app, "Pb"), "version 0.9.0");
  assert.deepEqual(fs.readdirSync(apps).sort(), ["Pb.app"]);
  process.stdout.write("(8) 도우미 — 새 앱 복사 실패면 그대로  ok\n");

  // (9) 새 앱을 놓지 못함 — 옛 앱을 되돌린다. 두 번째 mv(새 앱 놓기)만 실패하는 가짜 mv 를 PATH 앞에 둔다
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "mv"), `#!/bin/bash\nC="${path.join(dir, "mv-count")}"\nN=$(( $(cat "$C" 2>/dev/null || echo 0) + 1 ))\necho $N > "$C"\nif [ $N -eq 2 ]; then exit 1; fi\n/bin/mv "$@"\n`, { mode: 0o755 });
  const next2 = fakeApp(path.join(dir, "new2"), "Pb", "1.0.0");
  const rolled = spawnSync("/bin/bash", [script, app, next2, "999999", "0"], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.notEqual(rolled.status, 0);
  assert.match(rolled.stdout, /되돌림/);
  assert.equal(marker(app, "Pb"), "version 0.9.0", "옛 앱으로 되돌림");
  assert.deepEqual(fs.readdirSync(apps).sort(), ["Pb.app"]);
  process.stdout.write("(9) 도우미 — 새 앱을 놓지 못하면 옛 앱으로 되돌림  ok\n");
}

// 로컬 공급처 — latest-mac.yml·zip. /go/ 아래는 한 번 리다이렉트한다(GitHub 처럼)
function feedServer(dir: string): Promise<{ server: http.Server; url: string; hits: string[] }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname.slice(1));
    hits.push(name);
    if (name.startsWith("go/")) {
      res.writeHead(302, { Location: `/${name.slice(3)}` }).end();
      return;
    }
    const file = path.join(dir, name);
    if (name.includes("..") || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Length": fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
    resolve({ server, url: `http://127.0.0.1:${port}/go/`, hits });
  }));
}

async function engineChecks(): Promise<void> {
  const dir = path.join(work, "engine");
  const feed = path.join(dir, "feed");
  fs.mkdirSync(feed, { recursive: true });
  const built = fakeApp(path.join(dir, "build"), "Pb", "0.9.0");
  const zip = path.join(feed, "Pb-0.9.0-arm64-mac.zip");
  assert.equal(spawnSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", built, zip]).status, 0);
  const sha = createHash("sha512").update(fs.readFileSync(zip)).digest("base64");
  const yml = (sum: string): string => `version: 0.9.0\nfiles:\n  - url: Pb-0.9.0-arm64-mac.zip\n    sha512: ${sum}\n    size: ${fs.statSync(zip).size}\n  - url: Pb-0.9.0-arm64.dmg\n    sha512: X=\n`;
  fs.writeFileSync(path.join(feed, "latest-mac.yml"), yml(sha));
  const { server, url, hits } = await feedServer(feed);
  const res = path.join(dir, "Resources");
  fs.mkdirSync(res, { recursive: true });
  fs.writeFileSync(path.join(res, "app-update.yml"), `provider: generic\nurl: ${url}\nupdaterCacheDirName: pb-test-updater\n`);
  const apps = path.join(dir, "Applications");
  fs.mkdirSync(apps, { recursive: true });
  const installed = fakeApp(apps, "Pb", "0.8.0");
  const home = path.join(dir, "home");
  try {
    // (10) 확인 → 받기 → 준비됨 → 다시 시작(도우미가 바꾸고, 앱을 끝낸다)
    let quits = 0;
    let quitHook: (() => void) | null = null;
    const events: string[] = [];
    const percents: number[] = [];
    const up = new MacUpdater({
      version: "0.8.0", resourcesPath: res, exePath: path.join(installed, "Contents", "MacOS", "Pb"), arch: "arm64", home, pid: 999_999,
      quit: () => { quits += 1; }, onWillQuit: (fn) => { quitHook = fn; }, openExternal: () => undefined,
    });
    for (const e of ["checking-for-update", "update-not-available", "update-available", "update-downloaded", "update-manual", "error"]) up.on(e, () => events.push(e));
    up.on("download-progress", (p) => percents.push((p as { percent: number }).percent));
    await up.checkForUpdates();
    await until(() => events.includes("update-downloaded") || events.includes("error"), "받기 끝");
    assert.deepEqual(events, ["checking-for-update", "update-available", "update-downloaded"]);
    assert.ok(percents.length > 0 && percents[percents.length - 1] === 100, `진행률 ${percents.join(",")}`);
    assert.ok(hits.includes("go/latest-mac.yml") && hits.includes("latest-mac.yml"), "리다이렉트를 따라갔다");
    assert.ok(fs.existsSync(path.join(home, "Library", "Caches", "pb-test-updater", "extract", "Pb.app")), "캐시에 풀었다");
    up.quitAndInstall(true, false);
    assert.equal(quits, 1, "앱을 끝낸다");
    await until(() => marker(installed, "Pb") === "version 0.9.0", "교체");
    quitHook!();
    await sleep(300);
    assert.equal(fs.readFileSync(path.join(home, "Library", "Caches", "pb-test-updater", "install.log"), "utf8").match(/ok:/g)?.length, 1, "끌 때 적용이 다시 돌지 않는다");
    process.stdout.write("(10) 확인·받기(리다이렉트·진행률·sha512)·풀기·다시 시작 교체  ok\n");

    // (11) 이미 최신
    const latestUp = new MacUpdater({
      version: "0.9.0", resourcesPath: res, exePath: path.join(installed, "Contents", "MacOS", "Pb"), arch: "arm64", home, pid: 1,
      quit: () => undefined, onWillQuit: () => undefined, openExternal: () => undefined,
    });
    const latestEvents: string[] = [];
    latestUp.on("update-not-available", () => latestEvents.push("latest"));
    await latestUp.checkForUpdates();
    assert.deepEqual(latestEvents, ["latest"]);
    process.stdout.write("(11) 이미 최신  ok\n");

    // (12) sha512 가 다르다 — 오류, 준비되지 않는다
    fs.writeFileSync(path.join(feed, "latest-mac.yml"), yml("WRONG="));
    const bad = new MacUpdater({
      version: "0.8.0", resourcesPath: res, exePath: path.join(installed, "Contents", "MacOS", "Pb"), arch: "arm64", home, pid: 1,
      quit: () => undefined, onWillQuit: () => undefined, openExternal: () => undefined,
    });
    let error: Error | null = null;
    let ready = false;
    bad.on("error", (e) => { error = e as Error; });
    bad.on("update-downloaded", () => { ready = true; });
    await bad.checkForUpdates();
    await until(() => error != null, "sha512 오류");
    assert.match((error as Error | null)?.message ?? "", /sha512/);
    assert.equal(ready, false);
    process.stdout.write("(12) sha512 불일치 — 오류  ok\n");

    // (13) dmg 안에서 실행 — 받지 않고 알린다. 받기는 이 Mac 용 dmg 주소를 연다
    fs.writeFileSync(path.join(feed, "latest-mac.yml"), yml(sha));
    const opened: string[] = [];
    const manual = new MacUpdater({
      version: "0.8.0", resourcesPath: res, exePath: "/Volumes/Pb 0.8.0/Pb.app/Contents/MacOS/Pb", arch: "arm64", home, pid: 1,
      quit: () => undefined, onWillQuit: () => undefined, openExternal: (u) => opened.push(u),
    });
    const manualEvents: unknown[] = [];
    manual.on("update-manual", (p) => manualEvents.push(p));
    manual.on("update-available", () => manualEvents.push("available"));
    await manual.checkForUpdates();
    assert.deepEqual(manualEvents, [{ version: "0.9.0", reason: "disk-image" }]);
    manual.openDownload();
    assert.deepEqual(opened, [`${url}Pb-0.9.0-arm64.dmg`]);
    process.stdout.write("(13) dmg 안 실행 — 알리기만, 받기는 dmg 주소  ok\n");
  } finally {
    server.close();
  }
}

async function main(): Promise<void> {
  if (process.platform !== "darwin") {
    process.stdout.write("selftest-mac-updater: mac 이 아니라 건너뜀\n");
    return;
  }
  try {
    pureChecks();
    await installerChecks();
    await engineChecks();
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  process.stdout.write("selftest-mac-updater: 통과 (목록·파일 고르기·주소·버전·수동 판정·받기·sha512·도우미 교체·되돌리기)\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
