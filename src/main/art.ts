// 그림의 facade — art/pmd-load.js(S2 유지 · S5 에 이식)의 loadPmd 를 감싸 무대가 쓰는 모양(LookSheets)으로 낸다. 움직임용 보유 동작은 motion/pet-motion capsOf 가 뽑는다.
//
// 무대 캔버스는 시트를 미리 디코드해 그리므로 PMD 전용이다 — showdown(GIF img 태그) · sheet(codex 팩)는 얹을 수 없다 (s2-plan 2.2 h).
// PMD 를 못 받은 마리는 무대에 나오지 않는다 — 부르는 쪽이 stderr 한 줄 + last-error.json 을 남긴다.
// look(모습) 하나는 한 번만 받는다 — 같은 종 여러 마리가 시트를 공유한다. 배율(zoom)은 마리별(Pet.size)이라 여기서 정하지 않고 zoomOf 로 뽑는다
import { SIZE_STEPS, snapSize } from "../save/rules.js";
import type { LookSheets, PlayMode, SpriteSheet, StageSize } from "../shared/stage";
import type { Paths } from "./paths";
import { profile } from "../dex/species";

export const ART_RULES = {
  // 배율 상한 — 몸 칸으로 잰다 (art/pmd-load.js 와 같은 수). 작업 동작이 칸을 키웠다고 펫이 작아지지 않게.
  // PMD 프레임은 gen5 GIF 보다 작아서 같은 dotSize 면 작아 보인다 — 3~4 를 권한다
  maxBody: { w: 480, h: 420 },
  defaultZoom: 2, // 크기를 모를 때 — config.js dotSize 기본 · SAVE_RULES.pet.size 와 같다
};

// art/pmd-load.js loadPmd 의 결과 모양
export interface PmdArt {
  kind: "pmd";
  cell: StageSize; // 담긴 동작 전부를 덮는 칸 (도트)
  body: StageSize; // 작업 동작을 뺀 몸 칸 — 자리 계산의 기준
  work: Record<string, "once" | "loop">;
  workOnly: string[];
  zoom: number; // loadPmd 가 config.dotSize 로 계산한 값 — 무대는 쓰지 않는다 (마리별 zoomOf)
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

interface PmdLoadModule {
  loadPmd(config: { slug: string; dotSize: number; buddy: string; spritePath?: string }, paths: Paths): Promise<PmdArt | null>;
}

const { loadPmd } = require("../../art/pmd-load.js") as PmdLoadModule;

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

// look → -3d 같은 그림체 접미사는 같은 종 (lib/dex.js normalize 와 같은 규칙)
export const normalizeLook = (look: string): string => String(look ?? "").trim().toLowerCase().replace(/-3d$/, "");

export interface ArtLoader {
  loadLook(look: string): Promise<Look | null>; // 없는 종·못 받음 → null. 같은 look 은 한 번만 받는다 (실패도 기억)
  cached(look: string): Look | null;
}

export function createArtLoader(paths: Paths): ArtLoader {
  const pending = new Map<string, Promise<Look | null>>();
  const done = new Map<string, Look | null>();

  async function fetchLook(look: string): Promise<Look | null> {
    // dotSize 는 loadPmd 의 zoom 계산에만 쓰이고 무대는 그 값을 쓰지 않는다. buddy=on — 작업 동작까지 담아야 작업 리듬이 나온다
    const shiny = look.endsWith(":shiny");
    const slug = shiny ? look.slice(0, -6) : look;
    const dex = profile(slug).dex;
    if (shiny && !dex) return null;
    const art = await loadPmd({ slug, dotSize: ART_RULES.defaultZoom, buddy: "on",
      ...(shiny ? { spritePath: `${String(dex).padStart(4, "0")}/0000/0001` } : {}) }, paths);
    const result = art && art.kind === "pmd" && art.anims && art.clips ? { look, art, sheets: sheetsOf(look, art) } : null;
    if (result) done.set(look, result);
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
  };
}
