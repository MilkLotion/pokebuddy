// 서버 저장 검증(Edge Function upload-save)이 쓸 규칙 파일과 데이터를 만든다 — npm run build 뒤 실행
//   src/verify/save-rules.ts        → supabase/functions/_shared/save-rules.ts (그대로 복사 — import 가 없는 파일)
//   data/items.json·evo.json 등     → supabase/functions/_shared/verify-data.json
// 수치는 게임 규칙표에서 읽는다 — 규칙이 바뀌면 이 스크립트를 다시 돌리고 결과를 함께 커밋한다.
// selftest-verify 가 복사본과 데이터가 지금 규칙과 같은지 본다.
// verify-data.json 의 hash 는 규칙 복사본과 데이터의 지문이다 — 운영 upload-save 가 GET 으로 돌려주고, 설치 파일을 만들기 전에 대조한다(scripts/check-verify-deploy.cjs)
//   node dist/tools/data/build-verify.js          만들기 (npm run verify:build)
//   node dist/tools/data/build-verify.js --check  다르면 종료 코드 1 (만들지 않는다)
// (예전 scripts/build-verify.cjs. 규칙표를 이름으로 읽으므로 타입 검사를 받게 src/tools 로 옮겼다)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MINT_REFUND_EACH } from "../../bag/mint";
import { BAG_RULES } from "../../bag/rules";
import { nextOf } from "../../dex/evo";
import { expForLevel, growthOf } from "../../dex/growth";
import { megaOf, megaSlugs } from "../../dex/mega";
import { inRandomEgg } from "../../dex/obtain";
import { MEGA_RULES, RIDER_ITEM, SHIFT_RULES } from "../../dex/rules";
import { speciesSlugs } from "../../dex/species";
import { EGG_RULES } from "../../egg/rules";
import { FIND_RULES } from "../../find/rules";
import { PARTY_RULES } from "../../party/rules";
import { SHOP_RULES } from "../../shop/rules";
import { CARE_RULES, TIME_RULES } from "../../state/rules";
import { CLOCK_RULES } from "../../main/app/clock";
import { writeTextIfChanged } from "./write-text";

// data/*.json 의 항목 — 이 도구는 몇 칸만 읽는다. 모양 검사는 앱의 로더가 한다
// eslint 없음 — 데이터 표는 키마다 모양이 달라 느슨하게 읽는다
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const root = path.join(__dirname, "..", "..", "..");
const out = path.join(root, "supabase", "functions", "_shared");
const load = (f: string): Record<string, Json> => JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8")) as Record<string, Json>;
const lf = (t: string): string => t.replace(/\r\n/g, "\n");

