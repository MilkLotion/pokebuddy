// 저장 v2 · writer 잠금 · mailbox · 커맨드 처리기 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-legacy.js (npm run selftest 가 넷을 차례로 돈다)
//
// 테스트 프레임워크 없이 assert 만. 임시 폴더에서만 돌고 끝나면 지운다 — 사용자의 ~/.claude/pokebuddy/ 는 건드리지 않는다.
// 정규화·이전은 값만으로, 파일·잠금·mailbox 는 실제 파일·프로세스로 확인한다.
// v1 모양은 리터럴 픽스처(아래 SaveV1 · v1Pet · freshV1)로 만든다 — 옛 game/economy.js 의 newState · newPet · start 가 만들던 모양 그대로.
//   game/ 에 기대지 않는다 — game/ 은 S2 정리에서 지웠다
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bridgeMailbox } from "../../main/commands";
import * as mailbox from "../../save/command-channel";
import * as rules from "../../save/rules";
import { SAVE_V2_RULES } from "../../save/v2/rules";
import { emptyPet, emptySaveV2, normalizeSaveV2 } from "../../save/v2/normalize";
import { writeAtomic } from "../../platform/atomic-write";
import { writeSaveV2 } from "../harness/v2-save";
import * as writer from "../../platform/pid-lock";
import { isPidAlive } from "../../platform/pid";
import type { Command, CommandResult } from "../../shared/command";
import type { CommandName } from "../../shared/names/commands";
import type { LogEntry } from "../../shared/save-v3";
import type { SaveV2 } from "../../save/v2/types";
import { makeTmp } from "../harness/tmp-dir";
import { sleep, waitFor } from "../harness/wait";
import { createDispatcher } from "../../tx/dispatcher";
import { printLine as out } from "../harness/report";

const save = { ...rules, ...writer, ...mailbox, isPidAlive }; // 배럴 없이 모듈을 직접

const { SAVE_RULES } = save;
const T0 = new Date(2026, 8, 17, 10, 0, 0).getTime(); // 2026-09-17 10:00 로컬
const TODAY = "2026-09-17";


// 있어야 하는 값 — 없으면 여기서 실패한다 (없는 값에 점을 찍어 TypeError 로 죽는 대신)
function some<T>(v: T | null | undefined, what = "값"): T {
  assert.ok(v != null, `${what} 이(가) 없다`);
  return v;
}

// 정규화 결과가 있어야 하는 자리 — 파손(null)이면 여기서 실패한다
const norm = (raw: unknown, what = "정규화 결과"): SaveV2 => some(normalizeSaveV2(raw), what);

// 살아 있는 다른 프로세스 — lock 이 "살아 있는 pid" 를 가리는지 볼 때 쓴다
function spawnIdle(): { pid: number; kill: () => void; exited: Promise<unknown> } {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
  const exited = new Promise((r) => child.on("exit", r));
  return { pid: some(child.pid, "자식 pid"), kill: () => child.kill(), exited };
}

// 이미 끝난 pid — 잠깐 떠서 바로 끝나는 프로세스의 pid
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore", windowsHide: true });
  await new Promise((r) => child.on("exit", r));
  return some(child.pid, "자식 pid");
}

