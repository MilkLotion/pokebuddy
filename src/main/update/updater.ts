// 앱 업데이트 — 설치본이 켜진 채로 새 버전을 받고, 다시 시작하거나 끌 때 적용한다.
// 설계는 worklog/records/app-update/app-update.md. 엔진은 Windows 가 electron-updater(2026-09-28 사용자 승인),
// mac 이 src/main/update/mac-updater.ts(Squirrel.Mac 은 정식 서명이 필요해 직접 한다, 2026-09-28 사용자 승인). 화면 흐름은 같다
//
//   확인    켜진 뒤 1분, 그 뒤 6시간마다 GitHub Release 의 latest.yml 을 본다(설치본의 app-update.yml 이 주소를 준다)
//   받기    새 버전이 있으면 백그라운드로 받는다. 전 설치 파일의 블록맵과 견줘 바뀐 부분만 받는다. sha512 로 검사한다
//   적용    준비되면 설정 모달 바닥이 "다시 시작"이 된다. 누르면 클라우드 저장을 올린 뒤 조용히 설치하고 다시 켠다.
//           누르지 않고 끄면 끌 때 적용한다
// mac 은 앱을 그 자리에서 바꿀 수 없으면(dmg 안·쓰기 불가) 받지 않고 새 버전만 알린다(manual) — `받기` 가 dmg 주소를 연다
// 설치본(Windows exe·mac 앱)에서만 켠다. 개발 실행·npm 설치본은 버전만 보인다
import type { UpdateView } from "../../shared/model/account";

// 엔진이 내는 이벤트와 값 — electron-updater 의 이름 그대로다. update-manual 은 mac 엔진만 낸다(그 자리에서 바꿀 수 없을 때)
// 값은 엔진이 주는 것이라 받는 쪽은 그래도 좁혀서 읽는다(versionOf)
export interface UpdaterEvents {
  "checking-for-update": [];
  "update-not-available": [info: { version?: string }];
  "update-available": [info: { version?: string }];
  "download-progress": [progress: { percent?: number }];
  "update-downloaded": [info: { version?: string }];
  "update-manual": [info: { version?: string; reason?: string }];
  error: [error: unknown];
}

