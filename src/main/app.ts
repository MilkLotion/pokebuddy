// 펫 오버레이 메인 프로세스 — 기동 · 단일 인스턴스 · 종료 순서. 얇게 — 배선만 (옛 main.js 1398줄을 역할별 파일로 나눈 뒤 남은 것)
// 동반자 하나로 돈다 — 기기당 하나, 항상 위. 놀이공간(화면 전체·영역)에 머물고, 맨 앞 터미널 창의 에이전트 상태를 따른다 (terminal/front).
// 트레이로 끝낸다. 세션 펫·창 펫 모드는 2026-09-27 에 지웠다 (worklog/records/game-runtime/game-runtime.md "세션·창 모드 삭제")
// 설정·경로는 src/platform/paths.ts·user-config.ts 에서 읽음. 육성과 해금은 writer만 갱신
import fs from "node:fs";
import path from "node:path";
import { app, nativeImage, screen, Notification } from "electron";
import { appearanceOf } from "../dex/look";
import type { HelperWindow, SelfMark } from "../terminal/types";
import { createHostWatch, type HostWatch, type HostWatchUpdate } from "./stage/host-watch";
import { createArtLoader, type ArtLoader } from "./art/stage-art";
import { createOverworldSource } from "./art/overworld-art";
import { createCommands, type Commands } from "./app/commands";
import { STAGE_RULES } from "./stage/layout";
import { createScreenPicker, screenViews, type ScreenPicker } from "./windows/screen-picker";
import { screensNow as currentScreens } from "./windows/display";
import type { Lifetime } from "./app/lifetime";
import { writeLastError } from "../platform/last-error.js";
import { createSaveParty, type SaveParty } from "../save/save-party.js";
import { partyPetsOf, type PartyPet } from "../view/party-pet.js";
import { createGame, type GameV3 } from "../tx/game.js";
import { readCloudSeed } from "../online/cloud-file.js";
import { seededRand } from "../verify/save-rules";
import { askSaveLocked, askUpdateRequired } from "./app/halt-dialog";
import { createManage } from "./manage/window.js";
import { createUpdateService } from "./services/update";
import { createServices } from "./services/registry";
import { createFreeze } from "./app/freeze";
import { createHalt } from "./app/halt";
import type { Portraits } from "./art/portraits";
import { artServices } from "./art/services";
import { startKeepOnTop } from "./stage/keep-on-top";
import { CLOCK_RULES, createClock } from "./app/clock";
import { askRegion } from "./windows/region-window";
import { createBannerWindow, type BannerWindow } from "./windows/banner-window";
import { PATHS, PROJECT } from "../platform/paths";
import { readConfig } from "../platform/user-config";
import { logoFile, preloadFile, rendererFile } from "./windows/files";
import { createStage } from "./stage/stage";
import { createStageGroup, type StageGroup } from "./stage/stage-group";
import { createStageWindow } from "./stage/stage-window";
import { currentLang, langOf, petLabel, petName, setLang, t } from "../view/text";
import { failTextOf } from "../shared/fail-text";
import { createTray, type TrayHandle } from "./menus/tray";
import { closeMenu, closedWithin, isMenuOpen } from "./menus/menu-window";
import { createPetMenu } from "./menus/pet-menu";
import { createTrayMenu } from "./menus/tray-menu";
import { gainOf } from "../state/settings";
import { SOUND_RULES } from "../state/rules";
import { createNotifier, type Notifier } from "../notify/notifier";
import { bannerOf } from "../view/banner";
import { writeAtomic } from "../platform/atomic-write";
import { readJsonFile } from "../platform/json-file";
import { createHookUpkeep, type HookUpkeep } from "./app/hook-upkeep";
import type { MailAction } from "../shared/model/mail";
import type { ManageRoute } from "../shared/model/route";
import type { Command } from "../shared/command";
import { createBubbles } from "./stage/bubbles";
import { createCoach } from "./stage/coach";
import { createCry } from "./stage/cry";
import { createDebugLog, redirectOutput } from "./app/log";
import { isDevRun, isUpdateTestBuild } from "./app/dev-run";
import { claimSingleInstance, tradeLinkOf } from "./app/launch";
import { createDisplayState } from "./app/display-state";
import { createPower } from "./app/power";
import { createTicks } from "./app/ticks";
import { createRun } from "./app/quit";
import { bootClaim, bootLifetime, bootPrefetch, bootSaveKey, bootStarter, type BootSteps, type Runtime } from "./app/boot";

// 전역 시계 — 1초마다 틱을 낸다 (src/main/app/clock.ts)
const clock = createClock({ onError: (e) => log?.({ clock: "error", message: String(e) }) });
// 부팅이 만든 핸들 한 벌 — 처음은 모두 비어 있고 부팅 단계가 채운다. 끌 때 run 의 stop 이 정리한다 (src/main/app/boot.ts Runtime)
const rt: Runtime = {
  portraits: null,
  game: null,
  notifier: null,
  hookUpkeep: null,
  bannerWin: null,
  party: null,
  lifetime: null,
  stages: null,
  hostWatch: null,
  commands: null,
  tray: null,
  screenPicker: null,
};

