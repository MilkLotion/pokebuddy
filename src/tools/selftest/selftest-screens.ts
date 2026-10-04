// 놀이공간 여러 화면 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-screens.js
//
// 테스트 프레임워크 없이 assert 만. 방식 정규화(옛 full 이전), 설정 명령, 사는 화면 저장, 화면 식별 대체, 무대 창 목록,
// 개체 배분, 무대 묶음(가짜 창·가짜 무대)의 배분·다른 화면에 놓기·화면 빠짐을 본다.
// 설계는 worklog/records/multi-display/record.md. 끝에 "통과" 한 줄. 실패하면 종료 코드 1
import assert from "node:assert/strict";
import { assignScreens, playLanes, findScreen, screenOrder, type PlayLane, type ScreenInfo } from "../../main/layout";
import type { Rect, Size } from "../../shared/geometry";
import type { PartyPet } from "../../view/party-pet";
import type { Stage } from "../../main/stage";
import { createStageGroup, type LaneHooks, type LaneStageHooks } from "../../main/stage-group";
import type { StageWindow } from "../../main/stage-window";
import { setHome } from "../../party/home";
import { emptySave as empty, normalizeSave as normalize } from "../../save/normalize";
import type { CoachView, PointerMsg } from "../../shared/model/stage";
import { setSetting } from "../../state/settings";

const T0 = Date.UTC(2026, 8, 28, 3, 0, 0);
const norm = (raw: unknown) => {
  const s = normalize(raw, T0);
  assert.ok(s, "정규화 결과가 있다");
  return s;
};

// 왼쪽이 주 화면(1920×1080), 오른쪽에 큰 화면(2560×1440)
const A: ScreenInfo = { id: 1, bounds: { x: 0, y: 0, w: 1920, h: 1080 }, work: { x: 0, y: 25, w: 1920, h: 1055 }, primary: true };
const B: ScreenInfo = { id: 7, bounds: { x: 1920, y: 0, w: 2560, h: 1440 }, work: { x: 1920, y: 0, w: 2560, h: 1400 }, primary: false };
const C: ScreenInfo = { id: 9, bounds: { x: -1280, y: 0, w: 1280, h: 1024 }, work: { x: -1280, y: 0, w: 1280, h: 1024 }, primary: false };
const refB = { id: 7, x: 1920, y: 0, w: 2560, h: 1440 };

// (1) 저장 정규화 — 옛 full 은 한 화면(주 화면), 모르는 값도 한 화면. 새 저장은 한 화면
{
  const read = (playArea: unknown) => norm({ ...empty(T0), settings: { ...empty(T0).settings, playArea } }).settings.playArea;
  assert.deepEqual(empty(T0).settings.playArea, { mode: "screen", rect: null, screen: null }, "새 저장은 주 화면");
  assert.deepEqual(read({ mode: "full", rect: null }), { mode: "screen", rect: null, screen: null }, "옛 full → 한 화면");
  assert.deepEqual(read({ mode: "zigzag", rect: null }).mode, "screen", "모르는 방식 → 한 화면");
  assert.deepEqual(read({ mode: "all", rect: null }).mode, "all");
  assert.deepEqual(read({ mode: "region", rect: { x: 1, y: 2, w: 300, h: 200 } }).rect, { x: 1, y: 2, w: 300, h: 200 });
  assert.deepEqual(read({ mode: "screen", rect: null, screen: refB }).screen, refB, "고른 화면을 읽는다");
  assert.equal(read({ mode: "screen", rect: null, screen: { id: 7, x: 0 } }).screen, null, "모양이 틀린 화면은 버린다");
  const pet = norm({ ...empty(T0), pets: [{ id: "p1", species: "eevee", screen: refB }, { id: "p2", species: "pichu", screen: "x" }] }).pets;
  assert.deepEqual(pet[0]?.screen, refB, "개체의 사는 화면을 읽는다");
  assert.equal("screen" in (pet[1] ?? {}), false, "틀린 값이면 필드를 두지 않는다");
  process.stdout.write("(1) 저장 정규화  ok\n");
}

