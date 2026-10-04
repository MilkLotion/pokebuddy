// 설정창과 기기 창 다섯(도감·파티 상세·상점·가방·파티 교체) 사이의 길 (계약 ManageDeviceLinkIpc)
// 여는 요청은 wireIpc 로 건다 — 빠진 채널과 인자 모양은 컴파일이 잡는다. 보낸 창 검사는 묶음(scope)이 한다(내 창이 아니면 null)
// 이전·다음·누른 단추·닫힘은 설정창으로 밀어 보낸다(deps.send). 기기 창 틀은 src/main/windows/device-window.ts
// (예전 src/main/manage-window.ts wire() 안에 있었다. 메인 레인 M6c 에서 나눴다)
import path from "node:path";
import type { BrowserWindow } from "electron";
import type { ManageDeviceLinkIpc, ManagePush } from "../../shared/ipc/manage";
import type { Snapshot } from "../../shared/model/snapshot";
import type { GameV3 } from "../../tx/game.js";
import { gainOf } from "../../state/settings.js";
import { SOUND_RULES } from "../../state/rules.js";
import { bagDeviceModel } from "../../view/device-bag.js";
import { partyDeviceModel } from "../../view/device-party.js";
import { petDeviceModel } from "../../view/device-pet.js";
import { shopDeviceModel } from "../../view/device-shop.js";
import { MEGA_STONE_ICON, portraitKey } from "../art/portraits.js";
import { artServices } from "../art/services.js";
import { createDeviceWindow, type DeviceWindow } from "../windows/device-window.js";
import { DEVICE_SIZES, bagDeviceOf, dexDeviceOf, isBagInput, isPartyInput, isPetInput, isShopInput, partyDeviceOf, petDeviceOf, shopDeviceOf, type DeviceArtDeps } from "../windows/devices.js";
import { wireIpc, type IpcScope } from "../windows/ipc.js";
import type { GameReads } from "./handlers.js";

export interface ManageDevicesDeps {
  game: GameV3;
  reads: GameReads; // 화면 읽기 — 설정창 본 처리기와 같은 한 벌 (src/main/manage/handlers.ts)
  preload: string;
  html: string; // 설정창 문서 — 기기 창 문서는 같은 폴더의 <이름>.html
  parent(): BrowserWindow | null; // 기기 창이 붙을 설정창. 없으면 띄우지 않는다
  send<K extends keyof ManagePush>(channel: K, ...args: ManagePush[K]): void; // 설정창으로 밀어 보낸다
  setPetCoach(on: boolean): void; // 파티 상세 기기 창의 코치마크 — 설정창 창 단추 자리도 함께 어둡게 한다
}

export interface ManageDevices {
  forget(): void; // 설정창이 닫혔다 — 마지막으로 띄운 모델을 잊는다
  reset(): void; // 설정창 문서를 (다시) 읽기 시작했다 — 렌더러의 세대 번호가 0 부터라 기기 창 번호도 맞춘다
}

type Shown = "pet" | "shop" | "bag" | "party";

