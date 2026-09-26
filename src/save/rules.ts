// 저장·통로의 규칙표 — 스키마 기본값과 파일 통로의 시간. "숫자는 모듈마다 규칙표 하나" (design.md 모듈 규칙)
//
// 게임 숫자(친밀도·기분·쿨다운)는 여기 없다 — state 모듈의 규칙표에. 여기는 save.json 의 모양을 채우는 기본값과
// 파일 IO 의 재시도·TTL 만. 숫자는 전부 자리표시자 — 써 보며 고친다.
// 성격 검증은 dex가 소유. 에이전트·보낸 이 목록은 공유 타입의 런타임 검사
import type { AgentName, CommandSource, NatureId } from "../shared/types.js";
import { isNatureId as dexNatureId } from "../dex/natures";

// 그림 크기 단계 — 단계 번호(1부터) 순서의 도트 배율. 저장(Pet.size)은 배율을 적고, 화면·명령은 단계 번호를 쓴다.
// 더 큰 크기가 필요하면 배열 끝에 배율을 더한다(예: 3.5). 단계 수·단추 수는 이 배열 길이를 따른다.
// 2026-09-27 사용자 결정: 옛 1과 2 사이 단계를 두고, 옛 3을 가장 크게 한다. 옛 저장의 더 큰 배율은 가장 큰 단계로 줄인다
export const SIZE_STEPS: readonly number[] = [1, 1.5, 2, 2.5, 3];
// 새 개체의 크기 단계 — 2026-09-27 사용자 결정 "기본크기 2로" (배율 1.5)
export const DEFAULT_SIZE_LEVEL = 2;

// 배율에서 가장 가까운 단계 번호 — 같은 거리면 작은 쪽
export function sizeLevelOf(zoom: number): number {
  let best = 0;
  for (let i = 1; i < SIZE_STEPS.length; i++) if (Math.abs((SIZE_STEPS[i] ?? 0) - zoom) < Math.abs((SIZE_STEPS[best] ?? 0) - zoom)) best = i;
  return best + 1;
}

// 단계 번호의 배율. 없는 단계면 null
export const zoomOfLevel = (level: number): number | null => (Number.isInteger(level) ? (SIZE_STEPS[level - 1] ?? null) : null);

// 저장 값을 단계 배율로 맞춘다
export const snapSize = (zoom: number): number => SIZE_STEPS[sizeLevelOf(zoom) - 1] ?? 2;