// (2) 설정 명령 — 방식 세 가지, 한 화면 고르기는 방식과 화면을 한 번에. 다른 방식으로 가도 고른 화면·영역은 남는다
{
  const s = empty(T0);
  assert.equal(setSetting(s, "playArea", "all").ok, true);
  assert.equal(s.settings.playArea.mode, "all");
  assert.deepEqual(setSetting(s, "playScreen", { ...refB, x: 1920.4 }), { ok: true, key: "playScreen", value: refB });
  assert.deepEqual(s.settings.playArea, { mode: "screen", rect: null, screen: refB });
  assert.equal(setSetting(s, "playScreen", { id: 1, x: 0, y: 0, w: 0, h: 10 }).reason, "bad-value", "크기 없는 화면");
  assert.equal(setSetting(s, "playScreen", null).reason, "bad-value");
  setSetting(s, "playRegion", { x: 10, y: 20, w: 800, h: 400 });
  assert.deepEqual(s.settings.playArea.screen, refB, "영역을 그려도 고른 화면은 남는다");
  setSetting(s, "playArea", "screen");
  assert.deepEqual(s.settings.playArea, { mode: "screen", rect: { x: 10, y: 20, w: 800, h: 400 }, screen: refB });
  assert.equal(setSetting(s, "playArea", "full").reason, "bad-value", "옛 값은 고를 수 없다");
  process.stdout.write("(2) 설정 명령  ok\n");
}

// (3) 사는 화면 저장 — pet.set 이 집과 함께 받는다. 주지 않으면 그대로, 틀린 값이면 거절
{
  const s = norm({ ...empty(T0), pets: [{ id: "p1", species: "eevee" }] });
  assert.equal(setHome(s, "p1", { dx: -5, dy: -9 }).ok, true);
  assert.equal(s.pets[0]?.screen, undefined, "주지 않으면 사는 화면이 없다");
  const r = setHome(s, "p1", { dx: -1, dy: -2 }, refB);
  assert.deepEqual([r.ok, s.pets[0]?.home, s.pets[0]?.screen], [true, { dx: -1, dy: -2 }, refB]);
  assert.equal(setHome(s, "p1", { dx: 0, dy: 0 }, { id: "7" }).reason, "bad-value");
  assert.deepEqual(s.pets[0]?.home, { dx: -1, dy: -2 }, "거절하면 집도 그대로");
  setHome(s, "p1", { dx: 3, dy: 4 });
  assert.deepEqual(s.pets[0]?.screen, refB, "집만 바꾸면 사는 화면은 그대로");
  process.stdout.write("(3) 사는 화면 저장  ok\n");
}

// (4) 화면 번호와 식별 — 주 화면이 1, 나머지는 왼쪽부터. id 가 없어지면 겹치는 화면, 그것도 없으면 주 화면
{
  assert.deepEqual(screenOrder([B, C, A]).map((s) => s.id), [1, 9, 7]);
  assert.equal(findScreen(null, [A, B])?.id, 1, "고른 화면이 없으면 주 화면");
  assert.equal(findScreen(refB, [A, B])?.id, 7, "id 가 같은 화면");
  assert.equal(findScreen({ ...refB, id: 70 }, [A, { ...B, id: 71 }])?.id, 71, "id 가 바뀌면 사각형이 겹치는 화면");
  assert.equal(findScreen(refB, [A, C])?.id, 1, "화면이 빠지면 주 화면");
  assert.equal(findScreen(refB, []), null);
  process.stdout.write("(4) 화면 번호와 식별  ok\n");
}

