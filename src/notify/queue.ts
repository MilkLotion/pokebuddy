// 알림 배너 줄 — 미처리 상태를 줄에 세우고, 한 번 표시한 상태는 다시 세우지 않는다
//
// 계약은 docs/specs/game.md "알림 배너의 개별 표시", 모듈 경계는 docs/specs/modules.md `src/notify`.
// 상태 판정(부화 준비·진화 가능·업적 미수령)은 도메인 모듈이 한다. 여기서는 줄 세우기·한 번 규칙·순서만 맡는다.
// 대상 키
//   hatch:<알 id>                 알 하나마다
//   evolve:<개체 id>:<지금 종>     개체 하나마다. 종을 넣어 다음 단계 진화는 새 배너가 된다
//   achievement:<업적 id>          업적 하나마다
//   mega:<개체 id>                 메가스톤이 생긴 개체 하나마다 (src/dex/mega.ts)
//   find:<줍기 기록 id>            주운 것 하나마다 (src/find/core.ts). 저장의 최근 줍기 기록(find.log)에 있는 동안 산다
// 순서는 먼저 생긴 것부터. 같은 틱에 생긴 것은 부화 → 진화 → 업적 → 줍기, 같은 종류는 화면 목록 순서다(줍기는 주운 순서).
// pendingOf 가 그 순서로 목록을 만들고 refresh 가 새 키를 끝에 붙이므로 줄은 늘 그 순서다
import { defs } from "../achievement/core.js";
import { canEvolve, dayPartOf } from "../dex/evolve.js";
import type { BannerKind } from "../shared/names/banners";
import type { SaveV3 } from "../shared/save-v3";

export interface Pending {
  key: string;
  kind: BannerKind;
  target: string; // 알 id · 개체 id · 업적 id · 줍기 기록 id
}

// notify.json 의 모양. 게임 저장과 따로 둔다 — 배너는 게임 상태를 바꾸지 않는다
export interface NotifyState {
  v: 1;
  shown: string[]; // 표시한 키. 대상이 사라지면 지운다
  queue: { key: string; at: number }[]; // 아직 표시하지 않은 키. at 은 줄에 들어온 시각
}

export const keyOf = (p: Omit<Pending, "key">, species?: string): string =>
  p.kind === "evolve" ? `evolve:${p.target}:${species ?? ""}` : `${p.kind}:${p.target}`;

// 키를 종류와 대상으로 나눈다. 모르는 키는 null
export function parseKey(key: string): { kind: BannerKind; target: string; species?: string } | null {
  const [kind, target, species] = key.split(":");
  if (!target) return null;
  if (kind === "hatch" || kind === "achievement" || kind === "find" || kind === "mega") return { kind, target };
  if (kind === "evolve" && species) return { kind, target, species };
  return null;
}

// 파티 칸 순서 → 박스 순서. 둘 다에 없는 개체는 뒤에 붙인다
function petOrder(save: SaveV3): string[] {
  const ids: string[] = [];
  for (const slot of save.party.slots) if (slot.petId) ids.push(slot.petId);
  for (const box of save.boxes) for (const id of box.slots) if (id) ids.push(id);
  for (const pet of save.pets) if (!ids.includes(pet.id)) ids.push(pet.id);
  return ids;
}

// 지금 미처리인 상태 전부. 부화 → 진화 → 업적 → 줍기, 같은 종류는 화면 목록 순서.
// 줍기는 처리할 것이 없다 — 최근 기록 전부를 내놓고, 한 번 규칙(shown)이 한 번만 띄운다
export function pendingOf(save: SaveV3, now: number): Pending[] {
  const list: Pending[] = [];
  for (const egg of save.eggs) if (egg.ready) list.push({ key: keyOf({ kind: "hatch", target: egg.id }), kind: "hatch", target: egg.id });
  const dayPart = dayPartOf(now);
  for (const id of petOrder(save)) {
    const pet = save.pets.find((p) => p.id === id);
    if (pet && canEvolve(save, id, dayPart)) list.push({ key: keyOf({ kind: "evolve", target: id }, pet.species), kind: "evolve", target: id });
  }
  for (const [id] of defs()) {
    const row = save.achievements[id];
    // 업적 목록이 늘어난 뒤 첫 판정에서 한꺼번에 달성한 업적(quiet)은 배너를 띄우지 않는다 — 업적 아이콘의 점만 켠다 (src/achievement/core.ts evaluate)
    if (row?.achievedAt != null && row.claimedAt == null && row.quiet !== true) list.push({ key: keyOf({ kind: "achievement", target: id }), kind: "achievement", target: id });
  }
  for (const rec of save.find?.log ?? []) list.push({ key: keyOf({ kind: "find", target: rec.id }), kind: "find", target: rec.id });
  // 메가스톤 — 지닌 개체마다 한 번 (src/dex/mega.ts)
  for (const id of petOrder(save)) {
    if (save.pets.find((p) => p.id === id)?.mega?.stone === true) list.push({ key: keyOf({ kind: "mega", target: id }), kind: "mega", target: id });
  }
  return list;
}

