// 펫 오버레이 메인 프로세스 — 기동 · 단일 인스턴스 · 종료 순서. 얇게 — 배선만 (옛 main.js 1398줄을 역할별 파일로 나눈 뒤 남은 것)
// 동반자 하나로 돈다 — 기기당 하나, 항상 위. 놀이공간(화면 전체·영역)에 머물고, 맨 앞 터미널 창의 에이전트 상태를 따른다 (follow/front).
// 트레이로 끝낸다. 세션 펫·창 펫 모드는 2026-09-27 에 지웠다 (worklog/records/game-runtime/record.md "세션·창 모드 삭제")
// 설정·경로는 config.js에서 읽음. 육성과 해금은 writer만 갱신
import fs from "node:fs";
import path from "node:path";
import { app, nativeImage, powerMonitor, screen, Notification } from "electron";
import { starters, unlockRules } from "../dex/unlocks";
import type { HelperWindow, SelfMark } from "../follow/types";
import { pidAlive } from "../save/writer";
import { createAnchor, type Anchor, type AnchorUpdate } from "./anchor";
import { createArtLoader } from "./art";
import { createCommands, type Commands } from "./commands";
import { STAGE_RULES, playAreaRect, stageOf, toLocal, type Rect } from "./layout";
import { clearFailure, createLifetime, reportFailure, type Lifetime } from "./lifetime";
import { lockExcept, petMenu, trayMenu } from "./menus";
import { createSaveParty, type PartyPet, type SaveParty } from "./save-party";
import { createGame, type GameV3 } from "./game";
import { createMainTrade, type MainTrade } from "./trade";
import { createTradeScreen, type TradeScreenBuilder } from "./trade-screen";
import { createMainOnline, type MainOnline } from "./online";
import { pendingOf } from "../trade/core";
import { careItem, petStatus } from "./status";
import { openManage, pushAccount, pushTrade } from "./manage-window";
import { createPortraits } from "./portraits";
import { drawRegion } from "./region-window";
import { createBannerWindow, type BannerWindow } from "./banner-window";
import { PATHS, loadConfig, logoFile, preloadFile, rendererFile } from "./paths";
import { pickStarter } from "./picker-window";
import { createStage, type Stage } from "./stage";
import { createStageWindow, type StageWindow } from "./stage-window";
import { langOf, natureName, petLabel, setLang, t } from "./text";
import { createTray, type TrayHandle } from "./tray";
import { popupMenu } from "./menu-window";
import { createCries, type Cries } from "./cries";
import { createHungerBubbles } from "./hunger-bubble";
import { SOUND_RULES, gainOf } from "../state/settings";
import { STATE_RULES } from "../state/rules";
import { createNotifier, type Notifier } from "../notify/notifier";
import type { ManageRoute } from "../shared/manage";
import type { Command } from "../shared/types";
import type { CoachView } from "../shared/stage";
import { currentTutorial } from "../tutorial/core";

let lastTick = 0;
// 에이전트 작업 시간 — 상태를 볼 때마다 running 이던 만큼 쌓아 두고, 게임 틱에 넘기고 비운다
let workMs = 0;
let lastPollAt = 0;
let lastMenuPoints = -1;
// 화면이 잠겨 있다 — 잠긴 동안은 게임 틱을 돌리지 않는다. 풀리면 다음 틱이 그 틈을 버린다(game.tick 은 틈을 TIME_V3_RULES.maxTickMs 로 자른다).
// 절전은 폴링이 멈춰 저절로 같은 결과가 된다. 잠금만 하고 절전하지 않으면 폴링이 계속 돌아 따로 막는다 (2026-09-27)
let screenLocked = false;

// POKEBUDDY_LOG 가 있으면 출력(console·stderr)을 그 파일에 이어 쓴다 — pokebuddy 는 펫에 출력 핸들을 넘기지 않는다
// (Windows 는 Start-Process 로 띄워 넘길 수도 없다. cli/run.js launchPet)
if (process.env.POKEBUDDY_LOG) {
  try {
    const logFd = fs.openSync(process.env.POKEBUDDY_LOG, "w");
    const write = (chunk: unknown, encoding?: unknown, done?: unknown): boolean => {
      try {
        if (typeof chunk === "string") fs.writeSync(logFd, chunk);
        else fs.writeSync(logFd, Buffer.from(chunk as Uint8Array));
      } catch {
        // 로그 실패는 무시
      }
      const cb = typeof encoding === "function" ? encoding : done;
      if (typeof cb === "function") (cb as () => void)();
      return true;
    };
    process.stdout.write = write as typeof process.stdout.write;
    process.stderr.write = write as typeof process.stderr.write;
  } catch {
    // 로그 파일을 못 열면 출력은 원래대로 버려진다
  }
}

// Electron 캐시·세션 폴더를 펫 데이터 아래로 — 기본값(~/Library/Application Support/<패키지 이름>)은
// 패키지 이름이 바뀌면 옛 폴더가 버려지고, uninstall --purge 로도 안 지워진다. ready 전에 정해야 한다
app.setPath("userData", PATHS.electronData);
// 디스크 캐시를 끈다 — 펫은 로컬 파일과 data URL 만 그려 캐시가 필요 없고, 여러 마리가 같은 폴더의
// 캐시 파일을 동시에 잡으면 Chromium 이 "Failed to open …/GPUCache" 오류를 줄줄이 남긴다
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

const config = loadConfig();
const { runtime } = config;
const { debug } = runtime;
setLang(langOf(config));
// POKEBUDDY_DEBUG — 판정 로그를 JSON 한 줄씩 (POKEBUDDY_LOG 가 있으면 그 파일로). console.log 대신 stdout 직접
const log = debug ? (o: Record<string, unknown>) => void process.stdout.write(`${JSON.stringify(o)}\n`) : null;

