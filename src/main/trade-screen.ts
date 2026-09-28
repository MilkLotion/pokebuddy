// 교환 탭이 그리는 값 — 교환 흐름의 보기(src/trade/session.ts)와 저장을 합쳐 화면이 바로 그릴 모양으로 바꾼다.
// 모양은 src/shared/manage.d.ts 의 TradeScreen. 화면은 Figma 05 Screens 섹션 `930:18244`(교환) 의 교환 6화면
//
// 저장을 읽기만 한다. 완료 화면의 "보낸 포켓몬"은 반영 뒤 저장에 없으므로 교환 중에 본 카드를 기억해 둔다
import { profile } from "../dex/species.js";
import { natureName, petName, typeName } from "./text.js";
import { isSinglePet, type TradePet } from "../trade/core.js";
import type { TradeViewModel } from "../trade/session.js";
import type { TradeCardView, TradeScreen } from "../shared/manage";
import type { PetV3, SaveV3 } from "../shared/save-v3";

// 개체 하나를 카드 값으로 — 모르는 종이면 null (조작한 제안 등)
export function cardOf(pet: Pick<TradePet, "species" | "shiny" | "level" | "nature">): TradeCardView | null {
  try {
    const types = profile(pet.species).types;
    return {
      species: pet.species,
      name: petName(pet.species),
      shiny: pet.shiny === true,
      level: pet.level,
      nature: natureName(pet.nature),
      types: types.map((t) => typeName(t)),
      typeIds: [...types],
    };
  } catch {
    return null;
  }
}

// 검사에 걸린 친구 제안도 종을 알면 보인다 — Figma `Trade / Blocked` 는 받을 수 없는 뮤츠를 카드로 보인다
function rawCard(raw: unknown): TradeCardView | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.species !== "string" || typeof r.level !== "number" || typeof r.nature !== "string") return null;
  return cardOf({ species: r.species, shiny: r.shiny === true, level: r.level, nature: r.nature as TradePet["nature"] });
}

const findPet = (save: SaveV3, id: string | null): PetV3 | null => (id ? save.pets.find((p) => p.id === id) ?? null : null);

export interface TradeScreenBuilder {
  build: (view: TradeViewModel) => TradeScreen;
}

export function createTradeScreen(read: () => SaveV3 | null): TradeScreenBuilder {
  let sent: TradeCardView | null = null; // 교환 중에 본 내 카드 — 완료 화면이 쓴다
  return {
    build(view) {
      const save = read();
      const ch = view.channel;
      const minePet = save ? findPet(save, view.myPetId) : null;
      const mine = minePet ? cardOf(minePet) : null;
      if (view.phase === "trading" && mine) sent = mine;
      if (view.phase === "idle" || view.phase === "hosting") sent = null;

      let received: TradeScreen["received"] = null;
      const got = save && view.received ? findPet(save, view.received.petId) : null;
      if (save && got) {
        const party = save.party.slots.findIndex((s) => s.state === "pokemon" && s.petId === got.id);
        const slot = party >= 0 ? save.party.slots[party] : undefined;
        const box = party < 0 ? save.boxes.find((b) => b.slots.includes(got.id)) : undefined;
        const card = cardOf(got);
        if (card) {
          received = {
            petId: got.id, card,
            party: party >= 0 ? party : null,
            box: box ? box.name : null,
            hidden: slot?.state === "pokemon" && slot.hidden === true,
            sent,
          };
        }
      }

      return {
        available: true,
        phase: view.phase,
        link: view.link,
        expiresAt: view.phase === "hosting" && ch?.expires_at ? Date.parse(ch.expires_at) || null : null,
        busy: view.busy,
        error: view.error,
        closedReason: ch?.closed_reason ?? null,
        friendJoined: ch?.friend_joined === true,
        friendName: ch?.friend_name ?? null,
        mine: view.phase === "done" ? sent : mine,
        myPetId: view.myPetId,
        myReady: ch?.my_ready === true,
        friend: view.friendPet ? cardOf(view.friendPet) : rawCard(ch?.friend_offer),
        friendReady: ch?.friend_ready === true,
        friendBlocked: view.friendBlocked,
        singles: save ? save.pets.filter((p) => isSinglePet(p)).map((p) => p.id) : [],
        received,
      };
    },
  };
}
