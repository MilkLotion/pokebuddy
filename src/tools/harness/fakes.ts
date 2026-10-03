// 시험용 서버 찾기 — 로컬 Supabase 의 주소와 키. 계정·클라우드·교환 자체 검사가 같은 글자로 세 벌 가지고 있었다
// (도구 레인 H0. 설계 50번 3.5절 harness/fakes.ts — memoryStorage 를 앱에서 옮기는 일은 온라인 쪽 단계다)
import { execSync } from "node:child_process";

export interface LocalServer {
  url: string;
  key: string;
  service: string | null; // 서비스 키 — 클라우드 검사만 쓴다
}

// POKEBUDDY_SUPABASE_URL·POKEBUDDY_SUPABASE_KEY(·POKEBUDDY_SUPABASE_SERVICE_KEY), 없으면 `npx supabase status -o json`. 못 찾으면 null — 부르는 쪽이 건너뛴다
export function localServer(): LocalServer | null {
  if (process.env.POKEBUDDY_SUPABASE_URL && process.env.POKEBUDDY_SUPABASE_KEY) {
    return { url: process.env.POKEBUDDY_SUPABASE_URL, key: process.env.POKEBUDDY_SUPABASE_KEY, service: process.env.POKEBUDDY_SUPABASE_SERVICE_KEY ?? null };
  }
  try {
    const raw = execSync("npx supabase status -o json", { stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 }).toString();
    const j = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<string, string>;
    const url = j.API_URL, key = j.PUBLISHABLE_KEY ?? j.ANON_KEY;
    return url && key ? { url, key, service: j.SERVICE_ROLE_KEY ?? j.SECRET_KEY ?? null } : null;
  } catch {
    return null;
  }
}

// 실제 프로젝트에 붙지 않게 — 주소가 127.0.0.1·localhost 가 아니면 던진다
export function assertLocalUrl(url: string): void {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url)) throw new Error("로컬 주소가 아니다 — 실제 프로젝트에는 붙지 않는다");
}
