// 펫 오버레이 메인 프로세스 — 기동 · 단일 인스턴스 · 종료 순서. 얇게 — 배선만 (옛 main.js 1398줄을 역할별 파일로 나눈 뒤 남은 것)
// 동반자 하나로 돈다 — 기기당 하나, 항상 위. 놀이공간(화면 전체·영역)에 머물고, 맨 앞 터미널 창의 에이전트 상태를 따른다 (follow/front).
// 트레이로 끝낸다. 세션 펫·창 펫 모드는 2026-09-27 에 지웠다 (worklog/records/game-runtime/record.md "세션·창 모드 삭제")
// 설정·경로는 config.js에서 읽음. 육성과 해금은 writer만 갱신
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, nativeImage, powerMonitor, screen, shell, Notification } from "electron";
import { starters, unlockRules } from "../dex/unlocks";
import { appearanceOf } from "../dex/appearance";
import type { HelperWindow, SelfMark } from "../follow/types";
import { pidAlive } from "../save/writer";
import { createAnchor, type Anchor, type AnchorUpdate } from "./anchor";
import { createArtLoader } from "./art";
import { createCommands, type Commands } from "./commands";
import { STAGE_RULES, playLanes, type PlayLane } from "./layout";
import { createScreenPicker, currentScreens, screenViews, type ScreenPicker } from "./screen-picker";
import { clearFailure, createLifetime, reportFailure, type Lifetime } from "./lifetime";
import { lockExcept, petMenu, trayMenu } from "./menus";
import { createSaveParty, type PartyPet, type SaveParty } from "./save-party";
import { createGame, type GameV3 } from "./game";
import { createMainTrade, isDevRun, type MainTrade } from "./trade";
import { createTradeScreen, type TradeScreenBuilder } from "./trade-screen";
import { createMainOnline, type MainOnline } from "./online";
import { askBlocked, askConfirm, showKicked } from "./halt-dialog";
import type { HaltInfo, HaltReason } from "../online/cloud.js";
import { createMainMail, type MainMail } from "./mail";
import { codeOf } from "../trade/net.js";
import { pendingOf } from "../trade/core";
import { careItem, careState, petStatus } from "./status";
import { openManage, pushAccount, pushClock, pushMail, pushTrade, pushUpdate } from "./manage-window";
import { createAppUpdater, type AppUpdater } from "./updater";
import { createMacUpdater } from "./mac-updater";
import { createPatchNotes, type PatchNotes } from "./patch-notes";
import { createPortraits, type Portraits } from "./portraits";
import { CLOCK_RULES, createClock, type ClockTick } from "./clock";
import { drawRegion } from "./region-window";
import { createBannerWindow, type BannerWindow } from "./banner-window";
import { PATHS, PROJECT, loadConfig, logoFile, preloadFile, rendererFile } from "./paths";
import { pickStarter } from "./picker-window";
import { createStage } from "./stage";
import { createStageGroup, type StageGroup } from "./stage-group";
import { createStageWindow } from "./stage-window";
import { langOf, natureName, petLabel, petName, setLang, t } from "./text";
import { createTray, type TrayHandle } from "./tray";
import { careArgOf, syncJumpList } from "./jump-list";
import { closeMenu, closedWithin, menuBounds, menuOpen, popupMenu } from "./menu-window";
import { createCries, type Cries } from "./cries";
import { createHungerBubbles } from "./hunger-bubble";
import { SOUND_RULES, gainOf } from "../state/settings";
import { STATE_RULES } from "../state/rules";
import { createNotifier, type Notifier } from "../notify/notifier";
import { rollHits } from "../find/core";
import type { FindRecordV3 } from "../shared/save-v3";
import { createHookUpkeep, type HookUpkeep } from "./hook-upkeep";
import type { MailAction, ManageRoute, PatchNotesView, UpdateAction, UpdateView } from "../shared/manage";
import type { Command } from "../shared/types";
import type { SaveV3 } from "../shared/save-v3";
import type { CoachView } from "../shared/stage";
import { currentTutorial } from "../tutorial/core";

// 에이전트 작업 시간 — 1초 틱마다 running 이던 만큼 쌓아 두고, 게임 틱에 넘기고 비운다
let workMs = 0;
// 전역 시계 — 1초마다 틱을 낸다 (src/main/clock.ts)
const clock = createClock({ onError: (e) => log?.({ clock: "error", message: String(e) }) });
// 그림 캐시 — 관리 창·선택 창과 무대 말풍선 아이콘이 함께 쓴다 (src/main/portraits.ts). main() 에서 만든다
let portraits: Portraits | null = null;
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

// 작업 표시줄·점프 목록이 설치본 바로 가기(scripts/build-exe.cjs appId)와 같은 앱으로 묶이게 — 앱 이름 줄이 "PokeBuddy" 로 보인다
// 업데이트 실기 시험 빌드(scripts/build-exe.cjs PB_UPDATE_TEST)는 다른 ID 를 쓰고, 사용자의 설치본이 가진 OS 등록(링크·로그인 시 시작)을 건드리지 않는다
const updateTestBuild = app.isPackaged && fs.existsSync(path.join(PROJECT, "update-test.json"));
// 시험 빌드는 로그인 키체인을 쓰지 않는다 — safeStorage(src/main/trade.ts)가 키를 만들며 키체인 대화상자를 띄운다
// (2026-09-28 mac 업데이트 실기 시험에서 "…Key 를 저장할 키체인을 찾을 수 없습니다" 가 뜸). 업데이트 도우미가 open 으로 다시 켤 때도 적용되게 앱이 스스로 켠다
if (updateTestBuild) app.commandLine.appendSwitch("use-mock-keychain");
if (process.platform === "win32") app.setAppUserModelId(updateTestBuild ? "io.github.milklotion.pokebuddy.updatetest" : "io.github.milklotion.pokebuddy");

