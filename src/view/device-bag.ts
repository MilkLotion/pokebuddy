// 가방 기기 창 모델 — 고른 도구 하나의 머리 줄·정보 칸과 사용·판매 조작 칸 (Figma 05 `Bag / Device / Use`·`Sell`·`Evolution`).
// 설정창은 고른 값(BagDeviceInput, src/shared/model/devices.ts)만 보내고, 메인의 처리기(src/main/manage/window.ts)가 지금 스냅샷으로 이 함수를 부른다.
// 도구는 파티 개체에게만 쓴다. 진화용 도구는 판매만 있다 (2026-10-01 사용자 결정 C안)
import type { BagDeviceInput, BagDeviceOpen } from "../shared/model/devices.js";
import type { BagItemView, PetView, Snapshot } from "../shared/model/snapshot.js";
import { josa } from "../shared/josa.js";
import { t } from "./text.js";
import { candyMax, candyResult } from "../bag/preview.js";
import { growthCurve } from "../dex/growth.js";
import type { GrowthRate } from "../shared/species.js";
import { itemArtKey, portraitArtKey, type DeviceResult } from "./device-art.js";
import { numberText, pointText, waitText } from "../shared/count-text.js";
import { failTextOf } from "../shared/fail-text.js";
import type { FailCode } from "../shared/names/online-codes.js";


// 한 번에 여러 개 쓰는 도구 — 사탕
export const bagMany = (item: BagItemView): boolean => item.effect === "exp" || item.effect === "level";

// 가방에서 쓸 수 있는 도구 — 효과가 있는 도구. 진화용 도구는 파티 상세의 진화 줄에서 쓴다. 성격민트는 은퇴했다 (src/bag/mint.ts)
// 모습 바꾸기 도구(로토무카탈로그, effect form)는 가방에서 쓰지 않는다 — 모습 바꾸기가 하나씩 쓴다. 판매 쪽만 있다 (2026-10-05)
export const bagUsable = (item: BagItemView): boolean => !item.evolution && item.effect !== undefined && item.effect !== "nature" && item.effect !== "form";

const partyPets = (v: Snapshot): PetView[] => v.party.slots.map((s) => s.pet).filter((p): p is PetView => p != null);

const candyOf = (v: Snapshot, pet: PetView, item: BagItemView) => ({
  curve: growthCurve(pet.growth as GrowthRate),
  effect: item.effect === "level" ? ("level" as const) : ("exp" as const),
  amount: item.amount ?? 0,
});

// 쓸 수 없는 까닭 — 없으면 null. 실행기와 같은 규칙이다 (src/bag/use.ts)
// 쓰기 전에 막는 글은 실행이 낼 실패 코드의 문구 그대로다 — 실패 문구표 한 벌 (src/shared/fail-text.ts, 94 항목 9-3-3)
const failText = (code: FailCode): string => failTextOf(code, "command").text;
function bagBlocked(pet: PetView, item: BagItemView): string | null {
  switch (item.effect) {
    case "exp":
    case "level":
      return pet.level >= 100 ? failText("max-level") : null;
    case "fullness":
    case "fullness-full-buff":
      if (pet.fullness >= 100) return failText("full");
      return pet.feedReady ? null : `${failText("cooldown")} ${waitText(pet.feedInSec)} 남았어요.`;
    case "shiny-on":
      return pet.shiny ? failText("already-shiny") : null;
    case "shiny-off":
      return pet.shiny ? null : failText("already-normal");
    default:
      return null;
  }
}

// 이미 걸린 버프를 다시 걸 때 — 남은 시간을 기본 지속시간으로 바꾼다. 더하지 않는다 (src/bag/use.ts setBuff).
// 쓰기는 막지 않는다 (2026-09-30 사용자 결정 "신남일때, 쓰면 시간갱신으로"). 박스 개체는 버프 시간이 멈춰 있다는 것도 적는다
function buffRefresh(v: Snapshot, pet: PetView, kind: string, full: string): string[] {
  const hit = pet.buffs.find((b) => b.kind === kind);
  const lines = hit ? [`이미 ${hit.name} · 남은 ${waitText(hit.remainMin * 60)} → ${full}${josa(full, "으로/로")} 갱신`] : [];
  if (!partyPets(v).some((p) => p.id === pet.id)) lines.push("버프 시간은 파티에 있을 때만 흘러요");
  return lines;
}

// 미리보기 — 첫 줄과 덧붙는 줄
function bagPreview(v: Snapshot, pet: PetView, item: BagItemView, qty: number): string[] {
  switch (item.effect) {
    case "exp":
    case "level": {
      const c = candyOf(v, pet, item);
      const r = candyResult(c.curve, pet, c.effect, c.amount, qty);
      const lost = item.effect === "exp" ? ` · 소멸 ${numberText(r.lost)}` : "";
      return [`Lv.${pet.level} → Lv.${r.level}`, `획득 경험치 +${numberText(r.gain)}${lost}`];
    }
    case "fullness":
      return [`만복도 ${Math.round(pet.fullness)} → ${Math.min(100, Math.round(pet.fullness + (item.amount ?? 0)))}`, "밥 주기 쿨타임이 시작돼요"];
    // 버프 효과는 "+N%" 꼴 하나 — 적립 줄·명세 돌봄 보너스 표와 같다 (2026-10-04 사용자 결정 "+% 하나", 94 항목 9-3-2)
    case "fullness-full-buff":
      return [`만복도 ${Math.round(pet.fullness)} → 100`, `${t("buff.premium-food")} · 친밀도 증가량 +100% · 2시간`, ...buffRefresh(v, pet, "premium-food", "2시간")];
    case "play-buff":
      return [t("buff.long-play"), "친밀도 증가량 +50% · 2시간", ...buffRefresh(v, pet, "long-play", "2시간")];
    case "shiny-on":
      return ["이로치로 바뀌어요", "돌아오는 약으로 되돌릴 수 있어요"];
    case "shiny-off":
      return ["일반 색으로 돌아가요", "도감의 이로치 기록은 남아요"];
    default:
      return [item.name];
  }
}

