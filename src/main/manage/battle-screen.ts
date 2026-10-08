// 설정창과 배틀 창 사이의 길 — 판(엔진 입력·결과)을 받아 화면 모델을 만들고 그림을 풀어 배틀 창에 보낸다
// 실제 진입(상대 고르기 → 서버 판정)은 아직 없다(docs/specs/adventure.md "상대 고르기"). 지금은 개발 실행에서만 여는 길이 있다:
//   POKEBUDDY_DEV_BATTLE=<시드> 로 띄우면 설정창을 열 때 내 배틀 파티와 시드로 뽑은 상대 6마리의 판을 로컬 엔진으로 돌려 띄운다
import path from "node:path";
import type { BrowserWindow } from "electron";
import { runBattle, type EngineFighter } from "../../battle/engine.js";
import { battleTypeChart, buildFighter, petFighter } from "../../battle/fighter.js";
import { battleMegaOf, battleSlots } from "../../battle/party.js";
import { tierOf } from "../../battle/tier.js";
import { isMetaKey } from "../../dex/data.js";
import { profileOf } from "../../dex/species.js";
import { speciesMoveTable, speciesTable } from "../../dex/tables.js";
import type { SaveV3 } from "../../shared/save-v3";
import { battleScreenArtKeys, battleScreenModel, withBattleScreenArt, type BattleScreenInput } from "../../view/battle-screen.js";
import type { LookSheets } from "../../shared/model/stage";
import type { ArtLoader } from "../art/stage-art.js";
import { createBattleWindow } from "../windows/battle-window.js";

export interface BattleScreenDeps {
  preload: string;
  html: string; // 설정창 문서 — 배틀 창 문서는 같은 폴더의 battle-screen.html
  parent(): BrowserWindow | null;
  art(keys: string[]): Promise<Record<string, string | null>>; // 기기 창과 같은 그림 풀기 (src/main/manage/devices.ts deviceArt)
  stageArt(): ArtLoader | null; // 무대 그림 불러오기 — 없으면 초상으로 그린다
}

export interface BattleScreen {
  open(input: BattleScreenInput): Promise<void>;
  openDev(save: SaveV3, seed: number): Promise<void>; // 개발 실행 전용
  close(): void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 개발용 상대 — 재생 도구와 같은 풀(종족값 합 400 이상, 전설급 제외)에서 시드로 6마리 (src/tools/battle/replay-battle.ts)
function devPool(): EngineFighter[] {
  const pool: EngineFighter[] = [];
  for (const slug of Object.keys(speciesTable())) {
    if (isMetaKey(slug) || !speciesMoveTable()[slug]) continue;
    if ((profileOf(slug).bst ?? 0) < 400 || tierOf(slug)) continue;
    const f = buildFighter({ species: slug });
    if (f) pool.push(f);
  }
  return pool;
}

// 내 쪽 — 저장의 배틀 파티. 비었으면 풀에서 뽑는다
function myFighters(save: SaveV3, pick: () => EngineFighter): (EngineFighter | null)[] {
  const slots = battleSlots(save).map((id) => {
    const pet = id ? save.pets.find((p) => p.id === id) : undefined;
    return pet ? petFighter(pet, battleMegaOf(save, pet.id)) : null;
  });
  return slots.some((f) => f) ? slots : Array.from({ length: 6 }, pick);
}

export function wireBattleScreen(deps: BattleScreenDeps): BattleScreen {
  const win = createBattleWindow({ preload: deps.preload, html: path.join(path.dirname(deps.html), "battle-screen.html") });

  async function open(input: BattleScreenInput): Promise<void> {
    const model = battleScreenModel(input);
    const loader = deps.stageArt();
    const species = [...new Set(model.units.flatMap((side) => side.flatMap((u) => (u ? [u.species] : []))))];
    // 초상·타입 아이콘과 PMD 묶음을 함께 받는다. PMD 를 못 받은 종은 null — 렌더러가 초상으로 그린다
    const [art, looks] = await Promise.all([
      deps.art(battleScreenArtKeys(model)),
      Promise.all(species.map(async (s): Promise<[string, LookSheets | null]> => [s, loader ? ((await loader.loadLook(s).catch(() => null))?.sheets ?? null) : null])),
    ]);
    win.show(deps.parent(), { ...withBattleScreenArt(model, art), sprites: Object.fromEntries(looks) });
  }

  return {
    open,
    async openDev(save, seed) {
      const rand = mulberry32(seed * 7919);
      const pool = devPool();
      const pick = (): EngineFighter => pool[Math.floor(rand() * pool.length)]!;
      const sides = [myFighters(save, pick), Array.from({ length: 6 }, pick)] as const;
      const result = runBattle({ seed, sides, typeChart: battleTypeChart() });
      const reward = result.winner === 0 ? "+50P" : result.winner === 1 ? "+10P" : "+10P";
      await open({ sides, result, opponentName: "상대 · 2번 파티", reward: { lead: reward, detail: "다음 랜덤 배틀은 5분 뒤에 할 수 있어요." } });
    },
    close: () => win.close(),
  };
}
