// pokebuddy 인자 해석 — 파일·프로세스를 건드리지 않는 순수 함수라 따로 시험할 수 있다.
//
//   pokebuddy <펫> [이름=값 ...]
//   pokebuddy [--pet <펫>] [--dot 3] ...
//   pokebuddy companion [buddy=값] [click=값] | companion stop
//   pokebuddy stop [펫 ...|all] | setup | uninstall | status | help
//
// pokebuddy 는 명령을 실행하지 않는다 — 터미널에서 pokebuddy eevee, CLI LLM 안에서 !pokebuddy eevee 로 그 세션에 펫을 붙인다 (cli/run.js).
// 옵션 뒤에 남는 단어는 예전 문법(pokebuddy eevee codex)이거나 따옴표 없는 쉼표가 쪼갠 펫 이름이라 멈추고 알린다.

const USAGE = `사용 — 터미널에서 그대로, CLI LLM(claude·codex·gemini) 안에서는 앞에 ! 를 붙인다:
  pokebuddy <펫> [이름=값 ...]                              이 세션에 펫 더하기 — 떠 있는 펫 이름이면 그 펫을 바꾼다
  pokebuddy stop [펫 ...|all]                               이 세션의 펫 내리기 — 여러 마리면 체크리스트로 고른다
  pokebuddy companion [buddy=값] [click=값]                 동반자 띄우기 — 기기당 하나, 항상 위, 맨 앞 터미널 창을 따른다
  pokebuddy companion stop                                  동반자 내리기
  pokebuddy setup [--dry-run] [--no-editor]                 CLI LLM 상태 훅·에디터 확장 설치
  pokebuddy uninstall [--dry-run] [--purge] [--no-editor]   설치한 것 되돌리기 (--purge 면 설정·캐시까지)
  pokebuddy status [펫]                                     지금 판정 상태와 PMD 저작자 보기
  pokebuddy game --help                                    육성·상점·진화 명령 보기
  pokebuddy trade <교환 링크>                               친구 교환 링크로 참가 — 떠 있는 동반자에 보낸다

예:
  pokebuddy eevee                     터미널 — 셸이 끝나면 펫도 사라진다
  !pokebuddy eevee                    CLI LLM 안 — 그 CLI 가 끝나면 사라지고, 일하는 상태에 따라 동작이 바뀐다
  !pokebuddy eevee dot=3 buddy=calm   크게, 덜 돌아다니게 (떠 있던 펫이 이걸로 바뀐다)
  !pokebuddy zapdos+pikachu           여러 마리 (+ 또는 쉼표 — PowerShell 에서 쉼표는 따옴표로 감싼다)
  !pokebuddy stop pikachu             한 마리 내리기 (!pokebuddy stop all 은 전부)
  pokebuddy companion                 동반자 — 어느 터미널을 보든 그 창의 에이전트 상태를 따른다. 트레이로 끝낸다

옵션 (이름=값 · --이름 값):
  dot=<숫자>   buddy=on|calm|off   keep=on|off   click=on|off
  동반자는 buddy · click 만 받는다 — 크기는 저장된 마리 크기를 쓴다 (dot · keep 은 세션 펫 옵션)`;

// 옵션 이름 → 펫 환경변수. 값이 비면 넘기지 않는다
const OPTIONS = {
  pet: null, // 펫 이름은 환경변수가 아니라 마리마다 따로 넘긴다
  buddy: "POKEBUDDY_BUDDY",
  dot: "POKEBUDDY_DOT_SIZE",
  keep: "POKEBUDDY_KEEP_VISIBLE",
  click: "POKEBUDDY_CLICK_THROUGH",
};
// 없어진 그림 옵션 — 모르는 옵션으로 멈추되 까닭을 한 줄 붙인다 (옛 art · gif · fps · scale)
const ART_RETIRED = new Set(["art", "gif", "fps", "scale"]);
const unknownOption = (a, raw) => `알 수 없는 옵션: ${a}${ART_RETIRED.has(raw.toLowerCase()) ? " — 그림은 PMD 한 가지만 쓴다" : ""}`;
const ALIASES = { pokebuddy: "pet", pokemon: "pet" };
// 옵션 이름은 대소문자를 가리지 않는다 (예전 PowerShell 판이 그랬다). 프로토타입 이름(constructor 등)은 거른다
const optionName = (raw) => {
  const name = raw.toLowerCase();
  const key = Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
  return Object.hasOwn(OPTIONS, key) ? key : null;
};
// 하위 명령별로 받는 플래그 — 오타(--dryrun)가 조용히 "진짜 실행"이 되지 않게 모르는 플래그는 멈춘다
const SUBCOMMANDS = {
  stop: ["--all"],
  setup: ["--dry-run", "--no-editor"],
  uninstall: ["--dry-run", "--purge", "--no-editor"],
  status: [],
  help: [],
};

