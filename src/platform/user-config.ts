// 사용자 설정 — 기본값·설정 파일 읽기·환경변수 덮어쓰기. 옛 이름 폴더와 옛 위치 설정을 처음 한 번 가져온다
// 메인(src/main/app.ts)과 CLI(cli/run.js·status.js·setup.js)가 같이 쓴다
// (예전 config.js 의 뒤쪽. 도구 레인 T7b-1 에서 옮겼다. 경로는 ./paths.ts)
import fs from "node:fs";
import path from "node:path";
import type { Lang } from "../shared/species";
import { PATHS } from "./paths";

// 이번 실행의 맥락 — 설정이 아니다
export interface RuntimeInfo {
  debug: boolean;
  buddyTimeScale: number; // 움직임 시간을 한꺼번에 줄인다 — 시험용
}

export interface UserConfig {
  slug: string;
  buddy: "on" | "calm" | "off";
  clickThrough: boolean;
  lang: Lang | string;
  fromEnv: Set<string>; // 환경변수로 덮어쓴 키
  runtime: RuntimeInfo;
}

// 사용자가 손대는 값 — PATHS.config 에서 읽는다. 앱은 이 파일에 쓰지 않는다 (게임 설정은 저장 save.json 에 있다)
// 여기 없는 키(옛 옵션 art · pos · fps · dotSize · keepVisible · windows 등)는 읽을 때 버린다
export const USER_DEFAULTS = {
  slug: "pikachu", // 이름을 모를 때 쓰는 종 슬러그 (lib/dex.json). POKEBUDDY_SLUG 로 첫 실행 스타터를 줄 수 있다
  buddy: "on", // 창 안을 돌아다니고 졸고 만지면 반응 — on · calm(덜 돌아다님) · off
  clickThrough: false, // true 면 펫 위 클릭이 아래 창으로 통과한 채 시작한다
  lang: "ko", // 화면 문구 언어 — ko · en (lib/i18n). POKEBUDDY_LANG 으로 이번 실행만 바꿀 수 있다
};

// 객체가 아니면(null·배열·숫자로 망가진 파일) 없는 것으로 친다 — "slug" in null 같은 데서 죽지 않게
function readJson(file: string): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// 옛 이름(termimon·pkmon) 데이터 폴더에서 가져올 것 — 설정과 그림 캐시.
// electron(캐시)·state(실행 중 기록)는 새로 생기는 값이라 가져오지 않는다
export const LEGACY_HOME_ITEMS = ["config.json", "pmd"];

// 새 데이터 폴더가 아직 없으면 옛 폴더에서 가져온다 — 이름을 바꾼 뒤 처음 실행할 때 한 번.
// 항목마다 최근 이름 폴더부터 찾는다 — termimon 을 거치지 않고 pkmon 에서 바로 올라와도 가져오게
// 옮기지 않고 복사한다 — 떠 있는 옛 펫이 폴더를 잡고 있으면(Windows) 옮기기가 실패한다. 옛 폴더는 setup 이 지운다
export function migrateLegacyHome(): void {
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
function migrateLegacyConfig(): void {
  try {
    if (fs.existsSync(PATHS.config) || !fs.existsSync(PATHS.legacyConfig)) return;
    fs.mkdirSync(PATHS.home, { recursive: true });
    fs.copyFileSync(PATHS.legacyConfig, PATHS.config);
  } catch {
    // 못 가져오면 기본값으로 시작한다
  }
}

// on/off · true/false · 1/0 · yes/no 를 받는다. 값이 없거나 알 수 없으면 null
function asBool(value: unknown): boolean | null {
  if (value == null || value === "") return null;
  const v = String(value).trim().toLowerCase();
  if (["1", "on", "true", "yes", "y"].includes(v)) return true;
  if (["0", "off", "false", "no", "n"].includes(v)) return false;
  return null;
}

// 설정 읽기 — 파일 → 환경변수 순으로 덮어쓴다. 환경변수는 "이번 한 번만" 다르게 쓰는 값이다
export function readConfig(): UserConfig {
  migrateLegacyHome(); // 새 폴더를 만드는 migrateLegacyConfig 보다 먼저 — 폴더가 생기면 가져오지 않는다
  migrateLegacyConfig();
  const saved = readJson(PATHS.config);
  const env = process.env;
  // 파일에서는 USER_DEFAULTS 의 키만 가져온다 — 옛 키는 조용히 버린다
  const known = Object.fromEntries(Object.keys(USER_DEFAULTS).filter((key) => key in saved).map((key) => [key, saved[key]]));
  const config: Record<string, unknown> = { ...USER_DEFAULTS, ...known };

  // 환경변수로 덮어쓴 키 — 첫 실행 스타터를 명령으로 줬는지(slug) 가른다
  const fromEnv = new Set<string>();
  const override = (key: string, value: unknown): void => {
    config[key] = value;
    fromEnv.add(key);
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
  return config as unknown as UserConfig;
}
