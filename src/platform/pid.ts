// 프로세스가 살아 있나 — 신호 0 은 보내지 않고 존재만 확인한다. 저장 잠금·동반자 잠금·훅 기록 판정이 같이 쓴다
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // 남의 소유 프로세스 — 살아 있다
  }
}
