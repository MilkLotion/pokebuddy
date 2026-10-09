// 설정창 본 처리기 — 스냅샷·명령·도감·상세·CLI 연결·그림·계정·우편·업데이트·패치노트·화면 고르기·덮개·복사 (계약 ManageCoreIpc)
// 계약 한 장을 wireIpc 로 건다 — 빠진 채널과 인자 모양은 컴파일이 잡는다. 보낸 창 검사는 묶음(scope)이 한다(내 창이 아니면 각 채널의 denied)
// 기기 창 다섯과의 길(ManageDeviceLinkIpc)은 창 파일이 건다 (src/main/manage/window.ts)
// (예전 src/main/manage-window.ts wire() 안에 있었다. 메인 레인 M6c 에서 나눴다)
import { clipboard, shell } from "electron";
import type { ManageCoreIpc, ManageReply, ManageRequest } from "../../shared/ipc/manage";
import type { DexDetail, ShopDetail } from "../../shared/model/detail";
import type { Snapshot } from "../../shared/model/snapshot";
import type { GameV3 } from "../../tx/game.js";
import { PATHS } from "../../platform/paths.js";
import { runAgentRequest } from "../../agents/agent-request.js";
import { dexDetail } from "../../view/dex-detail.js";
import { dexList } from "../../view/dex-list.js";
import { resultLineOf } from "../../view/result-lines.js";
import { shopDetail } from "../../view/shop-detail.js";
import { snapshotOfGame } from "../../view/snapshot.js";
import { artServices } from "../art/services.js";
import { isShortId } from "../windows/input.js";
import { wireIpc, type IpcScope } from "../windows/ipc.js";
import { isInternalCommand, parseAccountAction, parseAgentRequest, parseBattleAction, parseCommand, parseCopyText, parseIconKeys, parseMailAction, parseNotesAction, parsePortraitAsks, parseUpdateAction } from "./requests.js";
import type { ManageServices } from "./window.js";

// 설정 바닥의 `저작권 안내` 가 여는 곳 — README 의 라이선스 절. 주소는 여기 고정한다 (docs/design.md 제품과 실행 "권리와 배포")
const RIGHTS_URL = `https://github.com/MilkLotion/pokebuddy#${encodeURIComponent("라이선스")}`;

const DENIED: ManageReply = { ok: false, reason: "denied" };

// 성공 답에 결과 줄을 붙이는 명령 — 기기 창의 초록 상자
const RESULT_COMMANDS = new Set(["bag.use", "shop.buy"]);

// 화면 읽기 — 저장을 읽어 화면 값을 바로 만든다(실행기는 쓰기만 맡는다). 저장이 없으면 빈 값. 기기 창도 같은 것을 쓴다
export interface GameReads {
  snapshot(): Snapshot | null;
  detailOf(slug: string): DexDetail | null; // 도감 칸 하나의 상세
  shopDetailOf(id: string): ShopDetail | null; // 상점 구매 창의 상세
}

export function gameReads(game: GameV3): GameReads {
  return {
    snapshot: () => snapshotOfGame(game),
    detailOf: (slug: string) => {
      const save = game.read();
      return save ? dexDetail(save, slug) : null;
    },
    shopDetailOf: (id: string) => {
      const save = game.read();
      return save ? shopDetail(save, id) : null;
    },
  };
}

export interface ManageHandlerDeps {
  game: GameV3;
  // 명령을 보내는 길 — 앱은 커맨드 처리기를 준다 (src/main/manage/window.ts ManageDeps.send)
  send(req: ManageRequest): Promise<ManageReply>;
  services(): ManageServices; // 마지막으로 창을 연 때의 기능. 없는 기능의 채널은 빈 답을 준다
  setDim(layers: 0 | 1 | 2): void; // 가림막 겹수 — 창 단추 자리를 같은 겹수로 어둡게 한다
}

