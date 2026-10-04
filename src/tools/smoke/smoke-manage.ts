// 관리 창 화면 검사 — 숨긴 창·임시 폴더·가짜 preload 만 쓴다
// npm run build 뒤 electron dist/tools/smoke/smoke-manage.js   (POKEBUDDY_SMOKE_SHOTS=폴더 를 주면 화면 그림을 거기에 남긴다)
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
//   돌보미집   모두 열기 — 준비된 알을 칸 순서대로 열고 결과를 `다음 (1 / N)` 으로 넘긴다. 부화 결과 창은 Space·Enter 가 `확인`
//   박스       6×5 칸(95×86)이 창 높이 682 에 스크롤 없이 맞는다. 넘김 줄은 이름 길이·이름 고치는 중에도 ◀·▶·칸 수·정렬 자리가 같다.
//              실패는 머리 부제 자리의 글자로(줄을 끼우지 않는다). 옮기기는 든 채로 박스를 넘기고 칸을 누르면 놓는다 · 밖·Esc 는 취소. 팔기는 확인 창
//   보는 방식  도감·상점 포켓몬 탭의 쪽 | 스크롤 토글. 스크롤은 작업 전 화면(도감 칸 격자·상점 상품 줄) 그대로 넘김 없이 · 다시 그려도 스크롤 유지 ·
//              도감·상점을 따로 기억하고 다시 읽어도(localStorage) 남는다 (2026-09-29 사용자 결정)
// 실제 IME 는 흉내 낼 수 없어서 요소가 같은 객체로 남는지, 조합 이벤트 사이에 다시 그리지 않는지로 본다
import { app, BrowserWindow, ipcMain } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { unlockByRules } from "../../dex/unlocks";
import { applyStarter } from "../../party/starter";
import { newPet, nextPetId } from "../../party/create";
import { addToBox } from "../../box/slots";
import { emptySave as empty } from "../../save/normalize";
import { dexList } from "../../view/dex-list";
import { MINT_RETIRED } from "../../bag/mint";
import { snapshotView } from "../../view/snapshot";
import { bagDeviceModel } from "../../view/device-bag";
import { partyDeviceModel } from "../../view/device-party";
import { petDeviceModel } from "../../view/device-pet";
import { shopDeviceModel } from "../../view/device-shop";
import type { BagDeviceInput, PartyDeviceInput, PetDeviceInput, ShopDeviceInput } from "../../shared/model/devices";
import type { Snapshot } from "../../shared/model/snapshot";
import { makeTmp } from "../harness/tmp-dir";
import { sleep as wait } from "../harness/wait";

const dir = makeTmp("manage");
const shots = process.env.POKEBUDDY_SMOKE_SHOTS ?? dir;

