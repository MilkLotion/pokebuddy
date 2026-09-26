// 박스 정렬·이동·이름 자체 확인 — npm run build 뒤 node dist/tools/selftest-box.js
//
// 순수 함수(src/box/slots.ts)와 거래 명령(box.sort · box.move · box.rename)을 본다. 파일을 만들지 않는다.
// 설계는 docs/work/game-runtime/record.md "박스 정렬·이동·이름 변경의 설계"
import assert from "node:assert";
import { BOX_RULES, moveSlot, moveToBox, renameBox, sortBox } from "../box/slots";
import { newPet } from "../party/create";
import { empty, newBox } from "../save/v3";
import type { SaveV3 } from "../shared/save-v3";
import { argsOf } from "../tx/bridge";
import { createExecutor, type TxPorts } from "../tx/executor";
import { HANDLERS } from "../tx/handlers";

const T0 = new Date(2026, 8, 27, 10, 0, 0).getTime();

// 박스 1 에 다섯 마리 — 칸 0·1·3·4·6, 나머지는 빈 칸
function seed(): SaveV3 {
  const s = empty(T0);
  const rows: [string, string, number, number, number][] = [
    // id, 종, 레벨, 친밀도, 얻은 순서
    ["p1", "pikachu", 5, 10, 3],
    ["p2", "bulbasaur", 20, 50, 1],
    ["p3", "squirtle", 12, 80, 5],
    ["p4", "charmander", 20, 5, 2],
    ["p5", "eevee", 1, 30, 4],
  ];
  const at = [0, 1, 3, 4, 6];
  rows.forEach(([id, species, level, affinity, order], i) => {
    const pet = newPet({ id, species, shiny: false, nature: "hardy", now: T0 + order * 1000 });
    pet.level = level;
    pet.affinity = affinity;
    s.pets.push(pet);
    const box = s.boxes[0]!;
    box.slots[at[i]!] = id;
  });
  s.boxes.push(newBox("b2", "박스 2"));
  return s;
}

const ids = (s: SaveV3, b = 0): (string | null)[] => s.boxes[b]!.slots.slice(0, 8);
const names: Record<string, string> = { pikachu: "피카츄", bulbasaur: "이상해씨", squirtle: "꼬부기", charmander: "파이리", eevee: "이브이" };
const nameOf = (slug: string): string => names[slug] ?? slug;
const petsOf = (s: SaveV3) => new Map(s.pets.map((p) => [p.id, p]));

let n = 0;
const check = (fn: () => void): void => {
  fn();
  n++;
};

// ── 정렬 — 지금 박스만, 개체는 앞 칸부터, 빈 칸은 뒤로 ──
check(() => {
  const s = seed();
  sortBox(s.boxes[0]!, petsOf(s), "dex", nameOf);
  assert.deepStrictEqual(ids(s), ["p2", "p4", "p3", "p1", "p5", null, null, null], "도감 번호순 (1·4·7·25·133)");
});
check(() => {
  const s = seed();
  sortBox(s.boxes[0]!, petsOf(s), "level", nameOf);
  assert.deepStrictEqual(ids(s).slice(0, 5), ["p2", "p4", "p3", "p1", "p5"], "레벨 높은 순, 같으면 도감 번호");
});
check(() => {
  const s = seed();
  sortBox(s.boxes[0]!, petsOf(s), "affinity", nameOf);
  assert.deepStrictEqual(ids(s).slice(0, 5), ["p3", "p2", "p5", "p1", "p4"], "친밀도 높은 순");
});
check(() => {
  const s = seed();
  sortBox(s.boxes[0]!, petsOf(s), "recent", nameOf);
  assert.deepStrictEqual(ids(s).slice(0, 5), ["p3", "p5", "p1", "p4", "p2"], "최근 얻은 순");
});
check(() => {
  const s = seed();
  sortBox(s.boxes[0]!, petsOf(s), "name", nameOf);
  assert.deepStrictEqual(ids(s).slice(0, 5), ["p3", "p5", "p2", "p4", "p1"], "이름순 (꼬부기·이브이·이상해씨·파이리·피카츄)");
});
check(() => {
  const s = seed();
  s.boxes[1]!.slots[0] = "p9"; // 다른 박스는 그대로다
  sortBox(s.boxes[0]!, petsOf(s), "dex", nameOf);
  assert.strictEqual(s.boxes[1]!.slots[0], "p9", "다른 박스는 건드리지 않음");
  assert.strictEqual(s.boxes[0]!.slots.length, 30, "칸 수는 그대로");
});