// 동반자는 기기당 하나 — pokebuddy companion 이 lock 파일로 먼저 가리지만 동시에 두 번 치면 둘 다 통과한다.
// 둘째는 창을 만들기 전에 끝난다
const duplicate = !app.requestSingleInstanceLock();
if (duplicate) app.quit();
// 떠 있는 동반자를 다시 실행했다(설치한 앱의 바로가기를 한 번 더 누름 등) — 새로 띄우지 않고 관리 창을 연다.
// 교환 링크(pokebuddy://trade/<토큰>)로 실행했으면 그 교환에 참가하고 교환 탭을 연다
else {
  app.on("second-instance", (_e, argv) => {
    const link = tradeLinkOf(argv);
    if (link) openTradeLink(link);
    else if (argv.some(isAccountLink)) openManageWindow({ to: "account" }); // GitHub 로그인을 마친 브라우저에서 돌아왔다
    else openManageWindow();
  });
  // mac 은 딥링크를 open-url 로 준다
  app.on("open-url", (e, url) => {
    e.preventDefault();
    const link = tradeLinkOf([url]);
    if (link) openTradeLink(link);
    else if (isAccountLink(url)) openManageWindow({ to: "account" });
  });
  // 설치한 앱만 등록한다 — 개발 실행의 electron 을 등록하면 앱 없는 빈 Electron 이 링크를 받는다
  if (app.isPackaged) app.setAsDefaultProtocolClient("pokebuddy");
}

// 로그인 시 시작 — 설정 값을 OS 에 적용한다. 설치한 앱에서만 한다.
// 저장소의 `electron .` 을 등록하면 다음 로그인 때 앱 없는 빈 Electron 이 뜨기 때문이다
let loginItem: boolean | null = null;
function syncLoginItem(): void {
  if (!app.isPackaged || !game) return;
  const on = game.read()?.settings.startOnLogin;
  if (on == null || on === loginItem) return;
  try {
    app.setLoginItemSettings({ openAtLogin: on });
    loginItem = on;
  } catch (e) { log?.({ loginItem: "failed", message: String(e) }); }
}

// 펫 자신을 가리는 표 — 개발 실행은 Electron 이라 이름으로 함께 걸러야 맨 앞 창에서 빠진다 (follow/front frontWindow)
const SELF: SelfMark = { pid: process.pid, appNames: new Set(["electron", String(app.getName() || "").toLowerCase()]) };

// 끝내는 중 — 창이 파괴되는 사이에 주기 작업·감시·헬퍼가 그 창을 건드리지 않게 before-quit 에서 멈춘다.
// 파괴된 창을 건드려 예외가 나면 Electron 기본 처리기가 모달을 띄워 메인이 멈추고, 확인을 누르면 밀린 폴링이
// 또 던진다 — 대화상자가 끝없이 이어지고 프로세스가 끝나지 못한다
let quitting = false;
let picking = false; // 첫 실행 선택 창이 열려 있다 — 그 창이 닫혀도 앱을 끝내지 않는다 (window-all-closed)
let staged = false; // 무대 창을 만들었다 — 그 전에 닫힌 창(선택 창)으로는 끝내지 않는다
let bootReady = false; // 그림·명령·수명 잠금 준비 후에만 CLI에 성공 통지
let userHidden = false; // 우클릭 · 트레이 · 설정으로 직접 숨김
const intervals: NodeJS.Timeout[] = [];

// 저장을 쓰는 곳은 하나다 — 거래 실행기. 무대·메뉴·관리 창이 모두 이 하나를 본다
let game: GameV3 | null = null;
// 알림 배너 — 줄은 notifier 가, 창은 bannerWin 이 맡는다. 저장을 쓰는 프로세스만 배너를 띄운다
let notifier: Notifier | null = null;
let bannerWin: BannerWindow | null = null;
let party: SaveParty | null = null;
const saveParty = (): SaveParty | null => party;
let lifetime: Lifetime | null = null;
let stageWin: StageWindow | null = null;
let stage: Stage | null = null;
let anchor: Anchor | null = null;
let commands: Commands | null = null;
let mainTrade: MainTrade | null = null; // 친구 교환 — writer 인 동반자만 가진다 (worklog/records/trade/record.md)
let tradeScreen: TradeScreenBuilder | null = null; // 교환 탭이 그리는 값
let mainOnline: MainOnline | null = null; // 공유 Supabase 클라이언트·계정·클라우드 저장 — writer 인 동반자만 가진다
let onlineFlushed = false; // 끄기 전에 클라우드 저장을 한 번 올렸다
let tradeStarted: Promise<void> = Promise.resolve(); // 교환 세션의 시작 확인 — 끝나기 전의 참가는 busy 로 거절된다
// 아직 참가하지 않은 교환 링크와 받은 시각. 링크로 처음 켜졌으면 인자에 있다. 링크 수명(참가 전 10분)이 지나면 버린다
const TRADE_LINK_TTL_MS = 10 * 60_000;
const firstLink = tradeLinkOf(process.argv);
let tradeLink: { link: string; at: number } | null = firstLink ? { link: firstLink, at: Date.now() } : null;
let tray: TrayHandle | null = null;
let lastState: string | null = null;

// ── Electron 이 필요한 화면 계산 (anchor 의 host) ──────────────────────────────

// 헬퍼 좌표 → Electron 창 좌표. Windows 헬퍼는 물리 픽셀을 주고 Electron 은 DIP 를 쓴다.
// 배율 125%·150% 에서 그대로 쓰면 펫이 따라갈 창의 오른쪽 아래가 아니라 화면 밖에 놓인다.
// 모니터마다 배율이 달라도 맞게 변환은 Electron(OS)에 맡긴다. mac 헬퍼는 이미 포인트 단위다
function toDip(w: HelperWindow): HelperWindow {
  if (process.platform !== "win32") return w;
  const r = screen.screenToDipRect(null, { x: w.x, y: w.y, width: w.w, height: w.h });
  return { ...w, x: r.x, y: r.y, w: r.width, h: r.height };
}

