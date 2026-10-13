// 최근에 쓴 것부터 남기는 작은 기억 — 상한을 넘으면 가장 오래 안 쓴 것을 버린다. DOM 을 쓰지 않는다 (worklog/records/perf-refactor 1-2)
export interface Lru<V> {
  has(key: string): boolean;
  get(key: string): V | undefined; // 꺼내면 가장 최근 것이 된다
  set(key: string, value: V): void;
  size(): number;
  keys(): string[]; // 오래된 것부터
}

export function createLru<V>(max: number): Lru<V> {
  const map = new Map<string, V>();
  return {
    has: (key) => map.has(key),
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key) as V;
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > max) map.delete(map.keys().next().value as string);
    },
    size: () => map.size,
    keys: () => [...map.keys()],
  };
}
