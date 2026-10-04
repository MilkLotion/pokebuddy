// 박스 정렬·이동·이름·순서·구매 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-box.js
//
// 순수 함수(src/box/slots.ts)와 거래 명령(box.sort · box.move · box.rename · box.order, 상점의 box)을 본다. 파일을 만들지 않는다.
// 설계는 worklog/records/game-runtime/record.md "박스 정렬·이동·이름 변경의 설계"
import assert from "node:assert";
import { addBox, boxBuyable, boxRoom, moveSlot, moveToBox, addToBox } from "../../box/slots";
import { orderBox, renameBox, sortBox } from "../../box/order";
import { openEgg } from "../../egg/open";
import { keepInBox } from "../../party/placement";
import { applyGifts } from "../../mail/gifts";
import { buyProduct } from "../../shop/buy";
import { newPet } from "../../party/create";
import { BOX_RULES } from "../../box/rules";
import { SHOP_RULES } from "../../shop/rules";
import { emptySave as empty, normalizeSave as normalize } from "../../save/normalize";
import { boxName, fillBoxes, newBox } from "../../box/boxes";
import type { SaveV3 } from "../../shared/save-v3";
import { argsFromCommand } from "../../tx/args";
import { createExecutor, type TxPorts } from "../../tx/executor";
import { HANDLERS } from "../../tx/command-table";

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
    const pet = newPet({ id, species, shiny: false, nature: "hardy", gender: "male", now: T0 + order * 1000 });
    pet.level = level;
    pet.affinity = affinity;
    s.pets.push(pet);
    const box = s.boxes[0]!;
    box.slots[at[i]!] = id;
  });
  return s; // 박스는 8개로 시작한다 — b1 ~ b8
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

// ── 이름 — 공백을 지우고 12자로 자른다. 비우면 기본 이름 ──
check(() => {
  const s = seed();
  assert.strictEqual(renameBox(s.boxes[0]!, "  내 박스  ", 0), "내 박스");
  assert.strictEqual(BOX_RULES.nameMax, 12, "이름은 12자까지 (2026-10-01 사용자 결정)");
  assert.strictEqual(renameBox(s.boxes[0]!, "가".repeat(BOX_RULES.nameMax + 3), 0), "가".repeat(BOX_RULES.nameMax));
  assert.strictEqual(renameBox(s.boxes[1]!, "   ", 1), "박스 2", "비우면 기본 이름");
  assert.strictEqual(s.boxes[1]!.name, "", "기본 이름은 저장하지 않는다 — 프리셋과 같다 (94 항목 9-5-5)");
  assert.strictEqual(renameBox(s.boxes[1]!, "박스 2", 1), "박스 2");
  assert.strictEqual(s.boxes[1]!.name, "", "기본 이름과 같은 글자도 비운다");
});

// ── 거래 명령 — 실행기를 거쳐 저장이 바뀐다 ──
check(() => {
  let saved: SaveV3 = seed();
  const ports: TxPorts = { read: () => structuredClone(saved), write: (next) => ((saved = structuredClone(next)), true), now: () => T0, rand: () => 0.5 };
  const ex = createExecutor(ports, HANDLERS);
  const run = (name: "box.sort" | "box.move" | "box.rename" | "box.order", target: string, args: Record<string, unknown>, id: string) =>
    ex.run({ id, name, args: argsFromCommand({ cmd: name, target, args, from: "settings" }) });
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
  // 순서 — 박스 2 를 맨 앞으로. 이름과 칸은 박스를 따라간다
  assert.strictEqual(run("box.order", "b2", { to: 0 }, "t8").ok, true);
  assert.deepStrictEqual(saved.boxes.slice(0, 3).map((b) => b.id), ["b2", "b1", "b3"], "box.order 저장");
  assert.strictEqual(saved.boxes[0]!.name, "전설", "이름은 박스를 따라간다");
  assert.strictEqual(saved.boxes[0]!.slots[0], "p2", "칸도 박스를 따라간다");
  assert.strictEqual(run("box.order", "b2", { to: 0 }, "t9").ok, false, "같은 자리는 거절");
  assert.strictEqual(run("box.order", "b2", { to: 99 }, "t10").ok, false, "없는 자리는 거절");
  assert.strictEqual(run("box.order", "b99", { to: 0 }, "t11").ok, false, "없는 박스는 거절");
  assert.strictEqual(run("box.order", "b2", {}, "t12").ok, false, "자리를 주지 않으면 거절");
});