export function wireManageHandlers(scope: IpcScope, deps: ManageHandlerDeps): void {
  const { game, send } = deps;
  const svc = deps.services;
  const { snapshot, detailOf, shopDetailOf } = gameReads(game);
  // 초상 — 앱과 같은 인스턴스다. 앱 안 그림 폴더 규칙도 그곳에 있다 (src/main/art/services.ts)
  const portraits = artServices().portraits;

  wireIpc<ManageCoreIpc>(scope, {
    "manage:snapshot": {
      denied: null,
      run: () => {
        game.tick(); // 본 값이 지금 값이 되도록 먼저 시간을 적용한다
        const view = snapshot();
        const display = svc().display;
        return view && display ? { ...view, display: display() } : view;
      },
    },
    "manage:command": {
      denied: DENIED,
      run: async (_e, raw) => {
        const req = parseCommand(raw);
        if (!req) return { ok: false, reason: "bad-request" };
        // 우편함 넣기와 교환의 잠금·반영은 메인의 우편함·교환 세션만 실행기에 낸다 — 받은 길(send)이 명령 처리기를 거치지 않아도(개발용 실행기) 막는다
        if (isInternalCommand(req.cmd)) return { ok: false, reason: "unknown-cmd" };
        game.tick();
        // 결과 줄이 있는 명령은 거래 앞뒤 화면 값을 견줘 성공 답에 붙인다 (src/view/result-lines.ts)
        const before = RESULT_COMMANDS.has(req.cmd) ? snapshot() : null;
        const reply = await send(req);
        const after = reply.ok && before ? snapshot() : null;
        const result = before && after ? resultLineOf(req, before, after) : null;
        return result ? { ...reply, result } : reply;
      },
    },
    "manage:dex": {
      denied: [],
      run: () => {
        const save = game.read();
        return save ? dexList(save) : [];
      },
    },
    "manage:dex-detail": { denied: null, run: (_e, slug) => (typeof slug === "string" ? detailOf(slug) : null) },
    "manage:shop-detail": { denied: null, run: (_e, id) => (typeof id === "string" ? shopDetailOf(id) : null) },
    "manage:agents": {
      denied: { ...DENIED, list: [], platform: process.platform, node: null },
      // CLI 연결 탭의 요청 — 저장을 읽지 않는다 (src/agents/agent-request.ts)
      run: (_e, req) => runAgentRequest(parseAgentRequest(req) ?? undefined, { stateDir: PATHS.state }),
    },
    // 포켓몬 메뉴 — 개체 식별자만 받는다. 띄웠으면 true, 띄울 길이 없으면 false
    "manage:pet-menu": {
      denied: false,
      run: (_e, petId) => {
        const petMenu = svc().petMenu;
        if (!petMenu || !isShortId(petId)) return false; // 식별자는 다른 창과 같은 상한(INPUT_LIMITS.idChars)
        petMenu(petId);
        return true;
      },
    },
    // 배틀 파티 칸 메뉴 — 칸 번호(0~5)만 받는다
    "manage:battle-menu": {
      denied: false,
      run: (_e, slot) => {
        const battleMenu = svc().battleMenu;
        if (!battleMenu || !Number.isInteger(slot) || (slot as number) < 0 || (slot as number) > 5) return false;
        battleMenu(slot as number);
        return true;
      },
    },
    "manage:draw-region": {
      denied: DENIED,
      run: async () => {
        const drawRegion = svc().drawRegion;
        return drawRegion ? drawRegion() : { ok: false, reason: "not-ready" };
      },
    },
    "manage:screens": { denied: [], run: () => svc().screens?.() ?? [] },
    "manage:identify-screens": (_e, on) => svc().identifyScreens?.(on === true),
    "manage:pick-screen": {
      denied: DENIED,
      run: async () => {
        const pickScreen = svc().pickScreen;
        return pickScreen ? pickScreen() : { ok: false, reason: "not-ready" };
      },
    },
    "manage:dim": (_e, layers) => deps.setDim(layers === 2 ? 2 : layers === 1 ? 1 : 0),
    // 초상·아이콘 — 요청 모양을 검사하고 한 번에 너무 많이 받지 않는다 (도감 한 화면 분량)
    "manage:portraits": {
      denied: {},
      run: async (_e, asks) => {
        const list = parsePortraitAsks(asks);
        return list ? portraits.get(list) : {};
      },
    },
    "manage:icons": {
      denied: {},
      run: async (_e, keys) => {
        const list = parseIconKeys(keys);
        return list ? portraits.icons(list) : {};
      },
    },
    // 디스크에 있는 그림 전부 — 관리 창이 첫 화면 전에 한 번 부른다.
    // 초상은 불투명 네모를 함께 싣는다 — 관리 창이 첫 그림부터 보는 네모를 정한다 (X15, src/main/art/portraits.ts allImages)
    "manage:art": { denied: {}, run: () => portraits.allImages() },
    // 저작권 안내 — 인자를 받지 않는다. 정해 둔 주소만 기본 브라우저로 연다
    "manage:rights": () => {
      void shell.openExternal(RIGHTS_URL);
    },
    // 교환 링크 복사 — 관리 창이 보낸 짧은 글자만 받는다
    "manage:copy": (_e, text) => {
      const copy = parseCopyText(text);
      if (copy != null) clipboard.writeText(copy);
    },
    // 계정 — 요청 모양은 action 문자열만 확인한다. 값의 검사는 src/online/account.ts 가 한다
    "manage:account": {
      denied: null,
      run: async (_e, req) => {
        const account = svc().account;
        const action = account ? parseAccountAction(req) : null;
        return account && action ? account(action) : null;
      },
    },
    // 우편함 — 정한 세 동작만 받는다. 편지 id 는 짧은 글자만. 선물 값은 렌더러에서 받지 않는다
    "manage:mail": {
      denied: null,
      run: async (_e, req) => {
        const mail = svc().mail;
        const action = mail ? parseMailAction(req) : null;
        return mail && action ? mail(action) : null;
      },
    },
    // 랜덤 배틀 — 상대 받기와 한 판. offerId 는 uuid, pick 은 1~3 만. 보상 값은 렌더러에서 받지 않는다
    "manage:battle": {
      denied: null,
      run: async (_e, req) => {
        const battle = svc().battle;
        const action = battle ? parseBattleAction(req) : null;
        return battle && action ? battle(action) : null;
      },
    },
    // 업데이트 — 정한 세 동작만 받는다
    "manage:update": {
      denied: null,
      run: async (_e, action) => {
        const update = svc().update;
        const act = update ? parseUpdateAction(action) : null;
        return update && act ? update(act) : null;
      },
    },
    "manage:notes": {
      denied: null,
      run: (_e, action) => {
        const notes = svc().notes;
        const act = notes ? parseNotesAction(action) : null;
        return notes && act ? notes(act) : null;
      },
    },
  });
}
