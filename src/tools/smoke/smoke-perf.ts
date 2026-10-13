// 설정창 다시 그리기 계측 — 숨긴 설정창에 실제 게임(큰 저장)을 붙여 시간을 흘리고, 화면이 몇 번 다시 그려지는지 센다 (worklog/records/perf-refactor 0-2·0-5)
//
//   npm run build 뒤 electron dist/tools/smoke/smoke-perf.js
//   POKEBUDDY_SMOKE_SCENE=many-1000   장면(기본 many-300)
//   POKEBUDDY_SMOKE_SECONDS=10        구간마다 재는 초(기본 10)
//   POKEBUDDY_SMOKE_MINUTES=10        이 값을 주면 그만큼 켜 두고 1분마다 힙을 적는다(오래 켜 둘 때의 추세)
//
// 운영 코드에 계측을 넣지 않는다. 렌더러 안에서 아래로 센다
//   본문 다시 그리기   #body 의 자식 갈아 끼우기(MutationObserver 콜백 수)
//   모달 다시 그리기   #dialog 의 자식 갈아 끼우기
//   long task          PerformanceObserver("longtask") — 50ms 를 넘은 일의 수와 합. 숨긴 창에서는 잡히지 않을 수 있다
//   멈춤               20ms 간격 타이머가 늦게 울린 만큼 — 렌더러가 다른 일로 막힌 시간(stallMs 합, stallMax 가장 긴 것)
//   기기 창 전송       가짜 preload 의 petOpen 호출 수 (설정창 → 메인 "manage:pet-open")
// 메인 쪽은 실제 게임이다 — 1초마다 manage:snapshot 과 같은 처리(src/main/manage/game-reads.ts snapshotReply)로 스냅샷을 준다
// 결과는 JSON 한 줄로 찍는다. 판정은 하지 않는다(기준선 기록용). 끝나면 종료 코드 0
import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { writeSave } from "../../save/save-file";
import { emptySave } from "../../save/normalize";
import { createGame } from "../../tx/game";
import { petName } from "../../view/text";
import { petDeviceModel } from "../../view/device-pet";
import type { PetDeviceInput } from "../../shared/model/devices";
import type { Snapshot } from "../../shared/model/snapshot";
import { CLOCK_RULES } from "../../main/app/clock";
import { commandReply, gameReads, snapshotReply } from "../../main/manage/game-reads";
import { applyScene } from "../harness/scenes";
import { makeTmp } from "../harness/tmp-dir";
import { sleep as wait } from "../harness/wait";

const SCENE = process.env.POKEBUDDY_SMOKE_SCENE ?? "many-300";
const SECONDS = Number(process.env.POKEBUDDY_SMOKE_SECONDS ?? 10);
const MINUTES = Number(process.env.POKEBUDDY_SMOKE_MINUTES ?? 0);

const dir = makeTmp("smoke-perf");
const file = path.join(dir, "save.json");
const start = Date.now();
const save = applyScene(emptySave(start), SCENE, start);
save.lastTickAt = start;
if (!writeSave(file, save)) throw new Error("시험 저장을 쓰지 못했다");
const game = createGame({ file, now: Date.now, flushMs: CLOCK_RULES.saveMs, petName });
const reads = gameReads(game);
let snapshots = 0;
let snapshotMs = 0;

// 메인 — 앱 처리기와 같은 함수로 답한다
ipcMain.handle("smoke:snapshot", () => {
  const t0 = performance.now();
  const view = snapshotReply(game, reads);
  snapshotMs += performance.now() - t0;
  snapshots += 1;
  return view;
});
ipcMain.handle("smoke:command", (_e, raw: unknown) => commandReply(game, reads, async (req) => game.send(req, "settings"), raw));
ipcMain.handle("smoke:pet", (_e, s: Snapshot, input: unknown) => petDeviceModel(s, input as PetDeviceInput));

