// 관리 창 — 파티·박스·도감·상점·가방을 보는 창. 문서는 src/renderer/manage.html, 값은 스냅샷이 준다.
//
// 폭은 고정이고 세로만 조절한다. 박스 6열과 도감 5열 격자가 640 폭에 맞춰져 있다 (docs/specs/game.md "관리 창").
// 창을 열 때 흐른 시간을 먼저 적용한다. 그래야 만복도와 쿨타임이 지금 값으로 보인다.
// 창은 하나만 둔다. 다시 열면 이미 떠 있는 창을 앞으로 가져온다.
// 앱이 부팅 때 createManage 를 한 번 부른다. 창·기기 창·처리기 상태는 그 안에만 있다 — 모듈 전역 상태가 없다.
// (예전 src/main/manage-window.ts 의 openManage·push*. 메인 레인 M6b 에서 옮기고 묶었다)
import { BrowserWindow } from "electron";
import type { AccountAction, AccountReply, PatchNotesView, UpdateAction, UpdateView } from "../../shared/model/account";
import type { DisplayView } from "../../shared/model/snapshot";
import type { MailAction, MailReply } from "../../shared/model/mail";
import type { ManagePush, ManageReply, ManageRequest } from "../../shared/ipc/manage";
import type { ManageRoute } from "../../shared/model/route";
import type { ScreenView } from "../../shared/model/overlays";
import type { GameV3 } from "../../tx/game.js";
import type { ArtLoader } from "../art/stage-art.js";
import { windowIcon } from "../windows/files.js";
import { webPreferencesOf } from "../windows/options.js";
import { createIpcScope } from "../windows/ipc.js";
import { gameReads, wireManageHandlers } from "./handlers.js";
import { wireManageDevices, type ManageDevices } from "./devices.js";

// 설정창의 크기 (예전 src/save/rules.ts 의 WINDOW_V3_RULES. 메인 레인 M6b 에서 창 파일로 옮겼다)
// docs/specs/game.md "관리 창". Figma 의 640 px 를 DIP 로 그대로 쓴다
const MANAGE_WINDOW_RULES = {
  width: 640, // 폭은 고정이다. 박스 6열과 도감 5열 격자가 이 폭에 맞춰져 있다
  // 기본 세로 — 파티 탭이 스크롤 없이 딱 맞는 높이다(2026-09-26 사용자 결정 "화면은 파티창을 기준으로 높이가 정해져야해").
  // 헤더 40 + 탭 40 + 본문 위 여백 16 + 파티 머리와 칸 3줄(마지막 칸이 창 위에서 650) + 본문 아래 여백 32. 파티 칸 모양이 바뀌면 다시 잰다
  height: 682,
  minHeight: 560, // 본문이 스크롤이라 이만큼까지 줄일 수 있다
};

// 창 조작 단추가 앉는 자리. 색은 헤더와 같아야 이어져 보인다 (`--surface` 와 `--muted`)
// 높이는 헤더(40)보다 1 작다 — 헤더 맨 아래 1px 테두리를 덮지 않아야 단추 아래까지 선이 이어진다
const CHROME = { color: "#ffffff", symbolColor: "#4a6663", height: 39 };
// 모달이 열리면 가림막(`--scrim` rgba(26,51,48,0.45))이 헤더를 덮는다. 창 단추 자리도 그 색을 겹친 값으로 바꾼다
const CHROME_DIM = { color: "#98a3a2", symbolColor: "#344f4c" };
// 모달 위의 모달(돌보미집 위의 부화 결과)과 모달 안의 튜토리얼은 가림막이 두 겹이다 — 한 겹 값 위에 같은 막을 한 번 더 겹친 값
const CHROME_DIM2 = { color: "#5f716f", symbolColor: "#284240" };
// 열 때마다 읽는 기능 — 늦게 생기는 서비스(계정·우편·업데이트)는 그때 있으면 싣는다. 처리기는 마지막으로 연 때의 값을 쓴다
export interface ManageServices {
  // 설정의 `영역 그리기`. 영역 그리기 창을 열고 적용한 영역을 저장한다. 없으면 이 기능을 쓸 수 없다
  drawRegion?: () => Promise<ManageReply>;
  display?: () => DisplayView; // 포켓몬 표시·클릭 통과의 지금 값. 저장 밖이라 앱이 준다
  account?: (req: AccountAction) => Promise<AccountReply>; // 계정·클라우드 저장 (src/main/services/online.ts). 없으면 계정 탭은 쓸 수 없다고 보인다
  update?: (action: UpdateAction) => Promise<UpdateView>; // 버전·업데이트 (src/main/update/updater.ts). 없으면 설정 바닥에 버전을 그리지 않는다
  notes?: (action: "list" | "seen") => PatchNotesView; // 패치노트 (src/main/update/patch-notes.ts). 없으면 `패치노트` 단추를 두지 않는다
  // 놀이공간 화면 — 목록·번호 보기·화면에서 고르기 (src/main/windows/screen-picker.ts). 없으면 목록이 비고 고르기를 쓸 수 없다
  screens?: () => ScreenView[];
  identifyScreens?: (on: boolean) => void;
  pickScreen?: () => Promise<ManageReply>;
  mail?: (req: MailAction) => Promise<MailReply | null>; // 우편함 (src/online/mail-inbox.ts). 없으면 봉투 단추를 숨긴다. writer 를 놓았으면 null
  petMenu?: (petId: string) => void; // 파티 카드·박스 칸을 누르면 띄우는 포켓몬 메뉴 (src/view/menus.ts petMenu). 없으면 렌더러가 바로 개체 상세를 연다
}

