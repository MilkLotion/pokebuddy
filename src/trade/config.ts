// 친구 교환 서버 설정과 버전 값 — worklog/records/trade/record.md "프로젝트 구성", "버전 값"
//
// data/online.json 은 공개해도 되는 값만 둔다(주소, publishable 키, 규약 번호).
// 개발 중에는 환경 변수로 로컬 Supabase 를 가리킨다: POKEBUDDY_SUPABASE_URL, POKEBUDDY_SUPABASE_KEY
// 설치본은 환경 변수를 넘기지 않는다(src/main/trade.ts) — 다른 서버로 바꿔 세션 토큰을 빼 가지 못하게(2026-09-27 검수)
import { createHash } from "node:crypto";
import { loadJson, type DexOptions } from "../dex/data.js";
import { slugs } from "../dex/species.js";

export interface OnlineConfig {
  url: string;
  publishableKey: string;
  protocol: number;
  linkBase: string; // 교환 링크 앞부분. 토큰은 # 뒤에 붙인다
}

const LINK_BASE = "https://milklotion.github.io/pokebuddy/trade";

export function onlineConfig(opts?: DexOptions, env: NodeJS.ProcessEnv = process.env): OnlineConfig {
  const raw = loadJson<Partial<OnlineConfig>>("online.json", opts);
  return {
    url: env.POKEBUDDY_SUPABASE_URL || raw.url || "",
    publishableKey: env.POKEBUDDY_SUPABASE_KEY || raw.publishableKey || "",
    protocol: typeof raw.protocol === "number" ? raw.protocol : 1,
    linkBase: raw.linkBase || LINK_BASE,
  };
}

let cached: string | null = null;

// 종 데이터의 지문 — 종 ID 목록을 정렬해 SHA-256 앞 12자리. 두 앱의 값이 다르면 참가를 거절한다
export function dataVersion(opts?: DexOptions): string {
  if (!opts && cached) return cached;
  const v = createHash("sha256").update(slugs(opts).join("\n")).digest("hex").slice(0, 12);
  if (!opts) cached = v;
  return v;
}

export const linkOf = (config: OnlineConfig, token: string): string => `${config.linkBase}#${token}`;
