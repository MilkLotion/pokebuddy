// 사탕 미리보기 — 쓰기 전에 새 레벨·얻는 경험치·넘쳐 사라지는 경험치와 한 번에 쓸 수 있는 개수를 셈한다. 규칙은 bag/use.ts 와 같다
// curve 는 경험치 곡선이다 — 칸 L 은 레벨 L 이 되는 누적 경험치(dex/growth.ts)
export type CandyEffect = "exp" | "level";

export interface CandyPet {
  level: number;
  exp: number;
}

// 사탕을 qty 개 쓰면 — level 은 한 개에 1레벨, exp 는 한 개에 amount 경험치. 경험치는 100레벨 값에서 멈춘다
export function candyResult(curve: readonly number[], pet: CandyPet, effect: CandyEffect, amount: number, qty: number): { level: number; gain: number; lost: number } {
  const cap = curve[100] ?? pet.exp;
  if (effect === "level") {
    const level = Math.min(100, pet.level + qty);
    return { level, gain: Math.max(0, (curve[level] ?? pet.exp) - pet.exp), lost: 0 };
  }
  const raw = pet.exp + amount * qty;
  const exp = Math.min(cap, raw);
  let level = pet.level;
  while (level < 100 && (curve[level + 1] ?? Infinity) <= exp) level += 1;
  return { level, gain: exp - pet.exp, lost: raw - exp };
}

// 한 번에 쓸 수 있는 최대 개수 — 가진 개수와 100레벨까지 필요한 개수 중 작은 쪽. 이미 100레벨이면 0
export function candyMax(curve: readonly number[], pet: CandyPet, effect: CandyEffect, amount: number, count: number): number {
  if (pet.level >= 100) return 0;
  if (effect === "level") return Math.min(count, 100 - pet.level);
  const cap = curve[100] ?? pet.exp;
  return amount > 0 ? Math.min(count, Math.ceil((cap - pet.exp) / amount)) : 0;
}
