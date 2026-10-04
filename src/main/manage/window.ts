// 관리 창 — 파티·박스·도감·상점·가방을 보는 창. 문서는 src/renderer/manage.html, 값은 스냅샷이 준다.
//
// 폭은 고정이고 세로만 조절한다. 박스 6열과 도감 5열 격자가 640 폭에 맞춰져 있다 (docs/specs/game.md "관리 창").
// 창을 열 때 흐른 시간을 먼저 적용한다. 그래야 만복도와 쿨타임이 지금 값으로 보인다.
// 창은 하나만 둔다. 다시 열면 이미 떠 있는 창을 앞으로 가져온다.
// 앱이 부팅 때 createManage 를 한 번 부른다. 창·기기 창·처리기 상태는 그 안에만 있다 — 모듈 전역 상태가 없다.
// (예전 src/main/manage-window.ts 의 openManage·push*. 메인 레인 M6b 에서 옮기고 묶었다)
import { BrowserWindow, ipcMain } from "electron";
import type { AccountAction, AccountReply, PatchNotesView, UpdateAction, UpdateView } from "../../shared/model/account";
import type { DisplayView } from "../../shared/model/snapshot";
import type { MailAction, MailReply } from "../../shared/model/mail";
import type { ManageChannel, ManagePush, ManageReply, ManageRequest } from "../../shared/ipc/manage";
import type { ManageRoute } from "../../shared/model/route";
import type { PetDeviceOpen, ShopDeviceOpen, BagDeviceOpen, PartyDeviceOpen } from "../../shared/model/devices";
import type { ScreenView } from "../../shared/model/overlays";
import type { GameV3 } from "../../tx/game.js";
import { windowIcon } from "../windows/files.js";
import { webPreferencesOf } from "../windows/options.js";
import { createIpcScope, isFromWindow } from "../windows/ipc.js";
import { gameReads, wireManageHandlers } from "./handlers.js";
import { MEGA_STONE_ICON, portraitKey } from "../art/portraits.js";
import { artServices } from "../art/services.js";
import { createDeviceWindow, type DeviceWindow } from "../windows/device-window.js";
import { DEVICE_SIZES, bagDeviceOf, dexDeviceOf, isBagInput, isPartyInput, isPetInput, isShopInput, partyDeviceOf, petDeviceOf, shopDeviceOf, type DeviceArtDeps, type DexDeviceOpen } from "../windows/devices.js";
import { bagDeviceModel } from "../../view/device-bag.js";
import { partyDeviceModel } from "../../view/device-party.js";
import { petDeviceModel } from "../../view/device-pet.js";
import { shopDeviceModel } from "../../view/device-shop.js";
import { gainOf } from "../../state/settings.js";
import { SOUND_RULES } from "../../state/rules.js";
import fs from "node:fs";
import path from "node:path";

// 설정창의 크기 (예전 src/save/rules.ts 의 WINDOW_V3_RULES. 메인 레인 M6b 에서 창 파일로 옮겼다)
// docs/specs/game.md "관리 창". Figma 의 640 px 를 DIP 로 그대로 쓴다
const MANAGE_WINDOW_RULES = {
  width: 640, // 폭은 고정이다. 박스 6열과 도감 5열 격자가 이 폭에 맞춰져 있다
  // 기본 세로 — 파티 탭이 스크롤 없이 딱 맞는 높이다(2026-09-26 사용자 결정 "화면은 파티창을 기준으로 높이가 정해져야해").
  // 헤더 40 + 탭 40 + 본문 위 여백 16 + 파티 머리와 칸 3줄(마지막 칸이 창 위에서 650) + 본문 아래 여백 32. 파티 칸 모양이 바뀌면 다시 잰다
  height: 682,
  minHeight: 560, // 본문이 스크롤이라 이만큼까지 줄일 수 있다
};