export function buildVerifyFiles(): Record<string, string> {
  const items: Record<string, { price: number | null; effect: unknown; amount: number }> = {};
  for (const [id, it] of Object.entries(load("items.json"))) {
    if (id.startsWith("_")) continue;
    items[id] = { price: it.price ?? null, effect: it.effect, amount: it.amount ?? 0 };
  }
  // 진화용 도구 — 종류와 무관하게 같은 값
  for (const id of Object.keys(load("evo-items.json"))) {
    if (id.startsWith("_")) continue;
    items[id] = { price: SHOP_RULES.evoItemPrice, effect: "evolve", amount: 0 };
  }
  const eggs: Record<string, number> = {};
  for (const [kind, egg] of Object.entries(load("eggs.json"))) {
    if (!kind.startsWith("_") && typeof egg.price === "number") eggs[kind] = egg.price;
  }
  // 알 결과 재계산(P4b) — src/shop/catalog.ts eggBonus·isSingleEgg 와 같은 거르기, src/egg/hatch.ts 가중치
  const eggData = load("eggs.json");
  const eggKinds: Record<string, { bonus: [string, unknown][]; single: boolean; pool: unknown[] }> = {};
  for (const [kind, egg] of Object.entries(eggData)) {
    if (kind.startsWith("_")) continue;
    const bonus = Object.entries((egg.bonus ?? {}) as Record<string, unknown>).filter(([k, p]) => typeof p === "number" && p > 0 && eggData[k] != null);
    eggKinds[kind] = { bonus, single: egg.single === true, pool: Array.isArray(egg.pool) ? egg.pool : [] };
  }
  // 다 모은 단일 포켓몬 알의 포인트 — 앱의 allCaughtPoints 와 같은 계산 (src/egg/pool.ts)
  const allCaught: Record<string, number> = {};
  for (const [kind, k] of Object.entries(eggKinds)) {
    const price = eggs[kind] ?? 0;
    if (k.single && price > 0) allCaught[kind] = Math.floor((price * EGG_RULES.allCaughtRate) / EGG_RULES.allCaughtUnit) * EGG_RULES.allCaughtUnit;
  }
  const ranks: Record<string, number> = {};
  for (const [slug, sp] of Object.entries(load("species.defaults.json"))) {
    if (!slug.startsWith("_") && typeof sp.rank === "number" && sp.rank !== 1) ranks[slug] = sp.rank;
  }
  const achievements: Record<string, string> = {};
  for (const [id, a] of Object.entries(load("achievements.json"))) {
    if (id.startsWith("_")) continue;
    // 보상 — pokemon · party-slot · points:<양> · egg:<알 종류> · item:<도구>:<개수> (src/achievement/evaluate.ts)
    const r = a.reward && typeof a.reward === "object" ? a.reward : {};
    achievements[id] = r.pokemon ? "pokemon"
      : typeof r.points === "number" ? `points:${r.points}`
      : r.egg ? `egg:${r.egg}`
      : r.item ? `item:${r.item}:${r.count > 0 ? r.count : 1}`
      : "party-slot";
  }
  // 진화 간선 — 앱과 같은 nextOf 로 뽑는다. 모습 슬러그(burmy-sandy 등)는 기본 종의 간선을 받는다
  const evo: Record<string, string[]> = {};
  const species = new Set([...speciesSlugs(), ...Object.keys(load("evo.json")).filter((k) => !k.startsWith("_"))]);
  for (const slug of species) {
    const to = [...new Set(nextOf(slug).map((e) => e.to))];
    if (to.length) evo[slug] = to;
  }
  const growth: Record<string, unknown> = {};
  for (const slug of species) growth[slug] = growthOf(slug);
  const rates = ["fast", "medium-fast", "medium-slow", "slow", "erratic", "fluctuating"] as const;
  const expTable: Record<string, number[]> = {};
  for (const r of rates) expTable[r] = Array.from({ length: 100 }, (_, i) => expForLevel(r, i + 1));
  const maxExp = Math.max(...rates.map((r) => expTable[r]![99]!));
  // 이상한사탕 — 한 레벨 간격의 최대
  let rareCandyExp = 0;
  for (const r of rates) for (let l = 1; l < 100; l++) rareCandyExp = Math.max(rareCandyExp, expTable[r]![l]! - expTable[r]![l - 1]!);
  // 친밀도 시간 적립 최대 — 버프 합(든든함+신남). 작업 시간은 더 쌓지 않는다 (2026-10-05 작업 2배 제거)
  const buffTop = 100 + TIME_RULES.buffBonusPercent["premium-food"] + TIME_RULES.buffBonusPercent["long-play"];
  const affinityPerHour = (3_600_000 / TIME_RULES.affinityGainMs) * (buffTop / 100);
  // 돌봄 — 밥·놀기를 쿨타임마다 한 번씩. 프리미엄먹이(+8)는 밥 주기 쿨타임을 같이 쓰므로 밥 몫의 최대로 센다 (2026-10-05 돌봄 개편)
  const feedTop = Math.max(BAG_RULES.feedAffinity, BAG_RULES.premiumAffinity);
  const carePerHour = (3_600_000 / BAG_RULES.feedCooldownMs) * feedTop + (3_600_000 / CARE_RULES.playCooldownMs) * BAG_RULES.playAffinity;
  // 메가 모습 — 종 → 모습 슬러그 (data/mega.json). mega 규칙이 모습의 종을 본다
  const megaForms: Record<string, string[]> = {};
  for (const slug of megaSlugs()) (megaForms[megaOf(slug)!.base] ??= []).push(slug);
  // 규칙이 있는 모습 바꾸기 묶음 — 종(기본 종 포함) → 규칙. 묶음은 data/regional.json 의 shift, 규칙은 SHIFT_RULES (로토무와 다섯 모습)
  const shiftRules: Record<string, { base: string; workMs: number; item: string }> = {};
  for (const [base, list] of Object.entries((load("regional.json").shift ?? {}) as Record<string, unknown>)) {
    const rule = SHIFT_RULES[base];
    if (base.startsWith("_") || !rule || !Array.isArray(list)) continue;
    for (const slug of [base, ...list]) if (typeof slug === "string") shiftRules[slug] = { base, ...rule };
  }
  // 버드렉스의 말 — 모습 → 있어야 하는 말(data/regional.json riders), 말을 부를 수 있는 종(그 모습들의 shift 묶음), 부르기 도구
  const regional = load("regional.json");
  const riders: Record<string, string> = {};
  const riderOwners = new Set<string>();
  for (const [form, horse] of Object.entries((regional.riders ?? {}) as Record<string, unknown>)) {
    if (form.startsWith("_") || typeof horse !== "string") continue;
    riders[form] = horse;
    for (const [base, list] of Object.entries((regional.shift ?? {}) as Record<string, unknown>)) {
      if (Array.isArray(list) && list.includes(form)) for (const slug of [base, ...list]) if (typeof slug === "string") riderOwners.add(slug);
    }
  }
  const data = {
    items,
    eggs,
    achievements,
    evo,
    megaForms,
    riders,
    riderOwners: [...riderOwners].sort(),
    riderItem: RIDER_ITEM,
    shiftRules,
    growth,
    expTable,
    maxExp,
    rareCandyExp,
    eggKinds,
    allCaught,
    ranks,
    rankWeight: EGG_RULES.rankWeight,
    shinyOneIn: EGG_RULES.shinyOneIn,
    // 알에서 대신 나오는 모습 — 앱의 rollVariant 와 같은 표 (data/regional.json 의 hatch)
    hatchVariants: Object.fromEntries(Object.entries((load("regional.json").hatch ?? {}) as Record<string, unknown>).filter(([k]) => !k.startsWith("_"))),
    // 랜덤알 후보가 될 수 있는 종 — 새 알 후보가 이 범위 밖이면 고친 알이다(검수 P4b H3). 해금 여부는 저장 쪽 값이라 보지 않는다
    randomPool: [...species].filter((slug) => inRandomEgg(slug)).sort(),
    rules: {
      pointMs: TIME_RULES.pointGainMs,
      maxPartySlots: PARTY_RULES.total,
      // 친밀도 배율(2) × 포인트 적립 배율 최대(100 + 든든함 + 신남) — src/state/time.ts pointPercent. 손해는 줄이기만 한다 (2026-10-05 돌봄 개편, 그 전에는 기분 최고까지 2.8)
      maxEarnFactor: (2 * buffTop) / 100,
      // 다른 프리셋 — (최대 프리셋 수 − 1) × 6마리 × 친밀도 배율(2) × 적립 배율. 버프·손해는 받지 않는다 (src/state/time.ts applyTime)
      otherPresetEarn: ((PARTY_RULES.presets.max - 1) * PARTY_RULES.total * 2 * TIME_RULES.otherPresetPointPercent) / 100,
      findPointsMax: FIND_RULES.points.max,
      mintRefund: MINT_REFUND_EACH,
      sellRatio: SHOP_RULES.sellRate,
      // 포켓몬 판매가의 최대 — 단일 포켓몬 알이 아닌 알의 값 × 비율, 단위 내림 (src/shop/sell-pet.ts petSellPrice)
      petSellMax: Math.max(0, ...Object.entries(eggKinds).filter(([, k]) => !k.single)
        .map(([kind]) => Math.floor(((eggs[kind] ?? 0) * SHOP_RULES.petSellRate) / SHOP_RULES.petSellUnit) * SHOP_RULES.petSellUnit)),
      speciesMinPrice: Math.min(...Object.values(SHOP_RULES.speciesPrices)),
      megaLevel: MEGA_RULES.level,
      megaBondMs: MEGA_RULES.bondMs,
      megaCare: MEGA_RULES.care,
      careCountPerHour: 3_600_000 / BAG_RULES.feedCooldownMs + 3_600_000 / CARE_RULES.playCooldownMs,
      megaAffinity: MEGA_RULES.affinity,
      affinityPerHour,
      carePerHour,
      careOnce: feedTop + BAG_RULES.playAffinity,
      toyAffinity: BAG_RULES.toyAffinity, // 장난감 하나가 바로 올리는 친밀도 (2026-10-05 +5)
      maxEggs: EGG_RULES.maxEggs,
      // 파일 쓰기 주기 + 게임 틱 한 번의 최대 + 여유 — 올린 저장이 이만큼 늦게 찍혔을 수 있다
      slackMs: CLOCK_RULES.saveMs + TIME_RULES.maxElapsedMs + 15_000,
    },
  };
  const rulesText = `// 생성 파일 — src/verify/save-rules.ts 복사본. 고치지 말고 npm run verify:build 를 돌린다\n${lf(fs.readFileSync(path.join(root, "src/verify/save-rules.ts"), "utf8"))}`;
  // 지문 — 규칙 복사본과 데이터 본문(hash 칸 빼고). 둘 중 하나만 바뀌어도 달라진다
  const hash = crypto.createHash("sha256").update(rulesText).update(JSON.stringify(data)).digest("hex").slice(0, 16);
  return {
    "save-rules.ts": rulesText,
    "verify-data.json": `${JSON.stringify({ hash, ...data }, null, 1)}\n`,
  };
}

if (require.main === module) {
  const files = buildVerifyFiles();
  if (process.argv.includes("--check")) {
    const stale = Object.entries(files)
      .filter(([name, text]) => {
        // 줄 끝은 보지 않는다 — Windows 체크아웃(core.autocrlf)이 CRLF 로 바꿔 놓는다
        try {
          return lf(fs.readFileSync(path.join(out, name), "utf8")) !== lf(text);
        } catch {
          return true;
        }
      })
      .map(([name]) => name);
    if (stale.length) {
      process.stderr.write(`검증 파일이 지금 규칙과 다르다: ${stale.join(", ")} — npm run verify:build\n`);
      process.exit(1);
    }
    process.exit(0);
  }
  fs.mkdirSync(out, { recursive: true });
  const written = Object.entries(files).filter(([name, text]) => writeTextIfChanged(path.join(out, name), text)).map(([name]) => name);
  const shown = (list: string[]): string => list.map((n) => `supabase/functions/_shared/${n}`).join(", ");
  process.stdout.write(written.length ? `만듦: ${shown(written)}\n` : `그대로: ${shown(Object.keys(files))} — 내용이 같아 쓰지 않았다\n`);
}
