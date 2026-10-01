// 무대(src/main) 자체 확인 — node 만으로, Electron 없이. npm run build 뒤 node dist/tools/selftest-stage.js
//
// 순수 부분만: layout(집·자리·산책 범위·가두기·무대 교집합) · art.zoomOf · party(저장 v3 · 첫 실행 · 옛 저장 사본 · writer/reader · 잠금 상실) ·
// menus(항목 순서·라벨 키) · anchor 상태기(가짜 헬퍼로 2회 연속 확정 · 표시 디바운스) · 계약 타입 대입(StageState↔AgentState · StageFrame 표본).
// 임시 폴더에서만 돌고 끝나면 지운다 — 사용자의 ~/.claude/pokebuddy/ 는 건드리지 않는다. 끝에 "통과 (N건)"
import assert from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ANCHOR_RULES, createAnchor, type AnchorUpdate } from "../main/anchor";
import { ART_RULES, zoomOf } from "../main/art";
import { STAGE_RULES, clampInStage, homeOf, homeSpot, isDefaultHome, petSpot, roamBox, stackShift, stageOf, toLocal } from "../main/layout";
import { lockExcept, menuView, petLine, petMenu, pickOf, subId, trayMenu } from "../main/menus";
import { NATURE_SHOWN } from "../dex/natures";
import { t } from "../main/text";
import { SAVE_RULES, SAVE_V3_RULES } from "../save/rules";
import * as legacy from "../save/legacy";
import * as writer from "../save/writer";
import type { LookSheets, PointerMsg, StageFrame, StageState } from "../shared/stage";
import type { AgentState } from "../shared/types";
import { devSaveState } from "./dev-save";
import { createStage } from "../main/stage";
import type { Look, ArtLoader } from "../main/art";
import type { StageWindow } from "../main/stage-window";
import { createCommands } from "../main/commands";
import { createGame } from "../main/game";
import { createSaveParty, type PartyPet, type SaveParty } from "../main/save-party";
import { begin } from "../party/starter";
import * as store from "../save/store";
import { empty as emptyV3 } from "../save/v3";
import { send } from "../save/mailbox";

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
let passed = 0;
const ok = (cond: unknown, what: string): void => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = <T>(a: T, b: T, what: string): void => {
  assert.deepStrictEqual(a, b, `${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  passed += 1;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(check: () => boolean, ms = 3000, step = 20): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await sleep(step);
  }
  return check();
}
function spawnIdle(): { pid: number; kill: () => void } {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
  assert.ok(child.pid, "자식 pid");
  return { pid: child.pid, kill: () => child.kill() };
}

const T0 = new Date(2026, 8, 17, 10, 0, 0).getTime();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pokebuddy-selftest-stage-"));
const tmpDir = (name: string): string => {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const pathsIn = (dir: string) => ({
  save: path.join(dir, "save.json"),
  saveLock: path.join(dir, "save.lock"),
  mailbox: path.join(dir, "mailbox"),
  companionLock: path.join(dir, "companion.lock"),
});

// ── 계약 타입 대입 — 컴파일이 곧 검사. 런타임은 표본이 모양을 지키는지만 ─────────
const agentState: AgentState = "waving";
const stageState: StageState = agentState;
const back: AgentState = stageState;
const frame: StageFrame = { at: T0, state: back, pets: [{ id: "p1", look: "eevee", zoom: 3, x: 10, y: 20, play: { anim: "Walk", row: 2, mode: "loop", rate: 1 }, held: false }] };
const sheets: LookSheets = { look: "eevee", cell: { w: 48, h: 56 }, body: { w: 40, h: 56 }, anims: { Idle: { fw: 40, fh: 56, rows: 8, frames: [{ x: 0, ms: 200 }], dataUrl: "data:image/png;base64," } }, clips: { idle: { anim: "Idle", mode: "loop", row: 0 } } };
const pointer: PointerMsg = { type: "drag", id: "p1", x: 1, y: 2 };
ok(frame.pets[0]?.play?.mode === "loop" && sheets.clips.idle?.anim === "Idle" && pointer.type === "drag", "계약 표본 대입");

// ── layout ────────────────────────────────────────────────────────────────────
{
  const body = { w: 40, h: 56 };
  const stage = { w: 800, h: 600 };
  const anchor = { x: 0, y: 0, w: 800, h: 600 };
  const home = { dx: -24, dy: -60 };
  eq(homeSpot(home, body, anchor, stage), { x: 736, y: 484 }, "homeSpot 기본 집 = 창 오른쪽 아래 기준");
  eq(homeSpot({ dx: 500, dy: 500 }, body, anchor, stage), { x: 760, y: 544 }, "homeSpot 집이 밖 → 가둔 자리가 집");
  eq(homeSpot(home, body, anchor, { w: 30, h: 30 }), { x: 0, y: 0 }, "homeSpot 몸이 무대보다 크면 좌상단");
  eq(roamBox({ x: 0, y: 0 }, body, { w: 30, h: 30 }), { minX: 0, maxX: 0, minY: 0, maxY: 0 }, "roamBox 몸이 크면 [0,0] — 걷지 않는다");
  eq(roamBox({ x: 736, y: 484 }, body, stage), { minX: -736, maxX: 24, minY: -484, maxY: 60 }, "roamBox 집 기준 범위");
  eq(petSpot(home, { x: 100, y: 100 }, body, anchor, stage), { x: 760, y: 544 }, "petSpot 산책도 무대 안에");
  eq(clampInStage(-5, 999, body, stage), { x: 0, y: 544 }, "clampInStage");
  const spot = homeSpot(home, body, anchor, stage);
  eq(homeOf(spot, body, anchor), home, "homeOf 는 homeSpot 의 역함수 (안에 있을 때)");
  const shift = stackShift(body);
  eq(shift, Math.round(40 * STAGE_RULES.stackRatio), "stackShift 는 몸 한 칸 — 저장된 집과 맞추려고 그대로 둔다");
  const shifted = homeSpot(home, body, anchor, stage, shift);
  eq(shifted.x, spot.x - shift, "shift 만큼 왼콍");
  eq(homeOf(shifted, body, anchor, shift), home, "저장 때 shift 를 더해 상쇄");
  // 무대 ≠ 창 — 창이 왼쪽으로 100 나가 있으면 anchor 가 음수에서 시작한다
  eq(homeSpot(home, body, { x: -100, y: 0, w: 800, h: 600 }, { w: 700, h: 600 }), { x: 636, y: 484 }, "anchor 가 무대 밖에서 시작해도 창 기준");
  eq(stageOf({ x: 100, y: 100, w: 800, h: 600 }, { x: 0, y: 0, w: 500, h: 500 }), { x: 100, y: 100, w: 400, h: 400 }, "stageOf 교집합");
  eq(stageOf({ x: 1000, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 500, h: 500 }), null, "stageOf 겹치지 않으면 null");
  eq(toLocal({ x: 100, y: 100, w: 800, h: 600 }, { x: 100, y: 100, w: 400, h: 400 }), { x: 0, y: 0, w: 800, h: 600 }, "toLocal");
  ok(isDefaultHome({ ...SAVE_RULES.pet.home }) && !isDefaultHome({ dx: 0, dy: 0 }), "isDefaultHome");
}

// ── art.zoomOf ────────────────────────────────────────────────────────────────
{
  // 배율은 크기 단계(src/save/rules.ts SIZE_STEPS = 1 · 1.5 · 2 · 2.5 · 3) 가운데 하나다
  eq(zoomOf(3, { w: 40, h: 56 }), 3, "zoomOf 원하는 배율");
  eq(zoomOf(1.5, { w: 40, h: 56 }), 1.5, "zoomOf 반 단계");
  eq(zoomOf(100, { w: 40, h: 56 }), 3, "zoomOf 가장 큰 단계로 가둔다");
  eq(zoomOf(3, { w: ART_RULES.maxBody.w / 2.2, h: 10 }), 2, "zoomOf 몸 상한 안의 가장 큰 단계");
  eq(zoomOf(0, { w: 40, h: 56 }), ART_RULES.defaultZoom, "zoomOf 0 → 기본");
  eq(zoomOf(0.4, { w: 40, h: 56 }), 1, "zoomOf 가장 작은 단계 아래로 안 간다");
  eq(zoomOf(1.2, { w: 40, h: 56 }), 1, "zoomOf 가까운 단계로");
  eq(zoomOf(4, { w: 0, h: 0 }), 3, "zoomOf 몸을 모르면 원하는 값을 단계로");
}

// ── dev-save (저장 v3) ─────────────────────────────────────────────────────────
{
  const many = devSaveState(["a", "b", "c", "d", "e", "f", "g", "h"], { now: T0, rng: () => 0 });
  eq(many.pets.length, SAVE_V3_RULES.party.total, "dev-save 는 파티 칸 수로 자른다");
  eq(many.party.slots.every((slot) => slot.state === "pokemon" && slot.hidden === false), true, "dev-save 는 모든 마리를 꺼내 놓는다");
  eq(many.starterPetId, "p1", "첫 마리를 첫 선택으로 기억한다");
}

// ── menus ──────────────────────────────────────────────────────────────────────
{
  let hid = 0;
  let quit = 0;
  let ghost = 0;
  const act = { toggleHidden: () => void (hid += 1), quit: () => void (quit += 1), toggleGhost: () => void (ghost += 1) };
  const menu = petMenu({ name: "이브이", nature: "용감" }, {});
  const EEVEE_LINE = NATURE_SHOWN ? t("menu.pet", { name: "이브이", nature: "용감" }) : "이브이"; // 성격을 화면에서 끈 동안은 이름만 (2026-09-30)
  eq(menu.map((m) => m.label ?? m.type), [EEVEE_LINE, "separator"], "petMenu 순서·라벨");
  ok(menu[0]?.enabled === false, "petMenu 첫 줄은 비활성");
  // 포켓몬 우클릭은 그 포켓몬 관련 항목만 — 잠시 숨기기·종료는 트레이에만 (2026-09-28 사용자 결정)
  const whole = [t("menu.hide"), t("menu.show"), t("menu.quit")];
  eq(menu.some((m) => whole.includes(String(m.label))), false, "petMenu 에 잠시 숨기기·종료가 없다");
  eq(petLine({ name: "이브이", nature: null }), "이브이", "petLine 성격 없으면 이름만");
  // 볼에 넣기 — 파티 개체일 때만(ball 동작이 있을 때) 놀아주기 아래에 나온다
  let balled = 0;
  const withBall = petMenu({ name: "이브이", nature: "용감", play: { enabled: true } }, { ball: () => void (balled += 1) });
  const ballAt = withBall.findIndex((m) => m.label === t("menu.ball"));
  eq(ballAt, withBall.findIndex((m) => m.label === t("menu.play")) + 1, "볼에 넣기는 놀아주기 바로 아래");
  (withBall[ballAt]!.click as () => void)();
  eq(balled, 1, "볼에 넣기 클릭이 동작을 부른다");
  eq(menu.some((m) => m.label === t("menu.ball")), false, "ball 동작이 없으면 볼에 넣기가 없다");
  // 앱이 그리는 모양 — 이름·상태 두 줄, 못 하는 돌봄은 흐리게만(이유는 적지 않는다 — 2026-10-02 사용자 결정), 겹친 구분선은 하나로
  const cared = menuView(petMenu({ name: "이브이", nature: "용감", status: "배부름 · 기분 좋음", feed: { enabled: false, reason: "0:40" }, play: { enabled: true } }, {}), "켜짐");
  eq(cared[0], { kind: "status", title: EEVEE_LINE, caption: "배부름 · 기분 좋음" }, "menuView 상태 줄");
  const feedView = cared.find((v) => v.kind === "item" && v.label === t("menu.feed"));
  eq(feedView?.kind === "item" ? [feedView.disabled, feedView.hint] : null, [true, undefined], "menuView 밥 주기는 흐리게만 — 이유를 붙이지 않는다");
  // 관리 창의 파티 카드·박스 칸도 같은 메뉴다 — 묶음: 옮기기 / 돌봄·볼·상세 보기·모습 바꾸기 / 팔기 (Figma `Context Menu` `338:738`)
  // 박스 개체는 돌봄·볼이 흐리다. 옮기기·팔기는 동작을 꽂기 전에는 흐리다(기능 개발 예정)
  const off = { enabled: false };
  const forms = [
    { species: "cosmog", name: "코스모그", current: false, portrait: "data:image/png;base64,AA" },
    { species: "cosmoem", name: "코스모움", current: true },
  ];
  let formed = "";
  const boxed = petMenu(
    { name: "코스모그", nature: null, status: "보통", feed: off, play: off, ball: { enabled: false, hidden: false }, forms, move: { enabled: true }, sell: { enabled: false } },
    { ball: () => undefined, detail: () => undefined, form: (species) => void (formed = species) },
  );
  const boxedView = menuView(boxed, "켜짐");
  eq(
    boxedView.map((v) => (v.kind === "item" ? `${v.label}${v.disabled ? " (흐림)" : ""}` : v.kind)),
    ["status", "separator", `${t("menu.move")} (흐림)`, "separator", `${t("menu.feed")} (흐림)`, `${t("menu.play")} (흐림)`, `${t("menu.ball")} (흐림)`, t("menu.detail"), t("menu.form"), "separator", `${t("menu.sell")} (흐림)`],
    "박스 공유 계열 메뉴 — 돌봄·볼·옮기기·팔기는 흐리고 상세 보기·모습 바꾸기는 누른다. 옮기기는 이름·상태 바로 아래에 있고 그 아래에 구분선이 있다. 볼에 넣기와 상세 보기 사이에 구분선이 없다",
  );
  // 모습 바꾸기 — 누르는 동작 없이 말풍선(sub)을 단다. 지금 모습 줄은 누를 수 없다
  const formAt = boxed.findIndex((m) => m.label === t("menu.form"));
  const formView = boxedView.find((v) => v.kind === "item" && v.label === t("menu.form"));
  const sub = formView?.kind === "item" ? formView.sub : undefined;
  eq(sub?.title, t("menu.form.title"), "모습 말풍선의 머리 줄");
  eq(
    sub?.rows,
    [
      { id: subId(formAt, 0), label: "코스모그", note: t("menu.form.go"), current: false, icon: "data:image/png;base64,AA" },
      { id: subId(formAt, 1), label: "코스모움", note: t("menu.form.now"), current: true },
    ],
    "모습 말풍선의 줄 — 이름·바꾸기/지금·초상",
  );
  ok(!boxed[formAt]?.click, "모습 바꾸기 항목은 누르는 동작이 없다 — 메뉴가 닫히지 않는다");
  (pickOf(boxed, subId(formAt, 0))!.click as () => void)();
  eq(formed, "cosmog", "모습 줄의 번호로 그 모습의 동작을 찾는다");
  eq(pickOf(boxed, subId(formAt, 1))?.enabled, false, "지금 모습 줄은 비활성");
  eq(pickOf(boxed, formAt)?.label, t("menu.form"), "pickOf — 하위 줄이 아니면 모델의 자리");
  // 옮기기·팔기 — 동작을 꽂으면 켜진다. 옮기기는 모델에 있을 때만(박스 개체) 나온다
  const wired = petMenu({ name: "꼬렛", nature: null, move: { enabled: true }, sell: { enabled: true } }, { detail: () => undefined, move: () => undefined, sell: () => undefined });
  eq(wired.filter((m) => m.label === t("menu.move") || m.label === t("menu.sell")).map((m) => m.enabled), [true, true], "옮기기·팔기 — 동작이 있으면 누를 수 있다");
  const party = petMenu({ name: "이브이", nature: null, ball: { enabled: true, hidden: true }, sell: { enabled: true } }, { ball: () => undefined, detail: () => undefined });
  eq(party.some((m) => m.label === t("menu.form") || m.label === t("menu.move")), false, "파티 일반 개체 — 모습 바꾸기·옮기기가 없다");
  eq(party.find((m) => m.label === t("menu.sell"))?.enabled, false, "팔기 — 동작이 없으면 흐리다");
  eq(party.some((m) => m.label === t("menu.unball")), true, "볼 안의 개체는 꺼내기");
  // 첫 돌봄 잠금은 모습 바꾸기(하위 줄만 있는 항목)도 잠근다
  const lockedForm = menuView(lockExcept(boxed, [t("menu.feed")]), "켜짐").find((v) => v.kind === "item" && v.label === t("menu.form"));
  eq(lockedForm?.kind === "item" ? lockedForm.disabled : null, true, "lockExcept 모습 바꾸기도 흐리다");
  eq(menuView([...menu, { type: "separator" }, { type: "separator" }, { label: "x", click: () => undefined }], "켜짐").filter((v) => v.kind === "separator").length, 1, "menuView 겹친 구분선은 하나");
  eq(menuView(menu, "켜짐").filter((v) => v.kind === "separator").length, 0, "menuView 끝 구분선은 뺀다");
  // 첫 돌봄 2/2 — 밥 주기만 누를 수 있고 나머지 누르는 항목은 흐리다. 이름·상태 줄은 그대로 상태 줄이다
  const locked = menuView(lockExcept(petMenu({ name: "이브이", nature: "용감", status: "배부름", feed: { enabled: true }, play: { enabled: true } }, {}), [t("menu.feed")]), "켜짐");
  eq(locked.filter((v) => v.kind === "item" && !v.disabled).map((v) => (v.kind === "item" ? v.label : "")), [t("menu.feed")], "lockExcept 밥 주기만 남긴다");
  eq(locked.filter((v) => v.kind === "item" && v.disabled).length, 1, "lockExcept 놀아주기는 흐리다");
  eq(locked[0]?.kind, "status", "lockExcept 상태 줄은 그대로");
  // 트레이 — 이름 줄과 설정 파일 열기는 없다. 설정창 열기는 app.ts 가 맨 위에 붙인다
  const tray = trayMenu({ hidden: false, ghost: true }, act);
  eq(tray.map((m) => m.label ?? m.type), [t("menu.hide"), t("menu.ghost"), "separator", t("menu.quit")], "trayMenu 순서·라벨");
  ok(tray[1]?.type === "checkbox" && tray[1]?.checked === true, "trayMenu 고스트 모드 체크");
  (tray[0]!.click as () => void)();
  (tray[1]!.click as () => void)();
  (tray[3]!.click as () => void)();
  eq([hid, ghost, quit], [1, 1, 1], "trayMenu 클릭이 동작을 부른다");
  // 앱이 그리는 메뉴의 모양 — 체크 항목은 켜짐 글을 붙이고, 앞·뒤·연속 구분선은 뺀다
  const view = menuView([{ type: "separator" }, ...tray, { type: "separator" }, { label: "누를 수 없음", enabled: false }], "켜짐");
  eq(
    view.map((v) => (v.kind === "item" ? `${v.label}${v.hint ? `(${v.hint})` : ""}${v.disabled ? "!" : ""}` : v.kind === "status" ? `[${v.title}]` : "separator")),
    [t("menu.hide"), `${t("menu.ghost")}(켜짐)`, "separator", t("menu.quit"), "separator", "[누를 수 없음]"],
    "menuView 모양",
  );
  const quitView = view.find((v) => v.kind === "item" && v.label === t("menu.quit"));
  eq(quitView?.kind === "item" ? quitView.id : -1, 4, "menuView 번호는 모델 안의 자리");
}

// ── party — 파일 · writer/reader · 옛 저장 · 첫 실행 (저장 v3) ─────────────────────
// 앱과 같게 묶는다 — 실행기는 잠금을 잡은 프로세스만 쓴다 (src/main/app.ts)
function openParty(p: ReturnType<typeof pathsIn>) {
  let party: SaveParty | null = null;
  const game = createGame({ file: p.save, canWrite: () => party?.isWriter() ?? false, rand: () => 0.5 });
  party = createSaveParty({ game, paths: p });
  return { game, party };
}

async function partyTests(): Promise<void> {
  // writer — 파일을 읽고 자리·숨김이 실행기를 거쳐 파일에 내려간다
  {
    const p = pathsIn(tmpDir("writer"));
    store.write(p.save, devSaveState(["eevee", "pikachu"], { now: T0, rng: () => 0 }));
    const { party } = openParty(p);
    ok(party.isWriter(), "writer 가 됐다");
    eq(party.pets().map((x) => x.id), ["p1", "p2"], "writer 가 파티를 읽었다");
    eq(party.pets()[0]?.nature, "hardy", "성격이 실렸다");
    ok(!party.needsStarter(), "파티가 있으면 첫 실행 아님");
    ok((await party.setHome("p1", { dx: -10, dy: -20 })).ok, "setHome 성공");
    const disk = store.read(p.save, { repair: false }).state!;
    eq(disk.pets[0]!.home, { dx: -10, dy: -20 }, "setHome 이 파일에 내려갔다");
    eq(disk.pets[1]!.home, devSaveState(["eevee", "pikachu"], { now: T0 }).pets[1]!.home, "다른 마리의 집은 그대로");
    const shown = await party.setShown("p2", false);
    ok(shown.ok && store.read(p.save, { repair: false }).state!.party.slots[1]!.hidden === true, "setShown 이 파일에 내려갔다");
    eq(party.pets().length, 1, "숨긴 마리는 pets 에서 빠진다");
    eq(party.all().length, 2, "all 은 숨긴 마리도 준다");
    party.stop();
    eq(writer.readOwner(p.saveLock), null, "stop 이 잠금을 놓는다");
  }
  // 옛 저장 v1 — v2 읽기를 거쳐 v3 로 옮긴다. 원본은 한 번만 사본으로 남긴다
  {
    const p = pathsIn(tmpDir("v1"));
    const v1 = { v: 1, active: "eevee#1", points: 3, party: { "eevee#1": { species: "eevee", since: T0, affinity: 5 } }, daily: { date: "2026-09-17", streak: 2 } };
    fs.writeFileSync(p.save, JSON.stringify(v1));
    const { party } = openParty(p);
    const bak = store.backupName(p.save);
    ok(fs.existsSync(bak), "원본 사본 save.json.v2.bak 이 생겼다");
    eq(JSON.parse(fs.readFileSync(bak, "utf8")).v, 1, "사본은 v1 그대로");
    eq(JSON.parse(fs.readFileSync(p.save, "utf8")).v, 3, "원본은 v3 로 다시 썼다");
    eq(party.pets().map((x) => x.species), ["eevee"], "v1 의 마리가 무대에 나온다");
    party.stop();
    fs.writeFileSync(bak, "marker");
    fs.writeFileSync(p.save, JSON.stringify(v1));
    openParty(p).party.stop();
    eq(fs.readFileSync(bak, "utf8"), "marker", "사본은 덮지 않는다 (한 번만)");
  }
  // reader — 살아 있는 남이 잠금을 쥐면 파일만 읽는다. 바꾸는 요청은 mailbox 로 가고 파일은 쓰지 않는다
  {
    const p = pathsIn(tmpDir("reader"));
    const idle = spawnIdle();
    try {
      fs.writeFileSync(p.saveLock, `${idle.pid}
`);
      store.write(p.save, devSaveState(["eevee", "pikachu"], { now: T0, rng: () => 0 }));
      const before = fs.readFileSync(p.save, "utf8");
      const { game, party } = openParty(p);
      ok(!party.isWriter(), "잠금이 남의 것이면 reader");
      eq(party.pets().length, 2, "reader 도 파일을 읽는다");
      ok(!party.needsStarter(), "reader 는 첫 실행을 맡지 않는다");
      const moved = party.setHome("p1", { dx: -99, dy: -99 }); // 받아 줄 writer 가 없다 — 기다리지 않는다
      ok(fs.readdirSync(p.mailbox).some((name) => name.endsWith(".json")), "reader setHome 은 mailbox 로 보낸다");
      eq(game.send({ cmd: "party.hide", target: "p1" }, "menu").reason, "save-failed", "reader 의 실행기는 쓰지 않는다");
      game.tick();
      eq(fs.readFileSync(p.save, "utf8"), before, "reader 는 파일을 쓰지 않는다");
      // writer(다른 프로세스 흉내)가 파일을 바꾸면 감시가 읽는다
      let changes = 0;
      party.onChange(() => void (changes += 1));
      await sleep(50);
      store.write(p.save, devSaveState(["eevee", "pikachu", "squirtle"], { now: T0 + 1000, rng: () => 0 }));
      ok(await waitFor(() => party.pets().length === 3), "reader 가 파일 변화를 감시로 읽었다");
      ok(changes >= 1, "onChange 가 불렸다");
      party.stop();
      eq(writer.readOwner(p.saveLock), idle.pid, "reader 는 남의 잠금을 건드리지 않는다");
      eq((await moved).reason, "timeout", "받아 줄 writer 가 없으면 시간 초과로 끝난다");
    } finally {
      idle.kill();
    }
  }
  // 첫 실행 — 파일 없음 → writer → begin(첫 선택)
  {
    const p = pathsIn(tmpDir("first"));
    const { party } = openParty(p);
    ok(party.isWriter() && party.needsStarter(), "파일이 없으면 writer 이고 첫 실행");
    eq(party.pets(), [], "첫 실행 전에는 빈 파티");
    ok(party.begin("eevee"), "begin 이 첫 선택으로 시작한다");
    ok(!party.needsStarter(), "begin 뒤에는 첫 실행 아님");
    const disk = store.read(p.save, { repair: false }).state!;
    eq([disk.pets.length, disk.pets[0]!.species, disk.party.slots[0]!.petId], [1, "eevee", "p1"], "첫 실행 저장 모양");
    ok(disk.dex.obtained.includes("eevee"), "첫 포켓몬은 도감에");
    ok(!party.begin("pikachu"), "두 번째 begin 은 거절");
    party.stop();
  }
}

async function stageRuntimeTests(): Promise<void> {
  let now = T0;
  const sent: string[] = [];
  const looks = new Map<string, Look>();
  const art: ArtLoader = {
    async loadLook(look) {
      if (!looks.has(look)) {
        const sheet = sheets.anims.Idle!;
        const bundle = { ...sheets, look, anims: { Idle: sheet, Walk: sheet, Eat: sheet, Hop: sheet } };
        looks.set(look, { look, sheets: bundle, art: { ...bundle, kind: "pmd", zoom: 2, work: {}, workOnly: [], credits: [], dex: "1", from: "test" } });
      }
      return looks.get(look)!;
    },
    cached: (look) => looks.get(look) ?? null,
    prefetch() {},
  };
  const iconsSent: Record<string, string>[] = [];
  const win = { sendSheets: (s: LookSheets) => sent.push(s.look), sendIcons: (i: Record<string, string>) => iconsSent.push(i), sendInit() {}, sendFrame() {}, sendClickThrough() {}, hoverTick() {}, setPassing() {} } as unknown as StageWindow;
  const stage = createStage({ buddyMode: "on", timeScale: 1, window: win, art, ghost: () => false, cursor: () => ({ x: 100, y: 100 }), onDrop() {}, onClick() {}, onMenu() {}, onArtMissing() { throw new Error("그림 누락"); }, now: () => now });
  const pet: PartyPet = { id: "p1", species: "eevee", look: "eevee", size: 2, nature: "hardy", home: { dx: -24, dy: -60 }, screen: null, shown: true, nick: null };
  stage.setStage({ x: 0, y: 0, w: 800, h: 600 }, { w: 800, h: 600 }, false);
  stage.setVisible(true);
  await stage.setParty([pet]);
  stage.tick();
  eq(stage.lastFrame()?.pets[0]?.look, "eevee", "무대가 첫 그림을 사용");
  stage.pointer({ type: "grab", id: "p1", x: 0, y: 0 });
  await stage.setParty([{ ...pet, species: "umbreon", look: "umbreon" }]);
  stage.tick();
  eq(stage.lastFrame()?.pets[0]?.look, "umbreon", "같은 id 의 그림 교체 반영");
  eq(stage.heldId(), null, "그림 교체 중 들고 있던 상태 해제");
  eq(sent, ["eevee", "umbreon"], "교체된 시트를 전송");
  const oldX = stage.lastFrame()!.pets[0]!.x;
  stage.care("p1", "feed");
  for (let n = 0; n < 20; n++) { now += 40; stage.tick(); }
  ok(stage.lastFrame()!.pets[0]!.x < oldX, "먹이 쪽으로 걸어감");
  ok(stage.lastFrame()!.pets[0]!.berry, "먹이 좌표가 프레임에 있음");
  for (let n = 0; n < 90; n++) { now += 40; stage.tick(); }
  ok(!stage.lastFrame()!.pets[0]!.berry, "먹은 뒤 열매 제거");
  // 놀기는 커서(100,100)를 따라가지 않는다 — 옆으로 조금 걸어가 폴짝 뛰고 playMs 뒤 끝난다
  stage.care("p1", "play");
  const before = stage.lastFrame()!.pets[0]!;
  for (let n = 0; n < 25; n++) { now += 40; stage.tick(); }
  const mid = stage.lastFrame()!.pets[0]!;
  eq(mid.y, before.y, "놀기는 위아래로 커서 쪽에 가지 않음");
  ok(Math.abs(mid.x - before.x) <= STAGE_RULES.care.foodOffsetPx + 1, "놀기는 옆으로 조금만 걸어감");
  for (let n = 0; n < 150; n++) { now += 40; stage.tick(); }
  const after = stage.lastFrame()!.pets[0]!;
  ok(Math.hypot(after.x - 100, after.y - 100) > Math.hypot(before.x - 100, before.y - 100) - STAGE_RULES.care.foodOffsetPx - 1, "반응이 끝나도 커서 밑으로 오지 않음");
  // 아이콘 말풍선 — 그림을 먼저 보내고, 정한 시간 동안만 프레임에 열쇠가 실린다. 글자는 싣지 않는다 (2026-09-29 사용자 결정)
  stage.say("p1", ["item:meat", "item:meat", "item:meat"], { "item:meat": "data:image/png;base64,AAAA" }, 1000);
  now += 40; stage.tick();
  eq(stage.lastFrame()?.pets[0]?.bubble, ["item:meat", "item:meat", "item:meat"], "매우 배고픔 — 고기 세 개가 프레임에 실린다");
  eq(iconsSent, [{ "item:meat": "data:image/png;base64,AAAA" }], "그림은 한 번만 보낸다");
  now += 1000; stage.tick();
  eq(stage.lastFrame()?.pets[0]?.bubble, undefined, "시간이 지나면 말풍선이 사라진다");
  stage.say("p1", ["item:meat"], {}, 1000);
  eq(iconsSent.length, 1, "이미 보낸 그림은 다시 보내지 않는다");
  now += 40; stage.tick();
  eq(stage.lastFrame()?.pets[0]?.bubble, ["item:meat"], "배고픔 — 고기 하나");
  now += 1000; stage.tick();
  stage.say("p1", ["item:coin"], {}, 1000);
  now += 40; stage.tick();
  eq(stage.lastFrame()?.pets[0]?.bubble, undefined, "그림이 없는 열쇠면 말풍선을 띄우지 않는다 — 글자로 되돌리지 않는다");
  // 첫 돌봄 — 세운 마리는 오래 지나도 제자리에 서 있고, 풀어도 그 자리에서 이어 간다
  stage.pin("p1");
  now += 40; stage.tick();
  const pinnedAt = stage.lastFrame()!.pets[0]!;
  // 푸는 시각은 튜토리얼이 정한다 — 오래 두어도 그대로다(10분)
  for (let n = 0; n < 15000; n++) { now += 40; stage.tick(); }
  const stillAt = stage.lastFrame()!.pets[0]!;
  eq([stillAt.x, stillAt.y], [pinnedAt.x, pinnedAt.y], "pin 한 마리는 풀 때까지(10분) 움직이지 않음");
  eq(stillAt.play, null, "pin 한 마리는 서 있는 동작");
  stage.pin(null);
  now += 40; stage.tick();
  eq([stage.lastFrame()!.pets[0]!.x, stage.lastFrame()!.pets[0]!.y], [pinnedAt.x, pinnedAt.y], "pin 을 풀어도 선 자리에서 시작");
  stage.setVisible(false);
  stage.setVisible(true);
  now += 40; stage.tick();
  ok(stage.lastFrame()!.pets[0]!.x >= 0, "숨김 후에도 무대 안에 있음");
  await stage.setParty([]);
  stage.tick();
  eq(stage.petIds(), [], "빈 파티에서 무대 제거");

  // 설정 잠들기 기준 — 무대 옵션 sleepAfterMin 을 틱마다 읽어 모든 마리에 바로 넣는다. 0 은 잠들지 않음 (docs/specs/game.md "설정과 연결")
  // 그림에 Sleep·Wake 가 없어 판정은 awakeIds(자는 단계가 아닌 마리)로 본다
  let sleepMin: number | null = 0;
  const sleeper = createStage({ buddyMode: "on", timeScale: 1, window: win, art, ghost: () => false, sleepAfterMin: () => sleepMin,
    onDrop() {}, onClick() {}, onMenu() {}, onArtMissing() { throw new Error("그림 누락"); }, now: () => now });
  sleeper.setStage({ x: 0, y: 0, w: 800, h: 600 }, { w: 800, h: 600 }, false);
  sleeper.setVisible(true);
  await sleeper.setParty([pet]);
  for (let n = 0; n < 11_000; n++) { now += 40; sleeper.tick(); } // 440초
  eq(sleeper.awakeIds(), ["p1"], "잠들지 않음(0) — 440초 유휴여도 깨어 있음");
  sleepMin = 3; // 설정을 바꿨다 — 재시작 없이 다음 틱부터 3분 × 성격·종 배율. 유휴가 이미 넘었으니 곧 잔다
  // 무대의 움직임은 Math.random 이라 바꾼 순간 걷는 중일 수 있다. 걷기(최대 7초)·돌아보기를 마친 뒤 잠든다 — 잠들 때까지 최대 30초 돌린다
  for (let n = 0; n < 750 && sleeper.awakeIds().length; n++) { now += 40; sleeper.tick(); }
  eq(sleeper.awakeIds(), [], "3분으로 바꾸면 무대의 마리가 30초 안에 잠듦");
  sleepMin = 0;
  for (let n = 0; n < 5; n++) { now += 40; sleeper.tick(); }
  eq(sleeper.awakeIds(), ["p1"], "잠든 뒤 0 으로 바꾸면 깨어남");
  await sleeper.setParty([]);

  const overlap = createStage({ buddyMode: "off", timeScale: 1, window: win, art, ghost: () => false,
    onDrop() {}, onClick() {}, onMenu() {}, onArtMissing() { throw new Error("그림 누락"); }, now: () => now });
  overlap.setStage({ x: 0, y: 0, w: 800, h: 600 }, { w: 800, h: 600 }, false);
  overlap.setVisible(true);
  const six = Array.from({ length: 6 }, (_, n) => ({ ...pet, id: `p${n + 1}` }));
  await overlap.setParty(six);
  overlap.tick();
  const positions = () => overlap.lastFrame()!.pets.map((p) => [p.x, p.y]);
  const same = positions();
  ok(same.every((p) => p[0] === same[0]![0] && p[1] === same[0]![1]), "시작 시 여섯 마리가 겹쳐도 밀리지 않음");
  for (let i = 0; i < 100; i++) { now += 40; overlap.tick(); }
  eq(positions(), same, "반복 틱에서 겹친 마리 위치 유지");
  overlap.pointer({ type: "grab", id: "p1", x: 0, y: 0 });
  overlap.pointer({ type: "drag", id: "p1", x: same[0]![0]!, y: same[0]![1]! });
  overlap.tick();
  eq(overlap.lastFrame()!.pets.map((p) => p.id), six.map((p) => p.id), "드래그가 그리는 순서를 바꾸지 않음");
  overlap.pointer({ type: "drop", id: "p1", x: 0, y: 0 });
  overlap.tick();
  eq(positions(), same, "겹친 위치에 놓아도 밀리지 않음");
  await overlap.setParty([...six].reverse());
  overlap.tick();
  eq(overlap.petIds(), six.map((p) => p.id), "목록 재정렬은 소환 순서를 바꾸지 않음");
  await overlap.setParty(six.map((p) => p.id === "p1" ? { ...p, look: "umbreon", species: "umbreon" } : p));
  overlap.tick();
  eq(overlap.petIds(), six.map((p) => p.id), "진화 그림 교체 후 소환 순서 유지");
  // 다른 화면에서 끌려 온 마리를 들린 채로 받는다 — 자리는 무대 안에 가둔다 (src/main/stage-group.ts 넘기기)
  ok(overlap.adopt("p2", { x: 10_000, y: 20 }), "있는 마리는 받는다");
  eq(overlap.heldId(), "p2", "받은 마리를 든다");
  overlap.tick();
  const adopted = overlap.lastFrame()!.pets.find((p) => p.id === "p2")!;
  ok(adopted.held && adopted.x < 800 && adopted.y === 20, "들린 채로 무대 안 자리");
  overlap.pointer({ type: "drop", id: "p2", x: 0, y: 0 });
  eq(overlap.heldId(), null, "받은 무대에서 놓는다");
  ok(!overlap.adopt("없는마리", { x: 0, y: 0 }), "없는 마리는 받지 않는다");
  overlap.celebrate("p1"); overlap.tick();
  ok(overlap.lastFrame()!.pets[0]!.evolution, "진화 연출 시작");
  now += 1300; overlap.tick();
  ok(!overlap.lastFrame()!.pets[0]!.evolution, "진화 연출 종료");
  await overlap.setParty(six.slice(1));
  await overlap.setParty(six);
  overlap.tick();
  eq(overlap.petIds(), ["p2", "p3", "p4", "p5", "p6", "p1"], "숨긴 마리를 다시 소환하면 맨 앞에 표시");
  overlap.setStage({ x: 0, y: 0, w: 60, h: 60 }, { w: 60, h: 60 }, false);
  overlap.tick();
  ok(positions().every(([x, y]) => x! >= 0 && y! >= 0 && x! <= 60 && y! <= 60), "겹침 허용 후에도 화면 경계 유지");

  // 잠금을 잃으면 곧바로 reader 다. 실행기도 쓰지 않는다 — 다른 writer 의 저장을 덮지 않는다
  {
    const lost = pathsIn(tmpDir("lost-writer"));
    store.write(lost.save, devSaveState(["eevee"], { now: T0 }));
    const { game, party } = openParty(lost);
    const other = spawnIdle();
    try {
      ok(party.isWriter(), "처음에는 writer");
      fs.writeFileSync(lost.saveLock, String(other.pid));
      ok(!party.isWriter(), "잠금 상실을 즉시 인식");
      const original = fs.readFileSync(lost.save, "utf8");
      eq(game.send({ cmd: "party.hide", target: "p1" }, "menu").reason, "save-failed", "잠금을 잃은 프로세스의 쓰기 거절");
      eq(fs.readFileSync(lost.save, "utf8"), original, "다른 writer 의 저장을 덮지 않음");
    } finally { party.stop(); other.kill(); }
  }

  // v2 저장을 처음 열면 v3 으로 옮긴다. 원본은 옆에 남고 무대는 그대로 돈다
  {
    const migPaths = pathsIn(tmpDir("migrate-v3"));
    const old = legacy.empty(T0);
    old.party.push(legacy.emptyPet({ id: "p1", species: "eevee", now: T0 }), legacy.emptyPet({ id: "p2", species: "pikachu", now: T0 }));
    old.slots = 2;
    old.party[0]!.nick = "뽀야";
    old.party[0]!.look = "eevee-starter";
    old.points = 1234;
    legacy.write(migPaths.save, old);
    const migGame = createGame({ file: migPaths.save });
    const migParty = createSaveParty({ game: migGame, paths: migPaths });
    try {
      const moved = store.read(migPaths.save, { repair: false }).state!;
      eq(moved.pets.length, 2, "두 마리가 그대로 옮겨진다");
      eq(moved.points.balance, 1234, "포인트가 그대로");
      ok(fs.existsSync(store.backupName(migPaths.save)), "원본을 옆에 남긴다");
      ok(!migParty.needsStarter(), "이미 개체가 있으면 첫 선택을 묻지 않는다");
      eq(migParty.pets().map((p) => p.id), ["p1", "p2"], "무대에 두 마리");
      // 별명·모습은 쓰지 않는다. 실제 종의 이름과 그림이다 (docs/specs/game.md). 옛 값은 legacy 에 남는다
      eq(migParty.pets()[0]!.nick, null, "별명을 보이지 않는다");
      eq(migParty.pets()[0]!.look, "eevee", "고른 모습이 아니라 종의 그림");
      eq(moved.legacy["nick:p1"], "뽀야", "별명은 legacy 에 보존");
      eq(moved.legacy["look:p1"], "eevee-starter", "모습도 legacy 에 보존");
    } finally { migParty.stop(); }
  }

  // 명령 왕복 (저장 v3) — mailbox → dispatcher → 거래 실행기 → 파일
  const commandPaths = pathsIn(tmpDir("care-commands"));
  const seed = emptyV3(T0);
  begin(seed, "eevee", T0, () => 0);
  seed.pets[0]!.fullness = 40;
  seed.bag.toy = 1; // 가방 도구 사용의 무대 반응 확인용 (아래 bag.use)
  seed.bag["rare-candy"] = 1;
  store.write(commandPaths.save, seed);
  const game = createGame({ file: commandPaths.save, rand: () => 0 });
  const source = createSaveParty({ game, paths: commandPaths });
  let animations = 0;
  let lastCare = "";
  const commands = createCommands({ mailboxDir: commandPaths.mailbox, party: source, game,
    stage: { poke: () => true, care: (_id, action) => { animations++; lastCare = action; }, petIds: () => ["p1"], size: () => ({ w: 800, h: 600 }), visible: () => true },
    settings: { hidden: () => false, setHidden() {}, clickThrough: () => false, setClickThrough() {} }, quit() {},
  });
  try {
    ok(source.isWriter(), "잠금을 잡아 writer 로 시작");
    commands.setWriter(true);
    const fed = await send(commandPaths.mailbox, { cmd: "feed", target: "p1", from: "cli" });
    ok(fed.ok, "mailbox → dispatcher → 실행기 → 저장 왕복");
    eq(store.read(commandPaths.save, { repair: false }).state!.pets[0]!.fullness, 60, "밥 효과가 디스크에 저장");
    eq(animations, 1, "저장 성공 뒤 연출 요청");
    const again = await commands.dispatcher.dispatch({ cmd: "feed", target: "p1", from: "menu" });
    eq(again.reason, "cooldown", "중복 밥 거절");
    eq(animations, 1, "거절된 명령은 연출하지 않음");

    // 포켓몬 클릭은 놀아주기다. 쿨타임이면 무대 반응만으로 끝난다
    const clicked = await commands.click("p1");
    ok(clicked.ok, "클릭이 놀아주기로 저장된다");
    eq(store.read(commandPaths.save, { repair: false }).state!.pets[0]!.playStreak, 1, "놀아주기 중첩 1");
    eq(animations, 2, "놀아주기 연출");
    eq((await commands.click("p1")).reason, "cooldown", "쿨타임의 클릭은 놀아주지 않는다");
    eq(animations, 2, "쿨타임이면 놀이 연출이 없다");

    // 가방 도구 — 장난감은 놀아주기와 같은 반응, 그 밖의 도구(이상한사탕)는 새 반응이 없다 (docs/specs/game.md "가방 도구 사용 결과")
    ok((await commands.dispatcher.dispatch({ cmd: "bag.use", target: "toy", args: { petId: "p1" }, from: "menu" })).ok, "쿨타임이어도 장난감은 쓴다");
    eq([animations, lastCare], [3, "play"], "장난감은 놀아주기 연출");
    ok((await commands.dispatcher.dispatch({ cmd: "bag.use", target: "rare-candy", args: { petId: "p1" }, from: "menu" })).ok, "이상한사탕 사용");
    eq(animations, 3, "이상한사탕은 무대 연출이 없다");

    // 모습 선택은 제거된 기능이다
    eq((await commands.dispatcher.dispatch({ cmd: "pet.look", target: "p1", args: { look: "eevee" }, from: "cli" })).reason, "removed", "pet.look 은 제거됐다고 답한다");

    const old = structuredClone(source.save());
    // 저장 경로를 디렉터리로 바꿔 파일에 닿지 못하는 상황 재현 — 임시 폴더 안에서만
    fs.unlinkSync(commandPaths.save);
    fs.mkdirSync(commandPaths.save);
    // 놀아주기는 위의 클릭으로 쿨타임이다. 규칙에 걸리지 않는 명령으로 저장 실패만 본다
    const failed = await commands.dispatcher.dispatch({ cmd: "settings.set", target: "sound", args: { value: false }, from: "menu" });
    ok(!failed.ok, "저장에 닿지 못하면 성공으로 응답하지 않음");
    eq(animations, 3, "저장 실패 시 연출하지 않음");
    const moved = await commands.dispatcher.dispatch({ cmd: "pet.set", target: "p1", args: { home: { dx: -123, dy: -45 } }, from: "cli" });
    ok(!moved.ok, "위치 저장 실패를 성공으로 응답하지 않음");
    eq(source.save(), old, "저장 실패는 메모리 상태를 바꾸지 않는다");
  } finally { commands.stop(); source.stop(); }
}

// ── anchor — 가짜 헬퍼로 상태기 (Windows 는 셸 스크립트를 execFile 로 못 돌려 건너뛴다) ──
async function anchorTests(): Promise<void> {
  if (process.platform === "win32") {
    out("anchor: win32 — 가짜 헬퍼 스크립트를 건너뛴다");
    return;
  }
  const dir = tmpDir("anchor");
  const helper = path.join(dir, "fake-winbounds");
  const win = { app: "Fake", pid: 424242, id: 77, x: 10, y: 20, w: 800, h: 600 };
  fs.writeFileSync(helper, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ frontmost: "Fake", frontPid: 424242, windows: [win] })}'\n`, { mode: 0o755 });
  const env = { ...process.env, POKEBUDDY_WINBOUNDS: helper };
  const fakeArea = { id: -1, pid: 0, app: "", x: 0, y: 0, w: 1440, h: 900, fake: true as const };
  const make = (flags: { userHidden: boolean; held: boolean }, updates: AnchorUpdate[]) => {
    let quits = 0;
    const anchor = createAnchor({
      paths: { state: path.join(dir, "state"), project: dir }, self: { pid: process.pid, appNames: new Set(["electron"]) }, env,
      host: { platform: "darwin", now: Date.now, toDip: (w) => w, offScreen: () => false, workArea: () => fakeArea, quit: () => void (quits += 1), quitting: () => false },
      flags: () => flags, onUpdate: (u) => updates.push(u), onFocus: () => {}, log: null,
    });
    return { anchor, quits: () => quits };
  };
  const pollOnce = async (anchor: { poll(): void }, updates: AnchorUpdate[]): Promise<AnchorUpdate> => {
    const n = updates.length;
    anchor.poll();
    ok(await waitFor(() => updates.length > n), "헬퍼 답이 왔다");
    return updates[updates.length - 1]!;
  };
  // 맨 앞 창이 터미널 호스트가 아니면(모르는 앱) 작업 영역(가짜 창)에 남는다. 표시는 2회 연속 뒤. 직접 숨김·들기 판정
  {
    const updates: AnchorUpdate[] = [];
    const flags = { userHidden: false, held: false };
    const { anchor } = make(flags, updates);
    const u1 = await pollOnce(anchor, updates);
    eq([u1.target?.fake, u1.visible], [true, false], `1회: 표시는 아직 (visibleConfirm=${ANCHOR_RULES.visibleConfirm})`);
    const u2 = await pollOnce(anchor, updates);
    eq([u2.target?.fake, u2.visible], [true, true], "2회: 호스트 없음 → 가짜 창 · 늘 보임");
    eq(anchor.currentInfo(), { state: "idle", promptAt: null }, "훅 기록이 없으면 대기");
    flags.userHidden = true;
    await pollOnce(anchor, updates);
    const u3 = await pollOnce(anchor, updates);
    eq(u3.visible, false, "직접 숨김은 2회 뒤 숨는다");
    flags.held = true;
    flags.userHidden = false;
    await pollOnce(anchor, updates);
    const u4 = await pollOnce(anchor, updates);
    eq(u4.visible, false, "들고 있는 동안은 판정 보류 — 직전 상태 유지");
    anchor.stop();
  }
  // 훅 기록이 그 창 주인을 조상으로 가지면 호스트 (a) → 그 창을 따른다
  {
    const stateDir = tmpDir("anchor/state");
    fs.writeFileSync(path.join(stateDir, "s.json"), JSON.stringify({ at: Date.now() / 1000, state: "running", ancestors: [424242], promptAt: 1 }));
    const updates: AnchorUpdate[] = [];
    const { anchor } = make({ userHidden: false, held: false }, updates);
    await pollOnce(anchor, updates);
    const u = await pollOnce(anchor, updates);
    eq([u.target?.id, u.visible], [77, true], "동반자: 훅 기록으로 호스트를 알아 그 창을 따른다");
    eq(anchor.currentInfo().state, "running", "그 창의 세션 상태를 따른다");
    anchor.stop();
    fs.rmSync(path.join(stateDir, "s.json"));
  }
}

(async () => {
  try {
    await partyTests();
    await stageRuntimeTests();
    await anchorTests();
    out(`통과 (${passed}건)`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})();
