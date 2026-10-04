// 순번 식별자 `접두어+숫자`(박스 b·알 e·개체 p·찾기 기록 f)의 번호 — 저장 정규화와 도메인이 같은 규칙을 쓴다
// 서버 검증(src/verify/save-rules.ts)은 import 없이 복사되는 파일이라 같은 셈을 따로 가진다

// 지금 있는 것 가운데 `접두어+숫자` 꼴 식별자의 가장 큰 번호. 없으면 0. 꼴이 다른 식별자는 세지 않는다
export function maxIdNo(items: readonly { id: string }[], prefix: string): number {
  let max = 0;
  for (const item of items) {
    if (!item.id.startsWith(prefix)) continue;
    const no = item.id.slice(prefix.length);
    if (/^\d+$/.test(no)) max = Math.max(max, Number(no));
  }
  return max;
}

// 다음 식별자 — 가장 큰 번호와 바닥값(지금까지 쓴 번호·지금 개수) 중 큰 것의 다음. 지운 것의 번호를 다시 쓰지 않는다
export function nextId(prefix: string, items: readonly { id: string }[], floor: number): string {
  return `${prefix}${Math.max(floor, maxIdNo(items, prefix)) + 1}`;
}
