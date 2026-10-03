// 창 하나를 띄워 찍는 개발 도구의 공용 부분 — Electron 안에서만 쓴다(dev/dev-*.ts, 화면 검사)
//
// 명령줄 읽기, 페이지로 창 찾기, 창 찍기. 기다리는 시간은 도구마다 다르다(창마다 그리기 시점이 달라 맞출 근거가 없다) — 부르는 쪽이 정한다
import fs from "node:fs";
import { BrowserWindow } from "electron";

// --이름 값 — 없으면 null
export const argAfter = (flag: string): string | null => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? (process.argv[at + 1] ?? null) : null;
};

// 같은 이름을 여러 번 준 값 전부 — 적은 순서대로
export const argsAfter = (flag: string): string[] =>
  process.argv.map((v, i) => (v === flag ? process.argv[i + 1] : undefined)).filter((v): v is string => v != null);

export const hasFlag = (flag: string): boolean => process.argv.includes(flag);

// 쉼표로 이은 숫자 — "1,2,3" → [1, 2, 3]
export const numsOf = (v: string | null): number[] | null => (v ? v.split(",").map(Number) : null);

// 주소가 그 페이지(예: "pet.html")로 끝나는 창
export const windowOf = (page: string): BrowserWindow | undefined => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith(page));

// 창을 찍어 PNG 로 쓴다
export async function captureTo(win: BrowserWindow, file: string): Promise<void> {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
}
