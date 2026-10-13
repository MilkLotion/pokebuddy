// 저장 정본은 메모리 — 쓴 뒤에도 메모리 값을 쓰고, 밖에서 바뀐 파일은 놓치지 않는다 (실행 규칙 R5, worklog/records/perf-refactor 2-1·2-2)
//
//   node dist/tools/selftest/selftest-live-save.js
//
// 보는 것 (G80 의 위험 R1~R9)
//   쓴 뒤 읽기       디스크를 다시 읽지 않고 쓴 값과 같다
//   밖의 쓰기        같은 크기·같은 수정 시각으로 덮어도 파일 번호가 바뀌어 잡는다(R2)
//   정규화 왕복      메모리 값이 디스크를 다시 읽어 정규화한 값과 같다(R4) — 명령 여러 개 뒤
//   저장 감시        이 프로세스의 쓰기는 다시 읽지 않고 받는다(adopt). 밖의 쓰기는 읽는다(R9)
//   실행기 복제      read 가 사본이면 다시 복제하지 않는다 — 결과가 복제할 때와 같다(레벨업 업적 포함). 실패한 거래는 메모리 값을 바꾸지 않는다
import "../harness/electron-stub";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import type { SaveV3 } from "../../shared/save-v3";
import { readSave, writeSave } from "../../save/save-file";
import { emptySave } from "../../save/normalize";
import { createSaveWatch } from "../../save/save-watch";
import { createLiveSave } from "../../tx/live-save";
import { createGame } from "../../tx/game";
import { createExecutor } from "../../tx/executor";
import { HANDLERS } from "../../tx/command-table";
import { petName } from "../../view/text";
import { applyScene } from "../harness/scenes";
import { T0 } from "../harness/clock";
import { makeTmp } from "../harness/tmp-dir";
import { perfCounter } from "../harness/perf-count";
import { okCounter, printLine } from "../harness/report";

const t = okCounter();
const scene = (): SaveV3 => {
  const s = applyScene(emptySave(T0), "showcase", T0);
  s.lastTickAt = T0;
  return s;
};
const partyPetOf = (s: SaveV3): string => {
  const slot = s.party.slots.find((x) => x.state === "pokemon");
  return slot?.state === "pokemon" ? (slot.petId ?? "") : "";
};

t.ok("쓴 뒤 읽기 — 디스크를 다시 읽지 않고 쓴 값과 같다", () => {
  const dir = makeTmp("live-save");
  const file = path.join(dir, "save.json");
  assert.ok(writeSave(file, scene()));
  const live = createLiveSave({ file });
  const first = live.read();
  assert.ok(first);
  first.points.balance += 7;
  assert.ok(live.write(first, "test"));
  const counter = perfCounter(dir);
  try {
    const again = live.read();
    assert.equal(counter.counts()["fs.readFileSync"], 0, "디스크를 읽지 않는다");
    assert.deepStrictEqual(again, first);
    assert.notStrictEqual(again, first, "읽는 쪽에는 사본을 준다");
  } finally {
    counter.stop();
  }
});

t.ok("밖의 쓰기 — 같은 크기·같은 수정 시각으로 덮어도 잡는다(파일 번호)", () => {
  const dir = makeTmp("live-save");
  const file = path.join(dir, "save.json");
  // 수정 시각이 1초 단위인 파일 시스템을 흉내 낸다 — 그래야 두 쓰기의 수정 시각이 정말 같다(utimes 는 1ms 아래를 맞추지 못한다)
  const fsObj = fs as unknown as { statSync: (p: fs.PathLike) => fs.Stats };
  const realStat = fsObj.statSync;
  fsObj.statSync = (p) => {
    const st = realStat(p);
    if (!String(p).startsWith(dir)) return st;
    return Object.assign(Object.create(Object.getPrototypeOf(st) as object) as fs.Stats, st, { mtimeMs: Math.floor(st.mtimeMs / 1000) * 1000 });
  };
  try {
    assert.ok(writeSave(file, scene()));
    const live = createLiveSave({ file });
    const mine = live.read()!;
    let second = Math.floor(Date.now() / 1000);
    while (Math.floor(Date.now() / 1000) === second) second = Math.floor(Date.now() / 1000); // 다음 초의 시작에서 — 두 쓰기가 같은 초에 들게
    assert.ok(live.write(mine, "test"));
    const stat = fsObj.statSync(file);
    // 밖에서 숫자 한 자리만 바꾼 저장 — 크기가 같다
    const other = structuredClone(mine);
    other.points.balance = mine.points.balance >= 10 ? mine.points.balance - 1 : mine.points.balance + 1;
    assert.equal(String(other.points.balance).length, String(mine.points.balance).length, "자릿수가 같다");
    assert.ok(writeSave(file, other));
    const after = fsObj.statSync(file);
    assert.equal(after.size, stat.size, "크기가 같다");
    assert.equal(after.mtimeMs, stat.mtimeMs, "수정 시각이 같다");
    assert.equal(live.read()?.points.balance, other.points.balance, "밖의 값을 읽는다");
  } finally {
    fsObj.statSync = realStat;
  }
});