// 고른 도구가 가방에 없으면 null(기기 창을 닫는다)
export function bagDeviceModel(v: Snapshot, given: BagDeviceInput): DeviceResult<BagDeviceOpen, BagDeviceInput> | null {
  const item = v.bag.find((i) => i.id === given.itemId);
  if (!item) return null;
  const input = { ...given };
  const usable = bagUsable(item);
  const each = item.sellPrice;
  if (!usable) input.mode = "sell";
  else if (each === undefined) input.mode = "use";
  const about = item.about;
  const face = {
    itemId: item.id,
    kind: item.evolution ? "진화" : "도구",
    name: item.name,
    state: `보유 ×${numberText(item.count)}`,
    group: about?.group ?? "",
    art: itemArtKey(item.id),
    spec: (each !== undefined
      ? [
          ["판매가", pointText(each)],
          ["구매가", pointText(item.buyPrice ?? 0)],
        ]
      : [["판매가", "팔 수 없음"]]) as [string, string][],
    desc: about?.desc ?? "",
    rows: [
      ["효과", about?.effect ?? ""],
      ["쓰는 곳", about?.where ?? ""],
    ] as [string, string][],
    modes: usable && each !== undefined,
    mode: input.mode,
  };

  // 판매 쪽 — 수량, 받는 포인트. 한 거래로 판다 (src/shop/sell.ts)
  if (input.mode === "sell") {
    if (each === undefined) {
      return { input, model: { ...face, title: "판매하기", pager: false, party: null, qty: null, preview: { lead: "팔 수 없는 도구예요", line: "", tone: "" }, go: { label: "팔기", disabled: true, busy: false } } };
    }
    const cap = Math.max(1, item.count);
    input.sellQty = Math.max(1, Math.min(input.sellQty, cap));
    const earned = each * input.sellQty;
    const percent = Math.round((item.sellRate ?? 0) * 100);
    const preview = input.notice
      ? { lead: "팔지 못했어요", line: input.notice, tone: "bad" as const }
      : { lead: `받는 포인트 ${pointText(earned)}`, line: `1개 ${pointText(each)} (구매가의 ${percent}%) · 판매 후 ${pointText(v.points + earned)}`, tone: "" as const };
    return {
      input,
      model: {
        ...face,
        title: "판매하기",
        pager: false,
        party: null,
        qty: { count: input.sellQty, cap, hint: `최대 ${numberText(cap)} · 보유 수` },
        preview,
        go: { label: `${pointText(earned)}에 팔기`, disabled: false, busy: input.busy },
      },
    };
  }

  // 사용 쪽 — 파티 줄, 수량(사탕만), 미리보기
  const party = partyPets(v);
  if (!party.some((p) => p.id === input.targetPetId)) input.targetPetId = party[0]?.id ?? null;
  const pet = party.find((p) => p.id === input.targetPetId) ?? null;
  const strip = party.map((p) => ({ petId: p.id, name: p.name, level: `Lv.${p.level}`, art: portraitArtKey(p.look, p.shiny), picked: p.id === input.targetPetId }));
  if (!pet) {
    return { input, model: { ...face, title: v.party.preset.name, pager: v.party.preset.count > 1, party: strip, qty: null, preview: { lead: "쓸 포켓몬이 없어요", line: "파티에 포켓몬을 넣어 주세요", tone: "" }, go: { label: "사용", disabled: true, busy: false } } };
  }
  const blocked = bagBlocked(pet, item);
  const many = bagMany(item);
  const c = candyOf(v, pet, item);
  const cap = many ? Math.max(1, candyMax(c.curve, pet, c.effect, c.amount, item.count)) : 1;
  input.qty = Math.max(1, Math.min(input.qty, cap));
  // 결과·실패는 새 줄을 끼우지 않고 미리보기 상자의 색과 글자로 보인다 (2026-09-30 사용자 결정)
  let preview: BagDeviceOpen["preview"];
  if (input.result) preview = { lead: input.result.lead, line: input.result.line, tone: "ok" };
  else if (input.notice) preview = { lead: "쓰지 못했어요", line: input.notice, tone: "bad" };
  else if (blocked) preview = { lead: `${pet.name} · ${blocked}`, line: "", tone: "" };
  else {
    const [lead, ...lines] = bagPreview(v, pet, item, input.qty);
    preview = { lead: `${pet.name} ${lead ?? ""}`, line: lines.join(" · "), tone: "" };
  }
  return {
    input,
    model: {
      ...face,
      title: v.party.preset.name, // 사용 쪽 머리 제목은 지금 프리셋 이름이다 (2026-10-02 사용자 결정)
      pager: v.party.preset.count > 1,
      party: strip,
      // 상한의 까닭 — 상점 기기 창처럼 가장 작은 상한 하나. 100레벨까지 드는 개수가 보유 수보다 작으면 Lv.100 (94 항목 9-3-5)
      qty: many ? { count: input.qty, cap, hint: `최대 ${numberText(cap)} · ${cap < item.count ? "Lv.100" : "보유 수"}` } : null,
      preview,
      go: { label: many ? `${numberText(input.qty)}개 사용` : "사용", disabled: !!blocked, busy: input.busy },
    },
  };
}