// (5) 무대 창 목록 — 모든 화면은 화면마다(작업 영역), 한 화면은 고른 화면, 영역은 가장 많이 겹치는 화면 하나
{
  const all = playLanes({ mode: "all", rect: null, screen: null }, [B, A]);
  assert.deepEqual(all.map((l) => [l.key, l.rect]), [["1", A.work], ["7", B.work]]);
  const one = playLanes({ mode: "screen", rect: null, screen: refB }, [A, B]);
  assert.deepEqual(one.map((l) => [l.key, l.target, l.rect]), [["7", B.work, B.work]]);
  assert.deepEqual(playLanes({ mode: "screen", rect: null, screen: refB }, [A]).map((l) => l.key), ["1"], "고른 화면이 빠지면 주 화면");
  const region = playLanes({ mode: "region", rect: { x: 1800, y: 100, w: 600, h: 300 }, screen: null }, [A, B]);
  assert.deepEqual(region.map((l) => [l.key, l.rect, l.target]), [["7", { x: 1920, y: 100, w: 480, h: 300 }, { x: 1800, y: 100, w: 600, h: 300 }]], "놀이공간은 그린 영역 그대로, 창만 화면 안으로");
  assert.deepEqual(playLanes({ mode: "region", rect: { x: 9000, y: 0, w: 500, h: 300 }, screen: null }, [A, B]).map((l) => l.rect), [A.work], "화면 밖 영역 → 주 화면");
  assert.deepEqual(playLanes({ mode: "region", rect: null, screen: null }, [A]).map((l) => l.key), ["1"], "영역이 없으면 주 화면");
  assert.deepEqual(playLanes({ mode: "all", rect: null, screen: null }, []), []);
  process.stdout.write("(5) 무대 창 목록  ok\n");
}

// (6) 개체 배분 — 사는 화면이 있으면 그 화면, 없으면 개체가 가장 적은 화면(같으면 번호 앞). 사는 화면이 빠지면 주 화면
{
  const pets = [
    { id: "a", screen: null },
    { id: "b", screen: refB },
    { id: "c", screen: null },
    { id: "d", screen: null },
  ];
  assert.deepEqual([...assignScreens(pets, [A, B]).entries()], [["b", 7], ["a", 1], ["c", 1], ["d", 7]]);
  assert.deepEqual([...assignScreens(pets, [A]).entries()], [["b", 1], ["a", 1], ["c", 1], ["d", 1]], "화면 하나면 모두 주 화면");
  assert.equal(assignScreens(pets, []).size, 0);
  process.stdout.write("(6) 개체 배분  ok\n");
}

// ── 무대 묶음 — 가짜 창·가짜 무대 ────────────────────────────────────────────────

interface FakeWin extends StageWindow {
  hooks: LaneHooks | null;
  held: boolean[]; // hoverTick 이 받은 "들고 있음"
  rect: Rect | null;
  shown: boolean;
  closed: boolean;
  coach: CoachView | null;
  cries: string[];
}
function fakeWin(hooks: LaneHooks | null = null): FakeWin {
  const w = {
    hooks,
    held: [] as boolean[],
    rect: null as Rect | null,
    shown: false,
    closed: false,
    coach: null as CoachView | null,
    cries: [] as string[],
    alive: () => !w.closed,
    stage: () => w.rect,
    size: (): Size => (w.rect ? { w: w.rect.w, h: w.rect.h } : { w: 0, h: 0 }),
    setStage: (r: Rect) => {
      w.rect = { ...r };
      return true;
    },
    setVisible: (on: boolean) => void (w.shown = on),
    isVisible: () => w.shown,
    raise() {},
    owns: () => false,
    setPassing() {},
    hoverTick: (held: boolean) => void w.held.push(held),
    sendInit() {},
    sendSheets() {},
    sendFrame() {},
    sendClickThrough() {},
    sendCry: (uri: string) => void w.cries.push(uri),
    sendIcons() {},
    sendCoach: (c: CoachView | null) => void (w.coach = c),
    resendCoach() {},
    close: () => void (w.closed = true),
  };
  return w as FakeWin;
}

