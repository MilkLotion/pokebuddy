// 화면이 읽는 모양 — 계약은 docs/specs/modules.md 의 `settings:snapshot`, 화면은 Figma `05 · Screens`
//
// 저장을 그대로 넘기지 않는다. 화면이 바로 그릴 수 있는 값으로 바꿔서 넘긴다.
//   슬러그 대신 한국어 이름, ms 대신 초·분 정수, 만복도 값 대신 구간 이름
// 모양은 src/shared/manage.d.ts 가 가진다. 렌더러와 같은 타입을 본다.
// 저장을 쓰지 않는다. 읽기만 한다.
// 시간 표기는 반올림한다. 저장은 ms 정수로 두고 화면만 사람이 읽는 단위로 본다 (docs/specs/modules.md "저장 시점")
import { defs } from "../achievement/core.js";
import { EGG_V3_RULES, SAVE_V3_RULES, SIZE_STEPS, sizeLevelOf } from "../save/rules.js";
import { MAX_LEVEL, expForLevel, growthOf, progressTo } from "../dex/growth.js";
import { profile } from "../dex/species.js";
import { itemOf, mintFor } from "../bag/use.js";
import { natures as natureTable } from "../dex/natures.js";
import { eggName, eggPalettes } from "../shop/catalog.js";
import { zoneOf } from "../state/time.js";
import { moodWord, natureName, petName, typeName } from "../main/text.js";
import type { AchievementView, BagItemView, BoxView, EggView, EvolutionView, FormView, NatureOption, PetView, SlotView, Snapshot } from "../shared/manage";
import { formsOf } from "../dex/forms.js";
import { canShow, currentTutorial } from "../tutorial/core.js";
import { candidates, dayPartOf } from "../dex/evolve.js";
import type { DayPart } from "../shared/types";
import { isEvoItem, nameOfItem, shopList } from "./lists.js";
import type { PetV3, SaveV3 } from "../shared/save-v3";

// 보상 종류 → 화면 문구. 종류가 하나뿐이라 표로 둔다
const REWARD_WORD: Record<string, string> = { "party-slot": "파티 칸 +1" };

const sec = (ms: number): number => Math.round(ms / 1000);
const min = (ms: number): number => Math.round(ms / 60_000);

// 알 준비 시간의 진행 백분율 — 남은 시간만 저장하므로 전체는 규칙표에서 온다
const eggPercent = (remainMs: number, readyMs: number): number =>
  readyMs <= 0 ? 100 : Math.min(100, Math.max(0, Math.round(((readyMs - remainMs) / readyMs) * 100)));

// 모자란 조건 → 화면 문구. 판정의 이유 코드는 src/dex/evolve.ts 의 checkNeed 다
function needText(missing: string | undefined): string | undefined {
  if (!missing) return undefined;
  const [kind, value = ""] = missing.split(":");
  if (kind === "level") return `Lv.${value} 필요`;
  if (kind === "affinity") return `친밀도 ${value} 필요`;
  if (kind === "item") return `${nameOfItem(value)} 필요`;
  if (kind === "time") return value === "night" ? "밤에만" : "낮에만";
  return missing;
}

// 다음 한 단계의 후보 — 상세의 진화 확인 창과 가방의 진화용 도구가 같은 판정을 본다
function evolutionsOf(save: SaveV3, pet: PetV3, dayPart: DayPart): EvolutionView[] {
  return candidates(save, pet.id, dayPart).map((c) => ({
    to: c.to,
    name: petName(c.to),
    ready: c.ready,
    ...(c.ready ? {} : { need: needText(c.missing) }),
    ...(c.need.kind === "item" ? { item: c.need.item } : {}),
  }));
}

// 공유 sid 계열이면 고를 수 있는 종 — 박스 칸이 단체사진과 툴팁으로 보인다
function formsView(pet: PetV3): { forms?: FormView[] } {
  const list = formsOf(pet);
  if (list.length < 2) return {};
  return { forms: list.map((slug) => ({ species: slug, name: petName(slug), types: profile(slug).types.map((t) => typeName(t)), typeIds: [...profile(slug).types] })) };
}

// 경험치 타입별 누적 경험치 표 — 칸 L 이 레벨 L. 한 번 만들어 둔다
const GROWTH_RATES = ["fast", "medium-fast", "medium-slow", "slow", "erratic", "fluctuating"] as const;
const GROWTH_CURVES: Record<string, number[]> = Object.fromEntries(
  GROWTH_RATES.map((rate) => [rate, Array.from({ length: MAX_LEVEL + 1 }, (_, level) => (level < 1 ? 0 : expForLevel(rate, level)))]),
);