// POKEBUDDY_LOG 가 있으면 출력(console·stderr)을 그 파일에 이어 쓴다 (src/main/app/log.ts)
redirectOutput(process.env.POKEBUDDY_LOG);

// Electron 캐시·세션 폴더를 펫 데이터 아래로 — 기본값(~/Library/Application Support/<패키지 이름>)은
// 패키지 이름이 바뀌면 옛 폴더가 버려지고, uninstall --purge 로도 안 지워진다. ready 전에 정해야 한다
app.setPath("userData", PATHS.electronData);
// 디스크 캐시를 끈다 — 펫은 로컬 파일과 data URL 만 그려 캐시가 필요 없고, 여러 마리가 같은 폴더의
// 캐시 파일을 동시에 잡으면 Chromium 이 "Failed to open …/GPUCache" 오류를 줄줄이 남긴다
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

const config = readConfig();
const { runtime } = config;
const { debug } = runtime;
setLang(langOf(config));
// POKEBUDDY_DEBUG — 판정 로그를 JSON 한 줄씩 (src/main/app/log.ts)
const log = createDebugLog(debug);

// 작업 표시줄·점프 목록이 설치본 바로 가기(scripts/build-exe.cjs appId)와 같은 앱으로 묶이게 — 앱 이름 줄이 "PokeBuddy" 로 보인다
// 업데이트 실기 시험 빌드(scripts/build-exe.cjs PB_UPDATE_TEST)는 다른 ID 를 쓰고, 사용자의 설치본이 가진 OS 등록(링크·로그인 시 시작)을 건드리지 않는다
const updateTestBuild = isUpdateTestBuild();
// 시험 빌드는 로그인 키체인을 쓰지 않는다 — safeStorage(src/main/services/vault.ts)가 키를 만들며 키체인 대화상자를 띄운다
// (2026-09-28 mac 업데이트 실기 시험에서 "…Key 를 저장할 키체인을 찾을 수 없습니다" 가 뜸). 업데이트 도우미가 open 으로 다시 켤 때도 적용되게 앱이 스스로 켠다
if (updateTestBuild) app.commandLine.appendSwitch("use-mock-keychain");
if (process.platform === "win32") app.setAppUserModelId(updateTestBuild ? "io.github.milklotion.pokebuddy.updatetest" : "io.github.milklotion.pokebuddy");

// 동반자는 기기당 하나 — 둘째는 창을 만들기 전에 끝난다. 다시 실행·딥링크는 떠 있는 동반자가 받는다 (src/main/app/launch.ts)
// 처리기는 이벤트가 올 때 부른다 — 아래에 정의한 함수를 화살표로 감싸 넘긴다
const duplicate = !claimSingleInstance({
  onTradeLink: (link) => services.openTradeLink(link),
  onOpen: (route) => openManageWindow(route),
});

// 표시 상태 — 숨김·고스트 모드, 저장 설정의 미러(놀이공간·잠들기 기준·로그인 시 시작) (src/main/app/display-state.ts)
// 콜백은 아래에 정의한 핸들을 부를 때 읽는다 — 부팅 전에는 부르지 않는다
const display = createDisplayState({
  ghost: !!config.clickThrough,
  settings: () => rt.game?.read()?.settings ?? null,
  screens: currentScreens,
  mayLogin: app.isPackaged && !updateTestBuild,
  onPlayArea: () => rt.hostWatch?.poll(), // 무대 사각형을 바로 다시 정한다
  onHidden: () => {
    rt.hostWatch?.poll();
    syncCoach(); // 숨긴 동안 바탕화면 튜토리얼은 기다린다
  },
  onGhost: (on) => {
    // 들고 있는 중에 고스트 모드를 켜면 pointerup 이 영영 안 온다 — 커서에 붙은 채로 남지 않게 놓는다
    if (on) rt.stages?.releaseHeld();
    // 무대는 늘 통과로 시작해 그림 위에서만 받는다 — 커서 밑은 다음 hoverTick 이 본다
    rt.stages?.setPassing(true);
    rt.stages?.sendClickThrough(on);
    syncCoach(); // 고스트 모드 동안 바탕화면 튜토리얼은 기다린다
  },
  log,
});

// 펫 자신을 가리는 표 — 개발 실행은 Electron 이라 이름으로 함께 걸러야 맨 앞 창에서 빠진다 (terminal/front frontWindow)
const SELF: SelfMark = { pid: process.pid, appNames: new Set(["electron", String(app.getName() || "").toLowerCase()]) };

