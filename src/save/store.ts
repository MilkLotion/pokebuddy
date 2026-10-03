// 저장 v3 파일 통로 — 계약은 docs/specs/modules.md "저장 구조". 모양은 src/shared/save-v3.ts
//
// 읽을 때 파일의 v 를 보고 갈린다
//   v3        정규화해서 그대로 쓴다
//   v1 · v2   원본을 백업하고 v3 으로 옮긴 뒤 검사한다. 통과하면 파일을 교체하고, 어긋나면 원본을 그대로 둔다
//             repair 가 아니면(읽기 전용) 파일을 건드리지 않고 옮긴 값만 돌려준다. 파일 교체는 writer 의 일이다
//   그 밖     파손으로 보고 <저장>.broken-<시각>.bak 으로 옮긴다 (repair 일 때만). 시각을 붙여 앞선 격리를 덮지 않는다(검수 P3-6)
// 백업에 실패하면 옮기지 않는다. 사용자의 진행을 잃는 것보다 v3 을 늦게 쓰는 편이 낫다.
// 쓰기는 legacy.ts 의 writeAtomic 을 그대로 쓴다 — tmp 에 쓰고 rename 이라 반쪽 파일이 남지 않는다.
//
// 암호화 (src/save/crypt.ts, worklog/records/cloud-authority/record.md "P3 로컬 암호화")
//   키가 있으면 암호화해 쓰고, 읽을 때 푼다. 풀지 못하면(고침·다른 키) 파손과 같다
//   키가 있는데 평문이면 손으로 고친 저장으로 보고 파손과 같게 다룬다. 기존 평문의 이전은 켤 때 src/save/key.ts 가 한 번 한다
//   키가 없는데 암호화 파일이면 읽지 못한다(reason "locked"). 격리하지 않고, 덮어쓰지도 않는다
//   격리하면 <저장>.lost 에 격리 시각(ms)을 남긴다 — 클라우드가 다음 맞추기에서 서버 저장을 받는다 (src/online/lost.ts)
import fs from "node:fs";
import type { SaveV3 } from "../shared/save-v3";
import { isSealed, open, saveKey, seal } from "./crypt.js";
import { migrate } from "./v2/migrate.js";
import { normalizeSaveV2 } from "./v2/normalize.js";
import { writeAtomic } from "./legacy.js";
import { normalize as normalizeV3 } from "./v3.js";

export interface ReadV3Options {
  repair?: boolean; // 파손 격리와 v2 이전 파일 교체를 한다 — 쓰는 쪽만. 읽기 전용은 false
}

export interface ReadV3Result {
  state: SaveV3 | null;
  corrupted: boolean;
  migrated: boolean; // v2 를 v3 으로 옮겼다
  failedChecks?: string[]; // 이전 검사가 어긋났다. 원본을 그대로 두었다
  movedTo?: string; // 파손을 격리한 파일 (repair 일 때)
  // unreadable 잠김·권한, locked 암호화 파일인데 키가 없다, plain 키가 있는데 평문(손으로 고침 — 파손으로 다룬다)
  reason?: "unreadable" | "locked" | "plain" | "backup-failed" | "migrate-failed" | "write-failed";
}

// v2 원본을 남겨 두는 자리. 두 번 옮기는 일은 없으므로 덮어쓰지 않는다
export const backupName = (file: string): string => `${file}.v2.bak`;

// 저장을 격리했다는 표시 — 클라우드가 읽고 지운다
export const lostMarker = (file: string): string => `${file}.lost`;

const errCode = (e: unknown): string | undefined =>
  e != null && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string"
    ? (e as { code: string }).code
    : undefined;

// 원본을 백업한다. 이미 백업이 있으면 건드리지 않는다 — 첫 원본이 가장 값지다
function backup(file: string): boolean {
  const bak = backupName(file);
  try {
    if (fs.existsSync(bak)) return true;
    fs.copyFileSync(file, bak);
    return true;
  } catch {
    return false;
  }
}

// 격리한 파일 이름 — 시각을 붙인다
export const brokenName = (file: string, at = Date.now()): string => `${file}.broken-${new Date(at).toISOString().replace(/[:.]/g, "-")}.bak`;

