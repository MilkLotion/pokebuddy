// 횟수 예산 — 큰 저장에서 1초 틱 한 번과 명령 한 건이 디스크 읽기·복제·스냅샷을 몇 번 하는지 센다 (worklog/records/perf-refactor 0-5)
//
//   node dist/tools/selftest/selftest-perf.js            횟수를 찍고 예산(BUDGET)과 견준다
//   node dist/tools/selftest/selftest-perf.js --json     횟수와 ms 를 JSON 한 줄로 찍는다(기준선 기록용)
//
// 판정은 횟수로만 한다. ms 는 PC 마다 달라 찍기만 한다. 예산은 "이하"다 — 단계마다 고친 만큼 낮춘다.
// 흐름은 메인의 실제 처리 순서다: 1초 틱(src/main/app/ticks.ts) → 설정창 시계(manage:snapshot), 명령(manage:command) → 답 뒤 다시 읽기(manage:snapshot) → 기기 창 열기.
// 기기 창 열기는 Electron 창 없이 같은 읽기(스냅샷 한 번)로 대신한다 (src/main/manage/devices.ts openDevice).
// 알림·코치·말풍선의 읽기는 가짜로 둬 세지 않는다. 15초마다 도는 저장 감시 다시 읽기(worker.refresh)도 세지 않는다
import "../harness/electron-stub"; // 메인 모듈보다 먼저 — src/main/app/ticks.ts 가 electron 을 부른다
import assert from "node:assert";
import path from "node:path";
import { writeSave } from "../../save/save-file";
import { emptySave } from "../../save/normalize";
import { createGame, type GameV3 } from "../../tx/game";
import { petName } from "../../view/text";
import * as snapshotModule from "../../view/snapshot";
import { CLOCK_RULES } from "../../main/app/clock";
import { createTicks } from "../../main/app/ticks";
import { commandReply, gameReads, snapshotReply } from "../../main/manage/game-reads";
import { applyScene } from "../harness/scenes";
import { T0 } from "../harness/clock";
import { makeTmp } from "../harness/tmp-dir";
import { perfCounter, type Counts } from "../harness/perf-count";
import { printLine } from "../harness/report";

// 흐름별 예산 — 0단계 기준선(2026-10-14)의 횟수. 고친 단계에서 낮춘다. 키가 없으면 보지 않는다
const BUDGET: Record<string, Counts> = {
  tick: { "fs.readFileSync": 0, structuredClone: 2, snapshotOfGame: 0 },
  clock: { "fs.readFileSync": 0, structuredClone: 1, snapshotOfGame: 1 },
  "bag.use": { "fs.readFileSync": 4, structuredClone: 5, snapshotOfGame: 4 },
  "shop.buy": { "fs.readFileSync": 4, structuredClone: 5, snapshotOfGame: 4 },
  "tick-after": { "fs.readFileSync": 0, structuredClone: 2, snapshotOfGame: 0 },
  "clock-after": { "fs.readFileSync": 0, structuredClone: 1, snapshotOfGame: 1 },
};

const ROUNDS = 3;

interface Flow {
  name: string;
  counts: Counts;
  ms: number;
}

function setup(scene: string): { game: GameV3; dir: string; clock: { now: number; mono: number }; partyPet: string } {
  const dir = makeTmp(`perf-${scene}`);
  const file = path.join(dir, "save.json");
  const save = applyScene(emptySave(T0), scene, T0);
  save.lastTickAt = T0;
  assert.ok(writeSave(file, save), "시험 저장을 쓴다");
  const partyPet = save.party.slots.find((s) => s.state === "pokemon")?.petId;
  assert.ok(partyPet, "파티 개체가 있다");
  const clock = { now: T0, mono: 0 };
  const game = createGame({ file, now: () => clock.now, flushMs: CLOCK_RULES.saveMs, mono: () => clock.mono, petName, rand: () => 0.5 });
  game.tick(); // 첫 틱은 바로 쓴다 — 기준선은 그 뒤의 평상시를 잰다
  return { game, dir, clock, partyPet: partyPet! };
}