// 동반자는 기기당 하나 — pokebuddy companion 이 lock 파일로 먼저 가리지만 동시에 두 번 치면 둘 다 통과한다.
// 둘째는 창을 만들기 전에 끝난다
const duplicate = !app.requestSingleInstanceLock();
if (duplicate) app.quit();
// 떠 있는 동반자를 다시 실행했다(설치한 앱의 바로가기를 한 번 더 누름 등) — 새로 띄우지 않고 관리 창을 연다.
// 교환 링크(pokebuddy://trade/<토큰>)로 실행했으면 그 교환에 참가하고 교환 모달을 연다
else {
  app.on("second-instance", (_e, argv) => {
    // 작업 표시줄 점프 목록의 밥 주기·놀아주기 — 창을 열지 않고 명령만 돌린다 (src/main/jump-list.ts)
    const care = careArgOf(argv);
    if (care) return runGameCommand({ cmd: care.action, target: care.petId, from: "menu" });
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
  if (app.isPackaged && !updateTestBuild) app.setAsDefaultProtocolClient("pokebuddy");
}

// 로그인 시 시작 — 설정 값을 OS 에 적용한다. 설치한 앱에서만 한다.
// 저장소의 `electron .` 을 등록하면 다음 로그인 때 앱 없는 빈 Electron 이 뜨기 때문이다
let loginItem: boolean | null = null;
function syncLoginItem(): void {
  if (!app.isPackaged || updateTestBuild || !game) return;
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
let hookUpkeep: HookUpkeep | null = null; // 켤 때 훅 정리와 Codex 창 깜빡임 한 번 알림 — writer 만 (src/main/hook-upkeep.ts)
let bannerWin: BannerWindow | null = null;
let party: SaveParty | null = null;
const saveParty = (): SaveParty | null => party;
let lifetime: Lifetime | null = null;
// 무대 — 화면마다 무대 창과 마리 움직임 한 쌍. 한 화면·영역 지정이면 한 쌍이다 (src/main/stage-group.ts)
let stages: StageGroup | null = null;
let anchor: Anchor | null = null;
let commands: Commands | null = null;
let mainTrade: MainTrade | null = null; // 친구 교환 — writer 인 동반자만 가진다 (worklog/records/trade/record.md)
let tradeScreen: TradeScreenBuilder | null = null; // 교환 모달이 그리는 값
let mainMail: MainMail | null = null; // 우편함 — 온라인 기능과 같은 클라이언트를 쓴다 (src/main/mail.ts)
let mainOnline: MainOnline | null = null; // 공유 Supabase 클라이언트·계정·클라우드 저장 — writer 인 동반자만 가진다
// 끄기 전 클라우드 정리 — 올리고 released 를 알린 뒤 클라우드를 멈춘다. 사용자가 끄는 일반 종료(before-quit)만 부른다
let onlineReleased: Promise<void> | null = null;
// 세션 종료(Windows 로그오프·mac 끄기·업데이트 설치) 직전의 알림 — 올리고 released 만 알린다. 클라우드는 멈추지 않는다.
// 끄기가 취소되어 앱이 계속 돌면 다음 하트비트가 active 로 되돌린다. 진행 중인 약속만 들고 있다 — 다음 세션 종료는 다시 알린다
let onlineAnnounce: Promise<void> | null = null;
// 두 PC 규칙으로 게임을 멈췄다 (worklog-mac/records/cloud-authority/design-p1.md 3절)
//   superseded  다른 PC 에 밀려났다 — 안내 뒤 종료. 로그아웃하지 않는다(D19)
//   confirm     연결 끊긴 다른 PC 를 넘겨받을지 묻는 중(G2) — 창이 떠 있는 동안 진행을 멈춘다(D22)
//   blocked     교환이 걸려 넘겨받지 못했다 — 다시 시도하거나 종료
// 멈춘 동안 저장을 쓰지 않고(canWrite), 시계 틱·교환·우편·mailbox 명령을 돌리지 않는다
let halted: HaltReason | null = null;
let haltNext: { reason: "confirm" | "blocked"; info: HaltInfo } | null = null; // 다음에 물을 확인·막힘
let haltAsking = false; // 확인·막힘 창을 묻는 흐름이 돌고 있다
let haltAbort: AbortController | null = null; // 떠 있는 확인·막힘 창 — 밀려나면 닫는다
// 멈춘 동안에도 받는 명령 — 저장을 바꾸지 않는다(읽기·무대 반응·끄기)
const HALT_OPEN: ReadonlySet<string> = new Set(["snapshot", "trade.status", "poke", "quit"]);
let tradeStarted: Promise<void> = Promise.resolve(); // 교환 세션의 시작 확인 — 끝나기 전의 참가는 busy 로 거절된다
// 아직 참가하지 않은 교환 링크와 받은 시각. 링크로 처음 켜졌으면 인자에 있다. 링크 수명(참가 전 10분)이 지나면 버린다
const TRADE_LINK_TTL_MS = 10 * 60_000;
const firstLink = tradeLinkOf(process.argv);
let tradeLink: { link: string; at: number } | null = firstLink ? { link: firstLink, at: Date.now() } : null;
let tray: TrayHandle | null = null;
// 패치노트 — 켤 때 저장이 이미 있었는지로 새로 설치와 업데이트를 가른다. 그래서 첫 선택 창이 저장을 만들기 전에 만든다
const hadSave = fs.existsSync(PATHS.save);
let patchNotes: PatchNotes | null = null;
let updater: AppUpdater | null = null; // 앱 업데이트 — 설치본(Windows exe·mac 앱)만 확인한다. 개발 실행·npm 설치본은 버전만 (src/main/updater.ts)
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
    const cur = stages?.firstRect();
    display = cur ? screen.getDisplayMatching({ x: cur.x, y: cur.y, width: cur.w, height: cur.h }) : screen.getPrimaryDisplay();
  } catch {
    display = screen.getPrimaryDisplay();
  }
  const a = display.workArea;
  return { id: -1, pid: 0, app: "", x: a.x, y: a.y, w: a.width, h: a.height, fake: true };
}

// ── 배선 ─────────────────────────────────────────────────────────────────────

// 동반자의 놀이공간 — 설정의 `모든 화면 | 한 화면 | 영역 지정`. 터미널 창 대신 이 사각형을 따라가는 창으로 삼는다
// (2026-09-25 사용자 선택, 2026-09-28 여러 화면). 저장을 매 폴링마다 읽지 않는다. 게임 틱과 관리 창의 설정 변경 뒤에 다시 읽는다
let playArea: SaveV3["settings"]["playArea"] = { mode: "screen", rect: null, screen: null };
function syncPlayArea(): void {
  if (!game) return;
  const next = game.read()?.settings.playArea;
  if (!next || JSON.stringify(next) === JSON.stringify(playArea)) return;
  playArea = JSON.parse(JSON.stringify(next)) as SaveV3["settings"]["playArea"];
  anchor?.poll(); // 무대 사각형을 바로 다시 정한다
}

// 설정 `잠들기 기준`(분) — 무대가 틱마다 이 값을 보고 모든 마리에 넣는다 (src/main/stage.ts sleepAfterMin). 0 은 잠들지 않음, null 은 규칙표 기본값.
// 놀이공간과 같이 저장을 매 폴링마다 읽지 않는다. 관리 창의 설정 변경·저장 변경 알림·게임 틱(느린 주기) 뒤에 다시 읽는다
let sleepAfterMin: number | null = null;
function syncSleep(): void {
  const next = game?.read()?.settings.sleepAfterMin;
  if (typeof next === "number") sleepAfterMin = next; // 저장을 못 읽었으면 지난 값을 그대로 쓴다
}

const lanesNow = (): PlayLane[] => playLanes(playArea, currentScreens());

// 놀이공간 화면 번호 덮개 — 설정의 한 화면 목록이 열린 동안 번호를 보이고, `화면에서 고르기` 로 누른 화면을 고른다
let screenPicker: ScreenPicker | null = null;
const picker = (): ScreenPicker => (screenPicker ??= createScreenPicker({ preload: preloadFile(), html: rendererFile("screens.html"), screens: currentScreens }));

// 바탕화면 튜토리얼 — 대기열 맨 앞이 바탕화면 것이면 무대에 말풍선을 보낸다 (src/tutorial/core.ts, docs/specs/game.md "코치마크")
// 저장을 새로 읽는 때(게임 틱·명령 뒤·파티 변경)에 부른다. 같은 값이면 무대 창이 다시 보내지 않는다
function syncCoach(): void {
  if (!game || !stages) return;
  const save = game.read();
  const now = save ? currentTutorial(save) : null;
  // 고스트 모드·숨김 중에는 띄우지 않고 기다린다 — 말풍선의 ✕ 도 못 누르는 상태를 만들지 않는다 (2026-09-28 튜토리얼 입력 규칙)
  const quiet = !!config.clickThrough || userHidden;
  const view = now && now.surface === "stage" && save && !quiet ? coachView(now.id, save.starterPetId) : null;
  coachShown = view;
  // 첫 돌봄 동안 밝힌 포켓몬을 세운다 — 걸으면 말풍선이 따라 움직인다 (2026-09-27 사용자 피드백)
  stages.pin(view?.kind === "pet" ? view.petId ?? null : null);
  stages.sendCoach(view);
}

// 첫 돌봄의 단계 — 1/2 우클릭 유도, 포켓몬 메뉴가 열리면 2/2 메뉴에서 밥 주기 (2026-09-27 사용자 결정 "시안대로 진행", Figma `579:16959`).
// 값은 메뉴에 남긴 항목의 이름이다. 새 개체는 배부른 채 시작해 밥 주기가 막혀 있으므로 대개 놀아주기다.
// 저장에 두지 않는다 — 앱을 다시 켜면 1/2 부터 다시 보인다
let firstCareMenu: string | null = null;
// 무대에 떠 있는 바탕화면 말풍선 — 떠 있는 동안 포켓몬 왼쪽 클릭은 놀아주기가 아니다
let coachShown: CoachView | null = null;
// 첫 돌봄 2/2 에서 밥 주기·놀아주기가 둘 다 쉬는 중이면 기다리는 문구와 남은 시간을 보인다
let firstCareWait: string | null = null;

// 작업 표시줄 점프 목록 — 파티 포켓몬마다 밥 주기·놀아주기. 파티·이름·레벨이 바뀌면 다시 만든다 (src/main/jump-list.ts)
function syncJump(): void {
  const save = game?.read(); // 메모리 값 — 파일은 15초마다 쓴다
  if (!save) return;
  const pets = save.party.slots
    .map((slot) => (slot.state === "pokemon" ? save.pets.find((p) => p.id === slot.petId) : undefined))
    .filter((p): p is NonNullable<typeof p> => p != null)
    .map((p) => ({ id: p.id, name: petName(p.species), level: p.level }));
  syncJumpList(pets, { feed: t("menu.feed"), play: t("menu.play") });
}

// 트레이 메뉴 — Windows 는 포커스를 쥐지 않게 띄운다(숨겨진 아이콘 창이 닫히지 않게). 바깥 클릭·Esc 는 헬퍼의 입력 감시로 닫는다.
// 떠 있는 동안만 헬퍼를 자주(50ms) 묻는다. 기준 수는 띄운 뒤 첫 답이다 — 메뉴를 연 그 클릭은 세지 않는다
const TRAY_INPUT_MS = 50;
let trayInputBase: { click: number; esc: number } | null = null;
let trayInputTimer: NodeJS.Timeout | null = null;
// 아이콘을 다시 눌러 메뉴를 닫은 때 — 메뉴가 떠 있는 동안에는 아이콘 클릭 신호가 오지 않아 Windows 가 더블클릭을 만들지 못한다.
// 이 뒤 DOUBLE_CLICK_MS 안에 아이콘을 한 번 더 누르면 더블클릭으로 보고 설정창을 연다
const DOUBLE_CLICK_MS = 200; // 2026-09-28 사용자 "0.2초로 해도 될듯"
let iconClosed: { at: number; click: number } | null = null;

const stopTrayInput = (): void => {
  if (trayInputTimer) clearInterval(trayInputTimer);
  trayInputTimer = null;
  iconClosed = null;
};

function popupTrayMenu(): void {
  const inactive = process.platform === "win32";
  trayInputBase = null;
  popupMenu(
    {
      preload: preloadFile(),
      html: rendererFile("menu.html"),
      inactive,
      onClosed: () => {
        if (!iconClosed) stopTrayInput(); // 아이콘으로 닫았으면 더블클릭을 볼 동안 더 묻는다
      },
    },
    trayTemplate(),
    t("menu.on"),
  );
  if (inactive && !trayInputTimer) trayInputTimer = setInterval(() => anchor?.poll(), TRAY_INPUT_MS);
}

function onTrayInput(input: { click: number; x: number; y: number; esc: number }): void {
  if (!trayInputTimer) return;
  const at = screen.screenToDipPoint({ x: input.x, y: input.y });
  const icon = tray?.bounds();
  const onIcon = !!icon && icon.width > 0 && at.x >= icon.x && at.x < icon.x + icon.width && at.y >= icon.y && at.y < icon.y + icon.height;
  if (iconClosed) {
    const late = Date.now() - iconClosed.at > DOUBLE_CLICK_MS;
    const again = input.click > iconClosed.click && onIcon;
    if (again && !late) {
      stopTrayInput();
      tray?.holdClick(DOUBLE_CLICK_MS); // 뒤따라 오는 아이콘 클릭 신호로 메뉴가 다시 뜨지 않게
      openManageWindow();
    } else if (late) stopTrayInput();
    return;
  }
  if (!menuOpen()) return;
  if (!trayInputBase) {
    trayInputBase = { click: input.click, esc: input.esc };
    return;
  }
  if (input.esc !== trayInputBase.esc) return closeMenu();
  if (input.click === trayInputBase.click) return;
  trayInputBase.click = input.click;
  // 트레이 아이콘을 다시 누른 것 — 메뉴가 아이콘 위에 걸쳐 떠도 닫는다(메뉴가 떠 있는 동안 아이콘 클릭 신호는 오지 않는다)
  if (onIcon) {
    iconClosed = { at: Date.now(), click: input.click };
    return closeMenu();
  }
  // 메뉴 안을 누른 것은 메뉴가 처리한다(항목 고르기). 바깥이면 닫는다 — 테두리에 걸친 점(메뉴가 붙은 아이콘 자리)은 바깥이다
  const b = menuBounds();
  if (b && at.x > b.x && at.x < b.x + b.width - 1 && at.y > b.y && at.y < b.y + b.height - 1) return;
  closeMenu();
}
let firstCareAvoid: CoachView["avoid"] = undefined; // 열린 메뉴의 자리(무대 좌표) — 말풍선이 피한다

function coachView(id: string, starterPetId: string | null): CoachView | null {
  const waitStep = id === "first-care" && firstCareWait != null;
  const menuStep = id === "first-care" && (firstCareMenu != null || waitStep);
  const key = waitStep ? `coach.${id}.wait` : menuStep ? `coach.${id}.menu` : `coach.${id}`;
  const total = id === "first-care" ? 2 : 1;
  const name = t(`coach.${id}.name`);
  const step = total === 1 ? t("coach.step.single", { name }) : t("coach.step", { name, at: menuStep ? 2 : 1, total }); // 한 단계뿐이면 "1 / 1" 을 붙이지 않는다
  const base = { id, step, title: t(`${key}.title`, { action: firstCareMenu ?? "" }), body: t(`${key}.body`, { when: firstCareWait ?? "" }), button: t(`coach.${id}.button`) };
  if (id === "playground") return { ...base, kind: "area", areaLabel: t(`coach.area.${playArea.mode}`) };
  // 첫 돌봄은 첫 포켓몬을 밝힌다. 무대에 없으면(숨김) 나와 있는 첫 마리. 아무도 없으면 기다린다
  const ids = stages?.petIds() ?? [];
  const petId = starterPetId && ids.includes(starterPetId) ? starterPetId : ids[0];
  // 쉬는 중 단계는 할 수 있는 행동이 없다 — 클릭을 막지 않고 말풍선만 받는다(passive)
  return petId ? { ...base, kind: "pet", petId, ...(waitStep ? { passive: true } : {}), ...(id === "first-care" && firstCareAvoid ? { avoid: firstCareAvoid } : {}) } : null;
}

// 무대 사각형 = 놀이공간 ∩ 그 화면. 모든 화면이면 화면마다 하나. 바뀔 때만 setBounds (stage-window 가 가른다)
// 동반자는 따라갈 창 대신 놀이공간을 쓴다. 보일지는 앵커가 정한 그대로다
function onAnchorUpdate(update: AnchorUpdate): void {
  if (quitting || !stages) return;
  stages.layout(lanesNow(), playArea.mode === "all");
  stages.setVisible(update.visible);
}

// 클릭 통과는 이번 실행에만 둔다 — config.json 에 쓰지 않는다
function applyClickThrough(on: boolean): void {
  config.clickThrough = on;
  // 들고 있는 중에 클릭 통과를 켜면 pointerup 이 영영 안 온다 — 커서에 붙은 채로 남지 않게 놓는다
  if (on) stages?.releaseHeld();
  // 무대는 늘 통과로 시작해 그림 위에서만 받는다 — 커서 밑은 다음 hoverTick 이 본다
  stages?.setPassing(true);
  stages?.sendClickThrough(on);
  tray?.refresh();
  syncCoach(); // 고스트 모드 동안 바탕화면 튜토리얼은 기다린다
}

// 직접 숨기기·보이기 — 폴링이 되돌리지 않도록 상태로 남긴다 (우클릭 · 트레이 · 설정)
function setHidden(on: boolean): void {
  userHidden = on;
  anchor?.poll();
  tray?.refresh();
  syncCoach(); // 숨긴 동안 바탕화면 튜토리얼은 기다린다
}
const toggleHidden = (): void => setHidden(!userHidden);

const firstPet = (): PartyPet | null => {
  const id = stages?.petIds()[0];
  return id ? (stages?.petOf(id) ?? null) : null;
};
const displayName = (): string => {
  const p = firstPet();
  return p ? petLabel(p) : party?.pets()[0]?.species ?? config.slug;
};

// 앱 업데이트를 켠다 — 수명 잠금을 쥔 동반자 하나만. 상태가 바뀌면 관리 창에 밀어 보낸다
function startUpdater(): void {
  if (updater) return;
  patchNotes ??= createPatchNotes({
    notesFile: path.join(PROJECT, "data", "patch-notes.json"),
    seenFile: path.join(path.dirname(PATHS.save), "notes-seen.json"),
    version: app.getVersion(),
    hadSave,
    autoShow: app.isPackaged, // 개발 실행·E2E 는 띄우지 않는다 — 관리 창 조작을 가린다
  });
  const installed = app.isPackaged && (process.platform === "win32" || process.platform === "darwin");
  updater = createAppUpdater({
    version: app.getVersion(),
    enabled: installed,
    // mac 은 자체 엔진 — Squirrel.Mac 은 정식 서명이 없는 앱을 바꾸지 않는다 (src/main/mac-updater.ts). Windows 는 electron-updater
    ...(installed && process.platform === "darwin"
      ? {
          updater: createMacUpdater({
            version: app.getVersion(),
            resourcesPath: process.resourcesPath,
            exePath: app.getPath("exe"),
            arch: process.arch,
            home: os.homedir(),
            pid: process.pid,
            quit: () => app.quit(),
            onWillQuit: (fn) => app.on("will-quit", fn),
            openExternal: (url) => void shell.openExternal(url),
          }),
        }
      : {}),
    onView: (view) => pushUpdate(view),
    // 다시 시작 전 — 메모리 진행을 쓰고 클라우드에 올린 뒤 released 를 알린다(최대 3초). 클라우드는 멈추지 않는다 —
    // 설치가 실패해 앱이 계속 돌면 다음 하트비트가 active 로 되돌린다. 이어지는 before-quit 은 기다리지 않는다
    beforeInstall: async () => {
      if (!halted && saveParty()?.isWriter()) game?.flush();
      await announceOnline();
    },
  });
}

// 패치노트 요청 — 목록 읽기, 안 본 노트를 띄웠다는 알림
function notesAct(action: "list" | "seen"): PatchNotesView {
  if (!patchNotes) return { notes: [], unseen: null };
  if (action === "seen") patchNotes.markSeen();
  return patchNotes.view();
}

// 설정 바닥의 업데이트 요청 — 읽기·다시 확인·다시 시작
async function updateAct(action: UpdateAction): Promise<UpdateView> {
  if (!updater) throw new Error("updater not started");
  if (action === "check") await updater.check();
  else if (action === "install") await updater.install();
  return updater.view();
}

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
        syncSleep();
      }
      syncCoach();
      return reply;
    },
    display: () => ({ hidden: userHidden, clickThrough: !!config.clickThrough }),
    ...(mainOnline ? { account: mainOnline.act } : {}),
    ...(mailBox() ? { mail: async (req: MailAction) => (await mailBox()?.act(req)) ?? null } : {}),
    ...(updater ? { update: updateAct } : {}),
    ...(patchNotes ? { notes: notesAct } : {}),
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
    // 설정의 한 화면 — 목록, 목록이 열린 동안 번호 덮개, `화면에서 고르기`. 고른 화면을 저장하면 한 화면 방식이 된다
    screens: () => screenViews(currentScreens(), game?.read()?.settings.playArea.screen ?? null),
    identifyScreens: (on) => picker().identify(on),
    pickScreen: async () => {
      const ref = await picker().pick();
      if (!ref) return { ok: false, reason: "cancelled" };
      if (!commands) return { ok: false, reason: "not-ready" };
      const reply = await commands.dispatcher.dispatch({ cmd: "settings.set", target: "playScreen", args: { value: ref }, from: "settings" });
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
  if (uri) stages?.sendCry(id, uri, volume);
}

