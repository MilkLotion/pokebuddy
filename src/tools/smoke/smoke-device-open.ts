// 기기 창 뜨는 시간 계측 — 실제 기기 창 틀(createDeviceWindow)·명세·문서로 파티 상세·도감 기기 창을 열고, 연 때부터 창을 보일 때까지 잰다
//
//   npm run build 뒤 electron dist/tools/smoke/smoke-device-open.js
//   POKEBUDDY_SMOKE_SCENE=many-300   장면(기본 many-300)
//
// 화면에 창을 띄우지 않는다 — 창 보이기(show·showInactive·focus)를 가로채 그 시각만 적는다
// 경우 넷: 예비 창 없이 열기(창 만들기부터), 예비 창으로 열기, 닫은 뒤 다시 열기, 떠 있는 창에서 다른 것으로
// 결과는 JSON 한 줄. 판정은 하지 않는다(기준선 기록용). 끝나면 종료 코드 0
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { writeSave } from "../../save/save-file";
import { emptySave } from "../../save/normalize";
import { createGame } from "../../tx/game";
import { petName } from "../../view/text";
import { petDeviceModel } from "../../view/device-pet";
import { CLOCK_RULES } from "../../main/app/clock";
import { gameReads, snapshotReply } from "../../main/manage/game-reads";
import { artServices } from "../../main/art/services";
import { MEGA_STONE_ICON, portraitKey } from "../../main/art/portraits";
import { createDeviceWindow } from "../../main/windows/device-window";
import { dexDeviceOf, petDeviceOf } from "../../main/windows/devices";
import { preloadFile, rendererFile } from "../../main/windows/files";
import { applyScene } from "../harness/scenes";
import { makeTmp } from "../harness/tmp-dir";
import { sleep as wait } from "../harness/wait";

const SCENE = process.env.POKEBUDDY_SMOKE_SCENE ?? "many-300";
const dir = makeTmp("smoke-device-open");
const file = path.join(dir, "save.json");
const start = Date.now();
const save = applyScene(emptySave(start), SCENE, start);
save.lastTickAt = start;
if (!writeSave(file, save)) throw new Error("시험 저장을 쓰지 못했다");
const game = createGame({ file, now: Date.now, flushMs: CLOCK_RULES.saveMs, petName });
const reads = gameReads(game);

app.setPath("userData", path.join(dir, "user-data"));

// 창 보이기 가로채기 — 보인 시각만 적는다
let shownAt = 0;
const mark = (): void => {
  shownAt ||= performance.now();
};
BrowserWindow.prototype.show = mark;
BrowserWindow.prototype.showInactive = mark;
BrowserWindow.prototype.focus = function focus(): void {};
BrowserWindow.prototype.isVisible = function isVisible(): boolean {
  return false;
};

