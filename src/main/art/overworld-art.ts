// 걷기 대체 그림 — PMD 그림이 없는 종(2026-10-02 기준 35종: 탄동·모으령 등)을 무대에 세운다. 초상 대체 그림(portrait-art.ts)보다 먼저다.
//
// 출처: rh-hideout/pokeemerald-expansion 의 따라다니기 그림 graphics/pokemon/<이름>/overworld.png (worklog/records/fallback-art/record.md)
//   저장소에 라이선스가 없다 — 설치 파일에 넣지 않고 실행할 때 받아 캐시한다. 릴리스 태그로 고정한다(폴더 구조가 바뀐 적이 있다)
// 시트: 가로로 정사각 칸 6개(칸 = 시트 높이, 32 또는 64). 팔레트 PNG 이고 팔레트 0번이 배경이다(투명 아님, 색은 파일마다 다르다)
//   칸 0·1 아래(정면) · 2·3 위(뒤) · 4·5 왼쪽. 오른쪽은 4·5 를 좌우로 뒤집는다. 칸이 8개면 6·7 이 오른쪽이다
//   (expansion src/data/object_events/object_event_anims.h sAnimTable_Following · _Asym)
// 색: 게임은 PNG 에 든 팔레트를 쓰지 않고 팔레트 파일(JASC-PAL 글 파일)을 쓴다 — overworld_normal.pal · overworld_shiny.pal.
//   PNG 의 팔레트가 다른 종이 있다(2026-10-02: 야나키·탱그릴·버프론). 그래서 보통도 팔레트 파일의 같은 번호 색으로 칠한다.
//   팔레트 파일을 못 받으면 PNG 의 색이다. 이로치 팔레트를 못 받으면 보통 색이다
// 만드는 것: PMD 모양(8행 × 2열)의 시트 둘
//   Walk  두 칸을 번갈아 — 원본은 60분의 1초 틱으로 6틱씩 0,1,1,0 이라 칸마다 0.2초다
//   Idle  방향의 첫 칸 → 같은 칸을 1도트 위 — 숨 쉬듯 들썩인다 (초상 대체 그림과 같은 값)
// 잠자기·반응 동작은 없다. 없는 동작은 움직임 모듈이 알아서 빼고 고른다
import path from "node:path";
import type { PmdArt } from "./stage-art";
import { dexFolderOf, lookOf } from "../../dex/look";
import { decodePng, encodePng, opaqueRectOf, pngHeaderOf, type Rgba } from "../../platform/png";
import { FALLBACK_RULES, fallbackAnimOf, fallbackArtOf } from "./fallback-art";
import { createAssetCache } from "./asset-cache";
import { overworldDir, overworldUrl } from "./sources.js";

export const OVERWORLD_RULES = {
  // 받는 곳(저장소·릴리스 태그)은 src/main/art/sources.ts OVERWORLD_SOURCE
  walkMs: [200, 200],
  idleMs: [...FALLBACK_RULES.idleMs], // 제자리 → 위 (src/main/art/fallback-art.ts — 초상 대체 그림과 같다)
  bob: FALLBACK_RULES.bob, // 들썩이는 높이 (도트)
};

const ROWS = FALLBACK_RULES.rows;
const PNG_FILE = "overworld.png";
const NORMAL_FILE = "overworld_normal.pal";
const SHINY_FILE = "overworld_shiny.pal";


// JASC-PAL → 번호 순 RGB. 못 읽으면 null
export function parsePal(text: string): [number, number, number][] | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
  if (lines[0] !== "JASC-PAL") return null;
  const out: [number, number, number][] = [];
  for (const line of lines.slice(3)) {
    const [r, g, b] = line.split(/\s+/).map(Number);
    if (![r, g, b].every((v) => Number.isInteger(v) && v! >= 0 && v! <= 255)) return null;
    out.push([r!, g!, b!]);
  }
  return out.length ? out : null;
}

// 받은 내용이 걷기 시트인가 — 캐시 검증용. 머리말만 본다: 팔레트 PNG 이고 정사각 칸 6개나 8개
export function looksLikeOverworld(buf: Buffer): boolean {
  const head = pngHeaderOf(buf);
  if (!head || head.colorType !== 3) return false;
  const { w, h } = head;
  return h > 0 && w % h === 0 && (w / h === 6 || w / h === 8);
}
export const looksLikePal = (buf: Buffer): boolean => buf.length >= 8 && buf.toString("ascii", 0, 8) === "JASC-PAL";

// PMD 행 → 쓰는 칸 둘과 좌우 반전
function cellsOf(row: number, count: number): { cells: [number, number]; flip: boolean } {
  if (row === 0) return { cells: [0, 1], flip: false };
  if (row === 4) return { cells: [2, 3], flip: false };
  if (row >= 5) return { cells: [4, 5], flip: false };
  return count === 8 ? { cells: [6, 7], flip: false } : { cells: [4, 5], flip: true };
}

