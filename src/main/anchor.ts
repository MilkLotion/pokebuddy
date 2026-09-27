// 창 추적 상태기 — 400ms 마다 헬퍼에게 창 목록을 묻고, 동반자가 따를 창(target) · 표시(visible)를 정한다.
// 맨 앞 창이 터미널 호스트면 그 창을 따르고 그 창의 세션 상태를 본다. 아니면 마지막 창에 그대로 남는다 (follow/front).
// 판정 로직은 follow/(진단 도구와 같은 것) — 두 벌이 되면 진단이 거짓말을 한다.
// Electron 이 필요한 부분(toDip · offScreen · 작업 영역 · quit)은 host 로 받아 node 에서도 돌릴 수 있게 한다.
//
// 결과는 onUpdate 로 낸다 — 무대 창이 setStage(무대 사각형) · setVisible 을 한다. 창을 옮기지 않으므로
// 1판의 petSpot·moveBody 는 여기 없다 (마리 자리는 stage.ts 가 무대 안에서 계산한다)
import * as follow from "../follow/front";
import * as pkstate from "../follow/state";
import type { HelperInfo, HelperInput, HelperWindow, SelfMark, StateInfo, StateRecord } from "../follow/types";
import { helperCommand, parseInfo, queryHelper, stopHelper } from "../follow/winbounds";
import type { Paths } from "./paths";

export const ANCHOR_RULES = {
  // Windows 도 헬퍼를 띄워 두고 묻기 때문에(한 번 1ms 안쪽) mac 과 같은 간격으로 창을 따라간다
  pollMs: 400,
  visibleConfirm: 2, // 표시 전환은 이만큼 연속 같은 판정일 때만 — 한 번의 경합이 깜빡임이 되지 않게
  helperFailWarn: 3, // 헬퍼가 이만큼 연속 실패하면 알린다
};

// Electron 이 있어야 하는 일 — 시험에서는 가짜를 준다
export interface AnchorHost {
  platform: NodeJS.Platform;
  now(): number;
  toDip(w: HelperWindow): HelperWindow; // Windows 물리 픽셀 → DIP
  offScreen(windows: HelperWindow[]): boolean; // mac Space 전환 중 표본인가
  workArea(): HelperWindow; // 터미널 호스트를 한 번도 못 봤을 때의 가짜 창 (fake:true)
  quit(): void;
  quitting(): boolean; // 끝내는 중에는 헬퍼에 묻지 않는다 — before-quit 에서 멈춘 헬퍼를 다음 질문이 다시 띄우면 펫보다 오래 남는다
}

export interface AnchorFlags {
  userHidden: boolean; // 우클릭 · 트레이 · 설정으로 직접 숨김
  held: boolean; // 마리를 들고 있는 중 — 표시 판정을 보류하고 직전 상태를 유지한다
}

export interface AnchorUpdate {
  target: HelperWindow | null; // 따라갈 창 (DIP). fake 면 작업 영역
  visible: boolean; // 디바운스를 거친 표시 여부
}

export interface AnchorOptions {
  paths: Pick<Paths, "state" | "project">;
  self: SelfMark; // 펫 자신을 가리는 표 — 맨 앞 창에서 뺀다
  env?: NodeJS.ProcessEnv;
  host: AnchorHost;
  flags(): AnchorFlags;
  onUpdate(u: AnchorUpdate): void;
  onFocus(key: string | null): void; // 포커스 묶음이 바뀌었다 — 움직임 모듈의 "사용자가 뭔가 했다"
  onInput?(input: HelperInput): void; // 헬퍼가 센 클릭·Esc — 포커스를 쥐지 않은 트레이 메뉴를 닫는다
  log: ((o: Record<string, unknown>) => void) | null;
}

export interface Anchor {
  start(): void;
  stop(): void;
  poll(): void; // 지금 바로 한 번 (메뉴·설정 뒤)
  currentInfo(): StateInfo; // 따를 훅 상태
  target(): HelperWindow | null;
  visible(): boolean;
}

