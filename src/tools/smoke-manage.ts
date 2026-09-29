// 관리 창 화면 검사 — 숨긴 창·임시 폴더·가짜 preload 만 쓴다
// npm run build 뒤 electron dist/tools/smoke-manage.js   (POKEBUDDY_SMOKE_SHOTS=폴더 를 주면 화면 그림을 거기에 남긴다)
//
// 검사 대상
//   검색 칸    입력 중에는 거르지 않고 Enter·`검색` 단추에서만 거른다 (2026-09-29 사용자 결정). 입력 중에는 칸 요소를 갈아 끼우지 않는다 —
//              갈아 끼우면 한글 조합이 끊긴다("어래곤" → "어곤"). 조합 중 Enter 는 확정 직후 한 번 거른다(Enter 한 번)
//   1초 시계   시간 값만 바뀌면 표시만 고친다 — 탭 포커스·title 요소가 남는다. 모양이 바뀌어 다시 그려도 포커스를 되돌린다
//   격자 넘김  도감·상점 포켓몬 탭은 한 쪽 15칸 · ◀ ▶. 1초 시계에도 쪽이 남는다. 긴 세로 스크롤이 없다
//   성격 창    고르기 전후로 창 높이가 같다
//   보는 방식  도감·상점 포켓몬 탭의 쪽 | 스크롤 토글. 스크롤은 작업 전 화면(도감 칸 격자·상점 상품 줄) 그대로 넘김 없이 · 다시 그려도 스크롤 유지 ·
//              도감·상점을 따로 기억하고 다시 읽어도(localStorage) 남는다 (2026-09-29 사용자 결정)
// 실제 IME 는 흉내 낼 수 없어서 요소가 같은 객체로 남는지, 조합 이벤트 사이에 다시 그리지 않는지로 본다
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unlockByRules } from "../dex/unlocks";
import { begin } from "../party/starter";
import { empty } from "../save/v3";
import { dexList } from "../tx/lists";
import { snapshot } from "../tx/snapshot";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokebuddy-manage-"));
const shots = process.env.POKEBUDDY_SMOKE_SHOTS ?? dir;

// 첫 선택을 마친 저장 — 화석 암나이트는 해금해 둔다. 첫 개체는 꺼내 둔다
const save = empty(0);
begin(save, "charmander", 0, () => 0.5);
unlockByRules(save, 0);
save.dex.unlocked.push("omanyte");
save.points.balance = 500;
const snap = { ...snapshot(save), screenTutorials: [], detailTutorial: false }; // 첫 진입 튜토리얼은 뺀다 — 말풍선이 초점을 가져간다
const dex = dexList(save);

// 가짜 preload — snapshot·dex 만 값을 준다. 구독(on*)은 콜백만 받아 둔다(window.__cb). 시계(onClock)는 1초마다 울린다
// 파티 개체의 만복도는 1초마다 1 줄어든다(시간 값). window.__bump 를 올리면 포인트가 바뀌어 모양이 바뀐다(전체 다시 그리기)
const preload = path.join(dir, "fixture.cjs");
fs.writeFileSync(
  preload,
  `
const snap = ${JSON.stringify(snap)};
const dex = ${JSON.stringify(dex)};
const t0 = Date.now();
window.__bump = 0;
window.__cb = {};
window.pokebuddyManage = new Proxy({}, {
  get(_t, name) {
    if (name === "snapshot") return async () => {
      const s = JSON.parse(JSON.stringify(snap));
      const sec = Math.floor((Date.now() - t0) / 1000);
      for (const slot of s.party.slots) if (slot.pet) slot.pet.fullness = Math.max(1, 90 - sec);
      s.points += window.__bump;
      return s;
    };
    if (name === "dex") return async () => dex;
    if (name === "dexOpen") return (slug) => { window.__dexOpen = slug; };
    if (name === "onClock") return (cb) => setInterval(() => cb({ now: Date.now() }), 1000); // 메인의 전역 1초 시계 대신
    if (typeof name === "string" && name.startsWith("on")) return (cb) => { window.__cb[name] = cb; };
    if (name === "portraits" || name === "icons" || name === "art") return async () => ({});
    if (name === "command") return async () => ({ ok: false, reason: "mock" });
    if (name === "screens") return async () => [];
    return async () => null;
  },
});
`,
);

