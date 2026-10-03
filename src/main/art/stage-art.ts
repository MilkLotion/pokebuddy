// 그림의 facade — ./art/pmd-load.ts 의 loadPmd 를 감싸 무대가 쓰는 모양(LookSheets)으로 낸다. 움직임용 보유 동작은 motion/pet-motion capsOf 가 뽑는다.
//
// 무대 캔버스는 시트를 미리 디코드해 그리므로 PMD 전용이다 — showdown(GIF img 태그) · sheet(codex 팩)는 얹을 수 없다.
// PMD 를 못 받은 마리는 대체 그림으로 나온다 — PMD 에 그림이 없는 종(탄동·모으령 등)이 무대에서 사라지지 않게.
//   먼저 걷기 대체 그림(src/main/art/overworld-art.ts), 그것도 못 받으면 초상 대체 그림(src/main/art/portrait-art.ts)이다.
// 초상도 못 받으면 무대에 나오지 않는다 — 부르는 쪽이 stderr 한 줄 + last-error.json 을 남긴다.
// look(모습) 하나는 한 번만 받는다 — 같은 종 여러 마리가 시트를 공유한다. 배율(zoom)은 마리별(Pet.size)이라 여기서 정하지 않고 zoomOf 로 뽑는다
import { SIZE_STEPS, snapSize } from "../../party/size.js";
import type { LookSheets, PlayMode, SpriteSheet, StageSize } from "../../shared/model/stage";
import type { Paths } from "../../platform/paths";
import { profileOf } from "../../dex/species";
import { genderLookInfo, regionalOf } from "../../dex/regional";
import { megaOf } from "../../dex/mega";
import { dexFolderOf, lookOf } from "../../dex/look";
import type { OverworldSource } from "./overworld-art";
import { portraitArt } from "./portrait-art";
import { loadPmd, prefetchPmd } from "./pmd-load";

export const ART_RULES = {
  // 배율 상한 — 몸 칸으로 잰다 (./art/pmd-load.ts 와 같은 수). 작업 동작이 칸을 키웠다고 펫이 작아지지 않게.
  // PMD 프레임은 gen5 GIF 보다 작아서 같은 dotSize 면 작아 보인다 — 3~4 를 권한다
  maxBody: { w: 480, h: 420 },
  defaultZoom: 2, // 크기를 모를 때 — SAVE_RULES.pet.size 와 같다 (설정의 dotSize 는 없어진 옛 키다 — src/platform/user-config.ts)
};

// ./art/pmd-load.ts loadPmd 의 결과 모양. 대체 그림(overworld-art.ts · portrait-art.ts)도 같은 모양이다
export interface PmdArt {
  kind: "pmd" | "overworld" | "portrait";
  cell: StageSize; // 담긴 동작 전부를 덮는 칸 (도트)
  body: StageSize; // 작업 동작을 뺀 몸 칸 — 자리 계산의 기준
  work: Record<string, "once" | "loop">;
  workOnly: string[];
  zoom: number; // loadPmd 가 dotSize 인자로 계산한 값 — 무대는 쓰지 않는다 (마리별 zoomOf)
  anims: Record<string, SpriteSheet>;
  clips: Record<string, { anim: string; mode: PlayMode; row: number }>;
  credits: { author: string; license: string }[];
  dex: string;
  from: string;
}

export interface Look {
  look: string;
  art: PmdArt;
  sheets: LookSheets; // 렌더러에 보내는 묶음
}

// 도트 배율 — Pet.size 를 크기 단계(SIZE_STEPS) 가운데 몸이 상한을 넘지 않는 가장 큰 배율로 가둔 값. 가장 작은 단계보다 작아지지 않는다
export function zoomOf(size: number, body: StageSize): number {
  const want = size > 0 ? snapSize(size) : ART_RULES.defaultZoom; // 단계 사이 값(옛 설정의 dotSize 등)은 가까운 단계로
  const byW = body.w > 0 ? ART_RULES.maxBody.w / body.w : want;
  const byH = body.h > 0 ? ART_RULES.maxBody.h / body.h : want;
  const cap = Math.min(want, byW, byH);
  const fit = SIZE_STEPS.filter((z) => z <= cap);
  return fit.length ? Math.max(...fit) : (SIZE_STEPS[0] ?? 1);
}

