// 포켓몬 초상 — PokeAPI sprites 의 기본 그림(96 × 96 PNG)을 받아 캐시하고 화면에 data URI 로 준다
//
// 출처는 https://github.com/PokeAPI/sprites 다(저장소 CC0, 그림 저작권은 The Pokémon Company). 2026-09-25 사용자 지시로 PMD 초상에서 바꿨다.
// 저장소에는 넣지 않고 받는 사람 컴퓨터에 캐시한다 (docs/specs/companion.md "설정창의 초상").
// 경로: sprites/pokemon/<도감>.png, 이로치는 sprites/pokemon/shiny/<도감>.png. 이로치 그림이 없으면 보통 그림을 쓴다.
// 캐시: ~/.claude/pokebuddy/sprites/<4자리>.png · <4자리>-shiny.png. 못 받은 종은 이 프로세스가 끝날 때까지 다시 받지 않는다.
// 리전폼(src/dex/regional.ts)은 도감 번호 대신 PokeAPI 포켓몬 번호(10100 — 알로라 라이츄)로 받는다. 파일은 10100.png 라 4자리 파일과 겹치지 않는다.
// 리전폼 그림을 못 받으면 기본형 번호 그림을 쓴다.
// 도구·알 그림(icons)도 같은 저장소에서 받는다: sprites/items/<식별자>.png, sprites/pokemon/egg.png. 없으면(404) 빈 칸이다.
// 설치 파일에는 그림을 넣지 않는다 — 그림 저작권은 The Pokémon Company 에 있어 공개 릴리스로 재배포하지 않는다(2026-09-26 사용자 결정).
// 대신 동반자가 켜질 때 빠진 그림을 뒤에서 모두 받아 캐시에 둔다(prefetch). 첫 실행이면 첫 포켓몬을 고르는 동안 받는다.
// 앱 안 sprites/ 가 있으면(저장소 실행의 .cache/sprites) 그곳을 먼저 본다.
// 관리 창·선택 창의 CSP 는 img-src data: 만 허용한다. 그래서 파일 경로가 아니라 data URI 로 준다
import fs from "node:fs";
import path from "node:path";
import { profile, slugs } from "../dex/species.js";
import { regionalOf } from "../dex/regional.js";
import { megaOf } from "../dex/mega.js";
import { loadJson, isMetaKey } from "../dex/data.js";
import { PATHS } from "./paths.js";

// 우리가 그린 도구 그림 — 원작에 없는 가상 도구(먹이·장난감·약·연결의끈)와 태고의돌. 저장소에 있고 설치본에도 들어간다.
// 네트워크보다 먼저 본다. 만드는 곳은 scripts/build-item-art.cjs, 기록은 worklog/records/item-art/record.md (2026-09-27 폰트 세션)
const OWN_ITEMS = path.join(PATHS.project, "assets", "items");
const ownItem = (id: string): string | null => {
  const file = path.join(OWN_ITEMS, `${id}.png`);
  return /^[a-z0-9-]+$/.test(id) && fs.existsSync(file) ? file : null;
};
const ownIds = (): string[] => {
  try {
    return fs.readdirSync(OWN_ITEMS).filter((n) => n.endsWith(".png")).map((n) => n.slice(0, -4));
  } catch {
    return [];
  }
};

// 도구 식별자 — 가방·상점 도구와 진화용 도구 (data/items.json · data/evo-items.json)
function itemIds(): string[] {
  const keys = [...Object.keys(loadJson<Record<string, unknown>>("items.json")), ...Object.keys(loadJson<Record<string, unknown>>("evo-items.json"))];
  return [...new Set(keys.filter((k) => !isMetaKey(k) && /^[a-z0-9-]+$/.test(k)))];
}

interface FetchModule {
  cached(file: string, url: string, validate?: (buf: Buffer) => boolean): Promise<{ buf: Buffer } | null>;
}
const { cached } = require("../../art/fetch.js") as FetchModule;

