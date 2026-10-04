// 앱 명령 경로 검사 (저장 v3) — 명령이 커맨드 처리기와 거래 실행기를 거쳐 파일까지 간다. 실제 사용자 저장 접근 없음
// 그림 준비 실패·mailbox·실제 CLI·같은 요청 식별자·저장 실패·잠금 상실을 본다
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCommands } from "../../main/commands";
import { createGame } from "../../tx/game";
import { petName } from "../../view/text";
import { createSaveParty } from "../../save/save-party";
import { applyStarter } from "../../party/starter";
import * as store from "../../save/save-file";
import { emptySave as emptyV3 } from "../../save/normalize";
import { sendToWriter as send } from "../../save/command-channel";
import type { Command } from "../../shared/command";
import { makeTmp } from "../harness/tmp-dir";

const T = new Date(2026, 8, 18, 12).getTime();

async function main(): Promise<void> {
  // ── 실제 앱 경로 (저장 v3) — 명령이 거래 실행기를 거쳐 파일까지 간다 ──
  const dir = makeTmp("v3");
  const gameDir = path.join(dir, ".claude", "pokebuddy");
  const paths = { save: path.join(gameDir, "save.json"), saveLock: path.join(gameDir, "save.lock"), companionLock: path.join(gameDir, "companion.lock"), mailbox: path.join(gameDir, "mailbox") };
  fs.mkdirSync(gameDir, { recursive: true });

  const seed = emptyV3(T);
  applyStarter(seed, "charmander", T, () => 0);
  seed.pets[0]!.level = 16; // 레벨 조건을 채워 진화할 수 있게
  seed.points.balance = 5000;
  // 박스 개체 하나 — 박스 개체도 크기는 정한다 (2026-09-30 박스 개체 상세 = 파티 상세)
  seed.pets.push({ ...structuredClone(seed.pets[0]!), id: "b-pet" });
  seed.boxes[0]!.slots[0] = "b-pet";
  store.writeSave(paths.save, seed);

  const game = createGame({ petName, file: paths.save, rand: () => 0 });
  const party = createSaveParty({ send: game.send, paths });
  let artOk = false;
  let beforeArt: (() => void) | undefined;
  let changes = 0;
  let stageHold: Promise<void> | null = null; // 있으면 무대 갱신이 이것을 기다린다 — 처음 나오는 종의 그림을 받는 중인 무대
  let frozen = false; // 앱의 두 PC 규칙 멈춤 — 켜면 snapshot 밖의 명령을 거른다(guard)
  const commands = createCommands({ mailboxDir: paths.mailbox, party, game,
    stage: { petIds: () => [], size: () => ({ w: 1, h: 1 }), visible: () => true },
    settings: { hidden: () => false, setHidden() {}, clickThrough: () => false, setClickThrough() {} },
    quit() {}, prepareLook: async () => { beforeArt?.(); return artOk; }, onChanged: async () => { changes++; if (stageHold) await stageHold; },
    guard: (c) => (frozen && c.cmd !== "snapshot" ? "halted" : null),
  });
  const evolveCmd: Command = { cmd: "evolve", target: "p1", from: "cli" };
  try {
    assert.ok(party.isWriter(), "잠금을 잡아 writer 로 시작");
    const before = structuredClone(party.save());
    assert.equal((await commands.dispatcher.dispatch(evolveCmd)).reason, "art-missing");
    assert.deepEqual(party.save(), before, "그림 실패 시 변경 없음");

    artOk = true;
    assert.ok((await commands.dispatcher.dispatch(evolveCmd)).ok, "그림을 받으면 진화한다");
    assert.equal(store.readSave(paths.save, { repair: false }).state!.pets[0]!.species, "charmeleon", "진화가 디스크에 저장");
    assert.equal(changes, 1, "저장 뒤 무대 갱신");

    // 박스 명령 — 관리 창이 앱 명령 경로로 보낸다. 목록에 빠지면 unknown-cmd 가 된다
    const renamed = await commands.dispatcher.dispatch({ cmd: "box.rename", target: "b1", args: { name: "내 박스" }, from: "settings" });
    assert.ok(renamed.ok, `box.rename 이 앱 명령 경로에서 동작 (${renamed.reason})`);
    assert.equal(store.readSave(paths.save, { repair: false }).state!.boxes[0]!.name, "내 박스");
    assert.ok((await commands.dispatcher.dispatch({ cmd: "box.sort", target: "b1", args: { by: "dex" }, from: "settings" })).ok, "box.sort 가 앱 명령 경로에서 동작");

    // 박스 개체 — 크기는 바뀌고 자리(home)는 거절한다
    const boxSize = await commands.dispatcher.dispatch({ cmd: "pet.set", target: "b-pet", args: { size: 3 }, from: "settings" });
    assert.ok(boxSize.ok, `박스 개체 크기 (${boxSize.reason})`);
    assert.equal(store.readSave(paths.save, { repair: false }).state!.pets.find((p) => p.id === "b-pet")!.size, 2, "크기 3단계 = 배율 2");
    const boxHome = await commands.dispatcher.dispatch({ cmd: "pet.set", target: "b-pet", args: { home: { dx: 1, dy: 1 } }, from: "settings" });
    assert.equal(boxHome.ok, false, "박스 개체의 자리는 정하지 않는다");

    // 저장 명령은 무대 갱신을 기다리지 않고 답한다 — 그림을 받는 동안 관리 창이 멈춰 보이지 않게 (worklog/records/response-latency/record.md)
    let release = (): void => {};
    stageHold = new Promise<void>((r) => { release = r; });
    const heldChanges = changes;
    const quick = await Promise.race([
      commands.dispatcher.dispatch({ cmd: "box.rename", target: "b1", args: { name: "빠른 답" }, from: "settings" }),
      new Promise<null>((r) => setTimeout(() => r(null), 1000)),
    ]);
    assert.ok(quick?.ok, "무대가 그림을 받는 중이어도 저장 명령이 바로 답한다");
    assert.equal(changes, heldChanges + 1, "답을 먼저 해도 무대 갱신은 한 번 시작한다");
    release();
    stageHold = null;

    // mailbox 왕복 — CLI·확장의 요청이 writer 에 닿는다
    commands.setWriter(true);
    const bought = await send(paths.mailbox, { cmd: "shop.buy", target: "exp-candy-xs", from: "cli" });
    assert.ok(bought.ok, "mailbox → dispatcher → 실행기");
    assert.equal(store.readSave(paths.save, { repair: false }).state!.bag["exp-candy-xs"], 1);

    // 실제 CLI → 임시 HOME mailbox 왕복
    const child = await promisify(execFile)(process.execPath, [path.resolve(__dirname, "../../../bin/pokebuddy"), "game", "snapshot"], {
      windowsHide: true, env: { ...process.env, HOME: dir, USERPROFILE: dir },
    });
    const snapshot = JSON.parse(child.stdout);
    assert.equal(snapshot.pets.length, 2, "실제 CLI 가 저장 v3 스냅샷을 받는다 — 파티 1 + 박스 1");
    assert.equal(snapshot.points, party.save()!.points.balance);

    // 같은 요청 식별자는 한 번만 반영한다
    const once = await commands.dispatcher.dispatch({ cmd: "shop.buy", target: "exp-candy-xs", args: { reqId: "same" }, from: "cli" });
    const again = await commands.dispatcher.dispatch({ cmd: "shop.buy", target: "exp-candy-xs", args: { reqId: "same" }, from: "cli" });
    assert.ok(once.ok && again.ok);
    assert.equal(again.replayed, true, "두 번째는 재생");
    assert.equal(store.readSave(paths.save, { repair: false }).state!.bag["exp-candy-xs"], 2, "한 번만 늘었다");

    // 멈춘 동안 — 처리기로 보내지 않고 거른다. 직접 부름·mailbox 모두 같은 통로라 함께 막힌다. 열어 둔 명령은 지난다
    frozen = true;
    const bagBefore = store.readSave(paths.save, { repair: false }).state!.bag["exp-candy-xs"];
    assert.equal((await commands.dispatcher.dispatch({ cmd: "shop.buy", target: "exp-candy-xs", from: "settings" })).reason, "halted", "멈춘 동안 저장 명령은 halted");
    assert.equal((await send(paths.mailbox, { cmd: "shop.buy", target: "exp-candy-xs", from: "cli" })).reason, "halted", "mailbox 로 온 명령도 halted");
    assert.equal((await commands.click("p1")).reason, "halted", "무대 클릭(놀아주기)도 halted");
    assert.ok((await commands.dispatcher.dispatch({ cmd: "snapshot", from: "cli" })).ok, "열어 둔 명령은 지난다");
    assert.equal(store.readSave(paths.save, { repair: false }).state!.bag["exp-candy-xs"], bagBefore, "멈춘 동안 저장이 바뀌지 않는다");
    frozen = false;

    // 숨기기·보이기도 target 이 없으면 args.petId 를 본다 — 다른 개체 명령과 같은 규칙 (94 문서 4-12)
    const hideByArgs = await commands.dispatcher.dispatch({ cmd: "party.hide", args: { petId: "p1" }, from: "cli" });
    assert.notEqual(hideByArgs.reason, "bad-args", "party.hide 가 args.petId 를 받는다");
    const showByArgs = await commands.dispatcher.dispatch({ cmd: "party.show", args: { petId: "p1" }, from: "cli" });
    assert.notEqual(showByArgs.reason, "bad-args", "party.show 가 args.petId 를 받는다");
    assert.equal((await commands.dispatcher.dispatch({ cmd: "party.show", from: "cli" })).reason, "bad-args", "대상 인자가 없으면 bad-args — 실행기와 같다 (94 항목 9-5-2)");

    // 파티 명령도 받은 요청 식별자를 그대로 넘긴다 — 설정창이 다시 보낸 요청은 재생된다 (94 문서 9-2-3, docs/specs/game.md "요청 ID로 중복을 막는다")
    for (const c of [
      { cmd: "party.hide", target: "p1", args: { reqId: "hide-same" } },
      { cmd: "party.show", target: "p1", args: { reqId: "show-same" } },
      { cmd: "pet.set", target: "p1", args: { size: 2, reqId: "size-same" } },
      { cmd: "pet.set", target: "p1", args: { home: { dx: -3, dy: 0 }, reqId: "home-same" } },
    ] as const) {
      const first = await commands.dispatcher.dispatch({ ...c, from: "settings" });
      const second = await commands.dispatcher.dispatch({ ...c, from: "settings" });
      assert.ok(first.ok && !first.replayed, `${c.cmd} 첫 요청 (${first.reason})`);
      assert.equal(second.replayed, true, `${c.cmd} 같은 reqId 는 재생`);
    }

    // 저장에 닿지 못하면 실패로 답한다
    const beforeFailureChanges = changes;
    const diskBefore = fs.readFileSync(paths.save, "utf8");
    const stateBefore = structuredClone(party.save());
    fs.unlinkSync(paths.save); fs.mkdirSync(paths.save);
    const failed = await commands.dispatcher.dispatch({ cmd: "shop.buy", target: "party-slot", from: "menu" });
    assert.ok(!failed.ok, "저장 실패를 성공으로 응답하지 않음");
    assert.deepEqual(party.save(), stateBefore, "저장 실패 시 메모리 상태 그대로");
    assert.equal(changes, beforeFailureChanges, "실패 시 무대 갱신 없음");
    assert.ok(!(await party.setShown("p1", false)).ok, "숨기기도 성공으로 응답하지 않음");
    fs.rmdirSync(paths.save); fs.writeFileSync(paths.save, diskBefore);
    party.refresh();

    // 잠금을 잃으면 남의 저장에 쓰지 않는다. 자기 mailbox 로 되보내지도 않는다
    const beforeLost = structuredClone(party.save());
    fs.writeFileSync(paths.saveLock, String(process.pid + 1000000));
    assert.equal((await commands.dispatcher.dispatch({ cmd: "shop.buy", target: "exp-candy-xs", from: "cli" })).reason, "not-writer");
    assert.deepEqual(party.save(), beforeLost, "잠금 상실 시 변경 없음");
    fs.writeFileSync(paths.saveLock, String(process.pid));
  } finally {
    commands.stop(); party.stop(); fs.rmSync(dir, { recursive: true, force: true });
  }

  process.stdout.write("통과: 앱 명령 경로(그림·mailbox·CLI·중복·멈춤 거르기·저장 실패·잠금)\n");
}
void main().catch((e) => { console.error(e); process.exitCode = 1; });