// Space 전환 애니메이션 중에는 다른 Space 의 창이 가상 스트립 좌표로 섞여 들어온다
// (보고값 = 실좌표 + Space인덱스 × (디스플레이폭 + 64)). 좌표도 순서도 믿을 수 없으므로 표본을 통째로 버린다
//
// 판정은 "화면 밖으로 완전히 벗어난 창이 있는가" 로 한다. 지금 화면에 보이는 창은 아무리 끝으로
// 밀어도 일부는 화면 안에 남는다 — 통째로 밖에 있다면 다른 Space 의 창이 끌려 들어온 것이다.
// (경계를 조금만 벗어나도 버리게 하면, 창 하나를 화면 밖으로 걸쳐 둔 것만으로 펫이 얼어붙는다)
function offScreen(windows: HelperWindow[]): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of screen.getAllDisplays()) {
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
  }
  if (!Number.isFinite(minX)) return false;
  return windows.some((w) => w.x >= maxX || w.x + w.w <= minX || w.y >= maxY || w.y + w.h <= minY);
}

// 터미널 호스트를 한 번도 못 봤다 — 무대가 있는(없으면 주) 디스플레이의 작업 영역을 창으로 삼는다.
// fake 표시 — 이 기준으로 집을 저장하면 진짜 창이 왔을 때 화면 기준 오프셋이 되어 튄다 (stage 가 저장을 건너뛴다)
function workAreaTarget(): HelperWindow {
  let display: Electron.Display;
  try {
    const cur = stageWin?.stage();
    display = cur ? screen.getDisplayMatching({ x: cur.x, y: cur.y, width: cur.w, height: cur.h }) : screen.getPrimaryDisplay();
  } catch {
    display = screen.getPrimaryDisplay();
  }
  const a = display.workArea;
  return { id: -1, pid: 0, app: "", x: a.x, y: a.y, w: a.width, h: a.height, fake: true };
}

// ── 배선 ─────────────────────────────────────────────────────────────────────

// 동반자의 놀이공간 — 설정의 `화면 전체 | 영역 지정`. 터미널 창 대신 이 사각형을 따라가는 창으로 삼는다 (2026-09-25 사용자 선택)
// 저장을 매 폴링마다 읽지 않는다. 게임 틱과 관리 창의 설정 변경 뒤에 다시 읽는다
let playArea: { mode: "full" | "region"; rect: Rect | null } = { mode: "full", rect: null };
function syncPlayArea(): void {
  if (!game) return;
  const next = game.read()?.settings.playArea;
  if (!next || (next.mode === playArea.mode && JSON.stringify(next.rect) === JSON.stringify(playArea.rect))) return;
  playArea = { mode: next.mode, rect: next.rect ? { ...next.rect } : null };
  anchor?.poll(); // 무대 사각형을 바로 다시 정한다
}

// 바탕화면 튜토리얼 — 대기열 맨 앞이 바탕화면 것이면 무대에 말풍선을 보낸다 (src/tutorial/core.ts, docs/specs/game.md "코치마크")
// 저장을 새로 읽는 때(게임 틱·명령 뒤·파티 변경)에 부른다. 같은 값이면 무대 창이 다시 보내지 않는다
function syncCoach(): void {
  if (!game || !stageWin) return;
  const save = game.read();
  const now = save ? currentTutorial(save) : null;
  const view = now && now.surface === "stage" && save ? coachView(now.id, save.starterPetId) : null;
  // 첫 돌봄 동안 밝힌 포켓몬을 세운다 — 걸으면 말풍선이 따라 움직인다 (2026-09-27 사용자 피드백)
  stage?.pin(view?.kind === "pet" ? view.petId ?? null : null);
  stageWin.sendCoach(view);
}

// 첫 돌봄의 단계 — 1/2 우클릭 유도, 포켓몬 메뉴가 열리면 2/2 메뉴에서 밥 주기 (2026-09-27 사용자 결정 "시안대로 진행", Figma `579:16959`).
// 값은 메뉴에 남긴 항목의 이름이다. 새 개체는 배부른 채 시작해 밥 주기가 막혀 있으므로 대개 놀아주기다.
// 저장에 두지 않는다 — 앱을 다시 켜면 1/2 부터 다시 보인다
let firstCareMenu: string | null = null;
let firstCareAvoid: CoachView["avoid"] = undefined; // 열린 메뉴의 자리(무대 좌표) — 말풍선이 피한다

function coachView(id: string, starterPetId: string | null): CoachView | null {
  const menuStep = id === "first-care" && firstCareMenu != null;
  const key = menuStep ? `coach.${id}.menu` : `coach.${id}`;
  const total = id === "first-care" ? 2 : 1;
  const name = t(`coach.${id}.name`);
  const step = total === 1 ? t("coach.step.single", { name }) : t("coach.step", { name, at: menuStep ? 2 : 1, total }); // 한 단계뿐이면 "1 / 1" 을 붙이지 않는다
  const base = { id, step, title: t(`${key}.title`, { action: firstCareMenu ?? "" }), body: t(`${key}.body`), button: t(`coach.${id}.button`) };
  if (id === "playground") return { ...base, kind: "area", areaLabel: t(playArea.mode === "region" ? "coach.area.region" : "coach.area.full") };
  // 첫 돌봄은 첫 포켓몬을 밝힌다. 무대에 없으면(숨김) 나와 있는 첫 마리. 아무도 없으면 기다린다
  const ids = stage?.petIds() ?? [];
  const petId = starterPetId && ids.includes(starterPetId) ? starterPetId : ids[0];
  return petId ? { ...base, kind: "pet", petId, ...(id === "first-care" && firstCareAvoid ? { avoid: firstCareAvoid } : {}) } : null;
}

function playTarget(): HelperWindow {
  const displays = screen.getAllDisplays().map((d) => ({ x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height }));
  const work = screen.getPrimaryDisplay().workArea;
  const r = playAreaRect(playArea, displays, { x: work.x, y: work.y, w: work.width, h: work.height });
  return { id: -2, pid: 0, app: "", x: r.x, y: r.y, w: r.w, h: r.h };
}