const tmpRoot = makeTmp("selftest-save");
const tmpDir = (name: string): string => {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const ZERO_TOTALS = { workMs: 0, presenceMs: 0, tokens: 0, turns: 0, days: 0, fed: 0, played: 0 };
const freshDaily = (date: string) => ({ date, gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 });

// 잘못된 모양을 일부러 넣는 자리 — 타입은 맞지 않지만 런타임 거절을 본다
const asCommand = (v: unknown): Command => v as Command;
const asResult = (v: unknown): CommandResult => v as CommandResult;

// ── v1 픽스처 — 1판 game/economy.js 의 저장 모양 ──────────────────────────────
// { v:1, active: "<종>#<n>", party: { "<종>#<n>": {...} }, daily(파티 전체 하나 + streak), acc(누적기), log }
interface V1Pet {
  species: string;
  nick: string | null;
  affinity: number;
  stage: number;
  mood: number;
  shiny: boolean;
  since: number;
  fedAt: number | null;
  playedAt: number | null;
  evolved: string[];
}
interface V1Daily {
  date: string;
  gained: number;
  feeds: number;
  plays: number;
  pokes: number;
  presence: number;
  work: number;
  turns: number;
  streak?: number;
}
interface SaveV1 {
  v: 1;
  points: number;
  active: string | null;
  party: Record<string, V1Pet>;
  inventory: Record<string, number>;
  daily: V1Daily;
  log: LogEntry[];
  acc: Record<string, unknown>;
}

// economy.newPet — 새 마리 (시작 기분 60)
const v1Pet = (species: string, since: number): V1Pet => ({
  species,
  nick: null,
  affinity: 0,
  stage: 0,
  mood: 60,
  shiny: false,
  since,
  fedAt: null,
  playedAt: null,
  evolved: [],
});

// economy.start(null, now, species).state — 스타터 한 마리로 시작한 직후
const freshV1 = (now: number, species: string): SaveV1 => {
  const key = `${species}#1`;
  return {
    v: 1,
    points: 0,
    active: key,
    party: { [key]: v1Pet(species, now) },
    inventory: {},
    daily: { ...freshDaily(TODAY), streak: 1 },
    log: [{ at: now, kind: "start", pet: key }],
    acc: { presenceMs: 0, workMs: 0, neglectMs: 0, failedAt: [] },
  };
};

// ── 1. empty · normalize ──────────────────────────────────────────────────────
function testEmptyAndNormalize(): void {
  const e = emptySaveV2(T0);
  assert.deepStrictEqual(e, {
    v: 2,
    points: 0,
    slots: 1,
    party: [],
    daily: { date: TODAY, streak: 1, interacted: false },
    totals: ZERO_TOTALS,
    agents: {},
    unlocked: [],
    inventory: {},
    acc: {},
    log: [],
  });
  assert.deepStrictEqual(normalizeSaveV2(clone(e)), e, "빈 저장은 정규화해도 같다");

  // 뼈대가 아니면 파손
  for (const bad of [null, "x", 7, [], {}, { v: 3, party: [] }, { v: "2", party: [] }, { v: 2 }, { v: 2, party: {} }, { v: 2, party: [{}] }, { v: 2, party: [{ species: "" }] }]) {
    assert.strictEqual(normalizeSaveV2(bad), null, `파손: ${JSON.stringify(bad)}`);
  }

  // 빠진 필드는 기본값
  const s = norm({ v: 2, party: [{ species: "eevee" }] });
  const p = some(s.party[0]);
  assert.strictEqual(p.id, "p1");
  assert.strictEqual(p.species, "eevee");
  assert.strictEqual("look" in p, false, "look 은 없으면 두지 않는다");
  assert.strictEqual(p.nature, SAVE_V2_RULES.pet.nature);
  assert.strictEqual(p.hunger, SAVE_V2_RULES.pet.hunger);
  assert.strictEqual(p.mood, SAVE_V2_RULES.pet.mood);
  assert.strictEqual(p.size, SAVE_V2_RULES.pet.size);
  assert.strictEqual(p.shown, true);
  assert.deepStrictEqual(p.home, SAVE_V2_RULES.pet.home);
  assert.deepStrictEqual(p.daily, freshDaily(""));
  assert.deepStrictEqual(p.evolved, []);
  assert.strictEqual(p.nick, null);
  assert.strictEqual(p.fedAt, null);
  assert.strictEqual(p.since, 0);
  assert.strictEqual(s.slots, 1);
  assert.deepStrictEqual(s.daily, { date: "", streak: 1, interacted: false });
  assert.deepStrictEqual(s.totals, ZERO_TOTALS);
  assert.deepStrictEqual(s.agents, {});
  assert.deepStrictEqual(s.acc, {});

  // id 가 없거나 겹치면 비어 있는 p<n> 을 붙인다
  const ids = norm({ v: 2, party: [{ species: "a", id: "p2" }, { species: "b" }, { species: "c", id: "p2" }, { species: "d", id: "" }] }).party.map((x) => x.id);
  assert.deepStrictEqual(ids, ["p2", "p1", "p3", "p4"]);

  // 범위·검증
  const r = norm({
    v: 2,
    points: -5,
    slots: 9,
    party: [
      { id: "p1", species: "umbreon", look: "eevee", nature: "jolly", hunger: 150, mood: -5, size: -1, stage: 1.7, affinity: -3, shown: false, home: { dx: 5 }, evolved: ["eevee", 3], nick: 7 },
    ],
    daily: { date: TODAY, streak: 0, interacted: "yes" },
    totals: { workMs: 10, bogus: 1, fed: -2 },
    agents: { claude: { connected: true, tokensToday: 5, date: TODAY }, bogus: { connected: true }, codex: "x" },
    unlocked: ["eevee", "eevee", 3, "pikachu"],
    inventory: { berry: 3, x: "y", mint: -1 },
    acc: { presenceMs: 12 },
  });
  const q = some(r.party[0]);
  assert.strictEqual(r.points, 0);
  assert.strictEqual(r.slots, SAVE_V2_RULES.slots.max);
  assert.strictEqual(norm({ v: 2, slots: 0, party: [] }).slots, SAVE_V2_RULES.slots.min);
  assert.strictEqual(q.look, "eevee");
  assert.strictEqual(q.nature, "jolly");
  assert.strictEqual(some(norm({ v: 2, party: [{ species: "a", nature: "bogus" }] }).party[0]).nature, SAVE_V2_RULES.pet.nature);
  assert.strictEqual(q.hunger, 100);
  assert.strictEqual(q.mood, 0);
  assert.strictEqual(q.size, SAVE_V2_RULES.pet.size);
  assert.strictEqual(q.stage, 1);
  assert.strictEqual(q.affinity, 0);
  assert.strictEqual(q.shown, false);
  assert.deepStrictEqual(q.home, { dx: 5, dy: SAVE_V2_RULES.pet.home.dy });
  assert.deepStrictEqual(q.evolved, ["eevee"]);
  assert.strictEqual(q.nick, null);
  assert.deepStrictEqual(r.daily, { date: TODAY, streak: 1, interacted: false });
  assert.deepStrictEqual(r.totals, { ...ZERO_TOTALS, workMs: 10 });
  assert.deepStrictEqual(r.agents, { claude: { connected: true, date: TODAY, tokensToday: 5 } });
  assert.deepStrictEqual(r.unlocked, ["eevee", "pikachu"]);
  assert.deepStrictEqual(r.inventory, { berry: 3, mint: 0 });
  assert.deepStrictEqual(r.acc, { presenceMs: 12 }, "acc 는 상태 모듈 것 — 그대로 둔다");

  // log 는 at·kind 있는 것만 최근 200건
  const log: unknown[] = [];
  for (let i = 0; i < 250; i++) log.push({ at: T0 + i, kind: "poke", i });
  log.push({ kind: "no-at" }, { at: 1 }, "x", null);
  const l = norm({ v: 2, party: [], log }).log;
  assert.strictEqual(l.length, SAVE_RULES.logKeep);
  assert.strictEqual(some(l[0]).i, 50);
  assert.strictEqual(some(l[l.length - 1]).i, 249);
  assert.deepStrictEqual(norm({ v: 2, party: [], log: "x" }).log, []);

  // emptyPet — 새 마리의 기본값
  const np = emptyPet({ id: "p9", species: "pikachu", now: T0, nature: "brave", shiny: true });
  assert.strictEqual(np.id, "p9");
  assert.strictEqual(np.nature, "brave");
  assert.strictEqual(np.shiny, true);
  assert.strictEqual(np.since, T0);
  assert.deepStrictEqual(np.daily, freshDaily(TODAY));
  assert.deepStrictEqual(norm({ v: 2, party: [np] }).party[0], np, "새 마리는 정규화해도 같다");
  out("  empty · normalize");
}

// ── 2. v1 → v2 이전 ──────────────────────────────────────────────────────────
function makeV1(): SaveV1 {
  const v1 = freshV1(T0, "eevee"); // 옛 모양 — { v:1, active, party:{}, daily, acc, ... }
  assert.strictEqual(v1.v, 1);
  assert.strictEqual(v1.active, "eevee#1");
  const first = some(v1.party["eevee#1"]);
  Object.assign(first, { nick: "이브", affinity: 120, mood: 80, shiny: true, fedAt: T0, stage: 1, evolved: ["eevee"], species: "umbreon" });
  v1.party["pikachu#1"] = v1Pet("pikachu", T0 + 1000);
  Object.assign(v1.daily, { streak: 4, gained: 30, feeds: 1, pokes: 2 });
  v1.points = 77;
  v1.inventory = { berry: 2 };
  v1.acc = { presenceMs: 123456, workMs: 7, neglectMs: 0, failedAt: [T0] };
  return v1;
}

function testMigrateV1(): void {
  const v1 = makeV1();
  const v2 = some(normalizeSaveV2(clone(v1)), "v1 은 파손이 아니다");
  assert.strictEqual(v2.v, 2);
  assert.strictEqual(v2.points, 77);
  assert.strictEqual(v2.slots, 2); // 1판 마리 둘 → 칸 둘
  assert.ok(Array.isArray(v2.party));
  assert.strictEqual(v2.party.length, 2);

  const a = some(v2.party[0]);
  const b = some(v2.party[1]);
  assert.strictEqual(a.id, "p1");
  assert.strictEqual(a.species, "umbreon");
  assert.strictEqual("look" in a, false);
  assert.strictEqual(a.nick, "이브");
  assert.strictEqual(a.affinity, 120);
  assert.strictEqual(a.mood, 80);
  assert.strictEqual(a.stage, 1);
  assert.strictEqual(a.shiny, true);
  assert.strictEqual(a.fedAt, T0);
  assert.strictEqual(a.playedAt, null);
  assert.strictEqual(a.since, T0);
  assert.deepStrictEqual(a.evolved, ["eevee"]);
  assert.strictEqual(a.hunger, SAVE_V2_RULES.pet.hunger);
  assert.strictEqual(a.size, SAVE_V2_RULES.pet.size);
  assert.strictEqual(a.nature, SAVE_V2_RULES.pet.nature);
  assert.strictEqual(a.shown, true, "active 였던 마리는 보인다");
  assert.deepStrictEqual(a.home, SAVE_V2_RULES.pet.home);
  assert.deepStrictEqual(a.daily, { ...freshDaily(TODAY), gained: 30, feeds: 1, pokes: 2 }, "활성 마리가 오늘 기록을 이어받는다");

  assert.strictEqual(b.id, "p2");
  assert.strictEqual(b.species, "pikachu");
  assert.strictEqual(b.shown, false, "active 가 아니던 마리는 안 보임");
  assert.strictEqual(b.since, T0 + 1000);
  assert.deepStrictEqual(b.daily, freshDaily(TODAY));

  assert.deepStrictEqual(v2.daily, { date: TODAY, streak: 4, interacted: true });
  assert.deepStrictEqual(v2.totals, ZERO_TOTALS);
  assert.deepStrictEqual(v2.agents, {});
  assert.deepStrictEqual(v2.unlocked, ["umbreon", "eevee", "pikachu"], "가진 종과 거쳐 온 종은 해금");
  assert.deepStrictEqual(v2.inventory, { berry: 2 });
  assert.deepStrictEqual(v2.acc, {}, "v1 누적기는 버린다");
  assert.strictEqual(v2.log.length, 1);
  assert.strictEqual(some(v2.log[0]).kind, "start");
  assert.deepStrictEqual(normalizeSaveV2(clone(v2)), v2, "이전한 값은 v2 로 다시 읽어도 같다");

  // active 가 둘째면 둘째가 보인다
  const v1b = clone(v1);
  v1b.active = "pikachu#1";
  assert.deepStrictEqual(norm(v1b).party.map((p) => p.shown), [false, true]);

  // active 가 없거나 틀리면 첫 마리
  const v1c = clone(v1);
  v1c.active = "nope";
  assert.deepStrictEqual(norm(v1c).party.map((p) => p.shown), [true, false]);

  // 교감이 없던 날 → interacted false. streak 없음 → 1
  const plain = freshV1(T0, "eevee");
  delete plain.daily.streak;
  assert.deepStrictEqual(norm(plain).daily, { date: TODAY, streak: 1, interacted: false });

  // 종 없는 마리 · party 가 객체가 아니면 파손
  const v1d = clone(v1);
  v1d.party["x#1"] = { nick: "no-species" } as unknown as V1Pet;
  assert.strictEqual(normalizeSaveV2(v1d), null);
  assert.strictEqual(normalizeSaveV2({ v: 1, party: [] }), null);
  assert.strictEqual(normalizeSaveV2({ v: 1 }), null);
  out("  v1 → v2 이전");
}

// ── 3. 파일 — 쓰기 ──────────────────────────────────────────────────────────
function testFiles(): void {
  const dir = tmpDir("files");
  const file = path.join(dir, "nested", "save.json");

  const e = emptySaveV2(T0);
  e.party.push(emptyPet({ id: "p1", species: "eevee", now: T0 }));
  assert.strictEqual(writeSaveV2(file, e), true, "폴더가 없어도 만든다");
  assert.deepStrictEqual(normalizeSaveV2(JSON.parse(fs.readFileSync(file, "utf8"))), e);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ["save.json"], "tmp 파일이 남지 않는다");
  assert.ok(fs.readFileSync(file, "utf8").endsWith("\n"));

  // writeAtomic 은 문자열도 그대로
  const txt = path.join(dir, "plain.txt");
  assert.strictEqual(writeAtomic(txt, "hello"), true);
  assert.strictEqual(fs.readFileSync(txt, "utf8"), "hello");
  out("  파일 — 쓰기");
}