function notifyGame(body: string): void {
  try {
    if (Notification.isSupported()) new Notification({ title: "pokebuddy", body }).show();
  } catch (e) { log?.({ notification: "failed", message: String(e) }); }
}

// then — 성공하면 이어서 보낼 명령(첫 돌봄 튜토리얼 완료)
function runGameCommand(command: Command, then?: () => Command): void {
  void commands?.dispatcher.dispatch(command).then(async (result) => {
    if (!result.ok) notifyGame(t("game.failed", { reason: t(`game.reason.${result.reason}`) }));
    else if (then) {
      try {
        await commands?.dispatcher.dispatch(then());
      } catch (e) {
        console.error(e); // 튜토리얼 기록이 실패해도 트레이·말풍선은 맞춘다 — 다음 메뉴 선택 때 다시 끝난다
      }
    }
    tray?.refresh();
    syncCoach(); // 첫 돌봄 튜토리얼이 끝났을 수 있다
  });
}

// 포켓몬 위 우클릭 — 이름·상태 / 밥 주기·놀아주기 / 상세 보기. 앱 전체 조작은 트레이가 맡는다
function showPetMenu(id: string): void {
  const p = stages?.petOf(id);
  if (!p) return;
  const model = { name: petLabel(p), nature: p.nature ? natureName(p.nature) : null };
  const pet = game?.read()?.pets.find((row) => row.id === id) ?? null; // 메모리 값 — 파일은 15초마다 쓴다
  const care = pet ? { status: petStatus(pet), feed: careItem(pet, "feed"), play: careItem(pet, "play") } : {};
  // 첫 돌봄 튜토리얼 중이면 메뉴에서 고른 돌봄이 튜토리얼을 끝낸다 — 다른 곳의 돌봄은 끝내지 않는다 (src/tutorial/core.ts onlyAtStart)
  const save = game?.read();
  const firstCare = save ? currentTutorial(save)?.id === "first-care" : false;
  const careCmd = (cmd: "feed" | "play") => (): void => {
    if (firstCare) runGameCommand({ cmd, target: id, from: "menu" }, () => ({ cmd: "tutorial.done", target: "first-care", args: { steps: 2 }, from: "pet" }));
    else runGameCommand({ cmd, target: id, from: "menu" });
  };
  const built = petMenu({ ...model, ...care }, {
    feed: careCmd("feed"),
    play: careCmd("play"),
    ...(pet ? { ball: () => runGameCommand({ cmd: "party.hide", target: id, from: "menu" }) } : {}),
  });
  if (pet) built.push(
    { type: "separator" as const },
    // 그 포켓몬의 개체 상세를 연다 — 우클릭 메뉴는 그 포켓몬 관련 기능만 둔다 (2026-09-28 사용자 결정)
    { label: t("menu.detail"), click: () => openManageWindow({ to: "pet", petId: id }) },
  );
  // 첫 돌봄 튜토리얼 중이면 2/2 로 넘기고 밥 주기만 누르게 둔다. 밥 주기를 못 하는 때(쿨타임·배부름)는 놀아주기를 대신 남긴다.
  // 둘 다 쉬는 중이면 모두 잠그고, 말풍선은 놀아주기까지 남은 시간을 보인다
  let items = built;
  if (firstCare && pet) {
    const keep = care.feed?.enabled ? t("menu.feed") : care.play?.enabled ? t("menu.play") : null;
    items = lockExcept(built, keep ? [keep] : []);
    // 쉬는 중(쿨타임)일 때만 남은 시간을 붙인다 — 배부름 같은 다른 이유면 "곧" 으로
    const cooling = (a: "feed" | "play"): string | null => (pet && careState(pet, a).reason === "cooldown" ? (care[a]?.reason ?? null) : null);
    const wait = keep ? null : (cooling("play") ?? cooling("feed") ?? t("coach.first-care.wait.soon"));
    if (firstCareMenu !== keep || firstCareWait !== wait) {
      firstCareMenu = keep;
      firstCareWait = wait;
      syncCoach();
    }
  }
  // OS 기본 메뉴는 Windows 에서 왼쪽을 크게 비운다 — 앱이 그리는 메뉴를 커서 자리에 띄운다 (docs/specs/ui-components.md C-21)
  // 첫 돌봄 중이면 메뉴 자리를 말풍선에 알려 겹치지 않게 한다. 메뉴가 닫히면 말풍선은 제자리로 돌아간다
  const avoid = firstCare && pet
    ? {
        onPlaced: (r: { x: number; y: number; w: number; h: number }) => {
          const s = stages?.stageRectOf(id);
          firstCareAvoid = s ? { x: r.x - s.x, y: r.y - s.y, w: r.w, h: r.h } : undefined;
          syncCoach();
        },
        onClosed: () => {
          firstCareAvoid = undefined;
          firstCareMenu = null; // 메뉴가 닫히면 1/2(우클릭)로 되돌린다 — 메뉴 없이 "메뉴에서 …" 가 남지 않게. 스킵이 아니다
          firstCareWait = null;
          syncCoach();
        },
      }
    : {};
  popupMenu({ preload: preloadFile(), html: rendererFile("menu.html"), ...avoid }, items, t("menu.on"));
}