const CH = {
  route: "manage:route",
  dexOpen: "manage:dex-open",
  dexStep: "manage:dex-step",
  dexClosed: "manage:dex-closed",
  petOpen: "manage:pet-open",
  petStep: "manage:pet-step",
  petAct: "manage:pet-act",
  petClosed: "manage:pet-closed",
  shopOpen: "manage:shop-open",
  shopStep: "manage:shop-step",
  shopAct: "manage:shop-act",
  shopClosed: "manage:shop-closed",
  bagOpen: "manage:bag-open",
  bagStep: "manage:bag-step",
  bagAct: "manage:bag-act",
  bagClosed: "manage:bag-closed",
  partyOpen: "manage:party-open",
  partyAct: "manage:party-act",
  partyStep: "manage:party-step",
  partyClosed: "manage:party-closed",
} satisfies Record<string, ManageChannel>;

// 창 조작 단추가 앉는 자리. 색은 헤더와 같아야 이어져 보인다 (`--surface` 와 `--muted`)
// 높이는 헤더(40)보다 1 작다 — 헤더 맨 아래 1px 테두리를 덮지 않아야 단추 아래까지 선이 이어진다
const CHROME = { color: "#ffffff", symbolColor: "#4a6663", height: 39 };
// 모달이 열리면 가림막(`--scrim` rgba(26,51,48,0.45))이 헤더를 덮는다. 창 단추 자리도 그 색을 겹친 값으로 바꾼다
const CHROME_DIM = { color: "#98a3a2", symbolColor: "#344f4c" };
// 열 때마다 읽는 기능 — 늦게 생기는 서비스(계정·우편·업데이트)는 그때 있으면 싣는다. 처리기는 마지막으로 연 때의 값을 쓴다
export interface ManageServices {
  // 설정의 `영역 그리기`. 영역 그리기 창을 열고 적용한 영역을 저장한다. 없으면 이 기능을 쓸 수 없다
  drawRegion?: () => Promise<ManageReply>;
  display?: () => DisplayView; // 포켓몬 표시·클릭 통과의 지금 값. 저장 밖이라 앱이 준다
  account?: (req: AccountAction) => Promise<AccountReply>; // 계정·클라우드 저장 (src/main/online.ts). 없으면 계정 탭은 쓸 수 없다고 보인다
  update?: (action: UpdateAction) => Promise<UpdateView>; // 버전·업데이트 (src/main/update/updater.ts). 없으면 설정 바닥에 버전을 그리지 않는다
  notes?: (action: "list" | "seen") => PatchNotesView; // 패치노트 (src/main/patch-notes.ts). 없으면 `패치노트` 단추를 두지 않는다
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
  // (94 1-1, worklog/records/game-runtime/record.md 706·1143 "창 단추 자리도 함께 어둡게 한다")
  //   modal  설정창의 모달 가림막과 설정창 튜토리얼 (manage:dim)
  //   pet    파티 상세 기기 창의 튜토리얼 (petdev:coach)
  //   stage  바탕화면 튜토리얼 — 첫 돌봄·놀이공간 (setStageCoachDim)
  const dimFrom = { modal: false, pet: false, stage: false };
  function paintChrome(): void {
    if (!win || win.isDestroyed()) return;
    const c = dimFrom.modal || dimFrom.pet || dimFrom.stage ? CHROME_DIM : CHROME;
    try {
      win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: CHROME.height });
    } catch {
      // 창 단추를 OS 가 그리지 않는 곳(mac 등)에서는 할 일이 없다
    }
  }
  function setDimFrom(from: keyof typeof dimFrom, on: boolean): void {
    if (dimFrom[from] === on) return;
    dimFrom[from] = on;
    paintChrome();
  }

  let win: BrowserWindow | null = null;
  let wired = false;
  let svc: ManageServices = {}; // 창을 열 때마다 새로 받는다 — 처리기는 한 번만 건다
  let dexWin: DeviceWindow<DexDeviceOpen> | null = null;
  let petWin: DeviceWindow<PetDeviceOpen> | null = null;
  let shopWin: DeviceWindow<ShopDeviceOpen> | null = null;
  let bagWin: DeviceWindow<BagDeviceOpen> | null = null;
  let partyWin: DeviceWindow<PartyDeviceOpen> | null = null;
  // 기기 창에 마지막으로 띄운 모델(세대 번호와 함께) — 설정창은 스냅샷이 바뀔 때마다 고른 값을 다시 보낸다. 모델이 그대로면 다시 그리지 않는다
  const shownModel = new Map<"pet" | "shop" | "bag" | "party", string>();

  // 관리 창이 보낸 요청인가. 무대 창·선택 창도 같은 preload 를 쓰므로 보낸 창을 확인한다
  const mine = (e: { sender: unknown }): boolean => isFromWindow(win, e);


  // 기기 창 띄우기 — 같은 세대 번호로 같은 모델을 이미 띄웠으면 다시 보내지 않는다
  function showDevice<M>(name: "pet" | "shop" | "bag" | "party", w: DeviceWindow<M> | null, model: M, gen: unknown): void {
    if (!win || !w) return;
    const key = `${String(gen)}|${JSON.stringify(model)}`;
    if (shownModel.get(name) === key) return;
    shownModel.set(name, key);
    w.show(win, model, gen);
  }

  // 관리 창 문서로 보낸다 — 창이나 문서가 이미 닫혔으면 버린다. 창보다 문서(webContents)가 먼저 없어지는 순간이 있다
  function toManage(channel: ManageChannel, ...args: unknown[]): void {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(channel, ...args);
  }

  // 채널을 한 번만 건다. 창을 여러 번 열어도 처리기는 하나다
  function wire(game: GameV3, send: (req: ManageRequest) => Promise<ManageReply>, preload: string, html: string): void {
    if (wired) return;
    wired = true;
    // 본 처리기(계약 ManageCoreIpc)는 처리기 파일이 건다 — 보낸 창 검사는 묶음이 한다 (src/main/manage/handlers.ts)
    const scope = createIpcScope((sender) => !!win && !win.isDestroyed() && sender === win.webContents);
    wireManageHandlers(scope, { game, send, services: () => svc, setDim: (on) => setDimFrom("modal", on) });
    const { snapshot, detailOf, shopDetailOf } = gameReads(game);
    // 초상 — 기기 창도 앱과 같은 인스턴스를 쓴다 (src/main/art/services.ts)
    const portraits = artServices().portraits;
    // 도감 기기 창 — 칸을 누르면 띄우고, 이전·다음은 관리 창 목록 순서를 따른다
    const cries = artServices().cries;
    const deviceFiles = (name: string) => ({ preload, html: path.join(path.dirname(html), `${name}.html`) });
    dexWin = createDeviceWindow(deviceFiles("dex"), dexDeviceOf({
      detail: (slug) => detailOf(slug),
      portrait: async (slug) => {
        return (await portraits.get([{ slug, shiny: false }]))[slug] ?? null;
      },
      tree: (slug) => {
        const detail = shopDetailOf(slug); // 상점 구매 창의 포켓몬 상세와 같은 사슬 (src/view/shop-detail.ts)
        return detail?.kind === "pokemon" ? detail.tree : null;
      },
      portraits: async (slugs) => {
        const got = await portraits.get(slugs.map((slug) => ({ slug, shiny: false })));
        const out: Record<string, string> = {};
        for (const slug of slugs) {
          const uri = got[slug];
          if (uri) out[slug] = uri;
        }
        return out;
      },
      cry: (slug) => cries.get(slug),
      volume: () => {
        const s = game.read()?.settings;
        return s ? gainOf(s, SOUND_RULES.cryMax) : 0;
      },
    }), {
      onStep: (delta) => toManage(CH.dexStep, delta),
      // 관리 창을 닫으면 자식인 기기 창도 같이 닫힌다. 그때는 관리 창 문서가 먼저 없어져 보낼 곳이 없다
      onClosed: (gen) => toManage(CH.dexClosed, gen),
    });
    // 파티 상세 기기 창 — 관리 창이 개체를 정해 보낸다. 누른 단추·이전·다음은 관리 창으로 돌려보낸다
    petWin = createDeviceWindow(deviceFiles("pet"), petDeviceOf({
      portrait: async (slug, shiny) => {
        return (await portraits.get([{ slug, shiny }]))[portraitKey({ slug, shiny })] ?? null;
      },
      megaIcon: async () => {
        return (await portraits.icons([MEGA_STONE_ICON]))[MEGA_STONE_ICON] ?? null;
      },
      cry: (slug) => cries.get(slug),
      volume: () => {
        const s = game.read()?.settings;
        return s ? gainOf(s, SOUND_RULES.cryMax) : 0;
      },
    }), {
      onStep: (delta) => toManage(CH.petStep, delta),
      onAct: (action) => toManage(CH.petAct, action),
      onCoach: (on) => setDimFrom("pet", on),
      onClosed: (gen) => {
        shownModel.delete("pet");
        toManage(CH.petClosed, gen);
      },
    });
    // 기기 창 모델의 그림 열쇠(src/view/device-art.ts) → data URI. portrait:<slug>[:shiny] 는 초상, item:<id> 는 도구 그림.
    // egg:<종류> 는 그림 받기가 그 알의 색표로 칠한다(src/main/art/egg-art.ts)
    const deviceArt: DeviceArtDeps = {
      art: async (keys) => {
        const asks = keys
          .filter((k) => k.startsWith("portrait:"))
          .map((k) => {
            const rest = k.slice("portrait:".length);
            const shiny = rest.endsWith(":shiny");
            return { key: k, ask: { slug: shiny ? rest.slice(0, -":shiny".length) : rest, shiny } };
          });
        const items = keys.filter((k) => k.startsWith("item:") || k.startsWith("egg:"));
        const [faces, icons] = await Promise.all([asks.length ? portraits.get(asks.map((a) => a.ask)) : {}, items.length ? portraits.icons(items) : {}]);
        const out: Record<string, string | null> = {};
        for (const a of asks) out[a.key] = (faces as Record<string, string | null>)[portraitKey(a.ask)] ?? null;
        for (const k of items) out[k] = (icons as Record<string, string | null>)[k] ?? null;
        return out;
      },
    };
    // 상점 기기 창 — 관리 창이 상품을 정해 보낸다. 수량·구매·이전·다음은 관리 창으로 돌려보낸다
    shopWin = createDeviceWindow(deviceFiles("shop"), shopDeviceOf(deviceArt), {
      onStep: (delta) => toManage(CH.shopStep, delta),
      onAct: (action) => toManage(CH.shopAct, action),
      onClosed: (gen) => {
        shownModel.delete("shop");
        toManage(CH.shopClosed, gen);
      },
    });
    // 가방 기기 창 — 관리 창이 도구를 정해 보낸다. 사용·판매·파티 고르기·수량·이전·다음은 관리 창으로 돌려보낸다
    bagWin = createDeviceWindow(deviceFiles("bag"), bagDeviceOf(deviceArt), {
      onStep: (delta) => toManage(CH.bagStep, delta),
      onAct: (action) => toManage(CH.bagAct, action),
      onClosed: (gen) => {
        shownModel.delete("bag");
        toManage(CH.bagClosed, gen);
      },
    });
    // 파티 기기 창(교체 화면) — 관리 창이 지금 프리셋의 칸을 정해 보낸다. 누른 칸·칩은 관리 창으로 돌려보낸다
    partyWin = createDeviceWindow(deviceFiles("party"), partyDeviceOf(deviceArt), {
      onStep: (delta) => toManage(CH.partyStep, delta),
      onAct: (action) => toManage(CH.partyAct, action),
      onClosed: (gen) => {
        shownModel.delete("party");
        toManage(CH.partyClosed, gen);
      },
    });
    // 파티 상세·상점·가방·파티 교체의 모델은 메인이 만든다 — 설정창은 고른 값(…DeviceInput)만 보낸다 (src/view/device-*.ts).
    // 지금 저장의 화면 값(스냅샷)으로 만든다. 답은 바로잡은 입력이다 — 설정창은 다음 명령에 이 값을 쓴다. 띄울 것이 없으면 닫고 null.
    // 여는 요청에는 관리 창이 마지막으로 받은 세대 번호(gen)가 실려 온다 — 낡은 번호면 기기 창이 버린다 (src/main/windows/device-gen.ts)
    ipcMain.handle(CH.partyOpen, (e, input: unknown, gen: unknown) => {
      if (!win || !mine(e)) return null;
      const v = isPartyInput(input) ? snapshot() : null;
      const r = v && isPartyInput(input) ? partyDeviceModel(v, input) : null;
      if (!r) {
        shownModel.delete("party");
        partyWin?.close();
        return null;
      }
      showDevice("party", partyWin, r.model, gen);
      return r.input;
    });
    ipcMain.handle(CH.petOpen, (e, input: unknown, gen: unknown) => {
      if (!win || !mine(e)) return null;
      const v = isPetInput(input) ? snapshot() : null;
      const r = v && isPetInput(input) ? petDeviceModel(v, input) : null;
      if (!r) {
        shownModel.delete("pet");
        petWin?.close();
        return null;
      }
      showDevice("pet", petWin, r.model, gen);
      return r.input;
    });
    ipcMain.handle(CH.shopOpen, (e, input: unknown, gen: unknown) => {
      if (!win || !mine(e)) return null;
      const v = isShopInput(input) ? snapshot() : null;
      const r = v && isShopInput(input) ? shopDeviceModel(v, input) : null;
      if (!r) {
        shownModel.delete("shop");
        shopWin?.close();
        return null;
      }
      showDevice("shop", shopWin, r.model, gen);
      return r.input;
    });
    ipcMain.handle(CH.bagOpen, (e, input: unknown, gen: unknown) => {
      if (!win || !mine(e)) return null;
      const v = isBagInput(input) ? snapshot() : null;
      const r = v && isBagInput(input) ? bagDeviceModel(v, input) : null;
      if (!r) {
        shownModel.delete("bag");
        bagWin?.close();
        return null;
      }
      showDevice("bag", bagWin, r.model, gen);
      return r.input;
    });
    ipcMain.on(CH.dexOpen, (e, slug: unknown, gen: unknown, beside: unknown) => {
      if (!win || !mine(e)) return;
      // beside — 파티 상세의 `도감 보기`. 관리 창과 파티 상세 기기 창을 한 덩어리로 보고 그 옆에 붙인다
      if (typeof slug === "string") dexWin?.show(win, { slug, beside: beside === true ? DEVICE_SIZES.pet.width : 0 }, gen);
      else dexWin?.close();
    });
  }

  function open(route?: ManageRoute): BrowserWindow | null {
    svc = deps.services();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (route) win.webContents.send(CH.route, route);
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
      dimFrom.modal = false; // 설정창의 모달·튜토리얼은 창과 함께 사라졌다
      shownModel.clear();
      svc.identifyScreens?.(false); // 한 화면 목록이 열린 채 닫혀도 번호 덮개가 남지 않게
    });
    // 문서를 (다시) 읽기 시작한다 — 렌더러의 세대 번호가 0 에서 다시 시작하므로 기기 창 번호도 맞춘다
    win.webContents.on("did-start-loading", () => {
      shownModel.clear();
      petWin?.resetGen();
      dexWin?.resetGen();
      shopWin?.resetGen();
      bagWin?.resetGen();
      partyWin?.resetGen();
    });
    // 문서를 다 읽은 뒤에 보낸다. 렌더러는 첫 화면을 그린 뒤에 옮긴다
    if (route) win.webContents.once("did-finish-load", () => win?.webContents.send(CH.route, route));
    void win.loadFile(deps.html);
    return win;
  }

  return {
    open,
    send: (channel, ...args) => toManage(channel, ...args),
    setStageCoachDim: (on) => setDimFrom("stage", on),
  };
}
