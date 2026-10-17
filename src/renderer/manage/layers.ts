// 설정창의 열림 스택 — 나중에 연 것부터 닫는다 (docs/specs/ui-components.md C-13 닫기 규칙 9, worklog/records/device-links "Esc 열림 스택")
// - 겹: 기기 창(파티 상세·도감·상점·가방·배틀 파티 상세), 옆 도감, 모달(하위 모달은 dialog.ts 의 부모 스택이 맡아 모달 전체가 한 겹), 탭 팁 말풍선, 들기, 박스 순서 타일 메뉴
// - Esc 는 설정창이든 기기 창이든 escapeTop 하나로 온다(기기 창은 메인을 거쳐 manage:escape) — 맨 위 겹을 한 단계 닫는다
// - 겹을 닫으면 그 겹에서 연 겹(owner)도 같이 닫는다 — 파티 상세를 닫으면 그 단추로 연 진화 창도 닫힌다
// - 화면을 모르는 순수 모듈이다. 닫는 일은 겹을 연 곳이 함수로 넘긴다

interface Layer {
  key: string;
  owner: string | null; // 이 겹을 연 겹. 없으면 null
  step(): void; // Esc — 한 단계 물러나기(모달은 하위 모달이면 부모로)
  close(): void; // 다 닫기 — 아래 겹이 닫혀 같이 닫힐 때
}

const stack: Layer[] = [];
let opening: string | null = null; // fromLayer 안에서 여는 겹의 owner

// 겹을 연다. 이미 있으면 자리를 두고 닫는 함수만 바꾼다 — raise 면 맨 위로 옮긴다(다른 모달로 바뀌었다)
// owner 를 주지 않으면 fromLayer 가 정한 겹, 그것도 없으면 이미 있던 겹의 owner 를 둔다
export function openLayer(key: string, step: () => void, opts: { close?: () => void; owner?: string; raise?: boolean } = {}): void {
  const at = stack.findIndex((l) => l.key === key);
  const was = at >= 0 ? stack[at] : undefined;
  const owner = opts.owner ?? opening ?? was?.owner ?? null;
  const layer: Layer = { key, owner, step, close: opts.close ?? step };
  if (!was) stack.push(layer);
  else if (opts.raise) {
    stack.splice(at, 1);
    stack.push(layer);
  } else stack[at] = layer;
}

// 겹이 닫혔다 — 스택에서 빼고, 그 겹에서 연 겹을 닫는다. 없는 겹이면 아무것도 하지 않는다
export function closeLayer(key: string): void {
  const at = stack.findIndex((l) => l.key === key);
  if (at < 0) return;
  stack.splice(at, 1);
  for (const child of stack.filter((l) => l.owner === key)) {
    if (!stack.includes(child)) continue; // 앞 겹을 닫으며 같이 닫혔다
    closeLayer(child.key);
    child.close();
  }
}

// run 안에서 연 겹은 key 가 연 것이다 — 기기 창 단추로 설정창 모달을 열 때
export function fromLayer(key: string, run: () => void): void {
  const prev = opening;
  opening = key;
  try {
    run();
  } finally {
    opening = prev;
  }
}

// Esc — 맨 위 겹을 한 단계 닫는다. 닫을 겹이 없으면 false
export function escapeTop(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.step();
  return true;
}

export const hasLayer = (key: string): boolean => stack.some((l) => l.key === key);
export const layerKeys = (): string[] => stack.map((l) => l.key); // 시험용 — 아래 겹부터
