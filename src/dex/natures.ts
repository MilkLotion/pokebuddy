// 성격 — data/natures.json 의 25개. 이름·다섯 축(+1 · 0 · −1). 앱 안에서 축은 전부 배율 (design.md "성격")

import type { Axis, AxisValue, Nature, NatureId } from "../shared/species";
import { loadJson, type DexOptions } from "./data";
import { QUIRK_RULES } from "./rules";

// 성격을 화면에 보일지 — 2026-09-30 사용자 결정 "성격은 없앨거야 … 코드는 남겨두고". 부여·저장·교환 검증·움직임 배율은 그대로다.
// 끄면 우클릭 메뉴 첫 줄과 CLI 상태 줄에서 성격을 뺀다. 관리 창 src/renderer/manage.ts·pet.ts 의 NATURE_UI 와 같이 바꾼다
export const NATURE_SHOWN = false;

export const AXES: readonly Axis[] = ["activity", "boldness", "steadiness", "sociability", "patience"];

// 성격을 모르는 개체(옛 저장·값 파손)에 붙이는 중립 성격 — 축이 전부 0
export const FALLBACK_NATURE: NatureId = "hardy";

// 모르는 성격의 축 — 전부 0 (중립)
const NEUTRAL_AXES: Readonly<Record<Axis, AxisValue>> = {
  activity: 0,
  boldness: 0,
  steadiness: 0,
  sociability: 0,
  patience: 0,
};

const table = (opts?: DexOptions): Nature[] => loadJson<Nature[]>("natures.json", opts);

// 25개 전부 — 표의 순서(대응표 행 순서). 복사본
export const natureList = (opts?: DexOptions): Nature[] => [...table(opts)];

// 하나 — 모르는 id 는 undefined
export const natureOf = (id: string, opts?: DexOptions): Nature | undefined => table(opts).find((n) => n.id === id);

export const isNatureId = (id: string, opts?: DexOptions): id is NatureId => natureOf(id, opts) !== undefined;

// 축 값 — 모르는 id 면 전부 0. 항상 새 객체
export const axesOf = (id: string, opts?: DexOptions): Record<Axis, AxisValue> => ({ ...(natureOf(id, opts)?.axes ?? NEUTRAL_AXES) });


// 변덕은 마리별로 어긋난 주기에 한 축이 잠깐 바뀜 — 시각 주입, 저장·재시작에도 같은 결과
export function axesAt(id: string, petId: string, now: number): Record<Axis, AxisValue> {
  const axes = axesOf(id);
  if (id !== "quirky") return axes;
  let seed = 0;
  for (const char of petId) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0;
  const shifted = now + seed % QUIRK_RULES.periodMs;
  if (shifted % QUIRK_RULES.periodMs >= QUIRK_RULES.durationMs) return axes;
  const cycle = Math.floor(shifted / QUIRK_RULES.periodMs);
  axes[AXES[(seed + cycle) % AXES.length]!] = cycle % 2 ? -1 : 1;
  return axes;
}

// 무작위 하나 — rng 는 [0, 1) 을 돌려주는 함수 (시험에서 고정)
export function randomNature(rng: () => number, opts?: DexOptions): Nature {
  const list = table(opts);
  const idx = Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)));
  const picked = list[idx];
  if (!picked) throw new Error("natures.json 이 비어 있다");
  return picked;
}