// 가짜 preload — 스냅샷·명령은 메인으로, 기기 창 열기는 세고 모델만 만든다. 시계는 1초마다 울린다
const preload = path.join(dir, "fixture.cjs");
fs.writeFileSync(
  preload,
  `
const { ipcRenderer } = require("electron");
window.__perf = { petOpen: 0 };
window.__cb = {};
window.pokebuddyManage = new Proxy({}, {
  get(_t, name) {
    if (name === "snapshot") return () => ipcRenderer.invoke("smoke:snapshot");
    if (name === "command") return (req) => ipcRenderer.invoke("smoke:command", req);
    if (name === "dex") return async () => [];
    if (name === "petOpen") return async (input) => {
      window.__perf.petOpen += 1;
      if (input === null) return null;
      const r = await ipcRenderer.invoke("smoke:pet", await ipcRenderer.invoke("smoke:snapshot"), input);
      return r ? r.input : null;
    };
    if (name === "onClock") return (cb) => setInterval(() => cb({ now: Date.now() }), 1000);
    if (typeof name === "string" && name.startsWith("on")) return (cb) => { window.__cb[name] = cb; };
    if (name === "portraits" || name === "icons" || name === "art") return async () => ({});
    if (name === "screens") return async () => [];
    return async () => null;
  },
});
`,
);

app.setPath("userData", path.join(dir, "user-data"));
app.disableHardwareAcceleration();

// 렌더러 안의 세기 — 한 번 걸고, 구간마다 읽고 비운다
const COUNTERS = `(() => {
  const c = window.__perf;
  Object.assign(c, { body: 0, dialog: 0, longTasks: 0, longMs: 0, stallMs: 0, stallMax: 0 });
  let last = performance.now();
  setInterval(() => { const now = performance.now(); const late = now - last - 20; last = now; if (late > 4) { c.stallMs += late; c.stallMax = Math.max(c.stallMax, late); } }, 20);
  const watch = (sel, key) => { const el = document.querySelector(sel); if (el) new MutationObserver(() => (c[key] += 1)).observe(el, { childList: true }); };
  watch('#body', 'body');
  watch('#dialog', 'dialog');
  new PerformanceObserver((list) => { for (const e of list.getEntries()) { c.longTasks += 1; c.longMs += e.duration; } }).observe({ type: 'longtask', buffered: false });
  return 0;
})()`;
const READ = `(() => { const c = window.__perf; const out = { ...c, longMs: Math.round(c.longMs), stallMs: Math.round(c.stallMs), stallMax: Math.round(c.stallMax), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }; Object.assign(c, { body: 0, dialog: 0, longTasks: 0, longMs: 0, stallMs: 0, stallMax: 0, petOpen: 0 }); return out; })()`;

void app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 682, show: false, webPreferences: { preload, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  const result: Record<string, unknown> = { scene: SCENE, pets: save.pets.length, seconds: SECONDS };
  const phase = async (name: string): Promise<void> => {
    await js(READ);
    snapshots = 0;
    snapshotMs = 0;
    await wait(SECONDS * 1000);
    result[name] = { ...(await js<Record<string, unknown>>(READ)), snapshots, snapshotMs: Math.round(snapshotMs) };
  };
  try {
    await win.loadFile(path.resolve(__dirname, "../../../src/renderer/manage.html"));
    await wait(1500);
    await js(`document.hasFocus = () => true; 0`);
    await js(COUNTERS);
    // (1) 파티 탭, 아무 조작 없음
    await phase("idle");
    // (2) 파티 상세 기기 창을 연 채
    await js(`document.querySelector('#body .slot[data-pet]')?.click(); 0`);
    await wait(500);
    await phase("petDevice");
    // (3) 오래 켜 둘 때 — 1분마다 렌더러 힙과 메인 힙
    if (MINUTES > 0) {
      const heap: { min: number; rendererMB: unknown; mainMB: number }[] = [];
      for (let m = 1; m <= MINUTES; m += 1) {
        await wait(60_000);
        const r = await js<{ heapMB: unknown }>(READ);
        heap.push({ min: m, rendererMB: r.heapMB, mainMB: Math.round(process.memoryUsage().heapUsed / 1048576) });
      }
      result.heap = heap;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
