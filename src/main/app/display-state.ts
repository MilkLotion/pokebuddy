// 표시 상태 — 숨김·고스트 모드와 저장 설정의 메인 쪽 미러(놀이공간·잠들기 기준·로그인 시 시작)
// (worklog/records/code-structure/design/10-main.md 3.13절 app/display-state.ts)
//
//   숨김        우클릭 · 트레이 · 설정으로 직접 숨김. 폴링이 되돌리지 않도록 상태로 남긴다
//   고스트 모드  이번 실행에만 둔다 — config.json 에 쓰지 않는다. 설정 키는 clickThrough (docs/terms.md "고스트 모드")
//   놀이공간    설정의 `모든 화면 | 한 화면 | 영역 지정`. 터미널 창 대신 이 사각형을 따라가는 창으로 삼는다
//               (2026-09-25 사용자 선택, 2026-09-28 여러 화면)
//   잠들기 기준 설정 `잠들기 기준`(분) — 무대가 틱마다 이 값을 보고 모든 마리에 넣는다 (src/main/stage.ts sleepAfterMin).
//               0 은 잠들지 않음, null 은 규칙표 기본값
//   로그인 시 시작  설정 값을 OS 에 적용한다. 설치한 앱에서만 한다 — 저장소의 `electron .` 을 등록하면
//               다음 로그인 때 앱 없는 빈 Electron 이 뜨기 때문이다
//
// 저장 설정은 매 폴링마다 읽지 않는다. 게임 틱과 관리 창의 설정 변경 뒤에 sync 로 다시 읽는다
import { app } from "electron";
import type { SaveV3 } from "../../shared/save-v3";
import { playLanes, type PlayLane, type ScreenInfo } from "../layout";
import type { DebugLog } from "./log";

type Settings = SaveV3["settings"];
export type PlayArea = Settings["playArea"];

export interface DisplayView {
  hidden: boolean;
  clickThrough: boolean;
}

export interface DisplayStateDeps {
  ghost: boolean; // 처음 고스트 모드 — 설정 파일의 clickThrough
  settings(): Settings | null; // 저장 설정. 게임이 없거나 저장을 못 읽었으면 null
  screens(): ScreenInfo[]; // 지금 화면 목록(번호 순)
  mayLogin: boolean; // 로그인 시 시작을 OS 에 적용해도 되는 실행(설치본, 업데이트 시험 빌드 아님)
  onPlayArea(): void; // 놀이공간이 바뀌었다 — 무대 사각형을 바로 다시 정한다
  onHidden(): void; // 숨김이 바뀐 뒤
  onGhost(on: boolean): void; // 고스트 모드가 바뀐 뒤
  log: DebugLog;
}

export interface DisplayState {
  hidden(): boolean;
  setHidden(on: boolean): void;
  toggleHidden(): void;
  ghost(): boolean;
  setGhost(on: boolean): void;
  playArea(): PlayArea;
  sleepAfterMin(): number | null;
  lanes(): PlayLane[];
  sync(which?: "all" | "play" | "sleep" | "login"): void; // 저장 설정을 다시 읽어 바뀐 것만 적용한다. all 은 로그인 → 놀이공간 → 잠들기 순
  view(): DisplayView;
}

export function createDisplayState(deps: DisplayStateDeps): DisplayState {
  let hidden = false;
  let ghost = deps.ghost;
  let playArea: PlayArea = { mode: "screen", rect: null, screen: null };
  let sleepAfterMin: number | null = null;
  let loginItem: boolean | null = null;

  function syncLogin(): void {
    if (!deps.mayLogin) return;
    const on = deps.settings()?.startOnLogin;
    if (on == null || on === loginItem) return;
    try {
      app.setLoginItemSettings({ openAtLogin: on });
      loginItem = on;
    } catch (e) { deps.log?.({ loginItem: "failed", message: String(e) }); }
  }

  function syncPlay(): void {
    const next = deps.settings()?.playArea;
    if (!next || JSON.stringify(next) === JSON.stringify(playArea)) return;
    playArea = JSON.parse(JSON.stringify(next)) as PlayArea;
    deps.onPlayArea();
  }

  function syncSleep(): void {
    const next = deps.settings()?.sleepAfterMin;
    if (typeof next === "number") sleepAfterMin = next; // 저장을 못 읽었으면 지난 값을 그대로 쓴다
  }

  const setHidden = (on: boolean): void => {
    hidden = on;
    deps.onHidden();
  };

  return {
    hidden: () => hidden,
    setHidden,
    toggleHidden: () => setHidden(!hidden),
    ghost: () => ghost,
    setGhost(on) {
      ghost = on;
      deps.onGhost(on);
    },
    playArea: () => playArea,
    sleepAfterMin: () => sleepAfterMin,
    lanes: () => playLanes(playArea, deps.screens()),
    sync(which = "all") {
      if (which === "all" || which === "login") syncLogin();
      if (which === "all" || which === "play") syncPlay();
      if (which === "all" || which === "sleep") syncSleep();
    },
    view: () => ({ hidden, clickThrough: ghost }),
  };
}
