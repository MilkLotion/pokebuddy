// 자체 검사 목록 — 순서가 실행 순서다. 실행기는 ./run.ts, A/B 비교(worklog 의 ab.cjs)도 이 목록을 읽는다
//
// 순서는 예전 package.json 의 `selftest` 한 줄과 같다. 글자 순서로 바꾸지 않는다 — 검사끼리 순서에 기대는 코드는
// 찾지 못했지만, 고정 포트(selftest-github)와 로컬 Supabase(account·cloud·trade-net)를 쓰는 검사가 있어 차례로만 돌린다
export interface SelftestEntry {
  name: string; // 실행기에 주는 이름 — `npm run selftest -- shop`
  file: string; // 프로젝트 뿌리 기준 실행 파일
  needs?: "server" | "mac"; // 없으면 그 검사가 스스로 건너뛴다(종료 코드 0). 실행기는 표시만 한다
}

const tool = (name: string, needs?: SelftestEntry["needs"]): SelftestEntry => ({ name, file: `dist/tools/selftest/selftest-${name}.js`, ...(needs ? { needs } : {}) });

const check = (name: string): SelftestEntry => ({ name: `check-${name}`, file: `dist/tools/check/check-${name}.js` });

export const SELFTESTS: readonly SelftestEntry[] = [
  // 정적 검사 — 파일만 읽는다. 창도 네트워크도 쓰지 않는다
  check("deps"),
  check("names"),
  check("hook-bundle"),
  check("server-codes"),
  check("fail-text"),
  check("bare-open"),
  tool("cli"),
  tool("legacy"),
  tool("save"),
  tool("save-crypt"),
  tool("verify"),
  tool("tx"),
  tool("box"),
  tool("time"),
  tool("egg"),
  tool("shop"),
  tool("bag"),
  tool("evolve"),
  tool("mega"),
  tool("achievement"),
  tool("snapshot"),
  tool("devices"),
  tool("menus"),
  tool("manage"),
  tool("manage-requests"),
  tool("wire-ipc"),
  tool("flow"),
  tool("dex"),
  tool("dex-detail"),
  tool("window-helpers"),
  tool("asset-cache"),
  tool("notify"),
  tool("find"),
  tool("clock"),
  tool("play"),
  tool("screens"),
  tool("unlocks"),
  tool("agents"),
  tool("hook-check"),
  tool("hook-upkeep"),
  tool("terminal"),
  tool("motion"),
  tool("overworld-art"),
  tool("stage"),
  tool("commands"),
  tool("trade"),
  tool("trade-net", "server"),
  tool("session"),
  tool("session-storage"),
  tool("pid-lock"),
  tool("account", "server"),
  tool("cloud", "server"),
  tool("github"),
  tool("updater"),
  tool("mac-updater", "mac"),
  tool("patch-notes"),
  tool("mail"),
];
