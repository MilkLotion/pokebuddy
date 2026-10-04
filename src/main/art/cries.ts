// 포켓몬 울음소리 — PokeAPI cries 의 최신 울음소리를 받아 캐시하고 무대에 data URI 로 준다
//
// 출처는 https://github.com/PokeAPI/cries 다. 경로: cries/pokemon/latest/<도감>.ogg.
// 캐시: ~/.claude/pokebuddy/cries/<4자리>.ogg. 못 받은 종은 초상과 같이 15초 뒤에 다시 청한다(ASSET_RULES.retryMs).
// 무대 창의 CSP 는 media-src data: 만 허용한다. 그래서 파일 경로가 아니라 data URI 로 준다
import { profileOf } from "../../dex/species.js";
import { ASSET_RULES, createAssetCache } from "./asset-cache";
import { cryFile, cryUrl } from "./sources.js";

// 소리 형식 — 경로는 .ogg 지만 latest 울음소리는 내용이 MP3 다(2026-09-25 확인: 첫 바이트 FF FB). 둘 다 받는다
function audioType(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf.toString("latin1", 0, 4) === "OggS") return "audio/ogg";
  if (buf.toString("latin1", 0, 3) === "ID3" || (buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0)) return "audio/mpeg";
  return null;
}

export interface Cries {
  get(slug: string): Promise<string | null>;
}

export function createCries(dir: string): Cries {
  // 받기·캐시 (./asset-cache.ts) — 못 받은 종은 초상과 같이 ASSET_RULES.retryMs 뒤에 다시 청한다 (94 문서 5-12)
  const cache = createAssetCache({ dir, validate: (buf) => audioType(buf) != null, mime: (buf) => audioType(buf) ?? "audio/mpeg", retryMs: ASSET_RULES.retryMs });
  return {
    async get(slug) {
      const dex = profileOf(slug).dex;
      if (!dex) return null;
      return cache.fetchUri(cryFile(dex), cryUrl(dex));
    },
  };
}