// 파티 목록 → 무대. 그림을 받는 동안 기다린다. 트레이는 공식 앱 로고를 유지한다
// 친구 교환 세션 — 저장을 쓰는 동반자(writer)일 때 처음 부를 때 만들고 한 번 시작한다(로그인 확보·반영하지 않은 교환 복구).
// 교환이 끝나 개체가 바뀌면 무대를 다시 그린다
// 게임을 멈춘 동안(halted)은 만들지 않는다
function tradeSession(): MainTrade["session"] | null {
  if (quitting || halted || !game || !party || !party.isWriter()) return null;
  if (!mainTrade) {
    // 교환 반영을 서버에 알린 뒤 저장을 바로 올린다 — 서버가 그 교환을 저장된 것으로 보게 (design-p1.md 6절)
    mainTrade = createMainTrade(game, online() ?? undefined, () => mainOnline?.noteSaved("event"), cloudHold);
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

// 로그인 계정의 새 교환(만들기·참가)·선물 받기를 막아야 하는가 (worklog-mac/records/cloud-authority 검수 1)
//   클라우드 저장이 online 이고 올리기가 막히지 않았을 때(CLOUD_OWNER_OTHER·CLOUD_BAD_SAVE 없음)만 연다.
//   그 밖의 상태에서 교환·선물을 받으면 나중에 서버 저장을 받을 때 결과가 덮여 복제·유실된다
//   익명·로그아웃 상태는 막지 않는다(P2 에서 정한다). 클라우드가 멈춰(off) 있으면 계정을 직접 읽어 판정한다 — 켜는 중에도 막게
async function cloudHold(): Promise<boolean> {
  const on = mainOnline;
  if (!on) return false;
  const v = on.cloud.view();
  if (v.status === "online") return v.error === "CLOUD_OWNER_OTHER" || v.error === "CLOUD_BAD_SAVE";
  if (v.status !== "off") return true;
  try {
    return (await on.account.view()).signedIn;
  } catch (e) {
    console.error("계정 상태를 읽지 못했다 — 교환·선물 받기를 막는다", e);
    return true;
  }
}

// 클라우드 저장의 연결 시도가 끝나기를 기다린다(최대 ms) — connecting 이거나, 로그인했는데 아직 시작 전(off)이면 기다린다
async function cloudSettled(ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const on = mainOnline;
    const status = on?.cloud.view().status;
    if (!on || status === "online") return;
    if (status !== "connecting") {
      if (status !== "off") return;
      try {
        if (!(await on.account.view()).signedIn) return;
      } catch (e) {
        console.error("계정 상태를 읽지 못했다 — 기다리지 않는다", e);
        return;
      }
    }
    await new Promise<void>((r) => setTimeout(r, 200));
  }
}

// 온라인 기능 — writer 인 동반자에서 처음 부를 때 만든다. 서버 설정이 없거나 게임을 멈춘 동안(halted)은 null.
// 멈춘 동안의 확인·다시 시도는 이미 만든 mainOnline 을 직접 쓴다
function online(): MainOnline | null {
  if (quitting || halted || !game || !party || !party.isWriter()) return null;
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
        mainMail?.userChanged(); // 받은 시각은 계정마다 다르다 — 지난 목록을 버리고 새로 읽는다
        void mainMail?.refresh();
      },
      onSaveReplaced: () => {
        if (party?.kind === "save") party.refresh(); // 받은 클라우드 저장 — 무대와 설정창을 다시 그린다
      },
      // 밀려남·넘겨받기 확인·교환 막힘 — 게임을 멈추고 창을 띄운다. 로그아웃하지 않는다(D19)
      onHalt,
    });
    mainOnline?.onScreen((screen) => pushAccount(screen));
  }
  return mainOnline;
}

