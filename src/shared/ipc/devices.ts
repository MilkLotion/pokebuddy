// 기기 창 다섯의 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다

import type { BagDeviceAction, BagDeviceView, DexDeviceView, PartyDeviceAction, PartyDeviceView, PetDeviceAction, PetDeviceView, ShopDeviceAction, ShopDeviceView } from "../model/devices.js";
import type { BridgeOf, Invoke, Push, Send } from "./kinds.js";

// 기기 창 다섯이 같은 틀이다 — 접두사(P)와 보이는 값(View)만 다르다. show 는 메인 → 렌더러, 나머지는 렌더러 → 메인
//   show   창에 띄울 값
//   size   그린 높이 — 창 높이를 내용에 맞춘다
//   step   이전(-1) · 다음(1)
//   close  닫기
export type DeviceIpc<P extends string, View> = { [K in `${P}:show`]: Push<"onShow", [view: View]> } & { [K in `${P}:size`]: Send<"size", [height: number]> } & {
  [K in `${P}:step`]: Send<"step", [delta: -1 | 1]>;
} & { [K in `${P}:close`]: Send<"close", []> };
// 누른 단추 — 설정창이 처리한다
export type DeviceActIpc<P extends string, Action> = { [K in `${P}:act`]: Send<"act", [action: Action]> };
// 코치마크(튜토리얼 말풍선)가 떴다·사라졌다 — 메인이 설정창의 창 단추 자리도 함께 어둡게 한다
export type DeviceCoachIpc<P extends string> = { [K in `${P}:coach`]: Send<"coach", [on: boolean]> };
// 지금 종의 울음소리 data URI (못 받으면 null)
export type DeviceCryIpc<P extends string> = { [K in `${P}:cry`]: Invoke<"cry", [], string | null> };

export type DexDeviceIpc = DeviceIpc<"dexdev", DexDeviceView> & DeviceCryIpc<"dexdev">;
export type PetDeviceIpc = DeviceIpc<"petdev", PetDeviceView> & DeviceCryIpc<"petdev"> & DeviceActIpc<"petdev", PetDeviceAction> & DeviceCoachIpc<"petdev">;
export type ShopDeviceIpc = DeviceIpc<"shopdev", ShopDeviceView> & DeviceActIpc<"shopdev", ShopDeviceAction>;
export type BagDeviceIpc = DeviceIpc<"bagdev", BagDeviceView> & DeviceActIpc<"bagdev", BagDeviceAction>;
export type PartyDeviceIpc = DeviceIpc<"partydev", PartyDeviceView> & DeviceActIpc<"partydev", PartyDeviceAction>;

export type DexDeviceChannel = keyof DexDeviceIpc;
export type PetDeviceChannel = keyof PetDeviceIpc;
export type ShopDeviceChannel = keyof ShopDeviceIpc;
export type BagDeviceChannel = keyof BagDeviceIpc;
export type PartyDeviceChannel = keyof PartyDeviceIpc;

export type DexDeviceBridge = BridgeOf<DexDeviceIpc>;
export type PetDeviceBridge = BridgeOf<PetDeviceIpc>;
export type ShopDeviceBridge = BridgeOf<ShopDeviceIpc>;
export type BagDeviceBridge = BridgeOf<BagDeviceIpc>;
export type PartyDeviceBridge = BridgeOf<PartyDeviceIpc>;
