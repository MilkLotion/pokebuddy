// 상점 상세 — 구매 창을 열 때 상품 하나의 상세를 만든다 (2026-09-30 사용자 결정 "상점에서 포켓몬 상세 추가해줘")
//
//   포켓몬       번호·이름·분류·타입과 진화 트리. 트리는 사슬의 뿌리부터 다음 단계를 재귀로 잇는다 (data/evo.json)
//   진화용 도구  이 도구로 진화하는 쌍 전부 — 진화 전 → 진화 후, 도감 번호순
// 미해금 종은 이름을 "???" 로 준다. 조건 문구는 미해금이어도 준다 (사용자 결정 "다 보여줘").
// 도감 상세처럼 칸을 누를 때 한 상품만 만든다. 상점 포켓몬은 수백 종이라 스냅샷에 싣지 않는다
import { loadJson, isMetaKey, type DexOptions } from "../dex/data.js";
import { nextOf, rootOf, type EvoStep } from "../dex/evo.js";
import { profile } from "../dex/species.js";
import { petName, typeName } from "../main/text.js";
import type { EvoNodeView, EvoPairView, ShopDetail } from "../shared/manage";
import type { SaveV3 } from "../shared/save-v3";
import { officialText, textOf } from "./dex-detail.js";
import { REGION_MAP, needIsMap, regionalOf } from "../dex/regional.js";
import { nameOfItem } from "./lists.js";

const LOCKED_NAME = "???";

// 도감에서 해금했거나 얻은 종인가 — 아니면 이름을 숨긴다
const known = (save: SaveV3, slug: string): boolean => save.dex.unlocked.includes(slug) || save.dex.obtained.includes(slug);

// 시간대·성별·지도 — 도구·레벨 뒤에 붙는 조건. 레벨·친밀도 지도 간선은 "Lv.36 · 지도". 돌 대신 지도인 간선은 조건이 지도라 "지도" 하나
function extras(step: EvoStep): string[] {
  const out: string[] = [];
  if (step.map && !needIsMap(step.need)) out.push("지도");
  if (step.affinity) out.push(`친밀도 ${step.affinity}`);
  if (step.when) out.push(step.when === "night" ? "밤" : "낮");
  if (step.gender) out.push(step.gender === "female" ? "암컷" : "수컷");
  return out;
}

// 진화 조건의 짧은 문구 — 트리 화살표 위에 쓴다. "Lv.16" · "천둥의돌" · "친밀도 65 · 밤" · "각성의돌 · 수컷"
export function needLabel(step: EvoStep, opts?: DexOptions): string {
  const need = step.need;
  const head = !need
    ? "친밀도 100"
    : need.kind === "level"
      ? `Lv.${need.level}`
      : need.kind === "affinity"
        ? `친밀도 ${need.value}`
        : nameOfItem(need.item, opts);
  return [head, ...extras(step)].join(" · ");
}

// 트리의 한 종이 지금 상품인가 — 도감 번호로 가린다(폼 상품도 기본 종 칸이 켜진다).
// 리전폼은 번호가 같아도 다른 종이라 슬러그로 가린다 — 라이츄와 알로라 라이츄
const isCurrent = (slug: string, current: string, opts?: DexOptions): boolean =>
  slug === current || (!regionalOf(slug, opts) && !regionalOf(current, opts) && profile(slug, opts).dex === profile(current, opts).dex);

// 사슬의 한 종과 그 아래 — 같은 종이 두 번 나오면 멈춘다(자료가 잘못돼도 끝나게)
function node(save: SaveV3, slug: string, current: string, need: string | undefined, seen: Set<string>, opts?: DexOptions): EvoNodeView {
  seen.add(slug);
  const locked = !known(save, slug);
  const children = nextOf(slug, opts)
    .filter((step) => !seen.has(step.to))
    .map((step) => node(save, step.to, current, needLabel(step, opts), seen, opts));
  return {
    slug,
    name: locked ? LOCKED_NAME : petName(slug),
    locked,
    current: isCurrent(slug, current, opts),
    ...(need ? { need } : {}),
    children,
  };
}

