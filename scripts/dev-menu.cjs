// 앱이 그리는 메뉴 창만 띄워 보는 개발용 실행기 — npm run build 뒤 `npx electron scripts/dev-menu.cjs --shot <파일> [--down 2]`
//
// 트레이와 같은 항목(관리 창 열기 / 잠시 숨기기 / 클릭 통과(켜짐) / 종료)을 커서 자리에 띄운다. `--pet` 이면 포켓몬 우클릭 메뉴다. 저장은 건드리지 않는다.
// `--down N` 은 아래 방향키를 N 번 눌러 가리킨 항목을 보인다. 그림은 Figma `Context Menu` `338:738` 과 비교한다
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.join(__dirname, "..");
const argAfter = (flag) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : null;
};
const shotFile = argAfter("--shot");
const down = Number(argAfter("--down")) || 0;

app.whenReady().then(() => {
  const { popupMenu } = require(path.join(root, "dist/main/menu-window.js"));
  const { petMenu, trayMenu } = require(path.join(root, "dist/main/menus.js"));
  const { preloadFile, rendererFile } = require(path.join(root, "dist/main/paths.js"));
  const say = (what) => () => process.stdout.write(`picked: ${what}\n`);
  const act = { toggleHidden: say("hide"), quit: say("quit"), toggleGhost: say("ghost") };
  // --pet 은 포켓몬 위 우클릭 메뉴 — 앱과 같게 상세 보기를 끝에 붙인다 (src/main/app.ts showPetMenu)
  const pet = petMenu({ name: "피카츄", nature: "노력", status: "배부름 · 기분 좋음", feed: { enabled: false, reason: "0:40" }, play: { enabled: true } }, { feed: say("feed"), play: say("play"), ball: say("ball") });
  pet.push({ type: "separator" }, { label: "상세 보기", click: say("detail") });
  const template = process.argv.includes("--pet")
    ? pet
    : [{ label: "관리 창 열기", click: say("manage") }, { type: "separator" }, ...trayMenu({ hidden: false, ghost: true }, act)];
  popupMenu({ preload: preloadFile(), html: rendererFile("menu.html") }, template, "켜짐");
  if (!shotFile) return;
  setTimeout(async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) {
      process.stderr.write("menu window closed before capture\n");
      return app.exit(1);
    }
    try {
      for (let i = 0; i < down; i++) win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Down" });
      await new Promise((r) => setTimeout(r, 300));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(shotFile, img.toPNG());
      process.stdout.write(`shot: ${shotFile} bounds: ${JSON.stringify(win.getBounds())}\n`);
      app.exit(0);
    } catch (e) {
      process.stderr.write(`capture failed: ${String(e)}\n`);
      app.exit(1);
    }
  }, 1500);
});
