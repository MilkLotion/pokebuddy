// 관리 창 화면 검사 — 숨긴 창·임시 폴더·가짜 preload 만 쓴다
// npm run build 뒤 electron dist/tools/smoke-manage.js   (POKEBUDDY_SMOKE_SHOTS=폴더 를 주면 화면 그림을 거기에 남긴다)
//
// 검사 대상
//   검색 칸    입력 중에는 거르지 않고 Enter·`검색` 단추에서만 거른다 (2026-09-29 사용자 결정). 입력 중에는 칸 요소를 갈아 끼우지 않는다 —
//              갈아 끼우면 한글 조합이 끊긴다("어래곤" → "어곤"). 조합 중 Enter 는 확정 직후 한 번 거른다(Enter 한 번)
//   1초 시계   시간 값만 바뀌면 표시만 고친다 — 탭 포커스·title 요소가 남는다. 모양이 바뀌어 다시 그려도 포커스를 되돌린다
//   격자 넘김  도감은 한 쪽 30칸(박스처럼 6×5), 상점 포켓몬 탭은 15칸 · ◀ ▶. 1초 시계에도 쪽이 남는다. 도감 쪽은 한 줄 안쪽만 넘친다
//   성격 창    고르기 전후로 창 높이가 같다
//   가방 기기  도구 칸을 누르면 옆 기기 창(설명·사용·판매). 대상은 파티 개체만. 수량·사용 실패(빨강)·판매 쪽·다시 누르면 닫기
//   진화 도구  가방에서 쓰지 않는다 — 판매만, 쓰는 곳은 진화 전 종 이름. 가방 탭을 나가면 닫기
//   교환 링크  다른 대화상자가 떠 있으면 닫고 박스 탭 + 교환 모달
//   상점 기기  상품 줄을 누르면 옆 기기 창(설명·구매). 정보 줄 효과·쓰는 곳, 진화용 도구 쓰는 곳 = 목록 줄. 수량·구매 실패(빨강)·이전·다음·다시 누르면 닫기·탭 나가면 닫기
//   탭 나가기  나가는 탭의 상세 기기 창(개체 상세·도감)을 닫는다. 같은 탭은 그대로
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
import { newPet, nextPetId } from "../party/create";
import { putPet } from "../box/slots";
import { empty } from "../save/v3";
import { dexList } from "../tx/lists";
import { MINT_RETIRED } from "../bag/mint";
import { snapshot } from "../tx/snapshot";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokebuddy-manage-"));
const shots = process.env.POKEBUDDY_SMOKE_SHOTS ?? dir;

// 첫 선택을 마친 저장 — 화석 암나이트는 해금해 둔다. 첫 개체는 꺼내 둔다
const save = empty(0);
begin(save, "charmander", 0, () => 0.5);
unlockByRules(save, 0);
save.dex.unlocked.push("omanyte");
save.points.balance = 500;
// 가방 대상 목록이 스크롤되게 박스에 8마리와 사탕을 둔다
for (let i = 0; i < 8; i += 1) {
  const id = nextPetId(save);
  save.pets.push(newPet({ id, species: "rattata", shiny: false, nature: "hardy", gender: "male", now: 0 }));
  putPet(save.boxes, id);
}
save.bag["exp-candy-s"] = 3;
const snap = { ...snapshot(save), screenTutorials: [], detailTutorial: false }; // 첫 진입 튜토리얼은 뺀다 — 말풍선이 초점을 가져간다
const dex = dexList(save);
const DEX_PAGE = 30; // 도감 한 쪽 칸 수 — src/renderer/manage.ts DEX_PAGE
// 가방 판 검사 (12) 에만 더하는 도구 — 불꽃의돌·성격민트. 앞 검사의 가방 순서를 바꾸지 않게 따로 만들어 둔다
const bagSave = structuredClone(save);
bagSave.bag["fire-stone"] = 3;
bagSave.bag.mint = 1;
const bagExtra = snapshot(bagSave).bag.filter((i) => i.id === "fire-stone" || i.id === "mint");

