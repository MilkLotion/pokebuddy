// 설정창과 배틀 창 사이의 길 — 판(엔진 입력·결과)을 받아 화면 모델을 만들고 그림을 풀어 배틀 창에 보낸다
// 실제 진입(상대 고르기 → 서버 판정)은 아직 없다(docs/specs/adventure.md "상대 고르기"). 지금은 개발 실행에서만 여는 길이 있다:
//   POKEBUDDY_DEV_BATTLE=<시드> 로 띄우면 설정창을 열 때 내 배틀 파티와 시드로 뽑은 상대 6마리의 판을 로컬 엔진으로 돌려 띄운다
//   POKEBUDDY_DEV_BATTLE_FOES=<JSON 경로> 를 더 주면 상대를 그 파일의 파티로 정한다(시드 n → n번째 파티)
import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { runBattle, type EngineFighter } from "../../battle/engine.js";
import { battleTypeChart, buildFighter, petFighter } from "../../battle/fighter.js";
import { battleMegaOf, battleSlots, battleSpeciesOf } from "../../battle/party.js";
import { tierOf } from "../../battle/tier.js";
import { isMetaKey } from "../../dex/data.js";
import { profileOf } from "../../dex/species.js";
import { speciesMoveTable, speciesTable } from "../../dex/tables.js";
import type { BattleLook } from "../../shared/model/battle-net.js";
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
  holdStage?(on: boolean): void; // 배틀 창이 떠 있는 동안 바탕화면의 포켓몬을 숨긴다
}

