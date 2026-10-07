// 관리 창만 띄워 보는 개발용 실행기 — npm run build 뒤 `npx electron dist/tools/dev/dev-manage.js`
// (예전 scripts/dev-manage.cjs. 앱 코드를 부르므로 타입 검사를 받게 src/tools 로 옮겼다)
//
// 앱 전체를 띄우지 않는다. 임시 폴더에 보기용 저장을 만들고 관리 창 하나만 연다.
// 사용자의 저장(~/.claude/pokebuddy)과 CLI 설정은 건드리지 않는다. HOME 도 임시 폴더로 바꾼다 — 설정의 "연결" 이 훅을 쓰기 때문이다.
// `--shot <파일>` 을 주면 창을 그려 PNG 로 저장하고 끝낸다. 화면을 눈으로 확인할 때 쓴다.
// `--tab <파티|박스|도감|상점|가방>` 을 주면 그 탭을 눌러 놓고 찍는다.
// `--detail` 을 주면 첫 칸을 눌러 개체 상세까지 찍는다.
// `--click <선택자>` 를 주면 그 요소를 한 번 눌러 놓고 찍는다. 여러 번 주면 순서대로 누른다.
// `--scroll <선택자>` 를 주면 그 요소가 보이게 스크롤한다.
// `--input <선택자>=<글자>` 를 주면 누른 뒤에 그 입력칸에 한 글자씩 넣는다. 다 넣은 뒤 포커스가 있는 요소의 id 를 출력한다.
// `--click-text <글자>` 를 주면 그 글자인 첫 단추를 누른다. `--click` 과 섞어 적은 순서대로 한다.
// `--pet-click-text <글자>` 를 주면 파티 상세 기기 창에서 그 글자로 시작하는 첫 단추를 누른다(예: 진화). `--detail` 뒤에 쓴다.
// `--pet-click <선택자>` 를 주면 파티 상세 기기 창에서 그 요소를 누른다(예: .mega-stone). `--detail` 이나 칸을 누른 뒤에 쓴다.
// `--shop-click <선택자>`·`--bag-click <선택자>` 는 상점·가방 기기 창에서 그 요소를 누른다(예: button.more). `--pet-click` 과 같은 방식이다.
// `--shop-click-text <글자>` 를 주면 상점 기기 창에서 그 글자인 마지막 단추를 누른다(예: +, 최대, 구매). 상품 줄을 누른 뒤에 쓴다.
// `--bag-click-text <글자>` 를 주면 가방 기기 창에서 그 글자인 마지막 단추를 누른다(예: 판매, +, 사용 — 같은 글자면 바닥 주 단추). 가방 칸을 누른 뒤에 쓴다.
// `--drag <출발 선택자> <도착 선택자>` 를 주면 창 안에 마우스 누름·움직임·뗌을 넣어 끌어 놓는다(박스 칸 옮기기). OS 마우스는 쓰지 않는다.
// `--drag-hold <출발 선택자> <도착 선택자>` 는 `--drag` 와 같되 떼지 않는다 — 끄는 도중의 화면(반투명 사본, 놓을 칸 표시)을 찍는다.
// `--wait <ms>` 를 주면 찍기 전에 그만큼 더 기다린다.
// `--linger <ms>` 를 주면 찍은 뒤 창을 그만큼 열어 둔다.
// `--close` 를 주면 찍은 뒤 관리 창을 닫고 처리되지 않은 오류가 있었는지 알린다.
// `--dex-shot <파일>` 을 주면 도감 기기 창도 PNG 로 저장한다. 도감 칸을 누른 뒤에 쓴다.
// `--pet-shot <파일>` 을 주면 파티 상세 기기 창도 PNG 로 저장한다. `--detail` 이나 칸을 누른 뒤에 쓴다.
// `--shop-shot <파일>` 을 주면 상점 기기 창도 PNG 로 저장한다. 상품 줄을 누른 뒤에 쓴다.
// `--bag-shot <파일>` 을 주면 가방 기기 창도 PNG 로 저장한다. 가방 칸을 누른 뒤에 쓴다.
// `--party-shot <파일>` 을 주면 파티 기기 창(교체 화면)도 PNG 로 저장한다. 파티 탭의 `교체` 를 누른 뒤에 쓴다.
// `--battle-click <선택자>` 는 배틀 파티 상세 기기 창에서 그 요소를 누른다(예: .help, .move .pick). 배틀 칸을 누른 뒤에 쓴다.
// `--battle-shot <파일>` 을 주면 배틀 파티 상세 기기 창도 PNG 로 저장한다. 모험 탭의 배틀 칸을 누른 뒤에 쓴다.
// `--route <json>` 을 주면 알림 배너의 `바로가기` 처럼 그 목적지로 연다. 예: '{"to":"pet","petId":"p1"}'
// `--save-failing` 을 주면 저장이 이어서 실패하는 채로 연다 — 이어진 저장 실패 안내 확인용. 임시 파일 자리를 폴더로 막고, 끝날 때 푼다
// `--tut <id>=<done|skipped|none>` 을 주면 그 튜토리얼 상태로 연다(여러 번). 새 기능 튜토리얼 화면을 차례로 볼 때 쓴다
// `--mail` 을 주면 가짜 서버로 우편함을 띄운다(Figma `우편함 시안` 의 편지 넷). `--mail-signed-in` 이면 로그인한 계정으로 본다
// `--mail-fail <코드>` 를 주면 `--mail` 의 가짜 서버가 받기에 그 실패 코드를 돌려준다(예: MAIL_EXPIRED)
// `--fail <명령>=<까닭>` 을 주면 그 명령을 실행하지 않고 { ok: false, reason: <까닭> } 을 돌려준다(여러 번). 실패 문구 확인용. 예: --fail shop.buy=daycare-full
// `--seed <수>` 를 주면 Math.random 을 그 씨앗의 고정 난수로 바꾼다 — 알 열기·장면의 성별·성격이 실행마다 같다
// `--slow <ms>` 를 주면 명령의 답을 그만큼 늦춘다 — 처리 중 표시(단추·칸의 점 세 개) 확인용
// `--update-ready` 를 주면 설정 바닥을 "새 버전 준비됨" 으로 연다. `다시 시작` 은 답하지 않고 기다린다 — "다시 시작하는 중" 확인용
// `--notes` 를 주면 가짜 패치노트 둘을 준다(설정 바닥의 `패치노트` 단추와 목록, 처음 열 때 한 번 뜨는 새 버전 노트)
// `--scene <이름>` 을 주면 공용 틀의 장면(harness/scenes.ts)을 저장에 입힌다(여러 번). 예: done-all(튜토리얼 모두 끝남), rich(포인트 넉넉)
// `--docs` 를 주면 문서 캡처용 저장으로 연다 — 파티 4마리를 모두 꺼내 두고 숨긴 마리가 없다. 교환 모달은 서버 없이 첫 화면을 보인다 (docs/images/README.md)
// `--trade <offer|blocked|ready|error|empty>` 를 주면 교환 서버 없이 교환 모달의 제안·확정 화면을 보인다. 박스 탭의 `교환` 단추를 누른 뒤에 쓴다
// `--eval <js>` 를 주면 찍기 직전에 관리 창에서 그 식을 돌려 결과를 `eval: …` 로 출력한다 — 스크롤 높이 같은 값을 잴 때 쓴다
// `--agents-connected` 를 주면 임시 HOME 의 Claude Code 에 우리 훅을 등록해 연결 탭의 `연결됨` 을 보인다
// `--agents-outdated` 를 주면 임시 HOME 의 codex 에 옛 등록(PreToolUse 포함)을 깔아 연결 탭의 "갱신 필요" 를 보인다
import fs from "node:fs";
import path from "node:path";
import { app, type WebContents } from "electron";
import type { SaveV3 } from "../../shared/save-v3";
import { seededRand } from "../harness/clock";
import { argAfter, argsAfter, hasFlag, windowOf } from "../harness/shot";
import { makeTmp } from "../harness/tmp-dir";

