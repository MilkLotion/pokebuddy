// 배틀 창 화면 값 — 엔진의 판 입력·결과를 배틀 창이 재생할 모델로 바꾼다 (docs/specs/ui-components.md "배틀 창으로 더한 것")
// 그림은 열쇠(portrait:·type:)로 둔다. 메인이 받아서 data URI 로 바꾼다 (src/main/manage/battle-screen.ts)
// 엔진 이벤트를 화면 모델 이벤트로 그대로 넘긴다 — 모양이 어긋나면 여기서 컴파일 오류가 난다
import type { BattleEvent, BattleResult, EngineFighter } from "../battle/engine.js";
import { ENGINE_RULES } from "../battle/engine.js";
import { moveTable } from "../dex/tables.js";
import { SIZE_STEPS } from "../party/size.js";
import type { BattleResultView, BattleScreenEvent, BattleScreenView, BattleUnitView } from "../shared/model/battle-screen";
import type { MoveView } from "../shared/model/snapshot";
import { moveMeta } from "./battle.js";
import { portraitArtKey, typeArtKey } from "./device-art.js";
import { petName, typeName } from "./text.js";

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
    maxHp,
  };
}

// 엔진 이벤트는 화면 이벤트와 같은 모양이다 — 대입이 곧 검사다
const screenEvent = (e: BattleEvent): BattleScreenEvent => e;

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