// 우편함 — 온라인 기능이 있을 때 처음 부를 때 만든다. 목록은 관리 창이 열 때와 우편함을 열 때 새로 읽는다
function mailBox(): MainMail | null {
  const on = online();
  if (!on || !game) return null;
  if (!mainMail) {
    const g = game;
    mainMail = createMainMail({
      rpc: async (fn, args) => {
        try {
          const { data, error } = await on.client.rpc(fn, args);
          if (!error) return { ok: true, data };
          // 서버 함수의 MAIL_* 는 그대로, 그 밖은 교환과 같은 규칙(NETWORK · UNKNOWN)
          return { ok: false, code: /^MAIL_[A-Z_]+$/.exec((error.message ?? "").trim())?.[0] ?? codeOf(error).code };
        } catch (e) {
          return { ok: false, code: codeOf({ message: e instanceof Error ? e.message : String(e) }).code };
        }
      },
      // writer 를 놓은 뒤 끝난 받기는 저장을 쓰지 않는다 — 새 writer 의 저장을 덮어쓰지 않게. 다음에 목록을 읽을 때 복구된다
      run: (id, name, args) => (party?.isWriter() ? g.executor.run({ id, name, args }) : { ok: false, reason: "not-writer" }),
      read: () => g.read(),
      signedIn: () => on.screen().signedIn,
      hold: cloudHold,
      onChanged: () => {
        if (party?.kind === "save") party.refresh(); // 가방·포인트가 바뀌었다 — 설정창과 트레이를 다시 그린다
        tray?.refresh();
      },
    });
    mainMail.onScreen((screen) => pushMail(screen));
  }
  return mainMail;
}

// ── 두 PC 규칙 멈춤 (worklog-mac/records/cloud-authority/design-p1.md 3절) ──

// 교환·우편·mailbox 명령을 멈춘다. 온라인(mainOnline)은 남긴다 — 확인·다시 시도에 쓴다
function pauseOnlineWork(): void {
  commands?.setWriter(false);
  mainTrade?.session.stop();
  mainTrade = null;
  tradeScreen = null;
  mainMail = null;
}

// 클라우드 저장이 게임을 멈추라고 알렸다 (src/online/cloud.ts onHalt)
//   superseded        밀려남 — 안내 창 뒤 종료
//   confirm · blocked 메모리 진행을 쓰고 멈춘 뒤 창으로 묻는다. 답을 받아 다시 넘겨받으면 또 올 수 있다
function onHalt(reason: HaltReason, info: HaltInfo): void {
  if (quitting || halted === "superseded") return;
  if (reason === "superseded") {
    supersede(info);
    return;
  }
  // 멈추기 전에 1초 틱 진행을 쓴다 — 멈춘 동안은 쓰지 않는다. 쓴 진행은 넘겨받은 뒤 올린다
  if (!halted && saveParty()?.isWriter()) game?.flush();
  halted = reason;
  workMs = 0;
  pauseOnlineWork();
  haltNext = { reason, info };
  log?.({ cloud: "halt", reason, code: info.code });
  if (!haltAsking) void askHalt();
}

// 확인·막힘 창을 차례로 묻는다. [여기서 시작]·[다시 시도] 면 다시 넘겨받고, 그 결과로 또 멈추면 다시 묻는다.
// [취소]·[종료] 면 클라우드를 멈추고 앱을 끝낸다(D22). 창이 떠 있는 동안 게임은 멈춰 있다
async function askHalt(): Promise<void> {
  // 창을 기다리는 사이 onHalt 가 halted 를 바꾼다 — 좁혀진 타입을 믿지 않게 함수로 다시 읽는다
  const kicked = (): boolean => halted === "superseded";
  haltAsking = true;
  try {
    while (haltNext && !quitting && !kicked()) {
      const { reason, info } = haltNext;
      haltNext = null;
      const abort = new AbortController();
      haltAbort = abort;
      const answer = reason === "confirm" ? await askConfirm(info, abort.signal) : await askBlocked(info, abort.signal);
      if (haltAbort === abort) haltAbort = null;
      if (quitting || kicked()) return; // 창을 띄운 사이 밀려났다 — 밀려남 흐름이 종료한다
      const on = mainOnline;
      if (answer !== "go" || !on) {
        await on?.confirm(false);
        app.quit();
        return;
      }
      await on.confirm(true); // 또 멈추면 onHalt 가 haltNext 를 채운다
      if (haltNext || kicked() || quitting) continue;
      resumeFromHalt();
    }
  } finally {
    haltAsking = false;
  }
}

// 넘겨받았다(또는 오프라인으로 이어 간다) — 게임·명령·교환을 다시 돌린다. 우편함은 다음에 부를 때 만든다
function resumeFromHalt(): void {
  halted = null;
  log?.({ cloud: "resume" });
  if (quitting || !saveParty()?.isWriter()) return;
  commands?.setWriter(true);
  tradeSession();
  flushTradeLink();
  if (mainOnline) pushAccount(mainOnline.screen());
}

// 다른 PC 에 밀려났다 — 게임을 멈추고 교환·우편·온라인을 닫은 뒤 안내하고 끝낸다.
// 로그아웃하지 않는다 — 다시 켜면 같은 세션으로 서버 저장을 받아 넘겨받는다(D19). 끄기 경로는 올리기·released 를 건너뛴다
function supersede(info: HaltInfo): void {
  halted = "superseded";
  haltNext = null;
  haltAbort?.abort(); // 떠 있는 확인·막힘 창을 닫는다
  haltAbort = null;
  workMs = 0;
  pauseOnlineWork();
  if (mainOnline) pushAccount(mainOnline.screen());
  mainOnline?.dispose();
  mainOnline = null;
  log?.({ cloud: "superseded", other: info.other?.label ?? null });
  void showKicked(info).finally(() => app.quit());
}

// 세션 종료 직전 — 올리고 released 를 알린다(최대 3초). 클라우드를 멈추지 않는다.
// 멈춘 동안(halted)이나 클라우드를 쓰지 않으면 하지 않는다. 겹쳐 부르면 진행 중인 약속을 돌려준다
function announceOnline(): Promise<void> {
  if (!onlineAnnounce) {
    const on = mainOnline;
    const run = !halted && on && on.cloud.view().status !== "off"
      ? on.cloud.announceRelease(3_000).catch((e) => {
          console.error("세션 종료 전 클라우드 알림에 실패했다 — 다음 실행에서 올린다", e);
        })
      : Promise.resolve();
    onlineAnnounce = run.finally(() => {
      onlineAnnounce = null;
    });
  }
  return onlineAnnounce;
}

