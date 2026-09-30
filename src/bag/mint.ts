// 민트 식별자 — 성격별 민트 21종을 민트 한 종류로 합쳤다 (2026-09-29 사용자 결정 "민트는 그냥 지금것도 한 종류로 통일")
// 가져오는 것이 없는 파일이다. 저장 정규화(src/save/v3.ts)·v2 변환·우편함이 함께 쓴다
export const MINT_ID = "mint";

// 옛 민트 식별자 — `<성격>-mint`(2026-09-25~2026-09-29)와 `mint-<성격>`(그 전)
export const isOldMint = (id: string): boolean => /^[a-z]+-mint$/.test(id) || /^mint-[a-z]+$/.test(id);

// 옛 도구 식별자 → 지금 식별자. 옛 민트는 모두 `mint` 다
export const currentItemId = (id: string): string => (isOldMint(id) ? MINT_ID : id);

// 성격민트 은퇴 — 2026-09-30 사용자 결정 "성격은 없앨거야 … 민트, 성격변경 등 없애자",
// "이미 가진 민트는 사용자데이터에 있으면 다 삭제하고 그 금액만큼 포인트 보내게 할거야".
// 켜 두면 상점·줍기 보상에서 빠지고, 사용 명령은 거절하고, 우편 선물은 포인트로 바꿔 받는다. 성격 코드와 민트 사용 코드는 남긴다
export const MINT_RETIRED = true;
// 돌려주는 값 — 1개당 상점 구매가(data/items.json mint.price)
export const MINT_REFUND_EACH = 100;

// 가방의 민트를 지우고 그 값만큼 포인트를 더한다. 돌려준 포인트를 돌려준다(없으면 0).
// 저장을 읽을 때마다 부른다(src/save/v3.ts normalize). 지운 가방을 쓰면 민트가 없어 두 번 돌려주지 않는다
export function refundRetiredMint(bag: Record<string, number>, points: { balance: number }): number {
  if (!MINT_RETIRED) return 0;
  const count = bag[MINT_ID] ?? 0;
  if (count <= 0) return 0;
  delete bag[MINT_ID];
  const refund = count * MINT_REFUND_EACH;
  points.balance += refund;
  return refund;
}