// 첫 선택을 마친 저장 — 화석 암나이트는 해금해 둔다. 첫 개체는 꺼내 둔다
const save = empty(0);
applyStarter(save, "charmander", 0, () => 0.5);
unlockByRules(save, 0);
save.dex.unlocked.push("omanyte");
save.points.balance = 500;
// 가방 대상 목록이 스크롤되게 박스에 8마리와 사탕을 둔다
for (let i = 0; i < 8; i += 1) {
  const id = nextPetId(save);
  save.pets.push(newPet({ id, species: "rattata", shiny: false, nature: "hardy", gender: "male", now: 0 }));
  addToBox(save.boxes, id);
}
save.bag["exp-candy-s"] = 3;
// 공유 sid 계열 한 마리 — 코스모그에서 진화한 코스모움. 박스 칸이 단체사진이고 모습이 둘이다 (검사 17)
const sharedId = nextPetId(save);
save.pets.push({ ...newPet({ id: sharedId, species: "cosmoem", shiny: false, nature: "hardy", gender: "male", now: 0 }), evolved: ["cosmog"] });
addToBox(save.boxes, sharedId);
// 이로치 표시 검사 (마지막) — 파티의 첫 개체와 박스의 공유 계열 개체를 이로치로, 파이리는 도감에 이로치 획득으로 둔다
for (const pet of save.pets) if (pet.id === sharedId || pet.species === "charmander") pet.shiny = true;
save.dex.shinyObtained.push("charmander");
const snap = { ...snapshotView(save, Date.now()), screenTutorials: [], detailTutorial: false }; // 첫 진입 튜토리얼은 뺀다 — 말풍선이 초점을 가져간다
const dex = dexList(save);
const DEX_PAGE = 30; // 도감 한 쪽 칸 수 — src/renderer/manage/grid-view.ts DEX_PAGE
// 가방 판 검사 (12) 에만 더하는 도구 — 불꽃의돌·성격민트. 앞 검사의 가방 순서를 바꾸지 않게 따로 만들어 둔다
const bagSave = structuredClone(save);
bagSave.bag["fire-stone"] = 3;
bagSave.bag.mint = 1;
const bagExtra = snapshotView(bagSave, Date.now()).bag.filter((i) => i.id === "fire-stone" || i.id === "mint");

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
const { ipcRenderer } = require("electron");
async function device(kind, input, put) {
  if (input === null) {
    put(null);
    return null;
  }
  const r = await ipcRenderer.invoke("smoke:device", kind, await window.pokebuddyManage.snapshot(), input);
  put(r ? r.model : null);
  return r ? r.input : null;
}
window.pokebuddyManage = new Proxy({}, {
  get(_t, name) {
    if (name === "snapshot") return async () => {
      const s = JSON.parse(JSON.stringify(snap));
      const sec = Math.floor((Date.now() - t0) / 1000);
      for (const slot of s.party.slots) if (slot.pet) slot.pet.fullness = Math.max(1, 90 - sec);
      s.points += window.__bump;
      if (window.__bagExtra) s.bag = [...bagExtra, ...s.bag];
      if (window.__boxName) s.boxes[0].name = window.__boxName;
      if (window.__screenTut) s.screenTutorials = window.__screenTut;
      if (window.__tut) s.tutorial = window.__tut;
      if (window.__eggs) { s.eggs.list = window.__eggs; s.eggs.used = window.__eggs.length; }
      return s;
    };
    if (name === "dex") return async () => dex;
    if (name === "dexOpen") return (open) => { window.__dexOpen = open ? open.slug : null; window.__dexBeside = !!open && open.beside === true; }; // 열기 인자는 { slug, beside } | null (마 ⑤)
    // 기기 창 넷 — 설정창은 고른 값만 보낸다. 시험 메인이 앱 메인처럼 모델을 만들고(smoke:device), 받은 모델은 window.__<기기>Open 에 둔다
    if (name === "petOpen") return (input) => device("pet", input, (m) => { window.__petOpen = m; });
    if (name === "petMenu") return async (id) => { window.__petMenu = id; return window.__menuOn === true; }; // 메뉴를 띄운 것으로 칠지는 window.__menuOn
    if (name === "shopOpen") return (input) => device("shop", input, (m) => { window.__shopOpen = m; });
    if (name === "bagOpen") return (input) => device("bag", input, (m) => { window.__bagOpen = m; });
    if (name === "partyOpen") return (input) => device("party", input, (m) => { window.__partyOpen = m; });
    if (name === "onClock") return (cb) => setInterval(() => cb({ now: Date.now() }), 1000); // 메인의 전역 1초 시계 대신
    if (typeof name === "string" && name.startsWith("on")) return (cb) => { window.__cb[name] = cb; };
    if (name === "portraits" || name === "icons" || name === "art") return async () => ({});
    if (name === "command") return async (req) => { (window.__cmds ??= []).push(req); return window.__reply ? window.__reply(req) : { ok: false, reason: "mock" }; }; // 기본은 실패 — window.__reply 가 있으면 그 답. 보낸 명령은 window.__cmds
    if (name === "screens") return async () => [];
    return async () => null;
  },
});
`,
);

// 기기 창 모델 — 앱 메인의 처리기(src/main/manage/window.ts)와 같이 가짜 스냅샷과 고른 값으로 만든다. 그림 열쇠는 풀지 않는다(시험은 그림을 그리지 않는다)
ipcMain.handle("smoke:device", (_e, kind: string, s: Snapshot, input: unknown) => {
  if (kind === "bag") return bagDeviceModel(s, input as BagDeviceInput);
  if (kind === "party") return partyDeviceModel(s, input as PartyDeviceInput);
  if (kind === "pet") return petDeviceModel(s, input as PetDeviceInput);
  return shopDeviceModel(s, input as ShopDeviceInput);
});

app.setPath("userData", path.join(dir, "user-data"));
app.disableHardwareAcceleration();

void app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 682, show: false, webPreferences: { preload, contextIsolation: false, sandbox: false, offscreen: true, backgroundThrottling: false } });
  const shot = async (name: string): Promise<void> => {
    fs.writeFileSync(path.join(shots, name), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadFile(path.resolve(__dirname, "../../../src/renderer/manage.html"));
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
    // 상점 포켓몬 탭은 잠시 숨김이다(src/renderer/manage/shop-tab.ts SHOP_TABS, 2026-09-30) — 탭이 없으면 (7)·(11)의 포켓몬 부분을 건너뛴다
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
      itemId: string; kind: string; title: string; pager: boolean; mode: string; modes: boolean; rows: [string, string][];
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
    assert.equal(use?.title, "프리셋 1", "사용 쪽 머리 제목은 지금 프리셋 이름");
    assert.equal(use?.pager, true, "프리셋이 둘 이상이면 머리 줄의 프리셋 이름 양옆에 ◀ ▶");
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

    // (17) 포켓몬 메뉴 — 파티 카드·박스 칸을 우클릭하면 메뉴를 청한다. 좌클릭은 개체 상세다. 마우스를 올려서는 아무것도 뜨지 않는다.
    //      (2026-10-02 사용자 "좌클릭에 메뉴생기는게 생각보다 어색하네 … 우클릭으로 바꾸고 … 좌클릭으로 상세 열게")
    //      메뉴와 모습 말풍선은 메뉴 창이 그린다(smoke-menu). 말풍선에서 고른 모습은 경로 form 으로 와서 바꾸기 확인 창을 띄운다
    //      (2026-10-02 사용자 "마우스만 갔다대도 바로 떠버려서 … 다른 메뉴로 가면 사라지지도 않고")
    await reload();
    await js(`window.__menuOn = true; window.__petOpen = null; ${tabBtn("박스")}.click()`);
    await wait(300);
    const sharedCell = `[...document.querySelectorAll('#body .cell')].find((c) => c.querySelector('.group-photo'))`;
    assert.equal(await js<boolean>(`!!${sharedCell}`), true, "공유 계열 박스 칸은 단체사진");
    const floating = `document.body.children.length`;
    const before = await js<number>(floating);
    await js(`${sharedCell}.dispatchEvent(new MouseEvent('mouseenter')); ${sharedCell}.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); 0`);
    await wait(700);
    assert.equal(await js<number>(floating), before, "마우스를 올려서는 아무것도 뜨지 않는다");
    const rightClick = (target: string): string => `${target}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`;
    await js(`window.__petMenu = null; ${rightClick(sharedCell)}; 0`);
    await wait(300);
    assert.equal(await js<string>(`window.__petMenu`), sharedId, "박스 칸을 우클릭하면 그 개체의 포켓몬 메뉴를 청한다");
    assert.equal(await js<unknown>(`window.__petOpen ?? null`), null, "우클릭은 개체 상세를 열지 않는다");
    await js(`window.__petMenu = null; ${sharedCell}.click()`);
    await wait(300);
    assert.equal(await js<string | null>(`window.__petOpen?.pet?.id ?? null`), sharedId, "박스 칸을 좌클릭하면 개체 상세");
    assert.equal(await js<unknown>(`window.__petMenu ?? null`), null, "좌클릭은 메뉴를 청하지 않는다");
    await js(`${tabBtn("파티")}.click()`);
    await wait(300);
    const partyCard = `document.querySelector('#body .slot[data-pet]')`;
    const partyId = await js<string>(`${partyCard}.dataset.pet`);
    assert.equal(await js<unknown>(`window.__petOpen ?? null`), null, "탭을 나가면 개체 상세를 닫는다");
    await js(`window.__petMenu = null; ${rightClick(partyCard)}; 0`);
    await wait(300);
    assert.equal(await js<string>(`window.__petMenu`), partyId, "파티 카드를 우클릭하면 그 개체의 포켓몬 메뉴를 청한다");
    assert.equal(await js<unknown>(`window.__petOpen ?? null`), null, "파티 카드 우클릭도 개체 상세를 열지 않는다");
    await js(`window.__petMenu = null; ${partyCard}.click()`);
    await wait(300);
    assert.equal(await js<string | null>(`window.__petOpen?.pet?.id ?? null`), partyId, "파티 카드를 좌클릭하면 개체 상세");
    assert.equal(await js<unknown>(`window.__petMenu ?? null`), null, "파티 카드 좌클릭은 메뉴를 청하지 않는다");
    await js(`window.__cb.onRoute({ to: 'form', petId: '${sharedId}', species: 'cosmog' }); 0`);
    await wait(600);
    const picked = await js<string>(`document.getElementById('dialog').textContent.slice(0, 40)`);
    await shot("form-confirm.png");
    assert.ok(picked.includes("코스모그") && picked.includes("바꿀까요"), `고른 모습 — 바꾸기 확인 창 (${picked})`);
    assert.equal(await js<number>(floating), before, "설정창에는 말풍선을 띄우지 않는다");

    // (18) 박스 — 칸 95×86 으로 6×5 가 스크롤 없이 맞는다. 넘김 줄의 ◀·▶·칸 수·정렬은 이름 길이와 이름 고치는 중에도 같은 자리다
    //      (2026-10-01 사용자 "박스 이름에 따라 화살표 위치 바껴 … 레이아웃은 바뀌면 안된다", 2026-10-02 칸 B안)
    await reload();
    await js(`window.__menuOn = true; window.__cmds = []; ${tabBtn("박스")}.click()`);
    await wait(300);
    const boxLook = await js<{ cells: number; h: number; w: number; bottom: number; inner: number; lvRight: number; boxes: string }>(`(() => {
      const cells = [...document.querySelectorAll('#body .box-grid > .cell')];
      const first = cells[0].getBoundingClientRect();
      const last = cells[cells.length - 1].getBoundingClientRect();
      const lv = cells[0].querySelector('.lv').getBoundingClientRect();
      return { cells: cells.length, h: first.height, w: Math.round(first.width), bottom: last.bottom, inner: window.innerHeight, lvRight: Math.round(first.right - lv.right), boxes: document.querySelector('#body .head .sub').textContent };
    })()`);
    assert.equal(boxLook.cells, 30, "한 박스 30칸");
    assert.equal(boxLook.h, 86, "칸 높이 86");
    assert.equal(boxLook.w, 95, "칸 폭 95");
    assert.ok(boxLook.bottom <= boxLook.inner, `6×5 가 창 높이 안에 든다 (${boxLook.bottom} ≤ ${boxLook.inner})`);
    assert.ok(boxLook.lvRight >= 6 && boxLook.lvRight <= 9, `레벨은 칸 오른쪽 위 구석 (오른쪽 여백 ${boxLook.lvRight})`);
    assert.ok(/^보관 \d+마리 · 박스 \d+개$/.test(boxLook.boxes), `부제는 보관 마릿수와 박스 수 (${boxLook.boxes})`); // 박스 수 규칙은 selftest-box 가 본다
    await shot("box-base.png");
    // 박스 튜토리얼 — 박스 탭을 처음 열 때 3단계(우클릭 메뉴 → 옮기기 → 끌기). 대상은 막고 다음·확인으로만 넘어간다
    const coach = `(() => {
      const b = document.querySelector('.coach .coach-bubble');
      if (!b) return null;
      const hole = document.querySelector('.coach .coach-block')?.getBoundingClientRect();
      return { step: b.querySelector('.step').textContent, title: b.querySelector('.title').textContent, go: b.querySelector('button:not(.x)')?.textContent ?? '', hole: hole ? [Math.round(hole.left), Math.round(hole.top), Math.round(hole.width), Math.round(hole.height)] : null, top: Math.round(b.getBoundingClientRect().top) };
    })()`;
    assert.equal(await js<unknown>(coach), null, "끝낸 화면 튜토리얼은 뜨지 않는다");
    await js(`window.__screenTut = ['box']; window.__cmds = []; window.__bump = 31; 0`);
    await wait(1400);
    const cellBox = await js<number[]>(`(() => { const r = document.querySelector('#body .box-grid > .cell:not(.blank)').getBoundingClientRect(); return [Math.round(r.left) - 8, Math.round(r.top) - 8, Math.round(r.width) + 16, Math.round(r.height) + 16]; })()`);
    const step1 = await js<{ step: string; title: string; go: string; hole: number[]; top: number }>(coach);
    assert.deepEqual({ step: step1.step, title: step1.title, go: step1.go }, { step: "튜토리얼 · 박스 1 / 3", title: "우클릭하면 메뉴가 열려요", go: "다음" });
    assert.deepEqual(step1.hole, cellBox, "1단계는 첫 개체 칸을 밝힌다");
    await shot("box-tutorial-1.png");
    await js(`document.querySelector('.coach .coach-bubble button:not(.x)').click(); 0`);
    await wait(200);
    const pagerBox = await js<number[]>(`(() => { const b = document.querySelectorAll('#body .box-pager > button'); const a = b[0].getBoundingClientRect(); const z = b[1].getBoundingClientRect(); return [Math.round(a.left) - 8, Math.round(a.top) - 8, Math.round(z.right - a.left) + 16, Math.round(a.height) + 16]; })()`);
    const step2 = await js<{ step: string; title: string; go: string; hole: number[]; top: number }>(coach);
    assert.deepEqual({ step: step2.step, title: step2.title, go: step2.go }, { step: "튜토리얼 · 박스 2 / 3", title: "옮기기로 다른 박스에 보내요", go: "다음" });
    assert.deepEqual(step2.hole, pagerBox, "2단계는 ◀ 부터 ▶ 까지 밝힌다");
    await shot("box-tutorial-2.png");
    await js(`document.querySelector('.coach .coach-bubble button:not(.x)').click(); 0`);
    await wait(200);
    const step3 = await js<{ step: string; title: string; go: string; hole: number[]; top: number }>(coach);
    assert.deepEqual({ step: step3.step, title: step3.title, go: step3.go }, { step: "튜토리얼 · 박스 3 / 3", title: "끌면 박스 안에서 자리를 바꿔요", go: "확인" });
    assert.ok(step3.top < (step3.hole[1] ?? 0), `3단계 말풍선은 격자 위에 뜬다 (${step3.top} < ${step3.hole[1]})`);
    await shot("box-tutorial-3.png");
    await js(`document.querySelector('.coach .coach-bubble button:not(.x)').click(); 0`);
    await wait(200);
    const tutDone = await js<{ cmd: string; target: string; args: Record<string, unknown> }[]>(`window.__cmds`);
    assert.deepEqual(tutDone.map((c) => [c.cmd, c.target, c.args?.steps]), [["tutorial.done", "box", undefined]], "확인은 tutorial.done box — 단계 수는 싣지 않는다(tutorial/queue 의 done 이 TUTORIAL_STEPS 로 적는다)");
    await js(`window.__screenTut = null; window.__cmds = []; window.__bump = 32; 0`);
    await wait(1400);
    assert.equal(await js<unknown>(coach), null, "끝내면 다시 뜨지 않는다");
    // 파티 프리셋 튜토리얼 — 파티 탭 3단계(머리 줄의 넘김 → 첫 줄의 두 칸 → 교체 단추). 박스 탭에 있으면 파티 탭 단추로 이어 준다
    const holeOf = (first: string, last: string): string =>
      `(() => { const a = ${first}.getBoundingClientRect(); const z = ${last}.getBoundingClientRect(); return [Math.round(a.left) - 8, Math.round(Math.min(a.top, z.top)) - 8, Math.round(z.right - a.left) + 16, Math.round(Math.max(a.bottom, z.bottom) - Math.min(a.top, z.top)) + 16]; })()`;
    type CoachView = { step: string; title: string; go: string; hole: number[]; top: number };
    await js(`window.__tut = 'preset'; window.__cmds = []; window.__bump = 33; 0`);
    await wait(1400);
    const lead = await js<CoachView>(coach);
    assert.deepEqual({ step: lead.step, title: lead.title, go: lead.go }, { step: "튜토리얼 · 프리셋", title: "프리셋으로 파티를 바꿔요", go: "파티로 가기" }, "다른 탭에서는 파티 탭 단추로 이어 준다");
    await js(`document.querySelector('.coach .coach-bubble button:not(.x)').click(); 0`);
    await wait(300);
    const preset1 = await js<CoachView>(coach);
    assert.deepEqual({ step: preset1.step, title: preset1.title, go: preset1.go }, { step: "튜토리얼 · 프리셋 1 / 3", title: "프리셋으로 파티를 바꿔요", go: "다음" });
    assert.deepEqual(preset1.hole, await js<number[]>(holeOf(`document.querySelector('#body .head .preset-pager')`, `document.querySelector('#body .head .preset-pager')`)), "1단계는 머리 줄의 ◀ 이름 ▶ 를 밝힌다");
    await shot("preset-tutorial-1.png");
    await js(`document.querySelector('.coach .coach-bubble button:not(.x)').click(); 0`);
    await wait(200);
    const preset2 = await js<CoachView>(coach);
    assert.deepEqual({ step: preset2.step, title: preset2.title, go: preset2.go }, { step: "튜토리얼 · 프리셋 2 / 3", title: "지금 프리셋의 포켓몬만 자라요", go: "다음" });
    assert.deepEqual(preset2.hole, await js<number[]>(holeOf(`document.querySelectorAll('#body .grid .slot')[0]`, `document.querySelectorAll('#body .grid .slot')[1]`)), "2단계는 첫 줄의 두 칸을 밝힌다");
    await shot("preset-tutorial-2.png");
    await js(`document.querySelector('.coach .coach-bubble button:not(.x)').click(); 0`);
    await wait(200);
    const preset3 = await js<CoachView>(coach);
    assert.deepEqual({ step: preset3.step, title: preset3.title, go: preset3.go }, { step: "튜토리얼 · 프리셋 3 / 3", title: "교체로 포켓몬을 넣고 빼요", go: "확인" });
    assert.deepEqual(preset3.hole, await js<number[]>(holeOf(`document.querySelector('#body .head .swap-open')`, `document.querySelector('#body .head .swap-open')`)), "3단계는 교체 단추를 밝힌다");
    await shot("preset-tutorial-3.png");
    await js(`document.querySelector('.coach .coach-bubble button:not(.x)').click(); 0`);
    await wait(200);
    const presetDone = await js<{ cmd: string; target: string; args: Record<string, unknown> }[]>(`window.__cmds`);
    assert.deepEqual(presetDone.map((c) => [c.cmd, c.target, c.args?.steps]), [["tutorial.done", "preset", undefined]], "확인은 tutorial.done preset — 단계 수는 싣지 않는다");
    await js(`window.__tut = null; window.__cmds = []; window.__bump = 34; ${tabBtn("박스")}.click(); 0`);
    await wait(1400);
    assert.equal(await js<unknown>(coach), null, "프리셋 튜토리얼을 끝내면 뜨지 않는다");
    const pagerAt = `(() => {
      const p = document.querySelector('#body .pager');
      const x = (el) => Math.round(el.getBoundingClientRect().left);
      const b = p.querySelectorAll(':scope > button');
      return [x(b[0]), x(b[1]), x(p.querySelector('.box-sort')), Math.round(document.querySelector('#body .box-grid').getBoundingClientRect().top)].join(',');
    })()`;
    assert.equal(await js<boolean>(`!!document.querySelector('#body .pager .used')`), false, "넘김 줄에 칸 수(12 / 30)를 두지 않는다");
    assert.deepEqual(
      await js<unknown>(`({ pager: document.querySelectorAll('#body .pager [data-drop]').length, cells: document.querySelectorAll('#body .box-grid > [data-drop]').length })`),
      { pager: 0, cells: 30 },
      "끌어 놓을 곳은 지금 박스의 칸 30개뿐이다 — ◀·▶ 에는 놓지 못한다",
    );
    const pagerShort = await js<string>(pagerAt);
    await js(`window.__boxName = '전설의포켓몬보관함입니다'; window.__bump = 11; 0`);
    await wait(1400);
    assert.equal(await js<string>(`document.querySelector('#body .box-name').textContent`), "전설의포켓몬보관함입니다", "12글자 이름");
    assert.equal(await js<string>(pagerAt), pagerShort, "12글자 이름에도 ◀·▶·정렬·격자 자리가 같다");
    await js(`document.querySelector('#body .box-name').click(); 0`);
    await wait(200);
    assert.equal(await js<boolean>(`!!document.querySelector('#body .box-name-input')`), true, "이름을 누르면 입력칸");
    assert.equal(await js<number>(`document.querySelector('#body .box-name-input').maxLength`), 12, "이름은 12자까지");
    assert.equal(await js<string>(pagerAt), pagerShort, "이름을 고치는 중에도 자리가 같다");
    await shot("box-rename.png");
    await js(`document.querySelector('#body .box-name-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.activeElement.blur(); 0`);
    await wait(300);
    assert.equal(await js<boolean>(`!!document.querySelector('#body .box-name')`), true, "Esc 로 이름 고치기를 그만둔다");

    // 옮기기 — 든 채로 ▶ 를 눌러 박스를 넘기고 빈 칸을 누르면 그 칸으로 box.move. 든 동안 커서를 따라가는 칸이 있다
    const holding = `({ grid: document.querySelector('#body .box-grid').classList.contains('holding'), ghost: document.querySelectorAll('.drag-ghost').length, from: document.querySelectorAll('#body .cell.dragging').length, name: document.querySelector('#body .box-name')?.textContent ?? '' })`;
    await js(`window.__cb.onRoute({ to: 'move', petId: 'p3' }); 0`);
    await wait(300);
    assert.deepEqual(await js<unknown>(holding), { grid: true, ghost: 1, from: 1, name: "전설의포켓몬보관함입니다" }, "옮기기 — 든 상태. 커서를 따라가는 칸이 있다");
    await shot("box-hold.png");
    await js(`document.querySelectorAll('#body .pager > button')[1].click(); 0`);
    await wait(200);
    assert.deepEqual(await js<unknown>(holding), { grid: true, ghost: 1, from: 0, name: "박스 2" }, "▶ 를 눌러도 든 채로 박스를 넘긴다");
    await js(`document.querySelectorAll('#body .box-grid > .cell')[4].click(); 0`);
    await wait(400);
    const moved = await js<{ cmd: string; target: string; args: Record<string, unknown> }[]>(`window.__cmds`);
    assert.equal(moved.length, 1, "빈 칸을 누르면 명령 하나");
    assert.equal(moved[0]?.cmd, "box.move");
    assert.equal(moved[0]?.target, "b1");
    assert.deepEqual([moved[0]?.args.slot, moved[0]?.args.toBoxId, moved[0]?.args.toSlot], [1, "b2", 4], "든 칸에서 누른 칸으로");
    assert.equal(await js<number>(`document.querySelectorAll('.drag-ghost').length`), 0, "놓으면 따라가던 칸이 사라진다");
    // 실패 — 머리 부제 자리의 글자만 바뀐다. 줄을 끼우지 않아 격자가 그대로다
    const failLook = await js<{ fail: string; note: number; at: string }>(`({ fail: document.querySelector('#body .head .sub.fail')?.textContent ?? '', note: document.querySelectorAll('#body .box-note').length, at: ${pagerAt} })`);
    assert.ok(failLook.fail.length > 0, "실패 이유가 머리 부제 자리에 보인다");
    assert.equal(failLook.note, 0, "실패 줄을 끼우지 않는다");
    assert.equal(failLook.at, pagerShort, "실패해도 넘김 줄과 격자 자리가 같다");
    await shot("box-move-failed.png");
    // 밖을 누르거나 Esc 를 누르면 취소 — 명령을 보내지 않는다
    await js(`document.querySelectorAll('#body .pager > button')[0].click(); 0`);
    await wait(200);
    for (const cancel of [`document.querySelector('#body .head h1').click()`, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`]) {
      await js(`window.__cmds = []; window.__cb.onRoute({ to: 'move', petId: 'p3' }); 0`);
      await wait(300);
      assert.equal(await js<number>(`document.querySelectorAll('.drag-ghost').length`), 1);
      await js(`${cancel}; 0`);
      await wait(200);
      assert.deepEqual(await js<unknown>(`({ ghost: document.querySelectorAll('.drag-ghost').length, holding: document.querySelector('#body .box-grid').classList.contains('holding'), cmds: window.__cmds.length })`), { ghost: 0, holding: false, cmds: 0 }, "취소 — 내려놓고 명령은 없다");
    }
    // 든 동안 우클릭은 메뉴를 청하지 않는다. 든 개체가 없으면 우클릭은 포켓몬 메뉴, 좌클릭은 개체 상세
    const firstCell = `document.querySelectorAll('#body .box-grid > .cell')[0]`;
    await js(`window.__petMenu = null; window.__cb.onRoute({ to: 'move', petId: 'p3' }); 0`);
    await wait(300);
    await js(`${firstCell}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); 0`);
    await wait(200);
    assert.equal(await js<unknown>(`window.__petMenu ?? null`), null, "든 동안 우클릭은 메뉴를 청하지 않는다");
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 0`);
    await wait(200);
    await js(`${firstCell}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); 0`);
    await wait(200);
    assert.equal(await js<string>(`window.__petMenu`), "p2", "든 개체가 없으면 우클릭은 포켓몬 메뉴");

    // 팔기 — 확인 창. `팔기` 를 누르면 pet.sell
    await js(`window.__cmds = []; window.__cb.onRoute({ to: 'sell', petId: 'p3', price: 30 }); 0`);
    await wait(400);
    const sellText = await js<string>(`document.getElementById('dialog').textContent`);
    assert.ok(sellText.includes("팔까요") && sellText.includes("30P") && sellText.includes("되돌릴 수 없어요"), `팔기 확인 창 (${sellText})`);
    await shot("box-sell-confirm.png");
    await js(`[...document.querySelectorAll('#dialog .actions button')].find((b) => b.textContent === '팔기').click(); 0`);
    await wait(400);
    const sold = await js<{ cmd: string; target: string }[]>(`window.__cmds`);
    assert.deepEqual([sold.length, sold[0]?.cmd, sold[0]?.target], [1, "pet.sell", "p3"], "팔기 — pet.sell");

    // (18b) 박스 머리 메뉴·박스 순서 모달·돌보미집 아이콘 단추
    //       (2026-10-02 사용자 "햄버거 버튼 두고, 그거 누르면 메뉴나오게"·"교환도 메뉴로"·"돌보미집은 집아이콘 … 정렬 왼쪽에"·"한줄에 4개 들어가게")
    await reload();
    await js(`window.__menuOn = true; window.__cmds = []; ${tabBtn("박스")}.click()`);
    await wait(300);
    const gridTop = `Math.round(document.querySelector('#body .box-grid').getBoundingClientRect().top)`;
    const gridTop0 = await js<number>(gridTop);
    const headLook = await js<unknown>(`(() => {
      const p = document.querySelector('#body .pager');
      const d = p.querySelector('.daycare-open').getBoundingClientRect();
      const s = p.querySelector('.box-sort').getBoundingClientRect();
      return { acts: [...document.querySelectorAll('#body .head .head-acts button')].map((b) => b.getAttribute('aria-label') ?? b.textContent), day: [Math.round(d.width), Math.round(d.height), Math.round(s.left - d.right)], menu: document.querySelectorAll('#body .head .sort-menu').length };
    })()`);
    assert.deepEqual(headLook, { acts: ["박스 메뉴"], day: [32, 32, 8], menu: 0 }, "머리에는 햄버거 단추만, 돌보미집 아이콘 단추는 정렬 왼쪽");
    await js(`document.querySelector('#body .box-menu-toggle').click(); 0`);
    await wait(200);
    assert.deepEqual(await js<string[]>(`[...document.querySelectorAll('#body .head .box-menu .sort-item')].map((b) => b.textContent)`), ["박스 순서", "교환"], "메뉴 — 박스 순서·교환");
    assert.equal(await js<number>(gridTop), gridTop0, "메뉴가 떠도 격자 자리가 같다");
    await shot("box-menu.png");
    await js(`document.querySelector('#body .head h1').click(); 0`);
    await wait(200);
    assert.equal(await js<number>(`document.querySelectorAll('#body .head .sort-menu').length`), 0, "바깥을 누르면 메뉴가 닫힌다");
    await js(`document.querySelector('#body .box-menu-toggle').click(); 0`);
    await wait(200);
    await js(`document.querySelector('#body .head .box-menu .sort-item').click(); 0`);
    await wait(300);
    const orderLook = await js<{ title: string; tiles: number; row: number; on: number[]; widths: number[]; first: string }>(`(() => {
      const t = [...document.querySelectorAll('#dialog .box-tile')];
      const top = t[0].getBoundingClientRect().top;
      return { title: document.querySelector('#dialog h2')?.textContent ?? '', tiles: t.length, row: t.filter((x) => x.getBoundingClientRect().top === top).length, on: t.map((x, i) => x.classList.contains('on') ? i : -1).filter((i) => i >= 0), widths: [...new Set(t.map((x) => Math.round(x.getBoundingClientRect().width)))], first: t[0].textContent };
    })()`);
    assert.deepEqual([orderLook.title, orderLook.tiles, orderLook.row, orderLook.on], ["박스 순서", 8, 4, [0]], "박스 순서 모달 — 타일 8개, 한 줄 4개, 지금 박스만 옅은 바탕");
    assert.equal(orderLook.widths.length, 1, `타일 폭이 모두 같다 (${orderLook.widths})`);
    assert.ok(/^.+\d+ \/ 30$/.test(orderLook.first), `타일은 이름과 사용 칸 수 (${orderLook.first})`);
    await shot("box-order.png");
    // 끌어서 놓기 — 첫 타일을 셋째 타일에 놓으면 box.order(to 2)
    await js(`(() => {
      window.__cmds = [];
      const t = document.querySelectorAll('#dialog .box-tile');
      const a = t[0].getBoundingClientRect();
      const z = t[2].getBoundingClientRect();
      t[0].dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: a.left + 10, clientY: a.top + 10, bubbles: true }));
      document.body.dispatchEvent(new PointerEvent('pointermove', { clientX: z.left + 30, clientY: z.top + 20, bubbles: true }));
    })(); 0`);
    await wait(100);
    assert.deepEqual(
      await js<unknown>(`(() => { const t = [...document.querySelectorAll('#dialog .box-tile')]; return { ghost: document.querySelectorAll('.drag-ghost').length, from: t.findIndex((x) => x.classList.contains('dragging')), over: t.findIndex((x) => x.classList.contains('drop-on')) }; })()`),
      { ghost: 1, from: 0, over: 2 },
      "끄는 중 — 원래 타일은 흐리고 놓을 타일은 옅은 바탕",
    );
    await shot("box-order-drag.png");
    await js(`document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); 0`);
    await wait(400);
    const ordered = await js<{ cmd: string; target: string; args: Record<string, unknown> }[]>(`window.__cmds`);
    assert.deepEqual([ordered.length, ordered[0]?.cmd, ordered[0]?.target, ordered[0]?.args.to], [1, "box.order", "b1", 2], "놓으면 box.order");
    assert.equal(await js<number>(`document.querySelectorAll('.drag-ghost').length`), 0);
    // 타일을 누르면 그 박스로 가고 모달이 닫힌다
    await js(`document.querySelectorAll('#dialog .box-tile')[1].click(); 0`);
    await wait(300);
    assert.deepEqual(await js<unknown>(`({ open: document.getElementById('scrim').classList.contains('open'), name: document.querySelector('#body .box-name')?.textContent ?? '' })`), { open: false, name: "박스 2" }, "타일을 누르면 그 박스로 간다");
    // 돌보미집 아이콘 단추 — 돌보미집 모달
    await js(`document.querySelector('#body .pager .daycare-open').click(); 0`);
    await wait(300);
    assert.equal(await js<string>(`document.querySelector('#dialog h2')?.textContent ?? ''`), "돌보미집", "집 아이콘 단추는 돌보미집 모달을 연다");

    // (19) 돌보미집 모두 열기 — 준비된 알 둘을 칸 순서대로 열고 결과를 하나씩 보인다. Space·Enter 는 `확인`·`다음` 을 누른 것과 같다
    //      (2026-10-02 사용자 "모두열기 기능이 있었음 좋겠고 … 스페이스바 or 엔터를 누르면 확인 누른거로 해줘")
    await reload();
    const dialogLook = `({ title: document.querySelector('#dialog h2')?.textContent ?? '', button: document.querySelector('#dialog button[data-confirm]')?.textContent ?? '', all: (() => { const b = document.querySelector('#dialog .open-all'); return b ? (b.disabled ? 'off' : 'on') : 'none'; })() })`;
    const key = (k: string): string => `document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true }))`;
    await js(`window.__cb.onRoute({ to: 'daycare' }); 0`);
    await wait(500);
    assert.deepEqual(await js<unknown>(dialogLook), { title: "돌보미집", button: "", all: "off" }, "준비된 알이 없으면 모두 열기가 흐리다");
    await js(`window.__eggs = [
      { id: 'e1', kind: 'random', name: '랜덤알', ready: true, remainSec: 0, percent: 100 },
      { id: 'e2', kind: 'random', name: '랜덤알', ready: false, remainSec: 120, percent: 40 },
      { id: 'e3', kind: 'random', name: '랜덤알', ready: true, remainSec: 0, percent: 100 },
    ]; window.__bump = 13; 0`);
    await wait(1500);
    assert.deepEqual(await js<unknown>(dialogLook), { title: "돌보미집", button: "", all: "on" }, "준비된 알이 있으면 모두 열기가 켜진다");
    const headAt = `[...document.querySelectorAll('#dialog .settings-head > *')].map((n) => Math.round(n.getBoundingClientRect().left)).join(',')`;
    const headBefore = await js<string>(headAt);
    await shot("daycare-open-all.png");
    await js(`window.__cmds = []; window.__n = 0; window.__reply = (req) => req.cmd === 'egg.open' ? { ok: true, reason: 'ok', petId: ['p2', 'p3'][window.__n++] } : { ok: false, reason: 'mock' }; document.querySelector('#dialog .open-all').click(); 0`);
    await wait(1200);
    const eggCmds = await js<{ cmd: string; target: string }[]>(`window.__cmds`);
    assert.deepEqual(eggCmds.map((c) => `${c.cmd}:${c.target}`), ["egg.open:e1", "egg.open:e3"], "준비된 알만 칸 순서대로 연다");
    assert.deepEqual(await js<unknown>(dialogLook), { title: "알이 부화했어요", button: "다음 (1 / 2)", all: "none" }, "첫 결과 — 다음 (1 / 2)");
    assert.equal(await js<string>(`[...document.querySelectorAll('.dialog.daycare.under .settings-head > *')].map((n) => Math.round(n.getBoundingClientRect().left)).join(',')`), headBefore, "뒤에 깔린 돌보미집 모달의 머리 자리가 같다");
    await shot("daycare-open-all-result.png");
    await js(`${key("Enter")}; 0`);
    await wait(300);
    assert.deepEqual(await js<unknown>(dialogLook), { title: "알이 부화했어요", button: "확인 (2 / 2)", all: "none" }, "Enter — 다음 결과, 마지막은 확인 (2 / 2)");
    await js(`${key(" ")}; 0`);
    await wait(300);
    assert.equal(await js<string>(`document.querySelector('#dialog h2')?.textContent ?? ''`), "돌보미집", "Space — 마지막 확인 뒤 돌보미집으로");
    // 하나만 열면 차례 표시 없이 `확인`. Esc 는 남은 결과를 건너뛰고 돌보미집으로
    await js(`window.__n = 0; document.querySelector('#dialog .egg.ready button').click(); 0`);
    await wait(600);
    assert.deepEqual(await js<unknown>(dialogLook), { title: "알이 부화했어요", button: "확인", all: "none" }, "하나만 열면 확인");
    await js(`${key("Enter")}; 0`);
    await wait(300);
    assert.equal(await js<string>(`document.querySelector('#dialog h2')?.textContent ?? ''`), "돌보미집");
    await js(`window.__n = 0; document.querySelector('#dialog .open-all').click(); 0`);
    await wait(1200);
    await js(`${key("Escape")}; 0`);
    await wait(300);
    assert.equal(await js<string>(`document.querySelector('#dialog h2')?.textContent ?? ''`), "돌보미집", "Esc — 남은 결과를 건너뛰고 돌보미집으로");
    await js(`window.__reply = null; window.__eggs = null; 0`);

    // 이로치 표시 — 글자 `이로치` 대신 아이콘. 파티 카드는 성별 아이콘 옆, 박스 칸은 왼쪽 위 구석, 도감 칸은 몬스터볼 옆 (2026-10-02 사용자 결정)
    await js(`${key("Escape")}; 0`);
    await wait(300);
    const at = (sel: string): string => `(() => { const n = document.querySelector('${sel}'); if (!n) return null; const r = n.getBoundingClientRect(); const c = n.closest('.cell, .dex-cell, .slot').getBoundingClientRect(); return { x: Math.round(r.left - c.left), y: Math.round(r.top - c.top), w: Math.round(r.width), label: n.getAttribute('aria-label') }; })()`;
    // 아이콘의 <title> 은 뺀다 — 화면에 보이는 글자만 본다
    const noText = `(() => { const c = document.querySelector('#body').cloneNode(true); c.querySelectorAll('svg').forEach((n) => n.remove()); return !/이로치/.test(c.textContent); })()`;
    await js(`${tabBtn("파티")}.click(); 0`);
    await wait(400);
    const partyMark = await js<{ w: number; label: string } | null>(at("#body .slot .top .gender + .shiny"));
    assert.equal(partyMark?.w, 16, "파티 카드 — 성별 아이콘 옆 이로치 아이콘 16");
    assert.equal(partyMark?.label, "이로치");
    assert.equal(await js<boolean>(noText), true, "파티 탭에 글자 이로치가 없다");
    await shot("shiny-party.png");
    await js(`${tabBtn("박스")}.click(); 0`);
    await wait(400);
    assert.deepEqual(await js<unknown>(at("#body .cell.tall .shiny")), { x: 8, y: 9, w: 10, label: "이로치" }, "박스 칸 — 왼쪽 위 구석(테두리 안쪽 7·8) 이로치 아이콘 10");
    assert.equal(await js<number>(`document.querySelectorAll('#body .cell.tall .shiny').length`), 1, "이로치 개체 칸에만 있다");
    assert.equal(await js<boolean>(noText), true, "박스 탭에 글자 이로치가 없다");
    await shot("shiny-box.png");
    await js(`${tabBtn("도감")}.click(); 0`);
    await wait(600);
    assert.deepEqual(await js<unknown>(at('#body .dex-cell[data-slug="charmander"] .got')), { x: 6, y: 6, w: 12, label: "획득" }, "도감 칸 — 획득은 왼쪽 위 몬스터볼");
    assert.deepEqual(await js<unknown>(at('#body .dex-cell[data-slug="charmander"] .shiny')), { x: 21, y: 7, w: 10, label: "이로치 획득" }, "도감 칸 — 몬스터볼 옆 이로치 아이콘");
    assert.equal(await js<number>(`document.querySelectorAll('#body .dex-cell .shiny').length`), 1, "이로치를 얻은 종에만 있다");
    await shot("shiny-dex.png");

    // (21) 파티 프리셋 — 머리 줄의 ◀ [이름] ▶, 이름 고치기, 교체 화면(박스 탭 + 파티 기기 창), 가방의 프리셋 넘김
    //      (2026-10-02 사용자 결정, Figma 05 `Party / Base` `217:1705` · `Party / Swap · Open` `1248:2567`)
    await reload();
    type Cmd = { cmd: string; target: string; args: Record<string, unknown> };
    const cmds = (): Promise<Cmd[]> => js<Cmd[]>(`window.__cmds ?? []`);
    await js(`window.__cmds = []; window.__menuOn = false; ${tabBtn("파티")}.click()`);
    await wait(300);
    const presetHead = `({ name: document.querySelector('#body .head .box-name')?.textContent ?? '', arrows: document.querySelectorAll('#body .head .preset-pager > button').length, sub: !!document.querySelector('#body .head .sub'), swap: !!document.querySelector('#body .head .swap-open') })`;
    assert.deepEqual(await js<unknown>(presetHead), { name: "프리셋 1", arrows: 2, sub: false, swap: true }, "파티 머리 줄 — ◀ 프리셋 이름 ▶ 와 교체. 부제는 없다");
    await shot("party-preset.png");
    const presetAt = `[...document.querySelectorAll('#body .head .preset-pager > button'), document.querySelector('#body .head .swap-open')].map((b) => Math.round(b.getBoundingClientRect().left)).join(',')`;
    const presetShort = await js<string>(presetAt);
    await js(`document.querySelectorAll('#body .head .preset-pager > button')[1].click(); 0`);
    await wait(300);
    assert.deepEqual((await cmds()).map((c) => [c.cmd, c.args.preset]), [["party.preset", 1]], "▶ — 다음 프리셋을 적용한다");
    await js(`window.__cmds = []; document.querySelectorAll('#body .head .preset-pager > button')[0].click(); 0`);
    await wait(300);
    assert.deepEqual((await cmds()).map((c) => [c.cmd, c.args.preset]), [["party.preset", 1]], "◀ — 첫 프리셋에서는 마지막 프리셋으로 돈다");
    // 이름 고치기 — 누르면 입력칸. 12자까지. ◀·▶·교체 자리는 그대로다
    await js(`document.querySelector('#body .head .box-name').click(); 0`);
    await wait(200);
    assert.equal(await js<number>(`document.querySelector('#body .head .box-name-input')?.maxLength ?? 0`), 12, "프리셋 이름을 누르면 입력칸 — 12자까지");
    assert.equal(await js<string>(presetAt), presetShort, "이름을 고치는 중에도 ◀·▶·교체 자리가 같다");
    await shot("party-preset-rename.png");
    await js(`window.__cmds = []; (() => { const i = document.querySelector('#body .head .box-name-input'); i.value = '탐험용'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })(); 0`);
    await wait(400);
    assert.deepEqual((await cmds()).map((c) => [c.cmd, c.args.preset, c.args.name]), [["party.preset.rename", 0, "탐험용"]], "Enter — 이름을 저장한다");

    // 교체 — 박스 탭으로 가고 파티 기기 창을 띄운다. 대화상자는 없다
    type PartyOpen = { name: string; notice: string; slots: { index: number; state: string; name: string; held: boolean; target: boolean }[]; presets: { index: number; owned: boolean; active: boolean }[] } | null;
    const partyOpen = (): Promise<PartyOpen> => js<PartyOpen>(`window.__partyOpen ?? null`);
    await js(`window.__cmds = []; document.querySelector('#body .head .swap-open').click(); 0`);
    await wait(400);
    const swapOpened = await partyOpen();
    assert.equal(await js<string>(`document.querySelector('#body .head h1').textContent`), "박스", "교체 — 박스 탭으로 간다");
    assert.equal(await js<boolean>(`document.getElementById('scrim').classList.contains('open')`), false, "교체 모달은 없다");
    assert.equal(swapOpened?.name, "프리셋 1");
    assert.deepEqual(swapOpened?.slots.map((s) => s.state), ["pokemon", "empty", "locked", "locked", "locked", "locked"], "파티 기기 창 — 지금 프리셋의 여섯 칸");
    assert.deepEqual(swapOpened?.presets.map((p) => [p.owned, p.active]), [[true, true], [true, false], [false, false], [false, false], [false, false]], "프리셋 칩 — 가진 둘, 사지 않은 셋");
    // 박스 칸을 누르면 상세 대신 그 개체를 든다. 빈 파티 칸이 놓을 칸이 된다
    await js(`window.__petOpen = null; document.querySelectorAll('#body .box-grid > .cell')[0].click(); 0`);
    await wait(300);
    assert.deepEqual(await js<unknown>(`({ ghost: document.querySelectorAll('.drag-ghost').length, from: document.querySelectorAll('#body .cell.dragging').length, pet: window.__petOpen ?? null })`), { ghost: 0, from: 1, pet: null }, "교체 화면 — 박스 칸을 누르면 든다. 원래 칸만 흐리고 따라가는 칸은 없다. 상세는 뜨지 않는다");
    assert.deepEqual((await partyOpen())?.slots.map((s) => s.target), [false, true, false, false, false, false], "든 동안 빈 파티 칸이 놓을 칸");
    await shot("party-swap-hold.png");
    // 파티 기기 창의 빈 칸 — 배치. 개체 칸 — 맞바꾸기
    await js(`window.__cb.onPartyAct({ kind: 'slot', index: 1 }); 0`);
    await wait(400);
    assert.deepEqual((await cmds()).map((c) => [c.cmd, c.target, c.args.slotIndex]), [["party.place", "p2", 1]], "든 박스 개체를 빈 파티 칸에 — party.place");
    assert.equal(await js<number>(`document.querySelectorAll('#body .cell.dragging').length`), 0, "놓으면 흐리던 칸이 돌아온다");
    assert.ok(((await partyOpen())?.notice ?? "").length > 0, "실패 이유는 파티 기기 창의 머리 줄에 보인다");
    await js(`window.__cmds = []; document.querySelectorAll('#body .box-grid > .cell')[0].click(); 0`);
    await wait(300);
    await js(`window.__cb.onPartyAct({ kind: 'slot', index: 0 }); 0`);
    await wait(400);
    assert.deepEqual((await cmds()).map((c) => [c.cmd, c.target, c.args.slotIndex]), [["party.swap", "p2", 0]], "든 박스 개체를 파티 개체 칸에 — party.swap");
    // 파티 칸을 먼저 눌러 든다 → 박스 빈 칸은 보관, 박스 개체 칸은 맞바꾸기, 잠긴 칸은 받지 않는다
    await js(`window.__cmds = []; window.__cb.onPartyAct({ kind: 'slot', index: 3 }); window.__cb.onPartyAct({ kind: 'slot', index: 0 }); 0`);
    await wait(300);
    assert.deepEqual((await partyOpen())?.slots.map((s) => s.held), [true, false, false, false, false, false], "파티 칸을 누르면 그 개체를 든다");
    await js(`document.querySelectorAll('#body .box-grid > .cell.blank')[0].click(); 0`);
    await wait(400);
    const keptCmd = (await cmds())[0];
    assert.deepEqual([(await cmds()).length, keptCmd?.cmd, keptCmd?.target, keptCmd?.args.toBoxId, typeof keptCmd?.args.toSlot], [1, "party.keep", "p1", "b1", "number"], "든 파티 개체를 박스 빈 칸에 — party.keep");
    await js(`window.__cmds = []; window.__cb.onPartyAct({ kind: 'slot', index: 0 }); 0`);
    await wait(200);
    await js(`document.querySelectorAll('#body .box-grid > .cell')[0].click(); 0`);
    await wait(400);
    assert.deepEqual((await cmds()).map((c) => [c.cmd, c.target, c.args.slotIndex]), [["party.swap", "p2", 0]], "든 파티 개체를 박스 개체 칸에 — party.swap");
    // 든 채 밖을 누르면 취소
    await js(`window.__cmds = []; window.__cb.onPartyAct({ kind: 'slot', index: 0 }); 0`);
    await wait(200);
    await js(`document.querySelector('#body .head h1').click(); 0`);
    await wait(200);
    assert.deepEqual([(await partyOpen())?.slots[0]?.held, (await cmds()).length], [false, 0], "밖을 누르면 내려놓는다 — 명령은 없다");
    // 프리셋 칩 — 가진 프리셋만 적용한다
    await js(`window.__cb.onPartyAct({ kind: 'preset', index: 3 }); window.__cb.onPartyAct({ kind: 'preset', index: 0 }); window.__cb.onPartyAct({ kind: 'preset', index: 1 }); 0`);
    await wait(400);
    assert.deepEqual((await cmds()).map((c) => [c.cmd, c.args.preset]), [["party.preset", 1]], "칩 — 사지 않은 프리셋과 지금 프리셋은 보내지 않는다");
    // 박스 탭을 나가면 교체 화면이 끝난다. 다시 박스 탭에 오면 칸 좌클릭은 개체 상세다
    await js(`${tabBtn("파티")}.click()`);
    await wait(300);
    assert.equal(await partyOpen(), null, "박스 탭을 나가면 파티 기기 창을 닫는다");
    await js(`${tabBtn("박스")}.click()`);
    await wait(300);
    await js(`window.__petOpen = null; document.querySelectorAll('#body .box-grid > .cell')[0].click(); 0`);
    await wait(300);
    assert.equal(await js<string | null>(`window.__petOpen?.pet?.id ?? null`), "p2", "교체 화면이 아니면 박스 칸 좌클릭은 개체 상세");
    // 빈 파티 칸을 눌러도 교체 화면이 열린다
    await js(`${tabBtn("파티")}.click()`);
    await wait(300);
    await js(`document.querySelector('#body .grid .slot.blank:not(.locked)').click(); 0`);
    await wait(400);
    assert.ok((await partyOpen()) !== null, "빈 파티 칸 — 교체 화면");
    // 가방 — 머리 줄의 ◀ ▶ 는 앞·뒤 프리셋을 적용한다
    await js(`${tabBtn("가방")}.click()`);
    await wait(300);
    await js(`[...document.querySelectorAll('#body .bag-card')].find((c) => c.querySelector('.name').textContent === '경험사탕S').click(); 0`);
    await wait(200);
    await js(`window.__cmds = []; window.__cb.onBagAct({ itemId: 'exp-candy-s', kind: 'preset', delta: 1 }); 0`);
    await wait(400);
    assert.deepEqual((await cmds()).map((c) => [c.cmd, c.args.preset]), [["party.preset", 1]], "가방의 ▶ — 다음 프리셋을 적용한다");

    process.stdout.write(`관리 창 검사 통과: 1초 시계 표시 고치기·포커스 · 격자 넘김 · 검색 칸 · 성격 창 · 보는 방식 · 가방 기기 창 · 상점 기기 창 · 진화 도구 판매만 · 교환 링크 · 탭 나가면 상세 닫기 · 도감 보기 · 실패 표시 높이 · 포켓몬 메뉴 · 박스(칸·넘김 줄·옮기기·팔기·머리 메뉴·순서 모달) · 돌보미집 모두 열기 · 이로치 아이콘 · 파티 프리셋(머리 줄·이름·교체 화면·가방 넘김) · 그림 ${shots}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  }
});
