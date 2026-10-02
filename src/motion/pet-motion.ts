// 마리 하나의 움직임 — brain 을 감싸 신호를 모으고, 무대 틱마다 MotionOut 을 돌려준다. 옛 buddy/body.js 의 층.
//
// 무대(main/stage.ts)가 알려 주는 것
//   state   CLI 상태와 마지막 프롬프트 시각 (훅 기록)
//   focus   창·터미널 포커스가 바뀌었는지 — 바뀐 값 자체가 아니라 "바뀌었다"만 쓴다
//   pickup · drag · drop · click · rehome   펫을 직접 만진 것
// 돌려주는 것
//   tick() 의 MotionOut — roam(집 기준 산책 오프셋) · act(보여줄 동작, null 이면 상태 동작) · phase · rhythm
//   act 가 바뀌었는지 비교는 부르는 쪽 — 무대 틱이 매 프레임 StagePet.play 에 담는다 (옛 send 콜백 없음)
//
// 옛 body.js 와 다른 점
//   Date.now 를 부르지 않는다 — now 는 tick·pickup·drop·click·rehome 의 인자. state·focus 는 now 를 선택 인자로 받고,
//   없으면 마지막 tick 의 now 로 친다 (틱이 40ms 간격이라 어긋남은 그 안)
//   활동 시각(activeAt)은 인스턴스 안 — 마리마다 따로 잠든다 (신호는 전원 공통이라 reactMs 지연과 성격 배율로 갈린다)
//   PMD 검사(art.kind)·mode "off" 처리는 무대 쪽 — 여기는 caps 만 받는다
import type { StageState } from "../shared/model/stage";
import { createBrain } from "./brain";
import { NEUTRAL_PARAMS, applyParams, withSleepAfter } from "./params";
import { MOTION_RULES } from "./rules";
import type { MotionCaps, MotionInput, MotionOut, PetMotion, PetMotionOptions } from "./types";

// art/pmd.js buildClips 결과 중 움직임에 필요한 부분 — 무대의 art 층이 이 모양으로 넘긴다
export interface PmdArtLike {
  anims: Record<string, { frames: { ms: number }[] }>;
  work?: Record<string, "once" | "loop">;
  workOnly?: readonly string[];
  zoom: number;
}

// 보유 동작·길이를 art 에서 뽑는다 (옛 body.js capabilities)
export function capsOf(art: PmdArtLike): MotionCaps {
  const have = new Set(Object.keys(art.anims));
  const durOf = (anim: string): number => (art.anims[anim]?.frames ?? []).reduce((sum, f) => sum + f.ms, 0);
  return { have, durOf, work: art.work ?? {}, workOnly: new Set(art.workOnly ?? []), zoom: art.zoom };
}