// 진화용 도구로 진화하는 쌍 — 진화 전 도감 번호, 같으면 진화 후 번호순. 지도는 map 간선(기본형 → 리전폼)의 쌍이다
export function evoPairs(save: SaveV3, itemId: string, opts?: DexOptions): EvoPairView[] {
  const table = loadJson<Record<string, EvoStep[]>>("evo.json", opts);
  const dexOf = (slug: string): number => profile(slug, opts).dex || Number.MAX_SAFE_INTEGER;
  const side = (slug: string): EvoPairView["from"] => ({ slug, name: known(save, slug) ? petName(slug) : LOCKED_NAME, locked: !known(save, slug) });
  const pairs: EvoPairView[] = [];
  for (const [from, steps] of Object.entries(table)) {
    if (isMetaKey(from)) continue;
    for (const step of steps) {
      const byItem = step.need?.kind === "item" && step.need.item === itemId;
      if (!byItem && !(itemId === REGION_MAP && step.map)) continue;
      // 쌍의 설명은 그 도구 밖의 조건이다 — 돌 쌍의 "수컷"처럼. 지도 쌍이면 레벨 간선은 "Lv.36", 돌 대신 지도인 간선은 설명 없음
      //   돌 쌍에는 지도 간선이 없다 — 돌 대신 지도라 조건이 지도다 (2026-09-30 사용자 결정 "아이템1개만쓰는게 나을거같네")
      const note = itemId === REGION_MAP && !needIsMap(step.need) ? needLabel({ ...step, map: undefined }, opts) : extras(step).join(" · ");
      pairs.push({ from: side(from), to: side(step.to), ...(note ? { note } : {}) });
    }
  }
  return pairs.sort((a, b) => dexOf(a.from.slug) - dexOf(b.from.slug) || dexOf(a.to.slug) - dexOf(b.to.slug));
}

// 진화 탭 상품 줄의 한 줄 설명 — "피카츄·레어코일 외 5종" · "야돈 → 야도킹" (2026-09-30 사용자 결정)
// 미해금 종의 이름은 드러내지 않는다 — 해금한 진화 전 종만 이름으로 쓰고 나머지는 수로 센다. 해금한 이름이 없으면 "대상 N종"
export function evoItemNote(save: SaveV3, itemId: string, opts?: DexOptions): string {
  const pairs = evoPairs(save, itemId, opts);
  const only = pairs[0];
  if (pairs.length === 1 && only) return `${only.from.name} → ${only.to.name}`;
  const names = [...new Set(pairs.filter((p) => !p.from.locked).map((p) => p.from.name))].slice(0, 2);
  if (!names.length) return `대상 ${pairs.length}종`;
  const rest = pairs.length - names.length;
  return rest > 0 ? `${names.join("·")} 외 ${rest}종` : names.join("·");
}

export function shopDetail(save: SaveV3, productId: string, opts?: DexOptions): ShopDetail | null {
  const evoItem = loadJson<Record<string, { ko: string }>>("evo-items.json", opts)[productId];
  if (evoItem && !isMetaKey(productId)) return { kind: "evolution", pairs: evoPairs(save, productId, opts) };
  const row = profile(productId, opts);
  if (!row.dex) return null;
  const form = regionalOf(productId, opts);
  return {
    kind: "pokemon",
    slug: productId,
    dex: row.dex,
    ...(form ? { form: form.no } : {}),
    name: petName(productId),
    genus: officialText(textOf(productId, row.dex, opts)).genus,
    types: row.types.map((t) => typeName(t)),
    typeIds: [...row.types],
    tree: node(save, rootOf(productId, opts), productId, undefined, new Set(), opts),
  };
}
