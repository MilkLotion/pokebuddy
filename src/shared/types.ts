// 저장 v2 의 모양(Pet · SaveV2 · World) — 옛 저장을 읽어 v3 으로 옮길 때만 쓴다.
// [리팩토링 대상] 저장을 나눌 때 src/save/v2/ 로 간다. 다른 공유 타입의 자리는 ./species.ts · ./command.ts · ./save-v3.ts · ./hook-record.ts · ./names/ 다
import type { AgentName } from "./names/agents.js";
import type { NatureId } from "./species.js";
import type { AgentStats, LogEntry, PetDaily, Totals } from "./save-v3.js";


// 해금 판정에 필요한 세상 — 저장 + 시각
export interface World {
  now: number; // ms
  save: SaveV2;
}

export interface Pet {
  id: string; // "p1" 처럼 고유. 진화해도 그대로
  species: string; // 게임상의 종 (진화 단계)
  look?: string; // 보이는 그림 — 없으면 species. 해금된 모습(같은 진화 사슬) 중에서
  shiny: boolean;
  nature: NatureId;
  nick: string | null;
  size: number; // 도트 배율 (config dotSize 와 같은 단위)
  shown: boolean; // 무대에 보이나
  home: { dx: number; dy: number }; // 따라가는 창 오른쪽 아래 기준 자리
  hunger: number; // 0~100, 높으면 배고프다
  mood: number; // 0~100
  affinity: number; // 누적, 감소 없음
  stage: number; // 진화 단계 (0 부터)
  since: number;
  fedAt: number | null;
  playedAt: number | null;
  daily: PetDaily;
  evolved: string[]; // 거쳐 온 종
}

export interface SaveV2 {
  v: 2;
  points: number;
  slots: number; // 파티 칸 수 — 처음 1, 최대 6. party 길이는 이를 넘지 않는다
  party: Pet[];
  daily: { date: string; streak: number; interacted: boolean };
  totals: Totals;
  agents: Partial<Record<AgentName, AgentStats>>;
  unlocked: string[]; // 해금된 종 슬러그
  inventory: Record<string, number>;
  acc: Record<string, unknown>; // 10분·1분이 차기 전의 누적기 — 상태 모듈이 소유
  log: LogEntry[]; // 최근 200건
}
