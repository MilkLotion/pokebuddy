// 알림 배너 창만 띄워 보는 개발용 실행기 — npm run build 뒤 `npx electron scripts/dev-banner.cjs --shot <파일> [--kind hatch|evolve|achievement]`
//
// 저장을 읽지 않는다. 보기용 배너 하나를 바로 창에 넣고 찍은 뒤 끝낸다. 소리는 내지 않는다.
// 찍은 그림은 Figma `Notification Banner` `338:732` 와 비교한다.
// `--go` 를 주면 찍은 뒤 `바로가기` 를 눌러 목적지(go:)와 사라짐(done)이 출력되는지 본다
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.join(__dirname, "..");
const argAfter = (flag) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : null;
};
const shotFile = argAfter("--shot");
const kind = argAfter("--kind") ?? "hatch";

const SAMPLES = {
  hatch: { key: "hatch:e2", kind: "hatch", title: "부화 준비 완료", target: "돌보미집 알 2", go: "바로가기", route: { to: "daycare" } },
  evolve: { key: "evolve:p1:charmander", kind: "evolve", title: "진화 가능", target: "파이리 Lv.16", go: "바로가기", route: { to: "pet", petId: "p1" } },
  achievement: { key: "achievement:show-two", kind: "achievement", title: "업적 달성", target: "두 마리 꺼내기 달성", go: "바로가기", route: { to: "achievements", id: "show-two" } },
};

app.whenReady().then(() => {
  const { createBannerWindow } = require(path.join(root, "dist/main/banner-window.js"));
  const { preloadFile, rendererFile } = require(path.join(root, "dist/main/paths.js"));
  const banner = createBannerWindow({
    preload: preloadFile(),
    html: rendererFile("banner.html"),
    chime: () => 0,
    onGo: (route) => process.stdout.write(`go: ${JSON.stringify(route)}\n`),
    onDone: () => process.stdout.write("done\n"),
  });
  banner.show(SAMPLES[kind] ?? SAMPLES.hatch);
  if (!shotFile) return;
  setTimeout(() => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents
      .capturePage()
      .then((img) => {
        fs.writeFileSync(shotFile, img.toPNG());
        process.stdout.write(`shot: ${shotFile} bounds: ${JSON.stringify(win.getBounds())}\n`);
        if (!process.argv.includes("--go")) return app.exit(0);
        return win.webContents
          .executeJavaScript("document.getElementById('go').click(); true")
          .then(() => new Promise((r) => setTimeout(r, 500)))
          .then(() => {
            process.stdout.write(`visible after go: ${win.isVisible()}\n`);
            app.exit(0);
          });
      })
      .catch((e) => {
        process.stderr.write(`capture failed: ${String(e)}\n`);
        app.exit(1);
      });
  }, 1200);
});
