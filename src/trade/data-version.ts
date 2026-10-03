// 종 데이터의 지문 — 교환하는 두 앱의 종 목록이 같은지 본다. worklog/records/trade/record.md "버전 값"
import { createHash } from "node:crypto";
import type { DexOptions } from "../dex/data.js";
import { speciesSlugs } from "../dex/species.js";

let cached: string | null = null;

// 종 데이터의 지문 — 종 ID 목록을 정렬해 SHA-256 앞 12자리. 두 앱의 값이 다르면 참가를 거절한다
export function dataVersion(opts?: DexOptions): string {
  if (!opts && cached) return cached;
  const v = createHash("sha256").update(speciesSlugs(opts).join("\n")).digest("hex").slice(0, 12);
  if (!opts) cached = v;
  return v;
}
