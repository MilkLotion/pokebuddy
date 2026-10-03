// 파일 옮기기와 옮긴 이름의 시각 — 저장·키 파일을 옆으로 옮겨 남길 때 쓴다. Node 만 쓴다
import fs from "node:fs";

// 옮긴 파일 이름에 붙이는 시각 — ISO 글자에서 파일 이름에 못 쓰는 : 와 . 을 - 로 바꾼다
export const stampOf = (at: number = Date.now()): string => new Date(at).toISOString().replace(/[:.]/g, "-");

// 파일을 옮긴다. copyFallback 이면 rename 이 안 될 때 복사 뒤 지운다. 못 옮기면 그대로 두고 false
export function moveFile(from: string, to: string, { copyFallback = false }: { copyFallback?: boolean } = {}): boolean {
  try {
    fs.renameSync(from, to);
    return true;
  } catch (e) {
    if (!copyFallback) {
      console.error(`${from} 을 옮기지 못했다`, e);
      return false;
    }
  }
  try {
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
    return true;
  } catch (e) {
    console.error(`${from} 을 옮기지도 복사하지도 못했다 — 그대로 둔다`, e);
    return false;
  }
}
