// 첫 포켓몬 선택 창만 띄워 보는 개발용 실행기 — npm run build 뒤 `npx electron dist/tools/dev/dev-picker.js --shot <파일> [--pick <번호>] [--no-art]`
//
// 저장을 읽지도 쓰지도 않는다. 창을 띄워 찍은 뒤 끝낸다. `--pick 2` 는 둘째 카드를 눌러 놓고 찍는다.
// `--no-art` 는 초상을 하나도 주지 않아 그림 자리표시(받는 중 깜빡임)를 찍는다.
// 깜빡임 없이 같은 그림을 얻으려면 Chromium 스위치 `--force-prefers-reduced-motion` 을 함께 준다
// (picker.html 의 reduced-motion 규칙이 portrait-wait 를 멈춘다. 옛 scripts/dev-picker.cjs 에도 같이 듣는다 — A/B 캡처가 쓴다)
// 찍은 그림은 Figma `First Run / Starter Selected` `402:9417`, `Starter Empty` `402:9579` 와 비교한다
// (예전 scripts/dev-picker.cjs. 앱 코드를 부르므로 타입 검사를 받게 src/tools 로 옮겼다)
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { starters, unlockRules } from "../../dex/unlocks";
import { PATHS } from "../../main/paths";
import { preloadFile, rendererFile } from "../../main/windows/files";
import { askStarter } from "../../main/windows/picker-window";
import { createPortraits, type Portraits } from "../../main/portraits";
import { argAfter, hasFlag } from "../harness/shot";

const shotFile = argAfter("--shot");
const pickAt = Number(argAfter("--pick")) || 0;
const noArt = hasFlag("--no-art");

void app.whenReady().then(() => {
  const portraits = noArt
    ? ({ get: async (asks: { slug: string }[]) => Object.fromEntries(asks.map((a) => [a.slug, null])) } as unknown as Portraits)
    : createPortraits(path.join(PATHS.home, "sprites"), path.join(PATHS.project, "sprites"));
  void askStarter({ preload: preloadFile(), html: rendererFile("picker.html"), starters: starters(unlockRules()), portraits, onPicking: () => {} }).then((slug) => {
    process.stdout.write(`picked: ${slug}\n`);
  });
  if (!shotFile) return;
  setTimeout(async () => {
    const win = BrowserWindow.getAllWindows()[0]!;
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
