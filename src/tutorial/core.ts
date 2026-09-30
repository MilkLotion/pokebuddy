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
//   첫 돌봄은 줄에 들 때만 본다(onlyAtStart) — 뜬 뒤에는 튜토리얼 메뉴에서 고른 돌봄으로만 끝난다. 다른 곳(설정창·점프 목록·CLI)의
//   밥 주기·놀아주기는 완료로 치지 않는다 (2026-09-28 사용자 "다음버튼이나 튜토리얼 행동이나, 아예 닫기버튼 이것들만 눌리게해줘")
//   바탕화면 놀이공간 튜토리얼은 껐다 — 설정 › 화면을 처음 열 때 설명한다(관리 창의 area, 대기열 밖) (2026-09-28 사용자 "이 영역설명은 설정에서 설명하게 해야할거같아")
//   대기만 한 튜토리얼은 스킵이 아니다. 앱이 꺼져도 queuedAt 이 남아 다시 켜면 같은 순서로 보인다.
// 문구와 대상은 화면(src/renderer/manage.ts)이 가진다. 단계 수도 화면이 정한다.
// 개체 상세 튜토리얼(detail, 4단계)은 대기열 밖이다 — 화면이 상세를 처음 열 때 띄우고 done·skip 만 여기 적는다.
// 화면을 처음 열 때 띄우는 것(area·dex·trade·user)도 대기열 밖이다 — SCREEN_TUTORIALS
//
// 새 기능 튜토리얼(2026-09-29 사용자 "새 기능 튜토리얼 8종 … 개발진행", Figma 05 `930:18248`, worklog/records/tutorial-overhaul/record.md)
//   성장(3단계) → 포인트는 첫 돌봄 뒤에 차례로 선다. 파티와 박스·가방·진화는 그 기능을 처음 쓸 수 있게 될 때 줄에 든다.
//   목표 행동을 이미 했는지(already)는 보지 않는다 — 설명을 읽거나 닫아야 끝난다
import type { SaveV3, TutorialState } from "../shared/save-v3";
import { canEvolve, dayPartOf } from "../dex/evolve.js";

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
  start: (save: SaveV3, now: number) => boolean; // 시작 조건
  already: (save: SaveV3) => boolean; // 목표 행동을 이미 했는가
  onlyAtStart?: boolean; // already 를 줄에 들 때만 본다 — 뜬 뒤에는 튜토리얼 안의 행동으로만 끝난다
  after?: string; // 이 튜토리얼의 대기 시각을 물려받는다 — 그 튜토리얼 바로 뒤에 선다
  blocked?: (save: SaveV3) => boolean; // 지금 보여 줄 수 없다 — 차례를 넘긴다(기록은 그대로)
}

const hasRandomEgg = (save: SaveV3): boolean => save.eggs.some((e) => e.kind === "random");
const noShownPet = (save: SaveV3): boolean => !save.party.slots.some((s) => s.state === "pokemon" && s.hidden !== true);
const partyPetIds = (save: SaveV3): string[] => save.party.slots.flatMap((s) => (s.state === "pokemon" && s.petId ? [s.petId] : []));
const noPartyPet = (save: SaveV3): boolean => partyPetIds(save).length === 0;
const ended = (save: SaveV3, id: string): boolean => DONE.includes(save.tutorials[id]?.state ?? "none");
const hasTool = (save: SaveV3): boolean => Object.entries(save.bag).some(([id, n]) => id !== "basic-food" && n > 0);
// 파티 개체 가운데 지금 진화할 수 있는 것이 있다 — 진화 튜토리얼이 그 카드를 밝힌다
const canEvolveNow = (save: SaveV3, now: number): boolean => partyPetIds(save).some((id) => canEvolve(save, id, dayPartOf(now)));
const never = (): boolean => false;

