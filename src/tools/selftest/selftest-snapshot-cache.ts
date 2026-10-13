// 스냅샷 캐시 — 캐시한 스냅샷이 캐시 없이 새로 만든 스냅샷과 늘 같다 (worklog/records/perf-refactor 3-3)
//
//   node dist/tools/selftest/selftest-snapshot-cache.js            씨앗 1~3
//   node dist/tools/selftest/selftest-snapshot-cache.js --seed 7    그 씨앗만 — 실패를 다시 볼 때
//
// 실제 게임(임시 저장)에 무작위 명령과 시간 흐름을 섞어 STEPS 번 돌린다. 매번 두 스냅샷을 견준다.
// 명령은 보유 개체·박스·가방에서 고른다. 실패하는 명령도 섞인다(실패해도 견준다). 실패하면 씨앗과 단계를 찍는다
import "../harness/electron-stub";
import assert from "node:assert";
import path from "node:path";
import type { SaveV3 } from "../../shared/save-v3";
import { writeSave } from "../../save/save-file";
import { emptySave } from "../../save/normalize";
import { createGame } from "../../tx/game";
import { petName } from "../../view/text";
import { snapshotOfGame, snapshotView, withoutPetViewCache } from "../../view/snapshot";
import { applyScene } from "../harness/scenes";
import { testPet } from "../harness/fixtures";
import { T0, seededRand } from "../harness/clock";
import { makeTmp } from "../harness/tmp-dir";
import { printLine } from "../harness/report";

const RULES = { steps: 300, seeds: [1, 2, 3], limitMs: 60_000, freezeEvery: 10 };

// 깊이 얼린다 — 스냅샷 만들기가 저장을 고치면 TypeError 가 난다(빌드 결과는 엄격 모드다). 스냅샷은 복제 없는 값(peek)을 읽으므로 고치면 안 된다
function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

type Pick = <T>(list: readonly T[]) => T | undefined;

// 지금 저장에서 명령 하나를 고른다
function randomCommand(s: SaveV3, rand: () => number, pick: Pick, step: number): { cmd: string; target: string; args: Record<string, unknown> } {
  const partyIds = s.party.slots.flatMap((x) => (x.state === "pokemon" && x.petId ? [x.petId] : []));
  const boxIds = s.boxes.flatMap((b) => b.slots.filter((x): x is string => x !== null));
  const anyPet = pick(s.pets)?.id ?? "p1";
  const box = pick(s.boxes);
  const reqId = `r${step}`;
  const choices: (() => { cmd: string; target: string; args: Record<string, unknown> })[] = [
    () => ({ cmd: "feed", target: pick(partyIds) ?? anyPet, args: { reqId } }),
    () => ({ cmd: "play", target: pick(partyIds) ?? anyPet, args: { reqId } }),
    () => ({ cmd: "party.keep", target: pick(partyIds) ?? anyPet, args: { reqId } }),
    () => ({ cmd: "party.place", target: pick(boxIds) ?? anyPet, args: { slotIndex: Math.floor(rand() * 6), reqId } }),
    () => ({ cmd: "party.swap", target: pick(boxIds) ?? anyPet, args: { slotIndex: Math.floor(rand() * 6), reqId } }),
    () => ({ cmd: "party.preset", target: "", args: { preset: Math.floor(rand() * 3), reqId } }),
    () => ({ cmd: "party.hide", target: pick(partyIds) ?? anyPet, args: { reqId } }),
    () => ({ cmd: "party.show", target: pick(partyIds) ?? anyPet, args: { reqId } }),
    () => ({ cmd: "box.move", target: box?.id ?? "", args: { slot: Math.floor(rand() * 30), toSlot: Math.floor(rand() * 30), reqId } }),
    () => ({ cmd: "box.rename", target: box?.id ?? "", args: { name: `박스${step}`, reqId } }),
    () => ({ cmd: "bag.use", target: pick(["exp-candy-s", "exp-candy-l", "rare-candy", "premium-food", "toy"]) ?? "exp-candy-s", args: { petId: pick(partyIds) ?? anyPet, reqId } }),
    () => ({ cmd: "shop.buy", target: pick(["exp-candy-l", "rare-candy", "fire-stone", "random"]) ?? "exp-candy-l", args: { reqId } }),
    () => ({ cmd: "pet.sell", target: pick(boxIds) ?? anyPet, args: { reqId } }),
    () => ({ cmd: "evolve", target: pick(partyIds) ?? anyPet, args: { to: "arcanine", reqId } }),
    () => ({ cmd: "settings.set", target: "language", args: { value: "ko", reqId } }),
  ];
  return pick(choices)!();
}

