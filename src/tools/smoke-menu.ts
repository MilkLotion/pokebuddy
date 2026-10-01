// 메뉴 창 화면 검사 — 숨긴 창·임시 폴더·가짜 preload 만 쓴다
// npm run build 뒤 electron dist/tools/smoke-menu.js   (POKEBUDDY_SMOKE_SHOTS=폴더 를 주면 화면 그림을 거기에 남긴다)
//
// 검사 대상 — 포켓몬 메뉴의 `모습 바꾸기` 말풍선 (Figma 05 `Party / Shared Form Tip` `501:14010`, 2026-10-02 사용자 시안)
//   뜨는 때    마우스를 올려서는 뜨지 않는다. 항목을 눌러야 뜨고, 눌러도 메뉴는 닫히지 않는다. 다시 누르거나 Esc 로 말풍선만 닫는다
//   자리       메뉴 오른쪽 8, 아래 끝은 그 항목 아래 끝 + 5. 꼬리의 세로 가운데는 그 항목의 세로 가운데
//   왼쪽       화면 오른쪽에 자리가 없으면(메인이 left 를 준다) 말풍선이 메뉴 왼쪽에 앉는다
//   고르기     모습 줄을 누르면 그 줄의 번호를 돌려준다. 지금 모습 줄은 누를 수 없다. 빈 곳을 누르면 닫는다
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { menuView, petMenu, subId } from "../main/menus";
import { t } from "../main/text";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokebuddy-menu-"));
const shots = process.env.POKEBUDDY_SMOKE_SHOTS ?? dir;

// 가짜 preload — 메인이 할 일을 창 안의 값으로 받아 둔다
const preload = path.join(dir, "fixture.cjs");
fs.writeFileSync(
  preload,
  `
window.__picks = [];
window.__size = null;
window.__placed = false;
window.pokebuddyMenu = {
  onShow(cb) { window.__show = cb; },
  size(w, h, sub) { window.__size = { w, h, sub: sub ?? null }; },
  onSide(cb) { window.__side = cb; },
  placed() { window.__placed = true; },
  pick(id) { window.__picks.push(id); },
};
`,
);

// 1×1 그림 — 초상 자리에 그림이 들어가는지만 본다
const DOT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const off = { enabled: false };
const forms = [
  { species: "cosmog", name: "코스모그", current: false, portrait: DOT },
  { species: "cosmoem", name: "코스모움", current: false, portrait: DOT },
  { species: "solgaleo", name: "솔가레오", current: true, portrait: DOT },
  { species: "lunala", name: "루나아라", current: false, portrait: DOT },
];
const act = { feed: () => undefined, play: () => undefined, ball: () => undefined, detail: () => undefined, form: () => undefined };
const partyModel = petMenu({ name: "솔가레오", nature: null, status: "배부름 · 기분 좋음", feed: { enabled: true }, play: { enabled: true }, ball: { enabled: true, hidden: false }, forms, sell: { enabled: false } }, act);
const boxModel = petMenu({ name: "솔가레오", nature: null, status: "배부름 · 기분 좋음", feed: off, play: off, ball: { enabled: false, hidden: false }, forms, move: { enabled: true }, sell: { enabled: false } }, act);
const plainModel = petMenu({ name: "피카츄", nature: null, status: "보통 · 기분 좋음", feed: { enabled: true }, play: off, ball: { enabled: true, hidden: false }, sell: { enabled: true } }, act);

app.setPath("userData", path.join(dir, "user-data"));
app.disableHardwareAcceleration();
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

