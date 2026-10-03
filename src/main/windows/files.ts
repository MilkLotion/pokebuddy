// 창이 읽는 파일 — 창 문서·preload·로고. 경로·설정 값은 src/platform/paths.ts 다 (worklog/records/code-structure/design/10-main.md 1.1절)
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "../../platform/paths.js";

// 무대·선택 창 문서 — 컴파일 대상이 아니라 src/renderer 에 그대로 둔다. 스크립트는 그 안에서 ../../dist/web/renderer 상대 경로
export const rendererFile = (name: string): string => path.join(PROJECT, "src", "renderer", name);
// preload 는 메인 산출물 폴더의 dist/main/preload.js — 이 파일(dist/main/windows/files.js)의 한 칸 위다
export const preloadFile = (): string => path.join(__dirname, "..", "preload.js");

// 앱 로고 — assets/logo/out/logo-<크기>.png. 아직 없을 수 있다 (파일이 없으면 null — 부르는 쪽이 조용히 건너뛴다)
export function logoFile(size: 256 | 512): string | null {
  const file = path.join(PROJECT, "assets", "logo", "out", `logo-${size}.png`);
  return fs.existsSync(file) ? file : null;
}
// BrowserWindow 의 icon 옵션 — Windows 만 (mac 은 Dock 아이콘이 따로, 창 아이콘은 없다)
export const windowIcon = (): string | undefined => (process.platform === "win32" ? (logoFile(256) ?? undefined) : undefined);