function run(seed: number): void {
  const rand = seededRand(seed);
  const pick: Pick = (list) => (list.length ? list[Math.floor(rand() * list.length)] : undefined);
  const dir = makeTmp("snapshot-cache");
  const file = path.join(dir, "save.json");
  const save = applyScene(applyScene(emptySave(T0), "showcase", T0), "presets", T0);
  save.bag["rare-candy"] = 50;
  // 파티에 가디 한 마리 — 진화하면 도감에 윈디가 생겨 박스 가디의 진화 칸이 "???" 에서 이름으로 바뀐다(저장 문맥이 박스 개체 화면 값을 바꾸는 경우)
  save.pets.push(testPet({ id: "gx", species: "growlithe", level: 30 }, T0));
  const free = save.party.slots.findIndex((x, i) => i > 0 && x.state !== "locked");
  save.party.slots[free < 0 ? 1 : free] = { state: "pokemon", petId: "gx", hidden: false };
  save.lastTickAt = T0;
  assert.ok(writeSave(file, save));
  const clock = { now: T0 };
  const game = createGame({ file, now: () => clock.now, petName, rand });
  const started = Date.now();
  // 먼저 정해진 한 번 — 캐시를 채운 뒤 파티 가디를 진화시키고 견준다
  snapshotOfGame(game);
  const evolved = game.send({ cmd: "evolve", target: "gx", args: { to: "arcanine", reqId: "fixed" } }, "settings");
  assert.ok(evolved.ok, `파티 가디 진화: ${JSON.stringify(evolved)}`);
  assert.deepStrictEqual(snapshotOfGame(game), withoutPetViewCache(() => snapshotOfGame(game)), "진화 뒤 박스 가디의 진화 칸");
  // 가방만 바뀌는 경우 — 불꽃의돌을 모두 팔면 박스 가디의 진화 칸이 "준비됨" 이 아니다(개체는 그대로, 저장의 나머지만 바뀐다)
  const stones = game.read()?.bag["fire-stone"] ?? 0;
  assert.ok(stones > 0, "불꽃의돌이 있다");
  const sold = game.send({ cmd: "bag.sell", target: "fire-stone", args: { count: stones, reqId: "sell-stones" } }, "settings");
  assert.ok(sold.ok, `불꽃의돌 팔기: ${JSON.stringify(sold)}`);
  assert.deepStrictEqual(snapshotOfGame(game), withoutPetViewCache(() => snapshotOfGame(game)), "가방이 바뀐 뒤 박스 가디의 진화 칸");
  for (let step = 0; step < RULES.steps; step += 1) {
    // 시간 — 대개 1초, 가끔 몇 분(낮·밤과 "N분 뒤" 를 넘긴다)
    clock.now += rand() < 0.1 ? Math.floor(rand() * 15) * 60_000 : 1000;
    game.tick({ workMs: rand() < 0.5 ? 1000 : 0 });
    const s = game.read();
    if (s && rand() < 0.5) game.send(randomCommand(s, rand, pick, step), "settings");
    const cached = snapshotOfGame(game);
    const fresh = withoutPetViewCache(() => snapshotOfGame(game));
    if (step % RULES.freezeEvery === 0) {
      const frozen = deepFreeze(structuredClone(game.read()!));
      withoutPetViewCache(() => snapshotView(frozen, clock.now)); // 저장을 고치면 여기서 던진다
    }
    try {
      assert.deepStrictEqual(cached, fresh);
    } catch (e) {
      printLine(`실패 — 씨앗 ${seed}, 단계 ${step} (다시: --seed ${seed})`);
      throw e;
    }
    assert.ok(Date.now() - started < RULES.limitMs, `씨앗 ${seed} 이 ${RULES.limitMs}ms 를 넘었다`);
  }
}

const at = process.argv.indexOf("--seed");
const seeds = at >= 0 ? [Number(process.argv[at + 1])] : RULES.seeds;
for (const seed of seeds) {
  run(seed);
  printLine(`  ok  씨앗 ${seed} — ${RULES.steps}단계 캐시 = 새로 만든 값`);
}
printLine(`selftest-snapshot-cache: 통과 (씨앗 ${seeds.length}개)`);
