// 설정창의 도감 기기 창 연결 — 지금 기기가 도감일 때 대상의 종을 띄운다 (P10q)
// - 띄울 종은 device-kind.ts 가 정한다: 도감 탭은 고른 칸, 파티·박스·모험 탭은 머리 탭으로 바꾼 대상 개체의 종 (docs/specs/ui-components.md "기기 종류 탭")
// - 세대 번호: 메인이 닫힘 알림에 실어 준 마지막 번호. 여는 요청에 싣는다 (src/main/device-gen.ts)
// - 2026-10-01 의 옆 도감(파티 상세의 `도감 보기`)은 2026-10-17 머리의 종류 탭으로 바꿨다
import type { DexDeviceAction } from "../../shared/model/devices.js";
import { api } from "./api.js";
import { besideOf, deviceClosed, dexTarget, kindsOf, moveBeside, openBeside } from "./device-kind.js";
import { closeLayer, openLayer } from "./layers.js";
import { redrawBody } from "./shell.js";
import { ui } from "./state.js";

export interface DexLinkHooks {
  picked(slug: string): void; // 도감 탭에서 연 창의 진화 트리에서 종을 눌렀다 — 도감 탭이 그 종을 고른다
}
let hooks: DexLinkHooks | null = null;
export function setDexLinkHooks(next: DexLinkHooks): void {
  hooks = next;
}
function hooksOf(): DexLinkHooks {
  if (!hooks) throw new Error("dex-link.ts 의 고리가 걸리지 않았다 — setDexLinkHooks 를 먼저 부른다");
  return hooks;
}

let dexGen = 0;
let open = false;
let sent = ""; // 마지막으로 보낸 값(종·종류 탭) — 같으면 다시 보내지 않는다
// 도감 탭 밖에서 연 도감의 진화 트리에서 누른 종 — 대상(base)이 바뀌면 버린다
let treePick: { base: string; slug: string } | null = null;
// 2쪽(모습)에서 누른 모습 — 격자의 고른 칸(기본 종)은 그대로 두고 기기 창만 그 모습을 보인다. 대상(base)이 바뀌면 버린다 (2026-10-18)
let formPick: { base: string; slug: string } | null = null;

// Esc 가 이 겹에 왔다 — 기기 창의 ✕ 와 같다. 메인의 닫힘 알림이 고른 것을 비운다
function closeByEscape(): void {
  closeLayer("device:dex");
  api.dexOpen(null, dexGen);
}

// 도감 기기 창 맞추기 — 띄울 종이 없으면 닫는다. force 면 같은 값도 다시 보낸다(부화·해금으로 항목이 바뀌었다)
// 열림 스택의 겹(layers.ts)을 열 때 넣고 닫을 때 뺀다
export function syncDexDevice(force = false): void {
  const base = dexTarget();
  if (treePick && treePick.base !== base) treePick = null;
  if (formPick && formPick.base !== base) formPick = null;
  const slug = base ? (formPick?.slug ?? treePick?.slug ?? base) : null;
  if (!slug) {
    if (open || sent) api.dexOpen(null, dexGen);
    open = false;
    sent = "";
    closeLayer("device:dex");
    return;
  }
  // 알 목록 칸의 링크로 연 옆 창이면 머리 탭·링크 없이 옆에 붙인다. 지금 기기 창이면 옆 창으로 띄운 알 상품(linkOpen)을 알린다
  const asBeside = besideOf("dex") != null;
  const input = asBeside ? { slug, kinds: [], beside: true } : { slug, kinds: kindsOf(), linkOpen: besideOf("shop") };
  const key = JSON.stringify(input);
  if (open && key === sent && !force) return;
  if (!open) openLayer("device:dex", closeByEscape);
  open = true;
  sent = key;
  api.dexOpen(input, dexGen);
}

// 도감 기기 창에서 한 일 — 진화 트리의 종을 눌러 그 종의 상세로 바꾼다 (2026-10-13 사용자 "진화트리의 해당 포켓몬을 누르면 그 포켓몬 상세로 바뀌게")
// 도감 탭에서 연 창이면 탭이 그 종을 고른다. 다른 탭에서 연 창이면 대상이 바뀔 때까지 그 종을 보인다
export function onDexAction(action: DexDeviceAction): void {
  // 입수처의 알 링크 — 그 상품의 상점 기기 창을 옆 창으로 연다. 다시 누르면 닫는다 (docs/specs/ui-components.md "링크 글자")
  if (action.kind === "shop") {
    openBeside("shop", action.productId);
    return;
  }
  // 2쪽(모습)의 칸 — 기본 종 칸이면 고른 모습을 지운다
  if (action.kind === "form") {
    const base = dexTarget();
    if (!base) return;
    formPick = action.slug === base ? null : { base, slug: action.slug };
    syncDexDevice();
    return;
  }
  // 옆 창의 진화 트리 — 옆 창이 그 종으로 바뀐다
  if (besideOf("dex")) {
    moveBeside(action.slug);
    return;
  }
  if (ui.tab === "dex") {
    hooksOf().picked(action.slug);
    return;
  }
  const base = dexTarget();
  if (!base) return;
  treePick = { base, slug: action.slug };
  syncDexDevice();
}

// 메인의 닫힘 알림 — 보이던 기기면 탭의 고른 것을 비운다. 머리 탭으로 바꿔 닫혔는데 그사이 다시 도감으로 왔으면 새 번호로 다시 연다
export function onDexClosed(gen: number): void {
  dexGen = gen;
  open = false;
  sent = "";
  const again = deviceClosed("dex");
  closeLayer("device:dex");
  if (again) redrawBody();
  else if (dexTarget()) syncDexDevice();
}
