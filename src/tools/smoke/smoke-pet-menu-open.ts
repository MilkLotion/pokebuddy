// 포켓몬 메뉴·배틀 칸 메뉴가 뜨는 시간 계측 — 실제 메뉴 잇기(createPetMenu)로 파티 카드·박스 칸 우클릭 메뉴와 모험 탭 배틀 칸 우클릭 메뉴를 열고 단계별로 잰다
// (worklog/records/update-1022/update-1022-menu-delay.md)
//
//   npm run build 뒤 electron dist/tools/smoke/smoke-pet-menu-open.js
//   POKEBUDDY_SMOKE_SCENE=many-1000   큰 저장을 먼저 깐다(기본 없음)
//   POKEBUDDY_SMOKE_FORMS=1           배틀 칸을 모습이 여러 개인 개체로
//   POKEBUDDY_SMOKE_PEEK=1            메뉴 잇기의 read 를 앱과 같은 peek(복제 없음)로 준다. 기본은 read(복제) — 저장을 몇 번 읽는지가 시간에 드러난다
//
// 화면에 창을 띄우지 않는다 — 창 보이기(show·showInactive·focus)를 가로채 그 시각만 적는다
// 단계: 그림(모습 말풍선 초상·타입 아이콘 받기, deps.portraits 를 감싸 잰다), 보이기(부른 때부터 창 보이기까지 전체)
// 같은 개체(장면 battle 의 리자몽)를 박스 칸 메뉴와 배틀 칸 메뉴로 열어 견준다. 경우마다 처음 한 번과 닫은 뒤 1초 뒤 세 번
// 결과는 JSON 한 줄. 판정은 하지 않는다(기록용). 끝나면 종료 코드 0
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { writeSave } from "../../save/save-file";
import { emptySave } from "../../save/normalize";
import { createGame } from "../../tx/game";
import { petName } from "../../view/text";
import { CLOCK_RULES } from "../../main/app/clock";
import { artServices } from "../../main/art/services";
import type { Portraits } from "../../main/art/portraits";
import { closeMenu, warmMenu } from "../../main/menus/menu-window";
import { createPetMenu } from "../../main/menus/pet-menu";
import type { Coach } from "../../main/stage/coach";
import { preloadFile, rendererFile } from "../../main/windows/files";
import { applyScene } from "../harness/scenes";
import { makeTmp } from "../harness/tmp-dir";
import { sleep as wait } from "../harness/wait";

const dir = makeTmp("smoke-pet-menu-open");
const file = path.join(dir, "save.json");
const start = Date.now();
// POKEBUDDY_SMOKE_SCENE=many-1000 — 큰 저장을 먼저 깐다. 배틀 칸 개체가 pets 끝쪽에 놓여 개체 수에 비례하는 일이 드러난다
const base = process.env.POKEBUDDY_SMOKE_SCENE ? applyScene(emptySave(start), process.env.POKEBUDDY_SMOKE_SCENE, start) : emptySave(start);
const save = applyScene(applyScene(base, "mega", start), "battle", start);
// POKEBUDDY_SMOKE_FORMS=1 — 배틀 칸을 모습이 여러 개인 개체(forms 장면의 아르세우스·실버디·배쓰랑·디아루가·펄기아·기라티나)로 바꾼다. 모습 말풍선 초상을 기다리는 경우
if (process.env.POKEBUDDY_SMOKE_FORMS && save.battle) {
  applyScene(save, "forms", start);
  const pick = ["arceus-fire", "silvally", "basculin", "dialga", "palkia", "giratina"];
  save.battle.slots = pick.map((species) => save.pets.find((p) => p.species === species)?.id ?? null);
  save.battle.mega = {};
}
save.lastTickAt = start;
if (!writeSave(file, save)) throw new Error("시험 저장을 쓰지 못했다");
const game = createGame({ file, now: Date.now, flushMs: CLOCK_RULES.saveMs, petName });

app.setPath("userData", path.join(dir, "user-data"));
app.on("window-all-closed", () => {});

let shownAt = 0;
const mark = (): void => {
  shownAt ||= performance.now();
};
BrowserWindow.prototype.show = mark;
BrowserWindow.prototype.showInactive = mark;
BrowserWindow.prototype.focus = function focus(): void {};

// 그림 받기 시간 — 메뉴 잇기가 부른 get·icons 의 시간을 더한다
let artMs = 0;
let artCalls = 0;
function timedPortraits(base: Portraits): Portraits {
  const timed =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      const t0 = performance.now();
      try {
        return await fn(...a);
      } finally {
        artMs += performance.now() - t0;
        artCalls += 1;
      }
    };
  return { ...base, get: timed(base.get.bind(base)), icons: timed(base.icons.bind(base)) };
}

const noCoach: Coach = { sync() {}, isShown: () => false, menuStep() {}, menuPlaced() {}, menuClosed() {}, forgetMenu() {} };

void app.whenReady().then(async () => {
  const portraits = timedPortraits(artServices().portraits);
  const menu = createPetMenu({
    // 앱은 peek 을 준다(src/main/app.ts createPetMenu). 기본 read 는 복제라 메뉴가 저장을 여러 번 읽으면 큰 저장에서 시간이 는다
    read: () => (process.env.POKEBUDDY_SMOKE_PEEK ? game.peek() : game.read()),
    stagePet: () => null,
    portraits: () => portraits,
    run() {},
    openManage() {},
    coach: noCoach,
  });
  game.tick(); // 앱처럼 틱을 한 번 돌려 메모리 값(live-save pending)을 둔다 — 없으면 peek 도 매번 디스크를 읽는다
  const s = game.read();
  if (!s?.battle) throw new Error("배틀 파티가 없다");
  const slots = s.battle.slots;
  const partyIds = s.party.slots.flatMap((slot) => (slot.state === "pokemon" && slot.petId ? [slot.petId] : []));
  const speciesOf = (id: string | null | undefined): string => s.pets.find((p) => p.id === id)?.species ?? "-";

  const timeOpen = async (open: () => void): Promise<{ show: number; art: number; artCalls: number }> => {
    shownAt = 0;
    artMs = 0;
    artCalls = 0;
    const t0 = performance.now();
    open();
    for (let i = 0; i < 400 && !shownAt; i += 1) await wait(5);
    return { show: shownAt ? Math.round(shownAt - t0) : -1, art: Math.round(artMs), artCalls };
  };
  const result: Record<string, unknown> = {};
  try {
    warmMenu({ preload: preloadFile(), html: rendererFile("menu.html") });
    await wait(1000);
    const cases: { name: string; open: () => void }[] = [
      ...partyIds.map((id) => ({ name: `party:${speciesOf(id)}`, open: () => menu.open(id, "manage") })),
      ...slots.map((id) => ({ name: `box:${speciesOf(id)}`, open: () => menu.open(id ?? "", "manage") })),
      ...slots.map((id, i) => ({ name: `battle${i}:${speciesOf(id)}`, open: () => menu.openBattle(i) })),
    ];
    for (const c of cases) {
      const runs = [];
      for (let i = 0; i < 4; i += 1) {
        runs.push(await timeOpen(c.open));
        closeMenu();
        await wait(1000);
      }
      result[c.name] = runs;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
