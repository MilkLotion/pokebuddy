// 종·모습마다 배울 수 있는 기술을 모으고, 결정력을 계산하고, 기본 2개·후보 4개를 고른다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/data/build-move-pool.js [--csv <PokeAPI CSV 폴더>] [--apply]
//   npm run build && node dist/tools/data/build-move-pool.js --smogon <Smogon chaos JSON 폴더>   (사용률 원천 CSV 를 다시 만든다)
//
// 원천과 결과(data-src/moves/ — npm 패키지 밖이다):
//   smogon-moves.csv     Smogon 사용 통계(chaos JSON)에서 뽑은 종 × 기술 사용 수. --smogon 으로 만든다. 받은 달·형식은 SMOGON_SOURCE
//   representative.json  대표기술 — 손으로 고른 종 → 기술 (docs/specs/moves.md "처음 값을 정한 순서")
//   not-signature.json   한 계열만 배우지만 전용기로 보지 않는 기술
//   learnset.csv         앱의 모든 종·모습(종 표 + 메가·원시회귀) × 그 최신 기술 목록의 공격기. 목록 출처 열이 있다
//   power.csv            같은 행의 결정력·부담 계수·칸 타입·사용률
//   picks.csv            모습마다 고른 기본 2개·후보 4개와 까닭
//   diff.txt             지금 data/species-moves.json·mega-moves.json 과 다른 줄
// --all-games 이면 최신 작품 하나가 아니라 모든 본편 작품 목록의 합집합을 쓴다. --with-prevo 이면 진화 전 종의 목록도 합친다 (비교용, 규칙은 최신 작품)
// --keep-base 이면 종의 지금 기본 2개가 유효할 때(최신 목록 안, 칸 타입이 맞음, 무겁지 않음) 그대로 두고 후보만 새로 고른다. 메가는 늘 새로 고른다
// --apply 이면 data/species-moves.json·data/mega-moves.json 을 고르기 결과로 쓴다. 손 예외 줄(특수 종, 칸을 덮는 객체가 있는 종)은 지금 값을 둔다
//
// 규칙은 docs/specs/moves.md "기본 기술 배치"·"기술 고르기"·"결정력"·"부담 계수"·"메가 모습의 기술"
//   - 최신 기술 목록: 그 모습이 습득 데이터를 가진 가장 최근 본편 작품. 메가 모습은 자기 목록이 없어 기본 종의 목록이다
//   - 순서: 사용률(0.5% 이상, 이 게임에 없는 효과 때문에 쓰는 기술은 0) → 결정력 × 부담 계수. 사용률이 없으면 결정력 × 부담 계수
//   - 후보: 묶음(자기 타입·다른 타입) 1위 결정력 × 부담의 70% 미만은 뒤로 미룬다
import fs from "node:fs";
import path from "node:path";
import { BASE, DATA_DIR, PROJECT_ROOT, parseCsvTable, runBuild, writeLineJson, type CsvRow } from "./pokeapi-csv";

const SRC_DIR = path.join(PROJECT_ROOT, "data-src", "moves");
// Smogon 통계 — 2026-09 chaos, 레이팅 0(전체), gen9 형식 15개(일반·National Dex). 예전 기술 고르기와 같은 형식이다
export const SMOGON_SOURCE = {
  month: "2026-09",
  cutoff: 0,
  formats: ["ou", "uu", "ru", "nu", "pu", "lc", "nfe", "ubers", "anythinggoes", "doublesou", "monotype", "nationaldex", "nationaldexubers", "nationaldexuu", "nationaldexdoubles"],
} as const;

const argOf = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

// ── CSV 읽기·쓰기 ──
async function pokeapi(name: string): Promise<CsvRow[]> {
  const dir = argOf("--csv");
  const text = dir ? fs.readFileSync(path.join(dir, name), "utf8") : await (await fetch(`${BASE}/${name}`)).text();
  return parseCsvTable(text).rows;
}
const cell = (v: unknown): string => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function writeCsv(file: string, header: readonly string[], rows: readonly (readonly unknown[])[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n");
}
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const dataTable = <T>(file: string): Record<string, T> => {
  const raw = readJson<Record<string, T>>(path.join(DATA_DIR, file));
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_")));
};
const normName = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]/g, "");

// ── Smogon 원천 CSV 만들기 ──
function buildSmogon(dir: string): void {
  const sum = new Map<string, Map<string, number>>();
  for (const f of SMOGON_SOURCE.formats) {
    const file = path.join(dir, `gen9${f}-${argOf("--cutoff") ?? SMOGON_SOURCE.cutoff}.json`);
    const j = readJson<{ data: Record<string, { Moves?: Record<string, number> }> }>(file);
    for (const [name, d] of Object.entries(j.data)) {
      const m = sum.get(normName(name)) ?? new Map<string, number>();
      for (const [mv, c] of Object.entries(d.Moves ?? {})) m.set(mv, (m.get(mv) ?? 0) + c);
      sum.set(normName(name), m);
    }
  }
  const rows: (string | number)[][] = [];
  for (const [sp, m] of [...sum].sort((a, b) => a[0].localeCompare(b[0]))) for (const [mv, c] of [...m].sort((a, b) => b[1] - a[1])) if (mv && c > 0) rows.push([sp, mv, Math.round(c * 100) / 100]);
  writeCsv(path.join(SRC_DIR, "smogon-moves.csv"), ["species", "move", "weight"], rows);
  process.stdout.write(`Smogon ${SMOGON_SOURCE.month} 형식 ${SMOGON_SOURCE.formats.length}개 → 종 ${sum.size}, 행 ${rows.length}\n`);
}

// ── 기술 값 ──
type MoveClass = "physical" | "special" | "status";
interface StatFx { who: string; stat: string; change: number; chance: number }
interface MoveFx { charge?: boolean; recharge?: boolean; recoil?: number; halfHp?: boolean; drain?: number; rampage?: boolean; hpScale?: boolean; stats?: StatFx[]; crit?: string; status?: { kind: string | string[]; chance: number }; flinch?: number }
interface MoveVal { ko: string; en: string; type: string; class: MoveClass; power?: number; hits?: [number, number]; accuracy: number | null; priority?: number; cooldown?: number; traits?: string[]; effects?: MoveFx }

