// 화면이 읽는 모양 — 계약은 docs/specs/modules.md 의 `settings:snapshot`, 화면은 Figma `05 · Screens`
//
// 저장을 그대로 넘기지 않는다. 화면이 바로 그릴 수 있는 값으로 바꿔서 넘긴다.
//   슬러그 대신 한국어 이름, ms 대신 초·분 정수, 만복도 값 대신 구간 이름
// 모양은 src/shared/manage.d.ts 가 가진다. 렌더러와 같은 타입을 본다.
// 저장을 쓰지 않는다. 읽기만 한다.
// 시간 표기는 반올림한다. 저장은 ms 정수로 두고 화면만 사람이 읽는 단위로 본다 (docs/specs/modules.md "저장 시점")
import { profileOf } from "../dex/species.js";
import { achievementName, itemName, petName, typeName, moodText, natureName, t } from "./text.js";
import { eggName, toolPrice } from "../shop/catalog.js";
import type { SaveV3, PetV3 } from "../shared/save-v3";
import { rewardPokemon, achievementDefs, rewardEgg, rewardItem, rewardPoints } from "../achievement/defs.js";
import { megaOf, megaChoices, shownSpecies } from "../dex/mega.js";
import { BOX_RULES } from "../box/rules.js";
import { EGG_RULES } from "../egg/rules.js";
import { PARTY_RULES } from "../party/rules.js";
import { SHOP_RULES } from "../shop/rules.js";
import { activePreset, presetCount, presetName, locatePet } from "../party/presets.js";
import type { AchievementDef } from "../dex/tables.js";
import { progressOf } from "../achievement/progress.js";
import { SIZE_STEPS, sizeLevelOf } from "../party/size.js";
import { growthOf, progressTo } from "../dex/growth.js";
import { itemOf } from "../bag/use.js";
import { natureList as natureTable } from "../dex/natures.js";
import { sellPrice } from "../shop/sell.js";
import { careParts, zoneOf } from "../state/time.js";
import { TIME_RULES } from "../state/rules.js";
import { buffText, waitText } from "../shared/count-text.js";
import { SETTING_CHOICES } from "../state/settings.js";
import type { FullnessZone } from "../shared/save-v3.js";
import type { AchievementView, BagItemView, BoxView, CareView, EggView, EvolutionView, FormView, MegaView, NatureOption, PetView, SettingsView, SlotView, Snapshot } from "../shared/model/snapshot";
import { formsOf } from "../dex/forms.js";
import { genderLookOf } from "../dex/regional.js";
import { megaRivals } from "../party/mega-form.js";
import { SCREEN_TUTORIALS } from "../tutorial/conditions.js";
import { canShow, currentTutorial } from "../tutorial/queue.js";
import { evolveCandidates, type EvoMissing } from "../dex/evolve.js";
import { gameDayPart } from "../shared/clock.js";
import type { DayPart } from "../shared/species";
import { isEvoItem, itemAbout } from "./bag.js";
import { shopList } from "./shop-list.js";
import { isKnownSpecies } from "../dex/record.js";
import { eggIconKey, itemArtKey } from "./device-art.js";

// 보상 종류 → 화면 문구
const REWARD_WORD: Record<string, string> = { "party-slot": "파티 칸 +1" };

// 업적 보상 문구 — 포켓몬은 종 이름(라프라스), 포인트는 `1,000P`, 알은 알 이름, 도구는 도구 이름(여러 개면 `×N`)
const rewardText = (def: AchievementDef): string => {
  const species = rewardPokemon(def);
  if (species) return petName(species);
  const points = rewardPoints(def);
  if (points != null) return `${points.toLocaleString("en-US")}P`;
  const egg = rewardEgg(def);
  if (egg) return eggName(egg) ?? egg;
  const item = rewardItem(def);
  if (item) return item.count > 1 ? `${itemName(item.id)} ×${item.count}` : itemName(item.id);
  return typeof def.reward === "string" ? REWARD_WORD[def.reward] ?? def.reward : "";
};

// 버프를 보이는 순서 — 든든함 · 신남 · 들뜸. 이름은 data/i18n 의 buff.<식별자> (2026-09-29 사용자 결정)
const BUFF_ORDER = ["premium-food", "long-play", "short-play"] as const;

const sec = (ms: number): number => Math.round(ms / 1000);
const min = (ms: number): number => Math.round(ms / 60_000);

// 알 준비 시간의 진행 백분율 — 남은 시간만 저장하므로 전체는 규칙표에서 온다
const eggPercent = (remainMs: number, readyMs: number): number =>
  readyMs <= 0 ? 100 : Math.min(100, Math.max(0, Math.round(((readyMs - remainMs) / readyMs) * 100)));