// 렌더러가 캐시하는 그림 묶음 — look 키로
export const sheetsOf = (look: string, art: PmdArt): LookSheets => ({
  look,
  cell: art.cell,
  body: art.body,
  anims: art.anims,
  clips: art.clips,
});

// look → -3d 같은 그림체 접미사는 같은 종 (src/dex/data.ts normalizeSlug 와 같은 규칙)
export const normalizeLook = (look: string): string => String(look ?? "").trim().toLowerCase().replace(/-3d$/, "");

export interface ArtLoader {
  loadLook(look: string): Promise<Look | null>; // 없는 종·못 받음 → null. 같은 look 은 한 번만 받는다 (실패도 기억)
  cached(look: string): Look | null;
  // 무대에 아직 없는 모습의 묶음을 뒤에서 하나씩 디스크에 받아 둔다. 기다리지 않는다. 한 모습은 세션마다 한 번만 시도한다
  prefetch(looks: string[]): void;
}

type PmdSource = { slug: string; spritePath?: string };

// look → PMD 묶음을 찾는 값들 — 앞에서부터 받아 보고 되는 것을 쓴다. 이로치는 도감 번호 아래 이로치 경로다. 도감 번호를 모르는 이로치는 빈 목록.
// 리전폼(src/dex/regional.ts)은 폼 폴더(`0026/0001`)가 먼저다. 이로치는 `<폼>/0001` → 폼 보통 → 기본형 이로치, 보통은 폼 → 기본형 순서다.
// 폼 그림이 없는 리전폼(가라르 메더)은 기본형 그림으로 무대에 나온다 (worklog-mac/records/region-map/design.md B.3)
export function pmdSources(look: string): PmdSource[] {
  const shiny = look.endsWith(":shiny");
  const slug = shiny ? look.slice(0, -6) : look;
  // 성별 그림(대쓰여너 암컷) — 그 성별의 폴더가 먼저다. 이로치는 이로치 폴더 → 보통 폴더, 끝은 종의 기본 그림이다
  const byGender = genderLookInfo(slug);
  if (byGender) {
    const own = [...(shiny && byGender.pmdShiny ? [byGender.pmdShiny] : []), ...(byGender.pmd ? [byGender.pmd] : [])].map((spritePath) => ({ slug, spritePath }));
    return [...own, ...pmdSources(`${byGender.species}${shiny ? ":shiny" : ""}`).map((src) => ({ ...src, slug }))];
  }
  const dex = profileOf(slug).dex;
  const base = dex ? String(dex).padStart(4, "0") : null;
  const mega = megaOf(slug);
  // 메가 모습(src/dex/mega.ts) — 폼 폴더만 본다. 이로치는 `<폼>/0001` → 폼 보통. 폴더가 없으면 빈 목록이라 걷기 대체 그림으로 넘어간다
  if (mega) return mega.pmd ? (shiny ? [{ slug, spritePath: `${mega.pmd}/0001` }, { slug, spritePath: mega.pmd }] : [{ slug, spritePath: mega.pmd }]) : [];
  const form = regionalOf(slug)?.pmd;
  const out: PmdSource[] = [];
  if (form) out.push({ slug, spritePath: shiny ? `${form}/0001` : form });
  if (form && shiny) out.push({ slug, spritePath: form });
  if (shiny) {
    if (base) out.push({ slug, spritePath: `${base}/0000/0001` });
  } else out.push(regionalOf(slug) && base ? { slug, spritePath: base } : { slug });
  return out;
}

// 그림을 찾을 수 있는 모습인가 — PMD 후보가 있거나 메가 모습이다. 메가 모습은 PMD 폴더가 없어도 걷기 대체 그림·초상으로 선다
const knownLook = (look: string, srcs: PmdSource[]): boolean => srcs.length > 0 || megaOf(look.replace(/:shiny$/, "")) !== null;

