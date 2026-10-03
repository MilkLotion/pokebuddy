// 훅 관련 한 번 알림 — 조건 판정과 "띄웠다" 기록.
//
//   codex-windows-flash  Windows 의 Codex 데몬은 훅을 부를 때마다 콘솔 창을 띄운다(openai/codex#44768).
//                        Codex 가 연결된 Windows 에서 한 번만 `codex --no-daemon` · 연결 해제를 알린다 (2026-09-28 사용자 결정)
//
// 띄운 알림은 save.json 과 같은 폴더의 notices.json { "shown": ["<id>"] } 에 남긴다. 게임 저장에는 필드를 더하지 않는다
import fs from "node:fs";
import { writeAtomic } from "../platform/atomic-write.js";

export const CODEX_FLASH_NOTICE = "codex-windows-flash";

export interface NoticeFacts {
  platform: NodeJS.Platform | string;
  codexConnected: boolean;
  shown: readonly string[];
}

// Codex 창 깜빡임 알림을 띄울 때인가 — Windows 이고 Codex 가 연결돼 있고 아직 띄우지 않았다
export const codexNoticeDue = (f: NoticeFacts): boolean => f.platform === "win32" && f.codexConnected && !f.shown.includes(CODEX_FLASH_NOTICE);

// 띄운 알림 목록 — 파일이 없거나 모양이 틀리면 빈 목록
export function readNotices(file: string): string[] {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const shown = (v as { shown?: unknown } | null)?.shown;
    return Array.isArray(shown) ? shown.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

// 띄웠다고 남긴다 — 쓰지 못하면 false (다음 실행에 한 번 더 뜰 수 있다)
export function markNotice(file: string, id: string): boolean {
  const shown = readNotices(file);
  if (shown.includes(id)) return true;
  return writeAtomic(file, { shown: [...shown, id] });
}
