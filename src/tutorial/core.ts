// 튜토리얼 — 규칙은 docs/specs/game.md "행동에 따른 단계별 튜토리얼"
//
// 튜토리얼마다 미시작·진행 중·건너뜀·완료를 따로 둔다. 포인트 지급과 업적 수령은 여기와 별개로 움직인다.
// 건너뛰거나 마친 튜토리얼은 다시 띄우지 않는다. 사용법은 가이드북에서 본다.
//
// 대기열
//   시작 조건을 채우면 그 시각(queuedAt)을 적는다. 먼저 생긴 것부터 하나씩 보여 준다.
//   같은 순간이면 첫 돌봄 → 상점 → 부화 → 파티 → 업적 → 놀이공간 순서다(TUTORIALS 의 순서).
//   관리 창은 튜토리얼의 탭이 아닌 곳에 있으면 그 탭 버튼으로 이어 준다 — 버튼을 누를 때만 옮긴다(2026-09-26 사용자 결정 "자연스럽게 이동")
//   보여 줄 차례에 목표 행동을 이미 했으면 완료로 기록하고 띄우지 않는다(2026-09-23 결정 "끝낸 단계를 건너뛴다").
//   대기만 한 튜토리얼은 스킵이 아니다. 앱이 꺼져도 queuedAt 이 남아 다시 켜면 같은 순서로 보인다.
// 문구와 대상은 화면(src/renderer/manage.ts)이 가진다. 모두 한 단계다(2026-09-26 사용자 결정 "제안대로 진행").
import type { SaveV3, TutorialState } from "../shared/save-v3";

export type TutorialFailure = "bad-id" | "already";

export interface TutorialResult {
  ok: boolean;
  reason?: TutorialFailure;
  id?: string;
  state?: TutorialState;
  steps?: number;
}

export type TutorialSurface = "manage" | "stage"; // 관리 창 · 바탕화면

interface TutorialRule {
  id: string;
  surface: TutorialSurface;
  enabled: boolean; // 끄면 줄에 넣지 않는다. 바탕화면 2종은 무대 코치마크(src/renderer/stage.ts)가 생긴 2026-09-26 에 켰다
  start: (save: SaveV3) => boolean; // 시작 조건
  already: (save: SaveV3) => boolean; // 목표 행동을 이미 했는가
}

const hasRandomEgg = (save: SaveV3): boolean => save.eggs.some((e) => e.kind === "random");
const otherPet = (save: SaveV3) => save.pets.find((p) => p.id !== save.starterPetId);

// 스펙 표의 순서 그대로. 같은 순간에 생긴 조건은 이 순서로 보여 준다
export const TUTORIALS: readonly TutorialRule[] = [
  { id: "first-care", surface: "stage", enabled: true, start: (s) => s.starterPetId != null, already: (s) => s.totals.fed + s.totals.played > 0 },
  { id: "shop", surface: "manage", enabled: true, start: (s) => s.starterPetId != null, already: (s) => s.eggSeq > 0 || otherPet(s) != null },
  { id: "hatch", surface: "manage", enabled: true, start: hasRandomEgg, already: (s) => !hasRandomEgg(s) },
  {
    id: "party",
    surface: "manage",
    // 끔 — 새 개체가 꺼낸 상태로 들어와(2026-09-27 사용자 "기본 숨기기로 되어있는것들 기본꺼내기로 변경") 가르칠 조작이 없다
    enabled: false,
    start: (s) => otherPet(s) != null,
    // 새 개체를 이미 꺼냈다(숨김이 풀린 파티 칸) — 또는 파티가 가득 차 박스로 갔다. 박스면 밝힐 칸이 없어 줄이 막히므로 넘긴다
    already: (s) => {
      const pet = otherPet(s);
      if (!pet) return false;
      const slot = s.party.slots.find((x) => x.petId === pet.id);
      return !slot || slot.hidden !== true;
    },
  },
  // 업적 — 달성하고 아직 받지 않은 업적이 생기면 헤더의 업적 아이콘으로 이어 준다. 한 번이라도 받으면 끝이다.
  // 2026-09-22 에 업적 튜토리얼을 뺐다가 2026-09-26 사용자 결정("업적도 … 자연스럽게 유도하도록")으로 되살렸다
  {
    id: "achievement",
    surface: "manage",
    enabled: true,
    start: (s) => Object.values(s.achievements).some((a) => a.achievedAt != null),
    already: (s) => Object.values(s.achievements).some((a) => a.claimedAt != null),
  },
  { id: "playground", surface: "stage", enabled: true, start: (s) => ["skipped", "done"].includes(s.tutorials["first-care"]?.state ?? "none"), already: (s) => s.settings.playArea.mode === "region" },
];

const ruleOf = (id: string): TutorialRule | undefined => TUTORIALS.find((t) => t.id === id);

// 끝난 것으로 보는 상태 — 다시 띄우지 않는다
const DONE: readonly TutorialState[] = ["skipped", "done"];

function set(save: SaveV3, id: string, state: TutorialState, steps?: number): TutorialResult {
  if (!id) return { ok: false, reason: "bad-id" };
  const row = save.tutorials[id];
  if (row && DONE.includes(row.state)) return { ok: false, reason: "already" };
  const next = { ...row, state, steps: steps ?? row?.steps ?? 0 };
  save.tutorials[id] = next;
  return { ok: true, id, state, steps: next.steps };
}

export const skip = (save: SaveV3, id: string): TutorialResult => set(save, id, "skipped");

export const done = (save: SaveV3, id: string, steps?: number): TutorialResult => set(save, id, "done", steps);

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
      if (!rule.start(save)) continue;
      save.tutorials[rule.id] = { state: row?.state ?? "none", steps: row?.steps ?? 0, queuedAt: now };
      fresh.push(rule.id);
    }
    if (rule.already(save)) done(save, rule.id, 0);
  }
  return fresh;
}

// 지금 보여 줄 튜토리얼 — 대기열의 맨 앞. 저장을 바꾸지 않는다(스냅샷이 부른다)
export function currentTutorial(save: SaveV3): { id: string; surface: TutorialSurface } | null {
  const order = (id: string): number => TUTORIALS.findIndex((t) => t.id === id);
  const first = Object.entries(save.tutorials)
    .filter(([id, row]) => row.queuedAt != null && !DONE.includes(row.state) && ruleOf(id)?.enabled)
    .sort(([a, ra], [b, rb]) => (ra.queuedAt ?? 0) - (rb.queuedAt ?? 0) || order(a) - order(b))[0];
  const rule = first ? ruleOf(first[0]) : undefined;
  return rule ? { id: rule.id, surface: rule.surface } : null;
}