// 실행 단계와 끄기 순서 (src/main/app/quit.ts). 끝내는 중에는 주기 작업·감시·헬퍼가 파괴되는 창을 건드리지 않게 먼저 멈춘다
const run = createRun({
  // 멈춘 동안(halted)·새로 시작하는 중(restarting — 저장을 이미 백업으로 옮겼다)은 쓰지 않는다
  flush: () => {
    if (!frozen() && saveParty()?.isWriter()) rt.game?.flush();
  },
  shouldRelease: () => !freeze.reason() && !halt.sessionEnding() && (halt.releaseStarted() || (services.current()?.cloud.view().status ?? "off") !== "off"),
  release: () => halt.releaseOnce(),
  stop: () => {
    clock.stop();
    rt.hostWatch?.stop(); // 헬퍼도 멈춘다
    rt.lifetime?.stop();
    rt.tray?.destroy();
    rt.tray = null;
    update.stop();
    rt.commands?.stop();
    services.dispose();
    rt.bannerWin?.close();
    rt.screenPicker?.close();
    rt.bannerWin = null;
    rt.party?.stop(); // 저장 잠금을 놓는다
  },
  dropLock: () => rt.lifetime?.release(), // 내 lock 을 지운다
});
const quitting = (): boolean => run.quitting();

const saveParty = (): SaveParty | null => rt.party;
// 멈춤 상태 — 두 PC 규칙 멈춤·이용 정지·새로 시작하는 중. 멈춘 동안 저장을 쓰지 않는다 (src/main/app/freeze.ts)
const freeze = createFreeze();
const frozen = (): boolean => freeze.frozen();
// 멈춘 동안에도 받는 명령 — 저장을 바꾸지 않는다(읽기·무대 반응·끄기)
const HALT_OPEN: ReadonlySet<string> = new Set(["snapshot", "trade.status", "quit"]);
// 온라인(계정·클라우드 저장)·친구 교환·우편함과 받아 둔 교환 링크 — writer 인 동반자만 가진다 (src/main/services/registry.ts)
// 링크로 처음 켜졌으면 인자에 있다. 링크 수명(참가 전 10분)이 지나면 버린다
const services = createServices({
  ready: () => !quitting() && !frozen() && !!rt.game && !!rt.party && rt.party.isWriter(),
  game: () => rt.game,
  isWriter: () => rt.party?.isWriter() ?? false,
  saveFile: PATHS.save,
  firstLink: tradeLinkOf(process.argv),
  refreshParty: () => rt.party?.refresh(),
  openTrade: () => openManageWindow({ to: "trade" }),
  sendTrade: (screen) => manage.send("manage:trade", screen),
  sendAccount: (screen) => manage.send("manage:account-view", screen),
  sendMail: (screen) => manage.send("manage:mail-view", screen),
  online: {
    onSaveReplaced: () => {
      rt.notifier?.settle(); // 다른 PC 에서 쌓인 미처리 상태를 배너로 쏟지 않는다 — 다음 틱보다 먼저 (src/notify/queue.ts settle)
      rt.party?.refresh(); // 받은 클라우드 저장 — 무대와 설정창을 다시 그린다
    },
    // 밀려남·넘겨받기 확인·교환 막힘 — 게임을 멈추고 창을 띄운다. 로그아웃하지 않는다(D19)
    onHalt: (reason, info) => halt.onHalt(reason, info),
    onLost: (kind, synced) => void halt.onLost(kind, synced),
    onNotice: (text) => notifyGame(text),
    onUpdateRequired: () => update.urgent(),
    freeze: () => halt.freezeForRestart(),
    thaw: () => halt.thawRestart(),
    onRestart: () => halt.relaunchFresh(),
  },
});

// 멈추기 절차 — 두 PC 규칙 멈춤·이용 정지·저장 계정 분실·새로 시작과 끄기 전 클라우드 정리 (src/main/app/halt.ts)
const halt = createHalt({
  freeze,
  services,
  quitting,
  isWriter: () => saveParty()?.isWriter() ?? false,
  flush: () => rt.game?.flush(),
  resetWork: () => ticks.resetWork(),
  setWriter: (on) => rt.commands?.setWriter(on),
  sendAccount: () => {
    const on = services.current();
    if (on) manage.send("manage:account-view", on.screen());
  },
  openManage: (route) => openManageWindow(route),
  log,
});
// 앱 업데이트·패치노트 (src/main/services/update.ts). 패치노트는 켤 때 저장이 이미 있었는지로 새로 설치와 업데이트를 가른다 —
// 그래서 첫 선택 창이 저장을 만들기 전에 잰다. 켜기(start)는 수명 잠금을 쥔 뒤에 한다
const update = createUpdateService({
  notesFile: path.join(PROJECT, "data", "patch-notes.json"),
  seenFile: path.join(path.dirname(PATHS.save), "notes-seen.json"),
  hadSave: fs.existsSync(PATHS.save),
  onView: (view) => manage.send("manage:update-view", view),
  beforeInstall: async () => {
    if (!frozen() && saveParty()?.isWriter()) rt.game?.flush();
    await halt.announceRelease();
  },
  askRequired: askUpdateRequired,
});

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
const picker = (): ScreenPicker => (rt.screenPicker ??= createScreenPicker({ preload: preloadFile(), html: rendererFile("screens.html"), screens: currentScreens }));