// 그림 묶음에 적는 도감 번호 — 메가 모습은 기본 종의 번호
export const dexOfLook = (look: string): string => {
  return dexFolderOf(lookOf(look));
};

// look → 초상 PNG. 없거나 못 받으면 null (src/main/art/portraits.ts)
export type PortraitSource = (look: string) => Promise<Buffer | null>;

// PMD 를 못 받았을 때 쓸 그림의 공급자 — 걷기 대체 그림이 먼저, 초상이 다음이다. 시험은 가짜를 넣는다
export interface FallbackSources {
  overworld?: OverworldSource;
  portrait?: PortraitSource;
}

export function createArtLoader(paths: Paths, { overworld, portrait }: FallbackSources = {}): ArtLoader {
  const pending = new Map<string, Promise<Look | null>>();
  const done = new Map<string, Look | null>();
  const tried = new Set<string>(); // 미리 받기를 시도한 모습
  const queue: string[] = [];
  let prefetching: { look: string; job: Promise<unknown> } | null = null; // 지금 미리 받는 모습 — 무대가 같은 모습을 겹쳐 받지 않게 기다린다

  async function drain(): Promise<void> {
    if (prefetching) return;
    for (let look = queue.shift(); look !== undefined; look = queue.shift()) {
      const srcs = pmdSources(look);
      if (!knownLook(look, srcs) || done.has(look) || pending.has(look)) continue;
      const job = (async () => {
        for (const src of srcs) if (await prefetchPmd(src, paths).catch(() => false)) return true;
        // PMD 에 그림이 없는 종 — 걷기 대체 그림을 받아 둔다
        return overworld ? overworld.prefetch(look).catch(() => false) : false;
      })();
      prefetching = { look, job };
      await job;
      prefetching = null;
    }
  }

  async function fetchLook(look: string): Promise<Look | null> {
    const srcs = pmdSources(look);
    if (!knownLook(look, srcs)) return null;
    if (prefetching?.look === look) await prefetching.job;
    for (const src of srcs) {
      // dotSize 는 loadPmd 의 zoom 계산에만 쓰이고 무대는 그 값을 쓰지 않는다. buddy=on — 작업 동작까지 담아야 작업 리듬이 나온다
      const art = await loadPmd({ ...src, dotSize: ART_RULES.defaultZoom, buddy: "on" }, paths);
      const result = art && art.kind === "pmd" && art.anims && art.clips ? { look, art, sheets: sheetsOf(look, art) } : null;
      if (result) {
        done.set(look, result);
        return result;
      }
    }
    // PMD 에 그림이 없는 종 — 걷기 대체 그림으로 세운다. 네트워크가 끊겨 PMD 를 못 받은 경우도 이 세션 동안은 대체 그림이다
    const walk = overworld ? await overworld.load(look).catch(() => null) : null;
    if (walk) {
      const result = { look, art: walk, sheets: sheetsOf(look, walk) };
      done.set(look, result);
      return result;
    }
    // 걷기 대체 그림도 못 받았다 — 초상으로 세운다
    const png = portrait ? await portrait(look).catch(() => null) : null;
    const art = png ? portraitArt(png, dexOfLook(look)) : null;
    if (!art) return null;
    const result = { look, art, sheets: sheetsOf(look, art) };
    done.set(look, result);
    return result;
  }

  return {
    loadLook(look) {
      const key = normalizeLook(look);
      if (done.has(key)) return Promise.resolve(done.get(key) ?? null);
      let p = pending.get(key);
      if (!p) {
        p = fetchLook(key).finally(() => pending.delete(key));
        pending.set(key, p);
      }
      return p;
    },
    cached: (look) => done.get(normalizeLook(look)) ?? null,
    prefetch(looks) {
      for (const raw of looks) {
        const key = normalizeLook(raw);
        if (!key || tried.has(key) || done.has(key) || pending.has(key)) continue;
        tried.add(key);
        queue.push(key);
      }
      void drain();
    },
  };
}
