// 상태의 규칙표 — 시간에 따른 값, 기분, 놀아주기, 소리, 놀이공간. 수치는 docs/specs/balance.md 를 따른다. 가져오는 것이 없는 파일이다

// 시간에 따른 값의 규칙표
export const TIME_RULES = {
  fullnessDropMs: 120_000, // 만복도 1 감소에 걸리는 시간. 시간당 30 이므로 2분에 1
  affinityGainMs: 600_000, // 친밀도 1 획득에 걸리는 가중 시간. 10분에 1
  pointGainMs: 120_000, // 포인트 1 획득에 걸리는 가중 시간. 개체 1마리당 2분에 1
  // 한 번에 흘릴 수 있는 최대 시간. 앱은 15초마다 시간을 적용한다. 그보다 크게 벌어진 틈은 앱 종료·절전·잠금으로 본다.
  // 틈은 소급하지 않는다 (docs/specs/game.md "PC 잠금·절전·앱 종료 중에는 … 소급 진행하지 않는다")
  maxElapsedMs: 30_000,
  // 시계 틱 사이가 이보다 벌어지면 절전·중단으로 보고 작업 시간·줍기로 세지 않는다. 줍기의 굴림도 이 값으로 거른다 (src/find/core.ts). 제안값
  maxGapMs: 5_000,
  // 만복도 구간 — 아래 경계값 이상이면 그 구간이다
  zone: { full: 60, normal: 40, hungry: 15 },
  // 구간별 친밀도 증가 배율(백분율). 배고픔 −30%, 매우 배고픔 −60%
  zonePercent: { full: 100, normal: 100, hungry: 70, starving: 40 },
  // 버프의 추가 배율(백분율). 기준 100 에 더한다. 든든함 +100(×2) · 신남 +50(×1.5) · 들뜸 +20(×1.2). 든든함과 신남이 함께면 250 이 된다.
  // 식별자는 저장 호환으로 그대로 둔다 — premium-food 는 든든함, long-play 는 신남(옛 이름 오래 놀아주기), short-play 는 들뜸 (2026-09-29 사용자 결정)
  buffBonusPercent: { "premium-food": 100, "long-play": 50, "short-play": 20 },
};

// 기분 — 친밀도 100 미만에서는 보이기만 한다. 친밀도 100 인 개체는 기분 단계가 포인트 적립을 올린다 (docs/specs/balance.md "기분"·"돌봄 보너스")
// 밥 주기·놀아주기로 오르는 기분은 src/bag/rules.ts BAG_RULES 에 있다
export const MOOD_RULES = {
  // 기분 단계별 포인트 적립 보너스(백분율). 높은 단계부터 본다. 최고(80 이상) +30, 좋음(60 이상) +15 (2026-10-02 사용자 결정)
  pointBonus: [{ min: 80, percent: 30 }, { min: 60, percent: 15 }] as readonly { min: number; percent: number }[],
  dropMs: 600_000, // 파티 칸 개체의 기분 1 감소에 걸리는 시간. 10분에 1
  // 만복도 구간별 감소 배율(백분율). 배고픔 2배, 매우 배고픔 3배
  zonePercent: { full: 100, normal: 100, hungry: 200, starving: 300 },
};

// 놀아주기 — 밥 주기의 쿨타임은 src/bag/rules.ts BAG_RULES 에 있다
export const CARE_RULES = {
  playCooldownMs: 10 * 60_000, // 놀아주기 쿨타임 10분
  playWindowMs: 20 * 60_000, // 놀아주기 상태가 남아 있는 시간 20분. 이 안에 또 놀아주면 중첩이 오른다
  shortPlayAt: 2, // 이만큼 이어서 놀아주면 버프 들뜸이 붙는다 (2026-09-29 사용자 결정)
  longPlayAt: 3, // 이만큼 이어서 놀아주면 버프 신남이 붙는다. 들뜸은 신남으로 바뀐다 (2026-09-29 사용자 결정 — 이름. 교체 규칙은 제안)
};

// 소리 크기 — 설정 값(0~100)을 소리마다의 최대 음량에 곱한다. 앱 소리는 이 규칙 하나를 따른다 (2026-09-27 사용자 요청 "소리가 너무 커")
//   defaultVolume  새 저장·옛 저장의 기본값
//   cryMax         울음소리 최대 음량(0~1) — 무대·도감 기기 창
//   chimeMax       배너 알림음 최대 음량(0~1) — OS 기본음(shell.beep)은 크기를 못 바꿔서 앱이 직접 낸다
export const SOUND_RULES = { defaultVolume: 30, cryMax: 0.35, chimeMax: 0.35 } as const;

// 놀이공간 영역의 최소 크기 (화면 좌표 DIP). 스펙 미확정이라 구현에서 정했다 (worklog/records/game-runtime/record.md "놀이공간·설정의 설계")
//   area  넓이 — 240 × 160 과 같은 넓이. 폭·높이 비율은 자유다(아래로 길게, 옆으로 길게) — 2026-09-26 사용자 요청
//   side  한 변 — 기본 크기(2) 포켓몬 한 마리가 들어가는 길이. 이보다 얇으면 움직일 자리가 없다
export const REGION_MIN = { area: 240 * 160, side: 80 } as const;

// [임시] 메인이 읽는 옛 이름 — 메인 레인이 CLOCK_RULES(src/main/clock.ts)로 옮기면 지운다 (worklog/records/code-structure/lanes/domain.md)
//   maxTickMs  TIME_RULES.maxGapMs 와 같은 값이다
//   saveMs     1초마다 메모리에 적용한 게임 시간을 파일에 쓰는 주기. 적용은 전역 시계의 1초 틱마다다 (src/main/clock.ts, 2026-09-29 사용자 결정)
export const STATE_RULES = {
  maxTickMs: TIME_RULES.maxGapMs,
  saveMs: 15_000,
};
