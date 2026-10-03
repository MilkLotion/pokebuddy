// 자체 검사의 결과 찍기 — 파일마다 같은 모양으로 적던 한 줄 찍기와 "  ok  <이름>" 세기
// 판정(check·eq 등)은 파일마다 모양이 달라 여기 두지 않는다 — node:assert 를 쓴다 (설계 50번 3.5절)
// (도구 레인 H0)

// 한 줄을 표준 출력에 — 끝에 줄바꿈
export function printLine(line: string): void {
  process.stdout.write(`${line}\n`);
}

export interface OkCounter {
  // fn 을 돌리고(던지면 그대로 던진다) 센 뒤 "  ok  <이름>" 을 찍는다. fn 이 Promise 를 주면 기다린다
  ok(name: string, fn: () => void): void;
  okAsync(name: string, fn: () => void | Promise<void>): Promise<void>;
  // 지금까지 통과한 수
  count(): number;
}

export function okCounter(): OkCounter {
  let n = 0;
  return {
    ok(name, fn) {
      fn();
      n += 1;
      printLine(`  ok  ${name}`);
    },
    async okAsync(name, fn) {
      await fn();
      n += 1;
      printLine(`  ok  ${name}`);
    },
    count: () => n,
  };
}