// 반환: { kind: "run" | "companion" | "stop" | "setup" | "uninstall" | "status" | "help" | "version", opts, flags, rest, stop, error }
function parseArgs(argv) {
  const args = [...argv];

  if (args[0] === "-h" || args[0] === "--help") return { kind: "help" };
  if (args[0] === "-v" || args[0] === "--version") return { kind: "version" };
  // companion [stop] [buddy=값] [click=값] — 동반자. 포켓몬 이름은 첫 실행 선택창에서 고른다
  if (args[0] === "companion") {
    args.shift();
    if (args[0] === "stop") {
      if (args.length === 2 && ["-h", "--help"].includes(args[1])) return { kind: "help" };
      if (args.length !== 1) return { kind: "companion", error: "종료 명령은 추가 인자를 받지 않는다 — 사용: pokebuddy companion stop" };
      return { kind: "companion", stop: true };
    }
    const parsed = parseOptions(args, { allowPet: false });
    if (parsed.kind === "help") return parsed;
    if (parsed.error) return { kind: "companion", error: parsed.error };
    return { kind: "companion", opts: parsed.opts };
  }
  // 하위 명령 — 포켓몬 이름과 겹치지 않는 단어만 쓴다
  if (Object.hasOwn(SUBCOMMANDS, args[0])) {
    const kind = args.shift();
    const flags = new Set(args.filter((a) => a.startsWith("-")));
    const unknown = [...flags].filter((f) => !SUBCOMMANDS[kind].includes(f));
    if (unknown.length) return { kind: "run", error: `pokebuddy ${kind} 에 없는 옵션: ${unknown.join(" ")}` };
    const rest = args.filter((a) => !a.startsWith("-"));
    return { kind, flags, rest };
  }

  const parsed = parseOptions(args);
  if (parsed.kind === "help") return parsed;
  if (parsed.error) return { kind: "run", error: parsed.error };
  if (!parsed.opts.pet) return { kind: "run", error: "펫 이름이 없음 — 사용: pokebuddy eevee (CLI LLM 안에서는 !pokebuddy eevee)" };
  return { kind: "run", opts: parsed.opts };
}

// 펫 이름과 이름=값 · --이름 값 옵션을 읽는다 — 펫 띄우기와 동반자가 같은 문법을 쓴다
// 반환: { opts } | { error } | { kind: "help" }
function parseOptions(args, { allowPet = true } = {}) {
  const opts = {};
  const companionError = (key) => {
    if (allowPet) return null;
    if (key === "pet") return "동반자는 포켓몬 이름을 받지 않는다 — 첫 실행 때 선택창에서 고른다. 실행: pokebuddy companion";
    if (!["buddy", "click"].includes(key)) return `동반자에서 지원하지 않는 옵션: ${key} — buddy · click만 사용한다`;
    return null;
  };
  // 첫 인자가 옵션도 이름=값 도 아니면 펫 이름으로 받는다 (pokebuddy eevee dot=3)
  if (allowPet && args.length && !args[0].startsWith("-") && !args[0].includes("=")) opts.pet = args.shift();

  while (args.length) {
    const a = args[0];
    if (a === "-h" || a === "--help") return { kind: "help" };

    const long = a.match(/^--([A-Za-z]+)$/);
    if (long) {
      const key = optionName(long[1]);
      if (!key) return { error: unknownOption(a, long[1]) };
      const error = companionError(key);
      if (error) return { error };
      if (args.length < 2 || args[1].startsWith("--") || ["-h", "-v"].includes(args[1])) return { error: `${a} 에 값이 없음` };
      opts[key] = args[1];
      args.splice(0, 2);
      continue;
    }
    // env(1) 처럼 이름=값 도 받는다
    const kv = a.match(/^([A-Za-z]+)=(.*)$/);
    if (kv) {
      const key = optionName(kv[1]);
      if (!key) return { error: unknownOption(a, kv[1]) };
      const error = companionError(key);
      if (error) return { error };
      opts[key] = kv[2];
      args.shift();
      continue;
    }
    if (a.startsWith("-") && a !== "--") return { error: `알 수 없는 옵션: ${a}` };
    // 옵션 모양이 아닌 단어 — 예전 문법(pokebuddy eevee codex · pokebuddy eevee -- claude)이거나,
    // PowerShell 이 따옴표 없는 zapdos,pikachu 를 쪼갠 것
    const word = a === "--" ? args[1] || a : a;
    if (!allowPet) return { error: "동반자는 포켓몬 이름을 받지 않는다 — 첫 실행 때 선택창에서 고른다. 실행: pokebuddy companion" };
    const pet = opts.pet || "eevee";
    return {
      error:
        `알 수 없는 인자: ${word} — pokebuddy 는 명령을 실행하지 않는다. 명령(CLI)을 먼저 켜고 그 안에서 !pokebuddy ${pet} 로 띄운다\n` +
        `  ${word} 가 펫 이름이었다면 ${pet}+${word} 처럼 + 로 잇는다`,
    };
  }
  return { opts };
}

// 옵션 → 펫 프로세스에 넘길 환경변수 (빈 값은 빼서, 설정 파일 값을 덮지 않게 한다)
function optionEnv(opts) {
  const env = {};
  for (const [key, name] of Object.entries(OPTIONS)) {
    if (name && opts[key] != null && opts[key] !== "") env[name] = String(opts[key]);
  }
  return env;
}

// 펫 이름 목록 — 쉼표와 + 둘 다 받는다. PowerShell 은 따옴표 없는 a,b 를 배열로 쪼개므로 + 가 안전하다
const petList = (pet) =>
  String(pet || "")
    .split(/[,+]/)
    .map((s) => s.trim())
    .filter(Boolean);

module.exports = { parseArgs, optionEnv, petList, USAGE };
