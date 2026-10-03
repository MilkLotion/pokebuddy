// 서비스 핸들 묶음 — 온라인(계정·클라우드 저장)·친구 교환·우편함과 받아 둔 교환 링크의 주인
// (worklog/records/code-structure/design/10-main.md 3.12절 services/registry.ts)
//
// 셋 다 저장을 쓰는 동반자(writer)에서 처음 부를 때 만든다. 게임을 멈춘 동안(두 PC 규칙·새로 시작)과 끄는 중에는 만들지 않는다
//   온라인  공유 Supabase 클라이언트·계정·클라우드 저장. 서버 설정이 없으면 null
//   교환    교환 세션을 한 번 시작한다(로그인 확보·반영하지 않은 교환 복구). 교환이 끝나 개체가 바뀌면 무대를 다시 그린다
//   우편함  온라인 기능과 같은 클라이언트를 쓴다. 목록은 관리 창이 열 때와 우편함을 열 때 새로 읽는다
import type { AccountScreen } from "../../shared/model/account";
import type { MailScreen } from "../../shared/model/mail";
import type { TradeScreen } from "../../shared/model/trade";
import { mailCodeOf } from "../../online/codes.js";
import { callRpc } from "../../online/server-call.js";
import { createSessionStorage, sessionFile, type SessionFileStorage } from "../../online/session-storage.js";
import { pendingTradeOf } from "../../party/pet-actions";
import type { GameV3 } from "../game";
import { createMainMail, type MainMail } from "../mail";
import { createMainOnline, type MainOnline, type MainOnlineOptions } from "../online";
import { createMainTrade, type MainTrade } from "../trade";
import { createTradeScreen, type TradeScreenBuilder } from "../../view/trade-screen";
import { createKeyVault } from "./vault";

// 아직 참가하지 않은 교환 링크의 수명 — 참가 전 10분이 지나면 버린다
export const TRADE_LINK_RULES = { ttlMs: 10 * 60_000, settleMs: 10_000 } as const;

export interface ServicesDeps {
  ready(): boolean; // 만들어도 되는가 — 끄는 중이 아니고, 멈추지 않았고, 게임이 있고, writer 다
  game(): GameV3 | null;
  isWriter(): boolean;
  saveFile: string;
  firstLink: string | null; // 링크로 처음 켜졌으면 실행 인자의 교환 링크
  refreshParty(): void; // 저장을 다시 읽는다 — onChange 가 무대와 설정창을 다시 그린다
  openTrade(): void; // 교환 모달을 연다
  sendTrade(screen: TradeScreen): void;
  sendAccount(screen: AccountScreen): void;
  sendMail(screen: MailScreen): void;
  // 온라인 기능이 앱에 알리는 일 — 멈추기·분실·알림·업데이트 필요·새로 시작
  online: Pick<MainOnlineOptions, "onSaveReplaced" | "onHalt" | "onLost" | "onNotice" | "onUpdateRequired" | "freeze" | "thaw" | "onRestart">;
}

export interface Services {
  online(): MainOnline | null; // 없으면 만든다
  current(): MainOnline | null; // 이미 만든 것만 — 멈춘 동안의 확인·다시 시도·끄기 전 정리가 쓴다
  trade(): MainTrade["session"] | null; // 없으면 만들고 한 번 시작한다
  tradeScreen(): TradeScreen | null; // 교환 모달이 그리는 값
  tradeBlocked(): boolean;
  hold(): Promise<boolean>;
  settled(ms: number): Promise<void>;
  mail(): MainMail | null; // 없으면 만든다
  openTradeLink(link: string): void; // 링크를 받아 두고 교환 모달을 연다. 세션이 준비되면 참가한다
  flushTradeLink(): void;
  pause(): void; // 교환·우편을 멈춘다. 온라인은 남긴다 — 확인·다시 시도에 쓴다
  dispose(): void; // 온라인까지 닫는다
}

