// 온라인 서버 설정 — 교환·계정·클라우드 저장·우편이 같이 쓴다. worklog/records/trade/record.md "프로젝트 구성"
//
// data/online.json 은 공개해도 되는 값만 둔다(주소, publishable 키, 규약 번호).
// 개발 중에는 환경 변수로 로컬 Supabase 를 가리킨다: POKEBUDDY_SUPABASE_URL, POKEBUDDY_SUPABASE_KEY
// POKEBUDDY_ONLINE=off 면 서버 설정을 비운다 — 온라인 기능(계정·클라우드 저장·교환·우편)을 끈다. 서버가 필요 없는 E2E 가 운영 서버에 닿지 않게
//   빈 POKEBUDDY_SUPABASE_URL 은 끄지 못한다(|| 가 online.json 으로 넘어간다). 개발 실행만 환경 변수를 받는다
// 설치본은 환경 변수를 넘기지 않는다(src/main/trade.ts) — 다른 서버로 바꿔 세션 토큰을 빼 가지 못하게(2026-09-27 검수)
// 개발 실행 판정은 src/platform/dev-run.ts isRepoRun — app.isPackaged 만으로는 npm 설치본(`electron .` 으로 뜬다)을 가리지 못한다
import { loadJson, type DexOptions } from "../dex/data.js";

export interface OnlineConfig {
  url: string;
  publishableKey: string;
  protocol: number;
  linkBase: string; // 교환 링크 앞부분. 토큰은 # 뒤에 붙인다
}

const LINK_BASE = "https://milklotion.github.io/pokebuddy/trade";

export function onlineConfig(opts?: DexOptions, env: NodeJS.ProcessEnv = process.env): OnlineConfig {
  const raw = loadJson<Partial<OnlineConfig>>("online.json", opts);
  const off = env.POKEBUDDY_ONLINE === "off";
  return {
    url: off ? "" : env.POKEBUDDY_SUPABASE_URL || raw.url || "",
    publishableKey: off ? "" : env.POKEBUDDY_SUPABASE_KEY || raw.publishableKey || "",
    protocol: typeof raw.protocol === "number" ? raw.protocol : 1,
    linkBase: raw.linkBase || LINK_BASE,
  };
}