// 모자란 조건 → 화면 문구. 판정은 src/dex/evolve.ts 의 candidates 다
// 둘 이상이면(레벨·친밀도 지도 간선) 이름을 `·` 로 잇는다 — "Lv.36·지도 필요". 돌 대신 지도인 간선은 "지도 필요"
function missingText(m: EvoMissing): string {
  if (m.kind === "level") return `Lv.${m.level} 필요`;
  if (m.kind === "affinity") return `친밀도 ${m.value} 필요`;
  if (m.kind === "item") return `${itemName(m.item)} 필요`;
  if (m.kind === "time") return m.when === "night" ? "밤에만" : "낮에만";
  return m.gender === "female" ? "암컷만" : "수컷만";
}
function needText(lacks: readonly EvoMissing[]): string | undefined {
  if (!lacks.length) return undefined;
  if (lacks.length > 1) return `${lacks.map((m) => missingText(m).replace(/ 필요$/, "")).join("·")} 필요`;
  return missingText(lacks[0]!);
}

// 다음 한 단계의 후보 — 상세의 진화 확인 창과 가방의 진화용 도구가 같은 판정을 본다.
// 도감에서 해금 안 된 결과 종은 이름을 "???" 로 준다 — 도감 기기 창과 같이 가리고 조건만 보인다. 진화가 처음 보는 순간이다
// (2026-10-01 사용자 결정 "추천대로하자", Figma 05 `1126:23890`)
function evolutionsOf(save: SaveV3, pet: PetV3, dayPart: DayPart): EvolutionView[] {
  const known = (slug: string): boolean => isKnownSpecies(save, slug);
  return evolveCandidates(save, pet.id, dayPart).map((c) => ({
    to: c.to,
    name: known(c.to) ? petName(c.to) : "???",
    known: known(c.to),
    ready: c.ready,
    ...(c.ready ? {} : { need: needText(c.lacks) }),
    ...(c.need.kind === "item" ? { item: c.need.item } : {}),
    ...(c.map ? { map: true as const } : {}),
  }));
}

// 공유 sid 계열이면 고를 수 있는 종 — 박스 칸이 단체사진과 툴팁으로 보인다
function formsView(pet: PetV3): { forms?: FormView[] } {
  const list = formsOf(pet);
  if (list.length < 2) return {};
  return { forms: list.map((slug) => ({ species: slug, name: petName(slug), types: profileOf(slug).types.map((t) => typeName(t)), typeIds: [...profileOf(slug).types] })) };
}

// 모습 하나 — 이름과 타입. 메가 모습은 data/mega.json 의 타입이다
const typesOf = (slug: string): string[] => megaOf(slug)?.types ?? profileOf(slug).types;
const formView = (slug: string): FormView => ({ species: slug, name: petName(slug), types: typesOf(slug).map((x) => typeName(x)), typeIds: [...typesOf(slug)] });

// 메가스톤을 지닌 개체의 메가진화 정보. 메가 모습이 없는 종(진화해 버린 개체)이면 없다
function megaView(save: SaveV3, pet: PetV3): { mega?: MegaView } {
  const choices = megaChoices(pet);
  if (!choices.length) return {};
  const base = formView(pet.species);
  return {
    mega: {
      kind: megaOf(choices[0] as string)?.kind ?? "mega",
      on: pet.mega?.on ?? null,
      baseName: base.name,
      baseTypes: base.types,
      baseTypeIds: base.typeIds,
      forms: choices.map(formView),
      canChange: locatePet(save, pet.id)?.kind === "preset",
      rivals: megaRivals(save, pet.id).map((p) => petName(shownSpecies(p))),
    },
  };
}

// 만복도 구간 낱말 — 파티 칸·파티 상세 기기 창·포켓몬 메뉴가 같이 쓴다. 글자는 언어 파일의 zone.* 다
const zoneText = (zone: FullnessZone): string => t(`zone.${zone}`);

// 배고픔 디버프 배지 — 구간 낱말, 색, 친밀도 증가량 감소율(TIME_RULES.zonePercent). 배부름·보통이면 null (docs/specs/balance.md "배고픔 디버프")
const DEBUFF_TONE: Partial<Record<FullnessZone, "warning" | "danger">> = { hungry: "warning", starving: "danger" };
function debuffOf(zone: FullnessZone): PetView["debuff"] {
  const tone = DEBUFF_TONE[zone];
  return tone ? { label: zoneText(zone), tone, note: t("debuff.note", { percent: 100 - TIME_RULES.zonePercent[zone] }) } : null;
}

