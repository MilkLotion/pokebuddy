// 저장 v2 의 규칙표 — 스키마 기본값. 옛 저장을 읽을 때만 쓴다. 숫자는 v2 시절 그대로다
import { FALLBACK_NATURE } from "../../dex/natures.js";

export const SAVE_V2_RULES = {
  version: 2 as const, // save.json 스키마 버전 (v). 1 은 읽어서 이전한다
  slots: { min: 1, max: 6 }, // 파티 칸 — 처음 1, 최대 6, 원작 파티 여섯 칸 (design.md 상점)
  // 새 마리·빠진 필드의 기본값
  pet: {
    hunger: 30, // 0~100, 높으면 배고프다 [스펙 미확정]
    mood: 60, // 시작 기분 (1판 RULES.mood.start) [스펙 미확정]
    size: 2, // 도트 배율 — config.js dotSize 기본과 같다
    home: { dx: -24, dy: -60 }, // 따라가는 창 오른쪽 아래 기준 — config.js anchorDx·anchorDy 기본과 같다
    nature: FALLBACK_NATURE, // 성격을 모르는 마리(v1 이전·값 파손)에 붙이는 중립 성격 — 축이 전부 0 (src/dex/natures.ts)
  },
  range: { min: 0, max: 100 }, // hunger · mood 의 범위
};
