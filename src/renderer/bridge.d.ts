// window.pokebuddy — preload 가 contextBridge 로 내놓는 다리. 무대(stage.ts)와 선택 창(picker.ts)이 같은 preload 를 쓴다
// 타입만 — 계약은 src/shared/ipc/ 의 창별 파일(stage·manage·devices·overlays). 이 파일은 emit 되지 않는다
import type { BannerBridge, MenuBridge, RegionBridge, ScreensBridge } from "../shared/ipc/overlays.js";
import type { DexDeviceBridge, PetDeviceBridge, ShopDeviceBridge, BagDeviceBridge, PartyDeviceBridge } from "../shared/ipc/devices.js";
import type { ManageBridge } from "../shared/ipc/manage.js";
import type { AlertBridge } from "../shared/ipc/overlays.js";
import type { StageBridge } from "../shared/ipc/stage.js";

declare global {
  interface Window {
    pokebuddy: StageBridge;
    pokebuddyManage: ManageBridge; // 관리 창만 쓴다 (manage.ts)
    pokebuddyBanner: BannerBridge; // 알림 배너 창만 쓴다 (banner.ts)
    pokebuddyRegion: RegionBridge; // 놀이공간 영역 그리기 창만 쓴다 (region.ts)
    pokebuddyScreens: ScreensBridge; // 놀이공간 화면 번호 덮개 창만 쓴다 (screens.ts)
    pokebuddyMenu: MenuBridge; // 앱이 그리는 메뉴 창만 쓴다 (menu.ts)
    pokebuddyDex: DexDeviceBridge; // 도감 기기 창만 쓴다 (dex.ts)
    pokebuddyPet: PetDeviceBridge; // 파티 상세 기기 창만 쓴다 (pet.ts)
    pokebuddyShop: ShopDeviceBridge; // 상점 기기 창만 쓴다 (shop.ts)
    pokebuddyBag: BagDeviceBridge; // 가방 기기 창만 쓴다 (bag.ts)
    pokebuddyParty: PartyDeviceBridge; // 파티 기기 창(교체 화면)만 쓴다 (party.ts)
    pokebuddyAlert: AlertBridge; // 알림 창만 쓴다 (alert.ts)
  }
}

export {};