// 바탕화면 튜토리얼 말풍선과 첫 돌봄 단계 (src/main/stage/coach.ts). 저장을 새로 읽는 때(게임 틱·명령 뒤·파티 변경)에 sync 를 부른다
const coach = createCoach({
  read: () => rt.game?.read() ?? null,
  stages: () => rt.stages,
  quiet: () => display.ghost() || display.hidden(),
  areaMode: () => display.playArea().mode,
});
// 바탕화면 튜토리얼이 떠 있는 동안 설정창의 창 단추 자리도 어둡게 한다 (94 1-1)
const syncCoach = (): void => {
  coach.sync();
  manage.setStageCoachDim(coach.isShown());
};

// 트레이 메뉴와 트레이 입력 — 떠 있는 동안 헬퍼에 입력을 자주 묻는다 (src/main/menus/tray-menu.ts)
const trayMenu = createTrayMenu({
  display,
  openManage: () => openManageWindow(),
  quit: () => app.quit(),
  pollInput: () => rt.hostWatch?.poll(),
  trayRect: () => rt.tray?.bounds() ?? null,
  holdClick: (ms) => rt.tray?.holdClick(ms),
});

// 무대 사각형 = 놀이공간 ∩ 그 화면. 모든 화면이면 화면마다 하나. 바뀔 때만 setBounds (stage-window 가 가른다)
// 동반자는 따라갈 창 대신 놀이공간을 쓴다. 보일지는 앵커가 정한 그대로다
function onHostWatchUpdate(update: HostWatchUpdate): void {
  if (quitting() || !rt.stages) return;
  rt.stages.layout(display.lanes(), display.playArea().mode === "all");
  rt.stages.setVisible(update.visible);
}


const firstPet = (): PartyPet | null => {
  const id = rt.stages?.petIds()[0];
  return id ? (rt.stages?.petOf(id) ?? null) : null;
};
const displayName = (): string => {
  const p = firstPet();
  return p ? petLabel(p) : partyPetsOf(rt.party?.save() ?? null, true)[0]?.species ?? config.slug;
};

// 관리 창의 명령도 커맨드 처리기를 거친다. reader 면 mailbox 로 writer 에 보내고,
// 진화 그림 준비와 무대 반응도 다른 표면과 같은 길로 간다
// route — 알림 배너의 `바로가기` 가 옮겨 갈 곳
// 설정창 — 부팅 때 한 번 만든다. 늦게 생기는 서비스(계정·우편·업데이트)는 열 때마다 읽는다 (src/main/manage/window.ts)
const manage = createManage({
  preload: preloadFile(),
  html: rendererFile("manage.html"),
  game: () => rt.game,
  send: async (req) => {
    if (!rt.commands) return { ok: false, reason: "not-ready" };
    const reply = await rt.commands.dispatcher.dispatch({ cmd: req.cmd as Command["cmd"], target: req.target, args: req.args, from: "settings" });
    if (req.cmd === "settings.set") display.sync("all");
    syncCoach();
    return reply;
  },
  services: () => ({
    display: () => display.view(),
    petMenu: (petId) => petMenu.open(petId, "manage"),
    ...(services.current() ? { account: services.current()!.act } : {}),
    ...(services.mail() ? { mail: async (req: MailAction) => (await services.mail()?.act(req)) ?? null } : {}),
    ...(update.isStarted() ? { update: update.act, notes: update.notes } : {}),
    // 설정의 `영역 그리기` — 그린 영역을 저장하면 영역 지정으로 바뀐다. 취소하면 아무것도 바꾸지 않는다
    drawRegion: async () => {
      const current = rt.game?.read()?.settings.playArea.rect ?? null;
      const rect = await askRegion({ preload: preloadFile(), html: rendererFile("region.html"), current });
      if (!rect) return { ok: false, reason: "cancelled" };
      if (!rt.commands) return { ok: false, reason: "not-ready" };
      const reply = await rt.commands.dispatcher.dispatch({ cmd: "settings.set", target: "playRegion", args: { value: rect }, from: "settings" });
      display.sync("play");
      return reply;
    },
    // 설정의 한 화면 — 목록, 목록이 열린 동안 번호 덮개, `화면에서 고르기`. 고른 화면을 저장하면 한 화면 방식이 된다
    screens: () => screenViews(currentScreens(), rt.game?.read()?.settings.playArea.screen ?? null),
    identifyScreens: (on) => picker().identify(on),
    pickScreen: async () => {
      const ref = await picker().ask();
      if (!ref) return { ok: false, reason: "cancelled" };
      if (!rt.commands) return { ok: false, reason: "not-ready" };
      const reply = await rt.commands.dispatcher.dispatch({ cmd: "settings.set", target: "playScreen", args: { value: ref }, from: "settings" });
      display.sync("play");
      return reply;
    },
  }),
});
const openManageWindow = (route?: ManageRoute): void => {
  if (!rt.game) return;
  manage.open(route);
};

