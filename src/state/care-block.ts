// 밥 주기·놀아주기를 지금 할 수 있는가 — 막는 까닭 하나를 돌려준다. 할 수 있으면 null
// 규칙의 정본은 여기 하나다. 가방의 먹이 사용(src/bag/use.ts), 돌봄 명령(src/state/care.ts checkCare),
// 화면 값(src/view/pet.ts feedBlock·playBlock → 단추 글자·흐림, 가방 기기 창 막힘)이 모두 이 함수를 본다
// (2026-10-05 사용자 지적 "애초에 밥이랑 규칙이 똑같은거잖아. 왜 코드가 따로 짜지는거지?")
import { PET_RULES } from "../party/rules.js";
import type { PetV3 } from "../shared/save-v3";

export type FeedBlock = "full" | "cooldown";
export type PlayBlock = "cooldown";

// 밥 — 기본먹이·프리미엄먹이가 같이 쓴다. 만복도가 가득이면 못 먹는다(1 이라도 줄어야 한다), 그다음 밥 주기 쿨타임
// (2026-10-05 사용자 결정 "1이라도 떨어져야 쓸 수 있게 하자")
export const feedBlock = (pet: Pick<PetV3, "fullness" | "feedCooldownMs">): FeedBlock | null =>
  pet.fullness >= PET_RULES.statMax ? "full" : pet.feedCooldownMs > 0 ? "cooldown" : null;

// 놀아주기 — 쿨타임뿐이다. 장난감은 쿨타임이 없다
export const playBlock = (pet: Pick<PetV3, "playCooldownMs">): PlayBlock | null => (pet.playCooldownMs > 0 ? "cooldown" : null);
