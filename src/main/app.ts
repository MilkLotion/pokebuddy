// 펫 오버레이 메인 프로세스 — 기동 · 단일 인스턴스 · 종료 순서. 얇게 — 배선만 (옛 main.js 1398줄을 역할별 파일로 나눈 뒤 남은 것)
// 동반자 하나로 돈다 — 기기당 하나, 항상 위. 놀이공간(화면 전체·영역)에 머물고, 맨 앞 터미널 창의 에이전트 상태를 따른다 (follow/front).
// 트레이로 끝낸다. 세션 펫·창 펫 모드는 2026-09-27 에 지웠다 (worklog/records/game-runtime/record.md "세션·창 모드 삭제")
// 설정·경로는 config.js에서 읽음. 육성과 해금은 writer만 갱신
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, nativeImage, powerMonitor, safeStorage, screen, shell, Notification } from "electron";
import { starters, unlockRules } from "../dex/unlocks";
import { appearanceOf } from "../dex/look";
import type { HelperWindow, SelfMark } from "../follow/types";
import { prepareSaveKey, setAsideKeyAndSave, type PrepareSaveKeyOptions } from "../save/key";
import { isSealedOnDisk } from "../save/save-file";
import { createAnchor, type Anchor, type AnchorUpdate } from "./anchor";
import { createArtLoader } from "./art";
import { createOverworldSource } from "./overworld-art";
import { createCommands, type Commands } from "./commands";
import { STAGE_RULES } from "./layout";
import { createScreenPicker, screenViews, type ScreenPicker } from "./windows/screen-picker";
import { screensNow as currentScreens } from "./windows/display";
import { clearFailure, createLifetime, reportFailure, type Lifetime } from "./lifetime";
import { jumpListOf, lockExcept, petMenu, petMenuOf, trayMenuOf } from "../view/menus";
import { createSaveParty, type PartyPet, type SaveParty } from "./save-party";
import { createGame, type GameV3 } from "./game";
import { createMainTrade, type MainTrade } from "./trade";
import { createTradeScreen, type TradeScreenBuilder } from "./trade-screen";
import { cloudSeedOf, createMainOnline, type MainOnline } from "./online";
import { seededRand } from "../verify/save-rules";
import { askBlocked, askConfirm, askLost, askSaveLocked, askUpdateRequired, askHeld, askKicked } from "./halt-dialog";
import type { HaltInfo, HaltReason, OwnerKind } from "../online/cloud-state.js";
import { createMainMail, type MainMail } from "./mail";
import { mailCodeOf } from "../online/codes.js";
import { callRpc } from "../online/server-call.js";
import { pendingTradeOf } from "../party/pet-actions";
import { formsOf } from "../dex/forms";
import { openManage, pushAccount, pushClock, pushMail, pushTrade, pushUpdate } from "./manage-window";
import { createAppUpdater, urgentStep, type AppUpdater } from "./update/updater";
import { createMacUpdater } from "./update/mac-updater";
import { createPatchNotes, type PatchNotes } from "./patch-notes";
import { createPortraits, portraitKey, type Portraits } from "./portraits";
import { startKeepOnTop } from "./keep-on-top";
import { CLOCK_RULES, createClock, type ClockTick } from "./clock";
import { askRegion } from "./windows/region-window";
import { createBannerWindow, type BannerWindow } from "./windows/banner-window";
import { PATHS, PROJECT, loadConfig } from "./paths";
import { logoFile, preloadFile, rendererFile } from "./windows/files";
import { askStarter } from "./windows/picker-window";
import { createStage } from "./stage";
import { createStageGroup, type StageGroup } from "./stage-group";
import { createStageWindow } from "./stage-window";
import { langOf, petLabel, setLang, t } from "./text";
import { createTray, type TrayHandle } from "./tray";
import { syncJumpList } from "./jump-list";
import { closeMenu, closedWithin, menuBounds, menuOpen, popupMenu } from "./menu-window";
import { gainOf } from "../state/settings";
import { SOUND_RULES } from "../state/rules";
import { STATE_RULES } from "../state/rules";
import { createNotifier, type Notifier } from "../notify/notifier";
import { rollHits } from "../find/roll";
import { createHookUpkeep, type HookUpkeep } from "./hook-upkeep";
import type { MailAction } from "../shared/model/mail";
import type { ManageRoute } from "../shared/model/route";
import type { PatchNotesView, UpdateAction, UpdateView } from "../shared/model/account";
import type { Command } from "../shared/command";
import { createBubbles } from "./stage/bubbles";
import { createCoach } from "./stage/coach";
import { createCry } from "./stage/cry";
import { createDebugLog, redirectOutput } from "./app/log";
import { devNumber, isDevRun, isUpdateTestBuild } from "./app/dev-run";
import { claimSingleInstance, tradeLinkOf } from "./app/launch";
import { createDisplayState } from "./app/display-state";

// 에이전트 작업 시간 — 1초 틱마다 running 이던 만큼 쌓아 두고, 게임 틱에 넘기고 비운다
let workMs = 0;
// 전역 시계 — 1초마다 틱을 낸다 (src/main/clock.ts)
const clock = createClock({ onError: (e) => log?.({ clock: "error", message: String(e) }) });
// 그림 캐시 — 관리 창·선택 창과 무대 말풍선 아이콘이 함께 쓴다 (src/main/portraits.ts). main() 에서 만든다
let portraits: Portraits | null = null;
// 화면이 잠겨 있다 — 잠긴 동안은 게임 틱을 돌리지 않는다. 풀리면 다음 틱이 그 틈을 버린다(game.tick 은 틈을 TIME_RULES.maxElapsedMs 로 자른다 — src/state/time.ts elapsedSince).
// 절전은 폴링이 멈춰 저절로 같은 결과가 된다. 잠금만 하고 절전하지 않으면 폴링이 계속 돌아 따로 막는다 (2026-09-27)
let screenLocked = false;

