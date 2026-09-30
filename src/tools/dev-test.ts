// 실기 확인 전용 — 진짜 저장(~/.claude/pokebuddy)과 떨어진 시험용 HOME 에서 동반자를 띄우고, 확인할 장면에 맞게 저장을 고친다
//   node dist/tools/dev-test.js start [--fresh]     시험용 HOME 으로 동반자 실행 (--fresh 면 HOME 을 비우고 첫 포켓몬 선택부터)
//   node dist/tools/dev-test.js stop                시험 동반자 종료 — companion.lock 을 지우면 스스로 저장하고 끝난다
//   node dist/tools/dev-test.js scene <장면>        저장을 그 장면으로 고친다 — 앱이 꺼져 있어야 한다(저장은 앱 하나만 쓴다)
//   node dist/tools/dev-test.js show                저장 요약
// 시험용 HOME 은 POKEBUDDY_TEST_HOME, 없으면 <임시 폴더>/pokebuddy-test-home. 앱은 이 파일이 든 저장소(dist 빌드)를 띄운다.
// 저장소의 `electron .` 은 로그인 시 시작을 등록하지 않는다(src/main/app.ts syncLoginItem). 절차는 docs/contributing/development.md "시험용 HOME 에서 실기 확인"
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rollGender } from "../dex/gender";
import { randomNature } from "../dex/natures";
import { putPet } from "../box/slots";
import { newPet, nextPetId, recordDex } from "../party/create";
import { begin } from "../party/starter";
import { SHOP_V3_RULES } from "../save/rules";
import * as store from "../save/store";
import { empty } from "../save/v3";
import { newEgg } from "../shop/buy";
import { SCREEN_TUTORIALS, TUTORIALS } from "../tutorial/core";
import type { SaveV3 } from "../shared/save-v3";

export const DEV_TEST_RULES = {
  starter: "charmander", // 저장이 없을 때 첫 포켓몬
  extra: "pikachu", // 파티 장면에서 새로 얻은 개체
  points: 1000, // 상점 장면의 포인트 하한
  achievement: "show-two", // 업적 장면에서 달성으로 적는 업적
  stopWaitMs: 10000,
};

const PROJECT = path.resolve(__dirname, "..", "..");
export const testHome = (): string => path.resolve(process.env.POKEBUDDY_TEST_HOME || path.join(os.tmpdir(), "pokebuddy-test-home"));
const dataDir = (home: string): string => path.join(home, ".claude", "pokebuddy");
const saveFile = (home: string): string => path.join(dataDir(home), "save.json");

