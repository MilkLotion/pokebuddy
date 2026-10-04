// 전역 시계와 1초 게임 틱 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-clock.js
//
// 테스트 프레임워크 없이 assert 만. 시각과 타이머는 가짜로 돌린다. 저장은 임시 폴더에만 쓴다.
// 시계(틱·간격·큰 틈·멈춤·구독자 오류), 게임 시간의 메모리 적용과 주기 쓰기(flushMs), 1초 틱과 긴 틱의 결과가 같은지를 본다.
// 계약은 docs/specs/modules.md "전역 시계", docs/specs/game.md "실행 상태별 시간".
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { CLOCK_RULES, createClock, type ClockTick } from "../../main/clock";
import { createGame } from "../../tx/game";
import { petName } from "../../view/text";
import { newPet } from "../../party/create";
import * as store from "../../save/save-file";
import { empty } from "../../save/v3";
import type { SaveV3 } from "../../shared/save-v3";
import { makeTmp } from "../harness/tmp-dir";

const T0 = new Date(2026, 8, 29, 10, 0, 0).getTime();
const root = makeTmp("selftest-clock");

function seed(): SaveV3 {
  const s = empty(T0);
  s.pets.push(newPet({ id: "p1", species: "pikachu", shiny: false, nature: "hardy", gender: "male", now: T0 }));
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  s.dex.unlocked = ["pikachu"];
  s.dex.obtained = ["pikachu"];
  return s;
}