// ── 이동 — 빈 칸이면 옮기고, 개체 칸이면 맞바꾼다 ──
check(() => {
  const s = seed();
  assert.deepStrictEqual(moveSlot(s.boxes, { boxIndex: 0, slotIndex: 0 }, { boxIndex: 0, slotIndex: 2 }), { ok: true });
  assert.deepStrictEqual(ids(s).slice(0, 3), [null, "p2", "p1"], "빈 칸으로 옮김");
  assert.deepStrictEqual(moveSlot(s.boxes, { boxIndex: 0, slotIndex: 2 }, { boxIndex: 0, slotIndex: 1 }), { ok: true });
  assert.deepStrictEqual(ids(s).slice(0, 3), [null, "p1", "p2"], "개체 칸이면 맞바꿈");
  assert.deepStrictEqual(moveSlot(s.boxes, { boxIndex: 0, slotIndex: 0 }, { boxIndex: 0, slotIndex: 5 }), { ok: false, reason: "empty-slot" });
  assert.deepStrictEqual(moveSlot(s.boxes, { boxIndex: 0, slotIndex: 1 }, { boxIndex: 0, slotIndex: 1 }), { ok: false, reason: "same-slot" });
  assert.deepStrictEqual(moveSlot(s.boxes, { boxIndex: 0, slotIndex: 1 }, { boxIndex: 0, slotIndex: 30 }), { ok: false, reason: "bad-slot" });
});
check(() => {
  const s = seed();
  const res = moveToBox(s.boxes, { boxIndex: 0, slotIndex: 3 }, 1);
  assert.deepStrictEqual(res, { ok: true, spot: { boxIndex: 1, slotIndex: 0 } }, "다른 박스의 첫 빈 칸");
  assert.strictEqual(s.boxes[0]!.slots[3], null);
  s.boxes[1]!.slots = s.boxes[1]!.slots.map((x, i) => x ?? `f${i}`);
  assert.deepStrictEqual(moveToBox(s.boxes, { boxIndex: 0, slotIndex: 0 }, 1), { ok: false, reason: "box-full" }, "가득 찬 박스로는 안 옮김");
  assert.strictEqual(s.boxes[0]!.slots[0], "p1", "실패하면 그대로");
});

// ── 이름 — 공백을 지우고 10자로 자른다. 비우면 기본 이름 ──
check(() => {
  const s = seed();
  assert.strictEqual(renameBox(s.boxes[0]!, "  내 박스  ", 0), "내 박스");
  assert.strictEqual(renameBox(s.boxes[0]!, "가".repeat(BOX_RULES.nameMax + 3), 0), "가".repeat(BOX_RULES.nameMax));
  assert.strictEqual(renameBox(s.boxes[1]!, "   ", 1), "박스 2", "비우면 기본 이름");
});

// ── 거래 명령 — 실행기를 거쳐 저장이 바뀐다 ──
check(() => {
  let saved: SaveV3 = seed();
  const ports: TxPorts = { read: () => structuredClone(saved), write: (next) => ((saved = structuredClone(next)), true), now: () => T0, rand: () => 0.5 };
  const ex = createExecutor(ports, HANDLERS);
  const run = (name: "box.sort" | "box.move" | "box.rename", target: string, args: Record<string, unknown>, id: string) =>
    ex.run({ id, name, args: argsOf({ cmd: name, target, args, from: "settings" }) });
  assert.strictEqual(run("box.sort", "b1", { by: "dex" }, "t1").ok, true);
  assert.deepStrictEqual(saved.boxes[0]!.slots.slice(0, 5), ["p2", "p4", "p3", "p1", "p5"], "box.sort 저장");
  assert.strictEqual(run("box.sort", "b1", { by: "weight" }, "t2").ok, false, "모르는 기준은 거절");
  assert.strictEqual(run("box.move", "b1", { slot: 0, toSlot: 7 }, "t3").ok, true);
  assert.strictEqual(saved.boxes[0]!.slots[7], "p2", "box.move 칸으로");
  assert.strictEqual(run("box.move", "b1", { slot: 7, toBoxId: "b2" }, "t4").ok, true);
  assert.strictEqual(saved.boxes[1]!.slots[0], "p2", "box.move 다른 박스 첫 빈 칸으로");
  const bad = run("box.move", "b1", { slot: 20, toSlot: 1 }, "t5");
  assert.strictEqual(bad.ok ? "" : bad.reason, "empty-slot", "빈 칸은 옮길 게 없다");
  assert.strictEqual(run("box.rename", "b2", { name: "전설" }, "t6").ok, true);
  assert.strictEqual(saved.boxes[1]!.name, "전설", "box.rename 저장");
  assert.strictEqual(run("box.rename", "b9", { name: "x" }, "t7").ok, false, "없는 박스는 거절");
  assert.deepStrictEqual(saved.party, seed().party, "파티는 그대로");
});

process.stdout.write(`통과 (${n}건)\n`);