// POKEBUDDY_LOG 가 있으면 출력(console·stderr)을 그 파일에 이어 쓴다 (src/main/app/log.ts)
redirectOutput(process.env.POKEBUDDY_LOG);

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
// POKEBUDDY_DEBUG — 판정 로그를 JSON 한 줄씩 (src/main/app/log.ts)
const log = createDebugLog(debug);

// 작업 표시줄·점프 목록이 설치본 바로 가기(scripts/build-exe.cjs appId)와 같은 앱으로 묶이게 — 앱 이름 줄이 "PokeBuddy" 로 보인다
// 업데이트 실기 시험 빌드(scripts/build-exe.cjs PB_UPDATE_TEST)는 다른 ID 를 쓰고, 사용자의 설치본이 가진 OS 등록(링크·로그인 시 시작)을 건드리지 않는다
const updateTestBuild = isUpdateTestBuild();
// 시험 빌드는 로그인 키체인을 쓰지 않는다 — safeStorage(src/main/trade.ts)가 키를 만들며 키체인 대화상자를 띄운다
// (2026-09-28 mac 업데이트 실기 시험에서 "…Key 를 저장할 키체인을 찾을 수 없습니다" 가 뜸). 업데이트 도우미가 open 으로 다시 켤 때도 적용되게 앱이 스스로 켠다
if (updateTestBuild) app.commandLine.appendSwitch("use-mock-keychain");
if (process.platform === "win32") app.setAppUserModelId(updateTestBuild ? "io.github.milklotion.pokebuddy.updatetest" : "io.github.milklotion.pokebuddy");

// 동반자는 기기당 하나 — 둘째는 창을 만들기 전에 끝난다. 다시 실행·딥링크는 떠 있는 동반자가 받는다 (src/main/app/launch.ts)
// 처리기는 이벤트가 올 때 부른다 — 아래에 정의한 함수를 화살표로 감싸 넘긴다
const duplicate = !claimSingleInstance({
  onCare: (care) => runGameCommand({ cmd: care.action, target: care.petId, from: "menu" }),
  onTradeLink: (link) => openTradeLink(link),
  onOpen: (route) => openManageWindow(route),
});

// 표시 상태 — 숨김·고스트 모드, 저장 설정의 미러(놀이공간·잠들기 기준·로그인 시 시작) (src/main/app/display-state.ts)
// 콜백은 아래에 정의한 핸들을 부를 때 읽는다 — 부팅 전에는 부르지 않는다
const display = createDisplayState({
  ghost: !!config.clickThrough,
  settings: () => game?.read()?.settings ?? null,
  screens: currentScreens,
  mayLogin: app.isPackaged && !updateTestBuild,
  onPlayArea: () => anchor?.poll(), // 무대 사각형을 바로 다시 정한다
  onHidden: () => {
    anchor?.poll();
    syncCoach(); // 숨긴 동안 바탕화면 튜토리얼은 기다린다
  },
  onGhost: (on) => {
    // 들고 있는 중에 고스트 모드를 켜면 pointerup 이 영영 안 온다 — 커서에 붙은 채로 남지 않게 놓는다
    if (on) stages?.releaseHeld();
    // 무대는 늘 통과로 시작해 그림 위에서만 받는다 — 커서 밑은 다음 hoverTick 이 본다
    stages?.setPassing(true);
    stages?.sendClickThrough(on);
    syncCoach(); // 고스트 모드 동안 바탕화면 튜토리얼은 기다린다
  },
  log,
});

// 펫 자신을 가리는 표 — 개발 실행은 Electron 이라 이름으로 함께 걸러야 맨 앞 창에서 빠진다 (follow/front frontWindow)
const SELF: SelfMark = { pid: process.pid, appNames: new Set(["electron", String(app.getName() || "").toLowerCase()]) };

// 끝내는 중 — 창이 파괴되는 사이에 주기 작업·감시·헬퍼가 그 창을 건드리지 않게 before-quit 에서 멈춘다.
// 파괴된 창을 건드려 예외가 나면 Electron 기본 처리기가 모달을 띄워 메인이 멈추고, 확인을 누르면 밀린 폴링이
// 또 던진다 — 대화상자가 끝없이 이어지고 프로세스가 끝나지 못한다
let quitting = false;
let picking = false; // 첫 실행 선택 창이 열려 있다 — 그 창이 닫혀도 앱을 끝내지 않는다 (window-all-closed)
let staged = false; // 무대 창을 만들었다 — 그 전에 닫힌 창(선택 창)으로는 끝내지 않는다
let bootReady = false; // 그림·명령·수명 잠금 준비 후에만 CLI에 성공 통지
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
const HALT_OPEN: ReadonlySet<string> = new Set(["snapshot", "trade.status", "quit"]);
// 로그아웃·계정 삭제·분실 창 [처음부터]로 새로 시작하는 중 (worklog-mac/records/cloud-authority/design-p2.md 2절 D12)
//   저장을 백업으로 옮기기 전에 쓰기·교환·우편·명령을 멈춘다. 서버 처리가 실패하면 풀고, 성공하면 앱을 다시 켠다
let restarting = false;
let lostAsking = false; // 분실 창(D29)이 떠 있다 — 겹쳐 띄우지 않는다
// 게임이 저장을 쓰면 안 되는 때 — 두 PC 규칙 멈춤이나 새로 시작하는 중
const frozen = (): boolean => halted != null || restarting;
let tradeStarted: Promise<void> = Promise.resolve(); // 교환 세션의 시작 확인 — 끝나기 전의 참가는 busy 로 거절된다
// 아직 참가하지 않은 교환 링크와 받은 시각. 링크로 처음 켜졌으면 인자에 있다. 링크 수명(참가 전 10분)이 지나면 버린다
const TRADE_LINK_TTL_MS = 10 * 60_000;
const firstLink = tradeLinkOf(process.argv);
let tradeLink: { link: string; at: number } | null = firstLink ? { link: firstLink, at: Date.now() } : null;
let tray: TrayHandle | null = null;
// 패치노트 — 켤 때 저장이 이미 있었는지로 새로 설치와 업데이트를 가른다. 그래서 첫 선택 창이 저장을 만들기 전에 만든다
const hadSave = fs.existsSync(PATHS.save);
let patchNotes: PatchNotes | null = null;
// 업데이트 필요 — 서버가 이 앱 버전을 거절한 실행. 바로 확인하고, 받으면 창을 한 번 띄운다 (src/main/update/updater.ts urgentStep)
let updateUrgent = false;
let updateChecked = false;
let updateAsked = false;
let updater: AppUpdater | null = null; // 앱 업데이트 — 설치본(Windows exe·mac 앱)만 확인한다. 개발 실행·npm 설치본은 버전만 (src/main/update/updater.ts)
let lastState: string | null = null;