// 가짜 preload — snapshot·dex 만 값을 준다. 구독(on*)은 콜백만 받아 둔다(window.__cb). 시계(onClock)는 1초마다 울린다
// 파티 개체의 만복도는 1초마다 1 줄어든다(시간 값). window.__bump 를 올리면 포인트가 바뀌어 모양이 바뀐다(전체 다시 그리기)
const preload = path.join(dir, "fixture.cjs");
fs.writeFileSync(
  preload,
  `
const snap = ${JSON.stringify(snap)};
const dex = ${JSON.stringify(dex)};
const bagExtra = ${JSON.stringify(bagExtra)};
const t0 = Date.now();
window.__bump = 0;
window.__bagExtra = false;
window.__cb = {};
window.pokebuddyManage = new Proxy({}, {
  get(_t, name) {
    if (name === "snapshot") return async () => {
      const s = JSON.parse(JSON.stringify(snap));
      const sec = Math.floor((Date.now() - t0) / 1000);
      for (const slot of s.party.slots) if (slot.pet) slot.pet.fullness = Math.max(1, 90 - sec);
      s.points += window.__bump;
      if (window.__bagExtra) s.bag = [...bagExtra, ...s.bag];
      return s;
    };
    if (name === "dex") return async () => dex;
    if (name === "dexOpen") return (slug, gen, beside) => { window.__dexOpen = slug; window.__dexBeside = beside === true; };
    if (name === "petOpen") return (open) => { window.__petOpen = open; };
    if (name === "shopOpen") return (open) => { window.__shopOpen = open; };
    if (name === "bagOpen") return (open) => { window.__bagOpen = open; };
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

    // (3) 도감 격자 넘김 — 한 쪽 30칸 · ◀ ▶ · 1초 시계와 다시 그리기에도 쪽이 남는다 · 넘쳐도 한 줄 안쪽(Figma 99 `Dex / Base · 박스형` 724)
    await js(`${tabBtn("도감")}.click()`);
    await wait(400);
    const cells = `document.querySelectorAll('#body .dex-cell').length`;
    const label = `document.querySelector('#body .grid-pager .used')?.textContent`;
    const overflow = `(() => { const b = document.getElementById('body'); return b.scrollHeight - b.clientHeight; })()`;
    assert.equal(await js<number>(cells), DEX_PAGE, "도감 한 쪽 30칸");
    const pages = Math.ceil(dex.length / DEX_PAGE);
    const secondFirst = `#${String(dex[DEX_PAGE]?.dex ?? 0).padStart(4, "0")}`; // 둘째 쪽 첫 칸 — 모습 칸(#0019-1 등)이 섞여 번호로 셀 수 없다
    assert.equal(await js<string>(label), `1 / ${pages}`);
    assert.ok((await js<number>(overflow)) < 95, `도감 쪽은 한 줄(95) 안쪽만 넘친다 (${await js<number>(overflow)}px 넘침)`);
    await js(`document.querySelector('#body .grid-pager button:last-child').click()`);
    await wait(100);
    assert.equal(await js<string>(label), `2 / ${pages}`, "▶ 로 다음 쪽");
    assert.ok((await js<string>(`document.querySelector('#body .dex-cell .no').textContent`)).includes(secondFirst), `둘째 쪽은 ${secondFirst}부터`);
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
    assert.equal(typed.cells, DEX_PAGE, "입력만으로는 거르지 않는다");
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
    assert.equal(composing.cellsAtEnter, DEX_PAGE, "조합 중 Enter 순간에는 거르지 않는다");
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
    assert.equal(clicked, DEX_PAGE, "검색 단추로 거른다 — 1로 시작하는 번호가 한 쪽을 넘는다");
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
    // 상점 포켓몬 탭은 잠시 숨김이다(src/renderer/manage.ts SHOP_TABS, 2026-09-30) — 탭이 없으면 (7)·(11)의 포켓몬 부분을 건너뛴다
    const pokemonTab = await js<boolean>(`[...document.querySelectorAll('#body .chip')].some((c) => c.textContent === '포켓몬')`);
    if (pokemonTab) {
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
    } else process.stdout.write("(7) 상점 포켓몬 격자  건너뜀 — 포켓몬 탭 숨김\n");

    // (8) 성격 창 — 고르기 전후 창 높이가 같다. 칸 이름은 가운데
    // 성격민트 은퇴(src/bag/mint.ts MINT_RETIRED) 동안은 성격 변경 창에 닿을 수 없고 민트도 없다 — 건너뛴다 (2026-09-30)
    if (MINT_RETIRED) process.stdout.write("(8) 성격 창  건너뜀 — 성격민트 은퇴\n");
    else {
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
    }

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
    assert.ok(dexListView.top?.startsWith(secondFirst), `쪽에서 보던 첫 항목으로 스크롤 (${dexListView.top})`);
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
    assert.equal(await js<string>(label), `${Math.floor(topIndex / DEX_PAGE) + 1} / ${pages}`, `목록 맨 위(${topNow})가 든 쪽으로`);
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

    let shopRows = 0; // 상점 스크롤 방식의 칸 수 — 포켓몬 탭이 있을 때만 잰다
    if (pokemonTab) {
      await js(`${tabBtn("상점")}.click()`);
      await wait(200);
      await js(`[...document.querySelectorAll('#body .chip')].find((c) => c.textContent === '포켓몬').click()`);
      await wait(200);
      assert.equal(await js<number>(`document.querySelectorAll('#body .shop-cell').length`), 15, "상점은 따로 기억 — 아직 격자");
      await js(`document.querySelector('#body .view-toggle [data-view="list"]').click()`);
      await wait(150);
      // 상점 스크롤 방식도 쪽 방식과 같은 칸 격자다 — 넘김 줄 없이 전부 (2026-09-30 사용자 결정 "< > 로 옮기냐 스크롤하냐")
      shopRows = await js<number>(`document.querySelectorAll('#body .dex-grid .shop-cell').length`);
      assert.ok(shopRows > 100, `상점 스크롤 방식은 격자 칸을 전부 보인다 (${shopRows}칸)`);
      assert.equal(await js<number>(`document.querySelectorAll('#body .rows .row-card').length`), 0, "상품 줄 카드는 쓰지 않는다");
      assert.equal(await js<boolean>(`!!document.querySelector('#body .grid-pager')`), false, "상점 스크롤에도 넘김 줄이 없다");
      assert.ok((await js<number>(overflow)) > 0, "상점 스크롤 방식은 세로 스크롤");
      await shot("shop-list.png");
      await js(`document.querySelector('#body .shop-cell').click()`);
      await wait(200);
      assert.ok(await js<boolean>(`!!window.__shopOpen`), "칸을 누르면 상점 기기 창");
    }

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
    assert.equal(await js<number>(cells), DEX_PAGE, "도감은 격자로 기억");
    if (pokemonTab) {
      await js(`${tabBtn("상점")}.click()`);
      await wait(200);
      await js(`[...document.querySelectorAll('#body .chip')].find((c) => c.textContent === '포켓몬').click()`);
      await wait(200);
      assert.equal(await js<number>(`document.querySelectorAll('#body .dex-grid .shop-cell').length`), shopRows, "상점은 스크롤 방식으로 따로 기억");
    }

    // (10) 가방 기기 창 — 도구 칸을 누르면 옆 기기 창에 설명·사용·판매. 격자 아래 사용 판은 없다 (2026-10-01 사용자 결정 C안, Figma 05 `Bag / Device / …`)
    //      대상은 파티 개체만(파티 줄). 사용·판매 전환·파티 고르기·수량·사용·팔기는 관리 창으로 돌아와 처리한다
    await reload();
    await js(`${tabBtn("가방")}.click()`);
    await wait(300);
    type BagOpen = {
      itemId: string; kind: string; title: string; mode: string; modes: boolean; rows: [string, string][];
      party: { petId: string; picked: boolean }[] | null; qty: { count: number; cap: number } | null;
      preview: { lead: string; line: string; tone: string }; go: { label: string; disabled: boolean };
    } | null;
    const bagOpen = `window.__bagOpen ?? null`;
    const candy = `[...document.querySelectorAll('#body .bag-card')].find((c) => c.querySelector('.name').textContent === '경험사탕S')`;
    await js(`${candy}.click()`);
    await wait(200);
    const use = await js<BagOpen>(bagOpen);
    const partyIds = snap.party.slots.filter((x) => x.pet).map((x) => x.pet!.id);
    assert.equal(use?.itemId, "exp-candy-s", "누른 도구가 기기 창에 뜬다");
    assert.equal(use?.title, "파티에게 쓰기");
    assert.equal(use?.mode, "use", "사용 쪽으로 연다");
    assert.equal(use?.modes, true, "판매가가 있으면 사용·판매 전환");
    assert.deepEqual(use?.rows.map((r) => r[0]), ["효과", "쓰는 곳"], "정보 줄은 효과·쓰는 곳 두 줄");
    assert.deepEqual(use?.party?.map((x) => x.petId), partyIds, "대상은 파티 개체만 — 박스 개체는 없다");
    assert.equal(use?.party?.[0]?.picked, true, "첫 파티 개체를 고른 채 연다");
    assert.equal(use?.go.label, "1개 사용");
    assert.equal(await js<boolean>(`!!document.querySelector('#body .use-panel')`), false, "격자 아래 사용 판은 없다");
    assert.equal(await js<boolean>(`document.getElementById('scrim').classList.contains('open')`), false, "모달도 없다");
    assert.equal(await js<string | null>(`${candy}.getAttribute('aria-pressed')`), "true", "고른 칸은 톤 배경");
    // 수량 — 1레벨 파이리는 경험사탕S 3개를 다 쓸 수 있다
    await js(`window.__cb.onBagAct({ itemId: 'exp-candy-s', kind: 'qty', qty: 3 })`);
    await wait(100);
    assert.equal(await js<number>(`window.__bagOpen.qty.count`), 3, "수량 3");
    assert.equal(await js<string>(`window.__bagOpen.go.label`), "3개 사용");
    // 사용 실패 — 가짜 명령은 늘 실패한다(mock). 미리보기 상자가 빨강, 관리 창에는 모달·경고 줄이 없다
    await js(`window.__cb.onBagAct({ itemId: 'exp-candy-s', kind: 'go' })`);
    await wait(400);
    const useFailed = await js<BagOpen>(bagOpen);
    assert.equal(useFailed?.preview.tone, "bad", "사용 실패는 미리보기 상자가 빨강");
    assert.equal(useFailed?.preview.lead, "쓰지 못했어요");
    assert.equal(await js<boolean>(`document.getElementById('scrim').classList.contains('open')`), false, "실패해도 모달을 띄우지 않는다");
    // 판매 쪽 — 파티 줄이 없고 받는 포인트. 다른 도구에서 온 단추는 버린다
    await js(`window.__cb.onBagAct({ itemId: 'exp-candy-s', kind: 'mode', mode: 'sell' })`);
    await wait(100);
    const sell = await js<BagOpen>(bagOpen);
    assert.equal(sell?.title, "판매하기");
    assert.equal(sell?.party, null, "판매 쪽에는 파티 줄이 없다");
    assert.ok(sell?.go.label.endsWith("에 팔기"), `팔기 단추 (${sell?.go.label})`);
    assert.equal(sell?.preview.tone, "", "갈래를 바꾸면 실패 표시는 지운다");
    await js(`window.__cb.onBagAct({ itemId: 'fire-stone', kind: 'mode', mode: 'use' })`);
    await wait(100);
    assert.equal(await js<string>(`window.__bagOpen.mode`), "sell", "다른 도구의 단추는 버린다");
    await shot("bag-device-row.png");
    // 같은 칸을 다시 누르면 닫는다
    await js(`${candy}.click()`);
    await wait(200);
    assert.equal(await js<unknown>(bagOpen), null, "같은 칸을 다시 누르면 기기 창을 닫는다");

    // (11) 상점 기기 창 — 상품 줄을 누르면 옆 기기 창에 설명·구매. 구매 창(모달)은 없다 (2026-10-01 사용자 결정 A안, Figma 05 `Shop / Device / …`)
    //      정보 줄은 효과·쓰는 곳 두 줄. 진화용 도구의 쓰는 곳은 목록 줄 문구 그대로. 수량·구매·이전·다음은 관리 창이 처리한다
    await reload();
    await js(`${tabBtn("상점")}.click()`);
    await wait(200);
    await js(`[...document.querySelectorAll('#body .chip')].find((c) => c.textContent === '진화').click()`);
    await wait(200);
    assert.ok((await js<string>(`document.getElementById('body').textContent`)).includes("외 "), "진화 탭 줄 문구 — 진화 전 종 이름 · 외 N종");
    type ShopOpen = { productId: string; kind: string; rows: [string, string][]; qty: { count: number; cap: number } | null; total: { lead: string; tone: string }; buy: { disabled: boolean } } | null;
    const shopOpen = `window.__shopOpen ?? null`;
    const cordRow = `[...document.querySelectorAll('#body .row-card')].find((r) => r.textContent.includes('연결의끈'))`;
    const cordNote = await js<string>(`${cordRow}.querySelector('.note').textContent`);
    await js(`${cordRow}.click()`);
    await wait(200);
    const cord = await js<ShopOpen>(shopOpen);
    assert.equal(cord?.productId, "bond-cord", "누른 상품이 기기 창에 뜬다");
    assert.equal(cord?.kind, "진화");
    assert.deepEqual(cord?.rows.map((r) => r[0]), ["효과", "쓰는 곳"], "정보 줄은 효과·쓰는 곳 두 줄");
    assert.equal(cord?.rows[1]?.[1], cordNote, "진화용 도구의 쓰는 곳은 목록 줄 문구 그대로");
    assert.equal(await js<boolean>(`document.getElementById('scrim').classList.contains('open')`), false, "구매 창(모달)은 뜨지 않는다");
    assert.equal(await js<string | null>(`${cordRow}.getAttribute('aria-pressed')`), "true", "고른 줄은 톤 배경");
    // 수량 — 기기 창의 + 는 관리 창으로 돌아와 다시 보낸다. 500P 에 150P 라 최대 3
    await js(`window.__cb.onShopAct({ productId: 'bond-cord', kind: 'qty', qty: 3 })`);
    await wait(100);
    assert.deepEqual(await js<{ count: number; cap: number; hint: string } | null>(`window.__shopOpen.qty`), { count: 3, cap: 3, hint: "최대 3 · 포인트" }, "수량 3 · 상한 3 · 까닭 포인트");
    // 다른 상품에서 온 단추는 버린다
    await js(`window.__cb.onShopAct({ productId: 'fire-stone', kind: 'qty', qty: 1 })`);
    await wait(100);
    assert.equal(await js<number>(`window.__shopOpen.qty.count`), 3, "다른 상품의 단추는 버린다");
    // 구매 — 가짜 명령은 늘 실패한다(mock). 합계 상자가 빨강 `사지 못했어요`, 관리 창에는 모달·경고 줄이 없다
    await js(`window.__cb.onShopAct({ productId: 'bond-cord', kind: 'buy' })`);
    await wait(400);
    const failed = await js<ShopOpen>(shopOpen);
    assert.equal(failed?.total.tone, "bad", "구매 실패는 합계 상자가 빨강");
    assert.equal(failed?.total.lead, "사지 못했어요");
    assert.equal(await js<boolean>(`document.getElementById('scrim').classList.contains('open')`), false, "실패해도 모달을 띄우지 않는다");
    await shot("shop-device-row.png");
    // 이전·다음 — 지금 탭의 상품 순서. 넘기면 수량·실패 표시는 처음으로
    const order = await js<string[]>(`[...document.querySelectorAll('#body .row-card .title')].map((t) => t.textContent)`);
    await js(`window.__cb.onShopStep(1)`);
    await wait(200);
    const next = await js<ShopOpen>(shopOpen);
    assert.notEqual(next?.productId, "bond-cord", "다음 상품");
    assert.equal(next?.total.tone, "", "넘기면 실패 표시는 지운다");
    assert.equal(await js<string>(`document.querySelector('#body .row-card[aria-pressed="true"] .title').textContent`), order[order.indexOf("연결의끈") + 1], "목록 순서의 다음 줄");
    // 같은 줄을 다시 누르면 닫는다. 탭을 나가도 닫는다
    await js(`document.querySelector('#body .row-card[aria-pressed="true"]').click()`);
    await wait(200);
    assert.equal(await js<unknown>(shopOpen), null, "같은 줄을 다시 누르면 기기 창을 닫는다");
    await js(`${cordRow}.click()`);
    await wait(200);
    await js(`${tabBtn("가방")}.click()`);
    await wait(200);
    assert.equal(await js<unknown>(shopOpen), null, "상점 탭을 나가면 기기 창을 닫는다");

    // (12) 진화용 도구는 가방에서 쓰지 않는다 — 판매만 (2026-10-01 사용자 결정 "진화아이템에는 사용을 없애자").
    //      쓰는 곳은 진화 탭 상품 줄과 같은 진화 전 종 이름. 가방 탭을 나가면 기기 창을 닫는다
    assert.equal(bagExtra.length, 2, "불꽃의돌·성격민트 가방 값");
    await reload();
    await js(`window.__bagExtra = true; window.__bump = 41; 0`);
    await wait(1400);
    await js(`${tabBtn("가방")}.click()`);
    await wait(300);
    await js(`[...document.querySelectorAll('#body .chip')].find((c) => c.textContent === '진화').click()`);
    await wait(200);
    await js(`[...document.querySelectorAll('#body .bag-card')].find((c) => c.querySelector('.name').textContent === '불꽃의돌').click()`);
    await wait(200);
    const stone = await js<BagOpen>(bagOpen);
    assert.equal(stone?.kind, "진화");
    assert.equal(stone?.mode, "sell", "진화용 도구는 판매 쪽으로 연다");
    assert.equal(stone?.modes, false, "사용·판매 전환이 없다");
    assert.equal(stone?.party, null, "파티 줄이 없다");
    assert.ok(stone?.rows[1]?.[1] && stone.rows[1][1] !== "파티 포켓몬", `쓰는 곳은 진화 전 종 이름 (${stone?.rows[1]?.[1]})`);
    await js(`window.__cb.onBagAct({ itemId: 'fire-stone', kind: 'mode', mode: 'use' })`);
    await wait(100);
    assert.equal(await js<string>(`window.__bagOpen.mode`), "sell", "사용 쪽으로 바꿀 수 없다");
    await shot("bag-device-stone.png");
    await js(`${tabBtn("상점")}.click()`);
    await wait(200);
    assert.equal(await js<unknown>(bagOpen), null, "가방 탭을 나가면 기기 창을 닫는다");

    // (13) 교환 링크 — 다른 대화상자가 떠 있으면 닫고 박스 탭 + 교환 모달 (2026-09-30 사용자 결정 "ㅇㅇ 닫고 교환모달로.")
    await js(`document.getElementById('open-settings').click(); 0`);
    await wait(300);
    const settingsTitle = await js<string>(`document.querySelector('#dialog h2')?.textContent ?? ''`);
    assert.notEqual(settingsTitle, "친구 교환", "설정 창이 떠 있다");
    await js(`window.__cb.onRoute({ to: 'trade' }); 0`);
    await wait(600);
    const routed = await js<{ title: string | null; open: boolean; tab: string | null }>(`({
      title: document.querySelector('#dialog h2')?.textContent ?? null,
      open: document.getElementById('scrim').classList.contains('open'),
      tab: document.querySelector('#tabs button[aria-selected="true"]')?.textContent ?? null,
    })`);
    assert.equal(routed.open, true, "교환 모달이 떠 있다");
    assert.equal(routed.title, "친구 교환", `떠 있던 설정 창을 닫고 교환 모달 (${routed.title})`);
    assert.ok(routed.tab?.includes("박스"), `박스 탭 (${routed.tab})`);
    await shot("trade-route.png");
    // 교환 모달이 이미 떠 있으면 그대로 둔다
    await js(`window.__cb.onRoute({ to: 'trade' }); 0`);
    await wait(600);
    assert.equal(await js<string | null>(`document.querySelector('#dialog h2')?.textContent ?? null`), "친구 교환", "이미 교환 모달이면 그대로");

    // (14) 탭을 나가면 그 탭의 상세 기기 창을 닫는다 (2026-09-30 사용자 결정 "그냥 해당 탭을 나가면 상세 닫게해.")
    await reload();
    await js(`${tabBtn("도감")}.click()`);
    await wait(400);
    const dexSlug = await js<string>(`(() => { const c = document.querySelector('#body .dex-cell'); c.click(); return c.dataset.slug; })()`);
    await wait(100);
    assert.equal(await js<string | null>(`window.__dexOpen`), dexSlug, "도감 칸을 누르면 도감 기기 창");
    await js(`${tabBtn("도감")}.click()`);
    await wait(100);
    assert.equal(await js<string | null>(`window.__dexOpen`), dexSlug, "같은 탭을 다시 누르면 닫지 않는다");
    await js(`${tabBtn("파티")}.click()`);
    await wait(200);
    assert.equal(await js<string | null>(`window.__dexOpen`), null, "도감 탭을 나가면 도감 기기 창을 닫는다");
    await js(`${tabBtn("도감")}.click()`);
    await wait(300);
    assert.equal(await js<number>(`document.querySelectorAll('#body .dex-cell[aria-pressed="true"]').length`), 0, "돌아와도 고른 칸이 없다 — 다시 열지 않는다");
    assert.equal(await js<string | null>(`window.__dexOpen`), null, "돌아와도 도감 기기 창을 다시 열지 않는다");
    await js(`${tabBtn("파티")}.click()`);
    await wait(200);
    await js(`document.querySelector('#body .slot[data-pet]').click()`);
    await wait(300);
    assert.equal(await js<boolean>(`!!window.__petOpen?.pet`), true, "파티 칸을 누르면 개체 상세 기기 창");
    await js(`${tabBtn("파티")}.click()`);
    await wait(200);
    assert.equal(await js<boolean>(`!!window.__petOpen?.pet`), true, "같은 탭을 다시 누르면 개체 상세를 닫지 않는다");
    await js(`${tabBtn("도감")}.click()`);
    await wait(300);
    assert.equal(await js<unknown>(`window.__petOpen`), null, "파티 탭을 나가면 개체 상세 기기 창을 닫는다");

    // (15) 도감 보기 — 파티 상세 기기 창 옆에 그 종의 도감 기기 창. 관리 창 탭과 파티 상세는 그대로. 다시 누르면 닫는다 (2026-10-01 사용자 결정)
    await js(`${tabBtn("파티")}.click()`);
    await wait(200);
    await js(`document.querySelector('#body .slot[data-pet]').click()`);
    await wait(300);
    const shown = await js<{ id: string; species: string } | null>(`window.__petOpen?.pet ? { id: window.__petOpen.pet.id, species: window.__petOpen.pet.species } : null`);
    assert.ok(shown, "파티 칸을 누르면 개체 상세 기기 창");
    await js(`window.__cb.onPetAct({ petId: '${shown!.id}', kind: 'dex' })`);
    await wait(500);
    assert.equal(await js<string | null>(`window.__petOpen?.pet?.id ?? null`), shown!.id, "도감 보기 — 개체 상세 기기 창은 그대로");
    assert.equal(await js<boolean>(`window.__petOpen.dexOpen`), true, "도감 보기 — 줄이 열린 표시");
    assert.equal(await js<string | null>(`window.__dexOpen`), shown!.species, "도감 보기 — 그 종의 도감 기기 창");
    assert.equal(await js<boolean>(`window.__dexBeside`), true, "도감 보기 — 파티 상세 옆에 붙인다");
    assert.equal(await js<number>(`document.querySelectorAll('#body .dex-cell').length`), 0, "관리 창은 파티 탭 그대로");
    const partyPetIds = await js<string[]>(`[...document.querySelectorAll('#body .slot[data-pet]')].map((s) => s.dataset.pet)`);
    if (partyPetIds.length > 1) {
      await js(`window.__cb.onPetStep(1)`);
      await wait(300);
      const stepped = await js<{ id: string; species: string }>(`({ id: window.__petOpen.pet.id, species: window.__petOpen.pet.species })`);
      assert.notEqual(stepped.id, shown!.id, "개체 넘기기");
      assert.equal(await js<string | null>(`window.__dexOpen`), stepped.species, "개체를 넘기면 옆 도감 기기 창도 그 종으로");
    }
    await js(`window.__cb.onPetAct({ petId: window.__petOpen.pet.id, kind: 'dex' })`);
    await wait(300);
    assert.equal(await js<string | null>(`window.__dexOpen`), null, "도감 보기를 다시 누르면 옆 도감 기기 창을 닫는다");
    assert.equal(await js<boolean>(`window.__petOpen.dexOpen`), false, "줄 열린 표시를 끈다");
    await js(`window.__cb.onPetAct({ petId: window.__petOpen.pet.id, kind: 'dex' })`);
    await wait(300);
    await js(`window.__cb.onPetClosed(99)`);
    await wait(300);
    assert.equal(await js<string | null>(`window.__dexOpen`), null, "파티 상세를 닫으면 옆 도감 기기 창도 닫는다");

    // (16) 실패는 새 줄을 끼우지 않는다 (2026-09-30 사용자 결정 "레이아웃 왔다갔다하는건데? 나 이런거 싫어한다니까?").
    //      가짜 명령은 늘 실패한다(`mock`). 가방 사용 실패는 (10) 이 기기 창 미리보기 상자로 본다. 관리 창 본문 높이는 그대로다.
    //      대화상자는 바닥 단추 줄 빈자리에 오류를 두고 창 높이가 같다
    await reload();
    await js(`${tabBtn("가방")}.click()`);
    await wait(300);
    await js(`[...document.querySelectorAll('#body .bag-card')].find((c) => c.querySelector('.name').textContent === '경험사탕S').click()`);
    await wait(200);
    const bodyHeight = `document.getElementById('body').scrollHeight`;
    const usedBefore = await js<number>(bodyHeight);
    await js(`window.__cb.onBagAct({ itemId: 'exp-candy-s', kind: 'go' })`);
    await wait(300);
    const usedAfter = await js<{ height: number; alerts: number }>(`({ height: ${bodyHeight}, alerts: document.querySelectorAll('#body .alert').length })`);
    await shot("use-failed.png");
    assert.equal(usedAfter.alerts, 0, "사용 실패 — 관리 창에 경고 줄을 끼우지 않는다");
    assert.equal(usedAfter.height, usedBefore, `사용 실패에도 관리 창 본문 높이가 같다 (${usedBefore} → ${usedAfter.height})`);
    await js(`document.getElementById('open-settings').click()`);
    await wait(300);
    const dialogHeight = `document.getElementById('dialog').getBoundingClientRect().height`;
    const setBefore = await js<number>(dialogHeight);
    const footButtons = `[...document.querySelectorAll('#dialog > .actions button')].map((b) => Math.round(b.getBoundingClientRect().left)).join(',')`;
    const buttonsBefore = await js<string>(footButtons);
    await js(`document.querySelector('#dialog .switch').click()`);
    await wait(300);
    const setAfter = await js<{ height: number; footer: string | null; alerts: number; buttons: string }>(`({
      height: ${dialogHeight},
      buttons: ${footButtons},
      footer: document.querySelector('#dialog > .actions .footer-error')?.textContent ?? null,
      alerts: document.querySelectorAll('#dialog > .alert').length,
    })`);
    await shot("dialog-failed.png");
    assert.ok(setAfter.footer, "대화상자 실패 — 바닥 단추 줄에 오류");
    assert.equal(setAfter.alerts, 0, "대화상자 실패 — 끝에 경고 줄을 끼우지 않는다");
    assert.equal(setAfter.buttons, buttonsBefore, "대화상자 실패 — 바닥 단추 자리가 그대로");
    assert.equal(setAfter.height, setBefore, `대화상자 실패에도 창 높이가 같다 (${setBefore} → ${setAfter.height})`);

    process.stdout.write(`관리 창 검사 통과: 1초 시계 표시 고치기·포커스 · 격자 넘김 · 검색 칸 · 성격 창 · 보는 방식 · 가방 기기 창 · 상점 기기 창 · 진화 도구 판매만 · 교환 링크 · 탭 나가면 상세 닫기 · 도감 보기 · 실패 표시 높이 · 그림 ${shots}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  }
});