// 고르지 않는 기술 (docs/specs/moves.md "고르지 않는 기술") — 자폭기·특수 조건 기술·잠재파워
const NEVER = new Set(["dream-eater", "snore", "fake-out", "first-impression", "sucker-punch", "upper-hand", "last-resort", "belch", "steel-roller", "synchronoise", "shell-trap", "hidden-power", "self-destruct", "explosion", "misty-explosion", "final-gambit", "memento", "healing-wish", "lunar-dance"]);
// 이 게임에서 지운 기술 — 붙잡기 (2026-10-09)
const BANNED = new Set(["bind", "wrap", "fire-spin", "whirlpool", "sand-tomb", "clamp", "infestation", "magma-storm", "snap-trap", "thunder-cage"]);
// 사용률을 믿지 않는 기술 — 교체·도구·해저드 제거·확정 상태 이상 저위력·교체를 시키는 기술. 선공 공격기도 (moveOf 에서 더한다)
// 엔진에 없는 조건으로 위력이 바뀌어 사용률이 부푼 기술도 (2026-10-22 update-1022): 테라스탈(테라버스트), 방어·상대 공격으로 계산(바디프레스·속임수),
// 상태 이상이면 2배(객기·병상첨병·베놈쇼크·인페르날퍼레이드·독침천본), 도구가 없으면 2배(애크러뱃), 상대 HP 절반이면 2배(소금물), 능력 상승 비례(어시스트파워),
// 맞은 뒤·먼저 쓰면 2배(눈사태·리벤지·아가미물기·전격부리), 쓰러진 동료·맞은 횟수 비례(성묘·분노의주먹), 아군 회복(꽃가루경단)
const USE_IGNORE_IDS = ["u-turn", "volt-switch", "flip-turn", "knock-off", "thief", "covet", "rapid-spin", "mortal-spin", "pursuit", "nuzzle", "dragon-tail", "circle-throw",
  "tera-blast", "body-press", "foul-play", "facade", "hex", "venoshock", "infernal-parade", "barb-barrage", "acrobatics", "brine", "stored-power", "avalanche", "revenge", "fishious-rend", "bolt-beak", "last-respects", "rage-fist", "pollen-puff"];
const RAMPAGE = new Set(["outrage", "petal-dance", "thrash", "raging-fury"]);
const HP_SCALE = new Set(["water-spout", "eruption", "dragon-energy"]);
const HALF_HP = new Set(["steel-beam", "mind-blown", "chloroblast"]);
const CHARGE_EXTRA = new Set(["electro-shot", "focus-punch", "future-sight", "doom-desire", "beak-blast"]);
const STAT_KEY: Readonly<Record<string, string>> = { 2: "atk", 3: "def", 4: "spa", 5: "spd", 6: "spe" };
const AILMENT: Readonly<Record<string, string>> = { 1: "paralysis", 2: "sleep", 3: "freeze", 4: "burn", 5: "poison", 6: "confusion" };
const TRAIT: Readonly<Record<string, string>> = { 1: "contact", 8: "punch", 9: "sound", 16: "bite", 17: "pulse", 18: "ballistic" };
const ceil1 = (x: number): number => Math.ceil(x * 10 - 1e-9) / 10;
const expHits = (hits: readonly [number, number] | undefined, skillLink = false): number => {
  if (!hits) return 1;
  if (hits[0] === hits[1]) return hits[0];
  if (hits[1] === 10) return skillLink ? 10 : Array.from({ length: 10 }, (_, k) => 0.9 ** (k + 1)).reduce((a, b) => a + b, 0);
  return skillLink ? 5 : 3.1;
};

// ── 결정력 ──
const SKIN: Readonly<Record<string, string>> = { aerilate: "flying", pixilate: "fairy", refrigerate: "ice", galvanize: "electric" };
const WEATHER_OF: Readonly<Record<string, string>> = { drought: "sun", "desolate-land": "sun", "orichalcum-pulse": "sun", drizzle: "rain", "primordial-sea": "rain", "sand-stream": "sand", "sand-spit": "sand", "snow-warning": "snow" };
const TERRAIN_OF: Readonly<Record<string, string>> = { "electric-surge": "electric", "hadron-engine": "electric", "grassy-surge": "grassy", "seed-sower": "grassy", "psychic-surge": "psychic", "misty-surge": "misty" };
const WEATHER_TYPE: Readonly<Record<string, string>> = { sun: "fire", rain: "water", sand: "rock", snow: "ice" };
const TERRAIN_TYPE: Readonly<Record<string, string>> = { electric: "electric", grassy: "grass", psychic: "psychic", misty: "fairy" };
// 날씨·필드로 성질이 바뀌는 기술 — 이 기술은 지금 칸 1위보다 크면 그 칸을 차지한다 (docs/specs/moves.md "결정력")
const ENV_MOVE: Readonly<Record<string, readonly string[]>> = { sun: ["weather-ball", "hydro-steam", "solar-beam", "solar-blade"], rain: ["weather-ball", "electro-shot", "thunder", "hurricane"], sand: ["weather-ball"], snow: ["weather-ball", "blizzard"], electric: ["terrain-pulse", "rising-voltage", "psyblade"], grassy: ["terrain-pulse", "grassy-glide"], psychic: ["terrain-pulse", "expanding-force"], misty: ["terrain-pulse"] };
// 위력 상한 — 종족값 합 구간 → 상한. 마지막 진화체는 상한이 없다 (docs/specs/moves.md "위력 상한")
const BANDS = [65, 85, 120, Infinity] as const;
const real = (b: number): number => Math.floor(((2 * b + 31 + 63) * 50) / 100) + 5;

interface Env { w?: string; f?: string; strong: boolean; grounded: boolean }
interface Who {
  key: string;
  kind: "species" | "mega";
  types: string[];
  stats: number[];
  ability: string;
  env: Env;
  pid: string; // 습득 목록을 읽는 PokeAPI 포켓몬 번호
  listSource: string; // 자기 목록 · 같은 종 기본 모습 목록 · 기본 종 목록(메가)
  final: boolean;
  cap: number; // 종족값 구간의 위력 상한. 마지막 진화체는 이 상한 밖 기술이 결정력 × 부담으로 더 크면 그 기술로 바꾼다. 메가는 Infinity
  usage: Map<string, number> | null;
}
interface Scored {
  id: string;
  t: string; // 칸 타입 — 스킨·웨더볼·대지의파동을 반영
  cls: MoveClass;
  power: number;
  capPower: number; // 상한을 보는 기대 위력(스킬링크 없음)
  decide: number; // 결정력
  burden: number; // 부담 계수
  score: number; // 결정력 × 부담
  heavy: boolean;
  sig: boolean;
  share: number; // 믿는 사용률(0~1). 믿지 않거나 0.5% 미만이면 0
  rawShare: number;
  abilityMul: number;
  envMul: number;
}

