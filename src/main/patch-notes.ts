// 패치노트 — 설정 바닥의 `패치노트` 와 업데이트 뒤 처음 켤 때 한 번 뜨는 창이 그린다.
// 내용은 data/patch-notes.json (새 버전이 맨 앞). 설계는 worklog/records/app-update/record.md "패치노트"
//
//   본 버전   save.json 과 같은 폴더의 notes-seen.json { "seen": "<버전>" }. save.json 에는 필드를 더하지 않는다
//   안 본 노트  켤 때 한 번 정한다 — 본 버전이 지금 버전과 다르고 지금 버전의 노트가 있으면 그 버전.
//              본 버전 파일이 없으면: 저장이 이미 있으면 업데이트로 보고 띄운다. 저장이 없으면 새로 설치한 것이라 띄우지 않고 지금 버전을 본 것으로 적는다
import fs from "node:fs";
import { writeAtomic } from "../platform/atomic-write.js";
import type { PatchNote, PatchNotesView } from "../shared/model/account";

export interface PatchNotesOptions {
  notesFile: string; // data/patch-notes.json
  seenFile: string; // notes-seen.json
  version: string; // 지금 버전
  hadSave: boolean; // 켤 때 save.json 이 이미 있었다
  autoShow: boolean; // 업데이트 뒤 처음 켤 때 띄울지 — 설치본만. 개발 실행·시험은 띄우지 않는다
}

export interface PatchNotes {
  view: () => PatchNotesView;
  markSeen: () => void; // 안 본 노트를 띄웠다 — 다시 띄우지 않는다
}

// 파일의 한 항목이 모양에 맞는가 — 틀린 항목은 버린다
const isNote = (v: unknown): v is PatchNote => {
  if (v == null || typeof v !== "object") return false;
  const n = v as { version?: unknown; date?: unknown; lines?: unknown };
  return typeof n.version === "string" && typeof n.date === "string" && Array.isArray(n.lines) && n.lines.every((l) => typeof l === "string");
};

export function readNotes(file: string): PatchNote[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { notes?: unknown };
    return Array.isArray(raw.notes) ? raw.notes.filter(isNote) : [];
  } catch (e) {
    console.error("패치노트를 읽지 못했다", e);
    return [];
  }
}

function readSeen(file: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { seen?: unknown };
    return typeof raw.seen === "string" ? raw.seen : null;
  } catch {
    return null; // 없거나 깨졌다 — 처음으로 본다
  }
}

// 원자적 쓰기 — 저장과 같이 tmp + rename, Windows 에서 잠깐 막히면 다시 (94-same-feature-diffs.md 5-9)
function writeSeen(file: string, version: string): void {
  try {
    if (!writeAtomic(file, `${JSON.stringify({ seen: version })}\n`)) throw new Error("쓰기 실패");
  } catch (e) {
    console.error("notes-seen.json 을 쓰지 못했다", e);
  }
}

export function createPatchNotes(o: PatchNotesOptions): PatchNotes {
  const notes = readNotes(o.notesFile);
  const seenBefore = fs.existsSync(o.seenFile) ? readSeen(o.seenFile) : undefined; // undefined = 파일 없음
  const hasCurrent = notes.some((n) => n.version === o.version);
  let unseen: string | null = null;
  if (seenBefore === undefined && !o.hadSave) writeSeen(o.seenFile, o.version); // 새로 설치 — 띄우지 않는다
  else if (seenBefore !== o.version && hasCurrent && o.autoShow) unseen = o.version;
  return {
    view: () => ({ notes, unseen }),
    markSeen: () => {
      if (!unseen) return;
      writeSeen(o.seenFile, unseen);
      unseen = null;
    },
  };
}
