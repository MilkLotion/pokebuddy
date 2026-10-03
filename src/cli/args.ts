// pokebuddy 인자 해석 — 파일·프로세스를 건드리지 않는 순수 함수라 따로 시험할 수 있다.
//
//   pokebuddy companion [buddy=값] [click=값] | companion stop
//   pokebuddy setup | uninstall | status | help
//
// 세션 펫(pokebuddy <종> · stop)은 2026-09-27 에 지웠다 — 펫은 동반자 하나다 (src/cli/run.ts).
// (예전 cli/args.js. 도구 레인 T7b-3 에서 TypeScript 로 옮겼다. 도움말 글자(USAGE)는 빌드 없이 답하려고 bin/pokebuddy 에 둔다)

// 옵션 이름 → 동반자 환경변수. 값이 비면 넘기지 않는다
const OPTIONS: Record<string, string | null> = {
  pet: null, // 받지 않는다 — 포켓몬은 첫 실행 선택창에서 고른다. 이름을 주면 까닭을 알린다
  buddy: "POKEBUDDY_BUDDY",
  click: "POKEBUDDY_CLICK_THROUGH",
};
// 없어진 옵션 — 모르는 옵션으로 멈추되 까닭을 한 줄 붙인다 (옛 그림 art · gif · fps · scale, 옛 세션 펫 dot · keep)
const ART_RETIRED = new Set(["art", "gif", "fps", "scale"]);
const SESSION_RETIRED = new Set(["dot", "keep"]);
const unknownOption = (a: string, raw: string): string => {
  const name = raw.toLowerCase();
  const why = ART_RETIRED.has(name) ? " — 그림은 PMD 한 가지만 쓴다" : SESSION_RETIRED.has(name) ? " — 세션 펫 옵션은 없어졌다. buddy · click 만 받는다" : "";
  return `알 수 없는 옵션: ${a}${why}`;
};
const ALIASES: Record<string, string> = { pokebuddy: "pet", pokemon: "pet" };
// 옵션 이름은 대소문자를 가리지 않는다 (예전 PowerShell 판이 그랬다). 프로토타입 이름(constructor 등)은 거른다
const optionName = (raw: string): string | null => {
  const name = raw.toLowerCase();
  const key = Object.hasOwn(ALIASES, name) ? ALIASES[name]! : name;
  return Object.hasOwn(OPTIONS, key) ? key : null;
};
// 하위 명령별로 받는 플래그 — 오타(--dryrun)가 조용히 "진짜 실행"이 되지 않게 모르는 플래그는 멈춘다
const SUBCOMMANDS: Record<string, string[]> = {
  setup: ["--dry-run", "--no-editor"],
  uninstall: ["--dry-run", "--purge", "--no-editor"],
  status: [],
  help: [],
};

export type CompanionOptions = Record<string, string>;

export interface ParsedArgs {
  kind: "companion" | "setup" | "uninstall" | "status" | "help" | "version" | "unknown" | string;
  opts?: CompanionOptions;
  flags?: Set<string>;
  rest?: string[];
  stop?: boolean;
  error?: string;
}

// 반환: { kind: "companion" | "setup" | "uninstall" | "status" | "help" | "version" | "unknown", opts, flags, rest, stop, error }
export function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];

  if (!args.length || args[0] === "-h" || args[0] === "--help") return { kind: "help" };
  if (args[0] === "-v" || args[0] === "--version") return { kind: "version" };
  // companion [stop] [buddy=값] [click=값] — 동반자. 포켓몬 이름은 첫 실행 선택창에서 고른다
  if (args[0] === "companion") {
    args.shift();
    const next: string | undefined = args[0]; // shift 뒤의 첫 낱말 — 위의 "companion" 판정과 따로 본다
    if (next === "stop") {
      if (args.length === 2 && ["-h", "--help"].includes(args[1]!)) return { kind: "help" };
      if (args.length !== 1) return { kind: "companion", error: "종료 명령은 추가 인자를 받지 않는다 — 사용: pokebuddy companion stop" };
      return { kind: "companion", stop: true };
    }
    const parsed = parseOptions(args);
    if (parsed.kind === "help") return { kind: "help" };
    if (parsed.error) return { kind: "companion", error: parsed.error };
    return { kind: "companion", opts: parsed.opts };
  }
  // 하위 명령 — 포켓몬 이름과 겹치지 않는 단어만 쓴다
  if (Object.hasOwn(SUBCOMMANDS, args[0]!)) {
    const kind = args.shift()!;
    const flags = new Set(args.filter((a) => a.startsWith("-")));
    const unknown = [...flags].filter((f) => !SUBCOMMANDS[kind]!.includes(f));
    if (unknown.length) return { kind: "unknown", error: `pokebuddy ${kind} 에 없는 옵션: ${unknown.join(" ")}` };
    const rest = args.filter((a) => !a.startsWith("-"));
    return { kind, flags, rest };
  }

  // 예전 문법(pokebuddy eevee · pokebuddy stop) — 세션 펫은 없어졌다
  return { kind: "unknown", error: `알 수 없는 명령: ${args[0]} — 펫은 동반자 하나다. 띄우기: pokebuddy companion` };
}

// 이름=값 · --이름 값 옵션을 읽는다
// 반환: { opts } | { error } | { kind: "help" }
function parseOptions(args: string[]): { opts?: CompanionOptions; error?: string; kind?: "help" } {
  const opts: CompanionOptions = {};
  const companionError = (key: string): string | null =>
    key === "pet" ? "동반자는 포켓몬 이름을 받지 않는다 — 첫 실행 때 선택창에서 고른다. 실행: pokebuddy companion" : null;

  while (args.length) {
    const a = args[0]!;
    if (a === "-h" || a === "--help") return { kind: "help" };

    const long = a.match(/^--([A-Za-z]+)$/);
    if (long) {
      const key = optionName(long[1]!);
      if (!key) return { error: unknownOption(a, long[1]!) };
      const error = companionError(key);
      if (error) return { error };
      if (args.length < 2 || args[1]!.startsWith("--") || ["-h", "-v"].includes(args[1]!)) return { error: `${a} 에 값이 없음` };
      opts[key] = args[1]!;
      args.splice(0, 2);
      continue;
    }
    // env(1) 처럼 이름=값 도 받는다
    const kv = a.match(/^([A-Za-z]+)=(.*)$/);
    if (kv) {
      const key = optionName(kv[1]!);
      if (!key) return { error: unknownOption(a, kv[1]!) };
      const error = companionError(key);
      if (error) return { error };
      opts[key] = kv[2]!;
      args.shift();
      continue;
    }
    if (a.startsWith("-") && a !== "--") return { error: `알 수 없는 옵션: ${a}` };
    // 옵션 모양이 아닌 단어 — 포켓몬 이름으로 보인다
    return { error: "동반자는 포켓몬 이름을 받지 않는다 — 첫 실행 때 선택창에서 고른다. 실행: pokebuddy companion" };
  }
  return { opts };
}

// 옵션 → 펫 프로세스에 넘길 환경변수 (빈 값은 빼서, 설정 파일 값을 덮지 않게 한다)
export function optionEnv(opts: Partial<CompanionOptions>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, name] of Object.entries(OPTIONS)) {
    if (name && opts[key] != null && opts[key] !== "") env[name] = String(opts[key]);
  }
  return env;
}