// 무대 사각형 = 놀이공간 ∩ 그 사각형이 있는 디스플레이. 바뀔 때만 setBounds (stage-window 가 가른다)
// 동반자는 따라갈 창 대신 놀이공간을 쓴다. 보일지는 앵커가 정한 그대로다
function onAnchorUpdate(update: AnchorUpdate): void {
  if (quitting || !stageWin || !stage) return;
  const play = playTarget();
  const target: Rect = { x: play.x, y: play.y, w: play.w, h: play.h };
  const d = screen.getDisplayMatching({ x: target.x, y: target.y, width: target.w, height: target.h }).bounds;
  const rect = stageOf(target, { x: d.x, y: d.y, w: d.width, h: d.height });
  if (rect) {
    stageWin.setStage(rect);
    stage.setStage(toLocal(target, rect), { w: rect.w, h: rect.h }, false);
  }
  const show = update.visible && stageWin.stage() != null; // 아직 무대 사각형이 없으면 1×1 창을 보이지 않는다
  stageWin.setVisible(show);
  stage.setVisible(show);
}

// 클릭 통과는 이번 실행에만 둔다 — config.json 에 쓰지 않는다
function applyClickThrough(on: boolean): void {
  config.clickThrough = on;
  // 들고 있는 중에 클릭 통과를 켜면 pointerup 이 영영 안 온다 — 커서에 붙은 채로 남지 않게 놓는다
  if (on) stage?.releaseHeld();
  // 무대는 늘 통과로 시작해 그림 위에서만 받는다 — 커서 밑은 다음 hoverTick 이 본다
  stageWin?.setPassing(true);
  stageWin?.sendClickThrough(on);
  tray?.refresh();
}

// 직접 숨기기·보이기 — 폴링이 되돌리지 않도록 상태로 남긴다 (우클릭 · 트레이 · 설정)
function setHidden(on: boolean): void {
  userHidden = on;
  anchor?.poll();
  tray?.refresh();
}
const toggleHidden = (): void => setHidden(!userHidden);

const firstPet = (): PartyPet | null => {
  const id = stage?.petIds()[0];
  return id ? (stage?.petOf(id) ?? null) : null;
};
const displayName = (): string => {
  const p = firstPet();
  return p ? petLabel(p) : party?.pets()[0]?.species ?? config.slug;
};

// 관리 창의 명령도 커맨드 처리기를 거친다. reader 면 mailbox 로 writer 에 보내고,
// 진화 그림 준비와 무대 반응도 다른 표면과 같은 길로 간다
// route — 알림 배너의 `바로가기` 가 옮겨 갈 곳
const openManageWindow = (route?: ManageRoute): void => {
  if (!game) return;
  openManage({
    ...(route ? { route } : {}),
    preload: preloadFile(),
    html: rendererFile("manage.html"),
    game,
    send: async (req) => {
      if (!commands) return { ok: false, reason: "not-ready" };
      const reply = await commands.dispatcher.dispatch({ cmd: req.cmd as Command["cmd"], target: req.target, args: req.args, from: "settings" });
      if (req.cmd === "settings.set") {
        syncLoginItem();
        syncPlayArea();
      }
      syncCoach();
      return reply;
    },
    display: () => ({ hidden: userHidden, clickThrough: !!config.clickThrough }),
    ...(mainOnline ? { account: mainOnline.act } : {}),
    // 설정의 `영역 그리기` — 그린 영역을 저장하면 영역 지정으로 바뀐다. 취소하면 아무것도 바꾸지 않는다
    drawRegion: async () => {
      const current = game?.read()?.settings.playArea.rect ?? null;
      const rect = await drawRegion({ preload: preloadFile(), html: rendererFile("region.html"), current });
      if (!rect) return { ok: false, reason: "cancelled" };
      if (!commands) return { ok: false, reason: "not-ready" };
      const reply = await commands.dispatcher.dispatch({ cmd: "settings.set", target: "playRegion", args: { value: rect }, from: "settings" });
      syncPlayArea();
      return reply;
    },
  });
};

// 상점·도감·가방은 관리 창이 맡는다. 트레이에는 창을 여는 자리만 둔다 (docs/specs/game.md "화면 구조")
const trayTemplate = () => [
  { label: t("menu.manage"), click: () => openManageWindow() },
  { type: "separator" as const },
  ...trayMenu(
    { hidden: userHidden, ghost: !!config.clickThrough },
    {
      toggleHidden,
      quit: () => app.quit(),
      toggleGhost: () => applyClickThrough(!config.clickThrough),
    },
  ),
];

// 울음소리 — 놀아주기가 성공하면 그 포켓몬의 PokeAPI 울음소리를 무대에서 한 번 낸다.
// 설정의 "알림 소리" 가 꺼져 있으면 내지 않는다. 받은 소리는 ~/.claude/pokebuddy/cries/ 에 캐시한다 (src/main/cries.ts)
let cries: Cries | null = null;
// 같은 포켓몬을 연달아 누르면 겹쳐 울지 않게 잠깐 쉰다
const cryAt = new Map<string, number>();
const CRY_GAP_MS = 1500;
async function playCry(id: string): Promise<void> {
  const at = Date.now();
  if (at - (cryAt.get(id) ?? 0) < CRY_GAP_MS) return;
  cryAt.set(id, at);
  const save = game?.read();
  const volume = save ? gainOf(save.settings, SOUND_RULES.cryMax) : 0;
  if (!save || volume <= 0) return;
  const pet = save.pets.find((p) => p.id === id);
  if (!pet) return;
  cries ??= createCries(path.join(PATHS.home, "cries"));
  const uri = await cries.get(pet.species);
  if (uri) stageWin?.sendCry(uri, volume);
}

function notifyGame(body: string): void {
  try {
    if (Notification.isSupported()) new Notification({ title: "pokebuddy", body }).show();
  } catch (e) { log?.({ notification: "failed", message: String(e) }); }
}

function runGameCommand(command: Command): void {
  void commands?.dispatcher.dispatch(command).then((result) => {
    if (!result.ok) notifyGame(t("game.failed", { reason: t(`game.reason.${result.reason}`) }));
    tray?.refresh();
    syncCoach(); // 밥 주기·놀아주기로 첫 돌봄 튜토리얼이 끝났을 수 있다
  });
}

