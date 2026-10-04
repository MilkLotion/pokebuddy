// 개체 하나의 화면 값 — 파티 칸·박스 칸·파티 상세가 보는 PetView(진화 후보·메가·모습·디버프·돌봄 보너스·버프). 저장을 읽기만 한다
// 스냅샷 조립은 ./snapshot.ts 가 한다 (96 대조 ④ — snapshot.ts 337줄을 나눴다, 설계 30번 view/pet.ts)
import { profileOf } from "../dex/species.js";
import { itemName, petName, typeName, moodText, natureName, t } from "./text.js";
import type { SaveV3, PetV3 } from "../shared/save-v3";
import { megaOf, megaChoices, shownSpecies } from "../dex/mega.js";
import { locatePet } from "../party/locate.js";
import { sizeLevelOf } from "../party/size.js";
import { growthOf, progressTo } from "../dex/growth.js";
import { careParts, zoneOf } from "../state/time.js";
import { TIME_RULES } from "../state/rules.js";
import { buffText, waitText } from "../shared/count-text.js";
import type { FullnessZone } from "../shared/save-v3.js";
import type { CareView, EvolutionView, FormView, MegaView, PetView } from "../shared/model/snapshot";
import { formsOf } from "../dex/forms.js";
import { genderLookOf } from "../dex/regional.js";
import { megaRivals } from "../party/mega-form.js";
import { checkPetFree } from "../party/pet-actions.js";
import { failTextOf } from "../shared/fail-text.js";
import { evolveCandidates, type EvoMissing } from "../dex/evolve.js";
import type { DayPart } from "../shared/species";
import { isKnownSpecies } from "../dex/record.js";
import { ceilMin, ceilSec } from "../shared/count-text.js";

// 버프를 보이는 순서 — 든든함 · 신남 · 들뜸. 이름은 data/i18n 의 buff.<식별자> (2026-09-29 사용자 결정)
const BUFF_ORDER = ["premium-food", "long-play", "short-play"] as const;

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
// 교환에 걸린 개체는 조건을 채워도 준비되지 않은 것으로 보이고, 까닭은 실패 문구표의 trade-locked 제목이다 (94 항목 9-5-1)
function evolutionsOf(save: SaveV3, pet: PetV3, dayPart: DayPart): EvolutionView[] {
  const known = (slug: string): boolean => isKnownSpecies(save, slug);
  const locked = !checkPetFree(save, pet.id, "evolve").ok;
  return evolveCandidates(save, pet.id, dayPart).map((c) => ({
    to: c.to,
    name: known(c.to) ? petName(c.to) : "???",
    known: known(c.to),
    ready: c.ready && !locked,
    ...(c.ready && !locked ? {} : { need: locked && c.ready ? failTextOf("trade-locked", "trade").text : needText(c.lacks) }),
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
      canChange: (() => { const at = locatePet(save, pet.id); return at?.kind === "preset" && at.active; })(), // 적용한 프리셋의 개체만 (94 항목 9-2-1)
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
    feedInSec: ceilSec(pet.feedCooldownMs),
    playReady: pet.playCooldownMs <= 0,
    feedText: pet.fullness >= 100 ? "밥 주기 · 배부름" : pet.feedCooldownMs <= 0 ? "밥 주기" : `밥 주기 · ${waitText(ceilSec(pet.feedCooldownMs))}`,
    playText: pet.playCooldownMs <= 0 ? "놀아주기" : `놀아주기 · ${waitText(ceilSec(pet.playCooldownMs))}`,
    playStreak: pet.playStreak,
    longPlay: pet.buffs.some((b) => b.kind === "long-play" && b.remainMs > 0),
    // 켜진 버프 — 보이는 순서대로 이름과 남은 분. 배지가 `신남 12분` 처럼 쓴다 (2026-09-30 사용자 결정 "추천대로 진행해")
    buffs: BUFF_ORDER.flatMap((kind) => {
      const hit = pet.buffs.find((b) => b.kind === kind && b.remainMs > 0);
      return hit ? [{ kind, name: t(`buff.${kind}`), remainMin: ceilMin(hit.remainMs), text: buffText({ name: t(`buff.${kind}`), remainMin: ceilMin(hit.remainMs) }) }] : [];
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
