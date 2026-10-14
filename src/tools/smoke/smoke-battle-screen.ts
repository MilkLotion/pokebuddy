// 배틀 창 재생 확인 — 숨긴 창(offscreen)에 배틀 창 문서를 띄우고 로컬 엔진 판 하나를 끝까지 재생한다 (worklog/records/perf-refactor 4-5)
//
//   npm run build 뒤 electron dist/tools/smoke/smoke-battle-screen.js
//   POKEBUDDY_SMOKE_SEED=7   판 시드(기본 7)
//
// 화면에 창을 띄우지 않는다. 판은 개발 실행(POKEBUDDY_DEV_BATTLE)과 같은 로컬 엔진·화면 모델로 만든다. 그림은 초상과 타입 아이콘만 받는다(PMD 없음)
// 세는 것
//   dpsTables   DPS 표를 새로 만든 수 — 줄 순서가 바뀔 때만 늘어야 한다
//   dpsImgs     DPS 표의 초상 img 를 새로 만든 수
//   fxMade      연출(기술 알약·특성·피해 숫자) 요소를 새로 만든 수 / fxShown 프레임마다 떠 있던 연출 수의 합
//   errors      렌더러 콘솔 오류
// 결과는 JSON 한 줄. 판이 끝나 결과 창이 뜨면 끝난다. 결과 창이 안 뜨거나 오류가 있으면 종료 코드 1
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { runBattle, type EngineFighter } from "../../battle/engine";
import { battleTypeChart, buildFighter } from "../../battle/fighter";
import { tierOf } from "../../battle/tier";
import { isMetaKey } from "../../dex/data";
import { profileOf } from "../../dex/species";
import { speciesMoveTable, speciesTable } from "../../dex/tables";
import { battleScreenArtKeys, battleScreenModel, withBattleScreenArt } from "../../view/battle-screen";
import { artServices } from "../../main/art/services";
import { portraitKey } from "../../main/art/portraits";
import { rendererFile } from "../../main/windows/files";
import { makeTmp } from "../harness/tmp-dir";
import { sleep as wait } from "../harness/wait";

const SEED = Number(process.env.POKEBUDDY_SMOKE_SEED ?? 7);
const dir = makeTmp("smoke-battle-screen");
app.setPath("userData", path.join(dir, "user-data"));

function rand32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 가짜 preload — 판은 window.__show, 높이·로그는 버린다
const preload = path.join(dir, "battle-screen-fixture.cjs");
fs.writeFileSync(
  preload,
  `window.__errors = [];
window.addEventListener("error", (e) => window.__errors.push(String(e.message)));
const origError = console.error;
console.error = (...a) => { window.__errors.push(a.map(String).join(" ")); origError(...a); };
window.pokebuddyBattleScreen = new Proxy({}, { get(_t, name) {
  if (name === "onShow") return (cb) => { window.__show = cb; };
  if (name === "onLoading") return () => {};
  return () => {};
} });`,
);

// 렌더러 안의 세기 — DPS 표·초상·연출 요소가 새로 생긴 수
const COUNTERS = `(() => {
  const c = window.__c = { dpsTables: 0, dpsImgs: 0, fxMade: 0, fxShown: 0, frames: 0 };
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      if (n.classList.contains("dps-table")) { c.dpsTables += 1; c.dpsImgs += n.querySelectorAll("img").length; }
      if (n.parentElement?.classList.contains("fx")) c.fxMade += 1;
    }
  }).observe(document.body, { childList: true, subtree: true });
  const tick = () => { c.frames += 1; c.fxShown += document.querySelector(".fx")?.children.length ?? 0; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return 0;
})()`;

void app.whenReady().then(async () => {
  try {
    // 판 — 개발 실행과 같은 풀에서 시드로 두 파티
    const pool: EngineFighter[] = [];
    for (const slug of Object.keys(speciesTable())) {
      if (isMetaKey(slug) || !speciesMoveTable()[slug]) continue;
      if ((profileOf(slug).bst ?? 0) < 400 || tierOf(slug)) continue;
      const f = buildFighter({ species: slug });
      if (f) pool.push(f);
    }
    const rand = rand32(SEED * 7919);
    const pick = (): EngineFighter => pool[Math.floor(rand() * pool.length)]!;
    const sides = [Array.from({ length: 6 }, pick), Array.from({ length: 6 }, pick)] as const;
    const result = runBattle({ seed: SEED, sides, typeChart: battleTypeChart() });
    const model = battleScreenModel({ sides, result, looks: [sides[0].map(() => null), sides[1].map(() => null)], opponentName: "상대", reward: { lead: "+10P", detail: "" } });
    // 그림 — 초상과 타입 아이콘
    const portraits = artServices().portraits;
    const keys = battleScreenArtKeys(model);
    const asks = keys.filter((k) => k.startsWith("portrait:")).map((k) => ({ key: k, slug: k.slice(9).replace(/:shiny$/, ""), shiny: k.endsWith(":shiny") }));
    const items = keys.filter((k) => !k.startsWith("portrait:"));
    const [faces, icons] = await Promise.all([portraits.get(asks.map((a) => ({ slug: a.slug, shiny: a.shiny }))), items.length ? portraits.icons(items) : {}]);
    const art: Record<string, string | null> = {};
    for (const a of asks) art[a.key] = faces[portraitKey(a)] ?? null;
    for (const k of items) art[k] = (icons as Record<string, string | null>)[k] ?? null;
    const view = { ...withBattleScreenArt(model, art), sprites: {}, side: "right" };

    const win = new BrowserWindow({ width: 900, height: 820, show: false, webPreferences: { preload, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
    const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
    await win.loadFile(rendererFile("battle-screen.html"));
    await wait(500);
    await js(COUNTERS);
    // 판을 보낸다 — 2배속으로 끝까지
    await js(`window.__show(${JSON.stringify(view)}); 0`);
    await wait(300);
    await js(`document.querySelectorAll(".speed button")[1]?.click(); 0`);
    const limit = Date.now() + (model.endMs / 2 + 30_000);
    let done = false;
    while (Date.now() < limit) {
      await wait(500);
      done = await js<boolean>(`!!document.querySelector(".result")`);
      if (done) break;
    }
    const c = await js<Record<string, number>>(`({ ...window.__c })`);
    const errors = await js<string[]>(`window.__errors`);
    // 끝난 판의 DPS 표 글자(줄 차례대로) — 고치기 전후를 견줄 때 쓴다
    const dpsText = await js<string>(`[...document.querySelectorAll(".dps-panel .dps-row")].map((r) => r.textContent).join("|")`);
    const out = { seed: SEED, endMs: model.endMs, resultShown: done, ...c, errors, dpsText };
    process.stdout.write(`${JSON.stringify(out)}\n`);
    app.exit(done && errors.length === 0 ? 0 : 1);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
