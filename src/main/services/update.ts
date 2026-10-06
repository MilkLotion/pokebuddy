// 앱 업데이트와 패치노트의 연결 — 수명 잠금을 쥔 동반자 하나만 켠다
// (worklog/records/code-structure/design/10-main.md 3.12절 services/update.ts)
//
// 앱 업데이트는 설치본(Windows exe·mac 앱)만 확인한다. 개발 실행·npm 설치본은 버전만 (src/main/update/updater.ts)
// mac 은 자체 엔진 — Squirrel.Mac 은 정식 서명이 없는 앱을 바꾸지 않는다 (src/main/update/mac-updater.ts). Windows 는 electron-updater
// 패치노트는 켤 때 저장이 이미 있었는지로 새로 설치와 업데이트를 가른다 — 그래서 부르는 쪽이 첫 선택 창보다 먼저 hadSave 를 잰다
import os from "node:os";
import { app, shell } from "electron";
import type { PatchNotesView, UpdateAction, UpdateView } from "../../shared/model/account";
import { createPatchNotes, type PatchNotes } from "../update/patch-notes";
import { createMacUpdater } from "../update/mac-updater";
import { createAppUpdater, urgentStep, type AppUpdater } from "../update/updater";

export interface UpdateDeps {
  notesFile: string; // data/patch-notes.json
  seenFile: string; // notes-seen.json
  hadSave: boolean; // 켤 때 save.json 이 이미 있었다
  onView(view: UpdateView): void; // 상태가 바뀌었다 — 관리 창에 밀어 보낸다
  beforeInstall(): Promise<void>; // 다시 시작 전 — 진행을 쓰고 클라우드에 알린다
  askRequired(version: string, manual: boolean): Promise<boolean>; // 업데이트 필요 창 — [지금 다시 시작]이면 참
}

export interface UpdateService {
  start(): void; // 두 번 불러도 한 번만 켠다
  isStarted(): boolean;
  act(action: UpdateAction): Promise<UpdateView>; // 설정 바닥의 업데이트 요청 — 읽기·다시 확인·다시 시작
  notes(action: "list" | "seen"): PatchNotesView; // 패치노트 — 목록 읽기, 안 본 노트를 띄웠다는 알림
  urgent(): void; // 서버가 이 앱 버전을 거절했다
  stop(): void;
}

export function createUpdateService(deps: UpdateDeps): UpdateService {
  let updater: AppUpdater | null = null;
  let patchNotes: PatchNotes | null = null;
  // 업데이트 필요 — 서버가 이 앱 버전을 거절한 실행. 바로 확인하고, 받으면 창을 한 번 띄운다 (src/main/update/updater.ts urgentStep)
  let urgent = false;
  let checked = false;
  let asked = false;

  // 업데이트 필요를 받았거나 그 뒤 업데이트 상태가 바뀌었다 — 확인·창 띄우기 (worklog/records/app-update/app-update.md "업데이트 필요 때 바로 받기")
  //   창은 게임을 멈추지 않는다. 나중에를 고르면 설정의 다시 시작·끌 때 적용이 남는다
  function urgentUpdate(): void {
    if (!updater) return;
    const view = updater.view();
    const step = urgentStep(view.status, asked, checked);
    if (step === "check") {
      checked = true;
      void updater.check();
    } else if (step === "ask") {
      asked = true;
      void deps.askRequired(view.next ?? "", view.status === "manual").then((go) => {
        if (go) void updater?.install();
      });
    }
  }

  return {
    start() {
      if (updater) return;
      patchNotes ??= createPatchNotes({
        notesFile: deps.notesFile,
        seenFile: deps.seenFile,
        version: app.getVersion(),
        hadSave: deps.hadSave,
        autoShow: app.isPackaged, // 개발 실행·E2E 는 띄우지 않는다 — 관리 창 조작을 가린다
      });
      const installed = app.isPackaged && (process.platform === "win32" || process.platform === "darwin");
      updater = createAppUpdater({
        version: app.getVersion(),
        enabled: installed,
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
          deps.onView(view);
          if (urgent) urgentUpdate();
        },
        // 다시 시작 전 — 메모리 진행을 쓰고 클라우드에 올린 뒤 released 를 알린다(최대 3초). 클라우드는 멈추지 않는다 —
        // 설치가 실패해 앱이 계속 돌면 다음 하트비트가 active 로 되돌린다. 이어지는 before-quit 은 기다리지 않는다
        beforeInstall: deps.beforeInstall,
      });
    },
    isStarted: () => updater != null,
    async act(action) {
      if (!updater) throw new Error("updater not started");
      if (action === "check") await updater.check();
      else if (action === "peek") await updater.peek();
      else if (action === "install") await updater.install();
      return updater.view();
    },
    notes(action) {
      if (!patchNotes) return { notes: [], unseen: null };
      if (action === "seen") patchNotes.markSeen();
      return patchNotes.view();
    },
    urgent() {
      urgent = true;
      urgentUpdate();
    },
    stop: () => updater?.stop(),
  };
}