export function wireManageDevices(scope: IpcScope, deps: ManageDevicesDeps): ManageDevices {
  const { game, reads, send } = deps;
  const { snapshot, detailOf, shopDetailOf } = reads;
  // 초상·울음소리 — 기기 창도 앱과 같은 인스턴스를 쓴다 (src/main/art/services.ts)
  const portraits = artServices().portraits;
  const cries = artServices().cries;
  const volume = (): number => {
    const s = game.read()?.settings;
    return s ? gainOf(s, SOUND_RULES.cryMax) : 0;
  };
  // 기기 창에 마지막으로 띄운 모델(세대 번호와 함께) — 설정창은 스냅샷이 바뀔 때마다 고른 값을 다시 보낸다. 모델이 그대로면 다시 그리지 않는다
  const shownModel = new Map<Shown, string>();
  const deviceFiles = (name: string) => ({ preload: deps.preload, html: path.join(path.dirname(deps.html), `${name}.html`) });

  // 도감 기기 창 — 칸을 누르면 띄우고, 이전·다음은 관리 창 목록 순서를 따른다
  const dexWin = createDeviceWindow(deviceFiles("dex"), dexDeviceOf({
    detail: (slug) => detailOf(slug),
    portrait: async (slug) => {
      return (await portraits.get([{ slug, shiny: false }]))[slug] ?? null;
    },
    tree: (slug) => {
      const detail = shopDetailOf(slug); // 상점 구매 창의 포켓몬 상세와 같은 사슬 (src/view/shop-detail.ts)
      return detail?.kind === "pokemon" ? detail.tree : null;
    },
    portraits: async (slugs) => {
      const got = await portraits.get(slugs.map((slug) => ({ slug, shiny: false })));
      const out: Record<string, string> = {};
      for (const slug of slugs) {
        const uri = got[slug];
        if (uri) out[slug] = uri;
      }
      return out;
    },
    cry: (slug) => cries.get(slug),
    volume,
  }), {
    onStep: (delta) => send("manage:dex-step", delta),
    // 관리 창을 닫으면 자식인 기기 창도 같이 닫힌다. 그때는 관리 창 문서가 먼저 없어져 보낼 곳이 없다
    onClosed: (gen) => send("manage:dex-closed", gen),
  });
  // 파티 상세 기기 창 — 관리 창이 개체를 정해 보낸다. 누른 단추·이전·다음은 관리 창으로 돌려보낸다
  const petWin = createDeviceWindow(deviceFiles("pet"), petDeviceOf({
    portrait: async (slug, shiny) => {
      return (await portraits.get([{ slug, shiny }]))[portraitKey({ slug, shiny })] ?? null;
    },
    megaIcon: async () => {
      return (await portraits.icons([MEGA_STONE_ICON]))[MEGA_STONE_ICON] ?? null;
    },
    cry: (slug) => cries.get(slug),
    volume,
  }), {
    onStep: (delta) => send("manage:pet-step", delta),
    onAct: (action) => send("manage:pet-act", action),
    onCoach: (on) => deps.setPetCoach(on),
    onClosed: (gen) => {
      shownModel.delete("pet");
      send("manage:pet-closed", gen);
    },
  });
  // 기기 창 모델의 그림 열쇠(src/view/device-art.ts) → data URI. portrait:<slug>[:shiny] 는 초상, item:<id> 는 도구 그림.
  // egg:<종류> 는 그림 받기가 그 알의 색표로 칠한다(src/main/art/egg-art.ts)
  const deviceArt: DeviceArtDeps = {
    art: async (keys) => {
      const asks = keys
        .filter((k) => k.startsWith("portrait:"))
        .map((k) => {
          const rest = k.slice("portrait:".length);
          const shiny = rest.endsWith(":shiny");
          return { key: k, ask: { slug: shiny ? rest.slice(0, -":shiny".length) : rest, shiny } };
        });
      const items = keys.filter((k) => k.startsWith("item:") || k.startsWith("egg:"));
      const [faces, icons] = await Promise.all([asks.length ? portraits.get(asks.map((a) => a.ask)) : {}, items.length ? portraits.icons(items) : {}]);
      const out: Record<string, string | null> = {};
      for (const a of asks) out[a.key] = (faces as Record<string, string | null>)[portraitKey(a.ask)] ?? null;
      for (const k of items) out[k] = (icons as Record<string, string | null>)[k] ?? null;
      return out;
    },
  };
  // 상점 기기 창 — 관리 창이 상품을 정해 보낸다. 수량·구매·이전·다음은 관리 창으로 돌려보낸다
  const shopWin = createDeviceWindow(deviceFiles("shop"), shopDeviceOf(deviceArt), {
    onStep: (delta) => send("manage:shop-step", delta),
    onAct: (action) => send("manage:shop-act", action),
    onClosed: (gen) => {
      shownModel.delete("shop");
      send("manage:shop-closed", gen);
    },
  });
  // 가방 기기 창 — 관리 창이 도구를 정해 보낸다. 사용·판매·파티 고르기·수량·이전·다음은 관리 창으로 돌려보낸다
  const bagWin = createDeviceWindow(deviceFiles("bag"), bagDeviceOf(deviceArt), {
    onStep: (delta) => send("manage:bag-step", delta),
    onAct: (action) => send("manage:bag-act", action),
    onClosed: (gen) => {
      shownModel.delete("bag");
      send("manage:bag-closed", gen);
    },
  });
  // 파티 기기 창(교체 화면) — 관리 창이 지금 프리셋의 칸을 정해 보낸다. 누른 칸·칩은 관리 창으로 돌려보낸다
  const partyWin = createDeviceWindow(deviceFiles("party"), partyDeviceOf(deviceArt), {
    onStep: (delta) => send("manage:party-step", delta),
    onAct: (action) => send("manage:party-act", action),
    onClosed: (gen) => {
      shownModel.delete("party");
      send("manage:party-closed", gen);
    },
  });

  // 기기 창 띄우기 — 같은 세대 번호로 같은 모델을 이미 띄웠으면 다시 보내지 않는다
  function showDevice<M>(name: Shown, w: DeviceWindow<M>, model: M, gen: unknown): void {
    const parent = deps.parent();
    if (!parent) return;
    const key = `${String(gen)}|${JSON.stringify(model)}`;
    if (shownModel.get(name) === key) return;
    shownModel.set(name, key);
    w.show(parent, model, gen);
  }

  // 고른 값(…DeviceInput)으로 모델을 만들어 띄운다. 띄울 것이 없으면 닫고 null. 답은 바로잡은 입력이다
  function openDevice<I, M>(name: Shown, w: DeviceWindow<M>, input: I | null, make: (v: Snapshot, input: I) => { model: M; input: I } | null, gen: unknown): I | null {
    const v = input ? snapshot() : null;
    const r = v && input ? make(v, input) : null;
    if (!r) {
      shownModel.delete(name);
      w.close();
      return null;
    }
    showDevice(name, w, r.model, gen);
    return r.input;
  }

  // 파티 상세·상점·가방·파티 교체의 모델은 메인이 만든다 — 설정창은 고른 값(…DeviceInput)만 보낸다 (src/view/device-*.ts).
  // 지금 저장의 화면 값(스냅샷)으로 만든다. 설정창은 다음 명령에 바로잡은 입력을 쓴다.
  // 여는 요청에는 관리 창이 마지막으로 받은 세대 번호(gen)가 실려 온다 — 낡은 번호면 기기 창이 버린다 (src/main/windows/device-gen.ts)
  wireIpc<ManageDeviceLinkIpc>(scope, {
    "manage:party-open": { denied: null, run: (_e, input, gen) => openDevice("party", partyWin, isPartyInput(input) ? input : null, partyDeviceModel, gen) },
    "manage:pet-open": { denied: null, run: (_e, input, gen) => openDevice("pet", petWin, isPetInput(input) ? input : null, petDeviceModel, gen) },
    "manage:shop-open": { denied: null, run: (_e, input, gen) => openDevice("shop", shopWin, isShopInput(input) ? input : null, shopDeviceModel, gen) },
    "manage:bag-open": { denied: null, run: (_e, input, gen) => openDevice("bag", bagWin, isBagInput(input) ? input : null, bagDeviceModel, gen) },
    "manage:dex-open": (_e, open, gen) => {
      const parent = deps.parent();
      if (!parent) return;
      // open 은 렌더러가 보낸 값이다 — { slug, beside } 가 아니면 닫는다(예전에도 slug 가 글자가 아니면 닫았다)
      const o = open !== null && typeof open === "object" ? (open as { slug?: unknown; beside?: unknown }) : null;
      // beside — 파티 상세의 `도감 보기`. 관리 창과 파티 상세 기기 창을 한 덩어리로 보고 그 옆에 붙인다
      if (o && typeof o.slug === "string") dexWin.show(parent, { slug: o.slug, beside: o.beside === true ? DEVICE_SIZES.pet.width : 0 }, gen);
      else dexWin.close();
    },
  });

  return {
    forget: () => shownModel.clear(),
    reset: () => {
      shownModel.clear();
      petWin.resetGen();
      dexWin.resetGen();
      shopWin.resetGen();
      bagWin.resetGen();
      partyWin.resetGen();
    },
  };
}