const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites";
const BASE = `${SPRITES}/pokemon`;
// 한 번에 받는 수 — 도감처럼 칸이 많아도 네트워크를 한꺼번에 쓰지 않는다
const PARALLEL = 4;
// 미리 받기의 동시 요청 수 — 그림이 작아(평균 1KB) 요청 수가 비용이다. 16 이면 2천 장이 이 연결에서 10초 안팎이었다(2026-09-26 측정)
const PREFETCH_PARALLEL = 16;
const MISSING_RETRY_MS = 15_000; // 못 받은 그림을 다시 청하기까지 — 첫 실행의 네트워크 혼잡·끊김이 영영 빈 칸으로 남지 않게

export interface PortraitAsk {
  slug: string;
  shiny: boolean;
}

// 초상 한 장의 이름 — 화면이 결과를 찾는 열쇠다
export const portraitKey = (a: PortraitAsk): string => (a.shiny ? `${a.slug}:shiny` : a.slug);

// 초상 그림 번호 — 리전폼·메가 모습이면 PokeAPI 포켓몬 번호, 아니면 도감 번호. 모르는 종은 0.
// 메가 모습의 초상이 없으면(지가르데) 기본 종의 초상이다
export function portraitIds(slug: string): number[] {
  const mega = megaOf(slug);
  const dex = profile(mega?.base ?? slug).dex;
  const form = mega?.pokemonId ?? regionalOf(slug)?.pokemonId;
  return [form, dex].filter((n): n is number => typeof n === "number" && n > 0);
}

// 받을 주소 — 도감 번호 그대로(앞의 0 없음)
export const portraitUrl = (dex: number, shiny: boolean): string => (shiny ? `${BASE}/shiny/${dex}.png` : `${BASE}/${dex}.png`);

// PokeAPI 에 없는 도구 그림 — msikma/pokesprite (코드 MIT, 그림 © Nintendo·Creatures·GAME FREAK). 32×32 로 PokeAPI 30×30 과 모양이 같다.
// 2026-09-26 폰트 세션이 조사해 넘겼다(사용자 결정).
// 민트는 한 종류라 초록 민트 한 장만 쓴다 (2026-09-29 사용자 결정 "초록색민트 이미지만 사용").
// pokesprite mint 6장의 픽셀을 받아 본 결과 초록(주색 #65c65d)은 speed.png 다. attack 빨강·defense 파랑·special-attack 하늘·special-defense 분홍·neutral 노랑
const POKESPRITE = "https://raw.githubusercontent.com/msikma/pokesprite/master/items";
const MINT_URL = `${POKESPRITE}/mint/speed.png`;
const POKESPRITE_EVO = new Set(["galarica-wreath", "galarica-cuff", "sweet-apple", "tart-apple", "cracked-pot"]);

// 메가스톤 표식의 그림 — 모든 종이 키스톤 그림을 쓴다 (2026-10-02 사용자 결정 "다 키스톤으로"). 30×30 안의 14×14 다.
// 화면은 불투명 영역만 잘라 쓴다 (src/renderer/manage.ts megaMark, src/renderer/pet.ts)
export const MEGA_STONE_ICON = "item:key-stone";

// 도구 하나의 그림 주소 — 경험사탕·민트·일부 진화 도구는 pokesprite, 나머지는 PokeAPI
export function itemUrl(id: string): string {
  const candy = /^exp-candy-(xs|s|m|l|xl)$/.exec(id);
  if (candy) return `${POKESPRITE}/exp-candy/${candy[1]}.png`;
  if (id === "mint") return MINT_URL;
  if (POKESPRITE_EVO.has(id)) return `${POKESPRITE}/evo-item/${id}.png`;
  // 빈 기술머신(기술 진화를 대신하는 도구, id 는 옛 이름 blank-cd)은 원작 기술머신 그림을 쓴다 — 2026-09-26 사용자 결정 "빈기술머신으로 사용할게 그냥"
  if (id === "blank-cd") return `${SPRITES}/items/tm-normal.png`;
  return `${SPRITES}/items/${id}.png`;
}

