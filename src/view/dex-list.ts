// 도감 목록 — 도감 번호 순. 상태는 획득 · 해금 · 미해금 셋이다
import { type DexOptions, isMetaKey } from "../dex/data.js";
import { petName } from "./text.js";
import type { SaveV3 } from "../shared/save-v3";
import { regionalOf, isRegional } from "../dex/regional.js";
import type { DexEntry } from "../shared/model/detail";
import { speciesTable, type SpeciesRow } from "../dex/tables.js";

// 리전폼 항목의 폼 순번·지방 — 리전폼이 아니면 빈 객체
export function formFields(slug: string, opts?: DexOptions): { form?: number; region?: string } {
  const form = regionalOf(slug, opts);
  return form ? { form: form.no, region: form.region } : {};
}

// 도감 번호 하나에 슬러그가 여럿이면 기본형만 남긴다. 리전폼(src/dex/regional.ts)은 다른 종이라 따로 남긴다.
// 폼 슬러그는 `arceus-bug` 처럼 기본형 뒤에 접미사가 붙으므로 가장 짧은 것이 기본형이다.
// 슬러그에 하이픈이 있는지로는 가릴 수 없다 — `ho-oh` `porygon-z` 처럼 기본형에도 하이픈이 있다.
function baseForms(rows: Record<string, SpeciesRow>, opts?: DexOptions): { slug: string; dex: number }[] {
  const byDex = new Map<number, string>();
  const regional: { slug: string; dex: number }[] = [];
  for (const [slug, row] of Object.entries(rows)) {
    if (isMetaKey(slug) || !row.dex) continue;
    if (isRegional(slug, opts)) {
      regional.push({ slug, dex: row.dex });
      continue;
    }
    const kept = byDex.get(row.dex);
    if (kept == null || slug.length < kept.length || (slug.length === kept.length && slug < kept)) byDex.set(row.dex, slug);
  }
  return [...[...byDex.entries()].map(([dex, slug]) => ({ slug, dex })), ...regional];
}

// 도감 항목 — 도감 번호 순. 상태는 획득 · 해금 · 미해금 셋이다
export function dexList(save: SaveV3, opts?: DexOptions): DexEntry[] {
  const obtained = new Set(save.dex.obtained);
  const unlocked = new Set(save.dex.unlocked);
  const shiny = new Set(save.dex.shinyObtained);
  const mega = new Set(save.dex.megaOpened ?? []);
  const out: DexEntry[] = [];
  for (const { slug, dex } of baseForms(speciesTable(opts), opts)) {
    out.push({
      slug,
      dex,
      ...formFields(slug, opts),
      name: petName(slug),
      state: obtained.has(slug) ? "obtained" : unlocked.has(slug) ? "unlocked" : "locked",
      shiny: shiny.has(slug),
      ...(mega.has(slug) ? { mega: true as const } : {}),
    });
  }
  out.sort((a, b) => a.dex - b.dex || (a.form ?? 0) - (b.form ?? 0));
  return out;
}
