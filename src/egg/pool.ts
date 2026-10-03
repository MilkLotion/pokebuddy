// 새 알과 알을 줄 수 있는지 — 저장을 보고 정한다. 알의 후보 종(저장과 무관한 것)은 src/dex/obtain.ts 에 있다
//
// 단일 포켓몬 알은 종별로 저장마다 한 번만 얻는다. 이미 얻은 종은 후보에서 뺀다.
// 같은 알이 돌보미집에 여럿 기다릴 수 있다. 남은 종 수가 기다리는 알 수보다 많을 때만 새로 준다 —
// 그래야 알마다 열 때 남은 종이 적어도 하나 있다
import { isMetaKey, type DexOptions } from "../dex/data.js";
import { eggPool, inRandomEgg, isSingleEgg } from "../dex/obtain.js";
import { eggTable } from "../dex/tables.js";
import type { EggV3, SaveV3 } from "../shared/save-v3";
import type { Check } from "../shared/names/reasons.js";
import { EGG_RULES } from "./rules.js";

// 아직 얻지 않은 종
export function singleLeft(save: SaveV3, kind: string, opts?: DexOptions): string[] {
  return (eggPool(kind, opts) ?? []).filter((slug) => !save.dex.obtained.includes(slug));
}

// 이 알을 하나 더 줄 수 있는가 — 단일 포켓몬 알이 아니면 늘 된다
export function canGiveEgg(save: SaveV3, kind: string, opts?: DexOptions): boolean {
  if (!isSingleEgg(kind, opts)) return true;
  const waiting = save.eggs.filter((e) => e.kind === kind).length;
  return singleLeft(save, kind, opts).length > waiting;
}

// 이 알을 한 번에 더 넣을 수 있는 수 — 돌보미집 빈 칸 수. 단일 포켓몬 알이면 (남은 종 수 − 기다리는 같은 알 수)까지
// (2026-09-30 사용자 결정 "알 여러개 구매 가능하게 수정.")
export function eggRoomOf(save: SaveV3, kind: string, opts?: DexOptions): number {
  const daycare = Math.max(0, EGG_RULES.maxEggs - save.eggs.length);
  if (!isSingleEgg(kind, opts)) return daycare;
  const waiting = save.eggs.filter((e) => e.kind === kind).length;
  return Math.max(0, Math.min(daycare, singleLeft(save, kind, opts).length - waiting));
}

// 이 알을 하나 줄 수 있는가 — 돌보미집이 가득이면 daycare-full, 단일 포켓몬 알의 남은 종이 없으면 sold-out.
// 업적은 sold-out 을 egg-none 으로 바꿔 돌려준다
export function checkGiveEgg(save: SaveV3, kind: string, opts?: DexOptions): Check<"daycare-full" | "sold-out"> {
  if (save.eggs.length >= EGG_RULES.maxEggs) return { ok: false, reason: "daycare-full" };
  if (!canGiveEgg(save, kind, opts)) return { ok: false, reason: "sold-out" };
  return { ok: true };
}

// 이 알을 열 때 다른 알이 나올 확률 — [알 종류, 확률]. 데이터에 적은 순서대로
export function eggBonus(kind: string, opts?: DexOptions): [string, number][] {
  if (isMetaKey(kind)) return [];
  const eggs = eggTable(opts);
  return Object.entries(eggs[kind]?.bonus ?? {}).filter(([k, p]) => typeof p === "number" && p > 0 && eggs[k] != null);
}

// 알 식별자 `e숫자` 의 가장 큰 번호
export function maxEggNo(eggs: { id: string }[]): number {
  let max = 0;
  for (const e of eggs) {
    const m = /^e(\d+)$/.exec(e.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// 다음 알 식별자 — 지금까지 만든 알 수(eggSeq)와 지금 있는 알의 가장 큰 번호 중 큰 것의 다음.
// 연 알의 식별자를 다시 쓰지 않는다. 다시 쓰면 "부화 준비" 배너의 표시 기록이 새 알에 겹쳐 배너가 뜨지 않는다
export function nextEggId(save: SaveV3): string {
  return `e${Math.max(save.eggSeq, maxEggNo(save.eggs)) + 1}`;
}

// 새 알 하나 — 후보는 이 순간에 정해 저장한다 (docs/specs/game.md "알 결과 저장"). 저장에 넣는 것은 부르는 쪽이다
//   단일 포켓몬 알   아직 얻지 않은 종
//   종 목록 알       그 목록
//   랜덤알           해금한 종 가운데 랜덤알에서 나올 수 있는 종
export function newEgg(save: SaveV3, kind: string, now: number, opts?: DexOptions): EggV3 {
  const id = nextEggId(save);
  save.eggSeq = Number(id.slice(1)); // 번호는 여기서 쓴 것으로 센다 — 알을 저장에 넣는 것은 부르는 쪽이다
  return {
    id,
    kind,
    boughtAt: now,
    remainMs: EGG_RULES.readyMs,
    ready: false,
    candidates: isSingleEgg(kind, opts) ? singleLeft(save, kind, opts) : eggPool(kind, opts) ?? randomPool(save, opts),
    careCooldownMs: 0,
    actions: { pat: 0, song: 0 },
  };
}

// 랜덤알 후보 — 해금한 종 가운데 랜덤알에서 나올 수 있는 종 (규칙은 src/dex/obtain.ts inRandomEgg)
export function randomPool(save: SaveV3, opts?: DexOptions): string[] {
  const pool = save.dex.unlocked.filter((slug) => inRandomEgg(slug, opts));
  return pool.length ? pool : [...save.dex.unlocked];
}