// --seed — 장면·알 열기가 부르는 Math.random 을 고정한다. 앱 모듈을 읽기 전에 바꾼다
const seedArg = argAfter("--seed");
if (seedArg != null) Math.random = seededRand(Number(seedArg) || 0);

// POKEBUDDY_DEVICE_DUMP=<파일> — 관리 창이 기기 창에 보내는 모델(manage:<기기>-open 의 인자)과 메인이 기기 창에 보내는 값(<기기>dev:show)을 받은 순서대로 그 파일에 적는다.
// 기기 창 모델 A/B 비교(worklog/records/code-structure/ab/device-dump.cjs)가 쓴다. 그림 data URI 같은 긴 글자는 길이와 앞 32자만 남긴다.
// 환경변수가 없으면 아무것도 하지 않는다. 관리 창이 처리기를 걸기 전이어야 해서 앱 모듈을 읽기 전에 감싼다
const deviceDump = process.env.POKEBUDDY_DEVICE_DUMP;
if (deviceDump) {
  const { ipcMain } = require("electron") as typeof import("electron");
  const records: { channel: string; args: unknown }[] = [];
  const shrink = (v: unknown): unknown => {
    if (typeof v === "string") return v.length > 200 ? `[글자 ${v.length}] ${v.slice(0, 32)}` : v;
    if (Array.isArray(v)) return v.map(shrink);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shrink(x)]));
    return v;
  };
  const push = (channel: string, args: unknown[]): void => {
    records.push({ channel, args: shrink(args) });
    fs.writeFileSync(deviceDump, JSON.stringify(records, null, 1));
  };
  const record = <H extends (event: never, ...args: never[]) => unknown>(channel: string, handler: H): H => {
    if (!/^manage:[a-z-]+-open$/.test(channel)) return handler;
    return ((event: never, ...args: never[]) => {
      push(channel, args);
      return handler(event, ...args);
    }) as H;
  };
  const on = ipcMain.on.bind(ipcMain);
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.on = ((channel: string, listener: Parameters<typeof on>[1]) => on(channel, record(channel, listener))) as typeof ipcMain.on;
  ipcMain.handle = ((channel: string, listener: Parameters<typeof handle>[1]) => handle(channel, record(channel, listener))) as typeof ipcMain.handle;
  // 메인이 기기 창에 보내는 값(<기기>dev:show)도 적는다 — 그림·붙은 쪽을 더한 뒤의 값이다
  app.on("web-contents-created", (_event, wc) => {
    const send = wc.send.bind(wc);
    wc.send = (channel: string, ...args: unknown[]): void => {
      if (/^[a-z]+dev:show$/.test(channel)) push(channel, args);
      send(channel, ...args);
    };
  });
  fs.writeFileSync(deviceDump, "[]");
}

