// 층과 의존 규칙 검사 — import 문만 읽는다. 창도 네트워크도 쓰지 않는다
//
//   node dist/tools/check/check-deps.js                    새 어긋남이 있으면 종료 코드 1
//   node dist/tools/check/check-deps.js --update-baseline  지금 어긋남을 기준 목록으로 적는다
//
// 규칙의 원본은 worklog 의 code-structure 설계 통합본 2절(층 표)이다. 표가 바뀌면 아래 LAYERS 를 같이 고친다.
// 보는 것:
//   layer    폴더가 가져다 쓸 수 없는 폴더를 가져다 쓴다 (타입만 가져와도 센다 — 줄 끝에 type 표시)
//   main     src/main 의 하위 폴더가 1.2절 표 밖의 메인 폴더·꼭대기 파일·electron 을 가져다 쓴다
//   electron 메인·도구 밖에서 electron 을 값으로 가져온다
//   node     shared·renderer 가 node:* 를 가져온다
//   tools    앱이 src/tools 를 가져다 쓴다
//   outside  src 가 src 밖의 JS 를 require 한다
//   scripts  scripts/ 의 JS 가 dist/ 를 require 한다 (타입 검사 밖에서 앱을 부른다)
//   cycle    값 import 로 이어진 파일 순환
import fs from "node:fs";
import path from "node:path";
import { ROOT, runCheck, sourceFiles } from "./baseline";

// 도메인의 단 — 낮은 단은 높은 단을 가져다 쓰지 않는다
const DOMAIN_TIER: Readonly<Record<string, number>> = {
  dex: 1,
  party: 2, box: 2,
  bag: 3, egg: 3, shop: 3, state: 3, find: 3, mail: 3, tutorial: 3, trade: 3, motion: 3,
  achievement: 4, notify: 4,
};
const DOMAINS = Object.keys(DOMAIN_TIER);
const LOW = ["shared", "platform"];
const MID = ["save", "online", "agents", "terminal"]; // 3층

// 폴더 → 가져다 쓸 수 있는 폴더. 여기 없는 폴더는 규칙이 없다(tools). 자기 폴더는 늘 된다
const LAYERS: Readonly<Record<string, readonly string[]>> = {
  shared: [],
  platform: ["shared"],
  ...Object.fromEntries(DOMAINS.map((d) => [d, ["shared", ...DOMAINS.filter((o) => DOMAIN_TIER[o]! <= DOMAIN_TIER[d]!)]])),
  save: [...LOW, ...DOMAINS],
  online: [...LOW, ...DOMAINS, "save"],
  agents: LOW,
  terminal: LOW,
  tx: [...LOW, ...DOMAINS, ...MID, "commands"],
  commands: [...LOW, ...DOMAINS, ...MID, "tx"],
  view: [...LOW, ...DOMAINS, ...MID],
  main: [...LOW, ...DOMAINS, ...MID, "tx", "commands", "view", "verify"],
  renderer: ["shared"],
  hooks: ["shared"],
  // cli 는 도메인(아래층)도 읽는다 — pokebuddy status 가 도감 번호(dex/dex-number)를 푼다 (도구 레인 T7b-3, 오케스트레이터에 알림)
  cli: [...LOW, ...DOMAINS, "save", "agents", "terminal"],
  verify: [],
};
// electron 을 값으로 가져와도 되는 main 밖 파일 — pokebuddy setup 이 설치 때 못 받은 Electron 을 그 순간 받는다(늦은 require("electron"))
const ELECTRON_OK = new Set(["src/cli/setup.ts"]);
// 누구나 읽을 수 있는 폴더
const OPEN_TO_ALL = new Set(["verify"]);