// ── Electron 이 필요한 화면 계산 (anchor 의 host) ──────────────────────────────

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

// ── 배선 ─────────────────────────────────────────────────────────────────────

// 놀이공간 화면 번호 덮개 — 설정의 한 화면 목록이 열린 동안 번호를 보이고, `화면에서 고르기` 로 누른 화면을 고른다
let screenPicker: ScreenPicker | null = null;
const picker = (): ScreenPicker => (screenPicker ??= createScreenPicker({ preload: preloadFile(), html: rendererFile("screens.html"), screens: currentScreens }));

// 바탕화면 튜토리얼 말풍선과 첫 돌봄 단계 (src/main/stage/coach.ts). 저장을 새로 읽는 때(게임 틱·명령 뒤·파티 변경)에 sync 를 부른다
const coach = createCoach({
  read: () => game?.read() ?? null,
  stages: () => stages,
  quiet: () => display.ghost() || display.hidden(),
  areaMode: () => display.playArea().mode,
});
const syncCoach = (): void => coach.sync();

// 작업 표시줄 점프 목록 — 파티 포켓몬마다 밥 주기·놀아주기. 파티·이름·레벨이 바뀌면 다시 만든다 (src/main/jump-list.ts)
function syncJump(): void {
  const save = game?.read(); // 메모리 값 — 파일은 15초마다 쓴다
  if (!save) return;
  const { pets, labels } = jumpListOf(save); // 목록 고르기는 화면 값이다 (src/view/menus.ts)
  syncJumpList(pets, labels);
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

// 무대 사각형 = 놀이공간 ∩ 그 화면. 모든 화면이면 화면마다 하나. 바뀔 때만 setBounds (stage-window 가 가른다)
// 동반자는 따라갈 창 대신 놀이공간을 쓴다. 보일지는 앵커가 정한 그대로다
function onAnchorUpdate(update: AnchorUpdate): void {
  if (quitting || !stages) return;
  stages.layout(display.lanes(), display.playArea().mode === "all");
  stages.setVisible(update.visible);
}


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
    // mac 은 자체 엔진 — Squirrel.Mac 은 정식 서명이 없는 앱을 바꾸지 않는다 (src/main/update/mac-updater.ts). Windows 는 electron-updater
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
    onView: (view) => {
      pushUpdate(view);
      if (updateUrgent) urgentUpdate();
    },
    // 다시 시작 전 — 메모리 진행을 쓰고 클라우드에 올린 뒤 released 를 알린다(최대 3초). 클라우드는 멈추지 않는다 —
    // 설치가 실패해 앱이 계속 돌면 다음 하트비트가 active 로 되돌린다. 이어지는 before-quit 은 기다리지 않는다
    beforeInstall: async () => {
      if (!frozen() && saveParty()?.isWriter()) game?.flush();
      await announceOnline();
    },
  });
}