export function petView(save: SaveV3, pet: PetV3, hidden: boolean, dayPart: DayPart = dayPartOf(Date.now())): PetView {
  const rate = growthOf(pet.species);
  const { percent } = progressTo(rate, pet.exp);
  return {
    id: pet.id,
    species: pet.species,
    name: petName(pet.species),
    shiny: pet.shiny,
    level: pet.level,
    percentToNext: percent,
    exp: pet.exp,
    growth: rate,
    types: profile(pet.species).types.map((t) => typeName(t)),
    typeIds: [...profile(pet.species).types],
    nature: natureName(pet.nature),
    natureId: pet.nature,
    size: sizeLevelOf(pet.size), // 단계 번호 — 저장은 배율이다
    affinity: pet.affinity,
    fullness: pet.fullness,
    zone: zoneOf(pet.fullness),
    mood: pet.mood,
    moodWord: moodWord(pet.mood),
    hidden,
    feedReady: pet.feedCooldownMs <= 0,
    feedInSec: sec(pet.feedCooldownMs),
    playReady: pet.playCooldownMs <= 0,
    playStreak: pet.playStreak,
    longPlay: pet.buffs.some((b) => b.kind === "long-play" && b.remainMs > 0),
    buffs: pet.buffs.map((b) => ({ kind: b.kind, remainMin: min(b.remainMs) })),
    evolutions: evolutionsOf(save, pet, dayPart),
    ...formsView(pet),
  };
}

// 전체 준비 시간과 칸 수는 규칙표에서 온다. 시험에서 다른 값을 꽂을 수 있게 받을 수도 있다
export function snapshot(
  save: SaveV3,
  eggReadyMs: number = EGG_V3_RULES.readyMs,
  boxSize: number = SAVE_V3_RULES.box.size,
  maxEggs: number = EGG_V3_RULES.maxEggs,
  now: number = Date.now(), // 진화 후보의 낮·밤을 정한다
): Snapshot {
  const dayPart = dayPartOf(now);
  const byId = new Map(save.pets.map((p) => [p.id, p]));

  const slots: SlotView[] = save.party.slots.map((s, index) => {
    if (s.state !== "pokemon" || !s.petId) return { index, state: s.state };
    const pet = byId.get(s.petId);
    if (!pet) return { index, state: "empty" };
    return { index, state: "pokemon", pet: petView(save, pet, s.hidden === true, dayPart) };
  });

  const boxes: BoxView[] = save.boxes.map((b) => ({
    id: b.id,
    name: b.name,
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
    name: eggName(e.kind) ?? e.kind,
    ready: e.ready,
    remainSec: sec(e.remainMs),
    percent: eggPercent(e.remainMs, eggReadyMs),
  }));

  const bag: BagItemView[] = Object.entries(save.bag)
    .filter(([, n]) => n > 0)
    .map(([id, count]) => {
      const natures = itemOf(id)?.natures;
      const item = itemOf(id);
      return {
        id, name: item?.ko ?? nameOfItem(id), count, evolution: isEvoItem(id),
        ...(natures ? { natures: [...natures] } : {}),
        ...(item ? { effect: item.effect, amount: item.amount } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const achievements: AchievementView[] = defs().map(([id, def]) => {
    const row = save.achievements[id];
    return {
      id,
      name: def.ko,
      desc: def.desc ?? "",
      reward: REWARD_WORD[def.reward] ?? def.reward,
      state: row?.claimedAt != null ? "claimed" : row?.achievedAt != null ? "achieved" : "locked",
    };
  });

  const claimed = Object.values(save.achievements);
  return {
    points: save.points.balance,
    party: {
      slots,
      shown: slots.filter((s) => s.pet && !s.pet.hidden).length,
      usable: slots.filter((s) => s.state !== "locked").length,
    },
    boxes,
    eggs: { list: eggs, used: eggs.length, size: maxEggs },
    bag,
    dex: { unlocked: save.dex.unlocked.length, obtained: save.dex.obtained.length, shiny: save.dex.shinyObtained.length },
    shop: shopList(save),
    achievements: {
      total: claimed.filter((a) => a.achievedAt != null).length,
      unclaimed: claimed.filter((a) => a.achievedAt != null && a.claimedAt == null).length,
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
    },
    natures: natureOptions(),
    eggPalettes: eggPalettes(),
    growthCurves: GROWTH_CURVES,
    sizeLevels: SIZE_STEPS.length,
    tutorial: manageTutorial(save),
    detailTutorial: canShow(save, "detail"),
    areaTutorial: canShow(save, "area"),
  };
}

// 관리 창의 튜토리얼 — 대기열 맨 앞이 관리 창 것일 때만. 바탕화면 것이 앞이면 그것이 끝나기를 기다린다
function manageTutorial(save: SaveV3): string | null {
  const now = currentTutorial(save);
  return now && now.surface === "manage" ? now.id : null;
}

// 성격 변경 창의 선택지 — 성격마다 바꾸는 민트를 붙인다. 보정 없는 성격은 모두 성실민트다
function natureOptions(): NatureOption[] {
  return natureTable().map((n) => {
    const mint = mintFor(n.id) ?? "";
    return { id: n.id, name: natureName(n.id), mint, mintName: itemOf(mint)?.ko ?? mint };
  });
}
