// 저장 형식 — 들여쓴 옛 암호화 저장과 들여쓰지 않은 새 암호화 저장을 둘 다 같은 값으로 읽는다 (worklog/records/perf-refactor 2-9)
//
//   node dist/tools/selftest/selftest-save-format.js
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { sealText, setSaveKey, newSaveKey, unsealText } from "../../save/crypt";
import { readSave, writeSave } from "../../save/save-file";
import { emptySave } from "../../save/normalize";
import { applyScene } from "../harness/scenes";
import { T0 } from "../harness/clock";
import { makeTmp } from "../harness/tmp-dir";
import { okCounter, printLine } from "../harness/report";

const t = okCounter();
const dir = makeTmp("save-format");
const key = newSaveKey();
setSaveKey(key);
const save = applyScene(emptySave(T0), "showcase", T0);

try {
  t.ok("새 형식 — 들여쓰지 않고 쓰고, 다시 읽으면 같은 값이다", () => {
    const file = path.join(dir, "new.json");
    assert.ok(writeSave(file, save));
    const text = unsealText(key, fs.readFileSync(file));
    assert.ok(text !== null && !text.includes("\n  "), "들여쓰지 않는다");
    assert.deepStrictEqual(readSave(file).state, readSave(file).state);
    assert.equal(readSave(file).state?.pets.length, save.pets.length);
  });

  t.ok("옛 형식 — 들여쓴 암호화 저장도 같은 값으로 읽는다", () => {
    const oldFile = path.join(dir, "old.json");
    const newFile = path.join(dir, "new2.json");
    fs.writeFileSync(oldFile, sealText(key, `${JSON.stringify(save, null, 2)}\n`));
    assert.ok(writeSave(newFile, save));
    assert.deepStrictEqual(readSave(oldFile).state, readSave(newFile).state);
  });

  t.ok("새 형식이 옛 형식보다 작다", () => {
    const oldSize = sealText(key, `${JSON.stringify(save, null, 2)}\n`).length;
    const newSize = fs.statSync(path.join(dir, "new.json")).size;
    assert.ok(newSize < oldSize, `${newSize} < ${oldSize}`);
  });
} finally {
  setSaveKey(null);
}

printLine(`selftest-save-format: 통과 (${t.count()}건)`);