// 스펙 표의 순서 그대로. 같은 순간에 생긴 조건은 이 순서로 보여 준다
export const TUTORIALS: readonly TutorialRule[] = [
  { id: "first-care", surface: "stage", enabled: true, start: (s) => s.starterPetId != null, already: (s) => s.totals.fed + s.totals.played > 0, onlyAtStart: true, blocked: noShownPet },
  { id: "playground", surface: "stage", enabled: false, after: "first-care", start: (s) => ["skipped", "done"].includes(s.tutorials["first-care"]?.state ?? "none"), already: (s) => s.settings.playArea.mode === "region" },
  { id: "shop", surface: "manage", enabled: true, start: (s) => s.starterPetId != null, already: (s) => s.eggSeq > 0 || s.pets.some((p) => p.id !== s.starterPetId) },
  { id: "hatch", surface: "manage", enabled: true, start: hasRandomEgg, already: (s) => !hasRandomEgg(s) },
  // 업적 — 달성하고 아직 받지 않은 업적이 생기면 헤더의 업적 아이콘으로 이어 준다. 한 번이라도 받으면 끝이다.
  // 2026-09-22 에 업적 튜토리얼을 뺐다가 2026-09-26 사용자 결정("업적도 … 자연스럽게 유도하도록")으로 되살렸다
  {
    id: "achievement",
    surface: "manage",
    enabled: true,
    start: (s) => Object.values(s.achievements).some((a) => a.achievedAt != null),
    already: (s) => Object.values(s.achievements).some((a) => a.claimedAt != null),
  },
  // 새 기능 튜토리얼 — 설명을 끝내거나 닫아야 끝난다(already 없음)
  { id: "growth", surface: "manage", enabled: true, start: (s) => ended(s, "first-care"), already: never, blocked: noPartyPet },
  { id: "points", surface: "manage", enabled: true, after: "growth", start: (s) => ended(s, "growth"), already: never },
  { id: "party", surface: "manage", enabled: true, start: (s) => s.pets.length >= 2, already: never, blocked: noPartyPet },
  { id: "bag", surface: "manage", enabled: true, start: hasTool, already: never, blocked: (s) => !hasTool(s) },
  { id: "evolution", surface: "manage", enabled: true, start: canEvolveNow, already: never, blocked: (s) => !canEvolveNow(s, Date.now()) },
];

// 화면을 처음 열 때 띄우는 튜토리얼 — 대기열 밖. 끝내거나 닫기 전까지 그 화면을 열 때마다 1단계부터 보인다
//   area  설정 › 화면 (6단계)   dex  도감 탭   trade  교환 모달   user  사용자 모달 (2단계)
export const SCREEN_TUTORIALS = ["area", "dex", "trade", "user"] as const;

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
      if (!rule.start(save, now)) continue;
      const queuedAt = rule.after ? (save.tutorials[rule.after]?.queuedAt ?? now) : now;
      save.tutorials[rule.id] = { state: row?.state ?? "none", steps: row?.steps ?? 0, queuedAt };
      fresh.push(rule.id);
      if (rule.already(save)) done(save, rule.id, 0);
      continue;
    }
    if (!rule.onlyAtStart && rule.already(save)) done(save, rule.id, 0);
  }
  return fresh;
}

// 지금 보여 줄 튜토리얼 — 대기열의 맨 앞. 저장을 바꾸지 않는다(스냅샷이 부른다)
export function currentTutorial(save: SaveV3): { id: string; surface: TutorialSurface } | null {
  const order = (id: string): number => TUTORIALS.findIndex((t) => t.id === id);
  const first = Object.entries(save.tutorials)
    .filter(([id, row]) => row.queuedAt != null && !DONE.includes(row.state) && ruleOf(id)?.enabled && !ruleOf(id)?.blocked?.(save))
    .sort(([a, ra], [b, rb]) => (ra.queuedAt ?? 0) - (rb.queuedAt ?? 0) || order(a) - order(b))[0];
  const rule = first ? ruleOf(first[0]) : undefined;
  return rule ? { id: rule.id, surface: rule.surface } : null;
}