// 잠들기 기준 선택지 — 0 은 잠들지 않음
const sleepChoices = (): SettingsView["sleepChoices"] => SETTING_CHOICES.sleepAfterMin.map((min) => ({ value: min, label: min === 0 ? "잠들지 않음" : `${min}분` }));

export function petView(save: SaveV3, pet: PetV3, hidden: boolean, dayPart: DayPart): PetView {
  const rate = growthOf(pet.species);
  const { percent } = progressTo(rate, pet.exp);
  const shown = formView(shownSpecies(pet)); // 메가 모습이면 그 이름·타입·그림이다. species 는 그대로다
  return {
    id: pet.id,
    species: pet.species,
    look: pet.mega?.on ? shown.species : (genderLookOf(pet.species, pet.gender) ?? shown.species), // 초상 그림 — 성별 그림이 있으면 그것 (data/regional.json 의 gender)
    name: shown.name,
    shiny: pet.shiny,
    level: pet.level,
    percentToNext: percent,
    exp: pet.exp,
    growth: rate,
    types: shown.types,
    typeIds: shown.typeIds,
    nature: natureName(pet.nature),
    natureId: pet.nature,
    gender: pet.gender,
    size: sizeLevelOf(pet.size), // 단계 번호 — 저장은 배율이다
    affinity: pet.affinity,
    fullness: pet.fullness,
    zone: zoneOf(pet.fullness),
    zoneText: zoneText(zoneOf(pet.fullness)),
    debuff: debuffOf(zoneOf(pet.fullness)),
    mood: pet.mood,
    moodWord: moodText(pet.mood),
    hidden,
    feedReady: pet.feedCooldownMs <= 0,
    feedInSec: sec(pet.feedCooldownMs),
    playReady: pet.playCooldownMs <= 0,
    feedText: pet.fullness >= 100 ? "밥 주기 · 배부름" : pet.feedCooldownMs <= 0 ? "밥 주기" : `밥 주기 · ${waitText(sec(pet.feedCooldownMs))}`,
    playText: pet.playCooldownMs <= 0 ? "놀아주기" : `놀아주기 · ${waitText(sec(pet.playCooldownMs))}`,
    playStreak: pet.playStreak,
    longPlay: pet.buffs.some((b) => b.kind === "long-play" && b.remainMs > 0),
    // 켜진 버프 — 보이는 순서대로 이름과 남은 분. 배지가 `신남 12분` 처럼 쓴다 (2026-09-30 사용자 결정 "추천대로 진행해")
    buffs: BUFF_ORDER.flatMap((kind) => {
      const hit = pet.buffs.find((b) => b.kind === kind && b.remainMs > 0);
      return hit ? [{ kind, name: t(`buff.${kind}`), remainMin: min(hit.remainMs), text: buffText({ name: t(`buff.${kind}`), remainMin: min(hit.remainMs) }) }] : [];
    }),
    buffNames: BUFF_ORDER.filter((kind) => pet.buffs.some((b) => b.kind === kind && b.remainMs > 0)).map((kind) => t(`buff.${kind}`)),
    evolutions: evolutionsOf(save, pet, dayPart),
    ...formsView(pet),
    ...megaView(save, pet),
    care: careView(pet),
  };
}

// 돌봄 보너스 — 친밀도가 100 미만이면 없다. 내역은 기분, 그다음 버프를 배지와 같은 순서로 둔다
function careView(pet: PetV3): CareView | null {
  if (pet.affinity < 100) return null;
  const found = careParts(pet);
  const order = ["mood", ...BUFF_ORDER] as string[];
  const parts = [...found]
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((p) => ({ kind: p.kind, name: p.kind === "mood" ? moodText(pet.mood) : t(`buff.${p.kind}`), bonus: p.percent }));
  return { bonus: parts.reduce((sum, p) => sum + p.bonus, 0), parts };
}

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
    icon: eggIconKey(e.kind),
    name: eggName(e.kind) ?? e.kind,
    ready: e.ready,
    remainSec: sec(e.remainMs),
    percent: eggPercent(e.remainMs, eggReadyMs),
    noteText: e.ready ? "준비 완료" : `${eggPercent(e.remainMs, eggReadyMs)}% · ${waitText(sec(e.remainMs))}`,
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

  const claimed = Object.values(save.achievements);
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
      sleepChoices: sleepChoices(),
    },
    natures: natureOptions(),
    limits: { boxNameMax: BOX_RULES.nameMax, presetNameMax: BOX_RULES.nameMax },
    sizeLevels: SIZE_STEPS.length,
    tutorial: manageTutorial(save, now),
    detailTutorial: canShow(save, "detail"),
    areaTutorial: canShow(save, "area"),
    screenTutorials: SCREEN_TUTORIALS.filter((id) => canShow(save, id)),
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