void app.whenReady().then(async () => {
  const portraits = artServices().portraits;
  const parent = new BrowserWindow({ width: 640, height: 682, show: false });
  const files = (name: string) => ({ preload: preloadFile(), html: rendererFile(`${name}.html`) });
  // 세대 번호 — 닫힐 때 틀이 준 새 번호로 연다(설정창과 같다)
  const gen = { pet: 0, dex: 0 };
  const hooksOf = (name: keyof typeof gen) => ({ onStep() {}, onAct() {}, onCoach() {}, onClosed: (g: number) => void (gen[name] = g) });
  const petWin = createDeviceWindow(files("pet"), petDeviceOf({
    portrait: async (slug, shiny) => (await portraits.get([{ slug, shiny }]))[portraitKey({ slug, shiny })] ?? null,
    megaIcon: async () => (await portraits.icons([MEGA_STONE_ICON]))[MEGA_STONE_ICON] ?? null,
    cry: async () => null,
    volume: () => 0,
  }), hooksOf("pet"));
  const dexWin = createDeviceWindow(files("dex"), dexDeviceOf({
    detail: (slug) => reads.detailOf(slug),
    portrait: async (slug, shiny = false) => (await portraits.get([{ slug, shiny }]))[portraitKey({ slug, shiny })] ?? null,
    tree: (slug) => {
      const d = reads.shopDetailOf(slug);
      return reads.detailOf(slug)?.megaTree ?? (d?.kind === "pokemon" ? d.tree : null);
    },
    portraits: async (slugs) => {
      const got = await portraits.get(slugs.map((slug) => ({ slug, shiny: false })));
      return Object.fromEntries(slugs.filter((s) => got[s]).map((s) => [s, got[s]!]));
    },
    cry: async () => null,
    volume: () => 0,
  }), hooksOf("dex"));

  // 한 번 열고 보일 때까지 기다린다 — 모델 만들기(스냅샷 포함)부터 잰다
  const timeOpen = async (open: () => void): Promise<number> => {
    shownAt = 0;
    const t0 = performance.now();
    open();
    for (let i = 0; i < 400 && !shownAt; i += 1) await wait(5);
    return shownAt ? Math.round(shownAt - t0) : -1;
  };
  const petIds = save.pets.slice(0, 6).map((p) => p.id);
  const openPet = (petId: string) => (): void => {
    const v = snapshotReply(game, reads);
    const r = v ? petDeviceModel(v, { petId, notice: "", busy: null, kinds: [] }) : null;
    if (r) petWin.show(parent, { ...r.model, kinds: [] }, gen.pet);
  };
  const slugs = [...new Set(save.pets.map((p) => p.species))].slice(0, 6);
  const openDex = (slug: string) => (): void => dexWin.show(parent, { slug, kinds: [] }, gen.dex);

  const result: Record<string, unknown> = { scene: SCENE, pets: save.pets.length };
  try {
    // 예비 창 없음 — 창 만들기·문서 읽기부터 (예비 창을 두기 전 앱의 동작)
    const petNew: number[] = [];
    const dexNew: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      petNew.push(await timeOpen(openPet(petIds[i]!)));
      petWin.discard();
      dexNew.push(await timeOpen(openDex(slugs[i]!)));
      dexWin.discard();
      await wait(200);
    }
    // 예비 창 있음 — 설정창이 뜬 뒤 미리 만들어 둔 창을 꺼낸다
    const petSpare: number[] = [];
    const dexSpare: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      petWin.warm(parent);
      dexWin.warm(parent);
      await wait(1000);
      petSpare.push(await timeOpen(openPet(petIds[i]!)));
      dexSpare.push(await timeOpen(openDex(slugs[i]!)));
      petWin.discard();
      dexWin.discard();
    }
    // 닫은 뒤 다시 열기 — 닫히면 틀이 예비 창을 다시 둔다. 사람이 다시 누르는 데 걸리는 시간(1초) 뒤에 연다
    const petReopen: number[] = [];
    const dexReopen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      petReopen.push(await timeOpen(openPet(petIds[i]!)));
      dexReopen.push(await timeOpen(openDex(slugs[i]!)));
      petWin.close();
      dexWin.close();
      await wait(1000);
    }
    // 떠 있는 창에서 다른 것으로 — 창은 그대로, 내용만 바꾼다
    // (isVisible 을 false 로 두었으므로 내용이 와서 렌더러가 높이를 보내면 다시 보이기를 부른다 — 그 시각이다)
    const petWarm: number[] = [];
    const dexWarm: number[] = [];
    await timeOpen(openPet(petIds[0]!));
    await timeOpen(openDex(slugs[0]!));
    for (let i = 1; i < 6; i += 1) {
      petWarm.push(await timeOpen(openPet(petIds[i]!)));
      dexWarm.push(await timeOpen(openDex(slugs[i]!)));
    }
    // 예비 창 하나가 쓰는 메모리 — 렌더러 프로세스의 작업 집합
    const metrics = app.getAppMetrics().filter((m) => m.type === "Tab").map((m) => ({ ws: Math.round(m.memory.workingSetSize / 1024), priv: Math.round((m.memory.privateBytes ?? 0) / 1024) }));
    result.rendererMB = metrics;
    result.pet = { new: petNew, spare: petSpare, reopen: petReopen, switch: petWarm };
    result.dex = { new: dexNew, spare: dexSpare, reopen: dexReopen, switch: dexWarm };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
