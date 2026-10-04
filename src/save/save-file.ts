// 저장 파일(save.json) 통로 — 계약은 docs/specs/modules.md "저장 구조". 모양은 src/shared/save-v3.ts
//
// save.json 의 바이트를 쓰거나 옮기는 코드는 이 파일에만 있다. 입구는 아래 다섯과 읽기(repair)다. 모두 writer 프로세스만 부른다(확인은 부르는 쪽)
//   writeSave        정규화된 저장을 쓴다 — 실행기의 쓰기(src/tx/game.ts)
//   createEmptySave  저장이 없을 때 빈 저장 — 첫 포켓몬 고르기(src/save/save-party.ts)
//   replaceSave      받은 클라우드 저장으로 바꾼다. 로컬을 <저장>.cloud-<시각>.bak 으로 남긴다(src/main/services/online.ts)
//   sealPlainSave    평문 저장을 <저장>.plain-<시각>.bak 으로 남기고 암호화해 다시 쓴다(src/save/key.ts)
//   setAsideSave     저장을 <저장>.<태그>-<시각>[.bak] 으로 옮긴다 — 파손 격리, 키 파손·새로 시작, 로그아웃·삭제
//
// 읽을 때 파일의 v 를 보고 갈린다
//   v3        정규화해서 그대로 쓴다
//   v1 · v2   원본을 백업하고 v3 으로 옮긴 뒤 검사한다. 통과하면 파일을 교체하고, 어긋나면 원본을 그대로 둔다
//             repair 가 아니면(읽기 전용) 파일을 건드리지 않고 옮긴 값만 돌려준다. 파일 교체는 writer 의 일이다
//   그 밖     파손으로 보고 <저장>.broken-<시각>.bak 으로 옮긴다 (repair 일 때만). 시각을 붙여 앞선 격리를 덮지 않는다(검수 P3-6)
// 백업에 실패하면 옮기지 않는다. 사용자의 진행을 잃는 것보다 v3 을 늦게 쓰는 편이 낫다.
// 쓰기는 src/platform/atomic-write.ts 의 writeAtomic 을 쓴다 — tmp 에 쓰고 rename 이라 반쪽 파일이 남지 않는다.
//
// 암호화 (src/save/crypt.ts, worklog/records/cloud-authority/record.md "P3 로컬 암호화")
//   키가 있으면 암호화해 쓰고, 읽을 때 푼다. 풀지 못하면(고침·다른 키) 파손과 같다
//   키가 있는데 평문이면 손으로 고친 저장으로 보고 파손과 같게 다룬다. 기존 평문의 이전은 켤 때 src/save/key.ts 가 한 번 한다
//   키가 없는데 암호화 파일이면 읽지 못한다(reason "locked"). 격리하지 않고, 덮어쓰지도 않는다
//   격리하면 <저장>.lost 에 격리 시각(ms)을 남긴다 — 클라우드가 다음 맞추기에서 서버 저장을 받는다 (src/online/cloud-file.ts)
import fs from "node:fs";
import type { SaveV3 } from "../shared/save-v3";
import { currentSaveKey, isSealed, sealText, unsealText } from "./crypt.js";
import { migrateSaveV2 } from "./v2/migrate.js";
import { normalizeSaveV2 } from "./v2/normalize.js";
import { writeAtomic } from "../platform/atomic-write.js";
import { moveFile, stampOf } from "../platform/move-file.js";
import { emptySave, normalizeSave } from "./normalize.js";

export interface ReadSaveOptions {
  repair?: boolean; // 파손 격리와 v2 이전 파일 교체를 한다 — 쓰는 쪽만. 읽기 전용은 false
}

