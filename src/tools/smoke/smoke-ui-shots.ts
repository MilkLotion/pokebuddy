// 설정창 화면 찍기 — 숨긴 창(offscreen)에 설정창을 띄우고 탭·머리 단추·경로로 여는 모달·머리 메뉴 항목을 차례로 찍는다 (worklog/records/perf-refactor 10단계)
// CSS·공통 부품을 고치기 전후로 찍어 compare-shots 로 견준다 — 화면이 바뀌지 않았는지 픽셀로 본다
//
//   npm run build 뒤 electron dist/tools/smoke/smoke-ui-shots.js <폴더>
//   node dist/tools/dev/compare-shots.js <전 폴더> <후 폴더>
//
// 스냅샷은 시각을 고정한 한 장이다. 시계(onClock)는 울리지 않는다. 그림(초상·아이콘)은 주지 않는다 — 같은 입력이면 같은 그림이 나와야 한다.
// 같은 코드로 두 번 찍어 차이가 0 인지 먼저 본다(compare-shots 의 잡음 확인)
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { emptySave as empty } from "../../save/normalize";
import { applyStarter } from "../../party/starter";
import { unlockByRules } from "../../dex/unlocks";
import { newPet, nextPetId } from "../../party/create";
import { addToBox } from "../../box/slots";
import { snapshotView } from "../../view/snapshot";
import { dexList } from "../../view/dex-list";
import { writeSave } from "../../save/save-file";
import { createGame } from "../../tx/game";
import { petName } from "../../view/text";
import { gameReads } from "../../main/manage/game-reads";
import { petDeviceModel } from "../../view/device-pet";
import { bagDeviceModel } from "../../view/device-bag";
import { shopDeviceModel } from "../../view/device-shop";
import { battleDeviceModel } from "../../view/device-battle";
import { rendererFile } from "../../main/windows/files";
import { makeTmp } from "../harness/tmp-dir";
import { sleep as wait } from "../harness/wait";

const out = process.argv[2];
if (!out) throw new Error("찍은 그림을 둘 폴더를 준다 — electron dist/tools/smoke/smoke-ui-shots.js <폴더>");
fs.mkdirSync(out, { recursive: true });
const dir = makeTmp("ui-shots");
const NOW = 1_700_000_000_000;

// 저장 — 파이리로 시작, 박스 8마리, 사탕·돌, 알 둘, 포인트
const save = empty(NOW);
applyStarter(save, "charmander", NOW, () => 0.5);
unlockByRules(save, NOW);
save.points.balance = 1234;
for (let i = 0; i < 8; i += 1) {
  const id = nextPetId(save);
  save.pets.push(newPet({ id, species: i % 2 ? "rattata" : "pidgey", shiny: false, nature: "hardy", gender: "male", now: NOW }));
  addToBox(save.boxes, id);
}
save.bag["exp-candy-s"] = 3;
save.bag["fire-stone"] = 1;
save.battle = { slots: [save.pets[0]!.id, save.pets[1]!.id, null, null, null, null] };
const snap = { ...snapshotView(save, NOW), screenTutorials: [], detailTutorial: false };
const dex = dexList(save);
const petId = save.pets[0]!.id;

const preload = path.join(dir, "fixture.cjs");
fs.writeFileSync(
  preload,
  `
const snap = ${JSON.stringify(snap)};
const dex = ${JSON.stringify(dex)};
window.__cb = {};
Date.now = () => ${NOW};
window.pokebuddyManage = new Proxy({}, {
  get(_t, name) {
    if (name === "snapshot") return async () => JSON.parse(JSON.stringify(snap));
    if (name === "dex") return async () => dex;
    if (name === "onClock") return () => {};
    if (typeof name === "string" && name.startsWith("on")) return (cb) => { window.__cb[name] = cb; };
    if (name === "portraits" || name === "icons" || name === "art") return async () => ({});
    if (name === "command") return async (req) => (req && req.cmd === "trade.status" && window.__trade ? { ok: true, screen: window.__trade } : { ok: false, reason: "mock" }); // 교환 상태는 window.__trade
    if (name === "screens") return async () => [];
    if (name.endsWith("Open")) return async () => null;
    return async () => null;
  },
});
`,
);

app.setPath("userData", path.join(dir, "user-data"));
app.disableHardwareAcceleration();

