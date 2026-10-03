// 후처리 사슬 — 저장이 바뀐 뒤 상태 판정을 한 번에 다시 본다. 거래 실행기(./executor.ts)와 시간 틱(./tick.ts)이 같은 사슬을 부른다
//   순서: (revertMega 면) 메가 풀기 → 메가스톤 → 해금 → 튜토리얼 줄 → 업적
//   틱은 메가 풀기를 하지 않는다 — 시간이 흘러도 개체의 자리와 종은 바뀌지 않는다
// 배너 순서는 부화 → 진화 → 업적이다. 진화 판정은 배너 줄(src/notify)이 한다
import type { DexOptions } from "../dex/data";
import { grantStones } from "../dex/mega.js";
import { unlockByRules } from "../dex/unlocks.js";
import { settleMega } from "../party/mega-form.js";
import { queueTutorials } from "../tutorial/queue.js";
import { evaluate } from "../achievement/evaluate.js";
import type { SaveV3 } from "../shared/save-v3";

export interface SettleOptions {
  prev?: SaveV3; // 바뀌기 전 저장 — 레벨업 업적이 비교한다
  revertMega: boolean; // 프리셋을 떠났거나 종이 바뀐 개체의 메가 모습을 푼다
  opts?: DexOptions;
}

// 이번에 달성한 업적을 돌려준다
export function applySettle(save: SaveV3, now: number, o: SettleOptions): { achieved: string[] } {
  if (o.revertMega) settleMega(save, o.opts);
  grantStones(save, o.opts); // 메가진화 조건을 모두 채운 개체에 메가스톤을 준다. 배너는 저장의 stone 을 보고 뜬다 (src/notify/pending.ts)
  // 첫 선택 한 번으로 다른 후보·기본형이 해금되고, 꺼내기 한 번으로도 달성이 생긴다
  unlockByRules(save, now, o.opts);
  queueTutorials(save, now);
  return { achieved: evaluate(save, now, o.opts, o.prev) };
}