// 포켓몬 위 우클릭 — 이름·상태 / 밥 주기·놀아주기 / 설정. 나머지 조작은 관리 창이 맡는다
function showPetMenu(id: string): void {
  const p = stage?.petOf(id);
  if (!p || !stageWin) return;
  const model = { name: petLabel(p), nature: p.nature ? natureName(p.nature) : null, hidden: userHidden };
  const pet = saveParty()?.save()?.pets.find((row) => row.id === id) ?? null;
  const care = pet ? { status: petStatus(pet), feed: careItem(pet, "feed"), play: careItem(pet, "play") } : {};
  const built = petMenu({ ...model, ...care }, {
    toggleHidden, quit: () => app.quit(),
    feed: () => runGameCommand({ cmd: "feed", target: id, from: "menu" }),
    play: () => runGameCommand({ cmd: "play", target: id, from: "menu" }),
    ...(pet ? { ball: () => runGameCommand({ cmd: "party.hide", target: id, from: "menu" }) } : {}),
  });
  if (pet) built.splice(built.length - 2, 0,
    { type: "separator" as const },
    { label: t("menu.manage"), click: () => openManageWindow() },
  );
  // 첫 돌봄 튜토리얼 중이면 2/2 로 넘기고 밥 주기만 누르게 둔다. 밥 주기를 못 하는 때(쿨타임·배부름)는 놀아주기를 대신 남긴다
  const save = game?.read();
  const firstCare = save ? currentTutorial(save)?.id === "first-care" : false;
  let items = built;
  if (firstCare && pet) {
    const keep = care.feed?.enabled ? t("menu.feed") : care.play?.enabled ? t("menu.play") : null;
    items = lockExcept(built, keep ? [keep] : []);
    if (keep && firstCareMenu !== keep) {
      firstCareMenu = keep;
      syncCoach();
    }
  }
  // OS 기본 메뉴는 Windows 에서 왼쪽을 크게 비운다 — 앱이 그리는 메뉴를 커서 자리에 띄운다 (docs/specs/ui-components.md C-21)
  // 첫 돌봄 중이면 메뉴 자리를 말풍선에 알려 겹치지 않게 한다. 메뉴가 닫히면 말풍선은 제자리로 돌아간다
  const avoid = firstCare && pet
    ? {
        onPlaced: (r: { x: number; y: number; w: number; h: number }) => {
          const s = stageWin?.stage();
          firstCareAvoid = s ? { x: r.x - s.x, y: r.y - s.y, w: r.w, h: r.h } : undefined;
          syncCoach();
        },
        onClosed: () => {
          firstCareAvoid = undefined;
          syncCoach();
        },
      }
    : {};
  popupMenu({ preload: preloadFile(), html: rendererFile("menu.html"), ...avoid }, items, t("menu.on"));
}

// 파티 목록 → 무대. 그림을 받는 동안 기다린다. 트레이는 공식 앱 로고를 유지한다
// 친구 교환 세션 — 저장을 쓰는 동반자(writer)일 때 처음 부를 때 만들고 한 번 시작한다(로그인 확보·반영하지 않은 교환 복구).
// 교환이 끝나 개체가 바뀌면 무대를 다시 그린다
function tradeSession(): MainTrade["session"] | null {
  if (quitting || !game || !party || !party.isWriter()) return null;
  if (!mainTrade) {
    mainTrade = createMainTrade(game, online()?.client);
    if (!mainTrade) return null;
    const screen = createTradeScreen(() => game?.read() ?? null);
    tradeScreen = screen;
    let lastReceived: string | null = null;
    mainTrade.onView((view) => {
      pushTrade(screen.build(view));
      if (mainOnline) pushAccount(mainOnline.screen()); // 교환이 걸리고 풀림에 따라 계정 탭의 막힘 안내가 바뀐다
      const got = view.received?.petId ?? null;
      if (got && got !== lastReceived) {
        lastReceived = got;
        if (party?.kind === "save") party.refresh(); // 저장을 다시 읽으면 onChange 가 무대를 다시 그린다
      }
    });
    tradeStarted = mainTrade.session.start().catch((e) => {
      console.error("교환 세션 시작 확인에 실패했다", e);
    });
  }
  return mainTrade.session;
}

// 걸린 교환이 있는가 — 열린 채널(hosting·trading)이나 반영하지 않은 교환. 있으면 로그인·로그아웃을 막는다
function tradeBlocked(): boolean {
  const phase = mainTrade?.session.view().phase;
  if (phase === "hosting" || phase === "trading") return true;
  const save = game?.read();
  return !!(save && pendingOf(save));
}

// 온라인 기능 — writer 인 동반자에서 처음 부를 때 만든다. 서버 설정이 없으면 null
function online(): MainOnline | null {
  if (quitting || !game || !party || !party.isWriter()) return null;
  if (!mainOnline) {
    mainOnline = createMainOnline({
      saveFile: PATHS.save,
      tradeBlocked,
      // 사용자가 바뀌었다 — 교환 채널은 사용자에 묶여 있으므로 교환 세션을 새로 만든다
      onUserChanged: () => {
        mainTrade?.session.stop();
        mainTrade = null;
        tradeScreen = null;
        tradeSession();
      },
      onSaveReplaced: () => {
        if (party?.kind === "save") party.refresh(); // 받은 클라우드 저장 — 무대와 설정창을 다시 그린다
      },
    });
    mainOnline?.onScreen((screen) => pushAccount(screen));
  }
  return mainOnline;
}

