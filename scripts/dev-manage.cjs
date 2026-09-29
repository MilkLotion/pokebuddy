// 관리 창만 띄워 보는 개발용 실행기 — npm run build 뒤 `npx electron scripts/dev-manage.cjs`
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
// `--drag <출발 선택자> <도착 선택자>` 를 주면 창 안에 마우스 누름·움직임·뗌을 넣어 끌어 놓는다(박스 칸 옮기기). OS 마우스는 쓰지 않는다.
// `--wait <ms>` 를 주면 찍기 전에 그만큼 더 기다린다.
// `--linger <ms>` 를 주면 찍은 뒤 창을 그만큼 열어 둔다.
// `--close` 를 주면 찍은 뒤 관리 창을 닫고 처리되지 않은 오류가 있었는지 알린다.
// `--dex-shot <파일>` 을 주면 도감 기기 창도 PNG 로 저장한다. 도감 칸을 누른 뒤에 쓴다.
// `--pet-shot <파일>` 을 주면 파티 상세 기기 창도 PNG 로 저장한다. `--detail` 이나 칸을 누른 뒤에 쓴다.
// `--route <json>` 을 주면 알림 배너의 `바로가기` 처럼 그 목적지로 연다. 예: '{"to":"pet","petId":"p1"}'
// `--save-failing` 을 주면 저장이 이어서 실패하는 채로 연다 — 이어진 저장 실패 안내 확인용. 임시 파일 자리를 폴더로 막고, 끝날 때 푼다
// `--tut <id>=<done|skipped|none>` 을 주면 그 튜토리얼 상태로 연다(여러 번). 새 기능 튜토리얼 화면을 차례로 볼 때 쓴다
// `--mail` 을 주면 가짜 서버로 우편함을 띄운다(Figma `우편함 시안` 의 편지 넷). `--mail-signed-in` 이면 로그인한 계정으로 본다
// `--agents-outdated` 를 주면 임시 HOME 의 codex 에 옛 등록(PreToolUse 포함)을 깔아 연결 탭의 "갱신 필요" 를 보인다
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.join(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokebuddy-dev-manage-"));

// 앱 모듈은 HOME 을 바꾼 뒤에 읽는다. 경로를 읽을 때 HOME 을 보기 때문이다 (src/tools/selftest-agents.ts 와 같은 방식).
// Electron 이 준비되기 전에 HOME 을 바꾸면 Electron 이 뜨지 않는다. 그래서 준비된 뒤에 바꾼다
function loadApp() {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  // CLI 설정 폴더도 임시 HOME 안으로 — 사용자 환경 변수가 연결 탭을 진짜 ~/.codex·~/.claude 로 돌리지 않게
  process.env.CODEX_HOME = path.join(dir, ".codex");
  delete process.env.CLAUDE_CONFIG_DIR;
  if (process.argv.includes("--agents-outdated")) {
    const hook = `node "${path.join(dir, ".claude", "scripts", "hooks", "pokebuddy-state.cjs")}" --cli codex`;
    const events = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop", "Interrupt", "SessionEnd"];
    fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
    fs.writeFileSync(path.join(process.env.CODEX_HOME, "hooks.json"), JSON.stringify({ hooks: Object.fromEntries(events.map((e) => [e, [{ hooks: [{ type: "command", command: hook, timeout: 5 }] }]])) }));
  }
  return {
    createGame: require(path.join(root, "dist/main/game.js")).createGame,
    openManage: require(path.join(root, "dist/main/manage-window.js")).openManage,
    paths: require(path.join(root, "dist/main/paths.js")),
    store: require(path.join(root, "dist/save/store.js")),
    empty: require(path.join(root, "dist/save/v3.js")).empty,
    createMainMail: require(path.join(root, "dist/main/mail.js")).createMainMail,
    pushMail: require(path.join(root, "dist/main/manage-window.js")).pushMail,
  };
}

const argAfter = (flag) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : null;
};
// 같은 이름을 여러 번 줄 수 있다 — 모달을 열고 그 안을 또 누를 때 쓴다
const argsAfter = (flag) => process.argv.map((v, i) => (v === flag ? process.argv[i + 1] : null)).filter((v) => v != null);
const shotFile = argAfter("--shot");
const tabLabel = argAfter("--tab");
const routeArg = argAfter("--route");