// 울음소리 — 놀아주기가 성공하면 무대에서 한 번 낸다 (src/main/stage/cry.ts)
const cry = createCry({
  cries: () => artServices().cries,
  read: () => rt.game?.read() ?? null,
  send: (petId, uri, volume) => rt.stages?.sendCry(petId, uri, volume),
});

function notifyGame(body: string): void {
  try {
    if (Notification.isSupported()) new Notification({ title: "pokebuddy", body }).show();
  } catch (e) { log?.({ notification: "failed", message: String(e) }); }
}

// then — 성공하면 이어서 보낼 명령(첫 돌봄 튜토리얼 완료)
function runGameCommand(command: Command, then?: () => Command): void {
  void rt.commands?.dispatcher.dispatch(command).then(async (result) => {
    if (!result.ok) notifyGame(t("game.failed", { reason: failTextOf(result.reason, "command", currentLang()).text })); // 설정창과 같은 실패 문구표 (94 항목 4-7)
    else if (then) {
      try {
        await rt.commands?.dispatcher.dispatch(then());
      } catch (e) {
        console.error(e); // 튜토리얼 기록이 실패해도 트레이·말풍선은 맞춘다 — 다음 메뉴 선택 때 다시 끝난다
      }
    }
    syncCoach(); // 첫 돌봄 튜토리얼이 끝났을 수 있다
  });
}

// 포켓몬 메뉴 — 무대의 우클릭과 관리 창의 파티 카드·박스 칸 우클릭이 같은 메뉴를 쓴다 (src/main/menus/pet-menu.ts)
const petMenu = createPetMenu({
  read: () => rt.game?.read() ?? null,
  stagePet: (petId) => rt.stages?.petOf(petId) ?? null,
  portraits: () => rt.portraits,
  run: runGameCommand,
  openManage: (route) => openManageWindow(route),
  coach,
});

// 파티 목록 → 무대. 그림을 받는 동안 기다린다. 트레이는 공식 앱 로고를 유지한다
async function refreshParty(): Promise<void> {
  if (!rt.party || !rt.stages) return;
  await rt.stages.setParty(partyPetsOf(rt.party.save(), true));
  rt.tray?.setIcon(logoFile(256));
}

// 아이콘 말풍선 — 줍기·배고픔 (src/main/stage/bubbles.ts)
const bubbles = createBubbles({ portraits: () => rt.portraits, stages: () => rt.stages, hidden: display.hidden });

// 에이전트 상태 폴링(500ms)과 전역 시계의 1초 틱 (src/main/app/ticks.ts)
const ticks = createTicks({
  sendClock: (now) => manage.send("manage:clock", { now }),
  frozen,
  locked: () => power.isLocked(),
  hostWatch: () => rt.hostWatch,
  stages: () => rt.stages,
  worker: () => saveParty(),
  game: () => rt.game,
  hidden: display.hidden,
  bubbles,
  notifierTick: () => rt.notifier?.tick(),
  syncCoach,
  // 15초마다 — 남은 한 번 알림, 저장 설정(놀이공간·잠들기 기준·로그인 시 시작) 다시 읽기
  slow: () => {
    rt.hookUpkeep?.tick(); // 남은 한 번 알림이 있고 다른 배너가 없으면 띄운다
    display.sync("all");
  },
  log,
});

// 잠금·절전·세션 종료 → 쓰기와 클라우드 알림 (src/main/app/power.ts). 멈춘 동안(halted)은 쓰지 않는다
const power = createPower({
  flushLocal: () => {
    if (!frozen() && saveParty()?.isWriter()) rt.game?.flush();
  },
  sleep: () => void services.current()?.sleep(),
  wake: () => void services.current()?.wake(),
  announceRelease: () => void halt.announceRelease(),
  log,
});

// 부팅 — 단계마다 함수 하나. 부르는 순서와 중단 조건은 main() 이 가진다 (worklog/records/code-structure/design/10-main.md 4.1절)