export function createServices(deps: ServicesDeps): Services {
  let mainOnline: MainOnline | null = null;
  let mainTrade: MainTrade | null = null;
  let tradeScreen: TradeScreenBuilder | null = null;
  let mainMail: MainMail | null = null;
  let tradeStarted: Promise<void> = Promise.resolve(); // 교환 세션의 시작 확인 — 끝나기 전의 참가는 busy 로 거절된다
  let tradeLink: { link: string; at: number } | null = deps.firstLink ? { link: deps.firstLink, at: Date.now() } : null;
  // 세션 파일 저장소 한 벌 — 계정·클라우드(online)와 교환이 같은 메모리로 session.bin 을 본다.
  // 따로 두 벌이면 한쪽이 쓴 세션을 다른 쪽이 낡은 메모리로 덮는다(초상·울음소리 인스턴스를 한 벌로 맞춘 것과 같은 일)
  let sessionStorage: SessionFileStorage | null = null;
  const sessions = (): SessionFileStorage => (sessionStorage ??= createSessionStorage({ file: sessionFile(), vault: createKeyVault() }));

  const stopTrade = (): void => {
    mainTrade?.session.stop();
    mainTrade = null;
    tradeScreen = null;
  };

  function trade(): MainTrade["session"] | null {
    const game = deps.game();
    if (!deps.ready() || !game) return null;
    if (!mainTrade) {
      // 교환 반영을 서버에 알린 뒤 저장을 바로 올린다 — 서버가 그 교환을 저장된 것으로 보게 (design-p1.md 6절)
      // 익명 계정은 교환을 서버에 보내기 전에 거절하고, 제안 직전에는 클라우드 저장을 올린다 (design-p2.md 14절)
      const on = online();
      mainTrade = createMainTrade(
        game,
        on ?? { storage: sessions() },
        () => mainOnline?.noteSaved("event"),
        hold,
        on ? { isAnonymous: () => on.isAnonymous(), beforeOffer: () => on.flush(), mayIssue: () => on.mayIssue() } : undefined,
      );
      if (!mainTrade) return null;
      const screen = createTradeScreen(() => deps.game()?.read() ?? null);
      tradeScreen = screen;
      let lastReceived: string | null = null;
      mainTrade.onView((view) => {
        deps.sendTrade(screen.build(view));
        if (mainOnline) deps.sendAccount(mainOnline.screen()); // 교환이 걸리고 풀림에 따라 계정 탭의 막힘 안내가 바뀐다
        const got = view.received?.petId ?? null;
        if (got && got !== lastReceived) {
          lastReceived = got;
          deps.refreshParty();
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
    const save = deps.game()?.read();
    return !!(save && pendingTradeOf(save));
  }

  // 로그인 계정의 새 교환(만들기·참가)·선물 받기를 막아야 하는가 (worklog-mac/records/cloud-authority 검수 1)
  //   클라우드 저장이 online 이고 올리기가 막히지 않았을 때(CLOUD_OWNER_OTHER·CLOUD_BAD_SAVE 없음)만 연다.
  //   그 밖의 상태에서 교환·선물을 받으면 나중에 서버 저장을 받을 때 결과가 덮여 복제·유실된다
  //   익명 계정은 여기서 막지 않는다 — 교환은 교환 세션이 login-required 로 거절하고(서버도 TRADE_LOGIN_REQUIRED),
  //   선물 받기는 우편함이 MAIL_LOGIN_REQUIRED 로 거절한다(서버 claim_mail 도 익명 거부). 우편 목록 읽기는 익명도 된다.
  //   익명이 켜는 중(connecting)이면 여기서 cloud-wait 가 먼저 나올 수 있다 — 연결이 끝나면 login-required 로 바뀐다.
  //   클라우드가 멈춰(off) 있으면 계정을 직접 읽어 판정한다 — 켜는 중에도 막게. 분실(D29)로 꺼진 로그인 계정도 막는다
  async function hold(): Promise<boolean> {
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
  async function settled(ms: number): Promise<void> {
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

  function online(): MainOnline | null {
    if (!deps.ready()) return null;
    if (!mainOnline) {
      mainOnline = createMainOnline({
        ...deps.online,
        saveFile: deps.saveFile,
        storage: sessions(),
        tradeBlocked,
        // 사용자가 바뀌었다 — 교환 채널은 사용자에 묶여 있으므로 교환 세션을 새로 만든다
        onUserChanged: () => {
          stopTrade();
          trade();
          mainMail?.userChanged(); // 받은 시각은 계정마다 다르다 — 지난 목록을 버리고 새로 읽는다
          void mainMail?.refresh();
        },
      });
      mainOnline?.onScreen((screen) => deps.sendAccount(screen));
    }
    return mainOnline;
  }

  function mail(): MainMail | null {
    const on = online();
    const g = deps.game();
    if (!on || !g) return null;
    if (!mainMail) {
      mainMail = createMainMail({
        // 서버 함수의 MAIL_* 는 그대로, 그 밖은 교환과 같은 규칙(NETWORK · UNKNOWN) — src/online/codes.ts mailCodeOf
        rpc: (fn, args) => callRpc(on.client, fn, args, mailCodeOf),
        // writer 를 놓은 뒤 끝난 받기는 저장을 쓰지 않는다 — 새 writer 의 저장을 덮어쓰지 않게. 다음에 목록을 읽을 때 복구된다
        run: (id, name, args) => (deps.isWriter() ? g.executor.run({ id, name, args }) : { ok: false, reason: "not-writer" }),
        read: () => g.read(),
        signedIn: () => on.screen().signedIn,
        hold,
        onChanged: () => deps.refreshParty(), // 가방·포인트가 바뀌었다 — 설정창을 다시 그린다
      });
      mainMail.onScreen((screen) => deps.sendMail(screen));
    }
    return mainMail;
  }

  // 받아 둔 교환 링크로 참가한다 — 교환 세션이 있고 시작 확인이 끝난 뒤. 명령 처리(ctx.trade)에서는 부르지 않는다
  // 시작 확인 중에 참가하면 busy 로 거절되고 링크가 사라진다(2026-09-27 검수 R2-01)
  function flushTradeLink(): void {
    if (!tradeLink) return;
    if (Date.now() - tradeLink.at > TRADE_LINK_RULES.ttlMs) {
      tradeLink = null;
      return;
    }
    const session = trade();
    if (!session) return;
    const { link } = tradeLink;
    tradeLink = null;
    void tradeStarted
      .then(() => settled(TRADE_LINK_RULES.settleMs)) // 링크로 켰으면 클라우드가 연결 중이다 — 끝나기 전에 참가하면 cloud-wait 로 거절된다
      .then(() => session.join(link))
      .then((r) => {
        // 거절(진행 중인 교환·다른 조작)은 보기에 남지 않는다 — 교환 모달 배너로 알린다
        if (!r.ok && mainTrade && tradeScreen) deps.sendTrade({ ...tradeScreen.build(mainTrade.session.view()), error: { code: r.reason, ...(r.detail ? { detail: r.detail } : {}) } });
      });
    deps.openTrade();
  }

  return {
    online,
    current: () => mainOnline,
    trade,
    tradeScreen: () => (mainTrade && tradeScreen ? tradeScreen.build(mainTrade.session.view()) : null),
    tradeBlocked,
    hold,
    settled,
    mail,
    // 교환 세션이 아직 없으면(준비 전·reader) 생길 때 참가한다
    openTradeLink(link) {
      tradeLink = { link, at: Date.now() };
      flushTradeLink();
      deps.openTrade();
    },
    flushTradeLink,
    pause() {
      stopTrade();
      mainMail = null;
    },
    dispose() {
      stopTrade();
      mainOnline?.dispose();
      mainOnline = null;
      mainMail = null;
    },
  };
}
