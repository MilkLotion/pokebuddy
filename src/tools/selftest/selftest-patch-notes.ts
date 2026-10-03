// 패치노트 — 새로 설치·업데이트·이미 봄·꺼 둠·깨진 파일, 그리고 실제 data/patch-notes.json 의 모양
//   npm run build && node dist/tools/selftest/selftest-patch-notes.js
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createPatchNotes, readNotes } from "../../main/patch-notes";
import { makeTmp } from "../harness/tmp-dir";

const dir = makeTmp("notes");
const notesFile = path.join(dir, "patch-notes.json");
const seenFile = path.join(dir, "notes-seen.json");
fs.writeFileSync(notesFile, JSON.stringify({ notes: [
  { version: "0.7.0", date: "2026-09-28", lines: ["a", "b"] },
  { version: "0.6.0", date: "2026-09-28", lines: ["c"] },
  { version: 5, date: "x", lines: [] }, // 틀린 항목은 버린다
] }));
const seen = (): unknown => (fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, "utf8")).seen : undefined);
const reset = (): void => fs.rmSync(seenFile, { force: true });

try {
  // (1) 새로 설치 — 저장이 없었다. 띄우지 않고 지금 버전을 본 것으로 적는다
  const fresh = createPatchNotes({ notesFile, seenFile, version: "0.7.0", hadSave: false, autoShow: true });
  assert.equal(fresh.view().unseen, null);
  assert.equal(fresh.view().notes.length, 2, "틀린 항목은 버린다");
  assert.equal(seen(), "0.7.0");
  process.stdout.write("(1) 새로 설치 — 띄우지 않음  ok\n");

  // (2) 0.6.0 이하에서 업데이트 — 저장은 있고 본 버전 파일은 없다. 한 번 띄우고, 띄운 뒤에는 다시 띄우지 않는다
  reset();
  const up = createPatchNotes({ notesFile, seenFile, version: "0.7.0", hadSave: true, autoShow: true });
  assert.equal(up.view().unseen, "0.7.0");
  assert.equal(seen(), undefined, "띄우기 전에는 적지 않는다");
  up.markSeen();
  assert.equal(up.view().unseen, null);
  assert.equal(seen(), "0.7.0");
  assert.equal(createPatchNotes({ notesFile, seenFile, version: "0.7.0", hadSave: true, autoShow: true }).view().unseen, null, "다음 실행");
  process.stdout.write("(2) 업데이트 뒤 한 번  ok\n");

  // (3) 다음 업데이트 — 본 버전이 옛 버전이면 띄운다. 지금 버전의 노트가 없으면 띄우지 않는다
  fs.writeFileSync(seenFile, JSON.stringify({ seen: "0.6.0" }));
  assert.equal(createPatchNotes({ notesFile, seenFile, version: "0.7.0", hadSave: true, autoShow: true }).view().unseen, "0.7.0");
  assert.equal(createPatchNotes({ notesFile, seenFile, version: "0.8.0", hadSave: true, autoShow: true }).view().unseen, null, "노트 없는 버전");
  process.stdout.write("(3) 옛 버전에서 올라옴·노트 없는 버전  ok\n");

  // (4) 개발 실행·시험 — 띄우지 않는다. 목록은 그대로 본다
  const dev = createPatchNotes({ notesFile, seenFile, version: "0.7.0", hadSave: true, autoShow: false });
  assert.equal(dev.view().unseen, null);
  assert.equal(dev.view().notes[0]?.version, "0.7.0");
  process.stdout.write("(4) 개발 실행 — 띄우지 않음  ok\n");

  // (5) 깨진 본 버전 파일 — 처음으로 보고 띄운다. 깨진 노트 파일 — 빈 목록
  fs.writeFileSync(seenFile, "{");
  assert.equal(createPatchNotes({ notesFile, seenFile, version: "0.7.0", hadSave: true, autoShow: true }).view().unseen, "0.7.0");
  const broken = path.join(dir, "broken.json");
  fs.writeFileSync(broken, "{");
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    assert.deepEqual(readNotes(broken), []);
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 1);
  process.stdout.write("(5) 깨진 파일  ok\n");

  // (6) 실제 data/patch-notes.json — 새 버전이 앞, 날짜 모양, 빈 줄 없음, package.json 버전의 노트가 있다
  const root = path.join(__dirname, "..", "..", "..");
  const real = readNotes(path.join(root, "data", "patch-notes.json"));
  const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "patch-notes.json"), "utf8")) as { notes: unknown[] };
  assert.equal(real.length, raw.notes.length, "모든 항목이 모양에 맞다");
  const num = (v: string): number[] => v.split(".").map(Number);
  for (let i = 1; i < real.length; i += 1) {
    const [a, b] = [num(real[i - 1]!.version), num(real[i]!.version)];
    assert.ok(a[0]! > b[0]! || (a[0] === b[0] && (a[1]! > b[1]! || (a[1] === b[1] && a[2]! > b[2]!))), `새 버전이 앞: ${real[i - 1]!.version} > ${real[i]!.version}`);
  }
  for (const n of real) {
    assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(n.lines.length > 0 && n.lines.every((l) => l.trim().length > 0), `${n.version} 줄`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
  assert.ok(real.some((n) => n.version === pkg.version), `package.json 버전 ${pkg.version} 의 노트가 있다 — 릴리스 전에 적는다`);
  process.stdout.write("(6) data/patch-notes.json 모양  ok\n");

  process.stdout.write("selftest-patch-notes: 통과 (새로 설치·업데이트 뒤 한 번·옛 버전·개발 실행·깨진 파일·데이터 모양)\n");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