// 격리 표시를 남긴다 — 내용은 격리 시각(ms)
export function markLost(file: string, at = Date.now()): void {
  try {
    fs.writeFileSync(lostMarker(file), `${at}\n`);
  } catch {
    // 표시를 못 남기면 클라우드는 rev 비교로만 맞춘다
  }
}

// 격리하고 표시를 남긴다. 옮긴 이름을 돌려준다 — 못 옮기면 null(그대로 둔다)
function isolate(file: string): string | null {
  const at = Date.now();
  const to = brokenName(file, at);
  try {
    fs.renameSync(file, to);
  } catch {
    try {
      fs.copyFileSync(file, to);
      fs.unlinkSync(file);
    } catch {
      return null;
    }
  }
  markLost(file, at);
  return to;
}

type Text = { text: string } | { text: null; reason: "missing" | "unreadable" | "locked" | "broken" | "plain" };

// 파일을 글로 — 암호화면 푼다
function readText(file: string): Text {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    return { text: null, reason: errCode(e) === "ENOENT" ? "missing" : "unreadable" };
  }
  const key = saveKey();
  if (isSealed(buf)) {
    if (!key) return { text: null, reason: "locked" };
    const text = open(key, buf);
    return text == null ? { text: null, reason: "broken" } : { text };
  }
  if (key) return { text: null, reason: "plain" };
  return { text: buf.toString("utf8") };
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return null;
  }
};

// 저장 JSON 을 정규화 없이 — 클라우드 올리기용. 없거나 읽지 못하면 null
export function readRaw(file: string): Record<string, unknown> | null {
  const r = readText(file);
  if (r.text == null) return null;
  const raw = parse(r.text);
  return raw != null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

export function read(file: string, { repair = true }: ReadV3Options = {}): ReadV3Result {
  const r = readText(file);
  if (r.text == null) {
    if (r.reason === "missing") return { state: null, corrupted: false, migrated: false };
    if (r.reason === "unreadable" || r.reason === "locked") return { state: null, corrupted: false, migrated: false, reason: r.reason };
    // 풀지 못함·키가 있는데 평문 — 파손과 같다
    const movedTo = repair ? isolate(file) : null;
    return { state: null, corrupted: true, migrated: false, ...(r.reason === "plain" ? { reason: "plain" as const } : {}), ...(movedTo ? { movedTo } : {}) };
  }

  const raw = parse(r.text);
  const now = Date.now();
  const v3 = normalizeV3(raw, now);
  if (v3) return { state: v3, corrupted: false, migrated: false };

  // v1 · v2 는 옮긴다. store.normalize 가 v1 이전까지 맡는다
  const v2 = normalizeSaveV2(raw);
  if (v2) {
    if (!repair) {
      const { save } = migrate(v2, now);
      return save ? { state: save, corrupted: false, migrated: false } : { state: null, corrupted: false, migrated: false, reason: "migrate-failed" };
    }
    if (!backup(file)) return { state: null, corrupted: false, migrated: false, reason: "backup-failed" };
    const { save, failed } = migrate(v2, now);
    if (!save) return { state: null, corrupted: false, migrated: false, failedChecks: failed, reason: "migrate-failed" };
    if (!write(file, save)) return { state: save, corrupted: false, migrated: true, reason: "write-failed" };
    return { state: save, corrupted: false, migrated: true };
  }

  const movedTo = repair ? isolate(file) : null;
  return { state: null, corrupted: true, migrated: false, ...(movedTo ? { movedTo } : {}) };
}

// 키가 없는데 암호화 파일이 있으면 쓰지 않는다 — 읽지 못한 진행을 평문 새 저장으로 덮지 않게.
// 파일이 없을 때만 써도 된다고 본다. 잠김 등으로 머리를 못 읽으면 쓰지 않는다(검수 P3-L3)
// 앱은 켤 때 키 없이 도는데 이것이 참이면 저장 잠김 창을 띄운다(src/main/app.ts)
export function sealedOnDisk(file: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(4);
    const n = fs.readSync(fd, head, 0, 4, 0);
    return isSealed(head.subarray(0, n));
  } catch (e) {
    return errCode(e) !== "ENOENT";
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

export function write(file: string, state: SaveV3): boolean {
  const key = saveKey();
  if (key) return writeAtomic(file, seal(key, `${JSON.stringify(state, null, 2)}\n`));
  if (sealedOnDisk(file)) return false;
  return writeAtomic(file, state);
}