async function measure(scene: string): Promise<Flow[]> {
  const { game, dir, clock, partyPet } = setup(scene);
  const reads = gameReads(game);
  const send = async (req: Parameters<GameV3["send"]>[0]) => game.send(req, "settings");
  const ticks = createTicks({
    sendClock: () => {},
    frozen: () => false,
    locked: () => false,
    hostWatch: () => ({ currentInfo: () => ({ state: "idle", promptAt: null }) }) as never,
    stages: () => ({ awakeIds: () => [], setState: () => {} }) as never,
    worker: () => ({ isWriter: () => true, refresh: () => {} }) as never,
    game: () => game,
    hidden: () => false,
    bubbles: { onTick: () => {}, found: () => {} } as never,
    notifierTick: () => {},
    syncCoach: () => {},
    slow: () => {},
    log: (() => {}) as never,
  });

  const counter = perfCounter(dir);
  counter.watch(snapshotModule, "snapshotOfGame");
  const flows: Flow[] = [];
  let seq = 1;
  const run = async (name: string, body: () => void | Promise<void>): Promise<void> => {
    clock.now += CLOCK_RULES.periodMs;
    clock.mono += CLOCK_RULES.periodMs;
    counter.reset();
    const t0 = performance.now();
    await body();
    flows.push({ name, counts: counter.counts(), ms: Math.round((performance.now() - t0) * 10) / 10 });
  };
  const round = async (r: number): Promise<void> => {
    // 평상시 1초 — 앱 틱, 그다음 설정창 시계가 스냅샷을 읽는다
    await run("tick", () => ticks.clock({ now: clock.now, gap: CLOCK_RULES.periodMs, seq: seq++ }));
    await run("clock", () => void snapshotReply(game, reads));
    // 명령 한 건 — 명령, 답 뒤 다시 읽기(command.ts reload), 기기 창 열기(devices.ts openDevice)
    const command = (name: string, raw: unknown) =>
      run(name, async () => {
        const reply = await commandReply(game, reads, send, raw);
        assert.ok(reply.ok, `${name} 성공: ${JSON.stringify(reply)}`);
        snapshotReply(game, reads);
        reads.snapshot();
      });
    await command("bag.use", { cmd: "bag.use", target: "exp-candy-s", args: { petId: partyPet, reqId: `perf-bag-${r}` } });
    await command("shop.buy", { cmd: "shop.buy", target: "exp-candy-l", args: { reqId: `perf-shop-${r}` } });
    // 명령 뒤의 평상시 1초 — 명령이 쓴 뒤라 메모리 값이 비어 있다(src/tx/live-save.ts write)
    await run("tick-after", () => ticks.clock({ now: clock.now, gap: CLOCK_RULES.periodMs, seq: seq++ }));
    await run("clock-after", () => void snapshotReply(game, reads));
  };
  try {
    // 같은 흐름을 ROUNDS 번 돈다. 앞의 판은 JIT 예열이다 — 마지막 판만 남긴다
    for (let r = 1; r <= ROUNDS; r += 1) {
      flows.length = 0;
      await round(r);
    }
  } finally {
    counter.stop();
  }
  return flows;
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const scenes = ["many-300", "many-1000"];
  const all: Record<string, Flow[]> = {};
  for (const scene of scenes) all[scene] = await measure(scene);
  if (json) {
    printLine(JSON.stringify(all));
    return;
  }
  for (const scene of scenes) {
    printLine(`[${scene}]`);
    for (const f of all[scene]!) {
      const c = Object.entries(f.counts).map(([k, v]) => `${k}=${v}`).join(" ");
      printLine(`  ${f.name.padEnd(9)} ${c}  (${f.ms}ms)`);
      for (const [key, max] of Object.entries(BUDGET[f.name] ?? {})) {
        assert.ok((f.counts[key] ?? 0) <= max, `${scene} ${f.name} 의 ${key} 가 예산 ${max} 를 넘었다: ${f.counts[key]}`);
      }
    }
  }
  printLine("selftest-perf: 통과 (횟수가 예산 이하)");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
