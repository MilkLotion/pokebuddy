// 창의 다리 — preload 가 contextBridge 로 내놓은 window.pokebuddy* 를 계약 타입으로 받는다 (설계 20-renderer.md 3.14절, P13)
// - 진입점이 맨 위에서 한 번 부른다. 그 뒤로 window.pokebuddy* 를 직접 읽지 않는다
// - 다른 창의 다리를 청했거나 preload 가 내지 않았으면 던진다 — 그 창을 처음 열 때 드러난다
// - 열쇠가 preload 의 내놓는 표와 같은지는 타입으로 묶을 수 없다(preload 는 이 모듈을 가져오지 못한다). 실행 때 던지는 것으로 잡는다
// 계약은 src/shared/ipc/ 의 창별 파일(stage·picker·manage·devices·overlays)이다
import type { AlertBridge, BannerBridge, MenuBridge, RegionBridge, ScreensBridge } from "../../shared/ipc/overlays.js";
import type { BagDeviceBridge, DexDeviceBridge, PartyDeviceBridge, BattleDeviceBridge, PetDeviceBridge, ShopDeviceBridge } from "../../shared/ipc/devices.js";
import type { BattleScreenBridge } from "../../shared/ipc/battle.js";
import type { ManageBridge } from "../../shared/ipc/manage.js";
import type { PickerBridge } from "../../shared/ipc/picker.js";
import type { StageBridge } from "../../shared/ipc/stage.js";

// 전역 이름 → 그 창의 다리. 창 하나가 다리 하나만 쓴다
export interface Bridges {
  pokebuddy: StageBridge; // 무대 (stage.ts)
  pokebuddyPicker: PickerBridge; // 첫 실행 선택 창 (picker.ts)
  pokebuddyManage: ManageBridge; // 설정창 (manage/api.ts)
  pokebuddyBanner: BannerBridge; // 알림 배너 창 (banner.ts)
  pokebuddyRegion: RegionBridge; // 놀이공간 영역 그리기 창 (region.ts)
  pokebuddyScreens: ScreensBridge; // 놀이공간 화면 번호 덮개 창 (screens.ts)
  pokebuddyMenu: MenuBridge; // 앱이 그리는 메뉴 창 (menu.ts)
  pokebuddyDex: DexDeviceBridge; // 도감 기기 창 (dex.ts)
  pokebuddyPet: PetDeviceBridge; // 파티 상세 기기 창 (pet.ts)
  pokebuddyShop: ShopDeviceBridge; // 상점 기기 창 (shop.ts)
  pokebuddyBag: BagDeviceBridge; // 가방 기기 창 (bag.ts)
  pokebuddyParty: PartyDeviceBridge; // 파티 기기 창 — 교체 화면 (party.ts)
  pokebuddyBattle: BattleDeviceBridge; // 배틀 파티 상세 기기 창 (battle.ts)
  pokebuddyBattleScreen: BattleScreenBridge; // 배틀 창 — 판 재생 (battle/screen.ts)
  pokebuddyAlert: AlertBridge; // 알림 창 (alert.ts)
}

export function needBridge<K extends keyof Bridges>(name: K): Bridges[K] {
  const bridge = (window as unknown as Partial<Bridges>)[name];
  if (!bridge) throw new Error(`다리 없음: window.${name} — 이 창의 preload 가 내놓지 않았다`);
  return bridge as Bridges[K];
}