const root = path.join(__dirname, "..", "..", "..");
const dir = makeTmp("dev-manage");

// 앱 모듈은 HOME 을 바꾼 뒤에 읽는다. 경로를 읽을 때 HOME 을 보기 때문이다 (src/tools/selftest/selftest-agents.ts 와 같은 방식).
// Electron 이 준비되기 전에 HOME 을 바꾸면 Electron 이 뜨지 않는다. 그래서 준비된 뒤에 바꾼다
function loadApp() {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  // CLI 설정 폴더도 임시 HOME 안으로 — 사용자 환경 변수가 연결 탭을 진짜 ~/.codex·~/.claude 로 돌리지 않게
  process.env.CODEX_HOME = path.join(dir, ".codex");
  delete process.env.CLAUDE_CONFIG_DIR;
  // --agents-connected — 임시 HOME 에 Claude Code 연결을 만들어 연결 탭에 `연결됨` 을 보인다(문서 캡처 connect)
  if (hasFlag("--agents-connected")) {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    (require("../../agents/hooks") as typeof import("../../agents/hooks")).connectCli("claude");
  }
  if (hasFlag("--agents-outdated")) {
    const hook = `node "${path.join(dir, ".claude", "scripts", "hooks", "pokebuddy-state.cjs")}" --cli codex`;
    const events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "Interrupt", "SessionEnd"];
    fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
    fs.writeFileSync(path.join(process.env.CODEX_HOME, "hooks.json"), JSON.stringify({ hooks: Object.fromEntries(events.map((e) => [e, [{ hooks: [{ type: "command", command: hook, timeout: 5 }] }]])) }));
  }
  return {
    createGame: (require("../../tx/game") as typeof import("../../tx/game")).createGame,
    petName: (require("../../view/text") as typeof import("../../view/text")).petName,
    createManage: (require("../../main/manage/window") as typeof import("../../main/manage/window")).createManage,
    paths: require("../../main/windows/files") as typeof import("../../main/windows/files"),
    store: require("../../save/save-file") as typeof import("../../save/save-file"),
    empty: (require("../../save/normalize") as typeof import("../../save/normalize")).emptySave,
    createMailInbox: (require("../../online/mail-inbox") as typeof import("../../online/mail-inbox")).createMailInbox,
    mailScreenOf: (require("../../view/mail") as typeof import("../../view/mail")).mailScreenOf,
  };
}

const shotFile = argAfter("--shot");
const tabLabel = argAfter("--tab");
const routeArg = argAfter("--route");

