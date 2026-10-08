// 배틀 창 화면 값 — 엔진의 판 입력·결과를 배틀 창이 재생할 모델로 바꾼다 (docs/specs/ui-components.md "배틀 창으로 더한 것")
// 그림은 열쇠(portrait:·type:)로 둔다. 메인이 받아서 data URI 로 바꾼다 (src/main/manage/battle-screen.ts)
// 엔진 이벤트를 화면 모델 이벤트로 그대로 넘긴다 — 모양이 어긋나면 여기서 컴파일 오류가 난다
import type { BattleEvent, BattleResult, EngineFighter } from "../battle/engine.js";
import { ENGINE_RULES } from "../battle/engine.js";
import { abilityTable, moveTable } from "../dex/tables.js";
import { SIZE_STEPS } from "../party/size.js";
import type { BattleResultView, BattleRouletteView, BattleScreenEvent, BattleScreenView, BattleUnitView } from "../shared/model/battle-screen";
import type { MoveView } from "../shared/model/snapshot";
import { moveMeta } from "./battle.js";
import { portraitArtKey, typeArtKey } from "./device-art.js";
import { petName, typeName } from "./text.js";

// 룰렛 결과 이름과 관련 타입 아이콘 — 원시회귀·델타스트림은 특성 이름을 그대로 쓴다 (docs/specs/ui-components.md "배틀 창으로 더한 것")
const ROULETTE: Record<string, { name: string; type: string | null }> = {
  sun: { name: "쾌청", type: "fire" },
  rain: { name: "비", type: "water" },
  sand: { name: "모래바람", type: "rock" },
  snow: { name: "눈", type: "ice" },
  none: { name: "날씨 없음", type: null },
  "harsh-sun": { name: "끝의대지", type: "fire" },
  "heavy-rain": { name: "시작의바다", type: "water" },
  "strong-winds": { name: "델타스트림", type: "flying" },
  electric: { name: "일렉트릭필드", type: "electric" },
  grassy: { name: "그래스필드", type: "grass" },
  psychic: { name: "사이코필드", type: "psychic" },
  misty: { name: "미스트필드", type: "fairy" },
  fairy: { name: "페어리오라", type: "fairy" },
  dark: { name: "다크오라", type: "dark" },
  break: { name: "오라 반전", type: null },
};
const ROULETTE_LABEL = { weather: "날씨", field: "필드", aura: "오라" } as const;

// 엔진 이벤트는 화면 이벤트와 같은 모양이다 — 대입이 곧 검사다
const screenEvent = (e: BattleEvent): BattleScreenEvent => e;

// start 이벤트의 룰렛 → 릴 세 개. 엔진이 룰렛을 주지 않았으면 null
function rouletteOf(r: BattleResult): BattleRouletteView[] | null {
  const start = r.events.map(screenEvent).find((e) => e.kind === "start"); // 화면 이벤트 모양으로 읽는다 — 엔진이 룰렛을 아직 내지 않아도 컴파일된다
  const got = start && start.kind === "start" ? start.roulette : undefined;
  if (!got) return null;
  return (["weather", "field", "aura"] as const).map((key) => {
    const one = got[key];
    const shown = one?.kind ? ROULETTE[one.kind] : undefined;
    return {
      key,
      kind: one?.kind ?? null,
      label: ROULETTE_LABEL[key],
      name: shown?.name ?? null,
      type: shown?.type ?? null,
      fixed: one?.fixed === true,
      candidates: one?.candidates.map((c) => ({ side: c.side, slot: c.slot })) ?? [],
      picked: one?.picked ? { side: one.picked.side, slot: one.picked.slot } : null,
    };
  });
}

const TEXT = {
  title: "랜덤 배틀",
  mine: "나",
  win: "이겼어요",
  lose: "졌어요",
  draw: "비겼어요",
  confirm: "확인",
} as const;

export interface BattleScreenInput {
  sides: readonly [readonly (EngineFighter | null)[], readonly (EngineFighter | null)[]];
  result: BattleResult;
  opponentName: string; // 상대 · 2번 파티
  reward: { lead: string; detail: string }; // 결과 대화상자의 보상 줄 — 보상은 서버가 정한다
}