function alive(pid: number): boolean {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// 저장을 쓰는 프로세스가 살아 있는가 (src/save/writer.ts 의 save.lock)
export function running(home: string): boolean {
  try {
    return alive(Number(fs.readFileSync(path.join(dataDir(home), "save.lock"), "utf8").split("\n")[0]));
  } catch {
    return false;
  }
}

// ── 장면 ───────────────────────────────────────────────────────────────────────
// 튜토리얼 장면은 그 튜토리얼 앞의 것을 완료로, 그 튜토리얼과 뒤의 것을 미시작으로 둔다. 시작 조건은 앱이 다음 틱에 다시 본다
function tutorialsFrom(save: SaveV3, id: string): void {
  const at = TUTORIALS.findIndex((t) => t.id === id);
  save.tutorials = {};
  TUTORIALS.forEach((t, i) => {
    if (i < at) save.tutorials[t.id] = { state: "done", steps: 0 };
  });
}

function ensureStarter(save: SaveV3, now: number): void {
  if (save.pets.length) return;
  begin(save, DEV_TEST_RULES.starter, now, Math.random);
}

function addHiddenPet(save: SaveV3, now: number): void {
  let slot = save.party.slots.findIndex((s) => s.state === "empty");
  if (slot < 0) {
    slot = save.party.slots.findIndex((s) => s.state === "locked");
    if (slot < 0) throw new Error("파티에 넣을 칸이 없다");
  }
  const id = nextPetId(save);
  const species = save.dex.unlocked.find((s) => !save.pets.some((p) => p.species === s)) ?? DEV_TEST_RULES.extra;
  save.pets.push(newPet({ id, species, shiny: false, nature: randomNature(Math.random).id, gender: rollGender(species), now }));
  save.party.slots[slot] = { state: "pokemon", petId: id, hidden: true }; // 숨긴 채로 — 파티 튜토리얼(지금 꺼짐, src/tutorial/core.ts)을 다시 켤 때 확인용
  recordDex(save, species, false);
}

type Scene = (save: SaveV3, now: number) => void;

export const SCENES: Record<string, { note: string; apply: Scene }> = {
  tutorials: { note: "튜토리얼 기록만 비운다(나머지 진행은 그대로)", apply: (s) => void (s.tutorials = {}) },
  "first-care": {
    note: "바탕화면 첫 돌봄 — 밥·놀아주기 기록을 0 으로",
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "first-care");
      s.totals.fed = 0;
      s.totals.played = 0;
    },
  },
  shop: {
    note: "관리 창 상점 — 알을 산 적 없고 포인트가 넉넉하다",
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "shop");
      s.eggs = [];
      s.eggSeq = 0;
      s.points.balance = Math.max(s.points.balance, DEV_TEST_RULES.points);
    },
  },
  hatch: {
    note: "관리 창 부화 — 준비된 랜덤알 하나",
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "hatch");
      const egg = newEgg(s, "random", now);
      egg.remainMs = 0;
      egg.ready = true;
      s.eggs.push(egg);
    },
  },
  party: {
    note: "관리 창 파티 — 숨긴 채 파티 칸에 든 새 개체 하나",
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "party");
      s.eggs = s.eggs.filter((e) => e.kind !== "random");
      addHiddenPet(s, now);
    },
  },
  achievement: {
    note: `관리 창 업적 — ${DEV_TEST_RULES.achievement} 달성, 받지 않음. 받은 업적 기록은 지운다`,
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "achievement");
      for (const row of Object.values(s.achievements)) row.claimedAt = null;
      s.achievements[DEV_TEST_RULES.achievement] = { achievedAt: now, claimedAt: null };
    },
  },
  playground: {
    note: "바탕화면 놀이공간 — 첫 돌봄을 마쳤고 놀이공간은 주 화면",
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "playground");
      s.settings.playArea = { mode: "screen", rect: null, screen: null };
    },
  },
  "done-all": {
    note: "튜토리얼을 모두 완료로 — 튜토리얼 없이 다른 화면을 확인할 때",
    apply: (s) => {
      s.tutorials = {};
      // 대기열 밖(개체 상세·화면을 처음 열 때)도 끝낸다
      for (const id of [...TUTORIALS.map((t) => t.id), "detail", ...SCREEN_TUTORIALS]) s.tutorials[id] = { state: "done", steps: 0 };
    },
  },
  box: {
    note: "박스 정렬·끌기 — 레벨·친밀도가 다른 개체 8마리를 박스에 넣는다",
    apply: (s, now) => {
      ensureStarter(s, now);
      const rows: [string, number, number][] = [["bulbasaur", 9, 20], ["squirtle", 14, 60], ["eevee", 7, 80], ["machop", 21, 10], ["pichu", 3, 40], ["totodile", 18, 5], ["mudkip", 11, 90], ["riolu", 25, 30]];
      rows.forEach(([species, level, affinity], i) => {
        const pet = newPet({ id: nextPetId(s), species, shiny: false, nature: randomNature(Math.random).id, gender: rollGender(species), now: now - (rows.length - i) * 60_000 });
        pet.level = level;
        pet.affinity = affinity;
        s.pets.push(pet);
        putPet(s.boxes, pet.id);
        recordDex(s, species, false);
      });
    },
  },
  boxes: {
    note: "박스 넘기기·가득 참 — 박스를 모두 비우고 첫 박스 30칸을 채운 뒤 둘째 박스에 3마리",
    apply: (s, now) => {
      ensureStarter(s, now);
      const inBox = new Set(s.boxes.flatMap((b) => b.slots).filter((id): id is string => id != null));
      s.pets = s.pets.filter((p) => !inBox.has(p.id));
      for (const b of s.boxes) b.slots = b.slots.map(() => null);
      const kinds = ["bulbasaur", "charmander", "squirtle", "pikachu", "eevee", "machop", "pichu", "totodile", "mudkip", "riolu"];
      for (let i = 0; i < 33; i++) {
        const species = kinds[i % kinds.length] ?? "pikachu";
        const pet = newPet({ id: nextPetId(s), species, shiny: false, nature: randomNature(Math.random).id, gender: rollGender(species), now: now - (33 - i) * 60_000 });
        pet.level = 1 + ((i * 7) % 40);
        s.pets.push(pet);
        putPet(s.boxes, pet.id);
        recordDex(s, species, false);
      }
    },
  },
  rich: { note: `포인트를 ${DEV_TEST_RULES.points * 10} 이상으로`, apply: (s) => void (s.points.balance = Math.max(s.points.balance, DEV_TEST_RULES.points * 10)) },
};

