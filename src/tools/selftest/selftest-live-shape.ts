// 화면 모양 고정 — 시간만 흐를 때 설정창 스냅샷의 "모양"이 바뀌는 경로를 찾는다 (실행 규칙 R1, worklog/records/perf-refactor 0-4)
//
//   node dist/tools/selftest/selftest-live-shape.js                     새 경로가 생기면 실패
//   node dist/tools/selftest/selftest-live-shape.js --update-baseline   기준 목록을 지금 경로로 다시 적는다
//
// 모양은 설정창이 다시 그릴지 정하는 값이다 — 렌더러의 structureOf(src/renderer/ui/live-draw.ts)를 설정창과 같은 경로 목록으로 부른다.
// 모양이 바뀌면 설정창은 본문·모달·기기 창을 통째로 다시 그린다. 시간으로만 바뀌는 값이 모양에 들면 매초 다시 그린다
// (2026-10-11 cbebb60 이 day.progress·day.leftMs 를 더해 배틀 기기 창 초상이 깜빡였다).
// 장면: 쇼케이스 + 배틀 파티 + 밥 쿨타임·버프가 있는 파티 개체 + 부화 중인 알. 게임 시간 낮의 한가운데서 90초를 1초씩 흘린다(낮·밤 경계를 넘지 않는다).
// 지금 있는 어긋남은 기준 목록(src/tools/check/baseline/live-shape.txt)에 있다. 거기 없는 경로가 바뀌면 실패한다
import assert from "node:assert";
import path from "node:path";
import { writeSave } from "../../save/save-file";
import { emptySave } from "../../save/normalize";
import { newEgg } from "../../egg/pool";
import { createGame } from "../../tx/game";
import { petName } from "../../view/text";
import { snapshotOfGame } from "../../view/snapshot";
import { CLOCK_RULES } from "../../main/app/clock";
import { SNAPSHOT_LIVE_PATHS } from "../../shared/live-keys";
import { compare, writeBaseline } from "../check/baseline";
import { applyScene } from "../harness/scenes";
import { at } from "../harness/clock";
import { makeTmp } from "../harness/tmp-dir";
import { webModule } from "../harness/web-module";
import { printLine } from "../harness/report";

const NAME = "live-shape";
const RULES = {
  startMin: 2, // T0(낮의 시작) 뒤 2분 — 낮은 0~10분이다(src/shared/clock.ts)
  seconds: 90, // 분 단위 글자가 한 번은 넘어가게 1분보다 길게
  warmup: 3, // 장면을 만든 뒤 첫 틱들은 해금·업적 정리로 모양이 바뀐다 — 재기 전에 흘린다
};

const live = webModule<{ structureOf: (view: unknown, extra?: ReadonlySet<string>, paths?: readonly string[]) => string }>("renderer/ui/live-draw.js");
// 설정창과 같은 모양 — 시간 값의 경로(src/shared/live-keys.ts SNAPSHOT_LIVE_PATHS)를 뺀다 (src/renderer/manage/live.ts shapeOf)
const structureOf = (view: unknown): string => live.structureOf(view, undefined, SNAPSHOT_LIVE_PATHS);

// 두 값에서 다른 경로 — 배열 칸 번호는 [] 로 접는다(칸이 달라도 같은 경로로 센다)
export function diffPaths(a: unknown, b: unknown, at = ""): string[] {
  if (Object.is(a, b)) return [];
  const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object";
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: string[] = a.length === b.length ? [] : [`${at}[]#길이`];
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) out.push(...diffPaths(a[i], b[i], `${at}[]`));
    return out;
  }
  if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const out: string[] = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...diffPaths(a[k], b[k], at ? `${at}.${k}` : k));
    return out;
  }
  return [at || "(뿌리)"];
}

function scene(start: number) {
  const dir = makeTmp(NAME);
  const file = path.join(dir, "save.json");
  const save = applyScene(applyScene(emptySave(start), "showcase", start), "battle", start);
  const first = save.party.slots.find((s) => s.state === "pokemon");
  const pet = save.pets.find((p) => first?.state === "pokemon" && p.id === first.petId);
  assert.ok(pet, "파티 개체가 있다");
  pet.feedCooldownMs = 90_000;
  pet.buffs = [{ kind: "premium-food", remainMs: 45 * 60_000 }];
  const egg = newEgg(save, "random", start);
  egg.remainMs = 10 * 60_000;
  egg.ready = false;
  save.eggs.push(egg);
  save.lastTickAt = start;
  assert.ok(writeSave(file, save), "시험 저장을 쓴다");
  const clock = { now: start, mono: 0 };
  const game = createGame({ file, now: () => clock.now, flushMs: CLOCK_RULES.saveMs, mono: () => clock.mono, petName, rand: () => 0.5 });
  return { game, clock };
}

function main(): void {
  const start = at(RULES.startMin);
  const { game, clock } = scene(start);
  for (let w = 0; w < RULES.warmup; w += 1) {
    clock.now += CLOCK_RULES.periodMs;
    clock.mono += CLOCK_RULES.periodMs;
    game.tick({ workMs: CLOCK_RULES.periodMs });
  }
  let prev = JSON.parse(structureOf(snapshotOfGame(game))) as unknown;
  const changed = new Map<string, number>(); // 경로 → 바뀐 초 수
  for (let s = 1; s <= RULES.seconds; s += 1) {
    clock.now += CLOCK_RULES.periodMs;
    clock.mono += CLOCK_RULES.periodMs;
    game.tick({ workMs: CLOCK_RULES.periodMs }); // 에이전트가 일하는 중 — 포인트가 오른다
    const next = JSON.parse(structureOf(snapshotOfGame(game))) as unknown;
    for (const p of new Set(diffPaths(prev, next))) changed.set(p, (changed.get(p) ?? 0) + 1);
    prev = next;
  }

  // 시험이 헛돌지 않는지 — 모양을 바꾸는 명령 뒤에는 모양이 달라야 한다
  const before = structureOf(snapshotOfGame(game));
  const reply = game.send({ cmd: "shop.buy", target: "exp-candy-l", args: { reqId: "live-shape" } }, "settings");
  assert.ok(reply.ok, `구매 성공: ${JSON.stringify(reply)}`);
  assert.notEqual(structureOf(snapshotOfGame(game)), before, "가방이 바뀌면 모양이 달라진다");

  const findings = [...changed].map(([p, n]) => `${p}: ${RULES.seconds}초 중 ${n}번 바뀜`);
  const kinds = [...changed.keys()].map((p) => `${p}: 시간만 흘러도 모양이 바뀐다`);
  if (process.argv.includes("--update-baseline")) {
    writeBaseline(NAME, kinds);
    printLine(`selftest-${NAME}: 기준 목록을 다시 적었다 (${kinds.length}건)`);
    return;
  }
  for (const f of findings) printLine(`  ${f}`);
  const res = compare(NAME, kinds);
  assert.ok(res.ok, `시간만 흘러도 모양이 바뀌는 새 경로 ${res.fresh.length}건:\n${res.fresh.join("\n")}`);
  printLine(`selftest-${NAME}: 통과 (기준 목록 ${res.findings.length}건${res.gone.length ? `, 줄일 수 있는 것 ${res.gone.length}건` : ""})`);
}

main();