// 5단계 핵심 — 거래 실행기·배너·알림 줄·저장 감시(writer 잡기)
function bootCore(): { reader: GameV3; saveSource: SaveParty } {
  // 저장을 쓰는 것은 잠금을 잡은 프로세스 하나다. 실행기에 그 조건을 걸어 reader 는 쓰지 못하게 한다.
  // 두 PC 규칙으로 멈춘 동안(halted)과 새로 시작하는 중(restarting — 저장을 백업으로 옮긴다)도 쓰지 않는다
  // 쓰고 나면 클라우드 저장에 알린다 — 교환·부화·진화 등 사건(src/online/save-kind.ts)은 바로, 나머지는 2분 스로틀
  // 시간 진행은 1초마다 메모리에, 파일은 CLOCK_RULES.saveMs 마다 쓴다 (src/tx/game.ts flushMs)
  // 시각은 전역 시계의 마지막 틱 시각이다 — 게임 시간·스냅샷·줍기가 같은 시각을 본다. 첫 틱 전에는 지금 시각 (2026-09-29 사용자 결정 "확률이나 시간 등등은 그 시간값 보게 해")
  // 알 결과는 계정 시드로 정한다(P4b, D24) — 되돌려 다시 열어도 같다. 시드가 없으면(첫 올리기 전) 평소 난수
  const eggRand = (eggId: string): (() => number) | null => {
    const on = services.current();
    const seed = on ? on.cloud.seed() : readCloudSeed(PATHS.save);
    return seed ? seededRand(seed, `egg:${eggId}`) : null;
  };
  const reader = createGame({ petName, file: PATHS.save, eggRand, canWrite: () => !frozen() && (saveParty()?.isWriter() ?? false), onWrite: (kind) => services.current()?.noteSaved(kind), flushMs: CLOCK_RULES.saveMs, now: () => clock.last()?.now ?? Date.now() });
  rt.game = reader;
  rt.bannerWin = createBannerWindow({
    preload: preloadFile(),
    html: rendererFile("banner.html"),
    chime: () => {
      const s = reader.read()?.settings;
      return s ? gainOf(s, SOUND_RULES.chimeMax) : 0;
    },
    onGo: (route) => openManageWindow(route),
    onDone: () => rt.notifier?.done(),
  });
  rt.notifier = createNotifier({ file: path.join(path.dirname(PATHS.save), "notify.json"), read: reader.read, now: () => clock.last()?.now ?? Date.now(), show: (b) => rt.bannerWin?.show(b), readJson: readJsonFile, write: writeAtomic, bannerOf }); // 시각은 전역 시계의 틱 시각
  const saveSource = createSaveParty({ send: reader.send, paths: PATHS, log });
  rt.party = saveSource;

  return { reader, saveSource };
}