// 부팅 때 한 번 받는 것 — 창 파일, 게임, 명령 길, 열 때마다 읽을 기능
export interface ManageDeps {
  preload: string;
  html: string;
  game(): GameV3 | null; // 처리기는 처음 열 때의 게임으로 한 번 건다. 없으면 열지 않는다
  // 명령을 보내는 길. 앱은 커맨드 처리기를 준다 — writer 면 실행기로, reader 면 mailbox 로 간다.
  // 기본값은 없다 — 실행기를 바로 부르는 길을 창이 스스로 만들지 않는다. 개발용 실행기도 자기 길을 준다
  send(req: ManageRequest): Promise<ManageReply>;
  services(): ManageServices;
  stageArt?: () => ArtLoader | null; // 무대 그림 불러오기 — 배틀 창의 PMD 그림. 없으면 초상으로 그린다
  devBattleSeed?: number; // 개발 실행 전용 — 있으면 설정창을 연 뒤 이 시드의 로컬 엔진 판으로 배틀 창을 띄운다 (POKEBUDDY_DEV_BATTLE)
}

// 설정창 — 부팅 때 한 번 만든다(createManage). 창과 기기 창, 처리기 상태는 이 안에만 있다
export interface Manage {
  open(route?: ManageRoute): BrowserWindow | null; // 열거나 앞으로 가져온다. route — 알림 배너의 `바로가기`. 게임이 없으면 null
  // 설정창 문서로 밀어 보낸다 — 창이나 문서가 없으면 버린다. 창을 열면 렌더러가 다시 읽는다
  send<K extends keyof ManagePush>(channel: K, ...args: ManagePush[K]): void;
  setStageCoachDim(on: boolean): void; // 바탕화면 튜토리얼 말풍선이 떴다·사라졌다 — 앱이 무대 코치를 맞출 때마다 알린다 (src/main/stage/coach.ts)
}

