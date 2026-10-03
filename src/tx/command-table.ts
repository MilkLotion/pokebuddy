// 거래 명령 표 — 이름(src/shared/names/commands.ts 의 TxName) → 처리기. TxName 이 하나라도 빠지면 컴파일 오류다
//   action  args.petId 의 개체에 하는 일. 교환에 걸린 개체에 막힌 일이면 처리기 앞에서 trade-locked 로 거절한다 (src/party/pet-actions.ts)
//           감싸기는 처리기의 인자 검사보다 먼저 잠금을 본다 — 지금까지의 순서와 같다
import type { TxName } from "../shared/names/commands.js";
import { checkPetFree, type PetAction } from "../party/pet-actions.js";
import type { TxHandler } from "./executor";
import { petIdOf } from "./handlers/args.js";
import { boxMoveHandler, boxOrderHandler, boxRenameHandler, boxSortHandler } from "./handlers/box.js";
import { buyHandler, openHandler, sellHandler, sellPetHandler, useHandler } from "./handlers/items.js";
import { mailApplyHandler, mailReadHandler, tradeApplyHandler, tradeLockHandler, tradeUnlockHandler } from "./handlers/online.js";
import { keepHandler, moveHandler, placeHandler, presetApplyHandler, presetRenameHandler, swapHandler, visibilityHandler } from "./handlers/party.js";
import { evolveHandler, feedHandler, formHandler, homeHandler, playHandler, starterHandler } from "./handlers/pet.js";
import { claimHandler, settingsHandler, tutorialHandler } from "./handlers/progress.js";

export interface TxCommandDef {
  handler: TxHandler;
  action?: PetAction;
}

export const TX_COMMANDS = {
  "party.show": { handler: visibilityHandler(false) },
  "party.hide": { handler: visibilityHandler(true) },
  "party.place": { handler: placeHandler },
  "party.swap": { handler: swapHandler },
  "party.move": { handler: moveHandler },
  "party.keep": { handler: keepHandler },
  "party.preset": { handler: presetApplyHandler },
  "party.preset.rename": { handler: presetRenameHandler },
  "mail.apply": { handler: mailApplyHandler },
  "mail.read": { handler: mailReadHandler },
  "egg.open": { handler: openHandler },
  "shop.buy": { handler: buyHandler },
  "bag.use": { handler: useHandler, action: "use" },
  "bag.sell": { handler: sellHandler },
  "pet.sell": { handler: sellPetHandler },
  "evolve": { handler: evolveHandler, action: "evolve" },
  "feed": { handler: feedHandler },
  "play": { handler: playHandler },
  "achievement.claim": { handler: claimHandler },
  "tutorial.skip": { handler: tutorialHandler("skip") },
  "tutorial.done": { handler: tutorialHandler("done") },
  "settings.set": { handler: settingsHandler },
  "starter.pick": { handler: starterHandler },
  "pet.set": { handler: homeHandler },
  "pet.form": { handler: formHandler, action: "form" },
  "box.order": { handler: boxOrderHandler },
  "box.sort": { handler: boxSortHandler },
  "box.move": { handler: boxMoveHandler },
  "box.rename": { handler: boxRenameHandler },
  "trade.lock": { handler: tradeLockHandler },
  "trade.unlock": { handler: tradeUnlockHandler },
  "trade.apply": { handler: tradeApplyHandler },
} satisfies Record<TxName, TxCommandDef>;

// 표의 처리기에 교환 잠금을 씌운다
const withLock = (def: TxCommandDef): TxHandler => {
  const { handler, action } = def;
  if (!action) return handler;
  return (draft, args, ctx) => {
    const petId = petIdOf(args);
    if (petId) {
      const free = checkPetFree(draft, petId, action);
      if (!free.ok) return { ok: false, reason: free.reason };
    }
    return handler(draft, args, ctx);
  };
};

// 실행기가 받는 처리기 표 — createExecutor(ports, HANDLERS)
export const HANDLERS: Record<string, TxHandler> = Object.fromEntries(Object.entries(TX_COMMANDS as Record<string, TxCommandDef>).map(([name, def]) => [name, withLock(def)]));
