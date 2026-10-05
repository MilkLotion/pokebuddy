// 아이콘 말풍선 — 줍기·배고픔·심심함을 포켓몬 위에 그림으로 띄운다
// (worklog/records/code-structure/design/10-main.md 3.10절 stage/bubbles.ts)
//
// 말풍선 아이콘 열쇠 — 글자 대신 그림을 넣는다 (2026-09-29 사용자 결정 "말풍선에 아이콘들 넣어")
//   배고픔 고기 1개 · 매우 배고픔 고기 3개 · 포인트 금화 — 우리가 그린 assets/items/meat.png · coin.png
//   심심해·지루해 장난감 공 1개 — 장난감 도구 그림 item:toy (2026-10-05 돌봄 개편, Figma 05 `Desktop / Bubble · 배고픔·심심해`)
//   도구·진화용 도구 — 관리 창과 같은 도구 그림(item:<식별자>) · 포켓몬 — 데려온 종의 초상(pokemon:<종>[:shiny])
// 그림을 하나라도 못 구하면 말풍선을 띄우지 않는다. 글자로 되돌리지 않는다
import type { FindRecordV3, PetV3, SaveV3 } from "../../shared/save-v3";
import { createBoredBubbles, createHungerBubbles } from "./hunger-bubble";
import type { Portraits } from "../art/portraits";
import type { StageGroup } from "./stage-group";

// 말풍선을 보이는 시간 5초 — 2026-09-25 구현에서 정했고, 2026-09-27 사용자가 되풀이 간격만 정하고 이 값은 그대로 두었다
// (worklog/records/game-runtime/record.md "배고픔 말풍선 되풀이")
const BUBBLE_RULES = { showMs: 5000 } as const;

const MEAT = "item:meat";
const COIN = "item:coin";
const TOY = "item:toy";

export function foundIconOf(rec: FindRecordV3, save: SaveV3 | null): string {
  if (rec.kind === "points") return COIN;
  if (rec.kind !== "pokemon") return `item:${rec.ref}`;
  const shiny = save?.pets.find((p) => p.id === rec.newPetId)?.shiny === true;
  return `pokemon:${rec.ref}${shiny ? ":shiny" : ""}`;
}

export interface BubblesDeps {
  portraits(): Portraits | null; // 그림 캐시 — 부팅 전에는 없다
  stages(): StageGroup | null;
  hidden(): boolean; // 직접 숨긴 동안은 띄우지 않는다
}

export interface Bubbles {
  say(petId: string, keys: string[]): void;
  onTick(now: number, pets: readonly PetV3[]): void; // 배고픔·심심함 — 무대에 나와 있는 마리만
  found(records: readonly FindRecordV3[], save: SaveV3 | null): void; // 줍기 — 주운 마리 위에
}

export function createBubbles(deps: BubblesDeps): Bubbles {
  const hunger = createHungerBubbles();
  const bored = createBoredBubbles();

  // 열쇠별 그림(data URI). 하나라도 못 구하면 null
  async function urisOf(keys: string[]): Promise<Record<string, string> | null> {
    const art = deps.portraits();
    if (!art) return null;
    const out: Record<string, string> = {};
    for (const key of new Set(keys)) {
      const mon = /^pokemon:([a-z0-9-]+)(:shiny)?$/.exec(key);
      const got = mon ? Object.values(await art.get([{ slug: mon[1] ?? "", shiny: !!mon[2] }]))[0] : (await art.icons([key]))[key];
      if (!got) return null;
      out[key] = got;
    }
    return out;
  }

  // 그림을 구한 뒤 그 마리 위에 showMs 동안. 그 사이 무대에서 빠졌거나 직접 숨겼으면 띄우지 않는다
  const say = (petId: string, keys: string[]): void => {
    void urisOf(keys).then((uris) => {
      const st = deps.stages();
      if (uris && st && !deps.hidden() && st.petOf(petId)) st.say(petId, keys, uris, BUBBLE_RULES.showMs);
    });
  };

  return {
    say,
    // 무대에 나와 있는 포켓몬이 배고픔·매우 배고픔 구간에 들어가면 띄우고, 머무는 동안 되풀이한다 (src/main/stage/hunger-bubble.ts).
    // 숨긴 포켓몬은 무대에 없어 띄우지 않는다. 직접 숨긴 동안에도 띄우지 않는다
    onTick(now, pets) {
      const st = deps.stages();
      if (deps.hidden() || !st) return;
      const shown = pets.filter((p) => st.petOf(p.id));
      // 같은 틱에 둘 다면 한 말풍선에 같이 — 배고픔 고기 1개(매우 배고픔 3개) 뒤에 장난감 공 1개
      const keys = new Map<string, string[]>();
      for (const b of hunger.due(shown, now)) keys.set(b.id, b.level === "starving" ? [MEAT, MEAT, MEAT] : [MEAT]);
      for (const b of bored.due(shown, now)) keys.set(b.id, [...(keys.get(b.id) ?? []), TOY]);
      for (const [id, k] of keys) say(id, k);
    },
    found(records, save) {
      for (const rec of records) say(rec.petId, [foundIconOf(rec, save)]);
    },
  };
}
