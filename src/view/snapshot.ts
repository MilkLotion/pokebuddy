// 화면이 읽는 모양 — 계약은 docs/specs/modules.md 의 `settings:snapshot`, 화면은 Figma `05 · Screens`
//
// 저장을 그대로 넘기지 않는다. 화면이 바로 그릴 수 있는 값으로 바꿔서 넘긴다.
//   슬러그 대신 한국어 이름, ms 대신 초·분 정수, 만복도 값 대신 구간 이름
// 모양은 src/shared/model/snapshot.ts 가 가진다. 렌더러와 같은 타입을 본다.
// 저장을 쓰지 않는다. 읽기만 한다.
// 시간 표기는 올림한다. 저장은 ms 정수로 두고 화면만 사람이 읽는 단위로 본다 (docs/specs/modules.md "저장 시점")
import { achievementName, itemName, petName, natureName } from "./text.js";
import { eggName, toolPrice } from "../shop/catalog.js";
import type { SaveV3 } from "../shared/save-v3";
import { rewardPokemon, achievementDefs, rewardEgg, rewardItem, rewardPoints } from "../achievement/defs.js";
import { BOX_RULES } from "../box/rules.js";
import { boxName } from "../box/boxes.js";
import { EGG_RULES } from "../egg/rules.js";
import { PARTY_RULES } from "../party/rules.js";
import { SHOP_RULES } from "../shop/rules.js";
import { activePreset, presetCount, presetName } from "../party/presets.js";
import type { AchievementDef } from "../dex/tables.js";
import { progressOf } from "../achievement/progress.js";
import { SIZE_STEPS } from "../party/size.js";
import { progressTo } from "../dex/growth.js";
import { isEvoItem, itemOf } from "../bag/items.js";
import { natureList as natureTable } from "../dex/natures.js";
import { sellPrice } from "../shop/sell.js";
import { numberText, pointText, waitText } from "../shared/count-text.js";
import { SETTING_CHOICES } from "../state/settings.js";
import type { AchievementView, BagItemView, BoxView, EggView, NatureOption, SettingsView, SlotView, Snapshot } from "../shared/model/snapshot";
import { unclaimedAchievementIds } from "../dex/tables.js";
import { SCREEN_TUTORIALS } from "../tutorial/conditions.js";
import { canShow, currentTutorial, replayableNow } from "../tutorial/queue.js";
import { gameDayPart } from "../shared/clock.js";
import { itemAbout } from "./bag.js";
import { shopList } from "./shop-list.js";
import { eggIconKey, itemArtKey } from "./device-art.js";
import { ceilSec } from "../shared/count-text.js";
import { petView } from "./pet.js";

// 보상 종류 → 화면 문구
const REWARD_WORD: Record<string, string> = { "party-slot": "파티 칸 +1" };

// 업적 보상 문구 — 포켓몬은 종 이름(라프라스), 포인트는 `1,000P`, 알은 알 이름, 도구는 도구 이름(여러 개면 `×N`)
const rewardText = (def: AchievementDef): string => {
  const species = rewardPokemon(def);
  if (species) return petName(species);
  const points = rewardPoints(def);
  if (points != null) return pointText(points); // 천 단위 쉼표는 공용 글자 (94 항목 9-2-5)
  const egg = rewardEgg(def);
  if (egg) return eggName(egg) ?? egg;
  const item = rewardItem(def);
  if (item) return item.count > 1 ? `${itemName(item.id)} ×${numberText(item.count)}` : itemName(item.id);
  return typeof def.reward === "string" ? REWARD_WORD[def.reward] ?? def.reward : "";
};

// 알 준비 시간의 진행 백분율 — 남은 시간만 저장하므로 전체는 규칙표에서 온다.
// 내림이다 — 경험치 진행(src/dex/growth.ts progressTo)과 같고, 준비되기 전에 100% 를 보이지 않는다 (94 항목 9-5-5)
const eggPercent = (remainMs: number, readyMs: number): number =>
  readyMs <= 0 ? 100 : Math.min(100, Math.max(0, Math.floor(((readyMs - remainMs) / readyMs) * 100)));

// 잠들기 기준 선택지 — 0 은 잠들지 않음
const sleepChoices = (): SettingsView["sleepChoices"] => SETTING_CHOICES.sleepAfterMin.map((min) => ({ value: min, label: min === 0 ? "잠들지 않음" : `${min}분` }));

