// 메뉴 창 뜨는 시간 계측 — 실제 메뉴 창(openMenu)과 문서로 메뉴를 열고, 연 때부터 창을 보일 때까지 잰다 (worklog/records/perf-refactor 8-1)
//
//   npm run build 뒤 electron dist/tools/smoke/smoke-menu-open.js
//
// 화면에 창을 띄우지 않는다 — 창 보이기(show·showInactive·focus)를 가로채 그 시각만 적는다
// 경우 둘: 앱을 켠 뒤 처음 열기, 닫은 뒤 1초 뒤 다시 열기. 포커스를 받는 메뉴(포켓몬)와 받지 않는 메뉴(Windows 트레이) 둘 다
// 결과는 JSON 한 줄. 판정은 하지 않는다(기준선 기록용). 끝나면 종료 코드 0
import { app, BrowserWindow, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { closeMenu, openMenu, warmMenu } from "../../main/menus/menu-window";
import { preloadFile, rendererFile } from "../../main/windows/files";
import { makeTmp } from "../harness/tmp-dir";
import { sleep as wait } from "../harness/wait";

const dir = makeTmp("smoke-menu-open");
app.setPath("userData", path.join(dir, "user-data"));
app.on("window-all-closed", () => {}); // 메뉴를 닫아 창이 하나도 없어도 끝내지 않는다

let shownAt = 0;
const mark = (): void => {
  shownAt ||= performance.now();
};
BrowserWindow.prototype.show = mark;
BrowserWindow.prototype.showInactive = mark;
BrowserWindow.prototype.focus = function focus(): void {};

const template: MenuItemConstructorOptions[] = [
  { label: "설정 열기", click() {} },
  { label: "숨기기", click() {} },
  { type: "separator" },
  { label: "끝내기", click() {} },
];

void app.whenReady().then(async () => {
  const opts = (inactive: boolean) => ({ preload: preloadFile(), html: rendererFile("menu.html"), inactive });
  const timeOpen = async (inactive: boolean): Promise<number> => {
    shownAt = 0;
    const t0 = performance.now();
    openMenu(opts(inactive), template, "켜짐");
    for (let i = 0; i < 400 && !shownAt; i += 1) await wait(5);
    return shownAt ? Math.round(shownAt - t0) : -1;
  };
  const result: Record<string, number[]> = {};
  try {
    for (const inactive of [false, true]) {
      const name = inactive ? "tray" : "pet";
      // 앱을 켠 뒤 처음 — 앱이 시작 때 예비 창을 둔다
      warmMenu(opts(inactive));
      await wait(1000);
      const first = await timeOpen(inactive);
      closeMenu();
      const again: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        await wait(1000);
        again.push(await timeOpen(inactive));
        closeMenu();
      }
      result[name] = [first, ...again];
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
