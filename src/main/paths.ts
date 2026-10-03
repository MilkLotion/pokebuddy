// 메인 전용 경로 — 창 문서·preload·로고. 경로·설정 값은 src/platform/paths.ts 다
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "../platform/paths.js";

// [임시] 옛 자리 — src/main 의 파일들과 src/tools 가 이 경로로 읽는다. 원본은 src/platform/paths.ts. 메인 레인이 파일을 옮길 때 새 자리로 잇는다
export { PATHS, PROJECT, readConfig as loadConfig, type Paths, type RuntimeInfo, type UserConfig } from "../platform/paths.js";

// 무대·선택 창 문서 — 컴파일 대상이 아니라 src/renderer 에 그대로 둔다. 스크립트는 그 안에서 ../../dist/web/renderer 상대 경로
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