function build(): Promise<void> {
  return (async () => {
    const smogonDir = argOf("--smogon");
    if (smogonDir) return buildSmogon(smogonDir);

    // PokeAPI
    const types = Object.fromEntries((await pokeapi("types.csv")).map((t) => [t.id!, t.identifier!]));
    const mvRows = await pokeapi("moves.csv");
    const MV = new Map(mvRows.map((m) => [m.id!, m]));
    const MID = new Map(mvRows.map((m) => [m.identifier!, m.id!]));
    const ko = new Map<string, string>(), en = new Map<string, string>();
    for (const r of await pokeapi("move_names.csv")) {
      if (r.local_language_id === "3") ko.set(r.move_id!, r.name!);
      if (r.local_language_id === "9") en.set(r.move_id!, r.name!);
    }
    const pkRows = await pokeapi("pokemon.csv");
    const PK = new Map(pkRows.map((p) => [p.identifier!, p]));
    const PKID = new Map(pkRows.map((p) => [p.id!, p]));
    const SP = new Map((await pokeapi("pokemon_species.csv")).map((s) => [s.id!, s]));
    const vgRows = await pokeapi("version_groups.csv");
    const VG_ORDER = new Map(vgRows.map((v) => [v.id!, Number(v.order)]));
    const VG_NAME = new Map(vgRows.map((v) => [v.id!, v.identifier!]));
    // 레전드 아르세우스(24)·레츠고(19)는 최신 목록으로 보지 않는다
    const SIDE_VG = new Set(["19", "24"]);
    // 배우는 방법 — level-up·egg·tutor·machine·train(챔피언스) 등 PokeAPI 이름표
    const METHOD = new Map((await pokeapi("pokemon_move_methods.csv")).map((r) => [r.id!, r.identifier!]));
    const byVg = new Map<string, Map<string, Map<string, Set<string>>>>(); // 포켓몬 → 작품 → 기술 → 방법
    const byVgSide = new Map<string, Map<string, Set<string>>>();
    const fam = new Map<string, Set<string>>(); // 기술 → 배우는 진화 계열
    for (const r of await pokeapi("pokemon_moves.csv")) {
      const pid = r.pokemon_id!, vg = r.version_group_id!, mid = r.move_id!;
      if (SIDE_VG.has(vg)) {
        const g = byVgSide.get(pid) ?? new Map<string, Set<string>>();
        g.set(vg, (g.get(vg) ?? new Set()).add(mid));
        byVgSide.set(pid, g);
      } else {
        const g = byVg.get(pid) ?? new Map<string, Map<string, Set<string>>>();
        const v = g.get(vg) ?? new Map<string, Set<string>>();
        v.set(mid, (v.get(mid) ?? new Set()).add(METHOD.get(r.pokemon_move_method_id!) ?? r.pokemon_move_method_id!));
        g.set(vg, v);
        byVg.set(pid, g);
      }
      const chain = SP.get(PKID.get(pid)?.species_id ?? "")?.evolution_chain_id ?? "";
      fam.set(mid, (fam.get(mid) ?? new Set()).add(chain));
    }
    const latestVg = (pid: string): string | undefined => [...(byVg.get(pid)?.keys() ?? [])].sort((a, b) => (VG_ORDER.get(b) ?? 0) - (VG_ORDER.get(a) ?? 0))[0];
    const flags = new Map<string, Set<string>>();
    for (const r of await pokeapi("move_flag_map.csv")) flags.set(r.move_id!, (flags.get(r.move_id!) ?? new Set()).add(r.move_flag_id!));
    const meta = new Map((await pokeapi("move_meta.csv")).map((r) => [r.move_id!, r]));
    const statCh = new Map<string, CsvRow[]>();
    for (const r of await pokeapi("move_meta_stat_changes.csv")) statCh.set(r.move_id!, [...(statCh.get(r.move_id!) ?? []), r]);
    const statsOf = new Map<string, number[]>();
    for (const r of await pokeapi("pokemon_stats.csv")) {
      const a = statsOf.get(r.pokemon_id!) ?? [];
      a[Number(r.stat_id) - 1] = Number(r.base_stat);
      statsOf.set(r.pokemon_id!, a);
    }

    // 저장소
    const MOVES = dataTable<MoveVal>("moves.json");
    const SPECIES = dataTable<{ dex: number; types: string[]; bst: number; stats: number[] }>("species.defaults.json");
    const SPECIES_MOVES = dataTable<{ moves: (string | { id: string })[]; candidates?: string[]; special?: string }>("species-moves.json");
    const MEGA_MOVES = dataTable<{ moves: string[]; candidates?: string[] }>("mega-moves.json");
    const ABILITY = dataTable<string>("species-abilities.json");
    const MEGA = readJson<{ forms: Record<string, { base: string; types: string[] }> }>(path.join(DATA_DIR, "mega.json")).forms;
    const MEGA_BATTLE = dataTable<{ stats: number[]; ability: string }>("mega-battle.json");
    const FORM_BATTLE = dataTable<{ stats: number[]; types?: string[] }>("form-battle.json");
    const REGIONAL = readJson<{ forms?: Record<string, { pokemonId?: number }>; edges?: Record<string, unknown[]> }>(path.join(DATA_DIR, "regional.json"));
    const EVO = dataTable<unknown[]>("evo.json");
    const REP = readJson<Record<string, string[]>>(path.join(SRC_DIR, "representative.json"));
    const NOT_SIG = new Set(readJson<string[]>(path.join(SRC_DIR, "not-signature.json")));
    const usageRows = parseCsvTable(fs.readFileSync(path.join(SRC_DIR, "smogon-moves.csv"), "utf8")).rows;
    const USAGE = new Map<string, Map<string, number>>();
    for (const r of usageRows) USAGE.set(r.species!, (USAGE.get(r.species!) ?? new Map<string, number>()).set(r.move!, Number(r.weight)));
    const isFinal = (k: string): boolean => !(EVO[k]?.length) && !(REGIONAL.edges?.[k]?.length);

    // 기술 값 — 저장소 moves.json 을 먼저, 없으면 CSV 에서 같은 형식으로
    const fresh: Record<string, MoveVal> = {};
    function csvMove(id: string): MoveVal | null {
      const mid = MID.get(id);
      const m = mid ? MV.get(mid) : undefined;
      if (!m || !mid) return null;
      const mt = meta.get(mid);
      const cls: MoveClass = m.damage_class_id === "2" ? "physical" : m.damage_class_id === "3" ? "special" : "status";
      const o: MoveVal = { ko: ko.get(mid) ?? id, en: en.get(mid) ?? id, type: types[m.type_id!] ?? "normal", class: cls, accuracy: m.accuracy ? Number(m.accuracy) : null };
      if (Number(m.power) > 0) o.power = Number(m.power);
      if (mt && Number(mt.max_hits) > 1) o.hits = [Number(mt.min_hits), Number(mt.max_hits)];
      if (Number(m.priority) > 0) o.priority = Number(m.priority);
      const fx: MoveFx = {};
      const fl = flags.get(mid);
      if (fl?.has("2") || CHARGE_EXTRA.has(id)) fx.charge = true;
      if (fl?.has("3")) fx.recharge = true;
      const drain = Number(mt?.drain ?? 0);
      if (HALF_HP.has(id)) fx.halfHp = true;
      else if (drain < 0) fx.recoil = -drain;
      if (drain > 0) fx.drain = drain;
      if (RAMPAGE.has(id)) fx.rampage = true;
      if (HP_SCALE.has(id)) fx.hpScale = true;
      const st = (statCh.get(mid) ?? []).filter((s) => STAT_KEY[s.stat_id!]).map((s) => ({ who: mt?.meta_category_id === "7" ? "self" : "target", stat: STAT_KEY[s.stat_id!]!, change: Number(s.change), chance: Number(mt?.stat_chance) || 100 }));
      if (st.length) fx.stats = st;
      if (Number(mt?.crit_rate) >= 6) fx.crit = "always";
      else if (Number(mt?.crit_rate) >= 1) fx.crit = "high";
      const ail = AILMENT[mt?.meta_ailment_id ?? ""];
      if (ail && (Number(mt?.ailment_chance) > 0 || mt?.meta_category_id === "4")) fx.status = { kind: ail, chance: Number(mt?.ailment_chance) || 100 };
      if (Number(mt?.flinch_chance) > 0) fx.flinch = Number(mt?.flinch_chance);
      if (cls !== "status" && o.power) {
        const selfDrop = (fx.stats ?? []).filter((s) => s.who === "self" && s.change < 0).reduce((a, s) => a - s.change, 0);
        let cd = Math.max(2, ceil1(((o.power * expHits(o.hits)) / 15) * 0.9 ** selfDrop));
        if (o.priority) cd = ceil1(cd * 0.8);
        o.cooldown = cd;
      }
      const traits = [...(fl ?? [])].map((f) => TRAIT[f]).filter((t): t is string => !!t).sort();
      if (traits.length) o.traits = traits;
      if (Object.keys(fx).length) o.effects = fx;
      return o;
    }
    const csvCache = new Map<string, MoveVal | null>();
    const moveOf = (id: string): MoveVal | null => MOVES[id] ?? (csvCache.has(id) ? csvCache.get(id)! : (csvCache.set(id, csvMove(id)), csvCache.get(id)!));
    const useIgnore = (id: string, mv: MoveVal): boolean => USE_IGNORE_IDS.includes(id) || ((mv.priority ?? 0) > 0 && (mv.power ?? 0) > 0);

    // 특성 보정·부담 계수
    const has = (mv: MoveVal, t: string): boolean => (mv.traits ?? []).includes(t);
    const sideFx = (mv: MoveVal): boolean => !!(mv.effects?.status || mv.effects?.flinch || (mv.effects?.stats ?? []).some((s) => (s.who === "target" && s.change < 0) || (s.who === "self" && s.change > 0)));
    function abilityMul(ab: string, id: string, mv: MoveVal, t: string, stab: boolean, skinned: boolean): number {
      if (skinned) return 1.2;
      switch (ab) {
        case "strong-jaw": return has(mv, "bite") ? 1.5 : 1;
        case "iron-fist": return has(mv, "punch") ? 1.2 : 1;
        case "mega-launcher": return has(mv, "pulse") ? 1.5 : 1;
        case "sharpness": return has(mv, "slicing") ? 1.5 : 1;
        case "tough-claws": return has(mv, "contact") ? 1.3 : 1;
        case "punk-rock": return has(mv, "sound") ? 1.3 : 1;
        case "technician": return (mv.power ?? 0) <= 60 ? 1.5 : 1;
        case "reckless": return mv.effects?.recoil || ["high-jump-kick", "jump-kick", "axe-kick", "supercell-slam"].includes(id) ? 1.2 : 1;
        case "adaptability": return stab ? 2 / 1.5 : 1;
        case "huge-power": case "pure-power": return mv.class === "physical" ? 2 : 1;
        case "gorilla-tactics": return mv.class === "physical" ? 1.5 : 1;
        case "steelworker": case "steely-spirit": return t === "steel" ? 1.5 : 1;
        case "dragons-maw": return t === "dragon" ? 1.5 : 1;
        case "rocky-payload": return t === "rock" ? 1.5 : 1;
        case "transistor": return t === "electric" ? 1.3 : 1;
        case "water-bubble": return t === "water" ? 2 : 1;
        case "sheer-force": return sideFx(mv) ? 1.3 : 1;
        case "parental-bond": return mv.hits ? 1 : 1.25;
        case "orichalcum-pulse": return mv.class === "physical" ? 4 / 3 : 1;
        case "hadron-engine": return mv.class === "special" ? 4 / 3 : 1;
        default: return 1;
      }
    }
    function effectValue(mv: MoveVal, ab: string): number {
      if (ab === "sheer-force" && sideFx(mv)) return 0;
      const k = ab === "serene-grace" ? 2 : 1;
      const p = (c: number): number => Math.min(1, (c / 100) * k);
      let v = 0;
      for (const s of mv.effects?.stats ?? []) {
        if (s.who === "self" && s.change > 0) v += s.change * (s.stat === "atk" || s.stat === "spa" ? 0.1 : s.stat === "spe" ? 0.05 : 0.03) * p(s.chance);
        if (s.who === "target" && s.change < 0) v += -s.change * 0.05 * p(s.chance);
      }
      const st = mv.effects?.status;
      if (st) {
        const kinds = Array.isArray(st.kind) ? st.kind : [st.kind];
        v += (kinds.reduce((a, kd) => a + (kd === "freeze" || kd === "sleep" ? 0.2 : kd === "confusion" ? 0.05 : 0.1), 0) / kinds.length) * p(st.chance);
      }
      if (mv.effects?.flinch) v += 0.03 * p(mv.effects.flinch);
      return v;
    }
    function burden(id: string, mv: MoveVal, ab: string, env: Env): { f: number; heavy: boolean } {
      const e = mv.effects ?? {};
      let f = 1;
      let heavy = false;
      const noCharge = (env.w === "sun" && ["solar-beam", "solar-blade"].includes(id)) || (env.w === "rain" && id === "electro-shot");
      if (e.charge && !noCharge) { f *= 0.5; heavy = true; }
      if (e.recharge) { f *= 0.5; heavy = true; }
      if (e.halfHp) { f *= 0.5; heavy = true; }
      else if (e.recoil && ab !== "rock-head") f *= 1 - e.recoil / 100;
      f *= 0.9 ** (e.stats ?? []).filter((s) => s.who === "self" && s.change < 0).reduce((a, s) => a - s.change, 0);
      if (e.rampage) f *= 0.6;
      if (e.hpScale) f *= 0.6;
      const sure = (env.w === "rain" && ["thunder", "hurricane"].includes(id)) || (env.w === "snow" && id === "blizzard");
      if (mv.accuracy && ab !== "no-guard" && !sure) {
        let acc = mv.accuracy;
        if (env.w === "sun" && ["thunder", "hurricane"].includes(id)) acc = 50;
        if (ab === "compound-eyes") acc *= 1.3;
        if (ab === "victory-star") acc *= 1.1;
        if (ab === "hustle" && mv.class === "physical") acc *= 0.8;
        acc = Math.min(100, acc);
        f *= (acc / 100) ** 1.5;
      }
      let pri = Math.min(2, Math.max(0, (mv.priority ?? 0) + (env.f === "grassy" && env.grounded && id === "grassy-glide" ? 1 : 0)));
      if (ab === "triage" && e.drain) pri = 2;
      if (env.f === "psychic" && pri > 0) return { f: 0, heavy }; // 사이코필드에서는 선공기가 실패한다
      if (pri > 0) f *= 1 + 0.15 * pri;
      const p0 = 1 / 24;
      const pc = e.crit === "always" ? 1 : e.crit === "high" ? 1 / 8 : p0;
      const pcAb = ab === "super-luck" ? (pc === p0 ? 1 / 8 : pc === 1 / 8 ? 1 / 2 : pc) : pc;
      const cm = ab === "sniper" ? 2.25 : 1.5;
      f *= (1 + pcAb * (cm - 1)) / (1 + p0 * (cm - 1));
      f *= 1 + effectValue(mv, ab);
      return { f, heavy };
    }
    function score(id: string, who: Who): Scored | null {
      const mv = moveOf(id);
      if (!mv || mv.class === "status" || !((mv.power ?? 0) > 0)) return null;
      const { ability: ab, env } = who;
      let t = mv.type;
      const skinned = !!SKIN[ab] && t === "normal";
      if (skinned) t = SKIN[ab]!;
      let power = mv.power!;
      if (id === "weather-ball" && env.w) { t = WEATHER_TYPE[env.w]!; power = 100; }
      if (id === "terrain-pulse" && env.f && env.grounded) { t = TERRAIN_TYPE[env.f]!; power = 100; }
      if (id === "rising-voltage" && env.f === "electric") power = 140;
      if (id === "expanding-force" && env.f === "psychic" && env.grounded) power = 120;
      if (id === "psyblade" && env.f === "electric") power = 120;
      const stab = who.types.includes(t);
      let envMul = 1;
      if (env.w === "sun") envMul *= t === "fire" ? 1.3 : t === "water" ? (id === "hydro-steam" ? 1.3 : env.strong ? 0 : 0.5) : 1;
      if (env.w === "rain") envMul *= t === "water" ? 1.3 : t === "fire" ? (env.strong ? 0 : 0.5) : 1;
      if (env.f && env.grounded && t === TERRAIN_TYPE[env.f] && env.f !== "misty") envMul *= 1.3;
      if (env.f === "misty" && t === "dragon") envMul *= 0.5;
      if (env.f === "grassy" && ["earthquake", "bulldoze", "magnitude"].includes(id)) envMul *= 0.5;
      const am = abilityMul(ab, id, mv, t, stab, skinned);
      const stat = real(who.stats[mv.class === "physical" ? 1 : 3] ?? 0);
      const decide = stat * power * expHits(mv.hits, ab === "skill-link") * (stab ? 1.5 : 1) * am * envMul;
      const { f, heavy } = burden(id, mv, ab, env);
      const tot = who.usage ? [...who.usage.values()].reduce((a, b) => a + b, 0) : 0;
      const rawShare = who.usage && tot ? (who.usage.get(normName(id)) ?? 0) / tot : 0;
      const share = useIgnore(id, mv) || rawShare < 0.005 ? 0 : rawShare;
      return { id, t, cls: mv.class, power: mv.power!, capPower: Math.round(power * expHits(mv.hits)), decide: Math.round(decide), burden: Math.round(f * 1000) / 1000, score: Math.round(decide * f), heavy, sig: (fam.get(MID.get(id) ?? "")?.size ?? 0) === 1 && !NOT_SIG.has(id), share, rawShare, abilityMul: am, envMul };
    }
    const envOf = (ab: string, tys: readonly string[]): Env => ({ w: WEATHER_OF[ab], f: TERRAIN_OF[ab], strong: ab === "primordial-sea" || ab === "desolate-land", grounded: !tys.includes("flying") && ab !== "levitate" });
    const envMove = (env: Env, id: string): boolean => (ENV_MOVE[env.w ?? ""] ?? []).includes(id) || (env.grounded && (ENV_MOVE[env.f ?? ""] ?? []).includes(id));

    // 종 키 → PokeAPI 포켓몬
    function resolve(key: string): CsvRow | undefined {
      const rid = REGIONAL.forms?.[key]?.pokemonId;
      if (rid) return PKID.get(String(rid));
      if (PK.has(key)) return PK.get(key);
      const pre = [...PK.keys()].find((i) => i.startsWith(key + "-"));
      if (pre) return PK.get(pre);
      let k = key;
      while (k.includes("-")) {
        k = k.slice(0, k.lastIndexOf("-"));
        if (PK.has(k)) return PK.get(k);
      }
      return undefined;
    }
    const learnOf = (p: CsvRow): { pid: string; same: boolean } => {
      if (byVg.has(p.id!)) return { pid: p.id!, same: true };
      const def = pkRows.find((q) => q.species_id === p.species_id && q.is_default === "1");
      return { pid: def?.id ?? p.id!, same: false };
    };

    // 위력 상한 — 도감 순서로 계산하고 진화한 종은 진화 전보다 낮지 않다
    const tierOfSpecies = new Map<string, number>();
    const STRONG = new Set(["wishiwashi", "minior", "aegislash", "palafin", "terapagos"]);
    const keys = Object.keys(SPECIES).sort((a, b) => SPECIES[a]!.dex - SPECIES[b]!.dex || Number(a.includes("-")) - Number(b.includes("-")));

    const whos: Who[] = [];
    const skipped: string[] = [];
    for (const key of keys) {
      const d = SPECIES[key]!;
      const p = resolve(key);
      if (!p) { skipped.push(`${key}: PokeAPI 없음`); continue; }
      const strong = STRONG.has(key) || /^minior-.*-meteor$/.test(key);
      const stats = strong && FORM_BATTLE[key] ? FORM_BATTLE[key]!.stats : d.stats;
      const bst = stats.reduce((a, b) => a + b, 0);
      const hi = Math.max(stats[1] ?? 0, stats[3] ?? 0);
      let tier = (bst <= 350 ? 0 : bst < 480 ? 1 : bst < 600 ? 2 : 3) + (hi >= 120 ? 1 : hi <= 55 ? -1 : 0);
      tier = Math.max(0, Math.min(3, tier));
      const prev = SP.get(p.species_id!)?.evolves_from_species_id;
      const prevTier = prev ? tierOfSpecies.get(prev) : undefined;
      if (prevTier !== undefined) tier = Math.max(tier, prevTier);
      if (!tierOfSpecies.has(p.species_id!)) tierOfSpecies.set(p.species_id!, tier);
      const ab = ABILITY[key] ?? "";
      const { pid, same } = learnOf(p);
      const final = isFinal(key);
      whos.push({ key, kind: "species", types: d.types, stats, ability: ab, env: envOf(ab, d.types), pid, listSource: same ? "자기 목록" : "같은 종 기본 모습 목록", final, cap: BANDS[tier]!, usage: USAGE.get(normName(key)) ?? USAGE.get(normName(p.identifier!)) ?? null });
    }
    for (const [slug, f] of Object.entries(MEGA)) {
      const mb = MEGA_BATTLE[slug];
      const p = resolve(f.base);
      if (!mb || !p) { skipped.push(`${slug}: 배틀 값 또는 PokeAPI 없음`); continue; }
      const { pid } = learnOf(p);
      whos.push({ key: slug, kind: "mega", types: f.types, stats: mb.stats, ability: mb.ability, env: envOf(mb.ability, f.types), pid, listSource: "기본 종 목록(메가)", final: true, cap: Infinity, usage: USAGE.get(normName(slug)) ?? null });
    }

    // ── 고르기 ──
    const ok = (id: string): boolean => !NEVER.has(id) && !BANNED.has(id);
    const learnRows: unknown[][] = [];
    const powerRows: unknown[][] = [];
    const pickRows: unknown[][] = [];
    const result: Record<string, { moves: string[]; candidates?: string[] }> = {};
    for (const who of whos) {
      const vg = latestVg(who.pid);
      // 목록 — 최신 작품 하나(규칙). --all-games 는 모든 본편 작품, --with-prevo 는 진화 전 종의 목록도 합친다
      const pids = [who.pid];
      if (process.argv.includes("--with-prevo")) {
        let sp = SP.get(PKID.get(who.pid)?.species_id ?? "")?.evolves_from_species_id;
        while (sp) {
          const def = pkRows.find((q) => q.species_id === sp && q.is_default === "1");
          if (def) pids.push(def.id!);
          sp = SP.get(sp)?.evolves_from_species_id;
        }
      }
      const list = new Map<string, Set<string>>();
      for (const pid of pids) {
        const g = byVg.get(pid);
        const vgs = process.argv.includes("--all-games") ? [...(g?.keys() ?? [])] : [latestVg(pid)].filter((v): v is string => !!v);
        for (const v of vgs) for (const [mid, ms] of g?.get(v) ?? []) list.set(mid, new Set([...(list.get(mid) ?? []), ...[...ms].map((m) => (pid === who.pid ? m : `${m}(진화 전)`))]));
      }
      const ids = [...list.keys()].map((mid) => MV.get(mid)?.identifier ?? "").filter((id) => id && ok(id));
      const scored = ids.map((id) => score(id, who)).filter((x): x is Scored => !!x);
      for (const x of scored) {
        learnRows.push([who.key, who.kind, PKID.get(who.pid)?.identifier, who.listSource, VG_NAME.get(vg ?? ""), x.id, [...(list.get(MID.get(x.id) ?? "") ?? [])].join("/")]);
        powerRows.push([who.key, x.id, moveOf(x.id)?.type, x.t, x.cls, x.power, x.capPower, who.stats[x.cls === "physical" ? 1 : 3], who.types.includes(x.t) ? 1 : 0, Math.round(x.abilityMul * 1000) / 1000, x.envMul, x.decide, x.burden, x.score, x.heavy ? 1 : 0, x.sig ? 1 : 0, Math.round(x.rawShare * 10000) / 10000, x.share > 0 ? 1 : 0, Number.isFinite(who.cap) ? who.cap : "", MOVES[x.id] ? "" : "새 기술"]);
      }
      const byScore = (a: Scored, b: Scored): number => b.score - a.score;
      const byUse = (a: Scored, b: Scored): number => b.share - a.share || byScore(a, b);
      const picks: { x: Scored; why: string }[] = [];
      const picked = (x: Scored): boolean => picks.some((y) => y.x.id === x.id);
      // 1 공격 전용기 하나 + 대표기술 — 무거운 기술은 넣지 않는다
      const fixed: { x: Scored; why: string }[] = [];
      const sig = scored.filter((x) => x.sig && !x.heavy).sort(byScore)[0];
      if (sig) fixed.push({ x: sig, why: "전용기" });
      for (const id of REP[who.key] ?? []) {
        const x = scored.find((y) => y.id === id && !y.heavy);
        if (x && !fixed.some((y) => y.x.id === id)) fixed.push({ x, why: "대표기술" });
      }
      const slots: (string | null)[] = who.types.length > 1 ? [...who.types] : [who.types[0]!, who.types[0]!];
      let free = 0;
      for (const f of fixed.slice(0, 2)) {
        const i = slots.indexOf(f.x.t);
        if (i >= 0) slots[i] = null;
        else { slots[slots.findIndex((s) => s)] = null; free++; }
        picks.push(f);
      }
      // 2 남은 칸 — 칸 타입의 무겁지 않은 공격기. 사용률 순(상한 안) → 결정력 × 부담. 마지막 진화체는 상한 밖 기술이 더 크면 바꾼다
      const auto = (t: string): { x: Scored; why: string }[] => {
        let pool = scored.filter((x) => x.t === t && !x.heavy && !x.sig && !picked(x));
        let why = "자동";
        if (!pool.length) {
          const older = [...(byVg.get(who.pid)?.entries() ?? [])].filter(([v]) => (VG_ORDER.get(v) ?? 0) < (VG_ORDER.get(vg ?? "") ?? 0)).sort((a, b) => (VG_ORDER.get(b[0]) ?? 0) - (VG_ORDER.get(a[0]) ?? 0));
          const side = [...(byVgSide.get(who.pid)?.entries() ?? [])].map(([v, s]) => [v, new Map([...s].map((m) => [m, new Set<string>()]))] as const);
          for (const [v, set] of [...older, ...side]) {
            pool = [...set.keys()].map((mid) => MV.get(mid)?.identifier ?? "").filter((id) => id && ok(id)).map((id) => score(id, who)).filter((x): x is Scored => !!x && x.t === t && !x.heavy && !x.sig && !picked(x));
            if (pool.length) { why = `전 작품(${VG_NAME.get(v)})`; break; }
          }
        }
        let keep = pool.filter((x) => x.capPower <= who.cap).sort(byUse);
        const out = pool.filter((x) => x.capPower > who.cap).sort(who.final ? byScore : (a, b) => a.capPower - b.capPower || byScore(a, b));
        if (who.env.w || who.env.f) {
          const chal = pool.filter((x) => envMove(who.env, x.id) && (who.final || x.capPower <= who.cap)).sort(byScore)[0];
          if (chal && (!keep[0] || chal.score > keep[0].score)) keep = [chal, ...keep.filter((x) => x !== chal)];
        }
        const first = who.final && out[0] && (!keep[0] || out[0].score > keep[0].score) ? [out[0], ...keep, ...out.slice(1)] : [...keep, ...out];
        return first.map((x) => ({ x, why: x.share > 0 && x === keep[0] ? `${why}·사용률` : why }));
      };
      const remaining = slots.filter((s): s is string => !!s);
      if (free && remaining.length === 1 && who.types.length > 1) {
        const c = [auto(who.types[0]!)[0], auto(who.types[1]!)[0]].filter((y): y is { x: Scored; why: string } => !!y).sort((a, b) => byScore(a.x, b.x))[0];
        if (c) picks.push(c);
      } else {
        for (const t of remaining) {
          let c = auto(t).find((y) => !picked(y.x));
          // 그 타입에 무겁지 않은 공격기가 없으면 다른 자기 타입, 그래도 없으면 무거운 기술
          if (!c) {
            const alt = scored.filter((x) => who.types.includes(x.t) && !x.heavy && !picked(x)).sort(byScore)[0];
            const heavy = scored.filter((x) => x.t === t && !picked(x)).sort(byScore)[0];
            c = alt ? { x: alt, why: "다른 자기 타입" } : heavy ? { x: heavy, why: "무거운 기술뿐" } : undefined;
          }
          if (c) picks.push(c);
        }
      }
      // 지금 기본 2개를 둔다(--keep-base) — 두 칸 모두 이번 목록에 있고 무겁지 않으며 칸 타입 규칙에 맞을 때
      if (process.argv.includes("--keep-base") && who.kind === "species") {
        const cur = (SPECIES_MOVES[who.key]?.moves ?? []).map((c) => (typeof c === "string" ? c : c.id)).map((id) => scored.find((x) => x.id === id));
        const ts = cur.map((x) => x?.t ?? "");
        const slotOk = who.types.length > 1 ? ts.filter((t) => !who.types.includes(t)).length <= 1 && (ts[0] !== ts[1] || !who.types.includes(ts[0] ?? "")) : ts.filter((t) => t !== who.types[0]).length <= 1;
        if (cur.length === 2 && cur.every((x) => x && !x.heavy) && slotOk) picks.splice(0, picks.length, ...cur.map((x) => ({ x: x!, why: "지금 값" })));
      }
      // 3 후보 4개 — 마지막 진화체만. 자기 타입 3개(한 타입 2개까지, 남은 공격 전용기 먼저) + 다른 타입 1개
      const cand: { x: Scored; why: string }[] = [];
      if (who.final) {
        const rest = scored.filter((x) => !picked(x) && x.score > 0);
        const order = (group: Scored[]): Scored[] => {
          const top = Math.max(0, ...group.map((x) => x.score));
          const keepers = group.filter((x) => x.score >= top * 0.7).sort(byUse);
          return [...keepers, ...group.filter((x) => x.score < top * 0.7).sort(byScore)];
        };
        const own = rest.filter((x) => who.types.includes(x.t));
        const ownOrder = [...own.filter((x) => x.sig).sort(byScore), ...order(own.filter((x) => !x.sig))];
        const per = new Map<string, number>();
        for (const x of ownOrder) {
          if (cand.length >= 3) break;
          if (who.types.length > 1 && (per.get(x.t) ?? 0) >= 2) continue;
          per.set(x.t, (per.get(x.t) ?? 0) + 1);
          cand.push({ x, why: x.sig ? "전용기" : x.share > 0 ? "사용률" : "결정력" });
        }
        const other = order(rest.filter((x) => !who.types.includes(x.t)))[0];
        if (other) cand.push({ x: other, why: other.share > 0 ? "다른 타입·사용률" : "다른 타입·결정력" });
        // 개굴닌자 세 모습 — 아쿠아브레이크 자리에 물수리검 (docs/specs/moves.md "기술 고르기" 예외)
        if (who.key.startsWith("greninja")) {
          const ws = scored.find((x) => x.id === "water-shuriken");
          const i = cand.findIndex((y) => y.x.id === "liquidation");
          if (ws && !cand.some((y) => y.x.id === ws.id)) {
            if (i >= 0) cand[i] = { x: ws, why: "예외(물수리검)" };
            else { const j = cand.map((y) => y.x.t).lastIndexOf("water"); if (j >= 0) cand[j] = { x: ws, why: "예외(물수리검)" }; }
          }
        }
      }
      picks.forEach((y, i) => pickRows.push([who.key, who.kind, `기본${i + 1}`, y.x.id, y.x.t, y.x.score, Math.round(y.x.share * 1000) / 10, y.why]));
      cand.forEach((y, i) => pickRows.push([who.key, who.kind, `후보${i + 1}`, y.x.id, y.x.t, y.x.score, Math.round(y.x.share * 1000) / 10, y.why]));
      result[who.key] = { moves: picks.map((y) => y.x.id), ...(cand.length ? { candidates: cand.map((y) => y.x.id) } : {}) };
      for (const y of [...picks, ...cand]) if (!MOVES[y.x.id]) fresh[y.x.id] = moveOf(y.x.id)!;
    }

    writeCsv(path.join(SRC_DIR, "learnset.csv"), ["key", "kind", "pokeapi", "list_source", "version_group", "move", "method"], learnRows);
    writeCsv(path.join(SRC_DIR, "power.csv"), ["key", "move", "move_type", "slot_type", "class", "power", "cap_power", "base_stat", "stab", "ability_mul", "env_mul", "decide", "burden", "score", "heavy", "signature", "usage_share", "usage_trusted", "power_cap", "note"], powerRows);
    writeCsv(path.join(SRC_DIR, "picks.csv"), ["key", "kind", "slot", "move", "slot_type", "score", "usage_pct", "why"], pickRows);

    // ── 지금 데이터와 견주기 ──
    const idsOf = (c: readonly (string | { id: string })[] | undefined): string[] => (c ?? []).map((x) => (typeof x === "string" ? x : x.id));
    const keepRow = (k: string): boolean => !!SPECIES_MOVES[k]?.special || (SPECIES_MOVES[k]?.moves ?? []).some((c) => typeof c !== "string");
    let baseDiff = 0, candDiff = 0, kept = 0;
    const diffLines: string[] = [];
    const usageCount = whos.filter((w) => w.usage).length;
    for (const who of whos) {
      const cur = who.kind === "mega" ? MEGA_MOVES[who.key] : SPECIES_MOVES[who.key];
      if (who.kind === "species" && keepRow(who.key)) { kept++; continue; }
      const now = result[who.key]!;
      const cb = new Set(idsOf(cur?.moves)), cc = new Set(cur?.candidates ?? []);
      const bd = now.moves.length !== cb.size || now.moves.some((m) => !cb.has(m));
      const cd = (now.candidates ?? []).length !== cc.size || (now.candidates ?? []).some((m) => !cc.has(m));
      if (bd) baseDiff++;
      if (cd) candDiff++;
      if (bd || cd) diffLines.push(`${who.key}${who.usage ? "" : " (사용률 없음)"}\n  지금: ${idsOf(cur?.moves).join("·")} / ${(cur?.candidates ?? []).join("·")}\n  도구: ${now.moves.join("·")} / ${(now.candidates ?? []).join("·")}`);
    }
    const head = [`모습 ${whos.length}(종 ${whos.filter((w) => w.kind === "species").length}, 메가 ${whos.filter((w) => w.kind === "mega").length}), 사용률 읽힘 ${usageCount}, 없음 ${whos.length - usageCount}`, `손 예외로 지금 값을 두는 종 ${kept}`, `기본 2개가 다른 줄 ${baseDiff}, 후보가 다른 줄 ${candDiff}`, `새 기술 ${Object.keys(fresh).length}: ${Object.keys(fresh).join(" ")}`, `계산 못 한 모습: ${skipped.join("; ") || "없음"}`];
    fs.writeFileSync(path.join(SRC_DIR, "diff.txt"), [...head, "", ...diffLines].join("\n") + "\n");
    process.stdout.write(head.join("\n") + "\n");

    if (process.argv.includes("--apply")) {
      const sm = readJson<Record<string, unknown>>(path.join(DATA_DIR, "species-moves.json"));
      for (const who of whos) if (who.kind === "species" && !keepRow(who.key)) sm[who.key] = { ...(SPECIES_MOVES[who.key] ?? {}), ...result[who.key] };
      writeLineJson(path.join(DATA_DIR, "species-moves.json"), sm);
      const mm = readJson<Record<string, unknown>>(path.join(DATA_DIR, "mega-moves.json"));
      for (const who of whos) if (who.kind === "mega") mm[who.key] = result[who.key];
      writeLineJson(path.join(DATA_DIR, "mega-moves.json"), mm);
      const mv = readJson<Record<string, unknown>>(path.join(DATA_DIR, "moves.json"));
      for (const [id, v] of Object.entries(fresh)) mv[id] = v;
      writeLineJson(path.join(DATA_DIR, "moves.json"), mv);
      process.stdout.write("data/species-moves.json · mega-moves.json · moves.json 에 썼다\n");
    }
  })();
}

runBuild(build);
