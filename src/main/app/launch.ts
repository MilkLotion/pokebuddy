// 단일 인스턴스·실행 인자·딥링크 (worklog/records/code-structure/design/10-main.md 4.1절 1단계)
//
// 동반자는 기기당 하나 — pokebuddy companion 이 lock 파일로 먼저 가리지만 동시에 두 번 치면 둘 다 통과한다.
// 둘째는 창을 만들기 전에 끝난다
// 떠 있는 동반자를 다시 실행했다(설치한 앱의 바로가기를 한 번 더 누름 등) — 새로 띄우지 않고 관리 창을 연다.
// 교환 링크(pokebuddy://trade/<토큰>)로 실행했으면 그 교환에 참가하고 교환 모달을 연다
import { app } from "electron";
import type { ManageRoute } from "../../shared/model/route";
import { isFriendlyLink, isTradeLink } from "../../trade/link.js";
import { isUpdateTestBuild } from "./dev-run";

// 계정 링크 — GitHub 로그인 뒤 브라우저 쪽(src/online/github.ts callbackPage)이 여는 pokebuddy://account
export function isAccountLink(arg: string): boolean {
  return /^pokebuddy:\/\/account\/?$/.test(arg);
}

// 교환 링크 — 인자 가운데 pokebuddy://trade/ 로 시작하는 것
export function tradeLinkOf(argv: readonly string[]): string | null {
  return argv.find((a) => isTradeLink(a)) ?? null;
}

// 친선 배틀 링크 — 인자 가운데 pokebuddy://battle/ 로 시작하는 것
export function friendlyLinkOf(argv: readonly string[]): string | null {
  return argv.find((a) => isFriendlyLink(a)) ?? null;
}

export interface LaunchHooks {
  onTradeLink(link: string): void; // 교환 링크로 참가
  onFriendlyLink(link: string): void; // 친선 배틀 링크로 참가
  onOpen(route?: ManageRoute): void; // 관리 창 열기
}

// 단일 인스턴스 잠금을 잡는다. 둘째 인스턴스면 quit 을 부르고 거짓
export function claimSingleInstance(hooks: LaunchHooks): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on("second-instance", (_e, argv) => {
    const link = tradeLinkOf(argv);
    const friendly = friendlyLinkOf(argv);
    if (link) hooks.onTradeLink(link);
    else if (friendly) hooks.onFriendlyLink(friendly);
    else if (argv.some(isAccountLink)) hooks.onOpen({ to: "account" }); // GitHub 로그인을 마친 브라우저에서 돌아왔다
    else hooks.onOpen();
  });
  // mac 은 딥링크를 open-url 로 준다
  app.on("open-url", (e, url) => {
    e.preventDefault();
    const link = tradeLinkOf([url]);
    if (link) hooks.onTradeLink(link);
    else if (isFriendlyLink(url)) hooks.onFriendlyLink(url);
    else if (isAccountLink(url)) hooks.onOpen({ to: "account" });
  });
  // 설치한 앱만 등록한다 — 개발 실행의 electron 을 등록하면 앱 없는 빈 Electron 이 링크를 받는다
  if (app.isPackaged && !isUpdateTestBuild()) app.setAsDefaultProtocolClient("pokebuddy");
  return true;
}