// 세션 종료가 진행 중이다 — 알리는 중이거나 released 를 알린 뒤 아직 active 로 되돌리지 않았다.
// 그때 오는 before-quit 은 시스템 종료를 늦추지 않게 기다리지 않는다
function sessionEnding(): boolean {
  return onlineAnnounce != null || (mainOnline?.cloud.released() ?? false);
}

// 일반 종료 전 클라우드 정리 — 올리고 released 를 알린 뒤 클라우드를 멈춘다(최대 3초). 한 번만 한다.
// 멈춘 동안(halted)이나 클라우드를 쓰지 않으면 하지 않는다
function releaseOnline(): Promise<void> {
  if (!onlineReleased) {
    const on = mainOnline;
    onlineReleased = !halted && on && on.cloud.view().status !== "off"
      ? on.release(3_000).catch((e) => {
          console.error("끄기 전 클라우드 정리에 실패했다 — 다음 실행에서 올린다", e);
        })
      : Promise.resolve();
  }
  return onlineReleased;
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
    .then(() => cloudSettled(10_000)) // 링크로 켰으면 클라우드가 연결 중이다 — 끝나기 전에 참가하면 cloud-wait 로 거절된다
    .then(() => session.join(link))
    .then((r) => {
      // 거절(진행 중인 교환·다른 조작)은 보기에 남지 않는다 — 교환 모달 배너로 알린다
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

// 교환 링크로 참가하고 교환 모달을 연다. 교환 세션이 아직 없으면(준비 전·reader) 생길 때 참가한다
function openTradeLink(link: string): void {
  tradeLink = { link, at: Date.now() };
  flushTradeLink();
  openManageWindow({ to: "trade" });
}

async function refreshParty(): Promise<void> {
  if (!party || !stages) return;
  await stages.setParty(party.pets());
  tray?.setIcon(logoFile(256));
  tray?.refresh();
}

// 말풍선을 보이는 시간 5초 — 2026-09-25 구현에서 정했고, 2026-09-27 사용자가 되풀이 간격만 정하고 이 값은 그대로 두었다
// (worklog/records/game-runtime/record.md "배고픔 말풍선 되풀이")
const BUBBLE_MS = 5000;
// 줍기 확률 배율 — 개발 실행에서만 POKEBUDDY_FIND_RATE(양의 정수). 100 이면 초당 100/2000. 마리마다 독립은 그대로다. 실기 확인용 (src/find/rules.ts perSecond)
let findRateMemo: number | null | undefined;
const findRate = (): number | null => {
  if (findRateMemo === undefined) {
    const v = process.env.POKEBUDDY_FIND_RATE;
    findRateMemo = v && /^\d+$/.test(v) && Number(v) > 0 && isDevRun() ? Number(v) : null;
  }
  return findRateMemo;
};
const hungerBubbles = createHungerBubbles();

// 말풍선 아이콘 열쇠 — 글자 대신 그림을 넣는다 (2026-09-29 사용자 결정 "말풍선에 아이콘들 넣어")
//   배고픔 고기 1개 · 매우 배고픔 고기 3개 · 포인트 금화 — 우리가 그린 assets/items/meat.png · coin.png
//   도구·진화용 도구 — 관리 창과 같은 도구 그림(item:<식별자>) · 포켓몬 — 데려온 종의 초상(pokemon:<종>[:shiny])
const MEAT = "item:meat";
const COIN = "item:coin";
const foundIcon = (rec: FindRecordV3, save: SaveV3 | null): string => {
  if (rec.kind === "points") return COIN;
  if (rec.kind !== "pokemon") return `item:${rec.ref}`;
  const shiny = save?.pets.find((p) => p.id === rec.newPetId)?.shiny === true;
  return `pokemon:${rec.ref}${shiny ? ":shiny" : ""}`;
};

// 열쇠별 그림(data URI). 하나라도 못 구하면 null — 말풍선을 띄우지 않는다. 글자로 되돌리지 않는다
async function iconUris(keys: string[]): Promise<Record<string, string> | null> {
  const art = portraits;
  if (!art) return null;
  const out: Record<string, string> = {};
  for (const key of new Set(keys)) {
    const mon = /^pokemon:([a-z0-9-]+)(:shiny)?$/.exec(key);
    const got = mon ? Object.values(await art.get([{ slug: mon[1] ?? "", shiny: !!mon[2] }]))[0] : (await art.icons([key]))[key];
    if (!got) return null;
    out[key] = got;
  }
  return out;
}

// 아이콘 말풍선 — 그림을 구한 뒤 그 마리 위에 BUBBLE_MS 동안. 그 사이 무대에서 빠졌거나 직접 숨겼으면 띄우지 않는다
function sayIcons(petId: string, keys: string[]): void {
  void iconUris(keys).then((uris) => {
    if (uris && stages && !userHidden && stages.petOf(petId)) stages.say(petId, keys, uris, BUBBLE_MS);
  });
}

// 에이전트 상태 폴링 — 500ms(STAGE_RULES.statePollMs). 화면·입력용이라 전역 시계를 쓰지 않는다 — 상태가 바뀐 것을 반 초 안에 무대에 보인다.
// 게임 값은 바꾸지 않는다. 게임 시간·줍기·작업 시간은 전역 시계의 1초 틱(clockTick)이 한다
function stateTick(): void {
  if (!anchor || !stages) return;
  const { state, promptAt } = anchor.currentInfo();
  stages.setState(state, promptAt);
  if (state !== lastState) {
    lastState = state;
    log?.({ state });
  }
}

// 전역 시계의 1초 틱 — 게임 시간 적용·줍기·작업 시간·배고픔 말풍선·배너를 이 틱의 now·gap 으로 한다 (2026-09-29 사용자 결정 "전역 타이머 1초").
// 쓰기는 거래 실행기 하나가 하므로 writer 일 때만 돈다. 틈이 STATE_RULES.maxTickMs 를 넘는 틱(절전 복귀·멈춤)은 작업·줍기로 세지 않는다.
// 게임 시간의 큰 틈은 `game.tick` 이 TIME_V3_RULES.maxTickMs 로 자른다 (docs/specs/game.md "복귀할 때 중단 기간을 소급 진행하지 않는다").
// 에이전트가 작업하는 동안 적립이 2배다. 작업 판정은 무대의 에이전트 상태 running 이다 (docs/specs/balance.md "에이전트 작업 보너스").
// 무거운 일(놀이공간·점프 목록·트레이 다시 읽기, 남은 안내)은 SLOW_EVERY 틱(15초)마다 — 1초로 당길 까닭이 없고 OS 호출이 섞여 있다
const SLOW_EVERY = Math.max(1, Math.round(STATE_RULES.saveMs / CLOCK_RULES.periodMs));
function clockTick({ now, gap, seq }: ClockTick): void {
  pushClock(now); // 관리 창·기기 창이 이 틱에 스냅샷을 다시 읽는다 (manage:clock)
  // 두 PC 규칙으로 멈췄다 — 시간·줍기·작업 시간을 쌓지 않는다. 다시 돌면 game.tick 이 그 틈을 자른다
  if (halted) {
    workMs = 0;
    return;
  }
  if (!anchor || !stages) return;
  const worker = saveParty();
  if (!worker?.isWriter() || !game || screenLocked) {
    workMs = 0; // writer 가 아니거나 화면이 잠겼으면 쌓지 않는다. 다시 돌면 새로 센다
    return;
  }
  const counted = gap > 0 && gap <= STATE_RULES.maxTickMs;
  if (counted && anchor.currentInfo().state === "running") workMs += gap;

  // 줍기 — 깨어 있는 마리 각각을 이 틱의 간격으로 따로 굴린다. 주우면 그 틱에 저장하고 말풍선·배너를 띄운다.
  // 직접 숨긴 동안은 무대에 아무도 없는 것으로 본다 (src/find/core.ts rollHits)
  if (counted && !userHidden) {
    const hits = rollHits(Object.fromEntries(stages.awakeIds().map((id) => [id, gap])), Math.random, findRate() ?? 1);
    const found = hits.length ? game.find(hits) : null; // 쓰지 못하면 null — 그 건은 버린다
    if (found?.length) {
      worker.refresh();
      const save = game.read();
      for (const rec of found) sayIcons(rec.petId, [foundIcon(rec, save)]);
    }
  }

  // 게임 시간 — 1초마다 메모리에 적용하고 파일은 STATE_RULES.saveMs 마다 쓴다 (src/main/game.ts flushMs)
  const events = game.tick({ workMs });
  if (events) workMs = 0; // 쓰지 못했으면 다음 틱에 흐른 시간과 함께 다시 넘긴다

  // 배고픔 말풍선 — 무대에 나와 있는 포켓몬이 배고픔·매우 배고픔 구간에 들어가면 띄우고, 머무는 동안 되풀이한다 (src/main/hunger-bubble.ts).
  // 숨긴 포켓몬은 무대에 없어 띄우지 않는다. 직접 숨긴 동안에도 띄우지 않는다
  if (!userHidden) {
    const st = stages;
    const shown = (game.read()?.pets ?? []).filter((p) => st.petOf(p.id));
    for (const b of hungerBubbles.due(shown, now)) sayIcons(b.id, b.zone === "starving" ? [MEAT, MEAT, MEAT] : [MEAT]); // 배고픔 고기 1개, 매우 배고픔 고기 3개
  }
  notifier?.tick(); // 부화 준비·진화 가능·업적 미수령·줍기를 배너 줄에 세운다 — 1초 안에 뜬다 (src/notify)
  syncCoach();

  if (seq % SLOW_EVERY !== 0) return;
  worker.refresh();
  hookUpkeep?.tick(); // 남은 한 번 알림이 있고 다른 배너가 없으면 띄운다
  syncPlayArea(); // 다른 프로세스의 관리 창에서 바꾼 놀이공간도 따라간다
  syncSleep(); // 잠들기 기준도 같다
  syncJump();
  const points = Math.floor(game.read()?.points.balance ?? 0);
  if (points !== lastMenuPoints) {
    lastMenuPoints = points;
    tray?.refresh();
  }
}

async function main(): Promise<void> {
  if (duplicate) return; // 둘째 동반자 — 이미 quit 을 불렀다
  // 메모리에만 있는 1초 틱 진행을 쓴다 — 잠금·절전·끄기 직전. 멈춘 동안(halted)은 쓰지 않는다
  const flushLocal = (): void => {
    if (!halted && saveParty()?.isWriter()) game?.flush();
  };
  // 잠금·절전은 연결 끊김이 아니다 — 올리고 잠듦을 서버에 알린다. 그동안 다른 PC 는 경고 없이 넘겨받는다(D21)
  powerMonitor.on("lock-screen", () => {
    flushLocal();
    void mainOnline?.sleep();
    screenLocked = true;
    log?.({ screen: "locked" });
  });
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
    void mainOnline?.wake(); // 아직 활성인지 본다 — 넘겨받혔으면 밀려남 안내 뒤 종료
    log?.({ screen: "unlocked" });
  });
  // 절전은 기다리지 않는다 — 알림이 못 가면 다른 PC 가 연결 끊김 경고를 한 번 본다(허용 오탐, design-p1.md 3절 한계)
  powerMonitor.on("suspend", () => {
    flushLocal();
    void mainOnline?.sleep();
  });
  // 잠긴 채 깨어났으면 잠금 해제 때 깨운다
  powerMonitor.on("resume", () => {
    if (!screenLocked) void mainOnline?.wake();
  });
  // Windows 로그오프·종료 — before-quit 이 오지 않을 수 있다. 창의 이벤트라 만들어지는 창마다 건다.
  //   query-session-end  끝내기 직전 — 로컬을 쓰고 올린 뒤 released 를 보낸다. 기다리지 않고 막지도 않는다(preventDefault 없음)
  //   session-end        끝난다 — 로컬만 쓴다
  // mac 의 끄기는 powerMonitor shutdown — 같은 일을 한다. 이어서 오는 before-quit 은 기다리지 않는다
  // 클라우드는 멈추지 않는다 — 끄기가 취소되어 앱이 계속 돌면 다음 하트비트가 active 로 되돌린다
  const endSession = (): void => {
    flushLocal();
    void announceOnline();
  };
  app.on("browser-window-created", (_e, w) => {
    w.on("query-session-end", endSession);
    w.on("session-end", flushLocal);
  });
  powerMonitor.on("shutdown", endSession);
  if (process.platform === "darwin") {
    // Dock 을 숨기기 전에 로고를 한 번 — 숨기지 않는 구간(선택 창 등)이 생겨도 기본 Electron 아이콘이 아니게. 로고가 아직 없으면 건너뛴다
    const logo = logoFile(512);
    if (logo) app.dock?.setIcon(nativeImage.createFromPath(logo));
    app.dock?.hide();
  }

  // 저장을 쓰는 것은 잠금을 잡은 프로세스 하나다. 실행기에 그 조건을 걸어 reader 는 쓰지 못하게 한다. 두 PC 규칙으로 멈춘 동안(halted)도 쓰지 않는다
  // 쓰고 나면 클라우드 저장에 알린다 — 교환·부화·진화 등 사건(src/main/game.ts EVENT_WRITES)은 바로, 나머지는 2분 스로틀
  // 시간 진행은 1초마다 메모리에, 파일은 STATE_RULES.saveMs 마다 쓴다 (src/main/game.ts flushMs)
  // 시각은 전역 시계의 마지막 틱 시각이다 — 게임 시간·스냅샷·줍기가 같은 시각을 본다. 첫 틱 전에는 지금 시각 (2026-09-29 사용자 결정 "확률이나 시간 등등은 그 시간값 보게 해")
  const reader = createGame({ file: PATHS.save, canWrite: () => !halted && (saveParty()?.isWriter() ?? false), onWrite: (kind) => mainOnline?.noteSaved(kind), flushMs: STATE_RULES.saveMs, now: () => clock.last()?.now ?? Date.now() });
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
  notifier = createNotifier({ file: path.join(path.dirname(PATHS.save), "notify.json"), read: reader.read, now: () => clock.last()?.now ?? Date.now(), show: (b) => bannerWin?.show(b) }); // 시각은 전역 시계의 틱 시각
  const saveSource = createSaveParty({ game: reader, paths: PATHS, log });
  party = saveSource;

  // 수명 감시는 첫 실행 선택 창보다 먼저 — 고르는 동안 companion stop(lock 삭제)이 와도 끝나야 한다
  lifetime = createLifetime({
    lockFile: PATHS.companionLock,
    pidAlive,
    hasWindow: () => bootReady && !!stages?.alive(),
    quit: () => app.quit(),
  });
  lifetime.start();

  // 그림 미리 받기 — 설치 파일에 그림이 없다. 빠진 초상·도구·알 그림을 뒤에서 받아 캐시에 둔다(src/main/portraits.ts).
  // 첫 실행이면 아래 선택 창에서 고르는 동안 받는다. 관리 창은 창을 열 때 캐시를 한 번에 읽는다
  // 첫 실행이면 스타터 초상부터 받는다. 선택 창도 같은 portraits 를 써서 받는 중인 그림을 함께 기다린다
  const pics = createPortraits(path.join(PATHS.home, "sprites"), path.join(PATHS.project, "sprites"));
  portraits = pics;
  const starterList = saveSource.needsStarter() ? starters(unlockRules()) : [];
  const prefetchAt = Date.now();
  void pics
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
        portraits: pics,
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
  // 무대 그림 미리 받기 — 가진 개체 전부의 PMD 묶음을 뒤에서 디스크에 둔다. 교체·배치로 처음 나오는 종을 받느라 늦게 뜨지 않게 한다.
  // 부화·교환·줍기로 새 개체가 생기면 저장 변경 알림에서 그 종을 더 받는다 (worklog/records/response-latency/record.md)
  const prefetchOwned = (): void => art.prefetch((saveSource.save()?.pets ?? []).map(appearanceOf));
  saveSource.onChange(prefetchOwned);
  prefetchOwned();
  // 화면마다 무대 창 한 쌍 — 창과 무대의 알림은 묶음이 그 쌍으로 이어 준다 (src/main/stage-group.ts)
  stages = createStageGroup({
    createWindow: (hooks) =>
      createStageWindow({
        debug,
        preload: preloadFile(),
        html: rendererFile("stage.html"),
        log,
        ...hooks,
        // 튜토리얼 말풍선의 버튼 — `다음`·`확인` 은 완료, ✕ 는 스킵
        onCoachAction: ({ id, action }) => {
          if (id === "first-care") firstCareMenu = null;
          void commands?.dispatcher
            .dispatch({ cmd: action === "done" ? "tutorial.done" : "tutorial.skip", target: id, args: { steps: 1 }, from: "pet" })
            .then(() => syncCoach());
        },
      }),
    createStage: (win, hooks) =>
      createStage({
        buddyMode: config.buddy,
        timeScale: runtime.buddyTimeScale,
        window: win,
        art,
        ghost: () => !!config.clickThrough,
        cursor: hooks.cursor,
        sleepAfterMin: () => sleepAfterMin,
        onDrop: hooks.onDrop,
        // 클릭은 놀아주기 (src/main/commands.ts). 울음소리는 놀아주기가 쿨타임이어도 클릭할 때마다 낸다 — 반응을 들려준다
        onClick: (id) => {
          // 바탕화면 튜토리얼 중에는 왼쪽 클릭이 놀아주기가 아니다 — 무대 렌더러가 먼저 막고, 여기서 한 번 더 막는다
          if (coachShown) return;
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
      }),
    cursorPoint: () => screen.getCursorScreenPoint(),
    // 놓은 자리(와 모든 화면이면 사는 화면)를 저장한다. 실패하면 저장된 자리로 되돌린다
    onDrop: (id, home, onScreen) => {
      void commands?.dispatcher.dispatch({ cmd: "pet.set", target: id, args: { home, ...(onScreen ? { screen: onScreen } : {}) }, from: "pet" }).then(async (result) => {
        if (result.ok) return;
        log?.({ drop: "failed", id, reason: result.reason });
        await refreshParty();
      });
    },
    log,
  });
  // 첫 배치 — 마리를 싣기 전에 무대 창이 있어야 한다(아래 "그림을 하나도 못 받음" 판정이 무대를 본다)
  syncPlayArea();
  syncSleep(); // 첫 마리부터 설정의 잠들기 기준으로 만든다
  stages.layout(lanesNow(), playArea.mode === "all");
  staged = true;

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
    flags: () => ({ userHidden, held: stages?.heldId() != null }),
    onUpdate: onAnchorUpdate,
    onFocus: (key) => stages?.focus(key),
    onInput: onTrayInput,
    log,
  });

  commands = createCommands({
    mailboxDir: PATHS.mailbox,
    party: saveSource,
    game: reader,
    prepareLook: async (look) => !!await art.loadLook(look),
    onChanged: async (evolvedId) => {
      await refreshParty();
      if (evolvedId) stages?.celebrate(evolvedId);
    },
    stage: {
      poke: (id) => !!stages?.poke(id),
      care: (id, action) => {
        stages?.care(id, action);
        if (action === "play") void playCry(id); // 메뉴·관리 창에서 고른 놀아주기
      },
      petIds: () => stages?.petIds() ?? [],
      size: () => stages?.size() ?? { w: 0, h: 0 },
      visible: () => !!stages?.isVisible(),
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
  // 두 PC 규칙으로 멈춘 동안(halted) — 저장을 바꾸는 명령은 실행기로 보내지 않고 멈춤 사유로 거절한다.
  // 무대 클릭(commands.click)·메뉴·관리 창·mailbox 가 모두 이 dispatch 를 지난다. 읽기·무대 반응·끄기만 연다
  const dispatchNow = commands.dispatcher.dispatch.bind(commands.dispatcher);
  commands.dispatcher.dispatch = (command) =>
    halted && !HALT_OPEN.has(command.cmd) ? Promise.resolve({ ok: false, reason: "halted" }) : dispatchNow(command);
  saveSource.onRole((w) => {
    commands?.setWriter(w && !halted);
    // writer 가 되면 반영하지 않은 교환을 이어 간다. writer 를 놓으면 교환도 멈춘다 — 저장을 쓸 수 없다
    if (w) {
      // 이어받기는 late — 앞 프로세스가 이 PC 를 쥐던 대로 잇는다. 그사이 다른 PC 가 온라인으로 넘겨받았으면 이쪽이 밀려난다(D20, 핑퐁 없음)
      void online()?.start("late");
      tradeSession();
      flushTradeLink();
    } else {
      mainTrade?.session.stop();
      mainTrade = null;
      tradeScreen = null;
      mainOnline?.dispose();
      mainOnline = null;
      mainMail = null;
    }
  });
  commands.setWriter(saveSource.isWriter());
  saveSource.onChange(() => {
    syncSleep(); // 밖에서 바뀐 저장(다른 프로세스·클라우드 받기)의 잠들기 기준을 바로 따른다
    void refreshParty().then(syncCoach); // 무대에 나온 마리가 바뀌면 첫 돌봄이 밝힐 마리도 바뀐다
  });

  await refreshParty();
  if (quitting) return;
  if (saveSource.pets().length && !stages.petIds().length) {
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
  // 로그인한 채 켰으면 클라우드 저장을 시작한다 — 교환보다 먼저 만들어 같은 클라이언트를 나눠 쓴다.
  // 켤 때는 boot — 사용자가 이 PC 에 있다. 다른 PC 가 온라인·잠듦이면 바로 넘겨받고, 연결 끊겼으면 확인 창을 띄운다(D17·G2)
  void online()?.start("boot");
  tradeSession(); // 동반자 writer 면 교환 세션을 시작한다 — 반영하지 않은 교환이 있으면 이어 간다
  flushTradeLink(); // 링크로 켜졌거나 준비 전에 링크를 받았다

  startUpdater();
  // 기존 훅 정리 — 옛 이벤트를 걷고 있는 훅 파일을 새 버전으로. 새로 등록하지 않는다. 시작을 막지 않게 뒤로 미룬다
  if (saveSource.isWriter()) {
    hookUpkeep = createHookUpkeep({ noticesFile: path.join(path.dirname(PATHS.save), "notices.json"), show: (b) => notifier?.showOnce(b) ?? false, log });
    setImmediate(() => hookUpkeep?.start());
  }

  tray = createTray({
    icon: logoFile(256),
    tooltip: t("tray.title", { name: displayName() }),
    template: trayTemplate,
    popup: popupTrayMenu,
    open: () => openManageWindow(),
    menuOpen,
    closeMenu,
    closedWithin,
  });

  applyClickThrough(!!config.clickThrough);
  syncJump();
  syncLoginItem();
  syncPlayArea();
  syncCoach();
  bootReady = true;
  lifetime.check(); // 창이 생겼으니 lock 파일에 ready 를 적는다 — pokebuddy companion 이 이걸 보고 기다림을 끝낸다

  intervals.push(setInterval(stateTick, STAGE_RULES.statePollMs));
  clock.on(clockTick);
  clock.start();
  intervals.push(setInterval(() => stages?.tick(), STAGE_RULES.tickMs));
  // 모니터를 꽂거나 빼거나 배치·해상도가 바뀌면 무대 창을 바로 다시 정한다 — 빠진 화면의 마리는 주 화면에 임시로 간다
  const relayout = (): void => anchor?.poll();
  screen.on("display-added", relayout);
  screen.on("display-removed", relayout);
  screen.on("display-metrics-changed", relayout);
  anchor.start();
  log?.({ boot: "companion", pets: stages.petIds(), writer: saveSource.isWriter(), stageHtml: fs.existsSync(rendererFile("stage.html")) });
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
let quitWaited = false; // 끄기 전 클라우드 정리를 한 번 기다렸다
app.on("before-quit", (e) => {
  // 메모리에만 있는 1초 틱 진행을 먼저 쓴다 — 클라우드 올리기가 그 값을 보게 (src/main/game.ts flush). 멈춘 동안(halted)은 쓰지 않는다
  if (!halted && saveParty()?.isWriter()) game?.flush();
  // 끄기 전에 올리고 released 를 알린다 — 최대 3초. 다른 PC 가 경고 없이 넘겨받는다. 실패해도 끄기를 막지 않는다(다음 실행에서 올린다).
  // 밀려났거나 확인·막힘으로 멈췄으면 건너뛴다. 세션 종료(Windows 로그오프·mac 끄기·업데이트)가 진행 중이면 이미 알렸다 —
  // 시스템 종료를 늦추지 않게 기다리지 않고 끝낸다
  if (!quitWaited && !halted && !sessionEnding() && (onlineReleased || (mainOnline && mainOnline.cloud.view().status !== "off"))) {
    e.preventDefault();
    quitWaited = true;
    void releaseOnline().finally(() => app.quit());
    return;
  }
  quitting = true;
  for (const id of intervals) clearInterval(id);
  clock.stop();
  anchor?.stop(); // 헬퍼도 멈춘다
  lifetime?.stop();
  tray?.destroy();
  tray = null;
  updater?.stop();
  commands?.stop();
  mainTrade?.session.stop();
  mainTrade = null;
  tradeScreen = null;
  mainOnline?.dispose();
  mainOnline = null;
  mainMail = null;
  bannerWin?.close();
  screenPicker?.close();
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
