// 튜토리얼 — 규칙은 docs/specs/game.md "행동에 따른 단계별 튜토리얼"
//
// 튜토리얼마다 미시작·진행 중·건너뜀·완료를 따로 둔다. 포인트 지급과 업적 수령은 여기와 별개로 움직인다.
// 건너뛰거나 마친 튜토리얼은 다시 띄우지 않는다. 사용법은 가이드북에서 본다.
//
// 대기열
//   시작 조건을 채우면 그 시각(queuedAt)을 적는다. 먼저 생긴 것부터 하나씩 보여 준다.
//   같은 순간이면 첫 돌봄 → 놀이공간 → 상점 → 부화 → 업적 순서다(TUTORIALS 의 순서).
//   놀이공간은 첫 돌봄의 대기 시각을 물려받아 첫 돌봄 바로 뒤에 선다(after) — 바탕화면 튜토리얼 둘이 이어진다.
//   막힌 튜토리얼(blocked)은 차례를 넘긴다. 첫 돌봄은 바탕화면에 나온 포켓몬이 없으면 막힌다 — 뒤의 설정창 튜토리얼을 막지 않는다.
//   관리 창은 튜토리얼의 탭이 아닌 곳에 있으면 그 탭 버튼으로 이어 준다 — 버튼을 누를 때만 옮긴다(2026-09-26 사용자 결정 "자연스럽게 이동")
//   보여 줄 차례에 목표 행동을 이미 했으면 완료로 기록하고 띄우지 않는다(2026-09-23 결정 "끝낸 단계를 건너뛴다").
//   첫 돌봄은 줄에 들 때만 본다(onlyAtStart) — 뜬 뒤에는 튜토리얼 메뉴에서 고른 돌봄으로만 끝난다. 다른 곳(설정창·CLI)의
//   밥 주기·놀아주기는 완료로 치지 않는다 (2026-09-28 사용자 "다음버튼이나 튜토리얼 행동이나, 아예 닫기버튼 이것들만 눌리게해줘")
//   바탕화면 놀이공간 튜토리얼은 껐다 — 설정 › 화면을 처음 열 때 설명한다(관리 창의 area, 대기열 밖) (2026-09-28 사용자 "이 영역설명은 설정에서 설명하게 해야할거같아")
//   대기만 한 튜토리얼은 스킵이 아니다. 앱이 꺼져도 queuedAt 이 남아 다시 켜면 같은 순서로 보인다.
// 문구와 대상은 화면(src/renderer/manage/tutorial.ts)이 가진다. 단계 수도 화면이 정한다.
// 개체 상세 튜토리얼(detail, 4단계)은 대기열 밖이다 — 화면이 상세를 처음 열 때 띄우고 done·skip 만 여기 적는다.
// 화면을 처음 열 때 띄우는 것(area·dex·trade·user·box)도 대기열 밖이다 — SCREEN_TUTORIALS
//
// 새 기능 튜토리얼(2026-09-29 사용자 "새 기능 튜토리얼 8종 … 개발진행", Figma 05 `930:18248`, worklog/records/tutorial-overhaul/tutorial-overhaul.md)
//   성장(3단계) → 포인트는 첫 돌봄 뒤에 차례로 선다. 파티와 박스·가방·진화는 그 기능을 처음 쓸 수 있게 될 때 줄에 든다.
//   파티 프리셋(3단계)은 파티 튜토리얼을 끝낸 뒤 개체가 3마리 이상이면 줄에 든다 (2026-10-02).
//   목표 행동을 이미 했는지(already)는 보지 않는다 — 설명을 읽거나 닫아야 끝난다
import type { ReasonOf } from "../shared/names/reasons.js";
import { TUTORIAL_STEPS, isTutorialId } from "../shared/names/tutorials.js";
import type { SaveV3, TutorialState } from "../shared/save-v3";
import { DONE, TUTORIALS, replayReady, ruleOf, type TutorialSurface } from "./conditions.js";
import type { Outcome } from "../shared/command.js";

export type TutorialFailure = ReasonOf<"bad-id" | "already">;

export type TutorialResult = Outcome<TutorialFailure> & {
  id?: string;
  state?: TutorialState;
  steps?: number;
};

// 표(TUTORIAL_STEPS)에 없는 id 는 bad-id 다 — 모르는 이름을 저장에 남기지 않는다 (94 항목 9-5-5)
function set(save: SaveV3, id: string, state: TutorialState, steps?: number): TutorialResult {
  if (!id || !isTutorialId(id)) return { ok: false, reason: "bad-id" };
  const row = save.tutorials[id];
  if (row && DONE.includes(row.state)) return { ok: false, reason: "already" };
  const { replay: _replay, ...rest } = row ?? { state: "none" as TutorialState, steps: 0 }; // 끝내거나 닫으면 다시 보기 표시를 지운다
  const next = { ...rest, state, steps: steps ?? row?.steps ?? 0 };
  save.tutorials[id] = next;
  return { ok: true, id, state, steps: next.steps };
}

