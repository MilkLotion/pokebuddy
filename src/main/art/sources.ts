// 그림·소리를 받을 주소와 캐시 파일 이름 — 초상·도구·알·울음소리·걷기 그림 (worklog/records/code-structure/design/10-main.md 1.1절 art/sources.ts)
// 받기·캐시·풀기는 각 파일이 한다(portraits·cries·overworld-art). 이 파일은 "어디서 받아 어떤 이름으로 두나"만 적는다
// (예전 portraits.ts·cries.ts·overworld-art.ts 에 흩어져 있었다. 메인 레인 96-E 에서 모았다)
import { megaOf } from "../../dex/mega.js";

// PokeAPI sprites — 초상·알·대부분의 도구
const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites";
const POKEMON = `${SPRITES}/pokemon`;

// PokeAPI 에 없는 도구 그림 — msikma/pokesprite (코드 MIT, 그림 © Nintendo·Creatures·GAME FREAK). 32×32 로 PokeAPI 30×30 과 모양이 같다.
// 2026-09-26 폰트 세션이 조사해 넘겼다(사용자 결정).
// 민트는 한 종류라 초록 민트 한 장만 쓴다 (2026-09-29 사용자 결정 "초록색민트 이미지만 사용").
// pokesprite mint 6장의 픽셀을 받아 본 결과 초록(주색 #65c65d)은 speed.png 다. attack 빨강·defense 파랑·special-attack 하늘·special-defense 분홍·neutral 노랑
const POKESPRITE = "https://raw.githubusercontent.com/msikma/pokesprite/master/items";
const MINT_URL = `${POKESPRITE}/mint/speed.png`;
const POKESPRITE_EVO = new Set(["galarica-wreath", "galarica-cuff", "sweet-apple", "tart-apple", "cracked-pot"]);

// PokeAPI cries — 경로: cries/pokemon/latest/<도감>.ogg
const CRIES = "https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest";

// 걷기 그림 — pokeemerald-expansion 의 overworld 그림과 팔레트. ref 는 릴리스 태그다(2026-09-29). 올릴 때 src/tools/check/check-overworld.ts 를 다시 돌린다
export const OVERWORLD_SOURCE = {
  repo: "https://raw.githubusercontent.com/rh-hideout/pokeemerald-expansion",
  ref: "expansion/1.17.1",
};

// 초상 그림 번호 — 도감 번호, 리전폼·메가의 포켓몬 번호, 또는 표의 파일 이름(172-spiky-eared) (src/main/art/portraits.ts portraitIds)
export type PortraitId = number | string;

// 초상 받을 주소 — 번호 그대로(앞의 0 없음)
export const portraitUrl = (dex: PortraitId, shiny: boolean): string => (shiny ? `${POKEMON}/shiny/${dex}.png` : `${POKEMON}/${dex}.png`);
// 초상 캐시 파일 이름 — 네 자리로 채운 번호. 이로치는 -shiny
export const portraitFile = (dex: PortraitId, shiny: boolean): string => {
  const d = String(dex).padStart(4, "0");
  return shiny ? `${d}-shiny.png` : `${d}.png`;
};

// 알 그림 — 받을 주소와 캐시 파일 이름
export const EGG_URL = `${POKEMON}/egg.png`;
export const EGG_FILE = "egg.png";

// 도구 하나의 그림 주소 — 경험사탕·민트·일부 진화 도구·로토무카탈로그는 pokesprite, 나머지는 PokeAPI
export function itemUrl(id: string): string {
  const candy = /^exp-candy-(xs|s|m|l|xl)$/.exec(id);
  if (candy) return `${POKESPRITE}/exp-candy/${candy[1]}.png`;
  if (id === "mint") return MINT_URL;
  if (POKESPRITE_EVO.has(id)) return `${POKESPRITE}/evo-item/${id}.png`;
  // 로토무카탈로그 — 원작 8세대 가방 도트 그대로 (2026-10-05 사용자 결정 "저거로해")
  if (id === "rotom-catalog") return `${POKESPRITE}/key-item/rotom-catalog.png`;
  // 빈 기술머신(기술 진화를 대신하는 도구, id 는 옛 이름 blank-cd)은 원작 기술머신 그림을 쓴다 — 2026-09-26 사용자 결정 "빈기술머신으로 사용할게 그냥"
  if (id === "blank-cd") return `${SPRITES}/items/tm-normal.png`;
  return `${SPRITES}/items/${id}.png`;
}
// 도구 그림 캐시 파일 이름
export const itemFile = (id: string): string => `items/${id}.png`;

// 도구·알 그림의 열쇠 → 받을 주소. 열쇠는 "egg" 또는 "item:<식별자>" 다. 모르는 열쇠는 null
export function iconUrl(key: string): string | null {
  if (key === "egg") return EGG_URL;
  const m = /^item:([a-z0-9-]+)$/.exec(key);
  return m ? itemUrl(m[1] ?? "") : null;
}

// 울음소리 — 받을 주소와 캐시 파일 이름(네 자리 번호)
export const cryUrl = (dex: number): string => `${CRIES}/${dex}.ogg`;
export const cryFile = (dex: number): string => `${String(dex).padStart(4, "0")}.ogg`;

// 종 이름 → expansion 폴더 이름 (mr-rime → mr_rime). 걷기 그림 캐시 파일 이름도 이 이름이다
export const overworldDir = (slug: string): string => slug.replace(/-/g, "_");
// 메가 모습은 종 폴더 아래의 폼 폴더다 (charizard/mega_x) — data/mega.json 의 overworld. 캐시 파일 이름은 슬러그 그대로다
export const overworldUrl = (slug: string, file: string): string =>
  `${OVERWORLD_SOURCE.repo}/${OVERWORLD_SOURCE.ref}/graphics/pokemon/${megaOf(slug)?.overworld ?? overworldDir(slug)}/${file}`;
