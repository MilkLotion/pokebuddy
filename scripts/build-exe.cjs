// Windows 설치 파일 만들기 — `npm run dist:win` → release/pokebuddy-Setup-<버전>.exe
// mac 디스크 이미지 만들기 — `npm run dist:mac` → release/PokeBuddy-<버전>-arm64.dmg · -x64.dmg
//                                                 release/PokeBuddy-<버전>-arm64.zip · -x64.zip · latest-mac.yml
//   mac 은 이 Mac 로그인 키체인의 자체 서명 인증서 "PokeBuddy Code Signing" 으로 서명한다. Apple 공증은 없다 — 처음 실행 때 Gatekeeper 가 막는다.
//   인증서로 서명해야 macOS 가 버전이 바뀌어도 같은 앱으로 본다(designated = identifier + certificate leaf). ad-hoc 은 빌드마다 해시가 바뀌어
//   업데이트마다 키체인 허용 창이 떴다 (2026-09-28 사용자 결정 A). 인증서가 없으면 mac 빌드는 멈춘다 — 개인키는 저장소에 넣지 않는다
//   mac 업데이트는 electron-updater(Squirrel.Mac)가 아니라 src/main/mac-updater.ts 가 한다 — Squirrel.Mac 은 정식 서명이 있어야 새 번들을 받아들인다.
//   zip·latest-mac.yml 은 그 업데이트가 받는 파일이다. 릴리스 때 dmg 와 함께 올린다
//
// 1. npm run build 로 dist/ 를 만든다 (package.json 의 스크립트가 먼저 부른다)
// 2. release/app/ 에 실행에 필요한 파일만 복사한다. 목록은 package.json 의 `files` 와 같다
// 3. release/app/ 에 작은 package.json 을 만든다. dependencies 에는 electron 을 뺀 실행 의존성만 둔다
// 4. electron-builder 로 release/app/ 을 묶는다
//
// 따로 모아 묶는 이유 — electron-builder 는 앱의 dependencies 에 electron 이 있으면 묶기를 거부한다.
// 루트 package.json 은 npm 판 CLI 가 실행 때 electron 을 쓰므로 dependencies 에 둔다. 그래서 루트를 바꾸지 않고 따로 모은다.
// asar 로 묶지 않는다 — 훅 원본 복사(cli/setup.js)와 창 추적 도우미(helpers/winbounds.ps1)가 실제 파일 경로를 쓴다.
// 코드 서명은 하지 않는다. 처음 실행 때 SmartScreen 경고가 뜬다 (worklog/records/game-runtime/record.md "Windows 실행 파일의 설계")
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
// mac 디스크 이미지 — 인자 없으면 Windows 설치 파일
const MAC = process.argv.includes("--mac");
// mac 서명 인증서 — 로그인 키체인에 있어야 한다. 자체 서명이라 `security find-identity -v` 의 "유효"에는 없다(신뢰 설정 없이 쓴다)
const MAC_IDENTITY = "PokeBuddy Code Signing";
if (MAC && process.platform !== "darwin") throw new Error("mac 설치 파일은 mac 에서만 만든다 — 헬퍼 universal 빌드·ad-hoc 서명에 Xcode 도구가 필요하다");
// 업데이트 실기 시험 빌드 (scripts/e2e-update.cjs) — 사용자의 설치본과 섞이지 않게 다른 appId·이름으로, 바로 가기 없이 만든다.
// 빌드 때만 읽는다. 설치본은 환경 변수를 읽지 않고, 대신 update-test.json 표시 파일로 임시 홈을 쓰고 OS 등록(링크·로그인 시 시작)을 건너뛴다
const TEST = process.env.PB_UPDATE_TEST === "1";
// 시험 빌드의 앱은 이 임시 홈만 쓴다 — 사용자의 저장을 건드리지 않게 반드시 준다
const testHome = process.env.PB_UPDATE_HOME ?? "";
if (TEST && !path.isAbsolute(testHome)) throw new Error("시험 빌드는 PB_UPDATE_HOME(임시 홈의 절대 경로)이 필요하다");
const version = TEST && process.env.PB_UPDATE_VERSION ? process.env.PB_UPDATE_VERSION : pkg.version;
const name = TEST ? `${pkg.name}-update-test` : pkg.name;
// 앱 이름 — mac 은 앱 번들 이름(PokeBuddy.app)이 된다. Windows 는 설치 폴더·실행 파일 이름이라 pkg.name 그대로.
// 업데이트 시험 빌드는 mac 도 pkg.name 계열 이름(pokebuddy-update-test.app)이라 사용자의 앱과 섞이지 않는다
const productName = MAC && !TEST ? "PokeBuddy" : name;
// PB_RELEASE_OUT — 설치 파일만 확인하는 빌드를 다른 폴더에 만든다. release/ 의 공개한 파일을 덮지 않게 (2026-09-30)
const release = TEST && process.env.PB_UPDATE_OUT ? process.env.PB_UPDATE_OUT : process.env.PB_RELEASE_OUT || path.join(root, "release");
const stage = path.join(release, "app");

