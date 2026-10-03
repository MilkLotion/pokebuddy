// 레벨 곡선 — 원작 경험치 타입 6종을 그대로 쓴다. 종별 타입은 data/species.defaults.json 의 growthRate
//
// 식은 원작 공식이다. x 는 레벨이고 결과는 그 레벨이 되는 데 필요한 누적 경험치다. 소수점은 버린다.
//   fast           4x³/5                                  100레벨 800,000
//   medium-fast    x³                                     100레벨 1,000,000
//   medium-slow    6x³/5 − 15x² + 100x − 140              100레벨 1,059,860
//   slow           5x³/4                                  100레벨 1,250,000
//   erratic        구간식                                  100레벨 600,000
//   fluctuating    구간식                                  100레벨 1,640,000
// 레벨 1 은 어느 타입이나 0 이다. 최대 레벨은 100 이다.
import { loadJson, type DexOptions } from "./data.js";
import type { GrowthRate } from "../shared/species";

export const MAX_LEVEL = 100;

const cube = (x: number): number => x * x * x;

function erratic(x: number): number {
  if (x <= 50) return Math.floor((cube(x) * (100 - x)) / 50);
  if (x <= 68) return Math.floor((cube(x) * (150 - x)) / 100);
  if (x <= 98) {
    const m = x % 3;
    return Math.floor((cube(x) * (1274 + m * m - 9 * m - 20 * Math.floor(x / 3))) / 1000);
  }
  return Math.floor((cube(x) * (160 - x)) / 100);
}

function fluctuating(x: number): number {
  if (x <= 15) return Math.floor((cube(x) * (Math.floor((x + 1) / 3) + 24)) / 50);
  if (x <= 36) return Math.floor((cube(x) * (x + 14)) / 50);
  return Math.floor((cube(x) * (Math.floor(x / 2) + 32)) / 50);
}

// 경험치 곡선 — 칸 L 은 레벨 L 이 되는 누적 경험치(칸 0 은 0). 사탕 미리보기(src/bag/preview.ts)가 쓴다. 타입마다 한 번 만든다
const curves = new Map<GrowthRate, readonly number[]>();
export function growthCurve(rate: GrowthRate): readonly number[] {
  let curve = curves.get(rate);
  if (!curve) {
    curve = Array.from({ length: MAX_LEVEL + 1 }, (_, level) => (level < 1 ? 0 : expForLevel(rate, level)));
    curves.set(rate, curve);
  }
  return curve;
}

// 그 레벨이 되는 데 필요한 누적 경험치
export function expForLevel(rate: GrowthRate, level: number): number {
  const x = Math.min(MAX_LEVEL, Math.max(1, Math.round(level)));
  if (x === 1) return 0;
  switch (rate) {
    case "fast":
      return Math.floor((4 * cube(x)) / 5);
    case "medium-slow":
      return Math.max(0, Math.floor((6 * cube(x)) / 5 - 15 * x * x + 100 * x - 140));
    case "slow":
      return Math.floor((5 * cube(x)) / 4);
    case "erratic":
      return erratic(x);
    case "fluctuating":
      return fluctuating(x);
    default:
      return cube(x);
  }
}

// 누적 경험치로 읽는 레벨. 100 을 넘지 않는다
export function levelFor(rate: GrowthRate, exp: number): number {
  const total = Math.max(0, Math.floor(exp));
  let level = 1;
  for (let x = 2; x <= MAX_LEVEL; x++) {
    if (expForLevel(rate, x) > total) break;
    level = x;
  }
  return level;
}

interface SpeciesGrowth {
  growthRate?: GrowthRate;
}

// 종의 경험치 타입. 모르면 보통 빠름
export function growthOf(species: string, opts?: DexOptions): GrowthRate {
  const table = loadJson<Record<string, SpeciesGrowth>>("species.defaults.json", opts);
  return table[species]?.growthRate ?? "medium-fast";
}

// 다음 레벨까지의 진행 — 화면의 `Lv.N까지 M%`
export function progressTo(rate: GrowthRate, exp: number): { level: number; percent: number; nextExp: number } {
  const level = levelFor(rate, exp);
  if (level >= MAX_LEVEL) return { level, percent: 100, nextExp: 0 };
  const base = expForLevel(rate, level);
  const next = expForLevel(rate, level + 1);
  const span = next - base;
  return { level, percent: span > 0 ? Math.floor(((exp - base) / span) * 100) : 0, nextExp: next - exp };
}
