// 설정 한 곳 — 기본값·경로·사용자 설정을 여기서만 정한다
// 메인(src/main/paths.ts 가 감싼다), cli/(pokebuddy 명령), 진단 도구가 모두 이 파일을 참고한다
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT_DIR = __dirname;
// 업데이트 실기 시험 빌드(scripts/build-exe.cjs PB_UPDATE_TEST)만 표시 파일의 임시 홈을 쓴다.
// 업데이트 설치 파일이 앱을 다시 켤 때는 시험의 환경 변수를 물려받지 않아 사용자의 홈으로 켜진다(2026-09-28 실기에서 확인)
function updateTestHome() {
  try {
    const home = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "update-test.json"), "utf8")).home;
    return typeof home === "string" && path.isAbsolute(home) ? home : null;
  } catch {
    return null; // 보통 빌드 — 표시 파일이 없다
  }
}
const USER_HOME = updateTestHome() ?? os.homedir();
const POKEBUDDY_HOME = path.join(USER_HOME, ".claude", "pokebuddy");

// 경로 — 하드코딩을 한 곳에 모은다
const PATHS = {
  project: PROJECT_DIR,
  // 사용자 설정은 홈에 둔다. 프로그램 폴더 안에 두면 npm 으로 업데이트할 때마다 지워지고,
  // Node 버전 관리자(nvm)로 버전을 바꾸면 설정이 따로 논다
  config: path.join(POKEBUDDY_HOME, "config.json"),
  legacyConfig: path.join(PROJECT_DIR, "pkmon.config.json"), // 예전 위치 — 처음 읽을 때 한 번 가져온다
  // 옛 이름 시절의 데이터 폴더 — 최근 이름부터 (termimon ← pkmon). migrateLegacyHome
  legacyHomes: ["termimon", "pkmon"].map((name) => path.join(USER_HOME, ".claude", name)),
  lastError: path.join(POKEBUDDY_HOME, "last-error.json"), // 펫이 못 떴을 때의 이유 — 펫 출력은 버려지므로 여기 남긴다
  electronData: path.join(POKEBUDDY_HOME, "electron"), // Electron 캐시·세션 — uninstall --purge 로 같이 지워지게 홈 아래에
  home: POKEBUDDY_HOME,
  state: path.join(POKEBUDDY_HOME, "state"), // 훅이 세션 상태를 적는 곳
  pmd: path.join(POKEBUDDY_HOME, "pmd"), // PMD 스프라이트 묶음 캐시 (CC BY-NC — 저장소엔 넣지 않는다)
  // 동반자(pokebuddy companion) — 기기당 하나. 내용은 `pid\nready`. 지우면 동반자가 스스로 끝난다.
  // CLI 는 이 파일의 pid 가 살아 있는지로 "동반자가 떠 있나"를 판정한다 (파일 존재가 아니라 pid 생존)
  companionLock: path.join(POKEBUDDY_HOME, "companion.lock"),
  // 옛 VS Code 확장이 쓰던 실행 경로 기록과 창 기록 폴더 — setup·uninstall 이 남아 있으면 지운다 (2026-09-27 창 모드 삭제)
  legacyCli: path.join(POKEBUDDY_HOME, "cli.json"),
  legacyWindows: path.join(POKEBUDDY_HOME, "windows"),
  // 저장 (src/save/) — 저장은 writer 프로세스 하나만 쓴다. 나머지는 mailbox 로 요청한다
  save: path.join(POKEBUDDY_HOME, "save.json"), // 게임 진행 v3 (src/save/store.ts)
  saveLock: path.join(POKEBUDDY_HOME, "save.lock"), // 저장을 쓰는 프로세스의 pid (src/save/writer.ts)
  mailbox: path.join(POKEBUDDY_HOME, "mailbox"), // 명령 통로 — 요청 파일 하나 = 요청 하나 (src/save/mailbox.ts)
};

// 사용자가 손대는 값 — PATHS.config 에서 읽는다. 앱은 이 파일에 쓰지 않는다 (게임 설정은 저장 save.json 에 있다)
// 여기 없는 키(옛 옵션 art · pos · fps · dotSize · keepVisible · windows 등)는 읽을 때 버린다
const USER_DEFAULTS = {
  slug: "pikachu", // 이름을 모를 때 쓰는 종 슬러그 (lib/dex.json). POKEBUDDY_SLUG 로 첫 실행 스타터를 줄 수 있다
  buddy: "on", // 창 안을 돌아다니고 졸고 만지면 반응 — on · calm(덜 돌아다님) · off
  clickThrough: false, // true 면 펫 위 클릭이 아래 창으로 통과한 채 시작한다
  lang: "ko", // 화면 문구 언어 — ko · en (lib/i18n). POKEBUDDY_LANG 으로 이번 실행만 바꿀 수 있다
};

