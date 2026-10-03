// 저장·통로의 규칙표 — 스키마 기본값과 파일 통로의 시간. "숫자는 모듈마다 규칙표 하나" (design.md 모듈 규칙)
//
// 게임 숫자(친밀도·기분·쿨다운·가격)는 여기 없다 — 주인 모듈의 rules.ts 에 있다. 여기는 save.json 의 판·거래 기록과
// 파일 IO 의 재시도·TTL 만. 숫자는 전부 자리표시자 — 써 보며 고친다.
// 성격 검증은 dex가 소유. 에이전트·보낸 이 목록은 src/shared/names/ 에 있다
import type { NatureId } from "../shared/species.js";
import { isNatureId as dexNatureId } from "../dex/natures";
import { MEGA_RULES, UNLOCK_RULES } from "../dex/rules";
import { ACHIEVEMENT_RULES } from "../achievement/rules";
import { BAG_RULES } from "../bag/rules";
import { BOX_RULES } from "../box/rules";
import { EGG_RULES } from "../egg/rules";
import { PARTY_RULES, PET_RULES } from "../party/rules";
import { SIZE_STEPS, sizeLevelOf, snapSize, zoomOfLevel } from "../party/size";
import { SHOP_RULES } from "../shop/rules";
import { CARE_RULES, MOOD_RULES as STATE_MOOD_RULES, TIME_RULES } from "../state/rules";
import { SAVE_V2_RULES } from "./v2/rules";

export const SAVE_RULES = {
  // [임시] v2 스키마 값의 옛 이름 — src/tools/selftest/selftest-legacy.ts 와 scripts/build-verify.cjs 가 읽는다. 원본은 ./v2/rules.ts SAVE_V2_RULES
  version: SAVE_V2_RULES.version,
  slots: SAVE_V2_RULES.slots,
  pet: SAVE_V2_RULES.pet,
  range: SAVE_V2_RULES.range,
  log: { keep: 200 }, // 기록 — 최근 건수만 남긴다. v2·v3 이 같이 쓴다
  // 파일 통로의 시간 (1판 economy RULES.io 에서 옮김)
  io: {
    writeRetries: 3, // Windows 는 읽는 쪽이 열고 있으면 rename 이 막힌다 — 잠깐 뒤 다시
    writeRetryMs: 50,
    mailboxPollMs: 5_000, // fs.watch 보강 폴링
    resultTtlMs: 60_000, // 안 가져간 .result.json 청소
    requestTtlMs: 60_000, // 이보다 오래된 요청은 처리하지 않고 지운다 — 죽은 writer 가 남긴 며칠 전 밥을 주지 않게
    sendTimeoutMs: 2_000, // 보낸 쪽이 결과를 기다리는 시간 (CLI 가 2초 기다려 출력)
    sendPollMs: 100,
  },
};

export const isNatureId = (v: unknown): v is NatureId => typeof v === "string" && dexNatureId(v);

// 저장 v3 의 규칙 — 계약은 docs/specs/modules.md "저장 구조"
export const SAVE_V3_RULES = {
  version: 3 as const,
  tx: { keep: 200, ttlMs: 24 * 60 * 60_000 }, // 최근 200건 또는 24시간 중 큰 쪽을 남긴다
  saveFailNotifyAfter: 3, // 이만큼 이어서 실패하면 관리 창 상태 안내에 남긴다
  // [임시] 아래는 주인 모듈로 옮긴 값의 옛 이름이다 — src/tools 와 scripts/build-verify.cjs 가 새 자리에서 읽으면 지운다
  //   (worklog/records/code-structure/lanes/domain.md "옛 자리에 남긴 다시 내보내기")
  unlockRev: UNLOCK_RULES.rev,
  achievementRev: ACHIEVEMENT_RULES.rev,
  party: {
    total: PARTY_RULES.total,
    openAtStart: PARTY_RULES.openAtStart,
    shopUnlock: PARTY_RULES.shopUnlock,
    presets: { ...PARTY_RULES.presets, nameMax: BOX_RULES.nameMax },
  },
  box: { size: BOX_RULES.size, firstName: BOX_RULES.firstName, start: BOX_RULES.start, max: BOX_RULES.max },
  pet: PET_RULES,
  feedCooldownMs: BAG_RULES.feedCooldownMs,
  playCooldownMs: CARE_RULES.playCooldownMs,
  playWindowMs: CARE_RULES.playWindowMs,
  shortPlayAt: CARE_RULES.shortPlayAt,
  longPlayAt: CARE_RULES.longPlayAt,
};

// [임시] 주인 모듈로 옮긴 규칙표의 옛 이름 — 읽는 곳은 src/main, src/tools, scripts/build-verify.cjs 다.
// 새 코드는 주인 모듈의 rules.ts 를 읽는다. 읽는 곳이 새 자리로 가면 아래를 모두 지운다
export { MEGA_RULES, SIZE_STEPS, sizeLevelOf, snapSize, zoomOfLevel };
// 새 개체의 크기 단계 — 2026-09-27 사용자 결정 "기본크기 2로" (배율 1.5). 값의 원본은 src/party/rules.ts PET_RULES.size
export const DEFAULT_SIZE_LEVEL = sizeLevelOf(PET_RULES.size);
export const TIME_V3_RULES = {
  fullnessDropMs: TIME_RULES.fullnessDropMs,
  affinityGainMs: TIME_RULES.affinityGainMs,
  pointGainMs: TIME_RULES.pointGainMs,
  maxTickMs: TIME_RULES.maxElapsedMs, // 새 이름은 maxElapsedMs 다. 5초 틈 상한(maxGapMs)과 이름이 같았다
  zone: TIME_RULES.zone,
  zonePercent: TIME_RULES.zonePercent,
  buffBonusPercent: TIME_RULES.buffBonusPercent,
};
export const MOOD_RULES = { ...STATE_MOOD_RULES, feed: BAG_RULES.feedMood, play: BAG_RULES.playMood };
export const EGG_V3_RULES = { readyMs: EGG_RULES.readyMs, maxEggs: EGG_RULES.maxEggs };
export const SHOP_V3_RULES = { ...SHOP_RULES, startPoints: PARTY_RULES.startPoints, bagMax: BAG_RULES.max };
export const BAG_V3_RULES = { buffMs: BAG_RULES.buffMs, toyBuffMs: BAG_RULES.toyBuffMs, feedAffinity: BAG_RULES.feedAffinity, playAffinity: BAG_RULES.playAffinity };

// 관리 창의 크기 — docs/specs/game.md "관리 창". Figma 의 640 px 를 DIP 로 그대로 쓴다
export const WINDOW_V3_RULES = {
  width: 640, // 폭은 고정이다. 박스 6열과 도감 5열 격자가 이 폭에 맞춰져 있다
  // 기본 세로 — 파티 탭이 스크롤 없이 딱 맞는 높이다(2026-09-26 사용자 결정 "화면은 파티창을 기준으로 높이가 정해져야해").
  // 헤더 40 + 탭 40 + 본문 위 여백 16 + 파티 머리와 칸 3줄(마지막 칸이 창 위에서 650) + 본문 아래 여백 32. 파티 칸 모양이 바뀌면 다시 잰다
  height: 682,
  minHeight: 560, // 본문이 스크롤이라 이만큼까지 줄일 수 있다
};