// src/main 안의 하위 폴더 규칙 — 원본은 worklog 의 code-structure 설계 10-main.md 1.2절(메인 레인이 정함, 2026-10-04)
// - value: 값으로도 타입으로도 가져다 쓸 수 있는 메인 폴더(이름 끝이 .ts 면 그 파일 하나). type: 타입만. 둘 다 아니면 어긋남
// - 같은 폴더는 늘 된다. 메인 꼭대기 파일(src/main/*.ts)은 art 말고 어느 폴더든 쓸 수 있다
// - 하위 폴더가 아닌 파일(꼭대기 파일)이 가져다 쓰는 것은 보지 않는다
const MAIN_SUB: Readonly<Record<string, { value: readonly string[] | "all"; type?: readonly string[]; top?: false; electron?: false }>> = {
  app: { value: "all" },
  services: { value: ["windows", "update", "app/dev-run.ts", "app/freeze.ts"] },
  menus: { value: ["windows", "art"], type: ["app", "stage"] },
  stage: { value: ["art", "windows"] },
  windows: { value: [], type: ["art"] },
  art: { value: [], top: false, electron: false }, // 경로는 src/platform/paths 를 바로 쓴다
  update: { value: [], electron: false }, // 엔진은 주입받는다 — electron 은 타입만
  manage: { value: ["windows", "art"], top: false }, // 설정창 — 게임·서비스·메뉴·화면 고르기는 deps 로 주입받는다. electron 은 값으로 쓴다(창을 만든다) (메인 레인 M6b, 2026-10-04)
};
// art 의 electron 예외 — 시스템 프록시·인증서를 따르게 net.fetch 를 조건부 require 한다(Electron 밖에서는 Node fetch)
const MAIN_ELECTRON_OK = new Set(["src/main/art/fetch.ts"]);

// main 하위 폴더 이름 — src/main/<폴더>/… 가 아니면 null(꼭대기 파일·main 밖)
const mainSubOf = (file: string): string | null => {
  const parts = file.split("/");
  return parts[1] === "main" && parts.length > 3 ? parts[2]! : null;
};

function mainSubViolation(imp: Import): string | null {
  const sub = mainSubOf(imp.from);
  const rule = sub ? MAIN_SUB[sub] : undefined;
  if (!sub || !rule) return null;
  const kind = imp.typeOnly ? " (type)" : "";
  if (imp.spec === "electron") {
    return rule.electron === false && !imp.typeOnly && !MAIN_ELECTRON_OK.has(imp.from) ? `main: ${imp.from} → electron (${sub}/ 는 electron 을 값으로 쓰지 않는다)` : null;
  }
  if (!imp.to || folderOf(imp.to) !== "main") return null;
  const target = mainSubOf(imp.to);
  if (target === sub) return null;
  if (!target) return rule.top === false ? `main: ${imp.from} → ${imp.to}${kind} (${sub}/ 는 메인 꼭대기 파일을 쓰지 않는다)` : null;
  if (rule.value === "all") return null;
  const rest = imp.to.slice("src/main/".length);
  const hit = (list: readonly string[] | undefined): boolean => (list ?? []).some((p) => (p.endsWith(".ts") ? rest === p : target === p));
  if (hit(rule.value) || (imp.typeOnly && hit(rule.type))) return null;
  return `main: ${imp.from} → ${imp.to}${kind}`;
}

interface Import {
  from: string; // 가져오는 파일
  spec: string;
  typeOnly: boolean;
  to: string | null; // 풀린 src 파일
}

const folderOf = (file: string): string => file.split("/")[1] ?? "";

