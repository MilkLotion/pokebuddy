// 포켓몬 메뉴 — 이름·상태 / 옮기기 / 밥 주기·놀아주기·볼에 넣기·상세 보기·모습 바꾸기 / 팔기. 앱 전체 조작은 트레이가 맡는다
// (worklog/records/code-structure/design/10-main.md 3.9절 menus/pet-menu.ts)
//
// origin: stage 는 무대의 포켓몬 위 우클릭, manage 는 관리 창의 파티 카드·박스 칸 우클릭 (2026-10-02 사용자 결정 — 같은 메뉴를 쓴다).
// 관리 창의 메뉴에는 상세 보기가 없다 — 카드·칸을 좌클릭하면 바로 상세가 열린다 (2026-10-02 사용자 결정 "좌클릭으로 상세 열게")
// 박스 개체와 볼 안의 개체는 무대에 없다 — 저장의 값으로 메뉴를 만든다. 박스 개체는 밥 주기·놀아주기·볼에 넣기가 흐리다
// 메뉴의 모델(이름·상태·막힌 항목·첫 돌봄 잠금)은 화면 값이 만든다 (src/view/menus.ts petMenuOf). 여기서는 누르면 할 일을 잇고 띄운다
import { formsOf, isFormLocked } from "../../dex/forms";
import type { Command } from "../../shared/command";
import type { ManageRoute } from "../../shared/model/route";
import type { SaveV3 } from "../../shared/save-v3";
import { lockExcept, petMenu, petMenuOf } from "../../view/menus";
import { openMenu } from "./menu-window";
import { portraitKey, type Portraits } from "../art/portraits";
import type { PartyPet } from "../../view/party-pet";
import type { Coach } from "../stage/coach";
import { t } from "../../view/text";
import { preloadFile, rendererFile } from "../windows/files";

// 공유 sid 계열이면 모습 말풍선에 넣을 초상을 먼저 받는다. 캐시에 없어 오래 걸리면 초상 없이 띄운다
const PET_MENU_RULES = { formIconWaitMs: 400 } as const;

export type MenuOrigin = "stage" | "manage";

export interface PetMenuDeps {
  read(): SaveV3 | null; // 메모리 값 — 파일은 15초마다 쓴다
  stagePet(petId: string): PartyPet | null; // 무대에 나와 있는 마리
  portraits(): Portraits | null;
  run(command: Command, then?: () => Command): void; // then — 성공하면 이어서 보낼 명령(첫 돌봄 튜토리얼 완료)
  openManage(route: ManageRoute): void;
  coach: Coach; // 첫 돌봄 2/2 — 남긴 항목, 메뉴 자리
}

export interface PetMenu {
  open(petId: string, origin?: MenuOrigin): void;
}

export function createPetMenu(deps: PetMenuDeps): PetMenu {
  function pop(id: string, origin: MenuOrigin, formIcons: Record<string, string>): void {
    const state = petMenuOf(deps.read(), id, { origin, stagePet: deps.stagePet(id), formIcons, now: Date.now() });
    if (!state) return;
    const firstCare = state.firstCare;
    // 첫 돌봄 튜토리얼 중이면 우클릭 메뉴에서 고른 돌봄이 튜토리얼을 끝낸다
    const careCmd = (cmd: "feed" | "play") => (): void => {
      if (firstCare) deps.run({ cmd, target: id, from: "menu" }, () => ({ cmd: "tutorial.done", target: "first-care", from: "pet" }));
      else deps.run({ cmd, target: id, from: "menu" });
    };
    const sale = state.sale;
    const built = petMenu(state.model, {
      feed: careCmd("feed"),
      play: careCmd("play"),
      ...(state.inSave
        ? {
            ball: () => deps.run({ cmd: state.hidden ? "party.show" : "party.hide", target: id, from: "menu" }),
            // 그 포켓몬의 개체 상세를 연다 — 메뉴는 그 포켓몬 관련 기능만 둔다 (2026-09-28 사용자 결정). 무대 우클릭 메뉴에만 있다
            ...(origin === "stage" ? { detail: () => deps.openManage({ to: "pet", petId: id }) } : {}),
            // 옮기기·팔기 — 고른 뒤의 화면(든 상태, 팔기 확인 창)은 관리 창이 그린다
            move: () => deps.openManage({ to: "move", petId: id }),
            sell: () => {
              if (sale) deps.openManage({ to: "sell", petId: id, price: sale.price });
            },
          }
        : {}),
      // 모습 말풍선에서 고른 모습 — 관리 창이 바꾸기 확인 창을 띄운다
      form: (species) => deps.openManage({ to: "form", petId: id, species }),
    });
    // 첫 돌봄 튜토리얼 2/2 — 남길 항목만 누르게 두고 말풍선에 대기 글자를 알린다
    const items = firstCare ? lockExcept(built, firstCare.keep ? [firstCare.keep] : []) : built;
    if (firstCare) deps.coach.menuStep(firstCare.keep, firstCare.wait);
    // OS 기본 메뉴는 Windows 에서 왼쪽을 크게 비운다 — 앱이 그리는 메뉴를 커서 자리에 띄운다 (docs/specs/ui-components.md C-21)
    // 첫 돌봄 중이면 메뉴 자리를 말풍선에 알려 겹치지 않게 한다. 메뉴가 닫히면 말풍선은 제자리로 돌아간다
    const avoid = firstCare
      ? {
          onPlaced: (r: { x: number; y: number; w: number; h: number }) => deps.coach.menuPlaced(id, r),
          // 메뉴가 닫히면 1/2(우클릭)로 되돌린다 — 메뉴 없이 "메뉴에서 …" 가 남지 않게. 스킵이 아니다
          onClosed: () => deps.coach.menuClosed(),
        }
      : {};
    openMenu({ preload: preloadFile(), html: rendererFile("menu.html"), ...avoid }, items, t("menu.on"));
  }

  return {
    open(id, origin = "stage") {
      const save = deps.read();
      const pet = save?.pets.find((row) => row.id === id) ?? null;
      const forms = pet ? formsOf(pet) : [];
      const art = deps.portraits();
      // 모습 바꾸기 해금 전(로토무)은 말풍선이 없다 — 초상을 기다리지 않고 바로 띄운다
      if (!save || !pet || forms.length < 2 || isFormLocked(pet) || !art) {
        pop(id, origin, {});
        return;
      }
      const asks = forms.map((slug) => ({ slug, shiny: pet.shiny }));
      const none: Record<string, string> = {};
      const got = art.get(asks).then(
        (uris) => Object.fromEntries(asks.flatMap((ask) => (uris[portraitKey(ask)] ? [[ask.slug, uris[portraitKey(ask)] as string]] : []))) as Record<string, string>,
        () => none,
      );
      const late = new Promise<Record<string, string>>((resolve) => setTimeout(() => resolve(none), PET_MENU_RULES.formIconWaitMs));
      void Promise.race([got, late]).then((icons) => pop(id, origin, icons));
    },
  };
}