// 무대 — 그림 불러오기·무대 묶음·첫 배치
function bootStage(saveSource: SaveParty, pics: Portraits): { art: ArtLoader; group: StageGroup } {
  // PMD 그림이 없는 종은 걷기 대체 그림으로 무대에 세운다 (src/main/art/overworld-art.ts). 그것도 못 받으면 초상이다 (src/main/art/portrait-art.ts). 이로치 초상이 없으면 보통 초상이다
  const art = createArtLoader(PATHS, {
    overworld: createOverworldSource(PATHS.overworld),
    portrait: (look) => pics.buffer(look.endsWith(":shiny") ? { slug: look.slice(0, -6), shiny: true } : { slug: look, shiny: false }),
  });
  // 무대 그림 미리 받기 — 가진 개체 전부의 PMD 묶음을 뒤에서 디스크에 둔다. 교체·배치로 처음 나오는 종을 받느라 늦게 뜨지 않게 한다.
  // 부화·교환·줍기로 새 개체가 생기면 저장 변경 알림에서 그 종을 더 받는다 (worklog/records/response-latency/response-latency.md)
  const prefetchOwned = (): void => art.prefetch((saveSource.save()?.pets ?? []).map(appearanceOf));
  saveSource.onChange(prefetchOwned);
  prefetchOwned();
  // 화면마다 무대 창 한 쌍 — 창과 무대의 알림은 묶음이 그 쌍으로 이어 준다 (src/main/stage/stage-group.ts)
  rt.stages = createStageGroup({
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
          void rt.commands?.dispatcher
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
        // 클릭은 놀아주기 (src/main/app/commands.ts). 울음소리는 놀아주기가 쿨타임이어도 클릭할 때마다 낸다 — 반응을 들려준다
        onClick: (id) => {
          // 바탕화면 튜토리얼 중에는 왼쪽 클릭이 놀아주기가 아니다 — 무대 렌더러가 먼저 막고, 여기서 한 번 더 막는다
          if (coach.isShown()) return;
          void rt.commands?.click(id);
          void cry.play(id);
        },
        onMenu: (petId) => petMenu.open(petId),
        onArtMissing: (pet) => {
          // PMD 를 못 받았다 — 대개 없는 이름이거나 네트워크가 막혔다. 무대에 나오지 않고 이유만 남긴다
          process.stderr.write(`${pet.species}: PMD 그림을 받지 못함 — 무대에 나오지 않는다 (네트워크·프록시 확인)\n`);
          writeLastError(PATHS, { slug: pet.look, message: `${pet.look} 그림을 받지 못함 — 네트워크(프록시)를 확인하거나 다른 펫 이름으로 시도` });
        },
        log,
      }),
    cursorPoint: () => screen.getCursorScreenPoint(),
    // 놓은 자리(와 모든 화면이면 사는 화면)를 저장한다. 실패하면 저장된 자리로 되돌린다
    onDrop: (id, home, onScreen) => {
      void rt.commands?.dispatcher.dispatch({ cmd: "pet.set", target: id, args: { home, ...(onScreen ? { screen: onScreen } : {}) }, from: "pet" }).then(async (result) => {
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
  rt.stages.layout(display.lanes(), display.playArea().mode === "all");
  run.markStaged();
  return { art, group: rt.stages };

}

// 호스트 감시와 명령 통로 — writer 역할이 바뀌면 명령·서비스를 잇거나 끊는다
function bootCommands(saveSource: SaveParty, reader: GameV3, art: ArtLoader): HostWatch {
  rt.hostWatch = createHostWatch({
    paths: PATHS,
    self: SELF,
    host: {
      platform: process.platform,
      offScreen,
      quitting,
    },
    flags: () => ({ userHidden: display.hidden(), held: rt.stages?.heldId() != null }),
    onUpdate: onHostWatchUpdate,
    onFocus: (key) => rt.stages?.focus(key),
    onInput: (input) => trayMenu.onInput(input),
    log,
  });

  rt.commands = createCommands({
    mailboxDir: PATHS.mailbox,
    now: () => clock.last()?.now ?? Date.now(), // 실행기(createGame)와 같은 틱 시각
    party: saveSource,
    game: reader,
    prepareLook: async (look) => !!await art.loadLook(look),
    onChanged: async (evolvedId) => {
      await refreshParty();
      if (evolvedId) rt.stages?.celebrate(evolvedId);
    },
    stage: {
      care: (id, action) => {
        rt.stages?.care(id, action);
        if (action === "play") void cry.play(id); // 메뉴·관리 창에서 고른 놀아주기
      },
      petIds: () => rt.stages?.petIds() ?? [],
      size: () => rt.stages?.size() ?? { w: 0, h: 0 },
      visible: () => !!rt.stages?.isVisible(),
    },
    settings: {
      hidden: display.hidden,
      setHidden: display.setHidden,
      clickThrough: display.ghost,
      setClickThrough: display.setGhost,
    },
    quit: () => app.quit(),
    log,
    trade: services.trade,
    tradeScreen: services.tradeScreen,
    // 두 PC 규칙으로 멈춘 동안(halted)·새로 시작하는 중(restarting) — 저장을 바꾸는 명령은 실행기로 보내지 않고 멈춤 사유로 거절한다.
    // 읽기·무대 반응·끄기만 연다
    guard: (command) => (frozen() && !HALT_OPEN.has(command.cmd) ? "halted" : null),
  });
  saveSource.onRole((w) => {
    rt.commands?.setWriter(w && !frozen());
    // writer 가 되면 반영하지 않은 교환을 이어 간다. writer 를 놓으면 교환도 멈춘다 — 저장을 쓸 수 없다
    if (w) {
      // 이어받기는 late — 앞 프로세스가 이 PC 를 쥐던 대로 잇는다. 그사이 다른 PC 가 온라인으로 넘겨받았으면 이쪽이 밀려난다(D20, 핑퐁 없음)
      void services.online()?.start("late");
      services.trade();
      services.flushTradeLink();
    } else {
      services.dispose();
    }
  });
  rt.commands.setWriter(saveSource.isWriter());
  saveSource.onChange(() => {
    // 밖에서 바뀐 저장(다른 프로세스·클라우드 받기·mailbox)의 놀이공간·잠들기 기준·로그인 시 시작을 바로 따른다 —
    // 설정창에서 바꾼 것과 같이 셋 다 (94 문서 4-1, X8)
    display.sync("all");
    void refreshParty().then(syncCoach); // 무대에 나온 마리가 바뀌면 첫 돌봄이 밝힐 마리도 바뀐다
  });

  return rt.hostWatch;
}

// 서비스·업데이트·훅 정리
function bootServices(saveSource: SaveParty): void {
  // 로그인한 채 켰으면 클라우드 저장을 시작한다 — 교환보다 먼저 만들어 같은 클라이언트를 나눠 쓴다.
  // 켤 때는 boot — 사용자가 이 PC 에 있다. 다른 PC 가 온라인·잠듦이면 바로 넘겨받고, 연결 끊겼으면 확인 창을 띄운다(D17·G2)
  void services.online()?.start("boot");
  services.trade(); // 동반자 writer 면 교환 세션을 시작한다 — 반영하지 않은 교환이 있으면 이어 간다
  services.flushTradeLink(); // 링크로 켜졌거나 준비 전에 링크를 받았다

  update.start(); // 수명 잠금을 쥔 동반자 하나만
  // 기존 훅 정리 — 옛 이벤트를 걷고 있는 훅 파일을 새 버전으로. 새로 등록하지 않는다. 시작을 막지 않게 뒤로 미룬다
  if (saveSource.isWriter()) {
    rt.hookUpkeep = createHookUpkeep({ noticesFile: path.join(path.dirname(PATHS.save), "notices.json"), show: (b) => rt.notifier?.showOnce(b) ?? false, log });
    setImmediate(() => rt.hookUpkeep?.start());
  }

}

// 트레이·첫 동기화·준비 알림·주기 작업·화면 변화 구독
function bootFinish(saveSource: SaveParty, group: StageGroup, watch: HostWatch, life: Lifetime): void {
  rt.tray = createTray({
    icon: logoFile(256),
    tooltip: t("tray.title", { name: displayName() }),
    popup: () => trayMenu.open(),
    open: () => openManageWindow(),
    isMenuOpen,
    closeMenu,
    closedWithin,
  });

  display.setGhost(display.ghost());
  // 옛 버전이 만든 작업 표시줄 점프 목록을 비운다 — Windows 는 앱이 지울 때까지 남겨 둔다 (2026-10-08 사용자 결정으로 점프 목록을 뺐다)
  if (process.platform === "win32") app.setJumpList(null);
  display.sync("login");
  display.sync("play");
  syncCoach();
  run.markReady();
  life.check(); // 창이 생겼으니 lock 파일에 ready 를 적는다 — pokebuddy companion 이 이걸 보고 기다림을 끝낸다

  run.every(ticks.state, STAGE_RULES.statePollMs);
  clock.on(ticks.clock);
  clock.start();
  run.every(() => rt.stages?.tick(), STAGE_RULES.tickMs);
  // Windows 는 무대 창의 "항상 위"가 풀리거나 다른 항상 위 창에 밀린다 — 1초마다 다시 건다 (src/main/stage/keep-on-top.ts)
  const keepTop = startKeepOnTop(() => rt.stages);
  if (keepTop) run.keep(keepTop);
  // 모니터를 꽂거나 빼거나 배치·해상도가 바뀌면 무대 창을 바로 다시 정한다 — 빠진 화면의 마리는 주 화면에 임시로 간다
  const relayout = (): void => rt.hostWatch?.poll();
  screen.on("display-added", relayout);
  screen.on("display-removed", relayout);
  screen.on("display-metrics-changed", relayout);
  watch.start();
  log?.({ boot: "companion", pets: group.petIds(), writer: saveSource.isWriter(), stageHtml: fs.existsSync(rendererFile("stage.html")) });
}

async function main(): Promise<void> {
  if (duplicate) return; // 둘째 동반자 — 이미 quit 을 불렀다
  power.start();
  if (process.platform === "darwin") {
    // Dock 을 숨기기 전에 로고를 한 번 — 숨기지 않는 구간(선택 창 등)이 생겨도 기본 Electron 아이콘이 아니게. 로고가 아직 없으면 건너뛴다
    const logo = logoFile(512);
    if (logo) app.dock?.setIcon(nativeImage.createFromPath(logo));
    app.dock?.hide();
  }
  // 저장 키를 먼저 푼다 (src/main/app/boot.ts bootSaveKey). 잠긴 저장에서 [종료]면 저장을 그대로 두고 끝낸다
  const keyReady = await bootSaveKey({
    saveFile: PATHS.save,
    create: !((isDevRun() || updateTestBuild) && process.env.POKEBUDDY_SAVE_CRYPT === "off"),
    askLocked: askSaveLocked,
    onLocked: () => {
      writeLastError(PATHS, { slug: config.slug, message: t("save.locked.message"), reason: "save-locked" });
      app.quit();
    },
    log,
  });
  if (!keyReady) return;
  const { reader, saveSource } = bootCore();
  // 앱 쪽 값이 적은 단계는 src/main/app/boot.ts 에 있다 — 끝내기·로그·실패 기록 자리만 넘긴다. 배선 단계는 이 파일에 둔다
  const steps: BootSteps = { paths: PATHS, slug: config.slug, quitting, quit: () => app.quit(), exit: (code) => app.exit(code), log };
  const life = bootLifetime(steps, () => run.isReady() && !!rt.stages?.alive());
  rt.lifetime = life;
  const { pics, starterList } = bootPrefetch(steps, saveSource);
  rt.portraits = pics;
  if (!(await bootStarter(steps, saveSource, pics, starterList, { given: config.fromEnv.has("slug") ? config.slug : null, onPicking: (on) => run.setPicking(on) }))) return;
  const { art, group } = bootStage(saveSource, pics);
  const watch = bootCommands(saveSource, reader, art);
  if (!(await bootClaim(steps, saveSource, group, life, refreshParty))) return;
  bootServices(saveSource);
  bootFinish(saveSource, group, watch, life);
}

app
  .whenReady()
  .then(main)
  .catch((e: unknown) => {
    console.error(e);
    writeLastError(PATHS, { slug: config.slug, message: `기동 실패 — ${e instanceof Error ? e.message : String(e)}` });
    app.exit(1);
  });

// 신호·before-quit·will-quit·window-all-closed — 끄기 순서는 src/main/app/quit.ts
run.install();
