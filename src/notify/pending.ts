// 알림 배너가 설 상태 — 도메인 물음(알 준비·진화 가능·업적 미수령·메가스톤·줍기 기록)으로 대상 목록을 만든다. 줄 세우기는 src/notify/queue.ts
import { defs } from "../achievement/defs.js";
import { canEvolve, dayPartOf } from "../dex/evolve.js";
import type { BannerKind } from "../shared/names/banners";
import type { SaveV3 } from "../shared/save-v3";

export interface Pending {
  key: string;
  kind: BannerKind;
  target: string; // 알 id · 개체 id · 업적 id · 줍기 기록 id
}
export const keyOf = (p: Omit<Pending, "key">, species?: string): string =>
  p.kind === "evolve" ? `evolve:${p.target}:${species ?? ""}` : `${p.kind}:${p.target}`;
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
    // 업적 목록이 늘어난 뒤 첫 판정에서 한꺼번에 달성한 업적(quiet)은 배너를 띄우지 않는다 — 업적 아이콘의 점만 켠다 (src/achievement/evaluate.ts evaluate)
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
export function alive(save: SaveV3, key: string): boolean {
  const k = parseKey(key);
  if (!k) return false;
  if (k.kind === "hatch") return save.eggs.some((e) => e.id === k.target);
  if (k.kind === "evolve") return save.pets.some((p) => p.id === k.target && p.species === k.species);
  if (k.kind === "find") return (save.find?.log ?? []).some((r) => r.id === k.target);
  if (k.kind === "mega") return save.pets.some((p) => p.id === k.target && p.mega?.stone === true);
  const row = save.achievements[k.target];
  return row != null && row.claimedAt == null;
}

// 키를 종류와 대상으로 나눈다. 모르는 키는 null
export function parseKey(key: string): { kind: BannerKind; target: string; species?: string } | null {
  const [kind, target, species] = key.split(":");
  if (!target) return null;
  if (kind === "hatch" || kind === "achievement" || kind === "find" || kind === "mega") return { kind, target };
  if (kind === "evolve" && species) return { kind, target, species };
  return null;
}
