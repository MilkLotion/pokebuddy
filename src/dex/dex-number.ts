// 펫 이름 → 전국도감 번호.
// PMD 자산은 4자리 도감번호(0133)로 찾는데 이 도구는 이름(eevee)을 쓴다. 그 사이를 잇는다.
// 데이터는 PokeAPI CSV 로 만든 data/dex.json 을 동봉한다 (src/tools/data/build-dex.ts, npm run data:build) —
// 런타임에 네트워크 의존을 두지 않는다. 2026-09-25 전에는 codex-pokepets 의 pets.json 에서 뽑은 표였다.
// (예전 lib/dex.js. 도구 레인 T7a 에서 타입 검사를 받게 옮겼다. 표는 T7b-2 에서 lib/ 에서 data/ 로 옮겼다)
import { loadJson, normalizeSlug } from "./data";

// 표 — data/dex.json (dex/data.ts 의 기본 자리)
const table = (): Record<string, number> => loadJson<Record<string, number>>("dex.json");

function dexOf(slug: string): number | null {
  return table()[normalizeSlug(slug)] ?? null;
}

// PMD 경로에 쓰는 4자리 형식
export function dexPath(slug: string): string | null {
  const n = dexOf(slug);
  return n == null ? null : String(n).padStart(4, "0");
}

// 오타일 때 비슷한 이름 몇 개 — bin/pokebuddy 의 안내를 PMD 에서도 유지하려고
export function suggestSlugs(slug: string, limit = 5): string[] {
  const key = normalizeSlug(slug).replace(/[^a-z]/g, "").replace(/^mega/, "").replace(/mega$/, "");
  if (key.length < 3) return [];
  return Object.keys(table())
    .filter((name) => name.includes(key))
    .slice(0, limit);
}