// 객체가 아니면(null·배열·숫자로 망가진 파일) 없는 것으로 친다 — "slug" in null 같은 데서 죽지 않게
function readJson(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

// 옛 이름(termimon·pkmon) 데이터 폴더에서 가져올 것 — 설정과 그림 캐시.
// electron(캐시)·state(실행 중 기록)는 새로 생기는 값이라 가져오지 않는다
const LEGACY_HOME_ITEMS = ["config.json", "pmd"];

// 새 데이터 폴더가 아직 없으면 옛 폴더에서 가져온다 — 이름을 바꾼 뒤 처음 실행할 때 한 번.
// 항목마다 최근 이름 폴더부터 찾는다 — termimon 을 거치지 않고 pkmon 에서 바로 올라와도 가져오게
// 옮기지 않고 복사한다 — 떠 있는 옛 펫이 폴더를 잡고 있으면(Windows) 옮기기가 실패한다. 옛 폴더는 setup 이 지운다
function migrateLegacyHome() {
  if (fs.existsSync(PATHS.home)) return;
  for (const item of LEGACY_HOME_ITEMS) {
    const from = PATHS.legacyHomes.map((dir) => path.join(dir, item)).find((p) => fs.existsSync(p));
    if (!from) continue;
    try {
      fs.cpSync(from, path.join(PATHS.home, item), { recursive: true });
    } catch {
      // 못 가져온 것은 기본값·새 다운로드로 시작한다
    }
  }
}

// 예전 위치(프로그램 폴더)의 설정을 홈으로 가져온다 — 옮기지 않고 복사한다. 옛 버전으로 돌아가도 그대로 쓰게
function migrateLegacyConfig() {
  try {
    if (fs.existsSync(PATHS.config) || !fs.existsSync(PATHS.legacyConfig)) return;
    fs.mkdirSync(PATHS.home, { recursive: true });
    fs.copyFileSync(PATHS.legacyConfig, PATHS.config);
  } catch {
    // 못 가져오면 기본값으로 시작한다
  }
}

// 설정 읽기 — 파일 → 환경변수 순으로 덮어쓴다. 환경변수는 "이번 한 번만" 다르게 쓰는 값이다
function load() {
  migrateLegacyHome(); // 새 폴더를 만드는 migrateLegacyConfig 보다 먼저 — 폴더가 생기면 가져오지 않는다
  migrateLegacyConfig();
  const saved = readJson(PATHS.config);
  const env = process.env;
  // 파일에서는 USER_DEFAULTS 의 키만 가져온다 — 옛 키는 조용히 버린다
  const known = Object.fromEntries(Object.keys(USER_DEFAULTS).filter((key) => key in saved).map((key) => [key, saved[key]]));
  const config = { ...USER_DEFAULTS, ...known };

  // 환경변수로 덮어쓴 키 — 첫 실행 스타터를 명령으로 줬는지(slug) 가른다
  const fromEnv = new Set();
  const override = (key, value) => {
    config[key] = value;
    fromEnv.add(key);
  };
  // on/off · true/false · 1/0 · yes/no 를 받는다. 값이 없거나 알 수 없으면 null
  const asBool = (value) => {
    if (value == null || value === "") return null;
    const v = String(value).trim().toLowerCase();
    if (["1", "on", "true", "yes", "y"].includes(v)) return true;
    if (["0", "off", "false", "no", "n"].includes(v)) return false;
    return null;
  };

  if (env.POKEBUDDY_SLUG) override("slug", env.POKEBUDDY_SLUG);
  if (env.POKEBUDDY_BUDDY) override("buddy", env.POKEBUDDY_BUDDY);
  const click = asBool(env.POKEBUDDY_CLICK_THROUGH);
  if (click !== null) override("clickThrough", click);
  // buddy 는 on·calm·off 세 가지. on/off 자리에 true/false·1/0 도 받는다 — 모르는 값이면 켠다(기본)
  const buddyBool = asBool(config.buddy);
  if (buddyBool !== null) config.buddy = buddyBool ? "on" : "off";
  else if (!["on", "calm", "off"].includes(String(config.buddy).toLowerCase())) config.buddy = "on";
  else config.buddy = String(config.buddy).toLowerCase();
  config.fromEnv = fromEnv;

  // 이번 실행의 맥락 — 설정이 아니다
  config.runtime = {
    debug: Boolean(env.POKEBUDDY_DEBUG),
    // buddy 시간을 한꺼번에 줄인다 — 5분 수면을 몇 초 만에 확인하는 시험용 (0.05 면 20배 빠르게)
    buddyTimeScale: Number(env.POKEBUDDY_BUDDY_TIMESCALE) > 0 ? Number(env.POKEBUDDY_BUDDY_TIMESCALE) : 1,
  };
  return config;
}

module.exports = {
  PATHS,
  USER_DEFAULTS,
  LEGACY_HOME_ITEMS,
  load,
  migrateLegacyHome,
};
