// 경로·설정의 typed facade — config.js(JS 로 남아 있다 — CLI·설치본이 함께 쓴다)를 감싼다. 값·규칙·기본값은 그쪽이 소유하고 여기는 모양만 붙인다
// dist/main/paths.js 에서 ../../config.js = 프로젝트 루트의 config.js
import fs from "node:fs";
import path from "node:path";
import type { Lang } from "../shared/types";

export interface Paths {
  project: string;
  config: string;
  legacyConfig: string;
  legacyHomes: string[];
  lastError: string; // 펫이 못 떴을 때의 이유 — 펫 출력은 버려지므로 여기 남긴다
  electronData: string;
  home: string;
  state: string; // 훅이 세션 상태를 적는 곳
  pmd: string; // PMD 스프라이트 묶음 캐시
  companionLock: string; // 동반자 — 기기당 하나
  legacyCli: string; // 옛 VS Code 확장의 실행 경로 기록 — setup 이 지운다
  legacyWindows: string; // 옛 VS Code 확장의 창 기록 폴더 — setup 이 지운다
  save: string; // 저장 (src/save/store.ts). 옛 v1·v2 파일은 처음 열 때 v3 로 옮긴다
  saveLock: string; // 저장을 쓰는 프로세스의 pid (src/save/writer.ts)
  mailbox: string; // 명령 통로 (src/save/mailbox.ts)
}

// 이번 실행의 맥락 — 설정이 아니다 (config.js runtime)
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

interface ConfigModule {
  PATHS: Paths;
  load(): UserConfig;
}

const settings = require("../../config.js") as ConfigModule;

export const PATHS: Paths = settings.PATHS;
export const PROJECT: string = PATHS.project;

export const loadConfig = (): UserConfig => settings.load();

// 무대·선택 창 문서 — 컴파일 대상이 아니라 src/renderer 에 그대로 둔다. 스크립트는 그 안에서 ../../dist/renderer 상대 경로
export const rendererFile = (name: string): string => path.join(PROJECT, "src", "renderer", name);
// preload 는 이 파일과 같은 폴더의 산출물 — dist/main/preload.js
export const preloadFile = (): string => path.join(__dirname, "preload.js");

// 앱 로고 — assets/logo/out/logo-<크기>.png. 아직 없을 수 있다 (파일이 없으면 null — 부르는 쪽이 조용히 건너뛴다)
export function logoFile(size: 256 | 512): string | null {
  const file = path.join(PROJECT, "assets", "logo", "out", `logo-${size}.png`);
  return fs.existsSync(file) ? file : null;
}
// BrowserWindow 의 icon 옵션 — Windows 만 (mac 은 Dock 아이콘이 따로, 창 아이콘은 없다)
export const windowIcon = (): string | undefined => (process.platform === "win32" ? (logoFile(256) ?? undefined) : undefined);