void app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 480, show: false, backgroundColor: "#eeeeea", webPreferences: { preload, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  const shot = async (name: string): Promise<void> => {
    fs.writeFileSync(path.join(shots, name), (await win.webContents.capturePage()).toPNG());
  };
  const show = async (model: Parameters<typeof menuView>[0], side: "left" | "right" | null): Promise<void> => {
    await js(`window.__picks = []; window.__placed = false; window.__show(${JSON.stringify(menuView(model, "켜짐"))}); 0`);
    await wait(150);
    if (side) await js(`window.__side('${side}'); 0`);
    await wait(150);
  };
  const rect = (sel: string): string => `(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; })()`;
  type Rect = { x: number; y: number; w: number; h: number; r: number; b: number };
  const formItem = `[...document.querySelectorAll('#menu .item')].find((b) => b.querySelector('.label').textContent === '${t("menu.form")}')`;
  const shown = `document.getElementById('bubble').classList.contains('shown')`;
  try {
    await win.loadFile(path.resolve(__dirname, "../../src/renderer/menu.html"));
    await wait(500);

    // (1) 말풍선 없는 메뉴 — 크기만 알린다. 흐린 줄에 이유가 없다
    await show(plainModel, null);
    const plain = await js<{ size: { w: number; h: number; sub: unknown }; hints: number; labels: string[] }>(`({
      size: window.__size,
      hints: document.querySelectorAll('#menu .hint').length,
      labels: [...document.querySelectorAll('#menu .item')].map((b) => b.querySelector('.label').textContent + (b.disabled ? ' (흐림)' : '')),
    })`);
    assert.equal(plain.size.sub, null, "말풍선이 없으면 메뉴 크기만 알린다");
    assert.equal(plain.hints, 0, "흐린 줄에 이유를 적지 않는다");
    assert.equal(plain.size.w, 160, "포켓몬 메뉴 폭 160");
    assert.equal(await js<number>(`document.querySelectorAll('#menu .separator').length`), 2, "구분선은 이름·상태 아래와 팔기 위 둘뿐 — 볼에 넣기와 상세 보기 사이에는 없다");
    assert.deepEqual(plain.labels, [t("menu.feed"), `${t("menu.play")} (흐림)`, t("menu.ball"), t("menu.detail"), `${t("menu.sell")} (흐림)`], "파티 일반 개체 — 팔기는 기능 전이라 흐리다");
    await shot("menu-plain.png");

    // (2) 파티 공유 계열 — 말풍선은 누르기 전에는 보이지 않는다
    await show(partyModel, "right");
    const size = await js<{ w: number; h: number; sub: { w: number; h: number; top: number } | null }>(`window.__size`);
    assert.ok(size.sub, "말풍선이 있으면 그 크기와 자리를 함께 알린다");
    assert.equal(await js<boolean>(`window.__placed`), true, "뜰 쪽을 받으면 자리를 잡고 알린다");
    assert.equal(await js<boolean>(shown), false, "누르기 전에는 말풍선이 보이지 않는다");
    await js(`${formItem}.dispatchEvent(new MouseEvent('mouseenter')); ${formItem}.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); 0`);
    await wait(400);
    assert.equal(await js<boolean>(shown), false, "마우스를 올려서는 말풍선이 뜨지 않는다");
    await shot("menu-party-closed.png");

    // (3) 누르면 말풍선 — 메뉴는 닫히지 않는다
    await js(`${formItem}.click()`);
    await wait(150);
    assert.equal(await js<boolean>(shown), true, "모습 바꾸기를 누르면 말풍선이 뜬다");
    assert.deepEqual(await js<unknown[]>(`window.__picks`), [], "모습 바꾸기를 눌러도 메뉴는 닫히지 않는다");
    assert.equal(await js<boolean>(`${formItem}.classList.contains('open')`), true, "말풍선이 열린 동안 그 항목은 옅은 바탕");
    const menuR = await js<Rect>(rect("#menu"));
    const bubbleR = await js<Rect>(rect("#bubble"));
    const itemR = await js<Rect>(`(() => { const r = ${formItem}.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; })()`);
    const tailR = await js<Rect>(rect("#bubble .tail"));
    assert.equal(Math.round(bubbleR.x - menuR.r), 8, "말풍선은 메뉴 오른쪽 8");
    assert.equal(Math.round(bubbleR.b - itemR.b), 5, "말풍선 아래 끝은 그 항목 아래 끝 + 5");
    assert.ok(Math.abs(tailR.y + tailR.h / 2 - (itemR.y + itemR.h / 2)) <= 1, `꼬리는 그 항목의 세로 가운데 (${tailR.y + tailR.h / 2} / ${itemR.y + itemR.h / 2})`);
    assert.ok(tailR.x < bubbleR.x && tailR.x > menuR.r - 1, `꼬리는 메뉴와 말풍선 사이 (${tailR.x})`);
    assert.equal(Math.round(bubbleR.w), 198, "말풍선 폭 198");
    assert.equal(size.sub?.top, Math.round(bubbleR.y - menuR.y), "알린 말풍선 자리가 그린 자리와 같다");
    const bubble = await js<{ head: string; rows: string[]; faces: number }>(`({
      head: document.querySelector('#bubble .head').textContent,
      rows: [...document.querySelectorAll('#bubble .row')].map((r) => r.querySelector('.name').textContent + ' · ' + r.querySelector('.note').textContent + (r.disabled ? ' (누를 수 없음)' : '')),
      faces: document.querySelectorAll('#bubble .row .face img').length,
    })`);
    assert.equal(bubble.head, t("menu.form.title"), "말풍선 머리 줄");
    assert.deepEqual(bubble.rows, [`코스모그 · ${t("menu.form.go")}`, `코스모움 · ${t("menu.form.go")}`, `솔가레오 · ${t("menu.form.now")} (누를 수 없음)`, `루나아라 · ${t("menu.form.go")}`], "모습 줄");
    assert.equal(bubble.faces, 4, "모습 줄마다 초상");
    await shot("menu-party-open.png");
    // 줄·항목에 마우스를 올렸다 치우면 옅은 바탕이 남지 않는다. 지금 줄의 바탕만 남는다
    const hover = await js<{ on: number; after: number; itemOn: number; itemAfter: number }>(`(() => {
      const row = document.querySelectorAll('#bubble .row')[0];
      row.dispatchEvent(new MouseEvent('mouseenter'));
      const on = document.querySelectorAll('#bubble .row.on').length;
      row.dispatchEvent(new MouseEvent('mouseleave'));
      const after = document.querySelectorAll('#bubble .row.on').length;
      const item = document.querySelector('#menu .item');
      item.dispatchEvent(new MouseEvent('mouseenter'));
      const itemOn = document.querySelectorAll('#menu .item.on').length;
      item.dispatchEvent(new MouseEvent('mouseleave'));
      return { on, after, itemOn, itemAfter: document.querySelectorAll('#menu .item.on').length };
    })()`);
    assert.deepEqual(hover, { on: 1, after: 0, itemOn: 1, itemAfter: 0 }, "마우스를 치우면 가리킨 바탕이 사라진다");

    // (4) Esc 는 말풍선만 닫는다. 한 번 더 누르면 메뉴를 닫는다
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0`);
    assert.equal(await js<boolean>(shown), false, "Esc — 말풍선만 닫는다");
    assert.deepEqual(await js<unknown[]>(`window.__picks`), [], "Esc — 말풍선이 떠 있었으면 메뉴는 그대로");
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0`);
    assert.deepEqual(await js<unknown[]>(`window.__picks`), [null], "Esc 한 번 더 — 메뉴를 닫는다");

    // (5) 모습 줄을 누르면 그 줄의 번호. 지금 모습 줄은 누를 수 없다. 빈 곳을 누르면 닫는다
    await show(partyModel, "right");
    await js(`${formItem}.click()`);
    const formAt = partyModel.findIndex((m) => m.label === t("menu.form"));
    await js(`document.querySelectorAll('#bubble .row')[2].click(); document.querySelectorAll('#bubble .row')[3].click(); 0`);
    assert.deepEqual(await js<unknown[]>(`window.__picks`), [subId(formAt, 3)], "모습 줄 — 지금 줄은 누를 수 없고, 다른 줄은 그 번호를 돌려준다");
    await js(`window.__picks = []; document.getElementById('wrap').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); 0`);
    assert.deepEqual(await js<unknown[]>(`window.__picks`), [null], "메뉴와 말풍선 밖의 빈 곳을 누르면 닫는다");

    // (6) 박스 공유 계열 — 옮기기가 맨 위에, 팔기가 모습 바꾸기 아래에 붙어도 꼬리는 그 항목을 가리킨다
    await show(boxModel, "right");
    await js(`${formItem}.click()`);
    await wait(150);
    const boxItem = await js<Rect>(`(() => { const r = ${formItem}.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; })()`);
    const boxTail = await js<Rect>(rect("#bubble .tail"));
    const boxBubble = await js<Rect>(rect("#bubble"));
    assert.ok(Math.abs(boxTail.y + boxTail.h / 2 - (boxItem.y + boxItem.h / 2)) <= 1, "박스 메뉴 — 꼬리는 모습 바꾸기 줄의 세로 가운데");
    assert.equal(Math.round(boxBubble.b - boxItem.b), 5, "박스 메뉴 — 말풍선 아래 끝은 그 항목 아래 끝 + 5");
    const boxLabels = await js<string[]>(`[...document.querySelectorAll('#menu .item')].map((b) => b.querySelector('.label').textContent + (b.disabled ? ' (흐림)' : ''))`);
    assert.deepEqual(
      boxLabels,
      [`${t("menu.move")} (흐림)`, `${t("menu.feed")} (흐림)`, `${t("menu.play")} (흐림)`, `${t("menu.ball")} (흐림)`, t("menu.detail"), t("menu.form"), `${t("menu.sell")} (흐림)`],
      "박스 공유 계열 — 돌봄·볼·옮기기·팔기 흐림",
    );
    await shot("menu-box-open.png");

    // (7) 왼쪽 — 말풍선이 메뉴 왼쪽에, 꼬리는 말풍선 오른쪽 변에
    await show(partyModel, "left");
    await js(`${formItem}.click()`);
    await wait(150);
    const leftMenu = await js<Rect>(rect("#menu"));
    const leftBubble = await js<Rect>(rect("#bubble"));
    const leftTail = await js<Rect>(rect("#bubble .tail"));
    assert.equal(Math.round(leftMenu.x - leftBubble.r), 8, "왼쪽 — 말풍선은 메뉴 왼쪽 8");
    assert.ok(leftTail.r > leftBubble.r && leftTail.r < leftMenu.x + 1, `왼쪽 — 꼬리는 말풍선과 메뉴 사이 (${leftTail.r})`);
    await shot("menu-party-left.png");

    process.stdout.write(`메뉴 창 검사 통과: 말풍선 없는 메뉴 · 누르기 전 숨김 · 누르면 말풍선(메뉴 그대로) · 자리와 꼬리 · Esc · 모습 고르기 · 박스 메뉴 · 왼쪽 · 그림 ${shots}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  }
});