// 도구·알 그림의 열쇠 → 받을 주소. 열쇠는 "egg" 또는 "item:<식별자>" 다. 모르는 열쇠는 null
export function iconUrl(key: string): string | null {
  if (key === "egg") return `${BASE}/egg.png`;
  const m = /^item:([a-z0-9-]+)$/.exec(key);
  return m ? itemUrl(m[1] ?? "") : null;
}

const isPng = (buf: Buffer): boolean => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

export interface Portraits {
  get(asks: PortraitAsk[]): Promise<Record<string, string | null>>;
  icons(keys: string[]): Promise<Record<string, string | null>>; // 도구·알 그림 — iconUrl 의 열쇠
  // 디스크에 이미 있는 그림 전부 — 초상 열쇠(slug · slug:shiny)와 도구·알 열쇠. 네트워크는 쓰지 않는다
  // 관리 창이 첫 화면 전에 한 번 받아 둔다. 상점·상세에 들어갈 때 그림이 하나씩 차오르지 않게 하려는 것이다
  all(): Promise<Record<string, string>>;
  // 캐시에 없는 그림을 모두 받는다 — 보통·이로치 초상, 도구, 알. 받은 수·없는 수(404)·실패 수를 돌려준다.
  // first 의 종(보통 초상)을 맨 앞에 받는다 — 첫 실행 선택 창의 스타터
  prefetch(onProgress?: (done: number, total: number) => void, first?: string[]): Promise<{ got: number; had: number; missing: number; failed: number }>;
}

