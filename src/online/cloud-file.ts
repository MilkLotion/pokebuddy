// cloud.json 을 읽고 쓰는 한 곳 — 클라우드 상태 읽기·쓰기, 계정 시드 읽기 (설계 design/40 1.4절, G21-08)
// cloud.json 은 save.json 과 같은 폴더다(경로는 src/platform/paths.ts cloudFileOf). 형식은 cloud-state.ts(normalizeCloudState)
//
// 로컬 저장 격리 표시 처리 — 클라우드 상태를 읽을 때 한 번. 설계는 worklog/records/cloud-authority/record.md "P3 로컬 암호화"
// 저장 파일(src/save/save-file.ts)·키 준비(src/save/key.ts)가 로컬 저장을 격리하면 <저장>.lost 에 격리 시각(ms)을 남긴다.
// 여기서 cloud.json 의 syncedRev 를 -1 로 바꾼다 — 다음 맞추기(src/online/cloud.ts reconcile)가 rev 와 관계없이 서버 저장을 받는다.
// 격리 뒤 새로 고른 첫 포켓몬 저장이 서버 저장을 덮지 않게 한다
//   바꾼 상태를 cloud.json 에 먼저 쓰고, 쓴 뒤에만 표시를 지운다 — 올리기 전에 앱이 꺼져도 다음 부팅이 다시 잊는다(검수 P3-1)
//   격리 뒤에 올린 적이 있으면(lastSavedAt > 격리 시각) 표시만 지운다 — 그 올리기는 격리 뒤의 새 저장이다(검수 P3-8)
//   cloud.json 이 없으면 맞출 서버 저장도 모른다 — 표시만 지운다
// Electron 을 모른다 — 자체 검사(selftest-save-crypt)가 직접 부른다
import fs from "node:fs";
import { writeAtomic } from "../platform/atomic-write.js";
import { cloudFileOf } from "../platform/paths.js";
import { lostMarkerOf } from "../save/save-file.js";
import { normalizeCloudState } from "./cloud-state.js";

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return null; // 처음이거나 파손 — 새 기기 ID 로 시작한다
  }
};

const drop = (marker: string): void => {
  try {
    fs.rmSync(marker, { force: true });
  } catch (e) {
    console.error("격리 표시를 지우지 못했다 — 다음 부팅에 다시 본다", e);
  }
};

// 격리 시각 — 읽지 못하면 0(언제든 잊는다)
function markedAt(marker: string): number {
  try {
    const n = Number(fs.readFileSync(marker, "utf8").trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// cloud.json 내용을 돌려준다(형식 검사는 cloud-state.ts normalizeCloudState). 격리 표시가 있으면 맞춘 rev 를 잊은 상태로
export function readCloudFile(cloudFile: string, saveFile: string): unknown {
  const raw = readJson(cloudFile);
  const marker = lostMarkerOf(saveFile);
  if (!fs.existsSync(marker)) return raw;
  if (!raw || typeof raw !== "object") {
    drop(marker);
    return raw;
  }
  const state = raw as Record<string, unknown>;
  const at = markedAt(marker);
  if (typeof state.lastSavedAt === "number" && state.lastSavedAt > at) {
    drop(marker);
    return raw;
  }
  const next = { ...state, syncedRev: -1, pendingOp: null };
  if (writeAtomic(cloudFile, next)) drop(marker);
  return next;
}

// 클라우드 상태 쓰기 — 쓰지 못하면 남기기만 하고 던지지 않는다
export function writeCloudFile(cloudFile: string, state: unknown): void {
  try {
    if (!writeAtomic(cloudFile, state)) throw new Error(cloudFile);
  } catch (e) {
    console.error("cloud.json 을 쓰지 못했다", e);
  }
}

// 계정 시드(P4b) — 클라우드가 아직 돌지 않을 때 읽는다. 저장 주인의 시드일 때만
//   격리 표시는 보지 않는다 — readCloudFile 과 달리 cloud.json 을 고쳐 쓰지 않는 날 읽기다
export function readCloudSeed(saveFile: string): string | null {
  try {
    const s = normalizeCloudState(JSON.parse(fs.readFileSync(cloudFileOf(saveFile), "utf8")));
    return s?.seed && s.owner && s.seedOwner === s.owner ? s.seed : null;
  } catch {
    return null;
  }
}