// 걷기 시트 PNG + 팔레트 파일(보통 또는 이로치) → 무대가 쓰는 그림 묶음. 못 읽거나 빈 그림이면 null.
// 팔레트 파일이 없거나 깨졌으면 PNG 에 든 색으로 칠한다. 팔레트에 없는 번호도 PNG 의 색이다
export function overworldArt(png: Buffer, palFile: Buffer | null, dex: string): PmdArt | null {
  const img = decodePng(png);
  if (!img?.idx || img.h < 1 || img.w % img.h !== 0) return null;
  const size = img.h;
  const count = img.w / size;
  if (count !== 6 && count !== 8) return null;
  const idx = img.idx;
  const pal = palFile ? parsePal(palFile.toString("utf8")) : null;

  // 불투명한 점(팔레트 0번이 아닌 점)을 모두 덮는 사각형 — 칸 안 좌표. 어느 칸이든 그 자리가 불투명하면 넣는다. 모든 칸을 같은 사각형으로 자른다
  const box = opaqueRectOf(size, size, (lx, y) => {
    for (let c = 0; c < count; c++) if (idx[y * img.w + c * size + lx] !== 0) return true;
    return false;
  });
  if (!box) return null;
  const { x: x0, y: y0, w: bw, h: bh } = box;
  const fw = bw;
  const fh = bh + OVERWORLD_RULES.bob;

  // 칸 하나를 시트의 (row, col) 자리에 옮긴다. top 은 칸 안에서의 세로 자리
  const draw = (sheet: Rgba, row: number, col: number, cell: number, flip: boolean, top: number): void => {
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const from = (y0 + y) * img.w + cell * size + x0 + (flip ? bw - 1 - x : x);
        const i = idx[from]!;
        if (i === 0) continue;
        const to = ((row * fh + top + y) * sheet.w + col * fw + x) * 4;
        const c = pal?.[i];
        sheet.px[to] = c ? c[0] : img.px[from * 4]!;
        sheet.px[to + 1] = c ? c[1] : img.px[from * 4 + 1]!;
        sheet.px[to + 2] = c ? c[2] : img.px[from * 4 + 2]!;
        sheet.px[to + 3] = 255;
      }
    }
  };
  const blank = (): Rgba => ({ w: fw * 2, h: fh * ROWS, px: Buffer.alloc(fw * 2 * fh * ROWS * 4), idx: null });
  const walk = blank();
  const idle = blank();
  for (let row = 0; row < ROWS; row++) {
    const { cells, flip } = cellsOf(row, count);
    draw(walk, row, 0, cells[0], flip, OVERWORLD_RULES.bob);
    draw(walk, row, 1, cells[1], flip, OVERWORLD_RULES.bob);
    draw(idle, row, 0, cells[0], flip, OVERWORLD_RULES.bob);
    draw(idle, row, 1, cells[0], flip, 0);
  }

  const frame = { w: fw, h: fh };
  const anim = (sheet: Rgba, ms: readonly number[]) => fallbackAnimOf(frame, ms, `data:image/png;base64,${encodePng(sheet).toString("base64")}`);
  return fallbackArtOf({ kind: "overworld", frame, anims: { Idle: anim(idle, OVERWORLD_RULES.idleMs), Walk: anim(walk, OVERWORLD_RULES.walkMs) }, dex });
}

// 캐시 파일 — <이름>.png · <이름>.normal.pal · <이름>.shiny.pal
export const overworldFiles = (dir: string, slug: string): { png: string; normal: string; shiny: string } => ({
  png: path.join(dir, `${overworldDir(slug)}.png`),
  normal: path.join(dir, `${overworldDir(slug)}.normal.pal`),
  shiny: path.join(dir, `${overworldDir(slug)}.shiny.pal`),
});

export interface OverworldSource {
  load(look: string): Promise<PmdArt | null>; // 없는 종·못 받음 → null
  prefetch(look: string): Promise<boolean>; // 디스크에 받아 두기만 한다
}

// look → 걷기 대체 그림. dir 은 캐시 폴더(PATHS.overworld)
export function createOverworldSource(dir: string): OverworldSource {
  // 받기·캐시 (./asset-cache.ts) — 못 받아도 기억하지 않는다(늘 다시). 시트와 팔레트는 검증이 달라 캐시가 둘이다
  const sheets = createAssetCache({ dir, validate: looksLikeOverworld, mime: () => "image/png", retryMs: 0 });
  const palettes = createAssetCache({ dir, validate: looksLikePal, mime: () => "text/plain", retryMs: 0 });
  const relOf = (file: string): string => path.relative(dir, file);
  const parse = (look: string): { slug: string; shiny: boolean } =>
    look.endsWith(":shiny") ? { slug: look.slice(0, -6), shiny: true } : { slug: look, shiny: false };
  // 이로치 팔레트를 못 받으면 보통 팔레트다 (이로치 초상이 없으면 보통 초상인 것과 같다). 보통 팔레트도 못 받으면 PNG 의 색이다
  const fetchBoth = async (look: string): Promise<{ png: Buffer; pal: Buffer | null; slug: string } | null> => {
    const { slug, shiny } = parse(look);
    if (!/^[a-z0-9-]+$/.test(slug)) return null;
    const files = overworldFiles(dir, slug);
    const png = await sheets.fetchBuffer(relOf(files.png), overworldUrl(slug, PNG_FILE));
    if (!png) return null;
    const pal =
      (shiny ? await palettes.fetchBuffer(relOf(files.shiny), overworldUrl(slug, SHINY_FILE)) : null) ??
      (await palettes.fetchBuffer(relOf(files.normal), overworldUrl(slug, NORMAL_FILE)));
    return { png, pal, slug };
  };
  return {
    async load(look) {
      const got = await fetchBoth(look);
      return got ? overworldArt(got.png, got.pal, dexFolderOf(lookOf(got.slug))) : null; // 성별 그림이면 그 종의 번호 — 무대 그림(src/main/art/stage-art.ts dexOfLook)과 같은 풀이
    },
    async prefetch(look) {
      return !!(await fetchBoth(look));
    },
  };
}
