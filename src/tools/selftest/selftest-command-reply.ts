// 명령 답의 스냅샷 — 답에 실린 스냅샷이 명령 뒤에 따로 만든 스냅샷과 같고, 순번이 는다 (실행 규칙 R3, worklog/records/perf-refactor 1-4)
//
//   node dist/tools/selftest/selftest-command-reply.js
//
// 메인 처리기의 본문(src/main/manage/game-reads.ts commandReply)을 실제 게임으로 부른다. 설정창은 이 스냅샷을 그대로 쓰고 다시 부르지 않는다
import "../harness/electron-stub";
import assert from "node:assert";
import path from "node:path";
import type { Snapshot } from "../../shared/model/snapshot";
import { writeSave } from "../../save/save-file";
import { emptySave } from "../../save/normalize";
import { createGame } from "../../tx/game";
import { petName } from "../../view/text";
import { commandReply, gameReads, snapshotReply } from "../../main/manage/game-reads";
import { applyScene } from "../harness/scenes";
import { T0 } from "../harness/clock";
import { makeTmp } from "../harness/tmp-dir";
import { okCounter, printLine } from "../harness/report";

const dir = makeTmp("command-reply");
const file = path.join(dir, "save.json");
const save = applyScene(emptySave(T0), "showcase", T0);
save.lastTickAt = T0;
assert.ok(writeSave(file, save));
const partyPet = save.party.slots.find((s) => s.state === "pokemon");
const petId = partyPet?.state === "pokemon" ? partyPet.petId : "";
const game = createGame({ file, now: () => T0, petName, rand: () => 0.5 });
const reads = gameReads(game);
const send = async (req: Parameters<typeof game.send>[0]) => game.send(req, "settings");
const display = (): Snapshot["display"] => ({ hidden: false, clickThrough: false });
const t = okCounter();

// 순번만 다른 같은 스냅샷인가
const same = (a: Snapshot | null | undefined, b: Snapshot | null): void => {
  assert.ok(a && b);
  const { seq: _a, ...x } = a;
  const { seq: _b, ...y } = b;
  assert.deepStrictEqual(x, y);
};

const COMMANDS: [string, unknown][] = [
  ["shop.buy", { cmd: "shop.buy", target: "exp-candy-l", args: { reqId: "r1" } }],
  ["bag.use", { cmd: "bag.use", target: "exp-candy-s", args: { petId, reqId: "r2" } }],
  ["bag.sell", { cmd: "bag.sell", target: "exp-candy-s", args: { reqId: "r3" } }],
  ["feed", { cmd: "feed", target: petId, args: { reqId: "r4" } }],
  ["실패하는 명령", { cmd: "shop.buy", target: "no-such-item", args: { reqId: "r5" } }],
];

async function main(): Promise<void> {
  let last = snapshotReply(game, reads, display)?.seq ?? 0;
  for (const [name, raw] of COMMANDS) {
    await t.okAsync(`${name} — 답의 스냅샷이 명령 뒤 스냅샷과 같고 순번이 는다`, async () => {
      const reply = await commandReply(game, reads, send, raw, display);
      assert.ok(reply.view, "답에 스냅샷이 있다");
      assert.ok((reply.view.seq ?? 0) > last, "순번이 는다");
      last = reply.view.seq ?? 0;
      assert.deepStrictEqual(reply.view.display, display(), "화면 배치 값도 싣는다");
      same(reply.view, { ...reads.snapshot()!, display: display() });
    });
  }
  await t.okAsync("모양이 틀린 요청은 스냅샷 없이 거절한다", async () => {
    const reply = await commandReply(game, reads, send, { nope: 1 }, display);
    assert.equal(reply.ok, false);
    assert.equal(reply.view, undefined);
  });
  printLine(`selftest-command-reply: 통과 (${t.count()}건)`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
