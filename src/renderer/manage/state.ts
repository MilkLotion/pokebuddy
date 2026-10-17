// 설정창의 기둥 상태 — 모든 기능 파일이 읽는다. 다른 상태는 그 주인 파일의 모듈 변수다
// 화면은 스냅샷(view)을 받아 그리고, 조작은 명령으로 보낸다. 모달은 하나만 뜬다 — 어느 모달인지는 dialog 하나가 가진다
import type { PetView, Snapshot } from "../../shared/model/snapshot.js";
import type { Dialog, TabId } from "./dialog-types.js";

export interface ManageUi {
  view: Snapshot | null;
  tab: TabId;
  detailPet: string | null; // 개체 상세 페이지에 띄운 개체 — 있으면 탭 본문 대신 상세를 그린다
  dialog: Dialog | null;
  notice: string; // 마지막 실패 문구. 모달을 다시 그려도 남는다
  // 답을 기다리는 조작이 있으면 새 조작을 받지 않는다. 빠른 두 번 클릭이 두 번 사거나 두 번 쓰지 않게 한다.
  // 여러 개 사기는 앞 조작의 답을 받은 뒤 다음을 보내므로 막히지 않는다
  busy: boolean;
}

export const ui: ManageUi = { view: null, tab: "party", detailPet: null, dialog: null, notice: "", busy: false };

export const partyPets = (): PetView[] => (ui.view ? ui.view.party.slots.map((s) => s.pet).filter((p): p is PetView => p != null) : []);

export const boxPets = (): PetView[] => (ui.view ? ui.view.boxes.flatMap((b) => b.slots.filter((p): p is PetView => p != null)) : []);

// 스냅샷 객체를 열쇠로 id 색인을 한 번 만든다 — 기기 연결 한 번에 여러 번 찾아도 파티·박스를 한 번만 펼친다.
// ui.view 는 새 스냅샷으로만 바뀌고 제자리에서 고치지 않는다(live.ts). 같은 id 면 파티 쪽이 먼저다
const petIndex = new WeakMap<object, Map<string, PetView>>();
export const petInView = (id: string): PetView | null => {
  if (!ui.view) return null;
  let index = petIndex.get(ui.view);
  if (!index) {
    index = new Map();
    for (const p of [...partyPets(), ...boxPets()]) if (!index.has(p.id)) index.set(p.id, p);
    petIndex.set(ui.view, index);
  }
  return index.get(id) ?? null;
};

export const findPartySlot = (id: string): number | null => ui.view?.party.slots.find((s) => s.pet?.id === id)?.index ?? null;