export interface ReadSaveResult {
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

// 저장을 격리했다는 표시 — 클라우드가 읽고 지운다 (src/online/cloud-file.ts)
export const lostMarkerOf = (file: string): string => `${file}.lost`;


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
export const brokenName = (file: string, at = Date.now()): string => `${file}.broken-${stampOf(at)}.bak`;

// 격리 표시를 남긴다 — 내용은 격리 시각(ms). 원자적 쓰기 — 저장과 같이 tmp + rename, Windows 에서 잠깐 막히면 다시 (94-same-feature-diffs.md 5-9)
export function markSaveLost(file: string, at = Date.now()): void {
  writeAtomic(lostMarkerOf(file), `${at}\n`); // 표시를 못 남기면 클라우드는 rev 비교로만 맞춘다
}

// 저장을 옆으로 옮기는 까닭 — 이름은 모두 <저장>.<태그>-<시각>.bak 이고, 옮기지 못하면 복사 후 삭제로 다시 한다.
// 까닭마다 다른 것은 격리 표시뿐이다 — 읽지 못해 옮긴 저장(broken·unreadable)만 표시를 남긴다
//   broken      읽기의 파손 격리
//   unreadable  키 파일이 망가졌거나 저장 잠김 창에서 새로 시작
//   signout · delete · fresh  새로 시작(로그아웃·계정 삭제·새로 시작)
// (예전에는 unreadable 만 .bak 이 없고 복사 대체가 없었다 — worklog/records/code-structure/design/94-same-feature-diffs.md 5-5)
export type AsideTag = "broken" | "unreadable" | "signout" | "delete" | "fresh";
const LOST: Readonly<Record<AsideTag, boolean>> = { broken: true, unreadable: true, signout: false, delete: false, fresh: false };

// 저장을 옮긴다. 옮긴 이름을 돌려준다 — 저장이 없으면 "", 못 옮기면 null(그대로 둔다)
export function setAsideSave(file: string, tag: AsideTag, at = Date.now()): string | null {
  if (!fs.existsSync(file)) return "";
  const to = `${file}.${tag}-${stampOf(at)}.bak`;
  if (!moveFile(file, to, { copyFallback: true })) return null;
  if (LOST[tag]) markSaveLost(file, at);
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
  const key = currentSaveKey();
  if (isSealed(buf)) {
    if (!key) return { text: null, reason: "locked" };
    const text = unsealText(key, buf);
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

// 파일의 수정 시각과 크기 — 다른 곳이 파일을 바꿨는지 본다. 파일이 없거나 못 읽으면 null (src/tx/live-save.ts, ./save-watch.ts)
export function saveStampOf(file: string): string | null {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
}

// 저장 JSON 을 정규화 없이 — 클라우드 올리기용. 없거나 읽지 못하면 null
export function readSaveRaw(file: string): Record<string, unknown> | null {
  const r = readText(file);
  if (r.text == null) return null;
  const raw = parse(r.text);
  return raw != null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

export function readSave(file: string, { repair = true }: ReadSaveOptions = {}): ReadSaveResult {
  const r = readText(file);
  if (r.text == null) {
    if (r.reason === "missing") return { state: null, corrupted: false, migrated: false };
    if (r.reason === "unreadable" || r.reason === "locked") return { state: null, corrupted: false, migrated: false, reason: r.reason };
    // 풀지 못함·키가 있는데 평문 — 파손과 같다
    const movedTo = repair ? setAsideSave(file, "broken") : null;
    return { state: null, corrupted: true, migrated: false, ...(r.reason === "plain" ? { reason: "plain" as const } : {}), ...(movedTo ? { movedTo } : {}) };
  }

  const raw = parse(r.text);
  const now = Date.now();
  const v3 = normalizeSave(raw, now);
  if (v3) return { state: v3, corrupted: false, migrated: false };

  // v1 · v2 는 옮긴다. v2 정규화(./v2/normalize.ts)가 v1 이전까지 맡는다
  const v2 = normalizeSaveV2(raw);
  if (v2) {
    if (!repair) {
      const { save } = migrateSaveV2(v2, now);
      return save ? { state: save, corrupted: false, migrated: false } : { state: null, corrupted: false, migrated: false, reason: "migrate-failed" };
    }
    if (!backup(file)) return { state: null, corrupted: false, migrated: false, reason: "backup-failed" };
    const { save, failed } = migrateSaveV2(v2, now);
    if (!save) return { state: null, corrupted: false, migrated: false, failedChecks: failed, reason: "migrate-failed" };
    if (!writeSave(file, save)) return { state: save, corrupted: false, migrated: true, reason: "write-failed" };
    return { state: save, corrupted: false, migrated: true };
  }

  const movedTo = repair ? setAsideSave(file, "broken") : null;
  return { state: null, corrupted: true, migrated: false, ...(movedTo ? { movedTo } : {}) };
}

// 키가 없는데 암호화 파일이 있으면 쓰지 않는다 — 읽지 못한 진행을 평문 새 저장으로 덮지 않게.
// 파일이 없을 때만 써도 된다고 본다. 잠김 등으로 머리를 못 읽으면 쓰지 않는다(검수 P3-L3)
// 앱은 켤 때 키 없이 도는데 이것이 참이면 저장 잠김 창을 띄운다(src/main/app.ts)
export function isSealedOnDisk(file: string): boolean {
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

export function writeSave(file: string, state: SaveV3): boolean {
  const key = currentSaveKey();
  if (key) return writeAtomic(file, sealText(key, `${JSON.stringify(state, null, 2)}\n`));
  if (isSealedOnDisk(file)) return false;
  return writeAtomic(file, state);
}

// 저장이 없을 때 빈 저장을 만든다 — 실행기는 읽을 것이 있어야 돈다
export function createEmptySave(file: string, now: number): boolean {
  return writeSave(file, emptySave(now));
}

// 받은 저장을 v3 검사로 읽은 뒤 바꾼다. 바꾸기 전 로컬 저장을 <저장>.cloud-<시각>.bak 으로 남긴다. 백업이 실패하면 바꾸지 않는다
export function replaceSave(file: string, incoming: unknown, now: number): boolean {
  const v3 = normalizeSave(incoming, now);
  if (!v3) return false;
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.cloud-${stampOf(now)}.bak`);
  } catch (e) {
    console.error("클라우드 저장을 받기 전 백업에 실패했다 — 바꾸지 않는다", e);
    return false;
  }
  return writeSave(file, v3);
}

// 기존 평문 저장을 암호화한다 — 백업을 먼저 남긴다. 저장이 없거나 이미 암호화면 할 일이 없다(true). 백업이나 쓰기가 실패하면 false
export function sealPlainSave(file: string, key: Buffer, at: number): boolean {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    return errCode(e) === "ENOENT";
  }
  if (isSealed(buf)) return true;
  try {
    fs.copyFileSync(file, `${file}.plain-${stampOf(at)}.bak`);
  } catch (e) {
    console.error("평문 저장을 백업하지 못해 암호화를 미룬다", e);
    return false;
  }
  return writeAtomic(file, sealText(key, buf.toString("utf8")));
}