try {
  // (1) 시계 — 1초마다 틱, now 와 앞 틱과의 간격. 큰 틈은 있는 그대로 준다. 멈추면 더 돌지 않는다
  {
    assert.equal(CLOCK_RULES.periodMs, 1000, "1초 (2026-09-29 사용자 결정)");
    let now = T0;
    let timer: (() => void) | null = null;
    let period = 0;
    const clock = createClock({ now: () => now, setTimer: (fn, ms) => ((timer = fn), (period = ms), 1), clearTimer: () => (timer = null) });
    const got: ClockTick[] = [];
    const off = clock.on((t) => got.push(t));
    clock.start();
    assert.equal(period, 1000);
    now += 1000;
    timer!();
    now += 1000;
    timer!();
    now += 90_000; // 절전 복귀
    timer!();
    assert.deepEqual(got.map((t) => [t.gap, t.seq]), [[0, 1], [1000, 2], [90_000, 3]], "첫 틱 간격 0, 큰 틈은 그대로");
    assert.equal(got[2]?.now, T0 + 92_000);
    assert.equal(clock.last()?.seq, 3);
    off();
    now += 1000;
    timer!();
    assert.equal(got.length, 3, "구독을 풀면 받지 않는다");
    clock.stop();
    assert.equal(timer, null, "멈추면 타이머를 지운다");

    // 구독자 하나가 던져도 다른 구독자는 받는다
    const errors: unknown[] = [];
    const c2 = createClock({ now: () => now, onError: (e) => errors.push(e) });
    let seen = 0;
    c2.on(() => {
      throw new Error("구독자 오류");
    });
    c2.on(() => (seen += 1));
    c2.tick();
    assert.equal(seen, 1);
    assert.equal(errors.length, 1);
    process.stdout.write("(1) 시계  ok\n");
  }

  // (2) 1초 틱 — 메모리에 적용하고 파일은 flushMs 마다 쓴다. 읽는 쪽은 메모리 값을 본다
  {
    const file = path.join(root, "save.json");
    assert.equal(store.writeSave(file, seed()), true);
    let now = T0;
    const game = createGame({ petName, file, now: () => now, flushMs: 15_000, mono: () => now - T0 });
    now += 1000;
    assert.ok(game.tick(), "첫 틱은 쓴다");
    const first = store.readSave(file, { repair: false }).state!.lastTickAt;
    assert.equal(first, now);
    for (let i = 0; i < 5; i++) {
      now += 1000;
      assert.ok(game.tick());
    }
    assert.equal(store.readSave(file, { repair: false }).state!.lastTickAt, first, "15초 전에는 파일을 쓰지 않는다");
    assert.equal(game.read()?.lastTickAt, now, "읽는 쪽은 메모리의 새 값을 본다");
    for (let i = 0; i < 10; i++) {
      now += 1000;
      game.tick();
    }
    assert.equal(store.readSave(file, { repair: false }).state!.lastTickAt, now, "15초가 되면 쓴다");

    // 끄기 직전 flush — 메모리 진행을 바로 쓴다
    now += 1000;
    game.tick();
    assert.equal(game.flush(), true);
    assert.equal(store.readSave(file, { repair: false }).state!.lastTickAt, now);

    // 명령은 메모리 값 위에서 돌고, 쓰면 메모리 값까지 파일에 들어간다
    now += 1000;
    game.tick();
    const reply = game.send({ cmd: "settings.set", args: { key: "sound", value: false } }, "settings");
    assert.equal(reply.ok, true);
    const disk = store.readSave(file, { repair: false }).state!;
    assert.equal(disk.lastTickAt, now, "명령 저장에 1초 틱 진행이 함께 들어간다");
    assert.equal(disk.settings.sound, false);

    // 실패한 명령은 메모리 값을 더럽히지 않는다 — 읽는 쪽은 사본을 받는다
    now += 1000;
    game.tick();
    const copy = game.read()!;
    copy.points.balance = 999_999;
    assert.notEqual(game.read()?.points.balance, 999_999, "사본을 바꿔도 메모리 값은 그대로");

    // 다른 곳이 파일을 바꾸면 메모리 진행을 버리고 파일을 따른다(클라우드 저장 받기 등)
    const other = seed();
    other.points.balance = 4321;
    other.lastTickAt = now;
    assert.equal(store.writeSave(file, other), true);
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000)); // 수정 시각이 확실히 달라지게
    assert.equal(game.read()?.points.balance, 4321, "바뀐 파일을 따른다");
    process.stdout.write("(2) 메모리 적용과 주기 쓰기  ok\n");
  }

  // (3) 쓰는 프로세스가 아니면 메모리 진행도 들고 있지 않는다
  {
    const file = path.join(root, "save-reader.json");
    assert.equal(store.writeSave(file, seed()), true);
    let now = T0;
    let writer = true;
    const game = createGame({ petName, file, now: () => now, canWrite: () => writer, flushMs: 15_000, mono: () => now - T0 });
    now += 1000;
    game.tick();
    now += 1000;
    game.tick(); // 메모리에만 있다
    writer = false;
    now += 1000;
    assert.equal(game.tick(), null, "reader 는 시간을 적용하지 않는다");
    assert.equal(game.read()?.lastTickAt, T0 + 1000, "메모리 진행을 버리고 파일을 본다");
    process.stdout.write("(3) reader  ok\n");
  }

  // (3b) 시스템 시각을 뒤로 돌려도 쓰기가 멈추지 않는다 — 간격은 단조 시계로 잰다 (검수 B1)
  {
    const file = path.join(root, "save-back.json");
    assert.equal(store.writeSave(file, seed()), true);
    let now = T0;
    let mono = 0;
    const game = createGame({ petName, file, now: () => now, flushMs: 15_000, mono: () => mono });
    now += 1000;
    mono += 1000;
    game.tick(); // 첫 틱 — 쓴다
    now -= 60 * 60_000; // 한 시간 뒤로
    let writes = 0;
    let lastDisk = store.readSave(file, { repair: false }).state!.savedAt;
    for (let i = 0; i < 60; i++) {
      now += 1000;
      mono += 1000;
      game.tick();
      const at = store.readSave(file, { repair: false }).state!.savedAt;
      if (at !== lastDisk) writes += 1;
      lastDisk = at;
    }
    assert.equal(writes, 4, "시각을 한 시간 돌려도 60초 동안 15초마다 네 번 쓴다");
    process.stdout.write("(3b) 시각 역행  ok\n");
  }

  // (3c) 주기 쓰기가 실패해도 메모리 값을 들고 있고, 다시 시도는 다음 쓰기 주기다. 실패는 주기마다 한 번 센다 (검수 B2)
  {
    const file = path.join(root, "save-fail.json");
    assert.equal(store.writeSave(file, seed()), true);
    let now = T0;
    const game = createGame({ petName, file, now: () => now, flushMs: 15_000, mono: () => now - T0 });
    now += 1000;
    game.tick(); // 첫 틱 — 쓴다
    const block = `${file}.${process.pid}.tmp`; // 임시 파일 자리에 폴더를 두면 쓰기가 실패한다 (src/platform/atomic-write.ts writeAtomic)
    fs.mkdirSync(block);
    let firstNotice = -1;
    for (let sec = 1; sec <= 60; sec++) {
      now += 1000;
      game.tick();
      assert.equal(game.read()?.lastTickAt, now, "실패해도 화면 값은 되돌아가지 않는다");
      if (firstNotice < 0 && game.saveFailing()) firstNotice = sec;
    }
    assert.equal(firstNotice, 45, "안내는 주기 쓰기 세 번 실패 뒤(15·30·45초) — 45초");
    fs.rmdirSync(block);
    for (let i = 0; i < 15; i++) {
      now += 1000;
      game.tick();
    }
    assert.equal(game.saveFailing(), false, "다시 쓰면 안내가 사라진다");
    assert.equal(store.readSave(file, { repair: false }).state!.lastTickAt, now, "들고 있던 진행이 파일에 들어간다");
    process.stdout.write("(3c) 쓰기 실패 주기와 메모리 유지  ok\n");
  }

  // (3d) 밖에서 파일이 바뀌어 메모리 값을 버려도, 파일에 안 쓴 작업 시간은 다음 틱에 다시 넣는다 (검수 A3)
  {
    const file = path.join(root, "save-work.json");
    assert.equal(store.writeSave(file, seed()), true);
    let now = T0;
    const game = createGame({ petName, file, now: () => now, flushMs: 15_000, mono: () => now - T0 });
    now += 1000;
    game.tick(); // 첫 틱 — 쓴다
    now += 1000;
    game.tick({ workMs: 1000 }); // 메모리에만 있다
    const outside = store.readSave(file, { repair: false }).state!;
    outside.points.balance = 77;
    assert.equal(store.writeSave(file, outside), true);
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    now += 1000;
    game.tick({ workMs: 0 });
    const got = game.read()!;
    assert.equal(got.points.balance >= 77, true, "밖에서 바꾼 파일을 따른다");
    assert.equal(got.totals.workMs, 1000, "버린 메모리 값의 작업 시간 1000ms 를 다시 넣었다");
    process.stdout.write("(3d) 작업 시간 보존  ok\n");
  }

  // (4) 1초 틱을 여러 번 돌려도 긴 틱 한 번과 결과가 같다 — 만복도·친밀도·기분·쿨타임 (포인트는 구간 시작 친밀도로 셈해 조금 다를 수 있다)
  {
    const a = path.join(root, "a.json");
    const b = path.join(root, "b.json");
    assert.equal(store.writeSave(a, seed()), true);
    assert.equal(store.writeSave(b, seed()), true);
    let ta = T0;
    let tb = T0;
    const ga = createGame({ petName, file: a, now: () => ta });
    const gb = createGame({ petName, file: b, now: () => tb });
    for (let i = 0; i < 600; i++) {
      ta += 1000;
      ga.tick();
    }
    for (let i = 0; i < 20; i++) {
      tb += 30_000;
      gb.tick();
    }
    const pa = store.readSave(a, { repair: false }).state!.pets[0]!;
    const pb = store.readSave(b, { repair: false }).state!.pets[0]!;
    assert.deepEqual([pa.fullness, pa.fullnessProgressMs, pa.affinity, pa.affinityProgressMs, pa.mood], [pb.fullness, pb.fullnessProgressMs, pb.affinity, pb.affinityProgressMs, pb.mood], "10분 — 1초 × 600 과 30초 × 20 이 같다");
    process.stdout.write("(4) 1초 틱과 긴 틱의 결과  ok\n");
  }

  process.stdout.write("통과\n");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