app.setPath("userData", path.join(dir, "user-data"));
app.disableHardwareAcceleration();
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

void app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 682, show: false, webPreferences: { preload, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
  const shot = async (name: string): Promise<void> => {
    fs.writeFileSync(path.join(shots, name), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadFile(path.resolve(__dirname, "../../src/renderer/manage.html"));
    await wait(800);
    const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
    // 숨긴 창은 앞에 올 수 없어 document.hasFocus 가 늘 거짓이다 — 창이 앞에 있는 것으로 둔다(입력 중 판정은 창이 앞에 있을 때만 한다)
    await js(`document.hasFocus = () => true; 0`);
    const tabBtn = (label: string): string => `[...document.querySelectorAll('#tabs button')].find((b) => b.textContent.includes('${label}'))`;

    // (1) 1초 시계 — 시간 값만 바뀌면 표시만 고친다. 탭 포커스·파티 카드(title)가 같은 요소로 남는다
    const live = await js<{ before: string; after: string; sameTab: boolean; focused: boolean; sameCard: boolean; title: string }>(`(async () => {
      const tab = ${tabBtn("파티")};
      tab.focus();
      const card = document.querySelector('#body .slot[data-pet]');
      const shown = () => document.querySelector('#body [data-live-field="fullness"] .row span:last-child')?.textContent ?? '';
      const before = shown();
      await new Promise((r) => setTimeout(r, 2600));
      return { before, after: shown(), sameTab: ${tabBtn("파티")} === tab, focused: document.activeElement === tab, sameCard: document.querySelector('#body .slot[data-pet]') === card, title: card.title };
    })()`);
    assert.notEqual(live.after, live.before, `만복도 표시가 바뀐다 ${live.before} → ${live.after}`);
    assert.equal(live.sameTab, true, "탭 단추를 새로 만들지 않는다");
    assert.equal(live.focused, true, "탭 키보드 포커스가 남는다");
    assert.equal(live.sameCard, true, "파티 카드(title)를 새로 만들지 않는다");
    assert.ok(live.title.length > 0);

    // (2) 모양이 바뀌면 다시 그린다 — 포커스는 같은 자리의 새 탭 단추로 되돌린다
    const full = await js<{ newTab: boolean; focusedTab: boolean }>(`(async () => {
      const tab = ${tabBtn("파티")};
      tab.focus();
      window.__bump = 7;
      await new Promise((r) => setTimeout(r, 1400));
      const now = ${tabBtn("파티")};
      return { newTab: now !== tab, focusedTab: document.activeElement === now };
    })()`);
    assert.equal(full.newTab, true, "포인트가 바뀌면 다시 그린다");
    assert.equal(full.focusedTab, true, "다시 그려도 탭 포커스를 되돌린다");

    // (3) 도감 격자 넘김 — 한 쪽 15칸 · ◀ ▶ · 1초 시계와 다시 그리기에도 쪽이 남는다 · 세로 스크롤 없음
    await js(`${tabBtn("도감")}.click()`);
    await wait(400);
    const cells = `document.querySelectorAll('#body .dex-cell').length`;
    const label = `document.querySelector('#body .grid-pager .used')?.textContent`;
    const overflow = `(() => { const b = document.getElementById('body'); return b.scrollHeight - b.clientHeight; })()`;
    assert.equal(await js<number>(cells), 15, "도감 한 쪽 15칸");
    const pages = Math.ceil(dex.length / 15);
    assert.equal(await js<string>(label), `1 / ${pages}`);
    assert.ok((await js<number>(overflow)) <= 0, `도감 쪽은 스크롤 없이 들어간다 (${await js<number>(overflow)}px 넘침)`);
    await js(`document.querySelector('#body .grid-pager button:last-child').click()`);
    await wait(100);
    assert.equal(await js<string>(label), `2 / ${pages}`, "▶ 로 다음 쪽");
    assert.ok((await js<string>(`document.querySelector('#body .dex-cell .no').textContent`)).includes("#0016"), "둘째 쪽은 16번부터");
    await js(`window.__bump = 9`);
    await wait(1400);
    assert.equal(await js<string>(label), `2 / ${pages}`, "다시 그려도 쪽이 남는다");
    await shot("dex-page.png");

    // (4) 검색 칸 — 입력만 하면 거르지 않는다. 1초 시계가 돌아도 같은 입력 칸·포커스·글자가 남는다
    const typed = await js<{ cells: number }>(`(async () => {
      const input = document.getElementById('search-dex');
      window.__input = input;
      input.focus();
      input.value = '어래곤';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '곤', inputType: 'insertText' }));
      window.__bump = 11; // 입력 중 모양이 바뀌어도 다시 그리기를 미룬다
      return { cells: ${cells} };
    })()`);
    assert.equal(typed.cells, 15, "입력만으로는 거르지 않는다");
    await wait(2300);
    const kept = await js<{ same: boolean; focused: boolean; value: string }>(`({ same: document.getElementById('search-dex') === window.__input, focused: document.activeElement === window.__input, value: window.__input.value })`);
    assert.equal(kept.same, true, "1초 시계가 돌아도 입력 칸을 갈아 끼우지 않는다");
    assert.equal(kept.focused, true, "포커스도 그대로");
    assert.equal(kept.value, "어래곤", "입력 중인 글자가 남는다");

    // (5) 조합 중 Enter — 누른 순간에는 칸을 갈아 끼우지 않고, 확정 직후 한 번 거른다(Enter 한 번)
    const composing = await js<{ sameAtEnter: boolean; cellsAtEnter: number; cells: number; label: string }>(`(async () => {
      const input = window.__input;
      input.value = '88';
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.value = '882';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      const sameAtEnter = document.getElementById('search-dex') === input;
      const cellsAtEnter = ${cells};
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '2' }));
      await new Promise((r) => setTimeout(r, 100));
      return { sameAtEnter, cellsAtEnter, cells: ${cells}, label: ${label} };
    })()`);
    assert.equal(composing.sameAtEnter, true, "조합 중 Enter 에는 칸을 갈아 끼우지 않는다");
    assert.equal(composing.cellsAtEnter, 15, "조합 중 Enter 순간에는 거르지 않는다");
    assert.equal(composing.cells, 1, "확정 직후 한 번 거른다");
    assert.equal(composing.label, "1 / 1", "검색하면 첫 쪽");

    // (6) Enter · `검색` 단추 · 지우기(×)
    const entered = await js<{ cells: number; focus: string | undefined }>(`(async () => {
      const input = document.getElementById('search-dex');
      input.value = '암나이트';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      return { cells: ${cells}, focus: document.activeElement?.id };
    })()`);
    assert.equal(entered.cells, 1, "Enter 로 거른다 — 해금한 종은 이름으로 찾는다");
    assert.equal(entered.focus, "search-dex", "거른 뒤에도 검색 칸에 포커스");
    const clicked = await js<number>(`(async () => {
      const input = document.getElementById('search-dex');
      input.value = '1';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      input.closest('.search-field').querySelector('.search-go').click();
      await new Promise((r) => setTimeout(r, 100));
      return ${cells};
    })()`);
    assert.equal(clicked, 15, "검색 단추로 거른다 — 1로 시작하는 번호가 한 쪽을 넘는다");
    const cleared = await js<string>(`(async () => {
      const input = document.getElementById('search-dex');
      input.value = '';
      input.dispatchEvent(new Event('search'));
      await new Promise((r) => setTimeout(r, 100));
      document.activeElement?.blur();
      return ${label};
    })()`);
    assert.equal(cleared, `1 / ${pages}`, "빈 칸이면 전체");

    // (7) 상점 포켓몬 격자 넘김
    await js(`${tabBtn("상점")}.click()`);
    await wait(200);
    await js(`[...document.querySelectorAll('#body .chip')].find((c) => c.textContent === '포켓몬').click()`);
    await wait(200);
    const shopCells = await js<number>(`document.querySelectorAll('#body .shop-cell').length`);
    const shopLabel = await js<string>(label);
    assert.equal(shopCells, 15, "상점 한 쪽 15칸");
    assert.match(shopLabel, /^1 \/ \d+$/);
    assert.ok((await js<number>(overflow)) <= 0, `상점 쪽은 스크롤 없이 들어간다 (${await js<number>(overflow)}px 넘침)`);
    await js(`document.querySelector('#body .grid-pager button:last-child').click()`);
    await wait(1300);
    assert.match(await js<string>(label), /^2 \/ \d+$/, "1초 시계에도 쪽이 남는다");
    await shot("shop-page.png");

    // (8) 성격 창 — 고르기 전후 창 높이가 같다. 칸 이름은 가운데
    await js(`${tabBtn("파티")}.click()`);
    await wait(200);
    await js(`document.querySelector('#body .slot[data-pet]').click()`);
    await wait(200);
    const petId = snap.party.slots.find((s) => s.pet)?.pet?.id ?? "";
    await js(`window.__cb.onPetAct({ petId: '${petId}', kind: 'dialog', dialog: 'nature' })`);
    await wait(300);
    const before = await js<number>(`document.getElementById('dialog').getBoundingClientRect().height`);
    await shot("nature-before.png");
    await js(`[...document.querySelectorAll('#dialog .nature-cell')].find((c) => !c.disabled).click()`);
    await wait(300);
    const after = await js<number>(`document.getElementById('dialog').getBoundingClientRect().height`);
    await shot("nature-after.png");
    assert.equal(after, before, `성격을 골라도 창 높이가 같다 (${before} → ${after})`);
    const hints = await js<number>(`document.querySelectorAll('#dialog .nature-cell .hint').length`);
    assert.equal(hints, 1, "빈 설명 줄은 두지 않는다 — 지금 성격 칸에만");

    // (9) 보는 방식 — 문서를 다시 읽어 대화상자를 치우고 시작한다
    const reload = async (): Promise<void> => {
      await win.webContents.executeJavaScript("location.reload(); 0");
      await wait(900);
      await js(`document.hasFocus = () => true; 0`);
    };
    await reload();
    await js(`${tabBtn("도감")}.click()`);
    await wait(400);
    await js(`document.querySelector('#body .grid-pager button:last-child').click()`); // 격자 2쪽 — 16번부터
    await wait(100);
    await js(`document.querySelector('#body .view-toggle [data-view="list"]').click()`);
    await wait(150);
    // 목록은 쪽 넘김 없이 전부 · 세로 스크롤 · 격자에서 보던 첫 항목(16번) 줄이 맨 위 (2026-09-29 사용자 결정 "스크롤을 기존처럼")
    const topNo = `(() => { const top = document.getElementById('body').getBoundingClientRect().top; return [...document.querySelectorAll('#body .dex-grid .dex-cell')].find((r) => r.getBoundingClientRect().bottom > top + 1)?.querySelector('.no')?.textContent ?? null; })()`;
    const dexListView = await js<{ rows: number; pager: boolean; top: string | null; pressed: string | null; overflow: number }>(`({
      rows: document.querySelectorAll('#body .dex-cell').length,
      pager: !!document.querySelector('#body .grid-pager'),
      top: ${topNo},
      pressed: document.querySelector('#body .view-toggle [aria-pressed="true"]')?.dataset.view ?? null,
      overflow: ${overflow},
    })`);
    assert.equal(dexListView.rows, dex.length, "스크롤 방식은 작업 전 화면처럼 칸 격자를 전부 보인다");
    assert.equal(dexListView.pager, false, "목록에는 넘김 줄이 없다");
    assert.equal(dexListView.pressed, "list");
    assert.ok(dexListView.overflow > 0, "목록은 세로 스크롤");
    assert.equal(dexListView.top, "#0016", "쪽에서 보던 첫 항목으로 스크롤");
    // 1초 시계와 전체 다시 그리기에도 스크롤이 남는다
    await js(`document.getElementById('body').scrollTop = 1234; 0`);
    await js(`window.__bump = 21; 0`);
    await wait(1400);
    const scrollKept = await js<{ top: number; same: boolean }>(`({ top: document.getElementById('body').scrollTop, same: true })`);
    assert.equal(scrollKept.top, 1234, "다시 그려도 스크롤 위치가 남는다");
    // 목록 → 격자 — 맨 위에 보이던 줄이 든 쪽
    const topNow = await js<string | null>(topNo);
    const topIndex = dex.findIndex((d) => `#${String(d.dex).padStart(4, "0")}` === topNow);
    await js(`document.querySelector('#body .view-toggle [data-view="grid"]').click()`);
    await wait(150);
    assert.equal(await js<string>(label), `${Math.floor(topIndex / 15) + 1} / ${pages}`, `목록 맨 위(${topNow})가 든 쪽으로`);
    await js(`document.querySelector('#body .view-toggle [data-view="list"]').click()`);
    await wait(150);
    await shot("dex-list.png");
    await js(`document.getElementById('body').scrollTop = 0; 0`); // 검색 줄이 화면 안에 있어야 잘라 찍는다
    await wait(100);
    const toggleBox = await js<{ x: number; y: number; width: number; height: number }>(`(() => { const r = document.querySelector('#body .search-row').getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    fs.writeFileSync(path.join(shots, "view-toggle.png"), (await win.webContents.capturePage(toggleBox)).toPNG());
    // 미해금 종은 ??? · 줄을 누르면 도감 기기 창
    const lockedName = await js<string | null>(`document.querySelector('#body .dex-cell.locked')?.textContent ?? null`);
    assert.ok(lockedName?.includes("???"), "미해금 종은 스크롤 방식에서도 ???");
    const opened = await js<string>(`(() => { const r = document.querySelector('#body .dex-cell'); r.click(); return window.__dexOpen + '|' + r.dataset.slug; })()`);
    const [openedSlug, rowSlug] = opened.split("|");
    assert.equal(openedSlug, rowSlug, "칸을 누르면 그 종을 기기 창에");

    await js(`${tabBtn("상점")}.click()`);
    await wait(200);
    await js(`[...document.querySelectorAll('#body .chip')].find((c) => c.textContent === '포켓몬').click()`);
    await wait(200);
    assert.equal(await js<number>(`document.querySelectorAll('#body .shop-cell').length`), 15, "상점은 따로 기억 — 아직 격자");
    await js(`document.querySelector('#body .view-toggle [data-view="list"]').click()`);
    await wait(150);
    // 상점 스크롤 방식도 쪽 방식과 같은 칸 격자다 — 넘김 줄 없이 전부 (2026-09-30 사용자 결정 "< > 로 옮기냐 스크롤하냐")
    const shopRows = await js<number>(`document.querySelectorAll('#body .dex-grid .shop-cell').length`);
    assert.ok(shopRows > 100, `상점 스크롤 방식은 격자 칸을 전부 보인다 (${shopRows}칸)`);
    assert.equal(await js<number>(`document.querySelectorAll('#body .rows .row-card').length`), 0, "상품 줄 카드는 쓰지 않는다");
    assert.equal(await js<boolean>(`!!document.querySelector('#body .grid-pager')`), false, "상점 스크롤에도 넘김 줄이 없다");
    assert.ok((await js<number>(overflow)) > 0, "상점 스크롤 방식은 세로 스크롤");
    await shot("shop-list.png");
    await js(`document.querySelector('#body .shop-cell').click()`);
    await wait(200);
    assert.ok((await js<string>(`document.getElementById('dialog').textContent`)).includes("구매"), "칸을 누르면 구매 창");

    // 다시 읽어도 각자 남는다 — 도감 목록, 상점 목록. 도감만 격자로 되돌리면 상점은 목록 그대로
    await reload();
    await js(`${tabBtn("도감")}.click()`);
    await wait(400);
    assert.equal(await js<number>(cells), dex.length, "다시 읽어도 도감은 스크롤 방식");
    await js(`document.querySelector('#body .view-toggle [data-view="grid"]').click()`);
    await wait(150);
    await reload();
    await js(`${tabBtn("도감")}.click()`);
    await wait(400);
    assert.equal(await js<number>(cells), 15, "도감은 격자로 기억");
    await js(`${tabBtn("상점")}.click()`);
    await wait(200);
    await js(`[...document.querySelectorAll('#body .chip')].find((c) => c.textContent === '포켓몬').click()`);
    await wait(200);
    assert.equal(await js<number>(`document.querySelectorAll('#body .dex-grid .shop-cell').length`), shopRows, "상점은 스크롤 방식으로 따로 기억");

    process.stdout.write(`관리 창 검사 통과: 1초 시계 표시 고치기·포커스 · 격자 넘김 · 검색 칸 · 성격 창 · 보는 방식 · 그림 ${shots}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  }
});