// dir 은 사용자 캐시, bundled 는 앱에 들어 있는 그림 폴더(없어도 된다). 두 폴더의 파일 이름은 같다
export function createPortraits(dir: string, bundled?: string): Portraits {
  const missing = new Map<string, number>(); // 못 받은 파일 → 시각. MISSING_RETRY_MS 동안 다시 청하지 않는다(네트워크 실패가 영영 남지 않게)
  const inflight = new Map<string, Promise<{ buf: Buffer } | null>>(); // 받는 중인 파일 — get·icons·prefetch 가 같은 파일을 두 번 받지 않는다
  const fetchOnce = (file: string, url: string): Promise<{ buf: Buffer } | null> => {
    const going = inflight.get(file);
    if (going) return going;
    const job = cached(file, url, isPng).finally(() => inflight.delete(file));
    inflight.set(file, job);
    return job;
  };
  const memo = new Map<string, string>(); // 이미 읽은 data URI
  let running = 0;
  const waiting: (() => void)[] = [];
  const slot = async <T>(job: () => Promise<T>): Promise<T> => {
    if (running >= PARALLEL) await new Promise<void>((r) => waiting.push(r));
    running++;
    try {
      return await job();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };

  // 파일 하나 — 앱에 든 그림, 캐시 순서로 읽고, 둘 다 없으면 받아 캐시에 둔다. rel 은 두 폴더 안의 이름이다
  async function fileUri(rel: string, url: string): Promise<string | null> {
    const file = path.join(dir, rel);
    const known = memo.get(file);
    if (known) return known;
    const failedAt = missing.get(file);
    if (failedAt != null && Date.now() - failedAt < MISSING_RETRY_MS) return null;
    if (bundled) {
      try {
        const buf = fs.readFileSync(path.join(bundled, rel));
        if (isPng(buf)) {
          const uri = `data:image/png;base64,${buf.toString("base64")}`;
          memo.set(file, uri);
          return uri;
        }
      } catch {
        // 앱에 없는 그림 — 캐시와 네트워크로 간다
      }
    }
    const got = await slot(() => fetchOnce(file, url));
    if (!got) {
      missing.set(file, Date.now());
      return null;
    }
    missing.delete(file);
    const uri = `data:image/png;base64,${got.buf.toString("base64")}`;
    memo.set(file, uri);
    return uri;
  }

  // 디스크에서만 읽는다 — 앱에 든 그림, 캐시 순서. 없으면 null. 비동기다 — 창을 처음 열 때 메인이 멈추지 않게
  async function diskUri(rel: string): Promise<string | null> {
    const file = path.join(dir, rel);
    const known = memo.get(file);
    if (known) return known;
    for (const root of bundled ? [bundled, dir] : [dir]) {
      try {
        const buf = await fs.promises.readFile(path.join(root, rel));
        if (!isPng(buf)) continue;
        const uri = `data:image/png;base64,${buf.toString("base64")}`;
        memo.set(file, uri);
        return uri;
      } catch {
        // 이 폴더에 없는 그림
      }
    }
    return null;
  }

  // 폴더 안 파일 이름 — 없는 폴더는 빈 목록
  const names = (sub: string): string[] => {
    const out = new Set<string>();
    for (const root of bundled ? [bundled, dir] : [dir]) {
      try {
        for (const n of fs.readdirSync(path.join(root, sub))) if (n.endsWith(".png")) out.add(n);
      } catch {
        // 폴더 없음
      }
    }
    return [...out];
  };

  // 앱 안 우리 그림 하나 — memo 를 함께 쓴다
  async function ownUri(file: string): Promise<string | null> {
    const known = memo.get(file);
    if (known) return known;
    try {
      const buf = await fs.promises.readFile(file);
      if (!isPng(buf)) return null;
      const uri = `data:image/png;base64,${buf.toString("base64")}`;
      memo.set(file, uri);
      return uri;
    } catch {
      return null;
    }
  }

  const one = (dex: number, shiny: boolean): Promise<string | null> => {
    const d = String(dex).padStart(4, "0");
    return fileUri(shiny ? `${d}-shiny.png` : `${d}.png`, portraitUrl(dex, shiny));
  };

  return {
    async get(asks) {
      const out: Record<string, string | null> = {};
      await Promise.all(
        asks.map(async (a) => {
          // 리전폼 그림 → 기본형 그림 순서. 한 번호 안에서는 이로치 → 보통 순서다
          let uri: string | null = null;
          for (const id of portraitIds(a.slug)) {
            uri = (a.shiny ? await one(id, true) : null) ?? (await one(id, false));
            if (uri) break;
          }
          out[portraitKey(a)] = uri;
        }),
      );
      return out;
    },
    async icons(keys) {
      const out: Record<string, string | null> = {};
      await Promise.all(
        keys.map(async (key) => {
          const own = key.startsWith("item:") ? ownItem(key.slice(5)) : null;
          if (own) {
            out[key] = await ownUri(own);
            return;
          }
          const url = iconUrl(key);
          out[key] = url ? await fileUri(key === "egg" ? "egg.png" : `items/${key.slice(5)}.png`, url) : null;
        }),
      );
      return out;
    },
    async prefetch(onProgress, first = []) {
      const jobs: { rel: string; url: string }[] = [];
      const firstDex = first.map((slug) => portraitIds(slug)[0] ?? 0).filter((d) => d > 0);
      for (const dex of firstDex) jobs.push({ rel: `${String(dex).padStart(4, "0")}.png`, url: portraitUrl(dex, false) });
      // 도감 번호 그림과 리전폼 그림(포켓몬 번호) 전부
      const dexes = [...new Set(slugs().flatMap((slug) => portraitIds(slug)))].sort((a, b) => a - b);
      for (const dex of dexes) {
        const d = String(dex).padStart(4, "0");
        jobs.push({ rel: `${d}.png`, url: portraitUrl(dex, false) }, { rel: `${d}-shiny.png`, url: portraitUrl(dex, true) });
      }
      jobs.push({ rel: "egg.png", url: `${BASE}/egg.png` });
      for (const id of itemIds()) if (!ownItem(id)) jobs.push({ rel: `items/${id}.png`, url: itemUrl(id) }); // 우리 그림이 있는 도구는 받지 않는다
      jobs.push({ rel: `items/${MEGA_STONE_ICON.slice(5)}.png`, url: itemUrl(MEGA_STONE_ICON.slice(5)) }); // 메가스톤 표식 — 도구 목록에 없다
      const count = { got: 0, had: 0, missing: 0, failed: 0 };
      // 그림이 없다고(404) 확인한 주소 — 켤 때마다 다시 묻지 않게 캐시 폴더에 적어 둔다.
      // 파일 이름이 아니라 주소로 적는다 — 받을 곳을 바꾸면(경험사탕·민트 → pokesprite) 새 주소로 다시 묻는다
      const missingFile = path.join(dir, "missing.json");
      let known: string[] = [];
      try {
        const raw: unknown = JSON.parse(fs.readFileSync(missingFile, "utf8"));
        if (Array.isArray(raw)) known = raw.filter((x): x is string => typeof x === "string");
      } catch {
        // 아직 없음
      }
      const absent = new Set(known);
      const before = absent.size;
      let next = 0;
      let done = 0;
      const worker = async (): Promise<void> => {
        while (next < jobs.length) {
          const job = jobs[next++];
          if (!job) break;
          const file = path.join(dir, job.rel);
          if (fs.existsSync(file) || (bundled && fs.existsSync(path.join(bundled, job.rel)))) count.had++; // 앞에 받은 first 도 여기로 온다
          else if (absent.has(job.url)) count.missing++;
          else {
            try {
              const got = await fetchOnce(file, job.url);
              if (got) count.got++;
              else {
                count.missing++; // 404 — 그림이 없는 도구 등
                absent.add(job.url);
              }
            } catch {
              count.failed++; // 네트워크 — 다음 실행에서 다시 받는다
            }
          }
          onProgress?.(++done, jobs.length);
        }
      };
      await Promise.all(Array.from({ length: PREFETCH_PARALLEL }, worker));
      if (absent.size !== before) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(missingFile, JSON.stringify([...absent].sort()));
        } catch {
          // 적지 못해도 다음에 다시 물을 뿐이다
        }
      }
      return count;
    },
    async all() {
      const out: Record<string, string> = {};
      const files = new Set(names(""));
      const read = (rel: string): Promise<string | null> => (files.has(rel) ? diskUri(rel) : Promise.resolve(null));
      await Promise.all(
        slugs().map(async (slug) => {
          // 첫 번호(리전폼이면 포켓몬 번호)만 본다 — 리전폼 그림이 아직 없으면 비워 두어 화면이 get 으로 받게 한다(기본형 대신 그림은 get 이 정한다)
          const id = portraitIds(slug)[0];
          if (!id) return;
          const d = String(id).padStart(4, "0");
          const plain = await read(`${d}.png`);
          if (!plain) return;
          out[slug] = plain;
          // 이로치 그림이 없으면 보통 그림 — get 과 같은 규칙
          out[`${slug}:shiny`] = (await read(`${d}-shiny.png`)) ?? plain;
        }),
      );
      const egg = await read("egg.png");
      if (egg) out.egg = egg;
      await Promise.all(
        names("items").map(async (n) => {
          const uri = await diskUri(`items/${n}`);
          if (uri) out[`item:${n.slice(0, -4)}`] = uri;
        }),
      );
      // 우리 그림이 받은 그림보다 먼저다
      await Promise.all(
        ownIds().map(async (id) => {
          const file = ownItem(id);
          const uri = file ? await ownUri(file) : null;
          if (uri) out[`item:${id}`] = uri;
        }),
      );
      return out;
    },
  };
}