// 보기용 저장 — 꺼낸 마리, 숨긴 마리, 빈 칸, 잠긴 칸, 박스, 알, 가방이 한 번에 보이게 만든다
function seed(empty, now) {
  const save = empty(now);
  save.points.balance = 1240;
  const pet = (id, species, over) => ({
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
    mood: 60,
    feedCooldownMs: 0,
    playCooldownMs: 0,
    playWindowMs: 0,
    playStreak: 0,
    buffs: [],
    home: { dx: -24, dy: -60 },
    since: now,
    stage: 0,
    evolved: [],
    daily: { date: "", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
    ...over,
  });
  save.pets.push(pet("p1", "pikachu", { level: 12, affinity: 85, fullness: 72 }));
  save.pets.push(pet("p2", "charmander", { level: 5, nature: "brave", affinity: 40, fullness: 33, feedCooldownMs: 90_000 }));
  save.starterPetId = "p1";
  save.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  save.party.slots[1] = { state: "pokemon", petId: "p2", hidden: true };
  save.party.slots[2] = { state: "empty" }; // 빈 칸도 한 번에 보이게 상점 칸 하나를 열어 둔다

  // 박스 — 앞의 몇 칸을 채워 격자와 쪽 넘김을 본다
  const kept = [
    ["p3", "bulbasaur", 9],
    ["p4", "squirtle", 14],
    ["p5", "eevee", 7],
    ["p6", "machop", 21],
  ];
  kept.forEach(([id, species, level], i) => {
    save.pets.push(pet(id, species, { level, shiny: id === "p5" }));
    save.boxes[0].slots[i] = id;
  });

  // 알 — 하나는 준비 완료, 하나는 진행 중
  save.eggs.push({
    id: "e1",
    kind: "random",
    boughtAt: now,
    remainMs: 0,
    ready: true,
    candidates: ["pikachu", "eevee"],
    careCooldownMs: 0,
    actions: { pat: 3, song: 1 },
  });
  save.eggs.push({
    id: "e2",
    kind: "ancient-stone",
    boughtAt: now,
    remainMs: 180_000,
    ready: false,
    candidates: ["omanyte", "kabuto"],
    careCooldownMs: 0,
    actions: { pat: 0, song: 2 },
  });

  save.bag = { "premium-food": 3, toy: 2, "rare-candy": 1, "fire-stone": 1, mint: 2 };

  // 업적 — 하나는 받지 않은 보상으로 둔다. 헤더 점과 `보상 받기` 를 같이 본다
  save.achievements = { "show-two": { achievedAt: now, claimedAt: null } };

  const seen = ["pikachu", "charmander", "bulbasaur", "squirtle", "eevee", "machop"];
  save.dex = { unlocked: seen, obtained: seen, shinyObtained: ["eevee"], discovered: {} };
  return save;
}

app.whenReady().then(async () => {
  const file = path.join(dir, "save-v3.json");
  const { createGame, openManage, paths, store, empty, createMainMail, pushMail } = loadApp();
  const seeded = seed(empty, Date.now());
  // --tut <id>=<done|skipped|none> — 튜토리얼 상태를 정해 둔다(여러 번). 새 기능 튜토리얼 화면을 차례로 보려고
  for (const pair of argsAfter("--tut")) {
    const [id, state] = pair.split("=");
    if (id && state) seeded.tutorials[id] = { state, steps: 0 };
  }
  store.write(file, seeded);

  const route = routeArg ? JSON.parse(routeArg) : undefined;
  const game = createGame({ file });
  if (process.argv.includes("--save-failing")) {
    // 임시 파일 자리에 폴더를 두면 쓰기가 실패한다 (src/save/legacy.ts writeAtomic). 설정창은 보기를 만들 때마다 먼저 저장하므로
    // 막음을 두는 동안 실패가 이어진다. 끝날 때 푼다 — 임시 폴더째 지워지기도 한다
    const block = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(block);
    for (let i = 0; i < 3; i += 1) game.tick();
    app.on("will-quit", () => fs.rmSync(block, { recursive: true, force: true }));
  }
  // 설정의 `영역 그리기` — 앱과 같은 창을 띄우고, 적용하면 저장한다
  const drawRegion = async () => {
    const { drawRegion: draw } = require(path.join(root, "dist/main/region-window.js"));
    const rect = await draw({ preload: paths.preloadFile(), html: paths.rendererFile("region.html"), current: game.read()?.settings.playArea.rect ?? null });
    if (!rect) return { ok: false, reason: "cancelled" };
    return game.send({ cmd: "settings.set", target: "playRegion", args: { value: rect } }, "settings");
  };
  // 설정의 한 화면 — 앱과 같은 목록·번호 덮개·화면에서 고르기 (src/main/screen-picker.ts)
  const { createScreenPicker, currentScreens, screenViews } = require(path.join(root, "dist/main/screen-picker.js"));
  const picker = createScreenPicker({ preload: paths.preloadFile(), html: paths.rendererFile("screens.html"), screens: currentScreens });
  const screens = () => screenViews(currentScreens(), game.read()?.settings.playArea.screen ?? null);
  const pickScreen = async () => {
    const ref = await picker.pick();
    if (!ref) return { ok: false, reason: "cancelled" };
    return game.send({ cmd: "settings.set", target: "playScreen", args: { value: ref } }, "settings");
  };
  app.on("will-quit", () => picker.close());
  // 포켓몬 표시·고스트 모드 — 앱은 저장 밖에서 처리한다(src/main/commands.ts). 여기서는 값만 바꿔 화면 탭 튜토리얼을 확인할 수 있게 한다
  const shown = { hidden: false, clickThrough: false };
  const devSend = async (req) => {
    if (req.cmd === "settings.set" && (req.target === "hidden" || req.target === "clickThrough")) {
      shown[req.target] = !!req.args?.value;
      return { ok: true, result: { key: req.target, value: shown[req.target] } };
    }
    return game.send({ cmd: req.cmd, target: req.target, args: req.args }, "settings");
  };
  // 가짜 우편함 서버 — 받은 기록은 메모리에만 둔다
  let mailOpt = {};
  if (process.argv.includes("--mail")) {
    const day = 86_400_000;
    const iso = (ms) => new Date(Date.now() + ms).toISOString();
    const claims = new Map();
    const letters = [
      { id: "10000000-0000-0000-0000-000000000001", title: "추석 맞이 선물이 왔어요", body: "한가위 잘 보내세요! 포켓몬들과 함께할 작은 선물을 보냈어요. 기간 안에 받아 주세요.", sender: "PokeBuddy", gifts: [{ kind: "item", id: "exp-candy-m", count: 3 }, { kind: "item", id: "premium-food", count: 2 }], starts_at: iso(-day / 2), ends_at: iso(7.5 * day) },
      { id: "10000000-0000-0000-0000-000000000002", title: "0.9.0 업데이트 기념 선물", body: "업데이트해 주셔서 고마워요.", sender: "PokeBuddy", gifts: [{ kind: "item", id: "premium-food", count: 2 }, { kind: "points", count: 300 }], starts_at: iso(-day), ends_at: iso(13.5 * day) },
      { id: "10000000-0000-0000-0000-000000000003", title: "첫 교환을 축하해요", body: "친구와 첫 교환을 마쳤어요.", sender: "PokeBuddy", gifts: [{ kind: "points", count: 100 }], starts_at: iso(-2 * day), ends_at: null },
      { id: "10000000-0000-0000-0000-000000000004", title: "놀이공간이 여러 화면을 지원해요", body: "설정 › 화면에서 모든 화면, 한 화면, 영역 지정 중에서 골라요.", sender: "PokeBuddy", gifts: [], starts_at: iso(-2 * day), ends_at: null },
    ];
    claims.set(letters[2].id, iso(-day));
    const box = createMainMail({
      rpc: async (fn, args) => {
        if (fn === "list_mail") return { ok: true, data: letters.map((l) => ({ ...l, claimed_at: claims.get(l.id) ?? null })) };
        const l = letters.find((x) => x.id === args.p_letter);
        if (!l) return { ok: false, code: "MAIL_NOT_FOUND" };
        if (!claims.has(l.id)) claims.set(l.id, new Date().toISOString());
        return { ok: true, data: [{ gifts: l.gifts, claimed_at: claims.get(l.id) }] };
      },
      run: (id, name, args) => game.executor.run({ id, name, args }),
      read: () => game.read(),
      signedIn: () => process.argv.includes("--mail-signed-in"),
      onChanged: () => undefined,
    });
    box.onScreen((screen) => pushMail(screen));
    mailOpt = { mail: (req) => box.act(req) };
  }
  const win = openManage({ ...mailOpt, preload: paths.preloadFile(), html: paths.rendererFile("manage.html"), game, drawRegion, screens, identifyScreens: (on) => picker.identify(on), pickScreen, display: () => ({ ...shown }), send: devSend, ...(route ? { route } : {}) });
  if (!shotFile) return;

  // 탭 전환과 개체 상세는 그려진 뒤에야 누를 수 있다. 누른 뒤에도 다시 그릴 틈을 준다
  const click = (js) => win.webContents.executeJavaScript(js).then(() => new Promise((r) => setTimeout(r, 800)));

  win.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      let step = Promise.resolve();
      if (tabLabel) {
        const js = `[...document.querySelectorAll('#tabs button')].find((b) => b.textContent === ${JSON.stringify(tabLabel)}).click(); true`;
        step = step.then(() => click(js));
      }
      if (process.argv.includes("--detail")) step = step.then(() => click("document.querySelector('.slot:not(.blank)').click(); true"));
      // --click 과 --input 은 적은 순서대로 한다 — 검색한 뒤 결과를 누르는 흐름을 찍을 수 있게
      // --input 은 한 글자씩 넣는다. 매 글자마다 화면을 다시 그려도 포커스가 남는지 보려고 입력칸을 매번 새로 찾는다
      process.argv.forEach((flag, at) => {
        const value = process.argv[at + 1];
        if (flag === "--click" && value) step = step.then(() => click(`document.querySelector(${JSON.stringify(value)}).click(); true`));
        // --scroll 은 그 요소가 보이게 스크롤한다 — 모달 아래쪽 줄을 찍을 때 쓴다
        if (flag === "--scroll" && value) step = step.then(() => click(`document.querySelector(${JSON.stringify(value)}).scrollIntoView({ block: "center" }); true`));
        // --click-text 는 그 글자인 첫 단추를 누른다 — 선택자로 가르기 어려운 설정 단추용. 제목(.title)이 그 글자인 줄 단추(상점 줄 등)도 된다
        if (flag === "--click-text" && value) step = step.then(() => click(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(value)} || b.querySelector(".title")?.textContent.trim() === ${JSON.stringify(value)}).click(); true`));
        // --drag 는 두 요소의 가운데를 잇는 마우스 입력을 창에 넣는다 — 포인터 이벤트로 끄는 박스 칸용
        if (flag === "--drag" && value && process.argv[at + 2]) {
          const to = process.argv[at + 2];
          const center = (sel) => `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`;
          step = step.then(async () => {
            const [x0, y0] = await win.webContents.executeJavaScript(center(value));
            const [x1, y1] = await win.webContents.executeJavaScript(center(to));
            const wc = win.webContents;
            wc.sendInputEvent({ type: "mouseMove", x: x0, y: y0 });
            wc.sendInputEvent({ type: "mouseDown", x: x0, y: y0, button: "left", clickCount: 1 });
            for (let k = 1; k <= 10; k++) {
              wc.sendInputEvent({ type: "mouseMove", x: Math.round(x0 + ((x1 - x0) * k) / 10), y: Math.round(y0 + ((y1 - y0) * k) / 10), button: "left", modifiers: ["leftButtonDown"] });
              await new Promise((r) => setTimeout(r, 30));
            }
            wc.sendInputEvent({ type: "mouseUp", x: x1, y: y1, button: "left", clickCount: 1 });
            await new Promise((r) => setTimeout(r, 800));
          });
        }
        if (flag !== "--input" || !value) return;
        const cut = value.indexOf("=");
        const sel = value.slice(0, cut);
        const text = value.slice(cut + 1);
        for (let i = 1; i <= text.length; i++) {
          const js = `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); el.value = ${JSON.stringify(text.slice(0, i))}; el.setSelectionRange(el.value.length, el.value.length); el.dispatchEvent(new InputEvent("input", { bubbles: true })); return true; })()`;
          step = step.then(() => click(js));
        }
        step = step.then(() => win.webContents.executeJavaScript("document.activeElement && document.activeElement.id").then((id) => process.stdout.write(`focus: ${id}
`)));
      });
      // --wait 는 찍기 전에 더 기다린다 — 초상처럼 네트워크로 받는 그림을 기다릴 때 쓴다
      const wait = Number(argAfter("--wait")) || 0;
      step
        .then(() => new Promise((r) => setTimeout(r, wait)))
        .then(() => win.webContents.capturePage())
        .then((img) => {
          fs.writeFileSync(shotFile, img.toPNG());
          process.stdout.write(`shot: ${shotFile}\n`);
          const petShot = argAfter("--pet-shot");
          const pet = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("pet.html"));
          const petDone =
            petShot && pet
              ? pet.webContents.capturePage().then((d) => {
                  fs.writeFileSync(petShot, d.toPNG());
                  process.stdout.write(`pet shot: ${petShot} ${JSON.stringify(pet.getBounds())} manage ${JSON.stringify(win.getContentBounds())}\n`);
                })
              : Promise.resolve();
          const dexShot = argAfter("--dex-shot");
          const dex = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("dex.html"));
          if (!dexShot || !dex) return petDone;
          return petDone.then(() =>
            dex.webContents.capturePage().then((d) => {
              fs.writeFileSync(dexShot, d.toPNG());
              process.stdout.write(`dex shot: ${dexShot} ${JSON.stringify(dex.getBounds())} manage ${JSON.stringify(win.getContentBounds())}\n`);
            }),
          );
        })
        .then(() => {
          // --close 는 찍은 뒤 관리 창을 닫고 잠깐 기다린다 — 도감 기기 창이 떠 있을 때 닫아도 오류가 없는지 본다
          if (process.argv.includes("--close")) {
            let crashed = false;
            process.on("uncaughtException", (e) => {
              crashed = true;
              process.stderr.write(`uncaught: ${String(e)}\n`);
            });
            app.on("window-all-closed", () => {}); // 창이 다 닫혀도 결과를 적을 때까지 끝내지 않는다
            win.close();
            return new Promise((r) => setTimeout(r, 1500)).then(() => process.stdout.write(`close: ${crashed ? "오류" : "오류 없음"}\n`));
          }
        })
        .then(() => {
          // --linger 는 찍은 뒤 창을 그만큼 열어 둔다 — OS 가 그리는 창 단추는 페이지 캡처에 없어 밖에서 찍을 때 쓴다
          const linger = Number(argAfter("--linger")) || 0;
          setTimeout(() => app.exit(0), linger);
        })
        .catch((e) => {
          process.stderr.write(`capture failed: ${String(e)}\n`);
          app.exit(1);
        });
    }, 900);
  });
});
