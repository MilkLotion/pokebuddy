// 설정창의 도감 기기 창 연결 — 도감 탭에서 고른 종과, 파티 상세 옆에 붙는 도감(`도감 보기`)이 창 하나를 같이 쓴다 (P10q)
// - 세대 번호: 메인이 닫힘 알림에 실어 준 마지막 번호. 여는 요청에 싣는다 (src/main/device-gen.ts)
// - 옆 도감: 파티 상세의 `도감 보기` 로 켠다. 켜 있는 동안 파티 상세에서 개체를 넘기면 그 종으로 바뀐다
//   (2026-10-01 사용자 결정 "도감창으로 가는게 별로인거같아. 그냥 옆에 그 포켓몬 상세도감기기를 띄울까", Figma 05 `Party / Detail Device / Dex Beside` `1143:20169`)
// - 창을 보내는 일은 파티 상세 기기 창 맞추기(syncPetDevice)가 한다 — 여기는 상태와 여닫기만
import { api } from "./api.js";

export interface DexLinkHooks {
  pickClosed(): void; // 창이 닫혔다 — 도감 탭의 고른 칸을 비운다
  besideChanged(): void; // 옆 도감을 켜거나 껐다, 또는 새 세대 번호로 다시 열어야 한다 — 파티 상세 기기 창을 맞춘다
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
let dexBeside = false;
let dexBesideSent: string | null = null; // 마지막으로 보낸 종
let dexBesideClosing = false; // 우리가 닫으라고 보냈다 — 오는 닫힘 알림은 사용자의 ✕ 가 아니다

// 도감 탭에서 고른 종을 띄운다. null 이면 닫는다
export function openDexPick(slug: string | null): void {
  api.dexOpen(slug ? { slug, beside: false } : null, dexGen);
}

// 파티 상세 기기 창을 보내기 전 — 옆 도감이 켜 있으면 그 종을 먼저 보낸다(같은 종이면 다시 보내지 않는다). 켜 있는지 돌려준다
export function syncDexBeside(species: string): boolean {
  if (dexBeside && dexBesideSent !== species) {
    api.dexOpen({ slug: species, beside: true }, dexGen);
    dexBesideSent = species;
  }
  return dexBeside;
}

export function closeDexBeside(): void {
  if (!dexBeside) return;
  if (dexBesideSent) dexBesideClosing = true;
  dexBeside = false;
  dexBesideSent = null;
  api.dexOpen(null, dexGen);
}

// 도감 보기 — 떠 있으면 닫는다. 관리 창 탭은 그대로다
export function toggleDexBeside(): void {
  if (dexBeside) closeDexBeside();
  else dexBeside = true;
  hooksOf().besideChanged();
}

// 도감을 다시 읽었다 — 부화·해금으로 바뀐 항목을 떠 있는 창에 다시 보낸다
export function resendDex(pick: string | null): void {
  if (pick) openDexPick(pick);
  else if (dexBeside && dexBesideSent) api.dexOpen({ slug: dexBesideSent, beside: true }, dexGen);
}

// 메인의 닫힘 알림
export function onDexClosed(gen: number): void {
  dexGen = gen;
  hooksOf().pickClosed();
  // 우리가 닫은 창이다. 그사이 다시 켰으면 새 세대 번호로 다시 연다 — 닫히기 전에 보낸 여는 요청은 메인이 버렸다
  if (dexBesideClosing) {
    dexBesideClosing = false;
    if (dexBeside) {
      dexBesideSent = null;
      hooksOf().besideChanged();
    }
    return;
  }
  // 옆 도감 기기 창을 ✕·Esc 로 닫았다 — 파티 상세의 `도감 보기` 줄 톤을 끈다
  if (!dexBeside) return;
  dexBeside = false;
  dexBesideSent = null;
  hooksOf().besideChanged();
}
