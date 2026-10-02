// 기기 창 다섯의 IPC 계약 — 메인 · preload · 렌더러가 같은 모양을 본다. 타입만 둔다

import type { BagDeviceAction, BagDeviceView, DexDeviceView, PartyDeviceAction, PartyDeviceView, PetDeviceAction, PetDeviceView, ShopDeviceAction, ShopDeviceView } from "../model/devices.js";

// dexdev:show 는 메인 → 렌더러. 나머지는 렌더러 → 메인이다
//   size   그린 높이 — 창 높이를 내용에 맞춘다
//   step   이전(-1) · 다음(1)
//   cry    지금 종의 울음소리 data URI (못 받으면 null)
//   close  닫기
export type DexDeviceChannel = "dexdev:show" | "dexdev:size" | "dexdev:step" | "dexdev:cry" | "dexdev:close";

export type PetDeviceChannel = "petdev:show" | "petdev:size" | "petdev:step" | "petdev:cry" | "petdev:close" | "petdev:act";

export interface PetDeviceBridge {
  onShow: (cb: (view: PetDeviceView) => void) => void;
  size: (height: number) => void;
  step: (delta: -1 | 1) => void;
  cry: () => Promise<string | null>;
  close: () => void;
  act: (action: PetDeviceAction) => void;
}

export type ShopDeviceChannel = "shopdev:show" | "shopdev:size" | "shopdev:step" | "shopdev:close" | "shopdev:act";

export interface ShopDeviceBridge {
  onShow: (cb: (view: ShopDeviceView) => void) => void;
  size: (height: number) => void;
  step: (delta: -1 | 1) => void;
  close: () => void;
  act: (action: ShopDeviceAction) => void;
}

export type BagDeviceChannel = "bagdev:show" | "bagdev:size" | "bagdev:step" | "bagdev:close" | "bagdev:act";

export interface BagDeviceBridge {
  onShow: (cb: (view: BagDeviceView) => void) => void;
  size: (height: number) => void;
  step: (delta: -1 | 1) => void;
  close: () => void;
  act: (action: BagDeviceAction) => void;
}

export type PartyDeviceChannel = "partydev:show" | "partydev:size" | "partydev:step" | "partydev:close" | "partydev:act";

export interface PartyDeviceBridge {
  onShow: (cb: (view: PartyDeviceView) => void) => void;
  size: (height: number) => void;
  step: (delta: -1 | 1) => void;
  close: () => void;
  act: (action: PartyDeviceAction) => void;
}

export interface DexDeviceBridge {
  onShow: (cb: (view: DexDeviceView) => void) => void;
  size: (height: number) => void;
  step: (delta: -1 | 1) => void;
  cry: () => Promise<string | null>;
  close: () => void;
}