// 업데이트 필요를 받았거나 그 뒤 업데이트 상태가 바뀌었다 — 확인·창 띄우기 (worklog/records/app-update/record.md "업데이트 필요 때 바로 받기")
//   창은 게임을 멈추지 않는다. 나중에를 고르면 설정의 다시 시작·끌 때 적용이 남는다
function urgentUpdate(): void {
  if (!updater) return;
  const view = updater.view();
  const step = urgentStep(view.status, updateAsked, updateChecked);
  if (step === "check") {
    updateChecked = true;
    void updater.check();
  } else if (step === "ask") {
    updateAsked = true;
    void askUpdateRequired(view.next ?? "", view.status === "manual").then((go) => {
      if (go) void updater?.install();
    });
  }
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
      if (req.cmd === "settings.set") display.sync("all");
      syncCoach();
      return reply;
    },
    display: () => display.view(),
    petMenu: (petId) => showPetMenu(petId, "manage"),
    ...(mainOnline ? { account: mainOnline.act } : {}),
    ...(mailBox() ? { mail: async (req: MailAction) => (await mailBox()?.act(req)) ?? null } : {}),
    ...(updater ? { update: updateAct } : {}),
    ...(patchNotes ? { notes: notesAct } : {}),
    // 설정의 `영역 그리기` — 그린 영역을 저장하면 영역 지정으로 바뀐다. 취소하면 아무것도 바꾸지 않는다
    drawRegion: async () => {
      const current = game?.read()?.settings.playArea.rect ?? null;
      const rect = await askRegion({ preload: preloadFile(), html: rendererFile("region.html"), current });
      if (!rect) return { ok: false, reason: "cancelled" };
      if (!commands) return { ok: false, reason: "not-ready" };
      const reply = await commands.dispatcher.dispatch({ cmd: "settings.set", target: "playRegion", args: { value: rect }, from: "settings" });
      display.sync("play");
      return reply;
    },
    // 설정의 한 화면 — 목록, 목록이 열린 동안 번호 덮개, `화면에서 고르기`. 고른 화면을 저장하면 한 화면 방식이 된다
    screens: () => screenViews(currentScreens(), game?.read()?.settings.playArea.screen ?? null),
    identifyScreens: (on) => picker().identify(on),
    pickScreen: async () => {
      const ref = await picker().ask();
      if (!ref) return { ok: false, reason: "cancelled" };
      if (!commands) return { ok: false, reason: "not-ready" };
      const reply = await commands.dispatcher.dispatch({ cmd: "settings.set", target: "playScreen", args: { value: ref }, from: "settings" });
      display.sync("play");
      return reply;
    },
  });
};

// 트레이 메뉴 — 항목은 화면 값이 만든다(src/view/menus.ts trayMenuOf). 여기서는 누르면 할 일만 잇는다
const trayTemplate = () =>
  trayMenuOf(
    { hidden: display.hidden(), ghost: display.ghost() },
    {
      openManage: () => openManageWindow(),
      toggleHidden: display.toggleHidden,
      quit: () => app.quit(),
      toggleGhost: () => display.setGhost(!display.ghost()),
    },
  );

// 울음소리 — 놀아주기가 성공하면 무대에서 한 번 낸다 (src/main/stage/cry.ts)
const cry = createCry({
  dir: path.join(PATHS.home, "cries"),
  read: () => game?.read() ?? null,
  send: (petId, uri, volume) => stages?.sendCry(petId, uri, volume),
});

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
    syncCoach(); // 첫 돌봄 튜토리얼이 끝났을 수 있다
  });
}

// 포켓몬 메뉴 — 이름·상태 / 옮기기 / 밥 주기·놀아주기·볼에 넣기·상세 보기·모습 바꾸기 / 팔기. 앱 전체 조작은 트레이가 맡는다
// origin: stage 는 무대의 포켓몬 위 우클릭, manage 는 관리 창의 파티 카드·박스 칸 우클릭 (2026-10-02 사용자 결정 — 같은 메뉴를 쓴다).
// 관리 창의 메뉴에는 상세 보기가 없다 — 카드·칸을 좌클릭하면 바로 상세가 열린다 (2026-10-02 사용자 결정 "좌클릭으로 상세 열게")
// 박스 개체와 볼 안의 개체는 무대에 없다 — 저장의 값으로 메뉴를 만든다. 박스 개체는 밥 주기·놀아주기·볼에 넣기가 흐리다
// 공유 sid 계열이면 모습 말풍선에 넣을 초상을 먼저 받는다. 캐시에 없어 오래 걸리면 초상 없이 띄운다
const FORM_ICON_WAIT_MS = 400;
function showPetMenu(id: string, origin: "stage" | "manage" = "stage"): void {
  const pet = game?.read()?.pets.find((row) => row.id === id) ?? null;
  const forms = pet ? formsOf(pet) : [];
  const art = portraits;
  if (!pet || forms.length < 2 || !art) {
    popPetMenu(id, origin, {});
    return;
  }
  const asks = forms.map((slug) => ({ slug, shiny: pet.shiny }));
  const none: Record<string, string> = {};
  const got = art.get(asks).then(
    (uris) => Object.fromEntries(asks.flatMap((ask) => (uris[portraitKey(ask)] ? [[ask.slug, uris[portraitKey(ask)] as string]] : []))) as Record<string, string>,
    () => none,
  );
  const late = new Promise<Record<string, string>>((resolve) => setTimeout(() => resolve(none), FORM_ICON_WAIT_MS));
  void Promise.race([got, late]).then((icons) => popPetMenu(id, origin, icons));
}

