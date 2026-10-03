// 개체 처리기 — 진화, 돌봄, 첫 선택, 자리·크기, 모습 바꾸기
import { dayPartOf, evolve } from "../../dex/evolve.js";
import { setForm } from "../../dex/forms.js";
import { megaOf } from "../../dex/mega.js";
import { setMega } from "../../party/mega-form.js";
import { feedPet, playWithPet } from "../../state/care.js";
import { setHome, setSize } from "../../party/home.js";
import { begin } from "../../party/starter.js";
import type { TxHandler } from "../executor";
import { isObj, petIdOf, reasonOf } from "./args.js";

// ── 진화 ───────────────────────────────────────────────────────────────────────

// 진화 — 조건을 채운 개체를 사용자가 직접 진화시킨다. 후보가 여럿이면 골라야 한다
export const evolveHandler: TxHandler = (draft, args, ctx) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const choice = isObj(args) && typeof args.to === "string" ? args.to : undefined;
  const part = dayPartOf(ctx.now);
  const res = evolve(draft, petId, part, choice);
  if (!res.ok) return { ok: false, reason: reasonOf(res), ...(res.choices ? { choices: res.choices } : {}) };
  return { ok: true, result: { petId, from: res.from, to: res.to, usedItem: res.usedItem, ...(res.usedItems ? { usedItems: res.usedItems } : {}) } }; // 돌 + 지도면 usedItems 가 둘
};

// ── 돌봄 ───────────────────────────────────────────────────────────────────────
// 박스 개체는 돌보지 않는다 — 판정과 횟수 세기는 src/state/care.ts feedPet·playWithPet 이 한다

// 밥 주기 — 기본먹이를 쓰는 것과 같다. 무료이며 쿨타임을 함께 쓴다
export const feedHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = feedPet(draft, petId);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, fullness: res.fullness } };
};

// 놀아주기 — 쿨타임마다 한 번 친밀도를 올린다
export const playHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = playWithPet(draft, petId);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, affinity: res.affinity, streak: res.streak, longPlay: res.longPlay } };
};

// ── 첫 선택과 자리 ─────────────────────────────────────────────────────────────

// 첫 선택 — 저장이 비었을 때 한 번. 고른 종으로 개체 하나를 만들어 꺼내 놓는다
export const starterHandler: TxHandler = (draft, args, ctx) => {
  if (!isObj(args)) return { ok: false, reason: "bad-args" };
  const species = typeof args.species === "string" ? args.species : "";
  if (!species) return { ok: false, reason: "bad-args" };
  const res = begin(draft, species, ctx.now, ctx.rand);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId: res.petId, species: res.species, slotIndex: res.slotIndex } };
};

// 놓아 둔 자리와 그림 크기 — 끌어다 놓으면 자리를, 상세의 크기 단추는 크기를 보낸다. 한 요청에 하나만 온다
export const homeHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  if (isObj(args) && args.size !== undefined) {
    const sized = setSize(draft, petId, args.size);
    if (!sized.ok) return { ok: false, reason: reasonOf(sized) };
    return { ok: true, result: { petId, size: sized.size } };
  }
  const res = setHome(draft, petId, isObj(args) ? args.home : null, isObj(args) ? args.screen : undefined);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, home: res.home, ...(res.screen ? { screen: res.screen } : {}) } };
};

// 공유 sid 계열의 모습 바꾸기 — 고를 수 있는 종으로 지금 종만 바꾼다 (src/dex/forms.ts)
// 메가진화도 이 명령이다 — species 가 메가 모습이면 켜고, 메가 모습인 개체에 지금 종을 주면 기본 모습으로 돌린다 (src/dex/mega.ts)
export const formHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const want = isObj(args) ? args.species : undefined;
  const target = draft.pets.find((p) => p.id === petId);
  const off = target?.mega?.on != null && want === target.species;
  if (off || (typeof want === "string" && megaOf(want))) {
    const res = setMega(draft, petId, off ? null : want);
    if (!res.ok) return { ok: false, reason: reasonOf(res) };
    return { ok: true, result: { petId, mega: res.on, reverted: res.reverted } };
  }
  const res = setForm(draft, petId, isObj(args) ? args.species : undefined);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, from: res.from, to: res.to } };
};
