// JSON 파일 하나를 읽는다 — 없거나 깨졌으면 null. 손으로 고친 파일의 BOM 을 뗀다. 값의 모양은 부르는 쪽이 본다
import fs from "node:fs";

export function readJsonFile(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as unknown;
  } catch {
    return null;
  }
}
