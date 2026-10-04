// 알림 배너 창만 띄워 보는 개발용 실행기 — npm run build 뒤 `npx electron dist/tools/dev/dev-banner.js --shot <파일> [--kind hatch|evolve|achievement|notice|find|find-pokemon]`
//
// 저장을 읽지 않는다. 보기용 배너 하나를 바로 창에 넣고 찍은 뒤 끝낸다. 소리는 내지 않는다.
// 찍은 그림은 Figma `Notification Banner` `338:732` 와 비교한다.
// `--go` 를 주면 찍은 뒤 `바로가기` 를 눌러 목적지(go:)와 사라짐(done)이 출력되는지 본다
// `--close` 를 주면 찍은 뒤 제목 줄 `✕` 를 눌러 목적지 없이 사라짐(done)만 출력되는지 본다
// `--wait` 를 주면 아무것도 누르지 않는다. 창이 보인 때부터 1.5초에는 보이고 2.5초에는 숨었는지 두 번 본다(표시 2초 판정)
// (예전 scripts/dev-banner.cjs. 앱 코드를 부르므로 타입 검사를 받게 src/tools 로 옮겼다)
import fs from "node:fs";
import { app, BrowserWindow } from "electron";
import { createBannerWindow } from "../../main/windows/banner-window";
import { preloadFile, rendererFile } from "../../main/windows/files";
import type { BannerView } from "../../shared/model/overlays";
import { argAfter, hasFlag } from "../harness/shot";

const shotFile = argAfter("--shot");
const kind = argAfter("--kind") ?? "hatch";

const SAMPLES: Record<string, BannerView> = {
  hatch: { key: "hatch:e2", kind: "hatch", title: "부화 준비 완료", target: "돌보미집 알 2", go: "바로가기", route: { to: "daycare" } },
  evolve: { key: "evolve:p1:charmander", kind: "evolve", title: "진화 가능", target: "파이리 Lv.16", go: "바로가기", route: { to: "pet", petId: "p1" } },
  notice: { key: "notice:codex-console", kind: "notice", title: "Codex 창이 깜빡이면", target: "codex --no-daemon 으로 실행하거나 연결 해제", go: "바로가기", route: { to: "agents" } },
  achievement: { key: "achievement:show-two", kind: "achievement", title: "업적 달성", target: "두 마리 함께 꺼내기 달성", go: "바로가기", route: { to: "achievements", id: "show-two" } },
  // 줍기 — 도구·포인트는 바로가기가 없다. 포켓몬을 데려오면 있다 (Figma `Type=Find` · `Type=Find Pokemon`)
  find: { key: "find:f1", kind: "find", title: "줍기", target: "피카츄가 경험사탕S를 주웠어요", go: "바로가기" },
  "find-pokemon": { key: "find:f2", kind: "find", title: "줍기", target: "피카츄가 이브이를 데려왔어요", go: "바로가기", route: { to: "pet", petId: "p2" } },
};

void app.whenReady().then(() => {
  // 표시 시간은 창이 실제로 보인 때(showInactive)부터 센다 — 찍기 대기 1200 과는 무관하다
  let shownAt = 0;
  const banner = createBannerWindow({
    preload: preloadFile(),
    html: rendererFile("banner.html"),
    chime: () => 0,
    onGo: (route) => process.stdout.write(`go: ${JSON.stringify(route)}\n`),
    onDone: () => process.stdout.write(`done${shownAt ? ` ${Date.now() - shownAt}ms` : ""}\n`),
  });
  app.on("browser-window-created", (_e, win) => win.once("show", () => (shownAt = Date.now())));
  banner.show(SAMPLES[kind] ?? SAMPLES.hatch!);
  if (hasFlag("--wait")) {
    const look = (at: number): Promise<boolean> =>
      new Promise((r) => {
        const poll = setInterval(() => {
          if (!shownAt || Date.now() - shownAt < at) return;
          clearInterval(poll);
          const win = BrowserWindow.getAllWindows()[0];
          r(!!win && win.isVisible());
        }, 20);
      });
    void look(1500).then((early) =>
      look(2500).then((late) => {
        process.stdout.write(`visible at 1500ms: ${early}, at 2500ms: ${late}\n`);
        app.exit(early && !late ? 0 : 1);
      }),
    );
    return;
  }
  if (!shotFile) return;
  setTimeout(() => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.webContents
      .capturePage()
      .then((img) => {
        fs.writeFileSync(shotFile, img.toPNG());
        process.stdout.write(`shot: ${shotFile} bounds: ${JSON.stringify(win.getBounds())}\n`);
        const press = hasFlag("--go") ? "go" : hasFlag("--close") ? "close" : null;
        if (!press) return app.exit(0);
        return win.webContents
          .executeJavaScript(`document.getElementById('${press}').click(); true`)
          .then(() => new Promise((r) => setTimeout(r, 500)))
          .then(() => {
            process.stdout.write(`visible after ${press}: ${win.isVisible()}\n`);
            app.exit(0);
          });
      })
      .catch((e: unknown) => {
        process.stderr.write(`capture failed: ${String(e)}\n`);
        app.exit(1);
      });
  }, 1200);
});