// 엔진 기술 → 기술 칸 값. 이름·설명은 표에서 읽고, 수치 글자는 배틀 파티 상세와 같은 moveMeta 다
function moveViewOf(id: string): MoveView | null {
  const row = moveTable()[id];
  if (!row) return null;
  const power = row.class === "status" ? null : (row.power ?? null);
  return {
    id,
    name: row.ko,
    typeId: row.type,
    typeName: typeName(row.type),
    meta: moveMeta({ id, name: row.ko, type: row.type, class: row.class, power, accuracy: row.accuracy ?? null, cooldown: row.cooldown ?? null, text: null }),
    text: null,
  };
}

function unitOf(f: EngineFighter | null, side: 0 | 1, slot: number, maxHp: number): BattleUnitView | null {
  if (!f) return null;
  return {
    side,
    slot,
    species: f.species,
    name: petName(f.species),
    types: [...f.types],
    portrait: portraitArtKey(f.species, false),
    moves: f.moves.map((m) => moveViewOf(m.id)).filter((m): m is MoveView => m !== null),
    ability: f.ability ? (abilityTable()[f.ability]?.ko ?? null) : null,
    maxHp,
  };
}

function resultOf(r: BattleResult, reward: BattleScreenInput["reward"]): BattleResultView {
  const title = r.winner === null ? TEXT.draw : r.winner === 0 ? TEXT.win : TEXT.lose;
  return { title, lead: reward.lead, detail: reward.detail, confirm: TEXT.confirm };
}

export function battleScreenModel(input: BattleScreenInput): BattleScreenView {
  const { result: r } = input;
  const units = ([0, 1] as const).map((side) => input.sides[side].map((f, slot) => unitOf(f, side, slot, r.maxHp[side]?.[slot] ?? 0))) as BattleScreenView["units"];
  // 흰 타입 아이콘 열쇠 — 카드의 타입 칸과 기술 칸에 나오는 타입 전부
  const types = new Set<string>();
  for (const side of units) for (const u of side) if (u) { u.types.forEach((t) => types.add(t)); u.moves.forEach((m) => types.add(m.typeId)); }
  const roulette = rouletteOf(r);
  for (const reel of roulette ?? []) if (reel.type) types.add(reel.type);
  return {
    title: TEXT.title,
    sideNames: [TEXT.mine, input.opponentName],
    units,
    typeIcons: Object.fromEntries([...types].map((t) => [t, typeArtKey(t)])),
    field: { w: ENGINE_RULES.fieldW, h: ENGINE_RULES.fieldH, body: ENGINE_RULES.body, stepMs: ENGINE_RULES.stepMs, stageMs: ENGINE_RULES.stageMs },
    sprites: {}, // 메인이 무대 그림 불러오기로 채운다
    zoom: SIZE_STEPS[1] ?? 1.5, // 크기 2단계 (2026-10-08 사용자 "포켓몬들은 2사이즈를 기본으로 싸우게")
    moveKinds: Object.fromEntries(units.flatMap((side) => side.flatMap((u) => u?.moves ?? [])).map((m) => [m.id, moveTable()[m.id]?.class ?? "physical"])),
    maxMs: ENGINE_RULES.maxMs,
    endMs: r.endMs,
    events: r.events.map(screenEvent),
    roulette,
    result: resultOf(r, input.reward),
  };
}

// 그림 열쇠를 모두 모은다 — 메인이 한 번에 받는다
export function battleScreenArtKeys(view: BattleScreenView): string[] {
  const keys = new Set<string>();
  for (const side of view.units) for (const u of side) if (u?.portrait) keys.add(u.portrait);
  for (const k of Object.values(view.typeIcons)) if (k) keys.add(k);
  return [...keys];
}

// 받은 그림으로 열쇠를 바꾼다. 못 받은 그림은 null
export function withBattleScreenArt(view: BattleScreenView, art: Record<string, string | null>): BattleScreenView {
  const pick = (k: string | null): string | null => (k ? (art[k] ?? null) : null);
  return {
    ...view,
    units: view.units.map((side) => side.map((u) => (u ? { ...u, portrait: pick(u.portrait) } : null))) as BattleScreenView["units"],
    typeIcons: Object.fromEntries(Object.entries(view.typeIcons).map(([t, k]) => [t, pick(k)])),
  };
}