// ── 4. writer 잠금 ───────────────────────────────────────────────────────────
async function testWriter(): Promise<void> {
  const lock = path.join(tmpDir("writer"), "deep", "save.lock");

  assert.deepStrictEqual(save.claimLock(lock), { ok: true, owner: process.pid, reason: "ok" });
  assert.strictEqual(save.ownsLock(lock), true);
  assert.strictEqual(save.liveLockOwner(lock), process.pid);
  assert.strictEqual(save.claimLock(lock).ok, true, "내 것은 다시 잡아도 된다");
  assert.strictEqual(save.releaseLock(lock), true);
  assert.strictEqual(fs.existsSync(lock), false);
  assert.strictEqual(save.releaseLock(lock), false, "없는 lock 은 놓을 것이 없다");
  assert.strictEqual(save.ownsLock(lock), false);
  assert.strictEqual(save.liveLockOwner(lock), null);

  // 죽은 pid 는 덮어쓴다
  fs.writeFileSync(lock, `${await deadPid()}\n`);
  assert.strictEqual(save.liveLockOwner(lock), null);
  assert.strictEqual(save.claimLock(lock).ok, true);
  assert.strictEqual(save.ownsLock(lock), true);
  save.releaseLock(lock);

  // 파손 lock 도 덮어쓴다
  fs.writeFileSync(lock, "garbage");
  assert.strictEqual(save.readLockPid(lock), null);
  assert.strictEqual(save.claimLock(lock).ok, true);
  save.releaseLock(lock);

  // 살아 있는 다른 pid 는 busy — release 도 남의 것은 건드리지 않는다
  const other = spawnIdle();
  try {
    fs.writeFileSync(lock, `${other.pid}\n`);
    assert.strictEqual(save.isPidAlive(other.pid), true);
    assert.deepStrictEqual(save.claimLock(lock), { ok: false, owner: other.pid, reason: "busy" });
    assert.strictEqual(save.liveLockOwner(lock), other.pid);
    assert.strictEqual(save.ownsLock(lock), false);
    assert.strictEqual(save.releaseLock(lock), false);
    assert.strictEqual(save.readLockPid(lock), other.pid, "남의 lock 은 그대로");
    assert.strictEqual(save.releaseLock(lock, other.pid), true, "그 pid 로는 놓을 수 있다");
    fs.writeFileSync(lock, `${other.pid}\n`);
  } finally {
    other.kill();
    await other.exited;
  }
  assert.ok(await waitFor(() => !save.isPidAlive(other.pid)));
  assert.strictEqual(save.claimLock(lock).ok, true, "죽으면 이어받는다");
  assert.strictEqual(save.releaseLock(lock), true);
  out("  writer 잠금");
}