export const skipTutorial = (save: SaveV3, id: string): TutorialResult => set(save, id, "skipped");

// 끝낸 단계 수는 표(TUTORIAL_STEPS)의 값이다
export const doneTutorial = (save: SaveV3, id: string): TutorialResult => set(save, id, "done", isTutorialId(id) ? TUTORIAL_STEPS[id] : undefined);

// 가이드북의 `다시 보기` 로 고를 수 있는 튜토리얼 — 꺼 둔 놀이공간과, 처음 시작할 때를 전제로 쓴 상점은 뺀다 (docs/specs/game.md "튜토리얼 다시 보기")
export const REPLAYABLE_TUTORIALS = ["first-care", "growth", "points", "hatch", "party", "preset", "box", "bag", "evolution", "dex", "achievement", "trade", "user", "area", "detail"] as const;

// 다시 보기 — 마친·닫은 기록을 지우고 1단계부터 다시 띄운다. 보상이 없는 튜토리얼이라 다시 봐도 포인트·업적은 바뀌지 않는다.
//   대기열 튜토리얼은 맨 앞(queuedAt 0)에 다시 세운다. 화면 튜토리얼·개체 상세는 그 화면을 열 때 뜬다(canShow).
//   replay 표시가 있는 동안 queueTutorials 가 "이미 했다"(already)로 바로 끝내지 않는다
export const replayableNow = (save: SaveV3, now: number): string[] => REPLAYABLE_TUTORIALS.filter((id) => replayReady(save, id, now));

export function replayTutorial(save: SaveV3, id: string): TutorialResult {
  if (!id || !(REPLAYABLE_TUTORIALS as readonly string[]).includes(id)) return { ok: false, reason: "bad-id" };
  const queued = ruleOf(id) != null;
  save.tutorials[id] = { state: "none", steps: 0, ...(queued ? { queuedAt: 0 } : {}), replay: true };
  return { ok: true, id, state: "none", steps: 0 };
}

// 지금 띄워도 되는가 — 건너뛰었거나 마친 것은 다시 띄우지 않는다
export const canShow = (save: SaveV3, id: string): boolean => !DONE.includes(save.tutorials[id]?.state ?? "none");

// 거래 뒤와 시간 처리 끝에 부른다.
//   시작 조건을 채운 튜토리얼에 대기 시각을 적는다.
//   줄에 있는 튜토리얼의 목표 행동을 이미 했으면 완료로 적는다 — 보이는 중에 그 행동을 해도 닫힌다.
// 새로 줄에 든 id 를 돌려준다
export function queueTutorials(save: SaveV3, now: number): string[] {
  const fresh: string[] = [];
  for (const rule of TUTORIALS) {
    if (!rule.enabled) continue;
    const row = save.tutorials[rule.id];
    if (row && DONE.includes(row.state)) continue;
    if (row?.queuedAt == null) {
      if (!rule.start(save, now)) continue;
      const queuedAt = rule.after ? (save.tutorials[rule.after]?.queuedAt ?? now) : now;
      save.tutorials[rule.id] = { state: row?.state ?? "none", steps: row?.steps ?? 0, queuedAt };
      fresh.push(rule.id);
      if (rule.already(save)) doneTutorial(save, rule.id);
      continue;
    }
    if (!rule.onlyAtStart && !row.replay && rule.already(save)) doneTutorial(save, rule.id);
  }
  return fresh;
}

// 지금 보여 줄 튜토리얼 — 대기열의 맨 앞. 저장을 바꾸지 않는다(스냅샷이 부른다). now 는 막힘 판정(진화 튜토리얼의 낮·밤)에 쓴다
export function currentTutorial(save: SaveV3, now: number): { id: string; surface: TutorialSurface } | null {
  const order = (id: string): number => TUTORIALS.findIndex((t) => t.id === id);
  const first = Object.entries(save.tutorials)
    .filter(([id, row]) => row.queuedAt != null && !DONE.includes(row.state) && ruleOf(id)?.enabled && !ruleOf(id)?.blocked?.(save, now))
    .sort(([a, ra], [b, rb]) => (ra.queuedAt ?? 0) - (rb.queuedAt ?? 0) || order(a) - order(b))[0];
  const rule = first ? ruleOf(first[0]) : undefined;
  return rule ? { id: rule.id, surface: rule.surface } : null;
}