function importsOf(file: string, text: string, all: ReadonlySet<string>): Import[] {
  const out: Import[] = [];
  const resolve = (spec: string): string | null => {
    if (!spec.startsWith(".")) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)).replace(/\.js$/, "");
    for (const c of [`${base}.ts`, `${base}.d.ts`, `${base}/index.ts`]) if (all.has(c)) return c;
    return null;
  };
  const push = (spec: string, typeOnly: boolean): void => {
    out.push({ from: file, spec, typeOnly, to: resolve(spec) });
  };
  // import … from "x" / export … from "x". 안의 이름이 전부 type 이면 타입만 가져온 것이다
  for (const m of text.matchAll(/^[ \t]*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/gm)) {
    const names = m[3] ?? "";
    const braces = /\{([^}]*)\}/.exec(names);
    const allTyped = braces ? braces[1]!.split(",").map((p) => p.trim()).filter(Boolean).every((p) => p.startsWith("type ")) && !/^[A-Za-z_$]/.test(names.trim()) : false;
    push(m[4]!, !!m[2] || allTyped);
  }
  for (const m of text.matchAll(/^[ \t]*import\s+["']([^"']+)["']/gm)) push(m[1]!, false);
  for (const m of text.matchAll(/^[ \t]*import\s+[A-Za-z0-9_$]+\s*=\s*require\(\s*["']([^"']+)["']\s*\)/gm)) push(m[1]!, false);
  for (const m of text.matchAll(/(?<![A-Za-z0-9_$.])require\(\s*["']([^"']+)["']\s*\)/g)) if (!out.some((i) => i.spec === m[1])) push(m[1]!, false);
  return out;
}

// 값 import 그래프의 순환 — 강하게 이어진 묶음(파일 둘 이상)
function cycles(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    on.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const group: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        on.delete(w);
        group.push(w);
        if (w === v) break;
      }
      if (group.length > 1) out.push(group.sort());
    }
  };
  for (const v of edges.keys()) if (!idx.has(v)) visit(v);
  return out;
}

export function findDepViolations(root: string = ROOT): string[] {
  const files = sourceFiles(root);
  const declared = new Set<string>([...files, ...sourceDeclarations(root)]);
  const found: string[] = [];
  const edges = new Map<string, string[]>();
  for (const file of files) {
    const folder = folderOf(file);
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const mine: string[] = [];
    for (const imp of importsOf(file, text, declared)) {
      const kind = imp.typeOnly ? " (type)" : "";
      const inMain = mainSubViolation(imp);
      if (inMain) found.push(inMain);
      if (folder !== "tools") {
        if (imp.spec === "electron" && !imp.typeOnly && folder !== "main" && !ELECTRON_OK.has(file)) found.push(`electron: ${file} → electron`);
        if (imp.spec.startsWith("node:") && !imp.typeOnly && (folder === "shared" || folder === "renderer")) found.push(`node: ${file} → ${imp.spec}`);
        if (imp.spec.startsWith(".") && !imp.to && !imp.spec.endsWith(".json")) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), imp.spec));
          if (!target.startsWith("src/")) found.push(`outside: ${file} → ${target}`);
        }
      }
      if (!imp.to) continue;
      const other = folderOf(imp.to);
      if (!imp.typeOnly && folder !== "tools" && other !== "tools") mine.push(imp.to);
      if (folder === "tools" || other === folder) continue;
      if (other === "tools") {
        found.push(`tools: ${file} → ${imp.to}${kind}`);
        continue;
      }
      const may = LAYERS[folder];
      if (may && !may.includes(other) && !OPEN_TO_ALL.has(other)) found.push(`layer: ${file} → ${imp.to}${kind}`);
      if (folder === "hooks" && !imp.typeOnly) found.push(`layer: ${file} → ${imp.to} (훅은 타입만 가져온다)`);
    }
    edges.set(file, mine);
  }
  for (const group of cycles(edges)) found.push(`cycle: ${group.join(" ⇄ ")}`);
  // scripts/ 의 JS 가 dist/ 를 부르는 줄 — 파일마다 한 건
  const scripts = path.join(root, "scripts");
  const walk = (dir: string): void => {
    for (const ent of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.(c?js)$/.test(ent.name)) {
        const text = fs.readFileSync(full, "utf8");
        const n = (text.match(/require\([^)\n]*dist[\\/"',\s]/g) ?? []).length;
        if (n) found.push(`scripts: ${path.relative(root, full).replace(/\\/g, "/")} 가 dist/ 를 ${n}번 require 한다`);
      }
    }
  };
  walk(scripts);
  return [...new Set(found)].sort();
}

function sourceDeclarations(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".d.ts")) out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  };
  walk(path.join(root, "src"));
  return out;
}

if (require.main === module) runCheck("deps", findDepViolations);