// 시각은 부르는 쪽이 준다(메인은 게임 시계, 시험은 고정 시각) — 진화 후보의 낮·밤을 정한다.
// 전체 준비 시간과 칸 수는 규칙표에서 온다(예전에는 인자로도 받았지만 다른 값을 넘기는 곳이 없었다)
export function snapshotView(save: SaveV3, now: number): Snapshot {
  const eggReadyMs = EGG_RULES.readyMs;
  const boxSize = BOX_RULES.size;
  const maxEggs = EGG_RULES.maxEggs;
  const dayPart = gameDayPart(now);
  const byId = new Map(save.pets.map((p) => [p.id, p]));

  const slots: SlotView[] = save.party.slots.map((s, index) => {
    if (s.state !== "pokemon" || !s.petId) return { index, state: s.state };
    const pet = byId.get(s.petId);
    if (!pet) return { index, state: "empty" };
    return { index, state: "pokemon", pet: petView(save, pet, s.hidden === true, dayPart) };
  });

  const boxes: BoxView[] = save.boxes.map((b, i) => ({
    id: b.id,
    name: boxName(b, i),
    used: b.slots.filter((x) => x !== null).length,
    size: boxSize,
    slots: b.slots.map((id) => {
      const pet = id ? byId.get(id) : undefined;
      return pet ? petView(save, pet, true, dayPart) : null;
    }),
  }));

  const eggs: EggView[] = save.eggs.map((e) => ({
    id: e.id,
    kind: e.kind,
    icon: eggIconKey(e.kind),
    name: eggName(e.kind) ?? e.kind,
    ready: e.ready,
    remainSec: ceilSec(e.remainMs),
    percent: eggPercent(e.remainMs, eggReadyMs),
    noteText: e.ready ? "준비 완료" : `${eggPercent(e.remainMs, eggReadyMs)}% · ${waitText(ceilSec(e.remainMs))}`,
  }));

  const bag: BagItemView[] = Object.entries(save.bag)
    .filter(([, n]) => n > 0)
    .map(([id, count]) => {
      const item = itemOf(id);
      const sale = sellPrice(id);
      const about = itemAbout(save, id);
      return {
        id, icon: itemArtKey(id), name: itemName(id), count, evolution: isEvoItem(id),
        ...(item ? { effect: item.effect, amount: item.amount } : {}),
        ...(sale !== null ? { sellPrice: sale, buyPrice: toolPrice(id) ?? 0, sellRate: SHOP_RULES.sellRate } : {}),
        ...(about ? { about } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const achievements: AchievementView[] = achievementDefs().map(([id, def]) => {
    const row = save.achievements[id];
    return {
      id,
      name: achievementName(def),
      desc: def.desc ?? "",
      reward: rewardText(def),
      state: row?.claimedAt != null ? "claimed" : row?.achievedAt != null ? "achieved" : "locked",
      group: def.group,
      // 진행도는 미달성일 때만 — 달성한 뒤에는 값이 줄어도(이어진 날이 끊겨도) 보이지 않는다
      ...(row?.achievedAt == null ? (() => { const p = progressOf(save, id); return p ? { progress: p } : {}; })() : {}),
    };
  });

  return {
    points: save.points.balance,
    party: {
      slots,
      shown: slots.filter((s) => s.pet && !s.pet.hidden).length,
      usable: slots.filter((s) => s.state !== "locked").length,
      preset: { index: activePreset(save), count: presetCount(save), max: PARTY_RULES.presets.max, name: presetName(save, activePreset(save)) },
    },
    boxes,
    eggs: { list: eggs, used: eggs.length, size: maxEggs },
    bag,
    dex: { unlocked: save.dex.unlocked.length, obtained: save.dex.obtained.length, shiny: save.dex.shinyObtained.length },
    shop: shopList(save),
    achievements: {
      total: achievements.filter((a) => a.state !== "locked").length, // 표에 있는 업적만 — 목록 수와 같은 기준
      unclaimed: unclaimedAchievementIds(save).length, // 배너·튜토리얼과 같은 셈 (94 항목 9-3-8)
      list: achievements,
    },
    settings: {
      language: save.settings.language,
      startOnLogin: save.settings.startOnLogin,
      sound: save.settings.sound,
      volume: save.settings.volume,
      sleepAfterMin: save.settings.sleepAfterMin,
      playArea: save.settings.playArea.mode,
      hasRegion: save.settings.playArea.rect != null,
      sleepChoices: sleepChoices(),
    },
    natures: natureOptions(),
    limits: { boxNameMax: BOX_RULES.nameMax, presetNameMax: BOX_RULES.nameMax },
    sizeLevels: SIZE_STEPS.length,
    tutorial: manageTutorial(save, now),
    detailTutorial: canShow(save, "detail"),
    areaTutorial: canShow(save, "area"),
    screenTutorials: SCREEN_TUTORIALS.filter((id) => canShow(save, id)),
    replayTutorials: replayableNow(save, now),
  };
}

// 관리 창의 튜토리얼 — 대기열 맨 앞이 관리 창 것일 때만. 바탕화면 것이 앞이면 그것이 끝나기를 기다린다
function manageTutorial(save: SaveV3, now: number): string | null {
  const first = currentTutorial(save, now);
  return first && first.surface === "manage" ? first.id : null;
}

// 성격 변경 창의 선택지 — 원작 25 성격을 data/natures.json 순서로. 어느 성격이든 민트 한 개로 바꾼다 (2026-09-29 사용자 결정)
function natureOptions(): NatureOption[] {
  return natureTable().map((n) => ({ id: n.id, name: natureName(n.id) }));
}

// 게임의 지금 화면 값 — 저장을 읽어 그 게임의 시각(마지막 틱)으로 스냅샷을 만들고, 저장이 이어서 실패하는 중이면 안내를 싣는다.
// 형식은 구조로만 받는다 — 화면 값은 실행기(tx)를 가져오지 않는다. 저장이 없으면 null
// 부르는 곳: src/main/manage/window.ts, 도구 selftest-manage·selftest-play
// (예전 src/main/game.ts 의 game.view. 메인 레인 M8-9 에서 화면 값으로 옮겼다)
export function snapshotOfGame(game: { read(): SaveV3 | null; now(): number; saveFailing(): boolean }): Snapshot | null {
  const save = game.read();
  if (!save) return null;
  const snap = snapshotView(save, game.now());
  return game.saveFailing() ? { ...snap, saveFailing: true } : snap;
}
