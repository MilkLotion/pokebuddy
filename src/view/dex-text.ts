// 공식 도감 글 — 분류·설명문·키·몸무게. 도감 상세와 상점 상세가 같이 쓴다
import { type DexOptions, loadJson } from "../dex/data.js";
import { getLang, t } from "./text.js";

// 공식 분류와 설명문 — data/dex-text.json (src/tools/build-dex-text.ts 가 PokeAPI CSV 로 만든다)
export interface DexText {
  genus: { ko?: string; en?: string };
  flavor: { ko?: string; en?: string };
  height?: number; // 데시미터
  weight?: number; // 헥토그램
}
export const dexTexts = (opts?: DexOptions): Record<string, DexText> => loadJson<Record<string, DexText>>("dex-text.json", opts);

// 한 종의 도감 글 — 도감 번호 항목(분류·설명문) 위에 슬러그 항목(리전폼의 키·몸무게)을 얹는다. 리전폼 설명문은 기본형 것이다
export function textOf(slug: string, dex: number, opts?: DexOptions): DexText | undefined {
  const all = dexTexts(opts);
  const base = all[String(dex)];
  const own = all[slug];
  if (!own) return base;
  return {
    genus: { ...base?.genus, ...own.genus },
    flavor: { ...base?.flavor, ...own.flavor },
    height: own.height ?? base?.height,
    weight: own.weight ?? base?.weight,
  };
}

// 키·몸무게 — 공식 도감처럼 소수 한 자리. 미해금 종과 값이 없는 종은 빈 문자열
export function bodySize(t: DexText | undefined): { height: string; weight: string } {
  return {
    height: t?.height ? `${(t.height / 10).toFixed(1)}m` : "",
    weight: t?.weight ? `${(t.weight / 10).toFixed(1)}kg` : "",
  };
}

export function officialText(t: DexText | undefined): { genus: string; flavor: string } {
  if (!t) return { genus: "", flavor: "" };
  const lang = getLang();
  const other = lang === "ko" ? "en" : "ko";
  return { genus: t.genus[lang] ?? t.genus[other] ?? "", flavor: t.flavor[lang] ?? t.flavor[other] ?? "" };
}