// ── 5. mailbox ───────────────────────────────────────────────────────────────
// 서버를 기다리는 교환 명령은 줄을 막지 않는다 — 뒤에 보낸 돌봄이 먼저 끝난다(교환 T-06)
async function testMailboxDetached(): Promise<void> {
  const dir = path.join(tmpDir("mailbox-detached"), "box");
  const done: string[] = [];
  const server = save.serveCommands(
    dir,
    async (command) => {
      if (command.cmd === "trade.create") await sleep(1500); // 서버를 기다린다
      done.push(command.cmd);
      return { ok: true, reason: "ok" };
    },
    { pollMs: 30 },
  );
  const sendOpts = { timeoutMs: 5000, pollMs: 20 };
  try {
    const slow = save.sendToWriter(dir, { cmd: "trade.create", from: "cli" }, sendOpts);
    await sleep(150);
    const started = Date.now();
    const fed = await save.sendToWriter(dir, { cmd: "feed", target: "p1", from: "cli" }, sendOpts);
    assert.strictEqual(fed.ok, true);
    assert.ok(Date.now() - started < 1000, "돌봄은 교환 명령을 기다리지 않는다");
    assert.strictEqual((await slow).ok, true, "교환 명령도 끝난다");
    assert.deepStrictEqual(done, ["feed", "trade.create"]);
  } finally {
    server.stop();
  }
  console.log("  mailbox 교환 명령은 줄을 막지 않음");
}