export function createAnchor(opts: AnchorOptions): Anchor {
  const { paths, self, host, log } = opts;
  const env = opts.env ?? process.env;
  const R = ANCHOR_RULES;

  let lastTarget: HelperWindow | null = null; // 마지막으로 따라간 창
  let visible = false;
  let wantLast: boolean | null = null;
  let wantStreak = 0;
  let helperFails = 0;
  let followPids = new Set<number>(); // 이번 폴링이 고른 "따를 세션"의 pid (창 주인)
  let stateRecords: StateRecord[] = []; // 마지막으로 읽은 훅 기록 (최신순) — 폴링마다 한 번 읽어 판정 둘에 같이 쓴다
  let companionTarget: HelperWindow | null = null; // 마지막으로 따른 터미널 호스트 창. 브라우저를 봐도 여기 남는다
  let timer: NodeJS.Timeout | null = null;

  // 훅(pokebuddy-state)이 남긴 세션 상태 중 따를 것 — followPids 를 조상으로 가진 최신 기록 (follow/state stateFor). 비면 대기
  const currentInfo = (): StateInfo => pkstate.stateFor(stateRecords, followPids);

  // 동반자는 늘 보인다 — 맨 앞 창이 터미널이 아니어도 마지막 자리에 남는다. 직접 숨긴 것만 예외
  const want = (): boolean => !opts.flags().userHidden;

  // 표시 전환은 같은 판정이 연속으로 나올 때만 반영한다
  function applyVisible(next: boolean): void {
    if (next === wantLast) wantStreak += 1;
    else {
      wantLast = next;
      wantStreak = 1;
    }
    if (wantStreak < R.visibleConfirm) return;
    visible = next;
  }

  const emit = (): void => opts.onUpdate({ target: lastTarget, visible });

  // 맨 앞 창이 터미널 호스트면 그 창을 따르고 그 창의 세션을 본다. 아니면 마지막 창에 그대로 남는다 (follow/front)
  function resolve(info: HelperInfo, windows: HelperWindow[]): { target: HelperWindow; debug: Record<string, unknown> } {
    const front = follow.frontWindow(info, windows, self);
    const hostInfo = follow.hostOf(front, stateRecords);
    if (hostInfo && front) {
      followPids = new Set(hostInfo.pids);
      companionTarget = front;
      // 포커스 묶음 — 바뀌었다는 사실만 "사용자가 뭔가 했다"로 쓴다. 터미널 호스트가 앞일 때만 본다.
      // 펫 창 자신은 뺀다 — 레벨을 바꿀 때 맨 앞에 끼면 사용자가 한 일로 오인한다
      const top = windows.find((w) => w.pid !== process.pid);
      opts.onFocus(top ? `front:${top.id}` : null);
    }
    // 호스트가 아니거나(브라우저가 앞) 그 창이 목록에 없다(다른 Space) — 마지막 창을 번호로 다시 찾아 위치만 갱신한다.
    // 닫혔으면 마지막 값 그대로 — 펫은 그 자리에 남는다
    if (companionTarget && !hostInfo) {
      const seen = windows.find((w) => w.id === companionTarget!.id);
      if (seen) companionTarget = seen;
    }
    return {
      target: companionTarget ?? host.workArea(),
      debug: { front: front ? front.id : null, host: hostInfo ? hostInfo.kind : null, pids: [...followPids] },
    };
  }

  function poll(): void {
    if (host.quitting()) return;
    // 훅 기록은 폴링마다 한 번 — 호스트 판정(어느 앱이 CLI 를 띄운 적 있나)과 상태 판정이 같이 쓴다
    stateRecords = pkstate.readStateRecords(paths.state);
    const helper = helperCommand(host.platform, paths.project, env);
    if (!helper) {
      // 추적 수단이 없다 — 자리는 작업 영역(가짜 창)으로 갈음해 무대는 있게 한다. 상태는 대기
      lastTarget = host.workArea();
      applyVisible(want());
      emit();
      return;
    }

    queryHelper(helper, (err, stdout) => {
      if (host.quitting()) return;
      if (err) {
        // 동반자는 늘 위가 뜻이라 숨기지 않고 자리만 멈춘다
        helperFails += 1;
        if (helperFails === R.helperFailWarn) process.stderr.write("창 추적 헬퍼가 응답하지 않음 — 창을 따라가지 못한다\n");
        return;
      }
      helperFails = 0;

      const info = parseInfo(stdout);
      if (!info) return;
      if (info.input) opts.onInput?.(info.input);
      const windows = info.windows.map((w) => host.toDip(w));
      // Space 전환 중 — mac 에서만 일어난다. Windows 는 다른 가상 데스크톱의 창이 헬퍼에서 걸러져 들어오지 않고,
      // 화면 밖에 걸어 둔 창 하나(떼어 낸 모니터 자리 등) 때문에 표본을 매번 버리면 펫이 영영 자리를 못 잡는다
      if (host.platform === "darwin" && host.offScreen(windows)) return;

      const picked = resolve(info, windows);
      // 마리를 잡고 있는 동안은 판정을 보류하고 직전 상태를 유지한다
      const next = opts.flags().held ? visible : want();
      lastTarget = picked.target;
      applyVisible(next);
      emit();

      if (log) {
        const tgt = { id: lastTarget.id, x: lastTarget.x, y: lastTarget.y, w: lastTarget.w, h: lastTarget.h, fake: !!lastTarget.fake };
        log({ want: next, visible, ...picked.debug, state: currentInfo().state, target: tgt });
      }
    });
  }

  return {
    start() {
      poll();
      timer = setInterval(poll, R.pollMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      stopHelper();
    },
    poll,
    currentInfo,
    target: () => lastTarget,
    visible: () => visible,
  };
}