export function createManage(deps: ManageDeps): Manage {
  // 창 단추 자리를 어둡게 하는 원천 — 하나라도 켜져 있으면 어둡다. 어느 창의 튜토리얼이든 떠 있는 동안 함께 어둡게 한다
  // (94 1-1, worklog/records/game-runtime/game-runtime.md 706·1143 "창 단추 자리도 함께 어둡게 한다")
  //   modal  설정창의 모달 가림막과 설정창 튜토리얼 (manage:dim)
  //   pet    파티 상세 기기 창의 튜토리얼 (petdev:coach)
  //   stage  바탕화면 튜토리얼 — 첫 돌봄·놀이공간 (setStageCoachDim)
  //   modal 은 겹수(0·1·2)다. 기기 창·무대의 튜토리얼은 한 겹이다
  const dimFrom: { modal: 0 | 1 | 2; pet: boolean; stage: boolean } = { modal: 0, pet: false, stage: false };
  function paintChrome(): void {
    if (!win || win.isDestroyed()) return;
    const layers = Math.max(dimFrom.modal, dimFrom.pet || dimFrom.stage ? 1 : 0);
    const c = layers === 2 ? CHROME_DIM2 : layers === 1 ? CHROME_DIM : CHROME;
    try {
      win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: CHROME.height });
    } catch {
      // 창 단추를 OS 가 그리지 않는 곳(mac 등)에서는 할 일이 없다
    }
  }
  function setDimFrom<K extends keyof typeof dimFrom>(from: K, value: (typeof dimFrom)[K]): void {
    if (dimFrom[from] === value) return;
    dimFrom[from] = value;
    paintChrome();
  }

  let win: BrowserWindow | null = null;
  let wired = false;
  let svc: ManageServices = {}; // 창을 열 때마다 새로 받는다 — 처리기는 한 번만 건다
  let devices: ManageDevices | null = null; // 기기 창 다섯 — 처음 열 때 건다 (src/main/manage/devices.ts)

  // 관리 창 문서로 보낸다 — 창이나 문서가 이미 닫혔으면 버린다. 창보다 문서(webContents)가 먼저 없어지는 순간이 있다
  function toManage<K extends keyof ManagePush>(channel: K, ...args: ManagePush[K]): void {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(channel, ...args);
  }

  // 채널을 한 번만 건다. 창을 여러 번 열어도 처리기는 하나다
  function wire(game: GameV3, send: (req: ManageRequest) => Promise<ManageReply>, preload: string, html: string): void {
    if (wired) return;
    wired = true;
    // 본 처리기(계약 ManageCoreIpc)는 처리기 파일이 건다 — 보낸 창 검사는 묶음이 한다 (src/main/manage/handlers.ts)
    const scope = createIpcScope((sender) => !!win && !win.isDestroyed() && sender === win.webContents);
    wireManageHandlers(scope, { game, send, services: () => svc, setDim: (layers) => setDimFrom("modal", layers) });
    // 기기 창 다섯과의 길(계약 ManageDeviceLinkIpc)은 기기 창 파일이 건다 — 같은 묶음, 같은 화면 읽기
    devices = wireManageDevices(scope, {
      game,
      reads: gameReads(game),
      preload,
      html,
      parent: () => win,
      send: (channel, ...args) => toManage(channel, ...args),
      setPetCoach: (on) => setDimFrom("pet", on),
      stageArt: () => deps.stageArt?.() ?? null,
    });
  }

  function open(route?: ManageRoute): BrowserWindow | null {
    svc = deps.services();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (route) toManage("manage:route", route);
      return win;
    }
    if (!wired) {
      const game = deps.game();
      if (!game) return null;
      wire(game, deps.send, deps.preload, deps.html);
    }
    win = new BrowserWindow({
      width: MANAGE_WINDOW_RULES.width,
      height: MANAGE_WINDOW_RULES.height,
      minWidth: MANAGE_WINDOW_RULES.width,
      maxWidth: MANAGE_WINDOW_RULES.width,
      minHeight: MANAGE_WINDOW_RULES.minHeight,
      title: "pokebuddy",
      icon: windowIcon(),
      // 제목 표시줄을 숨기고 우리 헤더를 그 자리에 둔다. 창 조작 단추는 OS 가 헤더 위에 겹쳐 그린다.
      // 단추를 직접 그리지 않으므로 Windows 의 맞춤 배치와 키보드 조작이 그대로 남는다 (docs/specs/game.md "화면 구조")
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: CHROME.color,
        symbolColor: CHROME.symbolColor,
        height: CHROME.height,
      },
      webPreferences: webPreferencesOf(deps.preload),
    });
    paintChrome(); // 다른 창의 튜토리얼이 떠 있는 동안 열렸다 — 처음부터 어둡게
    win.on("closed", () => {
      win = null;
      dimFrom.modal = 0; // 설정창의 모달·튜토리얼은 창과 함께 사라졌다
      devices?.forget();
      svc.identifyScreens?.(false); // 한 화면 목록이 열린 채 닫혀도 번호 덮개가 남지 않게
    });
    // 문서를 (다시) 읽기 시작한다 — 렌더러의 세대 번호가 0 에서 다시 시작하므로 기기 창 번호도 맞춘다
    win.webContents.on("did-start-loading", () => devices?.reset());
    // 문서를 다 읽은 뒤에 보낸다. 렌더러는 첫 화면을 그린 뒤에 옮긴다
    if (route) win.webContents.once("did-finish-load", () => toManage("manage:route", route));
    // 개발 실행 전용 — POKEBUDDY_DEV_BATTLE=<시드> 면 설정창을 연 뒤 로컬 엔진 판으로 배틀 창을 띄운다 (src/main/manage/battle-screen.ts)
    const devBattle = deps.devBattleSeed;
    if (devBattle) win.webContents.once("did-finish-load", () => {
      const save = deps.game()?.read();
      if (save) void devices?.battleScreen.openDev(save, devBattle).catch((e: unknown) => console.error("개발용 배틀 창을 띄우지 못했다", e));
    });
    void win.loadFile(deps.html);
    return win;
  }

  return {
    open,
    send: toManage,
    setStageCoachDim: (on) => setDimFrom("stage", on),
  };
}
