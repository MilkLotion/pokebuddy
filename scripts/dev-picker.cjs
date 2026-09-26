// 첫 포켓몬 선택 창만 띄워 보는 개발용 실행기 — npm run build 뒤 `npx electron scripts/dev-picker.cjs --shot <파일> [--pick <번호>] [--no-art]`
//
// 저장을 읽지도 쓰지도 않는다. 창을 띄워 찍은 뒤 끝낸다. `--pick 2` 는 둘째 카드를 눌러 놓고 찍는다.
// `--no-art` 는 초상을 하나도 주지 않아 그림 자리표시(받는 중 깜빡임)를 찍는다.
// 찍은 그림은 Figma `First Run / Starter Selected` `402:9417`, `Starter Empty` `402:9579` 와 비교한다
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.join(__dirname, "..");
const argAfter = (flag) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : null;
};
const shotFile = argAfter("--shot");
const pickAt = Number(argAfter("--pick")) || 0;
const noArt = process.argv.includes("--no-art");

app.whenReady().then(() => {
  const { pickStarter } = require(path.join(root, "dist/main/picker-window.js"));
  const { starters, unlockRules } = require(path.join(root, "dist/dex/unlocks.js"));
  const { preloadFile, rendererFile, PATHS } = require(path.join(root, "dist/main/paths.js"));
  const { createPortraits } = require(path.join(root, "dist/main/portraits.js"));
  const portraits = noArt
    ? { get: async (asks) => Object.fromEntries(asks.map((a) => [a.slug, null])) }
    : createPortraits(path.join(PATHS.home, "sprites"), path.join(PATHS.project, "sprites"));
  void pickStarter({ preload: preloadFile(), html: rendererFile("picker.html"), starters: starters(unlockRules()), portraits, onPicking: () => {} }).then((slug) => {
    process.stdout.write(`picked: ${slug}\n`);
  });
  if (!shotFile) return;
  setTimeout(async () => {
    const win = BrowserWindow.getAllWindows()[0];
    try {
      if (pickAt > 0) {
        await win.webContents.executeJavaScript(`document.querySelectorAll('.card')[${pickAt - 1}].click(); true`);
        await new Promise((r) => setTimeout(r, 300));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(shotFile, img.toPNG());
      process.stdout.write(`shot: ${shotFile} content: ${JSON.stringify(win.getContentBounds())}\n`);
      app.exit(0);
    } catch (e) {
      process.stderr.write(`capture failed: ${String(e)}\n`);
      app.exit(1);
    }
  }, 1500);
});