export const SAVE_RULES = {
  version: 2 as const, // save.json 스키마 버전 (v). 1 은 읽어서 이전한다
  slots: { min: 1, max: 6 }, // 파티 칸 — 처음 1, 최대 6, 원작 파티 여섯 칸 (design.md 상점)
  log: { keep: 200 }, // 기록 — 최근 건수만 남긴다
  // 새 마리·빠진 필드의 기본값
  pet: {
    hunger: 30, // 0~100, 높으면 배고프다 [스펙 미확정]
    mood: 60, // 시작 기분 (1판 RULES.mood.start) [스펙 미확정]
    size: 2, // 도트 배율 — config.js dotSize 기본과 같다
    home: { dx: -24, dy: -60 }, // 따라가는 창 오른쪽 아래 기준 — config.js anchorDx·anchorDy 기본과 같다
    nature: "hardy" as NatureId, // 성격을 모르는 마리(v1 이전·값 파손)에 붙이는 중립 성격 — 축이 전부 0
  },
  range: { min: 0, max: 100 }, // hunger · mood 의 범위
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

export const AGENT_NAMES: readonly AgentName[] = ["claude", "codex", "gemini"];

export const COMMAND_SOURCES: readonly CommandSource[] = ["menu", "tray", "settings", "cli", "vscode", "pet"];

export const isNatureId = (v: unknown): v is NatureId => typeof v === "string" && dexNatureId(v);
export const isAgentName = (v: unknown): v is AgentName => typeof v === "string" && (AGENT_NAMES as readonly string[]).includes(v);
export const isCommandSource = (v: unknown): v is CommandSource =>
  typeof v === "string" && (COMMAND_SOURCES as readonly string[]).includes(v);

// 저장 v3 의 기본값 — 계약은 docs/specs/modules.md "저장 구조". 게임 숫자는 docs/specs/balance.md 를 따른다
export const SAVE_V3_RULES = {
  version: 3 as const,
  unlockRev: 1, // 해금 정리 판 — src/dex/unlocks.ts pruneUnlocks. 판을 올리면 옛 저장에서 한 번 정리가 돈다
  party: {
    total: 6, // 파티 칸은 항상 여섯이다. 열림·빈 칸·잠김으로 상태를 나눈다
    openAtStart: 2, // 첫 선택을 마치면 두 칸으로 시작한다
    shopUnlock: 2, // 상점에서 살 수 있는 칸 수
  },
  box: { size: 30, firstName: "박스 1" },
  pet: {
    level: 1,
    exp: 0,
    affinity: 0,
    fullness: 100, // 새 개체는 배부른 상태로 시작한다
    mood: 60,
    size: 1.5, // 도트 배율 — 크기 단계 DEFAULT_SIZE_LEVEL(2) 의 배율 SIZE_STEPS[1]
    home: { dx: -24, dy: -60 }, // 따라가는 창 오른쪽 아래 기준 — SAVE_RULES.pet.home 과 같은 값이다
  },
  feedCooldownMs: 10 * 60_000, // 밥 주기 쿨타임 10분. 기본먹이와 프리미엄먹이가 함께 쓴다
  playCooldownMs: 10 * 60_000, // 놀아주기 쿨타임 10분
  playWindowMs: 20 * 60_000, // 놀아주기 상태가 남아 있는 시간 20분. 이 안에 또 놀아주면 중첩이 오른다
  longPlayAt: 3, // 이만큼 이어서 놀아주면 오래 놀아주기 상태가 된다
  eggCareCooldownMs: 60_000, // 알 돌봄 인정 간격 1분
  tx: { keep: 200, ttlMs: 24 * 60 * 60_000 }, // 최근 200건 또는 24시간 중 큰 쪽을 남긴다
  saveEveryMs: 30_000, // 시간에 따른 값의 주기 저장
  saveFailNotifyAfter: 3, // 이만큼 이어서 실패하면 관리 창 상태 안내에 남긴다
};

// 시간에 따른 값의 규칙표 — 수치는 docs/specs/balance.md 를 따른다
export const TIME_V3_RULES = {
  fullnessDropMs: 120_000, // 만복도 1 감소에 걸리는 시간. 시간당 30 이므로 2분에 1
  affinityGainMs: 600_000, // 친밀도 1 획득에 걸리는 가중 시간. 10분에 1
  pointGainMs: 120_000, // 포인트 1 획득에 걸리는 가중 시간. 개체 1마리당 2분에 1
  // 한 번에 흘릴 수 있는 최대 시간. 앱은 15초마다 시간을 적용한다. 그보다 크게 벌어진 틈은 앱 종료·절전·잠금으로 본다.
  // 틈은 소급하지 않는다 (docs/specs/s5.md "PC 잠금·절전·앱 종료 중에는 … 소급 진행하지 않는다")
  maxTickMs: 30_000,
  // 만복도 구간 — 아래 경계값 이상이면 그 구간이다
  zone: { full: 60, normal: 40, hungry: 15 },
  // 구간별 친밀도 증가 배율(백분율). 배고픔 −30%, 매우 배고픔 −60%
  zonePercent: { full: 100, normal: 100, hungry: 70, starving: 40 },
  // 버프의 추가 배율(백분율). 기준 100 에 더한다. 둘 다 있으면 250 이 된다
  buffBonusPercent: { "premium-food": 100, "long-play": 50 },
};

// 기분 — 보이기만 하고 다른 수치를 바꾸지 않는다 (docs/specs/balance.md "기분")
export const MOOD_RULES = {
  dropMs: 600_000, // 파티 칸 개체의 기분 1 감소에 걸리는 시간. 10분에 1
  // 만복도 구간별 감소 배율(백분율). 배고픔 2배, 매우 배고픔 3배
  zonePercent: { full: 100, normal: 100, hungry: 200, starving: 300 },
  feed: 10, // 밥 주기 — 기본먹이·프리미엄먹이
  play: 15, // 놀아주기 — 클릭 놀아주기와 장난감
};

// 알의 규칙표 — 수치는 docs/specs/balance.md "확률과 알"
export const EGG_V3_RULES = {
  readyMs: 5 * 60_000, // 준비 시간 5분
  careShortenMs: 30_000, // 돌봄 한 번에 30초 단축
  careCooldownMs: 60_000, // 돌봄 인정 간격 1분
  maxEggs: 6, // 돌보미집 칸 수
};

// 상점의 규칙표 — 가격은 docs/specs/balance.md 가격표
export const SHOP_V3_RULES = {
  evoItemPrice: 150, // 진화용 도구는 종류와 무관하게 같은 값이다
  slotPrices: [300, 600] as const, // 상점에서 여는 파티 칸 두 개. 첫 칸과 둘째 칸의 값이 다르다
  startPoints: 120, // 첫 선택을 마치면 한 번 지급한다
};

// 가방 도구의 규칙표 — 수치는 docs/specs/balance.md "버프와 친밀도"
export const BAG_V3_RULES = {
  buffMs: { "premium-food": 2 * 60 * 60_000, "long-play": 30 * 60_000 }, // 프리미엄 2시간, 오래 놀아주기 30분
  feedAffinity: 2, // 밥 주기로 오르는 친밀도
  playAffinity: 3, // 놀아주기로 오르는 친밀도
};

// 관리 창의 크기 — docs/specs/s5.md "관리 창". Figma 의 640 px 를 DIP 로 그대로 쓴다
export const WINDOW_V3_RULES = {
  width: 640, // 폭은 고정이다. 박스 6열과 도감 5열 격자가 이 폭에 맞춰져 있다
  // 기본 세로 — 파티 탭이 스크롤 없이 딱 맞는 높이다(2026-09-26 사용자 결정 "화면은 파티창을 기준으로 높이가 정해져야해").
  // 헤더 40 + 탭 40 + 본문 위 여백 16 + 파티 머리와 칸 3줄(마지막 칸이 창 위에서 650) + 본문 아래 여백 32. 파티 칸 모양이 바뀌면 다시 잰다
  height: 682,
  minHeight: 560, // 본문이 스크롤이라 이만큼까지 줄일 수 있다
};
