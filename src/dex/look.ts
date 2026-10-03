// 모습 풀이 — 저장의 모습과 그림 열쇠를 한 곳에서 푼다
// 그림 열쇠는 모습 슬러그에 이로치면 ":shiny" 를 붙인 것이다. 모습은 종 슬러그, 메가 모습(data/mega.json), 리전폼(data/regional.json 의 forms),
// 성별 그림 이름(data/regional.json 의 gender — 종 슬러그가 아니다) 가운데 하나다
// 그림 받기(src/main/art.ts·overworld-art.ts·portraits.ts)가 같은 풀이를 쓴다 — 도감 번호를 따로 셈하면 그림 묶음마다 값이 갈린다
import type { DexOptions } from "./data";
import { megaOf, type MegaForm } from "./mega.js";
import { genderLookInfo, genderLookOf, regionalOf, type GenderLook, type RegionalForm } from "./regional.js";
import { profile } from "./species.js";

// 저장의 모습과 색을 그림 열쇠로 — 메가 모습(mega.on)이 켜져 있으면 그 슬러그가 먼저다.
// 성별마다 그림이 다른 종(대쓰여너 암컷)은 그 성별의 그림 이름이 종보다 먼저다
export const appearanceOf = (pet: { species: string; look?: string; shiny: boolean; gender?: string; mega?: { on?: string } }): string =>
  joinLookKey(pet.mega?.on ?? pet.look ?? genderLookOf(pet.species, pet.gender) ?? pet.species, pet.shiny);

export const splitLookKey = (key: string): { slug: string; shiny: boolean } => ({ slug: key.replace(/:shiny$/, ""), shiny: key.endsWith(":shiny") });
export const joinLookKey = (slug: string, shiny: boolean): string => `${slug}${shiny ? ":shiny" : ""}`;

export type LookKind = "plain" | "regional" | "mega" | "gender";

export interface Look {
  slug: string; // 모습 슬러그 — 이로치 꼬리표를 뗀 것
  shiny: boolean;
  kind: LookKind;
  base: string; // 기본 종 — 메가·리전폼은 표의 base, 성별 그림은 그 종, 그 밖은 slug
  dex: number; // 그림 묶음에 적는 도감 번호 — 메가는 기본 종, 성별 그림은 그 종, 그 밖은 모습 자신의 번호. 표에 없으면 0
  mega: MegaForm | null;
  regional: RegionalForm | null;
  gender: (GenderLook & { species: string }) | null;
}

// 그림 열쇠 하나를 푼다 — 푸는 순서는 메가 → 성별 그림 → 리전폼 → 기본이다
export function lookOf(key: string, opts?: DexOptions): Look {
  const { slug, shiny } = splitLookKey(key);
  const mega = megaOf(slug, opts);
  const gender = mega ? null : genderLookInfo(slug, opts);
  const regional = mega || gender ? null : regionalOf(slug, opts);
  const kind: LookKind = mega ? "mega" : gender ? "gender" : regional ? "regional" : "plain";
  const base = mega?.base ?? gender?.species ?? regional?.base ?? slug;
  const dex = profile(mega?.base ?? gender?.species ?? slug, opts).dex ?? 0;
  return { slug, shiny, kind, base, dex, mega, regional, gender };
}

// 그림 묶음에 적는 네 자리 도감 번호 — "0902"
export const dexFolderOf = (look: Pick<Look, "dex">): string => String(look.dex).padStart(4, "0");
