// 포켓몬 울음소리 — PokeAPI cries 의 최신 울음소리를 받아 캐시하고 무대에 data URI 로 준다
//
// 출처는 https://github.com/PokeAPI/cries 다. 경로: cries/pokemon/latest/<도감>.ogg.
// 캐시: ~/.claude/pokebuddy/cries/<4자리>.ogg. 못 받은 종은 이 프로세스가 끝날 때까지 다시 받지 않는다.
// 무대 창의 CSP 는 media-src data: 만 허용한다. 그래서 파일 경로가 아니라 data URI 로 준다
import path from "node:path";
import { profile } from "../dex/species.js";
import { fetchCached } from "./art/fetch";

const BASE = "https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest";

export const cryUrl = (dex: number): string => `${BASE}/${dex}.ogg`;

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
  const missing = new Set<number>();
  const memo = new Map<number, string>();
  return {
    async get(slug) {
      const dex = profile(slug).dex;
      if (!dex || missing.has(dex)) return null;
      const known = memo.get(dex);
      if (known) return known;
      const got = await fetchCached(path.join(dir, `${String(dex).padStart(4, "0")}.ogg`), cryUrl(dex), (buf) => audioType(buf) != null);
      if (!got) {
        missing.add(dex);
        return null;
      }
      const uri = `data:${audioType(got.buf)};base64,${got.buf.toString("base64")}`;
      memo.set(dex, uri);
      return uri;
    },
  };
}