// 메뉴의 모델(이름·상태·막힌 항목·첫 돌봄 잠금)은 화면 값이 만든다 (src/view/menus.ts petMenuOf). 여기서는 누르면 할 일을 잇고 띄운다
function popPetMenu(id: string, origin: "stage" | "manage", formIcons: Record<string, string>): void {
  const p = stages?.petOf(id) ?? null;
  const state = petMenuOf(game?.read() ?? null, id, { origin, stagePet: p, formIcons, now: Date.now() }); // 메모리 값 — 파일은 15초마다 쓴다
  if (!state) return;
  const firstCare = state.firstCare;
  // 첫 돌봄 튜토리얼 중이면 우클릭 메뉴에서 고른 돌봄이 튜토리얼을 끝낸다
  const careCmd = (cmd: "feed" | "play") => (): void => {
    if (firstCare) runGameCommand({ cmd, target: id, from: "menu" }, () => ({ cmd: "tutorial.done", target: "first-care", from: "pet" }));
    else runGameCommand({ cmd, target: id, from: "menu" });
  };
  const sale = state.sale;
  const built = petMenu(state.model, {
    feed: careCmd("feed"),
    play: careCmd("play"),
    ...(state.inSave
      ? {
          ball: () => runGameCommand({ cmd: state.hidden ? "party.show" : "party.hide", target: id, from: "menu" }),
          // 그 포켓몬의 개체 상세를 연다 — 메뉴는 그 포켓몬 관련 기능만 둔다 (2026-09-28 사용자 결정). 무대 우클릭 메뉴에만 있다
          ...(origin === "stage" ? { detail: () => openManageWindow({ to: "pet", petId: id }) } : {}),
          // 옮기기·팔기 — 고른 뒤의 화면(든 상태, 팔기 확인 창)은 관리 창이 그린다
          move: () => openManageWindow({ to: "move", petId: id }),
          sell: () => {
            if (sale) openManageWindow({ to: "sell", petId: id, price: sale.price });
          },
        }
      : {}),
    // 모습 말풍선에서 고른 모습 — 관리 창이 바꾸기 확인 창을 띄운다
    form: (species) => openManageWindow({ to: "form", petId: id, species }),
  });
  // 첫 돌봄 튜토리얼 2/2 — 남길 항목만 누르게 두고 말풍선에 대기 글자를 알린다
  const items = firstCare ? lockExcept(built, firstCare.keep ? [firstCare.keep] : []) : built;
  if (firstCare) coach.menuStep(firstCare.keep, firstCare.wait);
  // OS 기본 메뉴는 Windows 에서 왼쪽을 크게 비운다 — 앱이 그리는 메뉴를 커서 자리에 띄운다 (docs/specs/ui-components.md C-21)
  // 첫 돌봄 중이면 메뉴 자리를 말풍선에 알려 겹치지 않게 한다. 메뉴가 닫히면 말풍선은 제자리로 돌아간다
  const avoid = firstCare
    ? {
        onPlaced: (r: { x: number; y: number; w: number; h: number }) => coach.menuPlaced(id, r),
        // 메뉴가 닫히면 1/2(우클릭)로 되돌린다 — 메뉴 없이 "메뉴에서 …" 가 남지 않게. 스킵이 아니다
        onClosed: () => coach.menuClosed(),
      }
    : {};
  popupMenu({ preload: preloadFile(), html: rendererFile("menu.html"), ...avoid }, items, t("menu.on"));
}

