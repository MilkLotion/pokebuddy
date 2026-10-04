// 박스의 순서·정렬·이름 — 박스 묶음과 한 박스의 칸 순서를 바꾸고 이름을 짓는다. 순수 함수이며 저장을 쓰지 않는다
// 칸 옮기기·찾기·넣기는 ./slots.ts 가 가진다 (96 대조 ⑥ — slots.ts 의 export 17개를 나눴다)
import { profileOf } from "../dex/species.js";
import { BOX_RULES } from "./rules.js";
import { boxName, defaultBoxName } from "./boxes.js";
import type { BoxFailure } from "./slots.js";
import type { BoxV3, PetV3 } from "../shared/save-v3";

// 박스 순서 바꾸기 — from 자리의 박스를 to 자리로 옮긴다. 사이의 박스는 한 칸씩 밀린다. 이름과 칸은 박스를 따라간다
export function orderBox(boxes: BoxV3[], from: number, to: number): { ok: true } | { ok: false; reason: BoxFailure } {
  const valid = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < boxes.length;
  if (!valid(from)) return { ok: false, reason: "no-box" };
  if (!valid(to)) return { ok: false, reason: "bad-slot" };
  if (from === to) return { ok: false, reason: "same-slot" };
  const [box] = boxes.splice(from, 1);
  if (box) boxes.splice(to, 0, box);
  return { ok: true };
}

// ── 정렬 (worklog/records/game-runtime/record.md "박스 정렬·이동·이름 변경의 설계", Figma 05 `Box / Sort Open` 등) ──

export type BoxSortKey = "dex" | "level" | "affinity" | "recent" | "name";
const BOX_SORT_KEYS: readonly BoxSortKey[] = ["dex", "level", "affinity", "recent", "name"];
export const isBoxSortKey = (v: unknown): v is BoxSortKey => typeof v === "string" && (BOX_SORT_KEYS as readonly string[]).includes(v);

// 한 박스만 정렬한다 — 개체를 기준 순서로 앞 칸부터 다시 놓고 빈 칸은 뒤로. 한 번만 정렬한다(뒤에 오는 개체는 빈 칸으로)
// 같은 값이면 도감 번호, 그다음 얻은 시각 순이다. nameOf 는 화면 이름(이름순에 쓴다)
export function sortBox(box: BoxV3, pets: ReadonlyMap<string, PetV3>, key: BoxSortKey, nameOf: (slug: string) => string): void {
  const dex = (p: PetV3): number => profileOf(p.species).dex || Number.MAX_SAFE_INTEGER;
  const tie = (a: PetV3, b: PetV3): number => dex(a) - dex(b) || a.since - b.since;
  const by: Record<BoxSortKey, (a: PetV3, b: PetV3) => number> = {
    dex: tie,
    level: (a, b) => b.level - a.level || tie(a, b),
    affinity: (a, b) => b.affinity - a.affinity || tie(a, b),
    recent: (a, b) => b.since - a.since || tie(a, b),
    name: (a, b) => nameOf(a.species).localeCompare(nameOf(b.species), "ko") || tie(a, b),
  };
  const list = box.slots.flatMap((id) => {
    const pet = id ? pets.get(id) : undefined;
    return pet ? [pet] : [];
  });
  // 저장에 개체가 없는 식별자는 그대로 뒤에 둔다 — 지우지 않는다
  const orphans = box.slots.filter((id): id is string => id != null && !pets.has(id));
  list.sort(by[key]);
  const ids = [...list.map((p) => p.id), ...orphans];
  box.slots = box.slots.map((_, i) => ids[i] ?? null);
}

// 박스 이름 — 앞뒤 공백을 지우고 nameMax 글자로 자른다. 비우거나 기본 이름이면 "" 를 저장해 자리 번호를 따른다(프리셋과 같다).
// 돌려주는 값은 화면 이름이다 (94 항목 9-5-5)
export function renameBox(box: BoxV3, name: string, boxIndex: number): string {
  const next = [...name.trim()].slice(0, BOX_RULES.nameMax).join("");
  box.name = next === defaultBoxName(boxIndex) ? "" : next;
  return boxName(box, boxIndex);
}
