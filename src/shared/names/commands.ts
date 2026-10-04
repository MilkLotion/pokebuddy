// 명령 이름의 원본 — 표면(우클릭·트레이·설정창·CLI)이 보내는 명령과 거래 실행기의 거래 이름을 한 표에 둔다.
// 타입(CommandName·TxName)과 목록(느린 명령, 멈춘 동안 받는 명령 등)은 이 표에서 얻는다. 다른 파일은 이름을 글자로 다시 적지 않는다.
// 설계는 worklog/records/code-structure/design/40-contracts-save-online.md 3.1절
//
// 값 모듈이다. 다른 파일을 가져다 쓰지 않는다 — 메인·렌더러·CLI 가 모두 읽는다

// 명령 하나의 속성
//   via       명령이 닿는 곳. tx 거래 실행기 · trade 교환 세션 · app 메인이 직접 처리
//   cli       pokebuddy game 이 받는다
//   slow      명령 통로의 보낸 쪽이 길게 기다린다 (그림 받기·서버)
//   detached  명령 통로의 처리 줄 밖에서 돈다 (서버를 탄다)
//   haltOpen  게임이 멈춘 동안에도 받는다 (저장을 바꾸지 않는다)
//   internal  표면이 보내지 못한다. 메인의 서비스(교환·우편)만 실행기에 낸다
export interface CommandSpec {
  via: "tx" | "trade" | "app";
  cli?: true;
  slow?: true;
  detached?: true;
  haltOpen?: true;
  internal?: true;
}

export const COMMANDS = {
  // 돌봄·진화
  feed: { via: "tx", cli: true },
  play: { via: "tx", cli: true },
  evolve: { via: "tx", cli: true, slow: true },
  // 파티
  "party.show": { via: "tx", cli: true },
  "party.hide": { via: "tx", cli: true },
  "party.place": { via: "tx" },
  "party.swap": { via: "tx" },
  "party.move": { via: "tx" },
  "party.keep": { via: "tx" },
  "party.preset": { via: "tx" },
  "party.preset.rename": { via: "tx" },
  // 박스
  "box.sort": { via: "tx" },
  "box.move": { via: "tx" },
  "box.rename": { via: "tx" },
  "box.order": { via: "tx" },
  // 알·가방·상점
  "egg.open": { via: "tx" },
  "bag.use": { via: "tx" },
  "bag.sell": { via: "tx" },
  "shop.buy": { via: "tx", cli: true, slow: true },
  // 업적·튜토리얼
  "achievement.claim": { via: "tx" },
  "tutorial.skip": { via: "tx" },
  "tutorial.done": { via: "tx" },
  // 개체
  "pet.set": { via: "tx", cli: true },
  "pet.form": { via: "tx", cli: true },
  "pet.sell": { via: "tx" },
  "starter.pick": { via: "tx" },
  // 설정 — 저장 설정은 settings.set(실행기), 창 표시 두 항목(hidden·clickThrough)은 display.set(메인, src/main/commands.ts). 한 이름이 한 길만 탄다
  "settings.set": { via: "tx" },
  "display.set": { via: "app" },
  // 앱
  snapshot: { via: "app", cli: true, haltOpen: true },
  quit: { via: "app", haltOpen: true },
  // 친구 교환 — 조작은 서버를 탄다. 상태 보기(trade.status)는 타지 않는다
  "trade.create": { via: "trade", cli: true, slow: true, detached: true },
  "trade.join": { via: "trade", cli: true, slow: true, detached: true },
  "trade.offer": { via: "trade", cli: true, slow: true, detached: true },
  "trade.ready": { via: "trade", cli: true, slow: true, detached: true },
  "trade.unready": { via: "trade", cli: true, slow: true, detached: true },
  "trade.leave": { via: "trade", cli: true, slow: true, detached: true },
  "trade.status": { via: "trade", cli: true, haltOpen: true },
  // 실행기에만 있는 거래 — 교환 세션과 우편함이 낸다
  "trade.lock": { via: "tx", internal: true },
  "trade.unlock": { via: "tx", internal: true },
  "trade.apply": { via: "tx", internal: true },
  "mail.apply": { via: "tx", internal: true },
  "mail.read": { via: "tx", internal: true },
} as const satisfies Record<string, CommandSpec>;

// 표의 이름 전부 (internal 포함)
export type AnyCommandName = keyof typeof COMMANDS;

// 표면이 보낼 수 있는 명령
export type CommandName = {
  [K in AnyCommandName]: (typeof COMMANDS)[K] extends { internal: true } ? never : K;
}[AnyCommandName];

// 거래 실행기의 거래 이름
export type TxName = {
  [K in AnyCommandName]: (typeof COMMANDS)[K] extends { via: "tx" } ? K : never;
}[AnyCommandName];

export type CommandFlag = "cli" | "slow" | "detached" | "haltOpen" | "internal";

const SPECS: Readonly<Record<string, CommandSpec>> = COMMANDS;

// 그 속성이 켜진 명령인가 — 모르는 이름이면 거짓
export const hasCommandFlag = (name: string, flag: CommandFlag): boolean => SPECS[name]?.[flag] === true;

// 그 속성이 켜진 명령의 이름 — 표의 순서
export const commandNamesWhere = (flag: CommandFlag): AnyCommandName[] =>
  (Object.keys(COMMANDS) as AnyCommandName[]).filter((name) => hasCommandFlag(name, flag));

// 명령을 보낸 곳
const COMMAND_SOURCES = ["menu", "tray", "settings", "cli", "vscode", "pet"] as const;
export type CommandSource = (typeof COMMAND_SOURCES)[number];
export const isCommandSource = (v: unknown): v is CommandSource => typeof v === "string" && (COMMAND_SOURCES as readonly string[]).includes(v);

// 거래가 아닌 쓰기의 이름 — 줍기로 포켓몬을 데려왔다. 클라우드에 바로 올리는 쓰기를 가를 때 쓴다
export const FIND_POKEMON = "find.pokemon";
export type WriteName = TxName | typeof FIND_POKEMON;
