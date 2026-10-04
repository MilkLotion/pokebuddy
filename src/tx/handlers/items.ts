// 알·상점·가방 처리기 — 알 열기, 사기, 도구 쓰기·팔기, 포켓몬 팔기
import { useItem } from "../../bag/use.js";
import { itemOf } from "../../bag/items.js";
import { openEgg } from "../../egg/open.js";
import { buyProduct } from "../../shop/buy.js";
import { sellItem } from "../../shop/sell.js";
import { sellPet } from "../../shop/sell-pet.js";
import type { TxHandler } from "../executor";
import { isArgsRecord, petIdOf, reasonOf } from "./args.js";

// ── 알 ─────────────────────────────────────────────────────────────────────────

const eggIdOf = (args: unknown): string | null => {
  if (!isArgsRecord(args)) return null;
  const id = args.eggId;
  return typeof id === "string" && id ? id : null;
};

// 열기 — 결과 판정, 개체 생성, 배치, 도감 기록을 한 거래로 묶는다
export const openHandler: TxHandler = (draft, args, ctx) => {
  const eggId = eggIdOf(args);
  if (!eggId) return { ok: false, reason: "bad-args" };
  // 계정 시드가 있으면 알마다 정해진 난수 — 되돌려 다시 열어도 같은 결과다. 서버 검증이 같은 계산으로 대조한다(P4b)
  const res = openEgg(draft, eggId, ctx.now, ctx.eggRand?.(eggId) ?? ctx.rand);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return {
    ok: true,
    result: res.egg
      ? { egg: res.egg }
      : { petId: res.petId, species: res.species, shiny: res.shiny, slotIndex: res.slotIndex, toBox: res.toBox },
  };
};

// ── 상점 ───────────────────────────────────────────────────────────────────────

// 구매 — 검사와 반영을 한 거래로 묶는다. 하나라도 걸리면 아무것도 바꾸지 않는다
export const buyHandler: TxHandler = (draft, args, ctx) => {
  if (!isArgsRecord(args)) return { ok: false, reason: "bad-args" };
  const productId = typeof args.productId === "string" ? args.productId : "";
  if (!productId) return { ok: false, reason: "bad-args" };
  // 수량 — 없으면 1. 여러 개는 값이 있는 도구와 알만 된다(포켓몬·파티 칸·0P 상품은 하나씩). 상한은 포인트다.
  // 알은 돌보미집 빈 칸과 단일 포켓몬 알의 남은 수도 상한이다 — 매번 buy 가 검사한다 (2026-09-30 사용자 결정 "알 여러개 구매 가능하게 수정.")
  const count = args.count === undefined ? 1 : args.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return { ok: false, reason: "bad-count" }; // 같은 잘못은 같은 코드 (94 항목 9-5-2)
  let res = buyProduct(draft, productId, ctx.now, ctx.rand);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  let spent = res.spent ?? 0;
  const eggIds: string[] = res.eggId ? [res.eggId] : [];
  if (count > 1) {
    if (!spent || res.petId || res.slotIndex !== undefined || res.preset !== undefined || res.boxId !== undefined) return { ok: false, reason: "bad-args" };
    for (let i = 1; i < count; i += 1) {
      res = buyProduct(draft, productId, ctx.now, ctx.rand);
      if (!res.ok) return { ok: false, reason: reasonOf(res) }; // 실행기가 사본을 버린다 — 앞서 산 것도 반영하지 않는다
      spent += res.spent ?? 0;
      if (res.eggId) eggIds.push(res.eggId);
    }
  }
  return {
    ok: true,
    result: {
      productId, count, spent, balance: res.balance, eggId: eggIds[0], ...(eggIds.length ? { eggIds } : {}),
      petId: res.petId, slotIndex: res.slotIndex, toBox: res.toBox, ...(res.preset !== undefined ? { preset: res.preset } : {}), ...(res.boxId !== undefined ? { boxId: res.boxId } : {}),
    },
  };
};

// ── 가방 ───────────────────────────────────────────────────────────────────────

// 도구 사용 — 대상 개체에 효과를 적용하고 하나를 차감한다
export const useHandler: TxHandler = (draft, args) => {
  if (!isArgsRecord(args)) return { ok: false, reason: "bad-args" };
  const itemId = typeof args.itemId === "string" ? args.itemId : "";
  const petId = petIdOf(args);
  if (!itemId || !petId) return { ok: false, reason: "bad-args" };
  const nature = typeof args.nature === "string" ? args.nature : undefined;
  // 수량 — 없으면 1. 여러 개는 경험사탕·이상한사탕만 된다(가방 사용 패널의 수량, 2026-09-27 사용자 결정).
  // 한 거래로 쓴다. 하나라도 못 쓰면 실행기가 사본을 버려 앞서 쓴 것도 반영하지 않는다
  const count = args.count === undefined ? 1 : args.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return { ok: false, reason: "bad-count" }; // 같은 잘못은 같은 코드 (94 항목 9-5-2)
  if (count > 1 && !["exp", "level"].includes(itemOf(itemId)?.effect ?? "")) return { ok: false, reason: "bad-args" };
  let res = useItem(draft, itemId, petId, { nature });
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  for (let i = 1; i < count; i += 1) {
    res = useItem(draft, itemId, petId, { nature });
    if (!res.ok) return { ok: false, reason: reasonOf(res) };
  }
  return {
    ok: true,
    result: { itemId, petId, left: res.left, level: res.level, exp: res.exp, fullness: res.fullness, nature: res.nature, shiny: res.shiny },
  };
};

// 도구 판매 — 가방에서 count 개를 빼고 판매가만큼 포인트를 더한다 (2026-09-30 사용자 결정, src/shop/sell.ts)
export const sellHandler: TxHandler = (draft, args) => {
  if (!isArgsRecord(args)) return { ok: false, reason: "bad-args" };
  const itemId = typeof args.itemId === "string" ? args.itemId : "";
  if (!itemId) return { ok: false, reason: "bad-args" };
  // 수량 — 없으면 1. 1 이상의 정수가 아니면 bad-count
  const count = args.count === undefined ? 1 : args.count;
  if (typeof count !== "number") return { ok: false, reason: "bad-count" };
  const res = sellItem(draft, itemId, count);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { itemId, count, earned: res.earned, left: res.left, balance: res.balance } };
};

// 포켓몬 판매 — 박스 개체를 지우고 판매가만큼 포인트를 더한다. 프리셋에 든 개체는 팔지 않는다 (2026-10-01·10-02 사용자 결정, src/shop/sell-pet.ts)
export const sellPetHandler: TxHandler = (draft, args) => {
  const petId = petIdOf(args);
  if (!petId) return { ok: false, reason: "bad-args" };
  const res = sellPet(draft, petId);
  if (!res.ok) return { ok: false, reason: reasonOf(res) };
  return { ok: true, result: { petId, species: res.species, earned: res.earned, balance: res.balance } };
};