export function applyScene(save: SaveV3, name: string, now = Date.now()): SaveV3 {
  const scene = SCENES[name];
  if (!scene) throw new Error(`모르는 장면: ${name}`);
  scene.apply(save, now);
  return save;
}

// ── 명령 ───────────────────────────────────────────────────────────────────────
function start(home: string, fresh: boolean): void {
  if (running(home)) throw new Error("시험 동반자가 이미 떠 있다 — stop 먼저");
  if (fresh) fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  const electron = require("electron") as unknown as string; // node 에서 require 하면 실행 파일 경로를 준다
  const child = spawn(electron, [PROJECT], {
    cwd: PROJECT,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, HOME: home, USERPROFILE: home, POKEBUDDY_SAVE_CRYPT: "off" }, // scene·show 가 저장을 직접 고치고 읽는다 — 평문
  });
  child.unref();
  process.stdout.write(`시작 pid=${child.pid} HOME=${home}\n`);
}

async function stop(home: string): Promise<void> {
  fs.rmSync(path.join(dataDir(home), "companion.lock"), { force: true });
  const until = Date.now() + DEV_TEST_RULES.stopWaitMs;
  while (running(home) && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
  process.stdout.write(running(home) ? "아직 떠 있다 — 트레이에서 끝내 주세요\n" : "끝남\n");
}

function scene(home: string, names: string[]): void {
  if (running(home)) throw new Error("시험 동반자가 떠 있다 — stop 한 뒤 장면을 바꾼다(앱이 저장을 덮어쓴다)");
  const file = saveFile(home);
  const now = Date.now();
  const save = store.read(file).state ?? empty(now);
  for (const name of names) applyScene(save, name, now);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!store.write(file, save)) throw new Error(`쓰지 못함: ${file}`);
  process.stdout.write(`${names.join(", ")} → ${file}\n`);
}

function show(home: string): void {
  const save = store.read(saveFile(home), { repair: false }).state;
  if (!save) {
    process.stdout.write(`저장 없음 (HOME=${home}) — 다음 실행은 첫 포켓몬 선택부터\n`);
    return;
  }
  const lines = [
    `HOME=${home} 실행 중=${running(home)}`,
    `포인트 ${save.points.balance}`,
    `개체 ${save.pets.map((p) => `${p.id}:${p.species}`).join(" ")}`,
    `알 ${save.eggs.map((e) => `${e.id}:${e.kind}${e.ready ? "(준비)" : ""}`).join(" ") || "-"}`,
    `튜토리얼 ${TUTORIALS.map((t) => `${t.id}=${save.tutorials[t.id]?.state ?? "-"}${save.tutorials[t.id]?.queuedAt ? "(대기)" : ""}`).join(" ")}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

const USAGE = [
  "사용법: node dist/tools/dev-test.js start [--fresh] | stop | show | scene <장면>[,<장면>…]",
  "장면:",
  ...Object.entries(SCENES).map(([name, s]) => `  ${name.padEnd(12)} ${s.note}`),
  `시작 포인트는 첫 포켓몬 선택 때 ${SHOP_V3_RULES.startPoints}`,
].join("\n");

async function main(argv: string[]): Promise<void> {
  const home = testHome();
  const [cmd, arg] = argv.filter((a) => !a.startsWith("--"));
  if (cmd === "start") start(home, argv.includes("--fresh"));
  else if (cmd === "stop") await stop(home);
  else if (cmd === "show") show(home);
  else if (cmd === "scene" && arg) scene(home, arg.split(","));
  else {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
  }
}

if (require.main === module)
  main(process.argv.slice(2)).catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