// 설치 파일에 넣지 않는 것 — npm 설치 뒤 스크립트는 npm 판에만 쓴다
const SKIP = new Set(["scripts/postinstall.js"]);

// `files` 한 줄을 실제 경로 목록으로. 끝의 `/` 는 폴더, `*` 는 한 폴더 안의 이름 맞추기만 쓴다
function expand(entry) {
  const clean = entry.replace(/\/$/, "");
  if (!clean.includes("*")) return fs.existsSync(path.join(root, clean)) ? [clean] : [];
  const dir = path.posix.dirname(clean);
  const pattern = new RegExp(`^${path.posix.basename(clean).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((name) => pattern.test(name)).map((name) => `${dir}/${name}`);
}

// 실행 때 쓰는 npm 패키지 — dependencies 에서 electron 을 뺀 것과 그 하위 의존성 전부.
// 루트 node_modules 에서 그대로 복사한다. 네트워크 없이 개발 PC 와 같은 버전이 들어간다.
// 2026-09-27: 친구 교환이 @supabase/supabase-js 를 쓰면서 더했다. 전에는 electron 말고 실행 의존성이 없었다
function runtimePackages() {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    const dir = path.join(root, "node_modules", name);
    if (!fs.existsSync(path.join(dir, "package.json"))) throw new Error(`실행 의존성이 설치돼 있지 않다: ${name} — npm install 을 먼저 한다`);
    seen.add(name);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    for (const dep of Object.keys(meta.dependencies ?? {})) visit(dep);
    for (const dep of Object.keys(meta.optionalDependencies ?? {})) if (fs.existsSync(path.join(root, "node_modules", dep))) visit(dep);
  };
  for (const name of Object.keys(pkg.dependencies ?? {})) if (name !== "electron") visit(name);
  return [...seen].sort();
}

// mac 창 추적 헬퍼가 두 아키텍처를 다 가졌는지 — arm64·x64 이미지가 같은 헬퍼를 쓴다. 한쪽이 빠지면 그 맥에서 조용히 창 추적을 못 한다
function checkMacHelper() {
  const helper = path.join(root, "helpers", "winbounds");
  const archs = fs.existsSync(helper) ? execFileSync("lipo", ["-archs", helper], { encoding: "utf8" }).trim().split(/\s+/) : [];
  const missing = ["arm64", "x86_64"].filter((a) => !archs.includes(a));
  if (missing.length) throw new Error(`helpers/winbounds 에 ${missing.join(", ")} 가 없다 — npm run dist:mac 으로 만든다(헬퍼 universal 빌드 포함)`);
}

function stageFiles() {
  if (MAC) checkMacHelper();
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const copied = [];
  for (const entry of pkg.files) {
    if (SKIP.has(entry)) continue;
    for (const rel of expand(entry)) {
      fs.cpSync(path.join(root, rel), path.join(stage, rel), { recursive: true });
      copied.push(rel);
    }
  }
  // 포켓몬 그림(초상·도구·알)은 넣지 않는다 — 저작권이 The Pokémon Company 에 있어 공개 릴리스로 재배포하지 않는다(2026-09-26 사용자 결정).
  // 앱이 처음 켜질 때 받아 캐시에 둔다 (src/main/portraits.ts prefetch)
  // 자체 검사와 데이터 생성 도구는 실행에 쓰지 않는다
  fs.rmSync(path.join(stage, "dist", "tools"), { recursive: true, force: true });
  for (const name of runtimePackages()) {
    fs.cpSync(path.join(root, "node_modules", name), path.join(stage, "node_modules", name), { recursive: true });
    copied.push(`node_modules/${name}`);
  }
  // home — 앱이 쓸 임시 홈(config.js updateTestHome). 업데이트 설치 파일이 다시 켠 앱도 사용자의 홈 대신 이 홈을 쓴다
  if (TEST) fs.writeFileSync(path.join(stage, "update-test.json"), `${JSON.stringify({ note: `업데이트 실기 시험 빌드 — ${MAC ? "src/tools/e2e-update-mac.ts" : "scripts/e2e-update.cjs"}`, home: testHome })}\n`);
  const appPkg = {
    name,
    productName,
    version,
    description: pkg.description,
    license: pkg.license,
    author: "MilkLotion",
    main: pkg.main,
    // electron-builder 는 dependencies 에 적힌 패키지만 node_modules 에서 골라 넣는다. 적지 않으면 복사한 node_modules 를 버린다(2026-09-27 검수)
    dependencies: Object.fromEntries(Object.entries(pkg.dependencies ?? {}).filter(([name]) => name !== "electron")),
  };
  fs.writeFileSync(path.join(stage, "package.json"), `${JSON.stringify(appPkg, null, 2)}\n`);
  return copied;
}

// mac 앱을 인증서로 서명하고 확인한다 — 안쪽(프레임워크·도우미 앱)부터 --deep 으로 함께
function signMac(appPath) {
  const found = execFileSync("security", ["find-identity", "-p", "codesigning"], { encoding: "utf8" });
  if (!found.includes(`"${MAC_IDENTITY}"`)) throw new Error(`mac 서명 인증서 "${MAC_IDENTITY}" 가 로그인 키체인에 없다 — 인증서를 가져온 뒤 다시 빌드한다`);
  execFileSync("codesign", ["--force", "--deep", "--sign", MAC_IDENTITY, appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  const req = execFileSync("codesign", ["-d", "-r-", appPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!/certificate leaf = H"/.test(req)) throw new Error(`서명 요구 사항에 인증서가 없다: ${req.trim()}`);
}

async function main() {
  const copied = stageFiles();
  process.stdout.write(`모은 파일: ${copied.join(", ")}\n`);
  const builder = require("electron-builder");
  const electronVersion = String(pkg.dependencies.electron).replace(/^[^\d]*/, "");
  const logo = (file) => path.join(root, "assets", "logo", "out", file);
  // 두 플랫폼이 같이 쓰는 설정
  const common = {
    appId: TEST ? "io.github.milklotion.pokebuddy.updatetest" : "io.github.milklotion.pokebuddy",
    productName,
    electronVersion,
    npmRebuild: false,
    asar: false,
    electronLanguages: ["ko", "en-US"], // 화면 언어 두 가지만 남긴다. Chromium 언어 파일이 50MB 가까이 된다
    directories: { output: release },
    files: ["**/*"],
  };
  // 앱 업데이트(src/main/updater.ts)가 볼 곳 — 설치본에 app-update.yml, 릴리스 폴더에 latest.yml(Windows)·latest-mac.yml(mac)이 생긴다.
  // 업데이트 실기 시험의 빌드만 PB_UPDATE_FEED(로컬 HTTP 주소)로 바꾼다 — 빌드 때만 읽는다. 설치본은 환경 변수를 읽지 않는다
  const publish = process.env.PB_UPDATE_FEED
    ? [{ provider: "generic", url: process.env.PB_UPDATE_FEED }]
    : [{ provider: "github", owner: "MilkLotion", repo: "pokebuddy" }];
  const windows = {
    // 릴리스 때 exe 와 함께 latest.yml·.blockmap 을 GitHub Release 에 올린다
    publish,
    win: { icon: logo("logo.ico") },
    // 원클릭 설치 — 묻지 않고 사용자 폴더(%LOCALAPPDATA%\Programs\pokebuddy)에 설치한 뒤 앱을 띄운다 (2026-09-25 사용자 선택).
    // 단계식 마법사는 "모든 사용자/나만" 화면을 끌 수 없어 쓰지 않는다
    nsis: {
      oneClick: true,
      perMachine: false, // 관리자 권한이 필요 없다
      runAfterFinish: true, // 설치가 끝나면 동반자를 띄운다. 처음이면 첫 포켓몬 선택 창이 뜬다
      installerIcon: logo("logo.ico"),
      uninstallerIcon: logo("logo.ico"),
      installerHeaderIcon: logo("logo.ico"),
      shortcutName: TEST ? name : "PokeBuddy", // 바탕 화면·시작 메뉴·점프 목록 앱 이름 줄. 설치 폴더·실행 파일 이름은 pkg.name 그대로
      createDesktopShortcut: !TEST,
      createStartMenuShortcut: !TEST,
      deleteAppDataOnUninstall: false, // 저장(~/.claude/pokebuddy)은 지우지 않는다
      // 제거할 때 CLI 훅 등록을 걷는다(업데이트 때는 건너뜀). 업데이트 시험 빌드에는 넣지 않는다 — 시험 앱을 지울 때 사용자의 실제 훅을 걷으면 안 된다
      ...(TEST ? {} : { include: path.join(root, "scripts", "installer.nsh") }),
      artifactName: "${productName}-Setup-${version}.${ext}",
    },
  };
  // mac 업데이트는 src/main/mac-updater.ts 가 app-update.yml 로 공급처를 알고 latest-mac.yml·zip 을 받는다.
  // publish 를 적지 않으면 electron-builder 가 git 원격으로 공급처를 짐작한다(2026-09-28 빌드에서 provider: gitlab 로 생김) — Windows 와 같은 값을 적는다
  const mac = {
    publish,
    mac: {
      icon: logo("logo.icns"),
      category: "public.app-category.entertainment",
      identity: null, // electron-builder 서명은 끈다 — 신뢰 설정 없는 자체 서명 인증서를 찾지 못한다. 아래 afterPack 이 직접 서명한다
      hardenedRuntime: false, // 공증을 하지 않으므로 끈다. 켜면 자체 서명에서 라이브러리 검증에 걸린다
      gatekeeperAssess: false,
      // 교환·로그인 링크 — mac 은 Info.plist 에 적힌 스킴만 setAsDefaultProtocolClient 가 받는다. Windows 는 실행 중 등록이라 mac 에만 둔다
      protocols: [{ name: "PokeBuddy", schemes: ["pokebuddy"] }],
      artifactName: "${productName}-${version}-${arch}.${ext}",
    },
    dmg: { artifactName: "${productName}-${version}-${arch}.${ext}" },
    // 묶은 직후, dmg·zip 을 만들기 전에 서명한다
    afterPack: (ctx) => signMac(path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)),
    // 업데이트가 받는 zip 도 mac.artifactName 을 따른다 — 확장자만 달라 dmg 와 겹치지 않는다(electron-builder 에 zip 전용 설정은 없다)
  };
  const out = await builder.build({
    projectDir: stage,
    // mac 업데이트 시험 빌드는 이 Mac 아키텍처의 zip 만 만든다 — dmg·다른 아키텍처는 시험에 쓰지 않고 몇 분 걸린다
    targets: MAC
      ? TEST
        ? builder.Platform.MAC.createTarget(["zip"], process.arch === "arm64" ? builder.Arch.arm64 : builder.Arch.x64)
        : builder.Platform.MAC.createTarget(["dmg", "zip"], builder.Arch.arm64, builder.Arch.x64)
      : builder.Platform.WINDOWS.createTarget("nsis", builder.Arch.x64),
    publish: "never",
    config: { ...common, ...(MAC ? mac : windows) },
  });
  process.stdout.write(`만든 파일:\n${out.map((f) => `  ${path.relative(root, f)}`).join("\n")}\n`);
}

main().catch((e) => {
  process.stderr.write(`설치 파일을 만들지 못했다: ${e && e.stack ? e.stack : String(e)}\n`);
  process.exit(1);
});