// 받아 둔 교환 링크로 참가한다 — 교환 세션이 있고 시작 확인이 끝난 뒤. 명령 처리(ctx.trade)에서는 부르지 않는다
// 시작 확인 중에 참가하면 busy 로 거절되고 링크가 사라진다(2026-09-27 검수 R2-01)
function flushTradeLink(): void {
  if (!tradeLink) return;
  if (Date.now() - tradeLink.at > TRADE_LINK_TTL_MS) {
    tradeLink = null;
    return;
  }
  const session = tradeSession();
  if (!session) return;
  const { link } = tradeLink;
  tradeLink = null;
  void tradeStarted
    .then(() => session.join(link))
    .then((r) => {
      // 거절(진행 중인 교환·다른 조작)은 보기에 남지 않는다 — 교환 탭 배너로 알린다
      if (!r.ok && mainTrade && tradeScreen) pushTrade({ ...tradeScreen.build(mainTrade.session.view()), error: { code: r.reason, ...(r.detail ? { detail: r.detail } : {}) } });
    });
  openManageWindow({ to: "trade" });
}

// 계정 링크 — GitHub 로그인 뒤 브라우저 쪽(src/online/github.ts callbackPage)이 여는 pokebuddy://account
function isAccountLink(arg: string): boolean {
  return /^pokebuddy:\/\/account\/?$/.test(arg);
}

// 교환 링크 — 인자 가운데 pokebuddy://trade/ 로 시작하는 것
function tradeLinkOf(argv: readonly string[]): string | null {
  return argv.find((a) => a.startsWith("pokebuddy://trade/")) ?? null;
}

// 교환 링크로 참가하고 교환 탭을 연다. 교환 세션이 아직 없으면(준비 전·reader) 생길 때 참가한다
function openTradeLink(link: string): void {
  tradeLink = { link, at: Date.now() };
  flushTradeLink();
  openManageWindow({ to: "trade" });
}

async function refreshParty(): Promise<void> {
  if (!party || !stage) return;
  await stage.setParty(party.pets());
  tray?.setIcon(logoFile(256));
  tray?.refresh();
}

// 말풍선을 보이는 시간 5초 — 2026-09-25 구현에서 정했고, 2026-09-27 사용자가 되풀이 간격만 정하고 이 값은 그대로 두었다
// (worklog/records/game-runtime/record.md "배고픔 말풍선 되풀이")
const BUBBLE_MS = 5000;
const hungerBubbles = createHungerBubbles();

// 게임 시간 — 흐른 만큼 한 번에 적용한다. 쓰기는 거래 실행기 하나가 하므로 writer 일 때만 부른다.
// 주기는 저장 주기와 같다. 주기보다 크게 벌어진 틈(앱 종료·절전)은 `game.tick` 이 버린다
// (docs/specs/game.md "복귀할 때 중단 기간을 소급 진행하지 않는다")
// 에이전트가 작업하는 동안 적립이 2배다. 작업 판정은 무대의 에이전트 상태 running 이다 (docs/specs/balance.md "에이전트 작업 보너스")
function stateTick(): void {
  if (!anchor || !stage) return;
  const { state, promptAt } = anchor.currentInfo();
  stage.setState(state, promptAt);

  const worker = saveParty();
  if (worker?.isWriter() && game && !screenLocked) {
    const now = Date.now();
    // 폴링 사이가 크게 벌어졌으면(절전·writer 가 아니던 동안) 그 틈은 작업으로 세지 않는다
    const gap = lastPollAt > 0 ? now - lastPollAt : 0;
    if (state === "running" && gap <= STATE_RULES.maxTickMs) workMs += gap;
    lastPollAt = now;
    if (now - lastTick >= STATE_RULES.saveMs) {
      lastTick = now;
      const events = game.tick({ workMs });
      if (events) workMs = 0; // 쓰지 못했으면 다음 틱에 흐른 시간과 함께 다시 넘긴다
      worker.refresh();
      // 배고픔 말풍선 — 무대에 나와 있는 포켓몬이 배고픔·매우 배고픔 구간에 들어가면 띄우고, 머무는 동안 되풀이한다 (src/main/hunger-bubble.ts).
      // 숨긴 포켓몬은 무대에 없어 띄우지 않는다. 직접 숨긴 동안에도 띄우지 않는다
      if (!userHidden) {
        const st = stage;
        const shown = (worker.save()?.pets ?? []).filter((p) => st.petOf(p.id));
        for (const b of hungerBubbles.due(shown, now)) st.say(b.id, t(b.zone === "starving" ? "bubble.starving" : "bubble.hungry"), BUBBLE_MS);
      }
      notifier?.tick(); // 부화 준비·진화 가능·업적 미수령을 배너 줄에 세운다 (src/notify)
      syncPlayArea(); // 다른 프로세스의 관리 창에서 바꾼 놀이공간도 따라간다
      syncCoach();
      const points = Math.floor(worker.save()?.points.balance ?? 0);
      if (points !== lastMenuPoints) {
        lastMenuPoints = points;
        tray?.refresh();
      }
    }
  } else {
    // writer 가 아니거나 화면이 잠겼으면 쌓지 않는다. 다시 돌면 새로 센다
    workMs = 0;
    lastPollAt = 0;
  }
  if (state !== lastState) {
    lastState = state;
    log?.({ state });
  }
}