// 보기용 저장 — 꺼낸 마리, 숨긴 마리, 빈 칸, 잠긴 칸, 박스, 알, 가방이 한 번에 보이게 만든다.
// 개체는 손으로 적은 모양이다(예전 그대로 — 캡처 기준과 같아야 한다). boredomProgressMs 가 없고 daily.date 가 "" 인 것은
// 앱의 새 개체(src/party/create.ts newPet)와 다르다(코드 구조 조사 B5). 고칠 때는 화면이 바뀌므로 따로 커밋한다
function seed(empty: (now: number) => SaveV3, now: number): SaveV3 {
  const save = empty(now);
  save.points.balance = 1240;
  const pet = (id: string, species: string, over: Record<string, unknown>) =>
    ({
      id,
      species,
      shiny: false,
      nature: "hardy",
      size: 2,
      level: 12,
      exp: 2000,
      affinity: 80,
      affinityProgressMs: 0,
      fullness: 72,
      fullnessProgressMs: 0,
      boredom: 20,
      feedCooldownMs: 0,
      playCooldownMs: 0,
      buffs: [],
      home: { dx: -24, dy: -60 },
      since: now,
      stage: 0,
      evolved: [],
      daily: { date: "", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
      ...over,
    }) as unknown as SaveV3["pets"][number];
  save.pets.push(pet("p1", "pikachu", { level: 12, affinity: 85, fullness: 72, gender: "male" }));
  // 2번 칸 — 배고픔과 버프 둘(든든함·신남)이 함께 보이게. 상태 배지 줄 확인용 (2026-09-30)
  const buffs = [{ kind: "premium-food", remainMs: 3_600_000 }, { kind: "long-play", remainMs: 600_000 }];
  save.pets.push(pet("p2", "charmander", { level: 5, nature: "brave", affinity: 40, fullness: 33, feedCooldownMs: 90_000, gender: "female", buffs }));
  save.starterPetId = "p1";
  save.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  save.party.slots[1] = { state: "pokemon", petId: "p2", hidden: true };
  save.party.slots[2] = { state: "empty" }; // 빈 칸도 한 번에 보이게 상점 칸 하나를 열어 둔다

  // 박스 — 앞의 몇 칸을 채워 격자와 쪽 넘김을 본다
  const kept: [string, string, number][] = [
    ["p3", "bulbasaur", 9],
    ["p4", "squirtle", 14],
    ["p5", "eevee", 7],
    ["p6", "machop", 21],
  ];
  kept.forEach(([id, species, level], i) => {
    save.pets.push(pet(id, species, { level, shiny: id === "p5" }));
    save.boxes[0]!.slots[i] = id;
  });

  // 알 — 하나는 준비 완료, 하나는 진행 중
  const egg = (o: Record<string, unknown>) => o as unknown as SaveV3["eggs"][number];
  save.eggs.push(egg({ id: "e1", kind: "random", boughtAt: now, remainMs: 0, ready: true, candidates: ["pikachu", "eevee"], careCooldownMs: 0, actions: { pat: 3, song: 1 } }));
  save.eggs.push(egg({ id: "e2", kind: "ancient-stone", boughtAt: now, remainMs: 180_000, ready: false, candidates: ["omanyte", "kabuto"], careCooldownMs: 0, actions: { pat: 0, song: 2 } }));

  save.bag = { "premium-food": 3, toy: 2, "rare-candy": 1, "fire-stone": 1, mint: 2 };

  // 업적 — 하나는 받지 않은 보상으로 둔다. 헤더 점과 `보상 받기` 를 같이 본다
  save.achievements = { "show-two": { achievedAt: now, claimedAt: null } };

  const seen = ["pikachu", "charmander", "bulbasaur", "squirtle", "eevee", "machop"];
  save.dex = { unlocked: seen, obtained: seen, shinyObtained: ["eevee"], discovered: {} } as unknown as SaveV3["dex"];
  return save;
}

// 기기 창 안의 요소를 누른다 — 칸을 누른 직후에는 기기 창이 아직 없거나 그리는 중이라 요소가 생길 때까지 잠깐 기다린다
async function clickInDevice(page: string, selector: string): Promise<void> {
  for (let n = 0; n < 20; n += 1) {
    const w = windowOf(page);
    const hit = w ? await w.webContents.executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (b) b.click(); return !!b; })()`).catch(() => false) : false;
    if (hit) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 800));
}

// 두 요소의 가운데를 잇는 마우스 입력 — 포인터 이벤트로 끄는 박스 칸용. release 가 거짓이면 떼지 않는다
async function dragIn(wc: WebContents, from: string, to: string, release: boolean): Promise<void> {
  const center = (sel: string) => `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`;
  const [x0, y0] = (await wc.executeJavaScript(center(from))) as [number, number];
  const [x1, y1] = (await wc.executeJavaScript(center(to))) as [number, number];
  wc.sendInputEvent({ type: "mouseMove", x: x0, y: y0 });
  wc.sendInputEvent({ type: "mouseDown", x: x0, y: y0, button: "left", clickCount: 1 });
  for (let k = 1; k <= 10; k++) {
    wc.sendInputEvent({ type: "mouseMove", x: Math.round(x0 + ((x1 - x0) * k) / 10), y: Math.round(y0 + ((y1 - y0) * k) / 10), button: "left", modifiers: ["leftButtonDown" as never] }); // 예전 글자 그대로 — Electron 은 대소문자를 가리지 않는다
    await new Promise((r) => setTimeout(r, 30));
  }
  if (release) wc.sendInputEvent({ type: "mouseUp", x: x1, y: y1, button: "left", clickCount: 1 });
  await new Promise((r) => setTimeout(r, 800));
}

// 기기 창 찍기 — 앞의 것이 끝난 뒤 차례로 찍는다(pet → dex → shop → bag → party)
const DEVICE_SHOTS: [flag: string, page: string, label: string][] = [
  ["--pet-shot", "pet.html", "pet"],
  ["--dex-shot", "dex.html", "dex"],
  ["--shop-shot", "shop.html", "shop"],
  ["--bag-shot", "bag.html", "bag"],
  ["--party-shot", "party.html", "party"],
  ["--battle-shot", "battle.html", "battle"],
];

void app.whenReady().then(async () => {
  const file = path.join(dir, "save-v3.json");
  const { createGame, petName, createManage, paths, store, empty, createMailInbox, mailScreenOf } = loadApp();
  const seeded = seed(empty, Date.now());
  // --tut <id>=<done|skipped|none> — 튜토리얼 상태를 정해 둔다(여러 번). 새 기능 튜토리얼 화면을 차례로 보려고
  for (const pair of argsAfter("--tut")) {
    const [id, state] = pair.split("=");
    if (id && state) seeded.tutorials[id] = { state, steps: 0 } as SaveV3["tutorials"][string];
  }
  // --docs — 문서 캡처용: 파티 네 칸을 열어 꺼낸 마리 넷(박스의 이상해씨·꼬부기를 파티로)
  if (hasFlag("--docs")) {
    seeded.party.slots[1] = { state: "pokemon", petId: "p2", hidden: false };
    seeded.party.slots[2] = { state: "pokemon", petId: "p3", hidden: false };
    seeded.party.slots[3] = { state: "pokemon", petId: "p4", hidden: false };
    seeded.boxes[0]!.slots = seeded.boxes[0]!.slots.map((id) => (id === "p3" || id === "p4" ? null : id));
    seeded.points.balance = 12450;
  }
  // --scene <이름> — 장면(src/tools/harness/scenes.ts SCENES)을 입힌다
  const scenes = argsAfter("--scene");
  if (scenes.length) {
    const { applyScene } = require("../harness/scenes") as typeof import("../harness/scenes");
    for (const name of scenes) for (const one of name.split(",")) applyScene(seeded, one, Date.now());
  }
  store.writeSave(file, seeded);

  const route = routeArg ? JSON.parse(routeArg) : undefined;
  const game = createGame({ petName, file });
  if (hasFlag("--save-failing")) {
    // 임시 파일 자리에 폴더를 두면 쓰기가 실패한다 (src/platform/atomic-write.ts writeAtomic). 설정창은 보기를 만들 때마다 먼저 저장하므로
    // 막음을 두는 동안 실패가 이어진다. 끝날 때 푼다 — 임시 폴더째 지워지기도 한다
    const block = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(block);
    for (let i = 0; i < 3; i += 1) game.tick();
    app.on("will-quit", () => fs.rmSync(block, { recursive: true, force: true }));
  }
  // 설정의 `영역 그리기` — 앱과 같은 창을 띄우고, 적용하면 저장한다
  const drawRegion = async () => {
    const { askRegion: draw } = require("../../main/windows/region-window") as typeof import("../../main/windows/region-window");
    const rect = await draw({ preload: paths.preloadFile(), html: paths.rendererFile("region.html"), current: game.read()?.settings.playArea.rect ?? null });
    if (!rect) return { ok: false, reason: "cancelled" };
    return game.send({ cmd: "settings.set", target: "playRegion", args: { value: rect } }, "settings");
  };
  // 설정의 한 화면 — 앱과 같은 목록·번호 덮개·화면에서 고르기 (src/main/windows/screen-picker.ts)
  const { createScreenPicker, screenViews } = require("../../main/windows/screen-picker") as typeof import("../../main/windows/screen-picker");
  const { screensNow: currentScreens } = require("../../main/windows/display") as typeof import("../../main/windows/display");
  const picker = createScreenPicker({ preload: paths.preloadFile(), html: paths.rendererFile("screens.html"), screens: currentScreens });
  const screens = () => screenViews(currentScreens(), game.read()?.settings.playArea.screen ?? null);
  const pickScreen = async () => {
    const ref = await picker.ask();
    if (!ref) return { ok: false, reason: "cancelled" };
    return game.send({ cmd: "settings.set", target: "playScreen", args: { value: ref } }, "settings");
  };
  app.on("will-quit", () => picker.close());
  // 포켓몬 표시·고스트 모드 — 앱은 저장 밖에서 처리한다(src/main/app/commands.ts). 여기서는 값만 바꿔 화면 탭 튜토리얼을 확인할 수 있게 한다
  const shown: Record<"hidden" | "clickThrough", boolean> = { hidden: false, clickThrough: false };
  const slowMs = Number(argAfter("--slow")) || 0;
  // --fail <명령>=<까닭> — 그 명령은 실행하지 않고 실패로 답한다
  const fails = new Map(argsAfter("--fail").map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)] as const).filter(([cmd]) => cmd));
  const devSend = async (req: { cmd: string; target?: string; args?: Record<string, unknown> }) => {
    if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
    const fail = fails.get(req.cmd);
    if (fail != null) return { ok: false, reason: fail };
    // --docs — 교환 서버 없이 교환 모달의 첫 화면(공유 채널 만들기·링크로 참가)을 보인다
    if (req.cmd === "trade.status" && hasFlag("--docs") && !argAfter("--trade")) {
      const idle = { available: true, phase: "idle", link: null, expiresAt: null, busy: false, error: null, closedReason: null, friendJoined: false, friendName: null, mine: null, myPetId: null, myReady: false, friend: null, friendReady: false, friendBlocked: null, singles: [], received: null };
      return { ok: true, reason: "ok", screen: idle };
    }
    // --trade <offer|blocked|ready|error|empty> — 교환 서버 없이 제안·확정 화면을 보인다
    const tradeArg = argAfter("--trade");
    if (req.cmd === "trade.status" && tradeArg) {
      const card = (species: string, name: string, level: number, types: string[], typeIds: string[]) => ({ species, name, shiny: false, level, nature: "hardy", types, typeIds });
      const base = { available: true, phase: "trading", link: null, expiresAt: null, busy: false, error: null, closedReason: null, friendJoined: true, friendName: "지우", mine: card("pikachu", "피카츄", 12, ["전기"], ["electric"]), myPetId: "p1", myReady: false, friend: card("eevee", "이브이", 22, ["노말"], ["normal"]), friendReady: true, friendBlocked: null, singles: [], received: null };
      const by: Record<string, Record<string, unknown>> = {
        blocked: { friend: card("mewtwo", "뮤츠", 70, ["에스퍼"], ["psychic"]), friendReady: false, friendBlocked: "single" },
        ready: { myReady: true },
        error: { error: { code: "TRADE_PET_NOT_SYNCED" } },
        empty: { mine: null, myPetId: null, friend: null, friendReady: false },
      };
      return { ok: true, reason: "ok", screen: { ...base, ...(by[tradeArg] ?? {}) } };
    }
    if (req.cmd === "display.set" && (req.target === "hidden" || req.target === "clickThrough")) {
      shown[req.target] = !!req.args?.value;
      return { ok: true, result: { key: req.target, value: shown[req.target] } };
    }
    return game.send({ cmd: req.cmd, target: req.target, args: req.args } as Parameters<typeof game.send>[0], "settings");
  };
  // 가짜 우편함 서버 — 받은 기록은 메모리에만 둔다
  // 설정창 — 아래에서 한 번 만든다. 가짜 우편함이 그 전에 밀어 보내면 버린다(앱과 같다)
  let manage: ReturnType<typeof createManage> | null = null;
  let mailOpt = {};
  if (hasFlag("--mail")) {
    const day = 86_400_000;
    const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
    const claims = new Map<string, string>();
    const letters = [
      { id: "10000000-0000-0000-0000-000000000001", title: "추석 맞이 선물이 왔어요", body: "한가위 잘 보내세요! 포켓몬들과 함께할 작은 선물을 보냈어요. 기간 안에 받아 주세요.", sender: "PokeBuddy", gifts: [{ kind: "item", id: "exp-candy-m", count: 3 }, { kind: "item", id: "premium-food", count: 2 }], starts_at: iso(-day / 2), ends_at: iso(7.5 * day) },
      { id: "10000000-0000-0000-0000-000000000002", title: "0.9.0 업데이트 기념 선물", body: "업데이트해 주셔서 고마워요.", sender: "PokeBuddy", gifts: [{ kind: "item", id: "premium-food", count: 2 }, { kind: "points", count: 300 }], starts_at: iso(-day), ends_at: iso(13.5 * day) },
      { id: "10000000-0000-0000-0000-000000000003", title: "첫 교환을 축하해요", body: "친구와 첫 교환을 마쳤어요.", sender: "PokeBuddy", gifts: [{ kind: "points", count: 100 }], starts_at: iso(-2 * day), ends_at: null },
      { id: "10000000-0000-0000-0000-000000000004", title: "놀이공간이 여러 화면을 지원해요", body: "설정 › 화면에서 모든 화면, 한 화면, 영역 지정 중에서 골라요.", sender: "PokeBuddy", gifts: [], starts_at: iso(-2 * day), ends_at: null },
    ];
    claims.set(letters[2]!.id, iso(-day));
    const mailFail = argAfter("--mail-fail");
    const box = createMailInbox({
      rpc: (async (fn: string, args: Record<string, unknown>) => {
        if (fn === "list_mail") return { ok: true, data: letters.map((l) => ({ ...l, claimed_at: claims.get(l.id) ?? null })) };
        if (mailFail) return { ok: false, code: mailFail };
        const l = letters.find((x) => x.id === args.p_letter);
        if (!l) return { ok: false, code: "MAIL_NOT_FOUND" };
        if (!claims.has(l.id)) claims.set(l.id, new Date().toISOString());
        return { ok: true, data: [{ gifts: l.gifts, claimed_at: claims.get(l.id) }] };
      }) as never,
      run: (id, name, args) => game.executor.run({ id, name, args } as never),
      read: () => game.read(),
      signedIn: () => hasFlag("--mail-signed-in"),
      onChanged: () => undefined,
      screen: mailScreenOf,
    });
    box.onScreen((screen) => manage?.send("manage:mail-view", screen));
    mailOpt = { mail: (req: never) => box.act(req) };
  }
  // 가짜 업데이트 — 준비됨. 설치는 앱이 꺼지는 것을 흉내 내어 답하지 않는다
  const updateOpt = hasFlag("--update-ready")
    ? { update: (action: string) => (action === "install" ? new Promise(() => {}) : Promise.resolve({ version: "0.12.0", status: "ready", next: "0.13.0", percent: 100, error: null })) }
    : {};
  // --notes — 가짜 패치노트 둘. 새 버전(0.15.0)은 아직 띄우지 않은 것으로 둔다
  const notesOpt = hasFlag("--notes")
    ? {
        notes: () => ({
          notes: [
            { version: "0.15.0", date: "2026-10-03", lines: ["설정창 여백을 맞췄어요", "특수 폼을 모습 바꾸기로 얻어요"] },
            { version: "0.14.0", date: "2026-10-01", lines: ["메가진화를 더했어요"] },
          ],
          unseen: "0.15.0",
        }),
      }
    : {};
  manage = createManage({
    preload: paths.preloadFile(),
    html: paths.rendererFile("manage.html"),
    game: () => game,
    send: devSend,
    services: () => ({
      ...mailOpt,
      ...updateOpt,
      ...notesOpt,
      drawRegion,
      screens,
      identifyScreens: (on: boolean) => picker.identify(on),
      pickScreen,
      display: () => ({ ...shown }),
    }),
  } as unknown as Parameters<typeof createManage>[0]);
  const win = manage.open(route)!;
  if (!shotFile) return;

  // 탭 전환과 개체 상세는 그려진 뒤에야 누를 수 있다. 누른 뒤에도 다시 그릴 틈을 준다
  const click = (js: string) => win.webContents.executeJavaScript(js).then(() => new Promise((r) => setTimeout(r, 800)));

  win.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      let step: Promise<unknown> = Promise.resolve();
      if (tabLabel) {
        const js = `[...document.querySelectorAll('#tabs button')].find((b) => b.textContent === ${JSON.stringify(tabLabel)}).click(); true`;
        step = step.then(() => click(js));
      }
      if (hasFlag("--detail")) step = step.then(() => click("document.querySelector('.slot:not(.blank)').click(); true"));
      // --click 과 --input 은 적은 순서대로 한다 — 검색한 뒤 결과를 누르는 흐름을 찍을 수 있게
      // --input 은 한 글자씩 넣는다. 매 글자마다 화면을 다시 그려도 포커스가 남는지 보려고 입력칸을 매번 새로 찾는다
      process.argv.forEach((flag, at) => {
        const value = process.argv[at + 1];
        if (flag === "--click" && value) step = step.then(() => click(`document.querySelector(${JSON.stringify(value)}).click(); true`));
        // --scroll 은 그 요소가 보이게 스크롤한다 — 모달 아래쪽 줄을 찍을 때 쓴다
        if (flag === "--scroll" && value) step = step.then(() => click(`document.querySelector(${JSON.stringify(value)}).scrollIntoView({ block: "center" }); true`));
        // --click-text 는 그 글자인 첫 단추를 누른다 — 선택자로 가르기 어려운 설정 단추용. 제목(.title)이 그 글자인 줄 단추(상점 줄 등)도 된다
        if (flag === "--click-text" && value) step = step.then(() => click(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(value)} || b.querySelector(".title")?.textContent.trim() === ${JSON.stringify(value)}).click(); true`));
        // --pet-click-text 는 파티 상세 기기 창에서 그 글자로 시작하는 첫 단추를 누른다 — 진화 줄(`진화 · …`)처럼 기기 창에서 여는 대화상자를 찍을 때
        if (flag === "--pet-click-text" && value)
          step = step.then(() => {
            const pet = windowOf("pet.html");
            if (!pet) return undefined;
            return pet.webContents
              .executeJavaScript(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(value)})); if (b) b.click(); return !!b; })()`)
              .then(() => new Promise((r) => setTimeout(r, 800)));
          });
        // --pet-click·--shop-click·--bag-click 은 기기 창에서 그 선택자의 요소를 누른다 — 글자가 없는 단추(초상의 메가스톤 표식, 상점의 `나오는 포켓몬` 줄)용
        if (flag === "--pet-click" && value) step = step.then(() => clickInDevice("pet.html", value));
        if (flag === "--shop-click" && value) step = step.then(() => clickInDevice("shop.html", value));
        if (flag === "--bag-click" && value) step = step.then(() => clickInDevice("bag.html", value));
        if (flag === "--battle-click" && value) step = step.then(() => clickInDevice("battle.html", value));
        // --shop-click-text·--bag-click-text 는 상점·가방 기기 창에서 그 글자인 마지막 단추를 누른다(바닥 주 단추가 마지막) — 수량(+·최대)·구매·사용·판매를 확인할 때
        if ((flag === "--shop-click-text" || flag === "--bag-click-text") && value)
          step = step.then(() => {
            const shop = windowOf(flag === "--shop-click-text" ? "shop.html" : "bag.html");
            if (!shop) return undefined;
            return shop.webContents
              .executeJavaScript(`(() => { const b = [...document.querySelectorAll("button")].filter((x) => x.textContent.trim() === ${JSON.stringify(value)}).at(-1); if (b) b.click(); return !!b; })()`)
              .then(() => new Promise((r) => setTimeout(r, 800)));
          });
        // --drag 는 두 요소의 가운데를 잇는 마우스 입력을 창에 넣는다. --drag-hold 는 떼지 않는다
        if ((flag === "--drag" || flag === "--drag-hold") && value && process.argv[at + 2]) {
          const to = process.argv[at + 2]!;
          step = step.then(() => dragIn(win.webContents, value, to, flag === "--drag"));
        }
        if (flag !== "--input" || !value) return;
        const cut = value.indexOf("=");
        const sel = value.slice(0, cut);
        const text = value.slice(cut + 1);
        for (let i = 1; i <= text.length; i++) {
          const js = `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); el.value = ${JSON.stringify(text.slice(0, i))}; el.setSelectionRange(el.value.length, el.value.length); el.dispatchEvent(new InputEvent("input", { bubbles: true })); return true; })()`;
          step = step.then(() => click(js));
        }
        step = step.then(() => win.webContents.executeJavaScript("document.activeElement && document.activeElement.id").then((id: unknown) => process.stdout.write(`focus: ${id}\n`)));
      });
      // --wait 는 찍기 전에 더 기다린다 — 초상처럼 네트워크로 받는 그림을 기다릴 때 쓴다
      const wait = Number(argAfter("--wait")) || 0;
      step
        .then(() => new Promise((r) => setTimeout(r, wait)))
        .then(() => {
          const js = argAfter("--eval");
          // 실패하면 받은 식 글자를 같이 알린다 — 셸이 식을 공백에서 나눠 반쪽만 온 경우를 바로 가린다 (2026-10-04 렌더러 레인 탐침)
          return js
            ? win.webContents.executeJavaScript(js).then(
                (v: unknown) => void process.stdout.write(`eval: ${JSON.stringify(v)}\n`),
                (e: unknown) => {
                  throw new Error(`eval 실패 — 받은 식: ${JSON.stringify(js)} (${e instanceof Error ? e.message : String(e)})`);
                },
              )
            : undefined;
        })
        .then(() => win.webContents.capturePage())
        .then((img) => {
          fs.writeFileSync(shotFile, img.toPNG());
          process.stdout.write(`shot: ${shotFile}\n`);
          // 기기 창은 차례로 찍는다 — 앞의 것이 끝난 뒤
          let done: Promise<unknown> = Promise.resolve();
          for (const [flag, page, label] of DEVICE_SHOTS) {
            const out = argAfter(flag);
            const w = windowOf(page);
            if (!out || !w) continue;
            done = done.then(() =>
              w.webContents.capturePage().then((d) => {
                fs.writeFileSync(out, d.toPNG());
                process.stdout.write(`${label} shot: ${out} ${JSON.stringify(w.getBounds())} manage ${JSON.stringify(win.getContentBounds())}\n`);
              }),
            );
          }
          return done;
        })
        .then(() => {
          // --close 는 찍은 뒤 관리 창을 닫고 잠깐 기다린다 — 도감 기기 창이 떠 있을 때 닫아도 오류가 없는지 본다
          if (hasFlag("--close")) {
            let crashed = false;
            process.on("uncaughtException", (e) => {
              crashed = true;
              process.stderr.write(`uncaught: ${String(e)}\n`);
            });
            app.on("window-all-closed", () => {}); // 창이 다 닫혀도 결과를 적을 때까지 끝내지 않는다
            win.close();
            return new Promise((r) => setTimeout(r, 1500)).then(() => process.stdout.write(`close: ${crashed ? "오류" : "오류 없음"}\n`));
          }
          return undefined;
        })
        .then(() => {
          // --linger 는 찍은 뒤 창을 그만큼 열어 둔다 — OS 가 그리는 창 단추는 페이지 캡처에 없어 밖에서 찍을 때 쓴다
          const linger = Number(argAfter("--linger")) || 0;
          setTimeout(() => app.exit(0), linger);
        })
        .catch((e: unknown) => {
          process.stderr.write(`capture failed: ${String(e)}\n`);
          app.exit(1);
        });
    }, 900);
  });
});
