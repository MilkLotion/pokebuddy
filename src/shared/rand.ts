// 난수 — 무작위는 받아서 쓴다. 자체 검사가 결과를 정할 수 있어야 한다
// 서버의 추첨(src/verify/save-rules.ts rollEgg)은 따로 둔다 — 복사본이 서버에 올라간다

export type Rand = () => number; // 0 이상 1 미만

// 가중치로 하나 고른다. 후보가 없거나 가중치 합이 0 이하면 난수를 쓰지 않고 null.
// 난수는 한 번 쓴다. 끝까지 남으면(부동소수 오차) 마지막 후보다
export function pickByWeight<T>(list: readonly T[], weightOf: (x: T) => number, rand: Rand): T | null {
  const total = list.reduce((a, x) => a + weightOf(x), 0);
  if (!list.length || total <= 0) return null;
  let roll = rand() * total;
  for (const x of list) {
    roll -= weightOf(x);
    if (roll < 0) return x;
  }
  return list[list.length - 1] ?? null;
}