// 파티 목록 → 무대. 그림을 받는 동안 기다린다. 트레이는 공식 앱 로고를 유지한다
// 친구 교환 세션 — 저장을 쓰는 동반자(writer)일 때 처음 부를 때 만들고 한 번 시작한다(로그인 확보·반영하지 않은 교환 복구).
// 교환이 끝나 개체가 바뀌면 무대를 다시 그린다
// 게임을 멈춘 동안(halted)은 만들지 않는다
function tradeSession(): MainTrade["session"] | null {
  if (quitting || frozen() || !game || !party || !party.isWriter()) return null;
  if (!mainTrade) {
    // 교환 반영을 서버에 알린 뒤 저장을 바로 올린다 — 서버가 그 교환을 저장된 것으로 보게 (design-p1.md 6절)
    // 익명 계정은 교환을 서버에 보내기 전에 거절하고, 제안 직전에는 클라우드 저장을 올린다 (design-p2.md 14절)
    const on = online();
    mainTrade = createMainTrade(
      game,
      on ?? undefined,
      () => mainOnline?.noteSaved("event"),
      cloudHold,
      on ? { isAnonymous: () => on.isAnonymous(), beforeOffer: () => on.flush(), mayIssue: () => on.mayIssue() } : undefined,
    );
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
        party?.refresh(); // 저장을 다시 읽으면 onChange 가 무대를 다시 그린다
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
  return !!(save && pendingTradeOf(save));
}

// 로그인 계정의 새 교환(만들기·참가)·선물 받기를 막아야 하는가 (worklog-mac/records/cloud-authority 검수 1)
//   클라우드 저장이 online 이고 올리기가 막히지 않았을 때(CLOUD_OWNER_OTHER·CLOUD_BAD_SAVE 없음)만 연다.
//   그 밖의 상태에서 교환·선물을 받으면 나중에 서버 저장을 받을 때 결과가 덮여 복제·유실된다
//   익명 계정은 여기서 막지 않는다 — 교환은 교환 세션이 login-required 로 거절하고(서버도 TRADE_LOGIN_REQUIRED),
//   선물 받기는 우편함이 MAIL_LOGIN_REQUIRED 로 거절한다(서버 claim_mail 도 익명 거부). 우편 목록 읽기는 익명도 된다.
//   익명이 켜는 중(connecting)이면 여기서 cloud-wait 가 먼저 나올 수 있다 — 연결이 끝나면 login-required 로 바뀐다.
//   클라우드가 멈춰(off) 있으면 계정을 직접 읽어 판정한다 — 켜는 중에도 막게. 분실(D29)로 꺼진 로그인 계정도 막는다
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
  if (quitting || frozen() || !game || !party || !party.isWriter()) return null;
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
        notifier?.settle(); // 다른 PC 에서 쌓인 미처리 상태를 배너로 쏟지 않는다 — 다음 틱보다 먼저 (src/notify/queue.ts settle)
        party?.refresh(); // 받은 클라우드 저장 — 무대와 설정창을 다시 그린다
      },
      // 밀려남·넘겨받기 확인·교환 막힘 — 게임을 멈추고 창을 띄운다. 로그아웃하지 않는다(D19)
      onHalt,
      onLost: (kind, synced) => void askLostFlow(kind, synced),
      onNotice: (text) => notifyGame(text),
      onUpdateRequired: () => {
        updateUrgent = true;
        urgentUpdate();
      },
      freeze: freezeForRestart,
      thaw: thawRestart,
      onRestart: relaunchFresh,
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
      // 서버 함수의 MAIL_* 는 그대로, 그 밖은 교환과 같은 규칙(NETWORK · UNKNOWN) — src/online/codes.ts mailCodeOf
      rpc: (fn, args) => callRpc(on.client, fn, args, mailCodeOf),
      // writer 를 놓은 뒤 끝난 받기는 저장을 쓰지 않는다 — 새 writer 의 저장을 덮어쓰지 않게. 다음에 목록을 읽을 때 복구된다
      run: (id, name, args) => (party?.isWriter() ? g.executor.run({ id, name, args }) : { ok: false, reason: "not-writer" }),
      read: () => g.read(),
      signedIn: () => on.screen().signedIn,
      hold: cloudHold,
      onChanged: () => {
        party?.refresh(); // 가방·포인트가 바뀌었다 — 설정창을 다시 그린다
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
  if (reason === "held") {
    holdAccount();
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
  const kicked = (): boolean => halted === "superseded" || halted === "held"; // 정지도 끝내는 흐름이다(검수 P4c M1)
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

// ── 저장 계정 분실(D29)과 새로 시작(D12) (worklog-mac/records/cloud-authority/design-p2.md 2절·5절·15절) ──

// 저장 계정을 잃었다 — 게임은 계속, 클라우드만 꺼져 있다. 창의 답으로 로그인(계정 탭)·이 PC 저장으로 계속·처음부터
async function askLostFlow(kind: OwnerKind, synced: boolean): Promise<void> {
  if (lostAsking || quitting) return;
  lostAsking = true;
  try {
    const answer = await askLost(kind, synced);
    const on = mainOnline;
    if (quitting || restarting || !on) return;
    if (answer === "login") openManageWindow({ to: "account" });
    else if (answer === "local") await on.continueLocal();
    else if (answer === "fresh") await on.fresh();
  } catch (e) {
    console.error("분실 창 처리에 실패했다 — 게임은 계속한다", e);
  } finally {
    lostAsking = false;
  }
}

// 새로 시작하기 직전 — 메모리 진행을 쓰고(백업에 담기게) 저장 쓰기·명령·교환·우편을 멈춘다
function freezeForRestart(): void {
  if (!frozen() && saveParty()?.isWriter()) game?.flush();
  restarting = true;
  workMs = 0;
  pauseOnlineWork();
}

// 서버 처리가 실패해 새로 시작하지 않는다 — 멈춘 것을 되돌린다
function thawRestart(): void {
  restarting = false;
  if (quitting || halted || !saveParty()?.isWriter()) return;
  commands?.setWriter(true);
  tradeSession();
}

// 저장을 백업했고 cloud.json 을 비웠다 — 앱을 다시 켠다. 다시 켜면 저장이 없어 선택 창이 뜬다(Q5).
// 끄기는 일반 종료 경로(before-quit → 저장 잠금 해제, will-quit → 동반자 lock 삭제)를 그대로 지난다. 새 프로세스는 이 프로세스가 끝난 뒤 뜬다.
// 명령으로 준 스타터(POKEBUDDY_SLUG)와 교환·계정 링크 인자는 넘기지 않는다 — 선택 창을 건너뛰거나 옛 링크로 참가하지 않게
function relaunchFresh(): void {
  delete process.env.POKEBUDDY_SLUG;
  log?.({ cloud: "restart" });
  app.relaunch({ args: process.argv.slice(1).filter((a) => !a.startsWith("pokebuddy://")) });
  app.quit();
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
  void askKicked(info).finally(() => app.quit());
}

// 이용 정지(P4c, D35) — 게임을 멈추고 온라인을 끈 뒤 정지 창을 띄우고 끝낸다. 다시 켜도 cloud.json 의 정지로 같은 창이 뜬다
function holdAccount(): void {
  if (halted === "held") return;
  halted = "held";
  haltNext = null;
  haltAbort?.abort();
  haltAbort = null;
  workMs = 0;
  pauseOnlineWork();
  if (mainOnline) pushAccount(mainOnline.screen());
  mainOnline?.dispose();
  mainOnline = null;
  log?.({ cloud: "held" });
  void askHeld().finally(() => app.quit());
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
}

// 줍기 확률 배율 — 개발 실행에서만 POKEBUDDY_FIND_RATE(양의 정수). 100 이면 초당 100/2000. 마리마다 독립은 그대로다. 실기 확인용 (src/find/rules.ts perSecond)
let findRateMemo: number | null | undefined;
const findRate = (): number | null => {
  if (findRateMemo === undefined) {
    findRateMemo = devNumber("POKEBUDDY_FIND_RATE") ?? null;
  }
  return findRateMemo;
};
// 아이콘 말풍선 — 줍기·배고픔 (src/main/stage/bubbles.ts)
const bubbles = createBubbles({ portraits: () => portraits, stages: () => stages, hidden: display.hidden });

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
// 게임 시간의 큰 틈은 `game.tick` 이 TIME_RULES.maxElapsedMs 로 자른다(src/state/time.ts elapsedSince) (docs/specs/game.md "복귀할 때 중단 기간을 소급 진행하지 않는다").
// 에이전트가 작업하는 동안 적립이 2배다. 작업 판정은 무대의 에이전트 상태 running 이다 (docs/specs/balance.md "에이전트 작업 보너스").
// 무거운 일(놀이공간·점프 목록·트레이 다시 읽기, 남은 안내)은 SLOW_EVERY 틱(15초)마다 — 1초로 당길 까닭이 없고 OS 호출이 섞여 있다
const SLOW_EVERY = Math.max(1, Math.round(STATE_RULES.saveMs / CLOCK_RULES.periodMs));
function clockTick({ now, gap, seq }: ClockTick): void {
  pushClock(now); // 관리 창·기기 창이 이 틱에 스냅샷을 다시 읽는다 (manage:clock)
  // 두 PC 규칙으로 멈췄거나 새로 시작하는 중이다 — 시간·줍기·작업 시간을 쌓지 않는다. 다시 돌면 game.tick 이 그 틈을 자른다
  if (frozen()) {
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
  if (counted && !display.hidden()) {
    const hits = rollHits(Object.fromEntries(stages.awakeIds().map((id) => [id, gap])), Math.random, findRate() ?? 1);
    const found = hits.length ? game.find(hits) : null; // 쓰지 못하면 null — 그 건은 버린다
    if (found?.length) {
      worker.refresh();
      bubbles.found(found, game.read());
    }
  }

  // 게임 시간 — 1초마다 메모리에 적용하고 파일은 STATE_RULES.saveMs 마다 쓴다 (src/main/game.ts flushMs)
  const events = game.tick({ workMs });
  if (events) workMs = 0; // 쓰지 못했으면 다음 틱에 흐른 시간과 함께 다시 넘긴다

  // 배고픔 말풍선 — 무대에 나와 있는 포켓몬만, 직접 숨긴 동안은 띄우지 않는다 (src/main/stage/bubbles.ts onTick)
  if (!display.hidden()) bubbles.onTick(now, game.read()?.pets ?? []);
  notifier?.tick(); // 부화 준비·진화 가능·업적 미수령·줍기를 배너 줄에 세운다 — 1초 안에 뜬다 (src/notify)
  syncCoach();

  if (seq % SLOW_EVERY !== 0) return;
  worker.refresh();
  hookUpkeep?.tick(); // 남은 한 번 알림이 있고 다른 배너가 없으면 띄운다
  display.sync("play"); // 다른 프로세스의 관리 창에서 바꾼 놀이공간도 따라간다
  display.sync("sleep"); // 잠들기 기준도 같다
  syncJump();
}

async function main(): Promise<void> {
  if (duplicate) return; // 둘째 동반자 — 이미 quit 을 불렀다
  // 메모리에만 있는 1초 틱 진행을 쓴다 — 잠금·절전·끄기 직전. 멈춘 동안(halted)은 쓰지 않는다
  const flushLocal = (): void => {
    if (!frozen() && saveParty()?.isWriter()) game?.flush();
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

  // 저장 키를 먼저 푼다 — 저장 읽기·쓰기가 이 키로 암호화한다 (src/save/key.ts). 기존 평문 저장은 여기서 한 번 옮긴다.
  // 비동기 safeStorage 만 쓴다 — mac 은 키체인 허용 창이 뜨면 동기 호출이 메인을 멈춘다(src/main/trade.ts 와 같은 이유)
  // 개발 실행·업데이트 시험 빌드만 POKEBUDDY_SAVE_CRYPT=off 로 새 키를 만들지 않는다 — 저장을 직접 읽는 E2E 용. 이미 키가 있으면 그대로 쓴다
  const keyOptions: PrepareSaveKeyOptions = {
    saveFile: PATHS.save,
    vault: {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptStringAsync(text),
      decrypt: (data) => safeStorage.decryptStringAsync(data),
    },
    create: !((isDevRun() || updateTestBuild) && process.env.POKEBUDDY_SAVE_CRYPT === "off"),
  };
  let saveKey = await prepareSaveKey(keyOptions);
  log?.({ boot: "save-key", ...saveKey });
  // 키 없이 도는데 암호화 저장이 있다(키체인 거부·키 파일 잠김·키 저장소 없음) — 저장을 옮기지 않고 묻는다.
  // 종료면 저장을 그대로 두고 끝낸다. 새로 시작이면 키와 저장을 백업(.unreadable-<시각>)하고 다시 준비한다 — 계정 저장은 클라우드가 받는다
  if (saveKey.status !== "ok" && saveKey.status !== "reset" && isSealedOnDisk(PATHS.save)) {
    const answer = await askSaveLocked();
    if (answer === "fresh" && setAsideKeyAndSave(PATHS.save)) {
      saveKey = await prepareSaveKey(keyOptions);
      log?.({ boot: "save-key", after: "fresh", ...saveKey });
    } else {
      reportFailure(PATHS, config.slug, t("save.locked.message"), "save-locked");
      app.quit();
      return;
    }
  }

  // 저장을 쓰는 것은 잠금을 잡은 프로세스 하나다. 실행기에 그 조건을 걸어 reader 는 쓰지 못하게 한다.
  // 두 PC 규칙으로 멈춘 동안(halted)과 새로 시작하는 중(restarting — 저장을 백업으로 옮긴다)도 쓰지 않는다
  // 쓰고 나면 클라우드 저장에 알린다 — 교환·부화·진화 등 사건(src/online/save-kind.ts)은 바로, 나머지는 2분 스로틀
  // 시간 진행은 1초마다 메모리에, 파일은 STATE_RULES.saveMs 마다 쓴다 (src/main/game.ts flushMs)
  // 시각은 전역 시계의 마지막 틱 시각이다 — 게임 시간·스냅샷·줍기가 같은 시각을 본다. 첫 틱 전에는 지금 시각 (2026-09-29 사용자 결정 "확률이나 시간 등등은 그 시간값 보게 해")
  // 알 결과는 계정 시드로 정한다(P4b, D24) — 되돌려 다시 열어도 같다. 시드가 없으면(첫 올리기 전) 평소 난수
  const eggRand = (eggId: string): (() => number) | null => {
    const seed = mainOnline ? mainOnline.cloud.seed() : cloudSeedOf(PATHS.save);
    return seed ? seededRand(seed, `egg:${eggId}`) : null;
  };
  const reader = createGame({ file: PATHS.save, eggRand, canWrite: () => !frozen() && (saveParty()?.isWriter() ?? false), onWrite: (kind) => mainOnline?.noteSaved(kind), flushMs: STATE_RULES.saveMs, now: () => clock.last()?.now ?? Date.now() });
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
      species = await askStarter({
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

  // PMD 그림이 없는 종은 걷기 대체 그림으로 무대에 세운다 (src/main/overworld-art.ts). 그것도 못 받으면 초상이다 (src/main/portrait-art.ts). 이로치 초상이 없으면 보통 초상이다
  const art = createArtLoader(PATHS, {
    overworld: createOverworldSource(PATHS.overworld),
    portrait: async (look) => {
      const ask = look.endsWith(":shiny") ? { slug: look.slice(0, -6), shiny: true } : { slug: look, shiny: false };
      const uri = (await pics.get([ask]))[portraitKey(ask)];
      return uri ? Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64") : null;
    },
  });
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
          if (id === "first-care") coach.forgetMenu();
          void commands?.dispatcher
            .dispatch({ cmd: action === "done" ? "tutorial.done" : "tutorial.skip", target: id, from: "pet" })
            .then(() => syncCoach());
        },
      }),
    createStage: (win, hooks) =>
      createStage({
        buddyMode: config.buddy,
        timeScale: runtime.buddyTimeScale,
        window: win,
        art,
        ghost: display.ghost,
        cursor: hooks.cursor,
        sleepAfterMin: display.sleepAfterMin,
        onDrop: hooks.onDrop,
        // 클릭은 놀아주기 (src/main/commands.ts). 울음소리는 놀아주기가 쿨타임이어도 클릭할 때마다 낸다 — 반응을 들려준다
        onClick: (id) => {
          // 바탕화면 튜토리얼 중에는 왼쪽 클릭이 놀아주기가 아니다 — 무대 렌더러가 먼저 막고, 여기서 한 번 더 막는다
          if (coach.isShown()) return;
          void commands?.click(id);
          void cry.play(id);
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
  display.sync("play");
  display.sync("sleep"); // 첫 마리부터 설정의 잠들기 기준으로 만든다
  stages.layout(display.lanes(), display.playArea().mode === "all");
  staged = true;

  anchor = createAnchor({
    paths: PATHS,
    self: SELF,
    host: {
      platform: process.platform,
      offScreen,
      quitting: () => quitting,
    },
    flags: () => ({ userHidden: display.hidden(), held: stages?.heldId() != null }),
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
      care: (id, action) => {
        stages?.care(id, action);
        if (action === "play") void cry.play(id); // 메뉴·관리 창에서 고른 놀아주기
      },
      petIds: () => stages?.petIds() ?? [],
      size: () => stages?.size() ?? { w: 0, h: 0 },
      visible: () => !!stages?.isVisible(),
    },
    settings: {
      hidden: display.hidden,
      setHidden: display.setHidden,
      clickThrough: display.ghost,
      setClickThrough: display.setGhost,
    },
    quit: () => app.quit(),
    log,
    trade: tradeSession,
    tradeScreen: () => (mainTrade && tradeScreen ? tradeScreen.build(mainTrade.session.view()) : null),
  });
  // 두 PC 규칙으로 멈춘 동안(halted)·새로 시작하는 중(restarting) — 저장을 바꾸는 명령은 실행기로 보내지 않고 멈춤 사유로 거절한다.
  // 무대 클릭(commands.click)·메뉴·관리 창·mailbox 가 모두 이 dispatch 를 지난다. 읽기·무대 반응·끄기만 연다
  const dispatchNow = commands.dispatcher.dispatch.bind(commands.dispatcher);
  commands.dispatcher.dispatch = (command) =>
    frozen() && !HALT_OPEN.has(command.cmd) ? Promise.resolve({ ok: false, reason: "halted" }) : dispatchNow(command);
  saveSource.onRole((w) => {
    commands?.setWriter(w && !frozen());
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
    display.sync("sleep"); // 밖에서 바뀐 저장(다른 프로세스·클라우드 받기)의 잠들기 기준을 바로 따른다
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
    popup: popupTrayMenu,
    open: () => openManageWindow(),
    menuOpen,
    closeMenu,
    closedWithin,
  });

  display.setGhost(display.ghost());
  syncJump();
  display.sync("login");
  display.sync("play");
  syncCoach();
  bootReady = true;
  lifetime.check(); // 창이 생겼으니 lock 파일에 ready 를 적는다 — pokebuddy companion 이 이걸 보고 기다림을 끝낸다

  intervals.push(setInterval(stateTick, STAGE_RULES.statePollMs));
  clock.on(clockTick);
  clock.start();
  intervals.push(setInterval(() => stages?.tick(), STAGE_RULES.tickMs));
  // Windows 는 무대 창의 "항상 위"가 풀리거나 다른 항상 위 창에 밀린다 — 1초마다 다시 건다 (src/main/keep-on-top.ts)
  const keepTop = startKeepOnTop(() => stages);
  if (keepTop) intervals.push(keepTop);
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
  // 메모리에만 있는 1초 틱 진행을 먼저 쓴다 — 클라우드 올리기가 그 값을 보게 (src/main/game.ts flush).
  // 멈춘 동안(halted)·새로 시작하는 중(restarting — 저장을 이미 백업으로 옮겼다)은 쓰지 않는다
  if (!frozen() && saveParty()?.isWriter()) game?.flush();
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