async function main(): Promise<void> {
  if (duplicate) return; // 둘째 동반자 — 이미 quit 을 불렀다
  powerMonitor.on("lock-screen", () => {
    void mainOnline?.flush(); // 잠그기 직전 — 온라인이고 바뀌었으면 클라우드에 올린다
    screenLocked = true;
    log?.({ screen: "locked" });
  });
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
    log?.({ screen: "unlocked" });
  });
  if (process.platform === "darwin") {
    // Dock 을 숨기기 전에 로고를 한 번 — 숨기지 않는 구간(선택 창 등)이 생겨도 기본 Electron 아이콘이 아니게. 로고가 아직 없으면 건너뛴다
    const logo = logoFile(512);
    if (logo) app.dock?.setIcon(nativeImage.createFromPath(logo));
    app.dock?.hide();
  }

  // 저장을 쓰는 것은 잠금을 잡은 프로세스 하나다. 실행기에 그 조건을 걸어 reader 는 쓰지 못하게 한다
  const reader = createGame({ file: PATHS.save, canWrite: () => saveParty()?.isWriter() ?? false, onWrite: () => mainOnline?.noteSaved() });
  game = reader;
  bannerWin = createBannerWindow({
    preload: preloadFile(),
    html: rendererFile("banner.html"),
    chime: () => {
      const s = reader.read()?.settings;
      return s ? gainOf(s, SOUND_RULES.chimeMax) : 0;
    },
    onGo: (route) => openManageWindow(route),
    onDone: () => notifier?.done(),
  });
  notifier = createNotifier({ file: path.join(path.dirname(PATHS.save), "notify.json"), read: reader.read, show: (b) => bannerWin?.show(b) });
  const saveSource = createSaveParty({ game: reader, paths: PATHS, log });
  party = saveSource;

  // 수명 감시는 첫 실행 선택 창보다 먼저 — 고르는 동안 companion stop(lock 삭제)이 와도 끝나야 한다
  lifetime = createLifetime({
    lockFile: PATHS.companionLock,
    pidAlive,
    hasWindow: () => bootReady && !!stageWin?.alive(),
    quit: () => app.quit(),
  });
  lifetime.start();

  // 그림 미리 받기 — 설치 파일에 그림이 없다. 빠진 초상·도구·알 그림을 뒤에서 받아 캐시에 둔다(src/main/portraits.ts).
  // 첫 실행이면 아래 선택 창에서 고르는 동안 받는다. 관리 창은 창을 열 때 캐시를 한 번에 읽는다
  // 첫 실행이면 스타터 초상부터 받는다. 선택 창도 같은 portraits 를 써서 받는 중인 그림을 함께 기다린다
  const portraits = createPortraits(path.join(PATHS.home, "sprites"), path.join(PATHS.project, "sprites"));
  const starterList = saveSource.needsStarter() ? starters(unlockRules()) : [];
  const prefetchAt = Date.now();
  void portraits
    .prefetch(undefined, starterList)
    .then((r) => log?.({ prefetch: "done", ms: Date.now() - prefetchAt, ...r }))
    .catch((e) => log?.({ prefetch: "failed", message: String(e) }));

  // 첫 실행 — 명령에 스타터를 직접 줬으면 그걸로 바로 시작하고, 아니면 선택 창. reader 면 writer 쪽이 첫 실행을 맡는다
  if (saveSource.needsStarter()) {
    const list = starterList;
    let species: string | null = config.fromEnv.has("slug") && list.includes(config.slug) ? config.slug : null;
    if (!species) {
      species = await pickStarter({
        preload: preloadFile(),
        html: rendererFile("picker.html"),
        starters: list,
        portraits,
        onPicking: (on) => {
          picking = on;
        },
      });
    }
    if (quitting || !species) {
      reportFailure(PATHS, config.slug, t("starter.skipped"), "starter-cancelled");
      if (!quitting) app.quit();
      return;
    }
    if (!saveSource.begin(species)) {
      reportFailure(PATHS, config.slug, t("game.reason.save-failed"), "save-failed");
      app.quit();
      return;
    }
  }

  const art = createArtLoader(PATHS);
  stageWin = createStageWindow({
    debug,
    preload: preloadFile(),
    html: rendererFile("stage.html"),
    log,
    onReady: () => {
      stage?.releaseHeld(); // 렌더러가 새로 떴다 — 들고 있던 포인터도 사라졌다
      stage?.resend();
      stageWin?.resendCoach();
    },
    // 튜토리얼 말풍선의 버튼 — `다음`·`확인` 은 완료, ✕ 는 스킵
    onCoachAction: ({ id, action }) => {
      if (id === "first-care") firstCareMenu = null;
      void commands?.dispatcher
        .dispatch({ cmd: action === "done" ? "tutorial.done" : "tutorial.skip", target: id, args: { steps: 1 }, from: "pet" })
        .then(() => syncCoach());
    },
    onHit: (id) => stage?.hit(id),
    onPointer: (msg) => stage?.pointer(msg),
    onGone: () => stage?.releaseHeld(),
    onHidden: () => stage?.releaseHeld(),
  });
  staged = true;

  stage = createStage({
    buddyMode: config.buddy,
    timeScale: runtime.buddyTimeScale,
    window: stageWin,
    art,
    ghost: () => !!config.clickThrough,
    cursor: () => {
      const rect = stageWin?.stage();
      if (!rect || !stageWin?.isVisible()) return null;
      const p = screen.getCursorScreenPoint();
      const x = p.x - rect.x, y = p.y - rect.y;
      return x >= 0 && y >= 0 && x <= rect.w && y <= rect.h ? { x, y } : null;
    },
    onDrop: (id, home) => {
      void commands?.dispatcher.dispatch({ cmd: "pet.set", target: id, args: { home }, from: "pet" }).then(async (result) => {
        if (result.ok) return;
        log?.({ drop: "failed", id, reason: result.reason });
        await refreshParty();
      });
    },
    // 클릭은 놀아주기 (src/main/commands.ts). 울음소리는 놀아주기가 쿨타임이어도 클릭할 때마다 낸다 — 반응을 들려준다
    onClick: (id) => {
      void commands?.click(id);
      void playCry(id);
    },
    onMenu: showPetMenu,
    onArtMissing: (pet) => {
      // PMD 를 못 받았다 — 대개 없는 이름이거나 네트워크가 막혔다. 무대에 나오지 않고 이유만 남긴다
      process.stderr.write(`${pet.species}: PMD 그림을 받지 못함 — 무대에 나오지 않는다 (네트워크·프록시 확인)\n`);
      reportFailure(PATHS, pet.look, `${pet.look} 그림을 받지 못함 — 네트워크(프록시)를 확인하거나 다른 펫 이름으로 시도`);
    },
    log,
  });

  anchor = createAnchor({
    paths: PATHS,
    self: SELF,
    host: {
      platform: process.platform,
      now: Date.now,
      toDip,
      offScreen,
      workArea: workAreaTarget,
      quit: () => app.quit(),
      quitting: () => quitting,
    },
    flags: () => ({ userHidden, held: stage?.heldId() != null }),
    onUpdate: onAnchorUpdate,
    onFocus: (key) => stage?.focus(key),
    log,
  });

  commands = createCommands({
    mailboxDir: PATHS.mailbox,
    party: saveSource,
    game: reader,
    prepareLook: async (look) => !!await art.loadLook(look),
    onChanged: async (evolvedId) => {
      await refreshParty();
      if (evolvedId) stage?.celebrate(evolvedId);
    },
    stage: {
      poke: (id) => !!stage?.poke(id),
      care: (id, action) => {
        stage?.care(id, action);
        if (action === "play") void playCry(id); // 메뉴·관리 창에서 고른 놀아주기
      },
      petIds: () => stage?.petIds() ?? [],
      size: () => stageWin?.size() ?? { w: 0, h: 0 },
      visible: () => !!stageWin?.isVisible(),
    },
    settings: {
      hidden: () => userHidden,
      setHidden,
      clickThrough: () => !!config.clickThrough,
      setClickThrough: (on) => applyClickThrough(on),
    },
    quit: () => app.quit(),
    log,
    trade: tradeSession,
    tradeScreen: () => (mainTrade && tradeScreen ? tradeScreen.build(mainTrade.session.view()) : null),
  });
  saveSource.onRole((w) => {
    commands?.setWriter(w);
    // writer 가 되면 반영하지 않은 교환을 이어 간다. writer 를 놓으면 교환도 멈춘다 — 저장을 쓸 수 없다
    if (w) {
      void online()?.start();
      tradeSession();
      flushTradeLink();
    } else {
      mainTrade?.session.stop();
      mainTrade = null;
      tradeScreen = null;
      mainOnline?.dispose();
      mainOnline = null;
    }
  });
  commands.setWriter(saveSource.isWriter());
  saveSource.onChange(() => {
    void refreshParty().then(syncCoach); // 무대에 나온 마리가 바뀌면 첫 돌봄이 밝힐 마리도 바뀐다
  });

  await refreshParty();
  if (quitting) return;
  if (saveSource.pets().length && !stage.petIds().length) {
    // 나올 마리가 있는데 하나도 그림을 못 받았다 — 실패로 끝낸다. pokebuddy 가 종료 코드를 보고 "펫이 뜨지 못함"을 알린다
    process.stderr.write(`펫 그림을 찾을 수 없음: ${saveSource.pets().map((p) => p.look).join(", ")}\n`);
    app.exit(3);
    return;
  }
  clearFailure(PATHS, config.slug);

  if (!lifetime.claim()) {
    // 살아 있는 다른 동반자가 lock 을 쥐고 있다 — 이쪽이 물러난다
    process.stderr.write("동반자가 이미 떠 있음 — 이 프로세스는 끝낸다\n");
    app.quit();
    return;
  }
  void online()?.start(); // 로그인한 채 켰으면 클라우드 저장을 시작한다 — 교환보다 먼저 만들어 같은 클라이언트를 나눠 쓴다
  tradeSession(); // 동반자 writer 면 교환 세션을 시작한다 — 반영하지 않은 교환이 있으면 이어 간다
  flushTradeLink(); // 링크로 켜졌거나 준비 전에 링크를 받았다

  tray = createTray({
    icon: logoFile(256),
    tooltip: t("tray.title", { name: displayName() }),
    template: trayTemplate,
    popup: () => popupMenu({ preload: preloadFile(), html: rendererFile("menu.html") }, trayTemplate(), t("menu.on")),
  });

  applyClickThrough(!!config.clickThrough);
  syncLoginItem();
  syncPlayArea();
  syncCoach();
  bootReady = true;
  lifetime.check(); // 창이 생겼으니 lock 파일에 ready 를 적는다 — pokebuddy companion 이 이걸 보고 기다림을 끝낸다

  intervals.push(setInterval(stateTick, STAGE_RULES.statePollMs));
  intervals.push(setInterval(() => stage?.tick(), STAGE_RULES.tickMs));
  anchor.start();
  log?.({ boot: "companion", pets: stage.petIds(), writer: saveSource.isWriter(), stageHtml: fs.existsSync(rendererFile("stage.html")) });
}