async function testMailbox(): Promise<void> {
  const dir = path.join(tmpDir("mailbox"), "box");
  const seen: Command[] = [];
  const logs: Record<string, unknown>[] = [];
  const server = save.serveCommands(
    dir,
    async (command) => {
      seen.push(command);
      if (command.cmd === "quit") throw new Error("boom");
      if (command.cmd === "snapshot") return asResult(undefined); // 결과를 안 주는 핸들러 — no-result 를 본다
      return { ok: true, reason: "ok", echo: command.args ?? null, target: command.target ?? null };
    },
    { pollMs: 50, log: (e) => logs.push(e) },
  );
  const sendOpts = { timeoutMs: 3000, pollMs: 20 };
  try {
    assert.strictEqual(fs.existsSync(dir), true, "serve 가 폴더를 만든다");

    // 왕복
    const r1 = await save.sendToWriter(dir, { cmd: "feed", target: "p1", args: { x: 1 }, from: "cli" }, sendOpts);
    assert.deepStrictEqual(r1, { ok: true, reason: "ok", echo: { x: 1 }, target: "p1" });
    assert.strictEqual(seen.length, 1);
    const first = some(seen[0]);
    assert.strictEqual(first.cmd, "feed");
    assert.strictEqual(first.target, "p1");
    assert.strictEqual(first.from, "cli");
    assert.strictEqual(typeof first.at, "number");
    assert.ok(Date.now() - some(first.at) < 3000, "at 은 보낸 시각");

    // 점이 든 명령 이름
    const r2 = await save.sendToWriter(dir, { cmd: "party.show", target: "p2", from: "vscode" }, sendOpts);
    assert.strictEqual(r2.ok, true);
    const second = some(seen[1]);
    assert.strictEqual(second.cmd, "party.show");
    assert.strictEqual(second.from, "vscode");
    assert.strictEqual("args" in second, false);

    // 이름이 틀리면 파일을 만들지 않고 bad-cmd
    for (const cmd of ["Feed", "feed!", "", "x.result", "1feed", ".feed", undefined]) {
      const r = await save.sendToWriter(dir, asCommand({ cmd, from: "cli" }), sendOpts);
      assert.strictEqual(r.reason, "bad-cmd", `bad-cmd: ${cmd}`);
    }
    assert.strictEqual(seen.length, 2);

    // 핸들러가 던지면 error, 결과를 안 주면 no-result — 통로는 살아 있다
    const r3 = await save.sendToWriter(dir, { cmd: "quit", from: "tray" }, sendOpts);
    assert.strictEqual(r3.ok, false);
    assert.strictEqual(r3.reason, "error");
    assert.strictEqual(r3.message, "boom");
    assert.strictEqual(logs.filter((e) => e.mailbox === "handle-error").length, 1);
    const r4 = await save.sendToWriter(dir, { cmd: "snapshot", from: "cli" }, sendOpts);
    assert.deepStrictEqual(r4, { ok: false, reason: "no-result", cmd: "snapshot" });
    const r5 = await save.sendToWriter(dir, { cmd: "box.sort", from: "pet" }, sendOpts);
    assert.strictEqual(r5.ok, true, "죽지 않고 다음 요청을 받는다");

    const sameTime = Date.now();
    const simultaneous = await Promise.all(["p1", "p2"].map((target) => save.sendToWriter(dir, { cmd: "feed", target, from: "cli" }, { ...sendOpts, clock: () => sameTime })));
    assert.deepStrictEqual(simultaneous.map((r) => r.target), ["p1", "p2"], "동일 시각·명령도 두 요청과 회신이 독립");

    // 손으로 둔 요청 — from 을 모르면 cli, target 아닌 값은 버린다
    const before = seen.length;
    writeAtomic(path.join(dir, save.requestName(Date.now(), 1, "play")), { cmd: "play", from: "bogus", target: 7, args: [1] });
    await server.scan();
    assert.strictEqual(seen.length, before + 1);
    assert.deepStrictEqual(seen[before], { cmd: "play", from: "cli" });
    await waitFor(() => fs.readdirSync(dir).some((n) => save.RESULT.test(n)));
    for (const n of fs.readdirSync(dir)) if (save.RESULT.test(n)) fs.unlinkSync(path.join(dir, n)); // 아무도 안 가져가는 회신 — 치운다

    // 파손 요청은 지우고 부르지 않는다
    const broken = path.join(dir, save.requestName(Date.now(), 1, "feed"));
    fs.writeFileSync(broken, "{{{");
    await server.scan();
    assert.strictEqual(fs.existsSync(broken), false);
    assert.strictEqual(seen.length, before + 1);

    // 오래된 요청은 지우고 부르지 않는다
    const oldAt = Date.now() - SAVE_RULES.channel.requestTtlMs - 60_000;
    const stale = path.join(dir, save.requestName(oldAt, 1, "feed"));
    writeAtomic(stale, { cmd: "feed", from: "cli", at: oldAt });
    await server.scan();
    assert.strictEqual(fs.existsSync(stale), false);
    assert.strictEqual(seen.length, before + 1);
    assert.strictEqual(fs.readdirSync(dir).some((n) => save.RESULT.test(n)), false, "버린 요청엔 회신도 없다");

    // cmd 가 없는 요청도 지운다
    const noCmd = path.join(dir, save.requestName(Date.now(), 1, "feed"));
    writeAtomic(noCmd, { from: "cli" });
    await server.scan();
    assert.strictEqual(fs.existsSync(noCmd), false);
    assert.strictEqual(seen.length, before + 1);

    // 안 가져간 회신 — TTL 지나면 청소, 새것은 둔다
    const oldResult = path.join(dir, save.resultName(save.requestName(Date.now(), 2, "feed")));
    fs.writeFileSync(oldResult, "{}");
    const past = (Date.now() - SAVE_RULES.channel.resultTtlMs - 60_000) / 1000;
    fs.utimesSync(oldResult, past, past);
    const freshResult = path.join(dir, save.resultName(save.requestName(Date.now(), 3, "feed")));
    fs.writeFileSync(freshResult, "{}");
    await server.scan();
    assert.strictEqual(fs.existsSync(oldResult), false);
    assert.strictEqual(fs.existsSync(freshResult), true);
    fs.unlinkSync(freshResult);

    // 규칙에 안 맞는 파일은 건드리지 않는다
    const other = path.join(dir, "readme.txt");
    fs.writeFileSync(other, "x");
    await server.scan();
    assert.strictEqual(fs.existsSync(other), true);
    fs.unlinkSync(other);
    assert.deepStrictEqual(fs.readdirSync(dir), [], "요청·회신·tmp 가 남지 않는다");
  } finally {
    server.stop();
  }

  // writer 가 없으면 timeout — 요청은 회수한다
  const r6 = await save.sendToWriter(dir, { cmd: "feed", from: "cli" }, { timeoutMs: 200, pollMs: 20 });
  assert.deepStrictEqual(r6, { ok: false, reason: "timeout", cmd: "feed" });
  assert.deepStrictEqual(fs.readdirSync(dir), [], "회수한 요청은 남지 않는다");

  // stop 뒤엔 처리하지 않는다
  writeAtomic(path.join(dir, save.requestName(Date.now(), 1, "feed")), { cmd: "feed", from: "cli" });
  await server.scan();
  await sleep(120);
  assert.strictEqual(fs.readdirSync(dir).length, 1, "멈춘 서버는 요청을 건드리지 않는다");

  // 시계 주입 — 서버 시계가 미래면 방금 요청도 오래된 것
  const dir2 = path.join(tmpDir("mailbox-clock"), "box");
  const late = save.serveCommands(dir2, () => ({ ok: true, reason: "ok" }), { pollMs: 50, clock: () => Date.now() + SAVE_RULES.channel.requestTtlMs * 2 });
  try {
    const r7 = await save.sendToWriter(dir2, { cmd: "feed", from: "cli" }, { timeoutMs: 300, pollMs: 20 });
    assert.strictEqual(r7.reason, "timeout");
  } finally {
    late.stop();
  }
  out("  mailbox 왕복·timeout·파손·오래된 요청·회신 청소");
}

