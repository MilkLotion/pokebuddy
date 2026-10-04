// 튜토리얼마다의 시작 조건·목표 행동·막힘 — 대기열 규칙은 src/tutorial/queue.ts 머리말
import { SCREEN_TUTORIAL_IDS } from "../shared/names/tutorials.js";
import type { SaveV3, TutorialState } from "../shared/save-v3";
import { evolveAllowed } from "../party/pet-actions.js";
import { gameDayPart } from "../shared/clock.js";

export type TutorialSurface = "manage" | "stage"; // 관리 창 · 바탕화면

interface TutorialRule {
  id: string;
  surface: TutorialSurface;
  enabled: boolean; // 끄면 줄에 넣지 않는다. 바탕화면 2종은 무대 코치마크(src/renderer/stage.ts)가 생긴 2026-09-26 에 켰다
  start: (save: SaveV3, now: number) => boolean; // 시작 조건
  already: (save: SaveV3) => boolean; // 목표 행동을 이미 했는가
  onlyAtStart?: boolean; // already 를 줄에 들 때만 본다 — 뜬 뒤에는 튜토리얼 안의 행동으로만 끝난다
  after?: string; // 이 튜토리얼의 대기 시각을 물려받는다 — 그 튜토리얼 바로 뒤에 선다
  blocked?: (save: SaveV3, now: number) => boolean; // 지금 보여 줄 수 없다 — 차례를 넘긴다(기록은 그대로). now 는 진화의 낮·밤을 본다
}

const hasRandomEgg = (save: SaveV3): boolean => save.eggs.some((e) => e.kind === "random");
const noShownPet = (save: SaveV3): boolean => !save.party.slots.some((s) => s.state === "pokemon" && s.hidden !== true);
const partyPetIds = (save: SaveV3): string[] => save.party.slots.flatMap((s) => (s.state === "pokemon" && s.petId ? [s.petId] : []));
const noPartyPet = (save: SaveV3): boolean => partyPetIds(save).length === 0;
const ended = (save: SaveV3, id: string): boolean => DONE.includes(save.tutorials[id]?.state ?? "none");
const hasTool = (save: SaveV3): boolean => Object.entries(save.bag).some(([id, n]) => id !== "basic-food" && n > 0);
// 파티 개체 가운데 지금 진화할 수 있는 것이 있다 — 진화 튜토리얼이 그 카드를 밝힌다
const canEvolveNow = (save: SaveV3, now: number): boolean => partyPetIds(save).some((id) => evolveAllowed(save, id, gameDayPart(now)));
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
  // 파티 프리셋 — 파티 튜토리얼을 끝낸 뒤, 다른 프리셋에 넣을 개체가 생길 때(3마리). 파티 튜토리얼 바로 뒤에 선다 (2026-10-02 사용자 확인)
  { id: "preset", surface: "manage", enabled: true, after: "party", start: (s) => ended(s, "party") && s.pets.length >= 3, already: never, blocked: noPartyPet },
  { id: "bag", surface: "manage", enabled: true, start: hasTool, already: never, blocked: (s) => !hasTool(s) },
  { id: "evolution", surface: "manage", enabled: true, start: canEvolveNow, already: never, blocked: (s, now) => !canEvolveNow(s, now) },
];

// 화면을 처음 열 때 띄우는 튜토리얼 — 대기열 밖. 끝내거나 닫기 전까지 그 화면을 열 때마다 1단계부터 보인다
//   area  설정 › 화면 (6단계)   dex  도감 탭   trade  교환 모달   user  사용자 모달 (2단계)
//   box   박스 탭 (3단계) — 우클릭 메뉴 · 옮기기 · 끌어서 자리 바꾸기. 지금 박스에 개체가 있을 때만 보인다 (2026-10-02)
export const SCREEN_TUTORIALS = SCREEN_TUTORIAL_IDS; // 목록의 원본은 src/shared/names/tutorials.ts

export const ruleOf = (id: string): TutorialRule | undefined => TUTORIALS.find((t) => t.id === id);

// 끝난 것으로 보는 상태 — 다시 띄우지 않는다
export const DONE: readonly TutorialState[] = ["skipped", "done"];
