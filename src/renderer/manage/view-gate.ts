// 늦게 온 스냅샷 가리기 — 메인은 스냅샷마다 순번(seq)을 매긴다. 이미 받은 것보다 낮은 순번은 버린다 (실행 규칙 R2, worklog/records/perf-refactor 1-4)
// 1초 시계가 스냅샷을 기다리는 동안 명령이 끝나면, 늦게 온 시계 스냅샷이 명령 결과를 덮어 다음 시계까지 옛 화면이 보였다(G47-3)
// DOM 을 쓰지 않는다 — 자체 검사가 그대로 부른다(selftest-view-order)
export interface ViewGate {
  fresh(view: { seq?: number } | null): boolean; // 받아도 되면 true 이고 그 순번을 기억한다. 순번이 없으면(저장 없음 등) 받는다
}

export function createViewGate(): ViewGate {
  let last = 0;
  return {
    fresh(view) {
      const seq = view?.seq;
      if (typeof seq !== "number") return true;
      if (seq <= last) return false;
      last = seq;
      return true;
    },
  };
}