// ── 6. dispatcher ────────────────────────────────────────────────────────────
async function testDispatcher(): Promise<void> {
  const logs: Record<string, unknown>[] = [];
  const d = createDispatcher({ log: (e) => logs.push(e) });
  const got: Command[] = [];

  assert.strictEqual(d.has("feed"), false);
  assert.deepStrictEqual(await d.dispatch({ cmd: "feed", from: "menu" }), { ok: false, reason: "unknown-cmd", cmd: "feed" });

  const off = d.register("feed", (c) => {
    got.push(c);
    return { ok: true, reason: "ok", gained: 15 };
  });
  assert.strictEqual(d.has("feed"), true);
  const cmd: Command = { cmd: "feed", target: "p1", args: { double: true }, from: "menu" };
  assert.deepStrictEqual(await d.dispatch(cmd), { ok: true, reason: "ok", gained: 15 });
  assert.strictEqual(got[0], cmd, "명령 객체를 그대로 넘긴다");

  // 비동기 핸들러
  d.register("play", async () => {
    await sleep(5);
    return { ok: false, reason: "cooldown", nextAt: T0 };
  });
  assert.deepStrictEqual(await d.dispatch({ cmd: "play", from: "cli" }), { ok: false, reason: "cooldown", nextAt: T0 });

  // 던지면 error + message, 처리기는 살아 있다
  d.register("box.sort", () => {
    throw new Error("boom");
  });
  assert.deepStrictEqual(await d.dispatch({ cmd: "box.sort", from: "pet" }), { ok: false, reason: "error", message: "boom", cmd: "box.sort" });
  assert.deepStrictEqual(logs, [{ dispatch: "handler-error", cmd: "box.sort", message: "boom" }]);
  d.register("evolve", async () => Promise.reject(new Error("async boom")));
  assert.strictEqual((await d.dispatch({ cmd: "evolve", from: "menu" })).message, "async boom");
  assert.strictEqual((await d.dispatch({ cmd: "feed", from: "menu" })).ok, true);

  // 결과가 아니면 no-result, reason 이 없으면 ok 로 채운다
  d.register("snapshot", () => asResult(undefined));
  assert.deepStrictEqual(await d.dispatch({ cmd: "snapshot", from: "cli" }), { ok: false, reason: "no-result", cmd: "snapshot" });
  d.register("quit", () => asResult({ ok: true }));
  assert.deepStrictEqual(await d.dispatch({ cmd: "quit", from: "tray" }), { ok: true, reason: "ok" });
  d.register("pet.set", () => asResult({ ok: false }));
  assert.deepStrictEqual(await d.dispatch({ cmd: "pet.set", from: "settings" }), { ok: false, reason: "error" });

  // 두 번 등록은 던진다 — 해제하면 다시 등록할 수 있다
  assert.throws(() => d.register("feed", () => ({ ok: true, reason: "ok" })), /이미 등록/);
  off();
  assert.strictEqual(d.has("feed"), false);
  assert.strictEqual((await d.dispatch({ cmd: "feed", from: "menu" })).reason, "unknown-cmd");
  d.register("feed", () => ({ ok: true, reason: "already" }));
  assert.strictEqual((await d.dispatch({ cmd: "feed", from: "menu" })).reason, "already");
  off(); // 옛 해제 함수는 새 핸들러를 건드리지 않는다
  assert.strictEqual(d.has("feed"), true);

  // 이상한 입력도 던지지 않는다
  assert.strictEqual((await d.dispatch(asCommand(null))).reason, "unknown-cmd");
  assert.strictEqual((await d.dispatch(asCommand({}))).reason, "unknown-cmd");
  assert.strictEqual((await d.dispatch(asCommand({ cmd: 7 }))).reason, "unknown-cmd");

  // mailbox 브리지 — 파일로 온 요청이 처리기를 거쳐 회신된다
  const dir = path.join(tmpDir("bridge"), "box");
  const server = bridgeMailbox(d, dir, { pollMs: 50 });
  try {
    const sendOpts = { timeoutMs: 3000, pollMs: 20 };
    assert.deepStrictEqual(await save.sendToWriter(dir, { cmd: "feed", target: "p1", from: "cli" }, sendOpts), { ok: true, reason: "already" });
    assert.deepStrictEqual(await save.sendToWriter(dir, { cmd: "shop.buy" satisfies CommandName, from: "cli" }, sendOpts), { ok: false, reason: "unknown-cmd", cmd: "shop.buy" });
    const r = await save.sendToWriter(dir, { cmd: "box.sort", from: "vscode" }, sendOpts);
    assert.strictEqual(r.reason, "error");
    assert.strictEqual(r.message, "boom");
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally {
    server.stop();
  }
  out("  dispatcher register·unknown·error·bridge");
}

async function main(): Promise<void> {
  out("selftest-legacy");
  testEmptyAndNormalize();
  testMigrateV1();
  testFiles();
  await testWriter();
  await testMailbox();
  await testMailboxDetached();
  await testDispatcher();
  out("통과");
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error && e.stack ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // 임시 폴더 — 남아도 해가 없다
    }
  });