interface FakeStage extends Stage {
  msgs: PointerMsg[];
  adopted: [string, { x: number; y: number }][];
  releases: number;
  list: PartyPet[];
  hooks: LaneStageHooks;
  anchor: Rect | null;
  pinnedId: string | null;
}
function fakeStage(hooks: LaneStageHooks): FakeStage {
  const s = {
    msgs: [] as PointerMsg[],
    adopted: [] as [string, { x: number; y: number }][],
    releases: 0,
    list: [] as PartyPet[],
    hooks,
    anchor: null as Rect | null,
    pinnedId: null as string | null,
    setParty: async (list: PartyPet[]) => void (s.list = list.map((p) => ({ ...p }))),
    setStage: (anchor: Rect) => void (s.anchor = { ...anchor }),
    setVisible() {},
    setState() {},
    focus() {},
    tick() {},
    pointer: (msg: PointerMsg) => void s.msgs.push(msg),
    adopt: (id: string, at: { x: number; y: number }) => (s.list.some((p) => p.id === id) ? (s.adopted.push([id, at]), true) : false),
    hit() {},
    releaseHeld: () => void s.releases++,
    resend() {},
    care() {},
    celebrate() {},
    say() {},
    petIds: () => s.list.map((p) => p.id),
    awakeIds: () => s.list.map((p) => p.id),
    petOf: (id: string) => s.list.find((p) => p.id === id) ?? null,
    bodyOf: (id: string) => (s.list.some((p) => p.id === id) ? { w: 40, h: 40 } : null),
    heldId: () => null,
    lastFrame: () => null,
    pin: (id: string | null) => void (s.pinnedId = id),
  };
  return s as FakeStage;
}

const pet = (id: string, screen: PartyPet["screen"] = null): PartyPet => ({ id, species: "eevee", look: "eevee", size: 2, nature: null, home: { dx: -24, dy: -60 }, screen, shown: true });
const lanes = (area: Parameters<typeof playLanes>[0], screens: ScreenInfo[]): PlayLane[] => playLanes(area, screens);