t.ok("정규화 왕복 — 명령 여러 개 뒤 메모리 값이 디스크를 다시 읽은 값과 같다(R4)", () => {
  const dir = makeTmp("live-save");
  const file = path.join(dir, "save.json");
  const s = scene();
  assert.ok(writeSave(file, s));
  const petId = partyPetOf(s);
  const game = createGame({ file, now: () => T0, petName, rand: () => 0.5 });
  const cmds: [string, string, Record<string, unknown>][] = [
    ["shop.buy", "exp-candy-l", { reqId: "a" }],
    ["bag.use", "exp-candy-l", { petId, reqId: "b" }],
    ["play", petId, { reqId: "c" }],
    ["bag.sell", "exp-candy-s", { reqId: "d" }],
  ];
  for (const [cmd, target, args] of cmds) {
    const r = game.send({ cmd, target, args }, "settings");
    assert.ok(r.ok, `${cmd}: ${JSON.stringify(r)}`);
    // JSON 으로 견준다 — 거래 기록의 결과에 남는 undefined 키는 파일·IPC 에서 빠지는 같은 값이다
    assert.deepStrictEqual(JSON.parse(JSON.stringify(game.read())), readSave(file).state, `${cmd} 뒤 메모리 = 디스크`);
  }
});

t.ok("실패한 거래는 메모리 값을 바꾸지 않는다", () => {
  const dir = makeTmp("live-save");
  const file = path.join(dir, "save.json");
  assert.ok(writeSave(file, scene()));
  const game = createGame({ file, now: () => T0, petName, rand: () => 0.5 });
  const before = game.read();
  const r = game.send({ cmd: "shop.buy", target: "no-such-item", args: { reqId: "x" } }, "settings");
  assert.equal(r.ok, false);
  assert.deepStrictEqual(game.read(), before);
});

t.ok("실행기 — read 가 사본이면 다시 복제하지 않아도 결과가 같다(레벨업 업적 포함)", () => {
  const base = scene();
  const petId = partyPetOf(base);
  base.bag["rare-candy"] = 99;
  const run = (readsCopy: boolean): SaveV3 => {
    let disk = structuredClone(base);
    const ex = createExecutor({ read: () => structuredClone(disk), write: (x) => ((disk = x), true), now: () => T0, rand: () => 0.5, readsCopy }, HANDLERS);
    for (let i = 0; i < 40; i += 1) ex.run({ id: `r${i}`, name: "bag.use", args: { itemId: "rare-candy", petId } });
    ex.run({ id: "bad", name: "bag.use", args: { itemId: "no-such", petId } });
    return disk;
  };
  const copied = run(false);
  const direct = run(true);
  assert.deepStrictEqual(direct, copied);
  assert.ok(Object.values(direct.achievements).some((a) => a.achievedAt !== null), "레벨업 업적이 달성된다");
});

t.ok("저장 감시 — 이 프로세스의 쓰기는 다시 읽지 않고, 밖의 쓰기는 읽는다(R9)", () => {
  const dir = makeTmp("live-save");
  const paths = { save: path.join(dir, "save.json"), saveLock: path.join(dir, "save.lock") };
  const s = scene();
  assert.ok(writeSave(paths.save, s));
  const sw = createSaveWatch({ paths, reclaimMs: 60_000 });
  try {
    const game = createGame({ file: paths.save, now: () => T0, petName, rand: () => 0.5, onWritten: (stamp, save) => sw.adopt(stamp, save) });
    const r = game.send({ cmd: "shop.buy", target: "exp-candy-l", args: { reqId: "w1" } }, "settings");
    assert.ok(r.ok);
    const counter = perfCounter(dir);
    try {
      sw.refresh();
      assert.equal(counter.counts()["fs.readFileSync"], 0, "자기 쓰기는 다시 읽지 않는다");
    } finally {
      counter.stop();
    }
    assert.deepStrictEqual(sw.save(), game.read(), "감시 값이 쓴 값과 같다");
    const other = structuredClone(game.read()!);
    other.points.balance += 1234;
    assert.ok(writeSave(paths.save, other));
    sw.refresh();
    assert.equal(sw.save()?.points.balance, other.points.balance, "밖의 쓰기는 읽는다");
  } finally {
    sw.stop();
  }
});

printLine(`selftest-live-save: 통과 (${t.count()}건)`);
