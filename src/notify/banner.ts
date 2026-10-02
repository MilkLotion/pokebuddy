// 배너 하나의 문구 — 제목, 대상, `바로가기` 목적지 (Figma `Notification Banner` `338:732`)
//
// 부화 배너는 결과 포켓몬을, 진화 배너는 결과 종을 보이지 않는다 (docs/specs/ui-components.md C-19)
// 줍기 배너는 제목 `줍기` 와 "<주운 마리>가 <것>을 주웠어요" 문구다 (docs/specs/game.md "줍기")
import { defOf } from "../achievement/core.js";
import { loadJson } from "../dex/data.js";
import { megaFormsOf, megaOf } from "../dex/mega.js";
import { getLang, petName, t } from "../main/text.js";
import { josa } from "../shared/josa.js";
import type { BannerView } from "../shared/model/overlays";
import type { ManageRoute } from "../shared/model/route";
import type { FindRecordV3, SaveV3 } from "../shared/save-v3";
import { parseKey } from "./queue.js";

type Named = Record<string, { ko?: string; en?: string } | string>;

// 도구·진화용 도구의 화면 이름. 표에 없으면 식별자 그대로
function itemName(id: string): string {
  const lang = getLang();
  for (const file of ["items.json", "evo-items.json"]) {
    const e = loadJson<Named>(file)[id];
    if (e && typeof e === "object") return (lang === "en" ? e.en : e.ko) ?? e.ko ?? id;
  }
  return id;
}

// 주운 것의 화면 이름 — 포인트는 "120P", 포켓몬은 종 이름
export function foundThing(rec: FindRecordV3): string {
  if (rec.kind === "points") return `${rec.amount}P`;
  if (rec.kind === "pokemon") return petName(rec.ref);
  return itemName(rec.ref);
}

// 줍기 문구 — "피카츄가 경험사탕S를 주웠어요", 포켓몬이면 "피카츄가 이브이를 데려왔어요". 주운 마리는 지금 종 이름
export function foundText(save: SaveV3, rec: FindRecordV3): string {
  const pet = petName(save.pets.find((p) => p.id === rec.petId)?.species ?? rec.species);
  const thing = foundThing(rec);
  return t(rec.kind === "pokemon" ? "banner.brought" : "banner.found", { pet, ga: josa(pet, "이/가"), thing, reul: josa(thing, "을/를") });
}

// 줍기 배너 — 데려온 포켓몬이 사라졌으면 null
function findBanner(save: SaveV3, key: string, id: string): BannerView | null {
  const rec = save.find?.log.find((r) => r.id === id);
  if (!rec) return null;
  let route: ManageRoute;
  if (rec.kind === "pokemon") {
    if (!rec.newPetId || !save.pets.some((p) => p.id === rec.newPetId)) return null;
    route = { to: "pet", petId: rec.newPetId };
  } else route = rec.kind === "points" ? { to: "shop" } : { to: "bag" };
  return { key, kind: "find", title: t("banner.find"), target: foundText(save, rec), go: t("banner.go"), route };
}

// 대상이 이미 사라졌으면 null — 부른 쪽은 그 배너를 건너뛴다
export function bannerOf(save: SaveV3, key: string): BannerView | null {
  const k = parseKey(key);
  if (!k) return null;
  const go = t("banner.go");
  if (k.kind === "hatch") {
    const at = save.eggs.findIndex((e) => e.id === k.target);
    if (at < 0) return null;
    return { key, kind: "hatch", title: t("banner.hatch"), target: t("banner.egg", { n: at + 1 }), go, route: { to: "daycare" } };
  }
  if (k.kind === "evolve") {
    const pet = save.pets.find((p) => p.id === k.target);
    if (!pet) return null;
    return { key, kind: "evolve", title: t("banner.evolve"), target: `${petName(pet.species)} Lv.${pet.level}`, go, route: { to: "pet", petId: pet.id } };
  }
  if (k.kind === "find") return findBanner(save, key, k.target);
  if (k.kind === "mega") {
    const pet = save.pets.find((p) => p.id === k.target);
    const form = pet ? megaFormsOf(pet.species)[0] : undefined;
    if (!pet || !form) return null;
    // 레쿠쟈는 메가스톤 없이 메가진화한다 (2026-10-02 사용자 결정). 원시회귀는 이름만 다르다
    const title = megaOf(form)?.kind === "primal" ? "banner.primal" : pet.species === "rayquaza" ? "banner.mega.ready" : "banner.mega";
    return { key, kind: "mega", title: t(title), target: `${petName(pet.species)} Lv.${pet.level}`, go, route: { to: "pet", petId: pet.id } };
  }
  const def = defOf(k.target);
  if (!def) return null;
  return { key, kind: "achievement", title: t("banner.achievement"), target: def.ko, go, route: { to: "achievements", id: k.target } };
}
