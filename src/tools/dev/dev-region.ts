// 놀이공간 영역 그리기 창만 띄워 보는 개발용 실행기 — npm run build 뒤
//   npx electron dist/tools/dev/dev-region.js --shot <파일> [--current x,y,w,h] [--drag x1,y1,x2,y2] [--apply]
//
// 저장을 읽지도 쓰지도 않는다. `--current` 는 지금 영역(화면 좌표), `--drag` 는 창 안 좌표로 드래그를 흉내 낸다.
// `--apply` 를 주면 찍은 뒤 적용을 눌러 돌려받은 영역(화면 좌표)을 출력한다. 그림은 Figma `Playground / Region Draw` `396:8541` 과 비교한다
// (예전 scripts/dev-region.cjs. 앱 코드를 부르므로 타입 검사를 받게 src/tools 로 옮겼다)
import fs from "node:fs";
import { app, BrowserWindow } from "electron";
import { preloadFile, rendererFile } from "../../main/windows/files";
import { drawRegion } from "../../main/windows/region-window";
import { argAfter, hasFlag, numsOf } from "../harness/shot";

const shotFile = argAfter("--shot");
const current = numsOf(argAfter("--current"));
const drag = numsOf(argAfter("--drag"));

void app.whenReady().then(() => {
  const cur = current ? { x: current[0]!, y: current[1]!, w: current[2]!, h: current[3]! } : null;
  void drawRegion({ preload: preloadFile(), html: rendererFile("region.html"), current: cur }).then((rect) => {
    process.stdout.write(`result: ${JSON.stringify(rect)}\n`);
    app.exit(0);
  });
  if (!shotFile) return;
  setTimeout(async () => {
    const win = BrowserWindow.getAllWindows()[0]!;
    const wc = win.webContents;
    try {
      if (drag) {
        const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = drag;
        wc.sendInputEvent({ type: "mouseDown", x: x1, y: y1, button: "left", clickCount: 1 });
        for (let i = 1; i <= 5; i++) wc.sendInputEvent({ type: "mouseMove", x: x1 + ((x2 - x1) * i) / 5, y: y1 + ((y2 - y1) * i) / 5, button: "left" });
        wc.sendInputEvent({ type: "mouseUp", x: x2, y: y2, button: "left", clickCount: 1 });
        await new Promise((r) => setTimeout(r, 300));
      }
      const img = await wc.capturePage();
      fs.writeFileSync(shotFile, img.toPNG());
      process.stdout.write(`shot: ${shotFile} bounds: ${JSON.stringify(win.getBounds())}\n`);
      if (hasFlag("--apply")) await wc.executeJavaScript("document.getElementById('apply').click(); true");
      else await wc.executeJavaScript("document.getElementById('cancel').click(); true");
    } catch (e) {
      process.stderr.write(`capture failed: ${String(e)}\n`);
      app.exit(1);
    }
  }, 1500);
});
