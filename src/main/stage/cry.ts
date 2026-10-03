// 울음소리 — 놀아주기가 성공하면 그 포켓몬의 PokeAPI 울음소리를 무대에서 한 번 낸다
// (worklog/records/code-structure/design/10-main.md 3.10절 stage/cry.ts)
//
// 설정의 "알림 소리" 가 꺼져 있으면 내지 않는다. 받은 소리는 ~/.claude/pokebuddy/cries/ 에 캐시한다 (src/main/art/cries.ts)
// 같은 포켓몬을 연달아 누르면 겹쳐 울지 않게 잠깐 쉰다
import { createCries, type Cries } from "../art/cries";
import type { SaveV3 } from "../../shared/save-v3";
import { gainOf } from "../../state/settings";
import { SOUND_RULES } from "../../state/rules";

export const CRY_RULES = { gapMs: 1500 } as const;

export interface CryDeps {
  dir: string; // 울음소리 캐시 폴더
  read(): SaveV3 | null;
  send(petId: string, uri: string, volume: number): void; // 무대에 보낸다
}

export interface Cry {
  play(petId: string): Promise<void>;
  gain(): number; // 울음소리 음량 0~1. 저장을 못 읽었으면 0
}

export function createCry(deps: CryDeps): Cry {
  let cries: Cries | null = null; // 처음 울 때 만든다
  const at = new Map<string, number>();
  const gainIn = (save: SaveV3 | null): number => (save ? gainOf(save.settings, SOUND_RULES.cryMax) : 0);
  return {
    async play(petId) {
      const now = Date.now();
      if (now - (at.get(petId) ?? 0) < CRY_RULES.gapMs) return;
      at.set(petId, now);
      const save = deps.read();
      const volume = gainIn(save);
      if (!save || volume <= 0) return;
      const pet = save.pets.find((p) => p.id === petId);
      if (!pet) return;
      cries ??= createCries(deps.dir);
      const uri = await cries.get(pet.species);
      if (uri) deps.send(petId, uri, volume);
    },
    gain: () => gainIn(deps.read()),
  };
}