async function groupChecks(): Promise<void> {
  const wins: FakeWin[] = [];
  const stages: FakeStage[] = [];
  const laneWins: StageWindow[] = [];
  let cursor = { x: 0, y: 0 };
  const drops: { id: string; home: { dx: number; dy: number }; screen: unknown }[] = [];
  const g = createStageGroup({
    createWindow: (hooks) => {
      const w = fakeWin(hooks);
      wins.push(w);
      return w;
    },
    createStage: (w, hooks) => {
      laneWins.push(w); // 묶음이 감싼 창 — 무대는 이것으로 hoverTick 을 부른다
      const s = fakeStage(hooks);
      stages.push(s);
      return s;
    },
    cursorPoint: () => cursor,
    onDrop: (id, home, screen) => void drops.push({ id, home, screen }),
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  // (7) 한 화면 — 창 하나에 모두. 같은 구성이면 창을 다시 만들지 않는다
  g.layout(lanes({ mode: "screen", rect: null, screen: null }, [A, B]), false);
  await g.setParty([pet("a"), pet("b", refB)]);
  assert.equal(wins.length, 1);
  assert.deepEqual(stages[0]!.list.map((p) => p.id), ["a", "b"], "한 화면이면 사는 화면과 상관없이 모두");
  g.layout(lanes({ mode: "screen", rect: null, screen: null }, [A, B]), false);
  assert.equal(wins.length, 1, "같은 구성은 그대로");
  g.setVisible(true);
  assert.equal(wins[0]!.shown, true);
  stages[0]!.hooks.onDrop("a", { dx: -1, dy: -2 });
  assert.deepEqual(drops.pop(), { id: "a", home: { dx: -1, dy: -2 }, screen: undefined }, "한 화면에서는 사는 화면을 저장하지 않는다");
  process.stdout.write("(7) 무대 묶음 · 한 화면  ok\n");

  // (8) 모든 화면 — 화면마다 창, 개체는 사는 화면(없으면 적은 화면). 주 화면 창은 그대로 쓴다
  g.layout(lanes({ mode: "all", rect: null, screen: null }, [A, B]), true);
  await flush();
  assert.equal(wins.length, 2, "화면 B 창을 새로 만든다");
  assert.equal(wins[0]!.closed, false, "화면 A 창은 그대로");
  assert.deepEqual([stages[0]!.list.map((p) => p.id), stages[1]!.list.map((p) => p.id)], [["a"], ["b"]]);
  assert.deepEqual(g.petIds(), ["a", "b"], "파티 순서");
  assert.deepEqual(g.stageRectOf("b"), B.work);
  g.sendCry("b", "cry-b", 0.3);
  assert.deepEqual([wins[0]!.cries, wins[1]!.cries], [[], ["cry-b"]], "울음소리는 그 마리의 창에서");
  // 튜토리얼 — 마리 말풍선은 그 마리의 창에만, 영역 말풍선은 첫 창에
  const petCoach = { id: "first-care", kind: "pet", petId: "b", step: "", title: "", body: "", button: "" } as CoachView;
  g.sendCoach(petCoach);
  assert.deepEqual([wins[0]!.coach, wins[1]!.coach], [null, petCoach]);
  g.pin("b");
  assert.deepEqual([stages[0]!.pinnedId, stages[1]!.pinnedId], [null, "b"]);
  process.stdout.write("(8) 무대 묶음 · 모든 화면  ok\n");

  // (9) 다른 화면에 놓기 — 커서가 있는 화면으로 옮기고 그 화면 기준 집과 사는 화면을 저장한다
  cursor = { x: 2400, y: 700 }; // 화면 B 위
  stages[0]!.hooks.onDrop("a", { dx: -9, dy: -9 });
  const moved = drops.pop()!;
  assert.deepEqual(moved.screen, refB, "사는 화면 = 놓은 화면");
  // 커서가 몸 가운데 — 무대 안 자리 (2400-1920-20, 700-0-20) = (460, 680), 집은 창 오른쪽 아래 기준 (+ 나란히 두기 몫 32)
  assert.deepEqual(moved.home, { dx: 460 - (2560 - 40) + 32, dy: 680 - (1400 - 40) });
  await flush();
  assert.deepEqual([stages[0]!.list.map((p) => p.id), stages[1]!.list.map((p) => p.id)], [[], ["a", "b"]], "저장을 기다리지 않고 바로 옮긴다");
  // 같은 화면에 놓으면 그 화면을 사는 화면으로 저장한다
  cursor = { x: 2000, y: 300 };
  stages[1]!.hooks.onDrop("b", { dx: -3, dy: -4 });
  assert.deepEqual(drops.pop(), { id: "b", home: { dx: -3, dy: -4 }, screen: refB });
  process.stdout.write("(9) 다른 화면에 놓기  ok\n");

  // (9b) 끄는 도중 다른 화면으로 넘기기 — 커서가 화면 B 에 들어가면 B 무대가 들린 채로 받고, 이후 입력은 B 좌표로 간다
  //      (2026-09-28 사용자 보고 "드래그하면 화면에서 안움직이고 드랍하면 다른화면으로 옮겨짐")
  await g.setParty([pet("a"), pet("b", refB)]);
  await flush();
  const [sa, sb] = [stages[0]!, stages[1]!];
  assert.deepEqual([sa.list.map((p) => p.id), sb.list.map((p) => p.id)], [["a"], ["b"]]);
  const hooksA = wins[0]!.hooks!;
  cursor = { x: 1000, y: 500 };
  hooksA.onPointer({ type: "grab", id: "a", x: 1000, y: 475 });
  hooksA.onPointer({ type: "drag", id: "a", x: 990, y: 440 });
  assert.deepEqual(sa.msgs.slice(-2).map((m) => m.type), ["grab", "drag"], "같은 화면 안에서는 그 무대로");
  cursor = { x: 2000, y: 500 }; // 화면 B 로 넘어갔다
  hooksA.onPointer({ type: "drag", id: "a", x: 1990, y: 440 }); // 몸 좌상단 — 화면 A 창 기준
  await flush();
  assert.deepEqual([sa.list.map((p) => p.id), sb.list.map((p) => p.id)], [[], ["a", "b"]], "끄는 도중에 B 무대로 옮긴다");
  // 화면 좌표 (0+1990, 25+440) = (1990, 465) → B 무대 좌표 (70, 465)
  assert.deepEqual(sb.adopted.pop(), ["a", { x: 70, y: 465 }], "B 무대가 들린 채로 받는다");
  hooksA.onPointer({ type: "drag", id: "a", x: 2090, y: 440 });
  assert.deepEqual(sb.msgs.pop(), { type: "drag", id: "a", x: 170, y: 465 }, "이후 입력은 B 좌표로 바꿔 보낸다");
  // 잡은 창(A)은 끝날 때까지 든 것으로 친다 — 통과로 바뀌면 포인터 캡처가 끊긴다
  laneWins[0]!.hoverTick(false, false); // A 무대는 이제 마리가 없다 — 그래도 창에는 "들고 있음"으로 간다
  assert.equal(wins[0]!.held.pop(), true, "잡은 창은 통과시키지 않는다");
  assert.equal(drops.length, 0, "끄는 동안은 저장하지 않는다");
  hooksA.onPointer({ type: "drop", id: "a", x: 2090, y: 465 });
  assert.equal(sb.msgs.pop()?.type, "drop", "놓기도 B 무대로");
  laneWins[0]!.hoverTick(false, false);
  assert.equal(wins[0]!.held.pop(), false, "놓은 뒤에는 평소대로");
  process.stdout.write("(9b) 끄는 도중 다른 화면으로 넘기기  ok\n");

  // (9c) 넘긴 뒤 끊기면(창이 사라짐) 저장하지 않고 잡을 때의 화면으로 되돌린다
  await g.setParty([pet("a"), pet("b", refB)]);
  await flush();
  cursor = { x: 1000, y: 500 };
  hooksA.onPointer({ type: "grab", id: "a", x: 1000, y: 475 });
  cursor = { x: 2000, y: 500 };
  hooksA.onPointer({ type: "drag", id: "a", x: 1990, y: 440 });
  await flush();
  assert.deepEqual(sb.list.map((p) => p.id), ["a", "b"]);
  hooksA.onGone();
  await flush();
  assert.deepEqual([sa.list.map((p) => p.id), sb.list.map((p) => p.id)], [["a"], ["b"]], "잡을 때의 화면으로");
  assert.equal(drops.length, 0, "저장하지 않는다");
  process.stdout.write("(9c) 끊기면 되돌린다  ok\n");

  // (10) 화면이 빠지면 그 창을 닫고 마리는 주 화면으로(저장된 사는 화면은 그대로 남는다)
  await g.setParty([pet("a", refB), pet("b", refB)]); // (9) 에서 가 마리를 화면 B 에 놓은 상태
  g.layout(lanes({ mode: "all", rect: null, screen: null }, [A]), true);
  await flush();
  assert.equal(wins[1]!.closed, true, "빠진 화면의 창을 닫는다");
  assert.deepEqual(stages[0]!.list.map((p) => [p.id, p.screen?.id ?? null]), [["a", 7], ["b", 7]]);
  // 다시 꽂으면 사는 화면으로 돌아간다
  g.layout(lanes({ mode: "all", rect: null, screen: null }, [A, B]), true);
  await flush();
  assert.deepEqual(stages[2]!.list.map((p) => p.id), ["a", "b"], "다시 꽂은 화면의 새 창으로");
  g.close();
  assert.ok(wins.every((w) => w.closed), "모두 닫는다");
  process.stdout.write("(10) 화면 빠짐과 다시 꽂기  ok\n");
}

groupChecks()
  .then(() => process.stdout.write("통과\n"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
