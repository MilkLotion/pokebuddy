// 서버 저장 검증(Edge Function upload-save)이 쓸 규칙 파일과 데이터를 만든다 — npm run build 뒤 실행
//   src/verify/save-rules.ts        → supabase/functions/_shared/save-rules.ts (그대로 복사 — import 가 없는 파일)
//   data/items.json·evo.json 등     → supabase/functions/_shared/verify-data.json
// 수치는 게임 규칙표(dist/)에서 읽는다 — 규칙이 바뀌면 이 스크립트를 다시 돌리고 결과를 함께 커밋한다.
// selftest-verify 가 복사본과 데이터가 지금 규칙과 같은지 본다.
//   node scripts/build-verify.cjs          만들기
//   node scripts/build-verify.cjs --check  다르면 종료 코드 1 (만들지 않는다)
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'supabase', 'functions', '_shared');
const load = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const lf = (t) => t.replace(/\r\n/g, '\n');

function build() {
  const { TIME_V3_RULES, SAVE_RULES, SAVE_V3_RULES, SHOP_V3_RULES, EGG_V3_RULES, BAG_V3_RULES, MOOD_RULES, MEGA_RULES } = require(path.join(root, 'dist/save/rules.js'));
  const { megaSlugs, megaOf } = require(path.join(root, 'dist/dex/mega.js'));
  const { FIND_RULES } = require(path.join(root, 'dist/find/rules.js'));
  const { MINT_REFUND_EACH } = require(path.join(root, 'dist/bag/mint.js'));
  const { STATE_RULES } = require(path.join(root, 'dist/state/rules.js'));
  const { expForLevel, growthOf } = require(path.join(root, 'dist/dex/growth.js'));
  const { nextOf } = require(path.join(root, 'dist/dex/evo.js'));
  const { slugs } = require(path.join(root, 'dist/dex/species.js'));

  const items = {};
  for (const [id, it] of Object.entries(load('items.json'))) {
    if (id.startsWith('_')) continue;
    items[id] = { price: it.price ?? null, effect: it.effect, amount: it.amount ?? 0 };
  }
  // 진화용 도구 — 종류와 무관하게 같은 값
  for (const id of Object.keys(load('evo-items.json'))) {
    if (id.startsWith('_')) continue;
    items[id] = { price: SHOP_V3_RULES.evoItemPrice, effect: 'evolve', amount: 0 };
  }
  const eggs = {};
  for (const [kind, egg] of Object.entries(load('eggs.json'))) {
    if (!kind.startsWith('_') && typeof egg.price === 'number') eggs[kind] = egg.price;
  }
  // 알 결과 재계산(P4b) — src/shop/catalog.ts eggBonus·isSingleEgg 와 같은 거르기, src/egg/hatch.ts 가중치
  const { RANK_WEIGHT, SHINY_ONE_IN } = require(path.join(root, 'dist/egg/hatch.js'));
  const { inRandomEgg } = require(path.join(root, 'dist/shop/catalog.js'));
  const eggData = load('eggs.json');
  const eggKinds = {};
  for (const [kind, egg] of Object.entries(eggData)) {
    if (kind.startsWith('_')) continue;
    const bonus = Object.entries(egg.bonus ?? {}).filter(([k, p]) => typeof p === 'number' && p > 0 && eggData[k] != null);
    eggKinds[kind] = { bonus, single: egg.single === true, pool: Array.isArray(egg.pool) ? egg.pool : [] };
  }
  const ranks = {};
  for (const [slug, sp] of Object.entries(load('species.defaults.json'))) {
    if (!slug.startsWith('_') && typeof sp.rank === 'number' && sp.rank !== 1) ranks[slug] = sp.rank;
  }
  const achievements = {};
  for (const [id, a] of Object.entries(load('achievements.json'))) {
    if (!id.startsWith('_')) achievements[id] = a.reward && typeof a.reward === 'object' && a.reward.pokemon ? 'pokemon' : 'party-slot';
  }
  // 진화 간선 — 앱과 같은 nextOf 로 뽑는다. 모습 슬러그(burmy-sandy 등)는 기본 종의 간선을 받는다
  const evo = {};
  const species = new Set([...slugs(), ...Object.keys(load('evo.json')).filter((k) => !k.startsWith('_'))]);
  for (const slug of species) {
    const to = [...new Set(nextOf(slug).map((e) => e.to))];
    if (to.length) evo[slug] = to;
  }
  const growth = {};
  for (const slug of species) growth[slug] = growthOf(slug);
  const rates = ['fast', 'medium-fast', 'medium-slow', 'slow', 'erratic', 'fluctuating'];
  const expTable = {};
  for (const r of rates) expTable[r] = Array.from({ length: 100 }, (_, i) => expForLevel(r, i + 1));
  const maxExp = Math.max(...rates.map((r) => expTable[r][99]));
  // 이상한사탕 — 한 레벨 간격의 최대
  let rareCandyExp = 0;
  for (const r of rates) for (let l = 1; l < 100; l++) rareCandyExp = Math.max(rareCandyExp, expTable[r][l] - expTable[r][l - 1]);
  // 친밀도 시간 적립 최대 — 버프 합(든든함+신남) × 작업 2배
  const buffTop = 100 + TIME_V3_RULES.buffBonusPercent['premium-food'] + TIME_V3_RULES.buffBonusPercent['long-play'];
  const affinityPerHour = (3_600_000 / TIME_V3_RULES.affinityGainMs) * (buffTop / 100) * 2;
  // 돌봄 — 밥·놀기를 쿨타임마다 한 번씩
  const carePerHour = (3_600_000 / SAVE_V3_RULES.feedCooldownMs) * BAG_V3_RULES.feedAffinity + (3_600_000 / SAVE_V3_RULES.playCooldownMs) * BAG_V3_RULES.playAffinity;
  // 메가 모습 — 종 → 모습 슬러그 (data/mega.json). mega 규칙이 모습의 종을 본다
  const megaForms = {};
  for (const slug of megaSlugs()) (megaForms[megaOf(slug).base] ??= []).push(slug);
  const data = {
    items,
    eggs,
    achievements,
    evo,
    megaForms,
    growth,
    expTable,
    maxExp,
    rareCandyExp,
    eggKinds,
    ranks,
    rankWeight: RANK_WEIGHT,
    shinyOneIn: SHINY_ONE_IN,
    // 랜덤알 후보가 될 수 있는 종 — 새 알 후보가 이 범위 밖이면 고친 알이다(검수 P4b H3). 해금 여부는 저장 쪽 값이라 보지 않는다
    randomPool: [...species].filter((slug) => inRandomEgg(slug)).sort(),
    rules: {
      pointMs: TIME_V3_RULES.pointGainMs,
      maxPartySlots: SAVE_RULES.slots.max,
      // 친밀도 배율(2) × 작업 배율(2) × 돌봄 보너스 최대(든든함 + 신남 + 기분 최고) — src/state/time.ts carePercent
      maxEarnFactor: (4 * (buffTop + Math.max(0, ...MOOD_RULES.pointBonus.map((b) => b.percent)))) / 100,
      findPointsMax: FIND_RULES.points.max,
      mintRefund: MINT_REFUND_EACH,
      sellRatio: SHOP_V3_RULES.sellRate,
      // 포켓몬 판매가의 최대 — 단일 포켓몬 알이 아닌 알의 값 × 비율, 단위 내림 (src/shop/sell-pet.ts petSellPrice)
      petSellMax: Math.max(0, ...Object.entries(eggKinds).filter(([, k]) => !k.single)
        .map(([kind]) => Math.floor(((eggs[kind] ?? 0) * SHOP_V3_RULES.petSellRate) / SHOP_V3_RULES.petSellUnit) * SHOP_V3_RULES.petSellUnit)),
      speciesMinPrice: Math.min(...Object.values(SHOP_V3_RULES.speciesPrices)),
      megaLevel: MEGA_RULES.level,
      megaAffinity: MEGA_RULES.affinity,
      affinityPerHour,
      carePerHour,
      careOnce: BAG_V3_RULES.feedAffinity + BAG_V3_RULES.playAffinity,
      toyAffinity: BAG_V3_RULES.playAffinity,
      maxEggs: EGG_V3_RULES.maxEggs,
      // 파일 쓰기 주기 + 게임 틱 한 번의 최대 + 여유 — 올린 저장이 이만큼 늦게 찍혔을 수 있다
      slackMs: STATE_RULES.saveMs + TIME_V3_RULES.maxTickMs + 15_000,
    },
  };
  return {
    'save-rules.ts': `// 생성 파일 — src/verify/save-rules.ts 복사본. 고치지 말고 scripts/build-verify.cjs 를 돌린다\n${lf(fs.readFileSync(path.join(root, 'src/verify/save-rules.ts'), 'utf8'))}`,
    'verify-data.json': `${JSON.stringify(data, null, 1)}\n`,
  };
}

const files = build();
if (process.argv.includes('--check')) {
  const stale = Object.entries(files).filter(([name, text]) => {
    // 줄 끝은 보지 않는다 — Windows 체크아웃(core.autocrlf)이 CRLF 로 바꿔 놓는다
    try { return lf(fs.readFileSync(path.join(out, name), 'utf8')) !== lf(text); } catch { return true; }
  }).map(([name]) => name);
  if (stale.length) {
    console.error(`검증 파일이 지금 규칙과 다르다: ${stale.join(', ')} — node scripts/build-verify.cjs`);
    process.exit(1);
  }
  process.exit(0);
}
fs.mkdirSync(out, { recursive: true });
for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(out, name), text);
console.log(`만듦: ${Object.keys(files).map((n) => `supabase/functions/_shared/${n}`).join(', ')}`);