// 표시한 키를 계속 들고 있어야 하는가 — 대상이 남아 있는 동안은 들고 있는다.
// 밤에만 되는 진화처럼 가능 상태가 오가도 다시 뜨지 않게, 미처리 여부가 아니라 대상의 존재로 판단한다
function alive(save: SaveV3, key: string): boolean {
  const k = parseKey(key);
  if (!k) return false;
  if (k.kind === "hatch") return save.eggs.some((e) => e.id === k.target);
  if (k.kind === "evolve") return save.pets.some((p) => p.id === k.target && p.species === k.species);
  if (k.kind === "find") return (save.find?.log ?? []).some((r) => r.id === k.target);
  if (k.kind === "mega") return save.pets.some((p) => p.id === k.target && p.mega?.stone === true);
  const row = save.achievements[k.target];
  return row != null && row.claimedAt == null;
}

// 저장을 한 번 훑은 뒤의 줄. state 가 null 이면 처음 켠 것이다 — 이미 미처리인 상태는 표시한 것으로 둔다
export function refresh(state: NotifyState | null, save: SaveV3, now: number): NotifyState {
  const pending = pendingOf(save, now);
  if (!state) return { v: 1, shown: pending.map((p) => p.key), queue: [] };
  const open = new Set(pending.map((p) => p.key));
  const shown = state.shown.filter((key) => alive(save, key));
  // 기다리는 동안 풀린 상태는 표시하지 않고 뺀다
  const queue = state.queue.filter((q) => open.has(q.key));
  const known = new Set([...shown, ...queue.map((q) => q.key)]);
  for (const p of pending) if (!known.has(p.key)) queue.push({ key: p.key, at: now });
  return { v: 1, shown, queue };
}

// 저장을 통째로 바꿔 받았다(서버 저장 받기) — 받은 저장에 이미 있는 미처리 상태는 표시한 것으로 두고 줄을 비운다.
// 표시 기록은 PC 마다 따로라, 그냥 두면 다른 PC 에서 쌓인 줍기 기록 20건·부화·진화·업적이 전부 새 배너로 줄을 선다
// (2026-10-02 사용자 보고 "다른pc에서 켜놓고왓다가 이 pc에서 켜니까 갑자기 알림이 미친듯이", 결정 "그럼 다 넘기자")
export function settle(state: NotifyState | null, save: SaveV3, now: number): NotifyState {
  const kept = (state?.shown ?? []).filter((key) => alive(save, key));
  return { v: 1, shown: [...new Set([...kept, ...pendingOf(save, now).map((p) => p.key)])], queue: [] };
}

// 줄 맨 앞 하나를 꺼낸다. 꺼내는 순간 표시한 것으로 둔다 — 표시 중에 앱이 끝나도 다시 뜨지 않는다
export function take(state: NotifyState): { state: NotifyState; key: string } | null {
  const [first, ...rest] = state.queue;
  if (!first) return null;
  return { state: { v: 1, shown: [...state.shown, first.key], queue: rest }, key: first.key };
}

export const sameState = (a: NotifyState | null, b: NotifyState): boolean => a != null && JSON.stringify(a) === JSON.stringify(b);

// 파일에서 읽은 값이 줄 모양인가. 아니면 처음 켠 것으로 본다
export function isNotifyState(v: unknown): v is NotifyState {
  if (v == null || typeof v !== "object") return false;
  const s = v as { v?: unknown; shown?: unknown; queue?: unknown };
  return (
    s.v === 1 &&
    Array.isArray(s.shown) &&
    s.shown.every((k) => typeof k === "string") &&
    Array.isArray(s.queue) &&
    s.queue.every((q) => q != null && typeof q === "object" && typeof (q as { key?: unknown }).key === "string" && typeof (q as { at?: unknown }).at === "number")
  );
}