export function createPetMotion({
  caps,
  params = NEUTRAL_PARAMS,
  sleepAfterMin = null,
  mode = "on",
  timeScale = 1,
  rng = Math.random,
  reactMs = 0,
  log = null,
  now: bornAt,
}: PetMotionOptions): PetMotion {
  // 규칙표 = 설정의 잠들기 기준을 넣은 표(base) × 성격 배율(current). 어느 쪽이 바뀌어도 둘을 다시 곱해 brain 에 넘긴다
  let base = withSleepAfter(sleepAfterMin, MOTION_RULES);
  let current = params;
  const rules = applyParams(current, base);
  const brain = createBrain({
    have: caps.have,
    durOf: caps.durOf,
    work: caps.work,
    workOnly: caps.workOnly,
    mode,
    // 걷는 속도는 도트 배율에 비례 — 큰 펫이 같은 속도로 걸으면 제자리걸음처럼 보인다
    speedPx: rules.WALK.speedPxPerZoom * caps.zoom,
    timeScale,
    rng,
    rules,
    pulls: params,
  });

  let lastNow: number | null = bornAt ?? null; // 마지막으로 본 시각 — now 를 안 주는 state·focus 의 기준
  let activeAt: number | null = bornAt ?? null; // 마지막 사용자 활동 — 막 켰으면 사용자가 있는 것. 모르면 첫 틱 시각
  let seen: StageState = "idle"; // 훅이 알려 준 최신 상태 — 활동 시각 규칙은 이것으로 판단
  let agent: StageState = "idle"; // brain 에 넘기는 상태 — seen 을 마리별 지연 뒤에 따라간다
  let pending: { next: StageState; at: number } | null = null;
  let focusKey: string | null = null;
  let lastLogged: string | null = null; // 마지막으로 찍은 단계·동작 — 작업 동작은 같은 단계(work)에서 동작만 바뀐다

  const clock = (now?: number): number | null => {
    if (now !== undefined && (lastNow === null || now > lastNow)) lastNow = now;
    return now ?? lastNow;
  };
  const bump = (at: number | null): void => {
    if (at === null) return;
    if (activeAt === null || at > activeAt) activeAt = at;
  };

  // 훅이 남긴 상태. promptAt 은 초 단위 (src/follow/state.ts stateFor).
  //   쉬다가 일을 시작함  훅 기록에 promptAt 이 없어도(Codex 등) 프롬프트로 친다.
  //                       실패 표시가 끝나 작업으로 돌아가는 것(failed→running)은 자동이라 빼고
  //   일이 끝남          사용자가 결과를 읽는 때다. 안 치면 수면 시계가 프롬프트부터 돌아,
  //                       수면 시간보다 긴 작업이 끝나자마자 잠든다 (3분 시절 시뮬레이션: 프롬프트의 46% 가 자는 펫에 도착)
  //   반응 지연  여러 마리가 같은 신호를 같은 틱에 받아 똑같이 움직이지 않게, 마리마다 0~reactMs 뒤에 따른다
  function state(next: StageState, promptAt: number | null, now?: number): void {
    const at = clock(now);
    if (promptAt) bump(promptAt * 1000);
    if (next !== seen && next === "running" && seen !== "failed") bump(at);
    if (next !== seen && next === "idle") bump(at);
    if (next !== seen) {
      if (next !== agent && reactMs > 0 && at !== null) pending = { next, at: at + rng() * reactMs * timeScale };
      else {
        agent = next;
        pending = null;
      }
    }
    seen = next;
  }

  // 포커스 묶음(포커스·활성 터미널·터미널 목록 등)이 달라졌으면 사용자가 뭔가 한 것.
  // 기록을 잠깐 못 읽은 것(null)은 변화가 아니다 — A→없음→A 를 두 번의 활동으로 세지 않는다
  function focus(key: string | null, now?: number): void {
    const at = clock(now);
    if (key == null) return;
    if (focusKey !== null && key !== focusKey) bump(at);
    focusKey = key;
  }

  function tick(input: MotionInput): MotionOut {
    const { now } = input;
    clock(now);
    if (activeAt === null) activeAt = now;
    // 틱의 agent 가 state() 로 받은 것과 다르면 상태 변화로 친다 — state() 를 안 부르는 무대도 bump 규칙을 탄다
    if (input.agent !== seen) state(input.agent, null, now);
    if (pending && now >= pending.at) {
      agent = pending.next;
      pending = null;
    }
    const o = brain.tick({ ...input, agent, activeAt });
    const logKey = `${o.phase}|${o.act ? o.act.anim : ""}`;
    if (log && logKey !== lastLogged) {
      lastLogged = logKey;
      log({
        motion: o.phase,
        rhythm: o.rhythm,
        act: o.act ? `${o.act.anim}/${o.act.row}/${o.act.mode}` : null,
        idleSec: Math.round((now - activeAt) / 1000),
        roam: o.roam,
      });
    }
    return o;
  }

  return {
    state,
    tune(next) {
      current = next;
      brain.tune(applyParams(current, base), current);
    },
    sleepAfter(min) {
      base = withSleepAfter(min, MOTION_RULES);
      brain.tune(applyParams(current, base), current);
    },
    focus,
    tick,
    pickup(now) {
      bump(clock(now));
      brain.pickup(now);
    },
    drag(dx, dy) {
      brain.drag(dx, dy);
    },
    drop(now) {
      bump(clock(now));
      brain.drop(now, agent);
    },
    click(now) {
      bump(clock(now));
      brain.click(now, agent);
    },
    // 펫 드래그가 아닌 경로로 자리가 옮겨졌다 — 놓인 자리가 새 집
    rehome(now) {
      clock(now);
      brain.rehome(now);
    },
  };
}