app
  .whenReady()
  .then(main)
  .catch((e: unknown) => {
    console.error(e);
    reportFailure(PATHS, config.slug, `기동 실패 — ${e instanceof Error ? e.message : String(e)}`);
    app.exit(1);
  });

// 밖에서 끝내라는 신호 (kill 등) — 정리하고 끝낸다
process.on("SIGTERM", () => app.quit());
process.on("SIGINT", () => app.quit());

// 창을 닫기 전에 온다 — 주기 작업·감시·헬퍼를 먼저 멈춘다 (quitting 설명 참고).
// 창이 따로 닫혀 끝나는 경로(window-all-closed → app.quit)도 이곳을 지난다
app.on("before-quit", (e) => {
  // 끄기 전에 클라우드 저장을 한 번 올린다 — 최대 3초. 실패해도 끄기를 막지 않는다(다음 실행에서 올린다)
  if (mainOnline && !onlineFlushed && mainOnline.cloud.unsaved() === "dirty") {
    e.preventDefault();
    onlineFlushed = true;
    void mainOnline.flush().finally(() => app.quit());
    return;
  }
  quitting = true;
  for (const id of intervals) clearInterval(id);
  anchor?.stop(); // 헬퍼도 멈춘다
  lifetime?.stop();
  tray?.destroy();
  tray = null;
  commands?.stop();
  mainTrade?.session.stop();
  mainTrade = null;
  tradeScreen = null;
  mainOnline?.dispose();
  mainOnline = null;
  bannerWin?.close();
  bannerWin = null;
  party?.stop(); // 저장 잠금을 놓는다
});

app.on("will-quit", () => {
  lifetime?.release(); // 내 lock 을 지운다
});

// 첫 실행 선택 창은 무대 창보다 먼저 열리고 닫힌다 — 그때는 끝내지 않는다 (main 이 이어서 무대 창을 만든다)
app.on("window-all-closed", () => {
  if (!picking && staged) app.quit();
});