export interface BattleScreen {
  // 판을 받기 전 — 바탕화면 포켓몬을 먼저 숨기고 배틀 창을 준비 중 모습으로 띄운다 (2026-10-10 사용자 "포켓몬들사라지고 로딩하고 배틀시작으로")
  prepare(title: string): void;
  // 판을 받지 못했다 — 준비 중 창을 닫는다. 창이 닫히면 숨긴 포켓몬이 돌아온다(onClosed)
  cancel(): void;
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

// 개발용 상대 지정 — POKEBUDDY_DEV_BATTLE_FOES=<JSON 경로>, 형식 {parties: string[][]}. 시드로 파티 하나를 고른다(1 → 첫 파티)
function devFoes(seed: number): EngineFighter[] | null {
  const file = process.env.POKEBUDDY_DEV_BATTLE_FOES;
  if (!file) return null;
  try {
    const parties = (JSON.parse(fs.readFileSync(file, "utf8")) as { parties?: string[][] }).parties ?? [];
    const party = parties[(((seed - 1) % parties.length) + parties.length) % parties.length];
    const out = (party ?? []).map((species) => buildFighter({ species })).filter((f): f is EngineFighter => !!f);
    return out.length ? out : null;
  } catch (e) {
    console.error("개발용 상대 파일을 읽지 못했다", e);
    return null;
  }
}

// 내 쪽 그림 값 — 칸마다 개체의 이로치·성별. 그림 키는 화면 값(src/view/battle-screen.ts)이 정한다
function myLooks(save: SaveV3, mine: readonly (EngineFighter | null)[]): (BattleLook | null)[] {
  return battleSlots(save).map((id, i) => {
    const pet = id ? save.pets.find((p) => p.id === id) : undefined;
    return pet && mine[i] ? { shiny: pet.shiny, gender: pet.gender } : null;
  });
}

// 내 쪽 — 저장의 배틀 파티. 비었으면 풀에서 뽑는다
function myFighters(save: SaveV3, pick: () => EngineFighter): (EngineFighter | null)[] {
  const slots = battleSlots(save).map((id) => {
    const pet = id ? save.pets.find((p) => p.id === id) : undefined;
    return pet ? petFighter({ ...pet, species: battleSpeciesOf(save, pet) }, battleMegaOf(save, pet.id)) : null;
  });
  return slots.some((f) => f) ? slots : Array.from({ length: 6 }, pick);
}

export function wireBattleScreen(deps: BattleScreenDeps): BattleScreen {
  // waiting — 준비 중 창을 띄우고 판을 기다리는 중. 그 사이 사용자가 창을 닫으면 dropped — 판이 와도 다시 열지 않는다
  let waiting = false;
  let dropped = false;
  const win = createBattleWindow({
    preload: deps.preload,
    html: path.join(path.dirname(deps.html), "battle-screen.html"),
    onClosed: () => {
      if (waiting) dropped = true;
      deps.holdStage?.(false);
    },
  });

  function prepare(title: string): void {
    waiting = true;
    dropped = false;
    deps.holdStage?.(true);
    win.loading(deps.parent(), title);
  }

  function cancel(): void {
    waiting = false;
    dropped = false;
    if (win.isOpen()) win.close();
    else deps.holdStage?.(false);
  }

  async function open(input: BattleScreenInput): Promise<void> {
    const prepared = waiting;
    if (prepared && dropped) {
      // 준비 중에 사용자가 창을 닫았다 — 판은 서버·기록에 남고 창은 다시 열지 않는다
      waiting = false;
      dropped = false;
      return;
    }
    const model = battleScreenModel(input);
    const loader = deps.stageArt();
    // 칸마다 그림 키 — 처음 모습과 판 중에 바뀌는 모습(form 이벤트 — 메로엣타 스텝폼·킬가르도 블레이드폼 등). 이로치·성별이 칸마다 다르다
    const species = [...new Set(model.units.flatMap((side) => side.flatMap((u) => (u ? [u.look, ...Object.values(u.formLooks)] : []))))];
    // 초상·타입 아이콘과 PMD 묶음을 함께 받는다. PMD 를 못 받은 종은 null — 렌더러가 초상으로 그린다
    // 그림을 받지 못하면 빈 그림으로 그린다 — 렌더러가 초상·이름으로 대신한다. 준비 중 창이 멈춘 채 남지 않게
    const [art, looks] = await Promise.all([
      deps.art(battleScreenArtKeys(model)).catch((e: unknown) => {
        console.error("배틀 창 그림을 받지 못했다", e);
        return {} as Record<string, string | null>;
      }),
      Promise.all(species.map(async (s): Promise<[string, LookSheets | null]> => [s, loader ? ((await loader.loadLook(s).catch(() => null))?.sheets ?? null) : null])),
    ]);
    waiting = false;
    if (prepared && dropped) {
      dropped = false;
      return; // 그림을 받는 사이에 닫았다
    }
    deps.holdStage?.(true);
    win.show(deps.parent(), { ...withBattleScreenArt(model, art), sprites: Object.fromEntries(looks) });
  }

  return {
    prepare,
    cancel,
    open,
    async openDev(save, seed) {
      // 실제 판과 같은 흐름 — 준비 중 창을 먼저 띄우고 판을 연다. POKEBUDDY_DEV_BATTLE_WAIT(ms)만큼 서버를 기다리는 척한다(준비 중 화면 확인용)
      prepare("랜덤 배틀");
      const wait = Number(process.env.POKEBUDDY_DEV_BATTLE_WAIT ?? 0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const rand = mulberry32(seed * 7919);
      const pool = devPool();
      const pick = (): EngineFighter => pool[Math.floor(rand() * pool.length)]!;
      const sides = [myFighters(save, pick), devFoes(seed) ?? Array.from({ length: 6 }, pick)] as const;
      const result = runBattle({ seed, sides, typeChart: battleTypeChart() });
      const reward = result.winner === 0 ? "+50P" : result.winner === 1 ? "+10P" : "+10P";
      await open({ sides, result, looks: [myLooks(save, sides[0]), sides[1].map(() => null)], opponentName: "상대 · 2번 파티", reward: { lead: reward, detail: "다음 랜덤 배틀은 5분 뒤에 할 수 있어요." } });
    },
    close: () => win.close(),
  };
}