// ── 순서 — 사이의 박스는 한 칸씩 밀린다 ──
check(() => {
  const s = seed();
  const order = (): string => s.boxes.map((b) => b.id.slice(1)).join("");
  assert.deepStrictEqual(orderBox(s.boxes, 0, 3), { ok: true });
  assert.strictEqual(order(), "23415678", "앞에서 뒤로");
  assert.deepStrictEqual(orderBox(s.boxes, 7, 0), { ok: true });
  assert.strictEqual(order(), "82341567", "맨 뒤에서 맨 앞으로");
  assert.deepStrictEqual(orderBox(s.boxes, 2, 2), { ok: false, reason: "same-slot" });
  assert.deepStrictEqual(orderBox(s.boxes, -1, 2), { ok: false, reason: "no-box" });
  assert.deepStrictEqual(orderBox(s.boxes, 2, 8), { ok: false, reason: "bad-slot" });
  // 새 개체는 바뀐 순서의 앞 박스부터 들어간다
  assert.deepStrictEqual(addToBox(s.boxes, "p9"), { boxIndex: 0, slotIndex: 0 });
  assert.strictEqual(s.boxes[0]!.id, "b8");
});

// ── 박스 수 — 8개로 시작한다. 저절로 늘지 않고 상점에서 하나씩 사서 64개까지 늘린다 (2026-10-02 사용자 결정) ──
check(() => {
  const { start, max } = BOX_RULES;
  const s = empty(T0);
  assert.strictEqual(start, 8);
  assert.strictEqual(max, 64);
  assert.strictEqual(s.boxes.length, start, "새 저장은 8개");
  assert.deepStrictEqual(s.boxes.map((b) => b.id), ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"]);
  assert.deepStrictEqual([s.boxes[7]!.name, boxName(s.boxes[7]!, 7)], ["", "박스 8"], "기본 이름은 저장하지 않고 자리 번호로 보인다 (94 항목 9-5-5)");
  // 모든 박스에 한 마리 이상 있어도 늘지 않는다
  for (let b = 0; b < start - 1; b += 1) s.boxes[b]!.slots[0] = `x${b}`;
  s.boxes[0]!.slots[1] = "y";
  assert.deepStrictEqual(moveSlot(s.boxes, { boxIndex: 0, slotIndex: 1 }, { boxIndex: start - 1, slotIndex: 5 }), { ok: true });
  assert.strictEqual(s.boxes.length, start, "모든 박스에 한 마리 이상이어도 그대로");
  assert.strictEqual(fillBoxes(s.boxes).length, start, "기본 개수면 그대로");
});
check(() => {
  // 구매 — 300P, 맨 뒤에 빈 박스. 포인트가 모자라면 거절
  const s = seed();
  const price = SHOP_RULES.boxPrice;
  assert.strictEqual(price, 300);
  s.points.balance = price - 1;
  assert.strictEqual(buyProduct(s, "box", T0, () => 0.5).reason, "not-enough-points");
  assert.strictEqual(s.boxes.length, 8, "실패하면 그대로");
  s.points.balance = price * 2 + 5;
  const first = buyProduct(s, "box", T0, () => 0.5);
  assert.deepStrictEqual([first.ok, first.spent, first.balance, first.boxId], [true, price, price + 5, "b9"]);
  assert.strictEqual(s.boxes.length, 9);
  assert.deepStrictEqual([s.boxes[8]!.name, boxName(s.boxes[8]!, 8)], ["", "박스 9"]);
  assert.ok(s.boxes[8]!.slots.every((x) => x === null), "새 박스는 비어 있다");
  assert.deepStrictEqual(boxBuyable(s.boxes), { ok: true, bought: 1, total: 56 });
  // 순서를 바꾼 뒤에 사도 식별자가 겹치지 않는다
  orderBox(s.boxes, 8, 0);
  assert.strictEqual(buyProduct(s, "box", T0, () => 0.5).boxId, "b10");
  assert.strictEqual(new Set(s.boxes.map((b) => b.id)).size, s.boxes.length);
});
check(() => {
  // 상한 — 64개면 더 사지 못한다. 포인트는 그대로다
  const s = empty(T0);
  while (s.boxes.length < BOX_RULES.max) assert.ok(addBox(s.boxes));
  assert.strictEqual(addBox(s.boxes), null);
  s.points.balance = 10_000;
  assert.strictEqual(buyProduct(s, "box", T0, () => 0.5).reason, "box-max");
  assert.strictEqual(s.points.balance, 10_000);
  assert.strictEqual(s.boxes.length, 64);
});
check(() => {
  // 옛 규칙으로 8개 넘게 늘어난 저장 — 읽어도 그대로다. 구매 수에 든다
  const old = seed();
  for (let i = 0; i < 8; i += 1) addBox(old.boxes);
  const read = normalize(JSON.parse(JSON.stringify(old)), T0);
  assert.strictEqual(read!.boxes.length, 16, "줄이지 않는다");
  assert.deepStrictEqual(boxBuyable(read!.boxes), { ok: true, bought: 8, total: 56 });
});
check(() => {
  // 둘 곳이 없으면 — 박스에 넣지 않고, 부화·보관·우편 포켓몬을 거절한다. 박스는 늘지 않는다
  const s = seed();
  for (const b of s.boxes) b.slots = b.slots.map((x, i) => x ?? `f${b.id}-${i}`);
  for (const slot of s.party.slots) if (slot.state === "empty") Object.assign(slot, { state: "pokemon", petId: "p1", hidden: false });
  assert.strictEqual(boxRoom(s.boxes), 0);
  assert.strictEqual(addToBox(s.boxes, "p9"), null, "가득 차면 넣지 않는다");
  assert.strictEqual(s.boxes.length, 8, "박스는 저절로 늘지 않는다");
  // 부화 — 알은 그대로 남는다
  s.eggs.push({ id: "e1", kind: "random", boughtAt: T0, remainMs: 0, ready: true, candidates: ["pikachu"], careCooldownMs: 0, actions: { pat: 0, song: 0 } });
  const pets = s.pets.length;
  assert.deepStrictEqual(openEgg(s, "e1", T0, () => 0.99), { ok: false, reason: "box-full" });
  assert.strictEqual(s.eggs.length, 1, "알은 그대로");
  assert.strictEqual(s.pets.length, pets, "개체를 만들지 않는다");
  // 보관
  assert.strictEqual(keepInBox(s, "p1").reason, "box-full");
  // 우편 — 도구와 함께 온 편지도 통째로 넣지 않는다
  const mail = applyGifts(s, "m1", [{ kind: "points", count: 10 }, { kind: "pokemon", species: "pikachu", count: 1 }], undefined, { now: T0, rand: () => 0.5 });
  assert.deepStrictEqual(mail, { ok: false, reason: "box-full" });
  assert.strictEqual(s.points.balance, 0, "포인트도 넣지 않는다");
  // 한 칸을 비우면 부화한다
  s.boxes[3]!.slots[7] = null;
  const opened = openEgg(s, "e1", T0, () => 0.99);
  assert.strictEqual(opened.ok, true);
  assert.strictEqual(opened.toBox, true);
  assert.strictEqual(s.boxes[3]!.slots[7], opened.petId);
});
check(() => {
  // 새 개체는 앞 박스의 첫 빈 칸 — 빈 박스로 건너뛰지 않는다
  const s = seed();
  assert.deepStrictEqual(addToBox(s.boxes, "p9"), { boxIndex: 0, slotIndex: 2 });
  assert.strictEqual(s.boxes.length, BOX_RULES.start);
});
check(() => {
  // 옛 저장(박스 1개)은 읽을 때 8개가 된다. 박스 이름과 칸은 그대로다
  const old = seed();
  old.boxes = [old.boxes[0]!];
  old.boxes[0]!.name = "내 박스";
  const read = normalize(JSON.parse(JSON.stringify(old)), T0);
  assert.ok(read, "읽힌다");
  assert.strictEqual(read!.boxes.length, BOX_RULES.start);
  assert.strictEqual(read!.boxes[0]!.name, "내 박스");
  assert.deepStrictEqual(read!.boxes[0]!.slots.slice(0, 2), ["p1", "p2"]);
  assert.strictEqual(newBox("b9", "박스 9").slots.length, BOX_RULES.size);
});

process.stdout.write(`통과 (${n}건)\n`);
