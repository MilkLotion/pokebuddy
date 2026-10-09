// 표면의 명령(Command) → 거래 처리기의 인자 — 대상(target)을 명령마다 정해진 인자로 옮긴다. 보낸 쪽이 target 을 주지 않으면 args 의 같은 이름을 본다
import type { Command } from "../shared/command.js";

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) ? v : undefined);

// `Command` 의 target·args 를 명령마다 다른 인자 모양으로 바꾼다
export function argsFromCommand(command: Command): Record<string, unknown> {
  const a = command.args ?? {};
  const target = str(command.target); // 빈 글자는 없는 것으로 본다 — 메인 등록부(src/main/app/commands.ts target·petTarget)와 같은 규칙이다
  switch (command.cmd) {
    case "party.show":
    case "party.hide":
      return { petId: target ?? str(a.petId) };
    case "party.keep":
      return { petId: target ?? str(a.petId), ...(a.toBoxId !== undefined ? { toBoxId: str(a.toBoxId) } : {}), ...(a.toSlot !== undefined ? { toSlot: int(a.toSlot) } : {}) };
    case "party.place":
    case "party.swap":
      return { petId: target ?? str(a.petId), slotIndex: int(a.slotIndex) };
    case "party.move":
      return { petId: target ?? str(a.petId), toSlot: int(a.toSlot) };
    case "party.preset":
      return { preset: int(a.preset) };
    case "party.preset.rename":
      return { preset: int(a.preset), name: typeof a.name === "string" ? a.name : undefined };
    case "battle.set":
      return { petId: target ?? str(a.petId), slotIndex: int(a.slotIndex) };
    case "battle.clear":
      return { slotIndex: int(a.slotIndex) };
    case "battle.move":
      return { slotIndex: int(a.slotIndex), toSlot: int(a.toSlot) };
    case "battle.import":
      return { preset: int(a.preset) };
    case "battle.moves":
      return { petId: target ?? str(a.petId) };
    case "battle.mega":
      return { petId: target ?? str(a.petId), form: str(a.form) ?? null };
    case "egg.open":
      return { eggId: target ?? str(a.eggId) };
    case "bag.use":
      return { itemId: target ?? str(a.itemId), petId: str(a.petId), nature: str(a.nature), ...(a.count !== undefined ? { count: a.count } : {}), ...(a.pick !== undefined ? { pick: str(a.pick) } : {}) }; // pick — 유대의고삐로 부를 말
    case "bag.sell":
      return { itemId: target ?? str(a.itemId), ...(a.count !== undefined ? { count: a.count } : {}) };
    case "shop.buy":
      return { productId: target ?? str(a.productId), ...(a.count !== undefined ? { count: a.count } : {}) };
    case "evolve":
      return { petId: target ?? str(a.petId), to: str(a.to) };
    case "feed":
    case "play":
    case "pet.sell":
      return { petId: target ?? str(a.petId) };
    case "pet.sell.many":
      return { petIds: Array.isArray(a.petIds) ? a.petIds : undefined };
    case "achievement.claim":
      return { id: target ?? str(a.id) };
    case "tutorial.skip":
    case "tutorial.done":
    case "tutorial.replay":
      return { id: target ?? str(a.id), steps: int(a.steps) };
    case "settings.set":
      return { key: target ?? str(a.key), value: a.value };
    case "starter.pick":
      return { species: target ?? str(a.species) };
    case "box.sort":
      return { boxId: target ?? str(a.boxId), by: str(a.by) };
    case "box.move":
      return { boxId: target ?? str(a.boxId), slot: int(a.slot), ...(a.toBoxId !== undefined ? { toBoxId: str(a.toBoxId) } : {}), ...(a.toSlot !== undefined ? { toSlot: int(a.toSlot) } : {}) };
    case "box.rename":
      return { boxId: target ?? str(a.boxId), name: typeof a.name === "string" ? a.name : undefined };
    case "box.order":
      return { boxId: target ?? str(a.boxId), to: int(a.to) };
    case "pet.form":
      return { petId: target ?? str(a.petId), species: str(a.species) };
    case "pet.set":
      return { petId: target ?? str(a.petId), home: a.home, ...(a.screen !== undefined ? { screen: a.screen } : {}), ...(a.size !== undefined ? { size: a.size } : {}) };
    default:
      return { ...a };
  }
}