// electron-updater 의 autoUpdater 에서 쓰는 부분만 — 자체 검사는 가짜를 넘긴다
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: unknown;
  on<K extends keyof UpdaterEvents>(event: K, listener: (...args: UpdaterEvents[K]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  openDownload?(): void; // 수동 받기 — mac 엔진만 (update-manual 뒤)
}

export interface AppUpdaterOptions {
  version: string; // 지금 버전
  enabled: boolean; // 설치본(exe)인가
  updater?: UpdaterLike; // 없으면 electron-updater 를 불러온다
  onView: (view: UpdateView) => void;
  beforeInstall: () => Promise<void>; // 다시 시작 전 — 클라우드 저장 올리기 등
  firstCheckMs?: number;
  everyMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  now?: () => number; // peek 의 간격을 잴 시각 — 시험이 넣는다
}

// 설정창을 열 때의 확인(peek)은 마지막 확인 뒤 이만큼 지났을 때만 한다 — 설정창을 여닫을 때마다 GitHub 를 부르지 않게
export const PEEK_GAP_MS = 10 * 60_000;

export interface AppUpdater {
  view: () => UpdateView;
  check: () => Promise<void>; // "다시 확인"
  peek: () => Promise<void>; // 설정창을 열 때 — 마지막 확인 뒤 PEEK_GAP_MS 가 지났을 때만 check
  install: () => Promise<boolean>; // "다시 시작" — 준비된 새 버전이 없으면 false
  stop: () => void;
}

// 업데이트 필요(서버가 이 앱 버전을 거절)를 받은 뒤 할 일 — 설계는 worklog/records/app-update/app-update.md "업데이트 필요 때 바로 받기"
//   ask    준비됐다(ready)·수동(manual) — 창을 띄운다. 실행마다 한 번(asked)
//   check  대기·최신·실패 상태다 — 주기를 기다리지 않고 바로 확인한다. 실행마다 한 번(checked) —
//          클라우드 표시는 자주 바뀌므로 매번 GitHub 를 부르지 않는다. 그 뒤는 6시간 주기가 맡는다
//   none   확인·받는 중(끝나면 다시 판단), 꺼짐(개발 실행·npm 설치본), 이미 창을 띄웠거나 확인했다
export type UrgentStep = "ask" | "check" | "none";

export function urgentStep(status: UpdateView["status"], asked: boolean, checked: boolean): UrgentStep {
  if (status === "ready" || status === "manual") return asked ? "none" : "ask";
  if (status === "idle" || status === "latest" || status === "error") return checked ? "none" : "check";
  return "none";
}

const versionOf = (p: unknown): string | null => {
  const v = (p as { version?: unknown } | null)?.version;
  return typeof v === "string" ? v : null;
};

export function createAppUpdater(o: AppUpdaterOptions): AppUpdater {
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let view: UpdateView = { version: o.version, status: o.enabled ? "idle" : "off", next: null, percent: null, error: null };
  const set = (patch: Partial<UpdateView>): void => {
    view = { ...view, ...patch };
    o.onView(view);
  };
  let timer: unknown = null;
  let stopped = false;
  let installing = false;

  // 켜지 않는다 — 개발 실행·npm 설치본
  if (!o.enabled) return { view: () => view, check: async () => undefined, peek: async () => undefined, install: async () => false, stop: () => undefined };

  // electron-updater 는 설치본에서만 불러온다 — 개발 실행에서 app-update.yml 을 찾지 않게
  const updater: UpdaterLike = o.updater ?? (require("electron-updater") as { autoUpdater: UpdaterLike }).autoUpdater;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.on("checking-for-update", () => {
    if (view.status !== "downloading" && view.status !== "ready") set({ status: "checking", error: null });
  });
  updater.on("update-not-available", () => {
    // 받아 둔 버전이 있으면 그대로 쓸 수 있다 — 릴리스가 내려가도 준비됨을 덮지 않는다
    if (view.status !== "ready") set({ status: "latest", next: null, percent: null, error: null });
  });
  updater.on("update-available", (p) => {
    // 준비된 뒤 다시 확인해 같은 버전이 왔다 — 엔진이 받아 둔 파일을 그대로 쓰니 준비됨을 유지한다(깜빡이지 않게)
    if (view.status === "ready" && versionOf(p) === view.next) return;
    set({ status: "downloading", next: versionOf(p), percent: 0, error: null });
  });
  updater.on("download-progress", (p) => {
    if (view.status === "ready") return;
    const percent = (p as { percent?: unknown } | null)?.percent;
    set({ status: "downloading", percent: typeof percent === "number" ? Math.max(0, Math.min(100, Math.floor(percent))) : view.percent });
  });
  updater.on("update-downloaded", (p) => set({ status: "ready", next: versionOf(p) ?? view.next, percent: 100, error: null }));
  updater.on("update-manual", (p) => set({ status: "manual", next: versionOf(p), percent: null, error: null }));
  updater.on("error", (e) => {
    // 이미 받아 둔 새 버전은 그대로 쓸 수 있다 — 준비됨을 오류로 덮지 않는다
    if (view.status !== "ready") set({ status: "error", error: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
  });

  const now = o.now ?? Date.now;
  let checkedAt: number | null = null;
  // 준비된 뒤에도 확인한다 — 켜 둔 동안 더 새 버전이 나오면 그것을 받아 다시 시작 때 최신이 깔리게
  //   (2026-10-09 "업데이트를 2~3번 받아야 한다" — 처음 받은 버전에 멈춰 있었다. worklog/records/app-update/app-update.md)
  //   준비됨은 확인하는 동안 그대로 보인다. 더 새 버전이면 update-available 이 받는 중으로 바꾼다
  const check: AppUpdater["check"] = async () => {
    if (stopped || view.status === "downloading") return;
    checkedAt = now();
    if (view.status !== "ready") set({ status: "checking", error: null });
    try {
      await updater.checkForUpdates();
    } catch (e) {
      if (view.status !== "ready") set({ status: "error", error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
  };

  const schedule = (ms: number): void => {
    if (stopped) return;
    timer = setTimer(() => {
      timer = null;
      void check().finally(() => schedule(o.everyMs ?? 6 * 60 * 60_000));
    }, ms);
  };
  schedule(o.firstCheckMs ?? 60_000);

  const install: AppUpdater["install"] = async () => {
    // 수동 — 앱을 끄지 않고 받을 곳만 연다
    if (view.status === "manual") {
      updater.openDownload?.();
      return true;
    }
    if (view.status !== "ready" || installing) return false;
    installing = true;
    await o.beforeInstall().catch((e) => {
      console.error("업데이트 전 정리에 실패했다 — 그대로 다시 시작한다", e);
    });
    updater.quitAndInstall(false, true); // 설치 프로그램의 진행 창을 보이며 설치하고 다시 켠다 — 앱이 꺼진 동안 빈 화면이 되지 않게 (2026-09-30 사용자 결정)
    return true;
  };

  const peek: AppUpdater["peek"] = async () => {
    if (checkedAt != null && now() - checkedAt < PEEK_GAP_MS) return;
    await check();
  };

  return {
    view: () => view,
    check,
    peek,
    install,
    stop: () => {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}
