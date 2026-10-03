// 바탕화면 튜토리얼 말풍선 — 대기열 맨 앞이 바탕화면 것이면 무대에 말풍선을 보낸다
// (worklog/records/code-structure/design/10-main.md 3.10절 stage/coach.ts, src/tutorial/core.ts, docs/specs/game.md "코치마크")
//
// 저장을 새로 읽는 때(게임 틱·명령 뒤·파티 변경)에 sync 를 부른다. 같은 값이면 무대 창이 다시 보내지 않는다
// 첫 돌봄의 단계 — 1/2 우클릭 유도, 포켓몬 메뉴가 열리면 2/2 메뉴에서 밥 주기 (2026-09-27 사용자 결정 "시안대로 진행", Figma `579:16959`).
// 메뉴 단계는 저장에 두지 않는다 — 앱을 다시 켜면 1/2 부터 다시 보인다
import type { Rect } from "../../shared/geometry";
import type { CoachView } from "../../shared/model/stage";
import type { SaveV3 } from "../../shared/save-v3";
import { currentTutorial } from "../../tutorial/queue";
import type { StageGroup } from "../stage-group";
import { t } from "../../view/text";

export interface CoachDeps {
  read(): SaveV3 | null;
  stages(): StageGroup | null; // 무대가 없으면 아무것도 하지 않는다
  quiet(): boolean; // 고스트 모드·숨김 — 말풍선의 ✕ 도 못 누르는 상태를 만들지 않게 기다린다 (2026-09-28 튜토리얼 입력 규칙)
  areaMode(): string; // 놀이공간 방식 — 놀이공간 튜토리얼의 글자
}

export interface Coach {
  sync(): void;
  isShown(): boolean; // 떠 있는 동안 포켓몬 왼쪽 클릭은 놀아주기가 아니다
  menuStep(keep: string | null, wait: string | null): void; // 첫 돌봄 메뉴가 열렸다 — 남긴 항목 이름, 둘 다 쉬면 기다리는 문구
  menuPlaced(petId: string, menu: Rect): void; // 메뉴 자리(화면 좌표) — 말풍선이 피한다
  menuClosed(): void; // 메뉴가 닫혔다 — 1/2(우클릭)로 되돌린다. 스킵이 아니다
  forgetMenu(): void; // 첫 돌봄 말풍선의 버튼을 눌렀다 — 다음 sync 에서 메뉴 단계를 보이지 않는다
}

export function createCoach(deps: CoachDeps): Coach {
  // 값은 메뉴에 남긴 항목의 이름이다. 새 개체는 배부른 채 시작해 밥 주기가 막혀 있으므로 대개 놀아주기다
  let menu: string | null = null;
  // 첫 돌봄 2/2 에서 밥 주기·놀아주기가 둘 다 쉬는 중이면 기다리는 문구와 남은 시간을 보인다
  let wait: string | null = null;
  let avoid: CoachView["avoid"] = undefined; // 열린 메뉴의 자리(무대 좌표)
  let shown: CoachView | null = null; // 무대에 떠 있는 말풍선

  function viewOf(id: string, starterPetId: string | null, petIds: string[]): CoachView | null {
    const waitStep = id === "first-care" && wait != null;
    const menuStep = id === "first-care" && (menu != null || waitStep);
    const key = waitStep ? `coach.${id}.wait` : menuStep ? `coach.${id}.menu` : `coach.${id}`;
    const total = id === "first-care" ? 2 : 1;
    const name = t(`coach.${id}.name`);
    const step = total === 1 ? t("coach.step.single", { name }) : t("coach.step", { name, at: menuStep ? 2 : 1, total }); // 한 단계뿐이면 "1 / 1" 을 붙이지 않는다
    const base = { id, step, title: t(`${key}.title`, { action: menu ?? "" }), body: t(`${key}.body`, { when: wait ?? "" }), button: t(`coach.${id}.button`) };
    if (id === "playground") return { ...base, kind: "area", areaLabel: t(`coach.area.${deps.areaMode()}`) };
    // 첫 돌봄은 첫 포켓몬을 밝힌다. 무대에 없으면(숨김) 나와 있는 첫 마리. 아무도 없으면 기다린다
    const petId = starterPetId && petIds.includes(starterPetId) ? starterPetId : petIds[0];
    // 쉬는 중 단계는 할 수 있는 행동이 없다 — 클릭을 막지 않고 말풍선만 받는다(passive)
    return petId ? { ...base, kind: "pet", petId, ...(waitStep ? { passive: true } : {}), ...(id === "first-care" && avoid ? { avoid } : {}) } : null;
  }

  function sync(): void {
    const stages = deps.stages();
    if (!stages) return;
    const save = deps.read();
    const now = save ? currentTutorial(save, Date.now()) : null;
    const view = now && now.surface === "stage" && save && !deps.quiet() ? viewOf(now.id, save.starterPetId, stages.petIds()) : null;
    shown = view;
    // 첫 돌봄 동안 밝힌 포켓몬을 세운다 — 걸으면 말풍선이 따라 움직인다 (2026-09-27 사용자 피드백)
    stages.pin(view?.kind === "pet" ? view.petId ?? null : null);
    stages.sendCoach(view);
  }

  return {
    sync,
    isShown: () => shown != null,
    menuStep(keep, waitText) {
      if (menu === keep && wait === waitText) return;
      menu = keep;
      wait = waitText;
      sync();
    },
    menuPlaced(petId, r) {
      const s = deps.stages()?.stageRectOf(petId);
      avoid = s ? { x: r.x - s.x, y: r.y - s.y, w: r.w, h: r.h } : undefined;
      sync();
    },
    menuClosed() {
      avoid = undefined;
      menu = null;
      wait = null;
      sync();
    },
    forgetMenu() {
      menu = null;
    },
  };
}