void app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 682, show: false, webPreferences: { preload, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  const names: string[] = [];
  const shot = async (name: string): Promise<void> => {
    await wait(350);
    win.webContents.invalidate();
    await wait(80);
    const file = `${String(names.length).padStart(3, "0")}-${name.replace(/[^\p{L}\p{N}-]+/gu, "_")}.png`;
    names.push(file);
    fs.writeFileSync(path.join(out, file), (await win.webContents.capturePage()).toPNG());
  };
  // 떠 있는 모달을 모두 닫는다 — Esc 를 몇 번
  const closeAll = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      if (!(await js<boolean>(`document.getElementById('scrim').classList.contains('open')`))) return;
      await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0`);
      await wait(150);
    }
  };
  // 모달 안의 탭 단추(설정·사용자 등)를 하나씩 눌러 찍는다
  const dialogTabs = async (base: string): Promise<void> => {
    const TABS = `#dialog [role="tab"], #dialog [role="tablist"] button`;
    const n = await js<number>(`document.querySelectorAll('${TABS}').length`);
    for (let i = 0; i < n; i++) {
      await js(`document.querySelectorAll('${TABS}')[${i}]?.click(); 0`);
      await shot(`${base}-tab${i}`);
    }
  };
  try {
    await win.loadFile(path.resolve(__dirname, "../../../src/renderer/manage.html"));
    await wait(1000);
    await js(`document.hasFocus = () => true; 0`);

    // 탭
    const tabs = await js<string[]>(`[...document.querySelectorAll('#tabs button')].map((b) => b.textContent.trim())`);
    for (let i = 0; i < tabs.length; i++) {
      await js(`document.querySelectorAll('#tabs button')[${i}].click(); 0`);
      await shot(`tab-${tabs[i]}`);
      // 머리 메뉴 — 항목마다 눌러 찍는다(모달이 열리면 닫는다)
      const items = await js<string[]>(`(() => { const t = document.querySelector('#body .head [class*="menu-toggle"]'); if (!t) return []; t.click(); return [...document.querySelectorAll('#body .head .sort-item')].map((b) => b.textContent.trim()); })()`);
      if (items.length) await shot(`tab-${tabs[i]}-menu`);
      for (const label of items) {
        await closeAll();
        await js(`(() => { const t = document.querySelector('#body .head [class*="menu-toggle"]'); if (!document.querySelector('#body .head .sort-item')) t?.click(); [...document.querySelectorAll('#body .head .sort-item')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click(); })(); 0`);
        await shot(`tab-${tabs[i]}-menu-${label}`);
        await dialogTabs(`tab-${tabs[i]}-menu-${label}`);
        await closeAll();
      }
      await js(`document.querySelectorAll('#tabs button')[${i}].click(); 0`); // 메뉴를 닫는다
    }

    // 머리 단추 — 우편함 단추는 우편이 있을 때만 보이므로 드러내서 누른다
    for (const id of ["open-achievements", "open-settings", "open-user", "open-mail"]) {
      const ok = await js<boolean>(`(() => { const b = document.getElementById('${id}'); if (!b) return false; b.hidden = false; b.click(); return true; })()`);
      if (!ok) continue;
      await shot(id);
      await dialogTabs(id);
      await closeAll();
    }

    // 모험 탭의 배틀 시작 → 배틀 고르기 → 랜덤 배틀(상대 고르기)
    const byText = (scope: string, text: string): string => `[...document.querySelectorAll('${scope} button')].find((b) => b.textContent.trim().includes(${JSON.stringify(text)}))`;
    await js(`[...document.querySelectorAll('#tabs button')].find((b) => b.textContent.includes('모험'))?.click(); 0`);
    await wait(300);
    if (await js<boolean>(`(() => { const b = ${byText("#body", "배틀 시작")}; b?.click(); return !!b; })()`)) {
      await shot("battle-start");
      if (await js<boolean>(`(() => { const b = ${byText("#dialog", "랜덤 배틀")}; b?.click(); return !!b; })()`)) await shot("battle-start-random");
      await closeAll();
    }

    // 경로로 여는 모달
    const routes: Record<string, unknown>[] = [
      { to: "daycare" },
      { to: "swap" },
      { to: "battle-pick", slot: 0 },
      { to: "friendly" },
      { to: "battle-record" },
      { to: "trade" },
      { to: "account" },
      { to: "agents" },
      { to: "move", petId },
      { to: "sell", petId, price: 30 },
    ];
    for (const r of routes) {
      await js(`window.__cb.onRoute(${JSON.stringify(r)}); 0`);
      await shot(`route-${String(r.to)}`);
      await closeAll();
    }
    // 교환 완료 화면 셋 — 정상, 받지 못함(규칙 밖 값·빈 칸 없음). 상태는 가짜 trade.status 답으로 준다
    const card = { species: "eevee", shiny: false, level: 22, nature: "고집", name: "이브이", nameParts: null, types: ["노말"], typeIds: ["normal"] };
    const doneBase = { available: true, phase: "done", link: null, expiresAt: null, busy: false, closedReason: null, friendJoined: true, friendName: null, mine: card, myPetId: petId, myReady: true, friend: card, friendReady: true, friendBlocked: null, singles: [] };
    const tradeStates: [string, unknown][] = [
      ["trade-done", { ...doneBase, error: null, received: { petId: "p99", card, party: 1, box: null, hidden: false, sent: card } }],
      ["trade-done-refused-bad", { ...doneBase, error: { code: "LOCAL", detail: "bad-received" }, received: null }],
      ["trade-done-refused-room", { ...doneBase, error: { code: "LOCAL", detail: "no-room" }, received: null }],
    ];
    for (const [name, screen] of tradeStates) {
      await js(`window.__trade = ${JSON.stringify(screen)}; window.__cb.onRoute({ to: "trade" }); 0`);
      await shot(name);
      await closeAll();
    }
    await js(`window.__trade = null; 0`);

    // 기기 창 — 시각을 고정한 시험 저장으로 메인과 같은 모델을 만들어 각 창 문서에 보낸다. 그림은 null
    const file = path.join(dir, "save.json");
    if (!writeSave(file, save)) throw new Error("시험 저장을 쓰지 못했다");
    const reads = gameReads(createGame({ file, now: () => NOW, flushMs: 60_000, petName }));
    const v = reads.snapshot();
    if (!v) throw new Error("스냅샷이 없다");
    const pet = petDeviceModel(v, { petId, notice: "", dexOpen: false, busy: null })?.model;
    const bag = bagDeviceModel(v, { itemId: "exp-candy-s", mode: "use", targetPetId: null, qty: 1, sellQty: 1, notice: "", result: null, busy: false })?.model;
    const stone = bagDeviceModel(v, { itemId: "fire-stone", mode: "use", targetPetId: null, qty: 1, sellQty: 1, notice: "", result: null, busy: false })?.model;
    const product = v.shop.find((i) => i.about) ?? v.shop[0];
    const shop = product ? shopDeviceModel(v, { productId: product.id, qty: 1, notice: "", done: null, busy: false })?.model : null;
    const battle = battleDeviceModel(v, { slot: 0, notice: "", busy: null })?.model;
    const slug = save.pets[0]!.species;
    const detail = reads.detailOf(slug);
    const shopDetail = reads.shopDetailOf(slug);
    const tree = detail?.megaTree ?? (shopDetail?.kind === "pokemon" ? shopDetail.tree : null);
    // 그림 열쇠는 null 로 — 기기 창은 그림이 없으면 빈 자리로 그린다
    const noArt = (m: unknown): unknown => JSON.parse(JSON.stringify(m), (_k, val: unknown) => (typeof val === "string" && /^(portrait|item|egg|type):/.test(val) ? null : val));
    const devices: [string, string, string, unknown][] = [
      ["pet", "pet.html", "pokebuddyPet", pet && { ...pet, portrait: null, megaIcon: null, volume: 0 }],
      ["bag-candy", "bag.html", "pokebuddyBag", bag && noArt(bag)],
      ["bag-stone", "bag.html", "pokebuddyBag", stone && noArt(stone)],
      ["shop", "shop.html", "pokebuddyShop", shop && noArt(shop)],
      ["dex", "dex.html", "pokebuddyDex", detail && { detail, portrait: null, shinyPortrait: null, volume: 0, tree, treePortraits: {}, beside: false }],
      ["battle", "battle.html", "pokebuddyBattle", battle && { ...(noArt(battle) as object), portrait: null, megaIcon: null, typeIcons: {}, volume: 0 }],
    ];
    for (const [name, html, bridge, model] of devices) {
      if (!model) throw new Error(`기기 창 모델이 없다: ${name}`);
      const dpre = path.join(dir, `${name}-fixture.cjs`);
      fs.writeFileSync(dpre, `Date.now = () => ${NOW}; window[${JSON.stringify(bridge)}] = new Proxy({}, { get(_t, k) { if (k === "onShow") return (cb) => { window.__show = cb; }; return () => {}; } });`);
      const dw = new BrowserWindow({ width: 380, height: 760, show: false, webPreferences: { preload: dpre, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
      await dw.loadFile(rendererFile(html));
      await wait(500);
      await dw.webContents.executeJavaScript(`window.__show(${JSON.stringify({ ...(model as object), side: "right" })}); 0`);
      await wait(500);
      dw.webContents.invalidate();
      await wait(100);
      const fileName = `${String(names.length).padStart(3, "0")}-device-${name}.png`;
      names.push(fileName);
      fs.writeFileSync(path.join(out, fileName), (await dw.webContents.capturePage()).toPNG());
      dw.destroy();
    }
    process.stdout.write(`${JSON.stringify({ out, shots: names.length })}\n`);
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
