// 설정창 → 기기 창 연결 뼈대 — 파티 상세·상점·가방·파티 기기 창이 같은 틀을 쓴다
// - sync: 고른 값이 없으면 닫으라고 보내고, 있으면 직전에 보낸 것과 다르거나 스냅샷이 바뀌었을 때만 보낸다.
//   모델이 그대로면 메인이 기기 창을 다시 그리지 않는다 (src/main/manage/window.ts)
// - 모델은 메인이 만든다 (src/view/device-*.ts). 답은 메인이 바로잡은 고른 값이다 — 수량을 상한으로 자르거나 없는 대상을 바꾼 값.
//   바로잡은 값은 apply 로 설정창에 되돌린다. 뒤에 보낸 것이 있으면 늦은 답은 버린다(± 를 빨리 누를 때 앞 답이 뒤 값을 덮지 않게)
// - onClosed: 메인의 닫힘 알림. 세대 번호를 받아 두고 열림·보낸 값을 비운다
// - 세대 번호 — 메인이 닫힘 알림에 실어 준 마지막 번호. 여는 요청에 싣는다. 닫힘을 알기 전에 보낸 요청은 메인이 버린다 (src/main/device-gen.ts)

export interface DeviceLink {
  sync(): void;
  onClosed(gen: number): void;
  isOpen(): boolean;
}

export interface DeviceLinkOptions<I> {
  build: () => I | null; // 고른 값. null 이면 닫는다
  stamp: () => unknown; // 지금 스냅샷 — 고른 값이 같아도 이것이 바뀌면 다시 보낸다(포인트·시간 같은 저장 값이 모델에 들어간다)
  open: (input: I | null, gen?: number) => Promise<I | null>; // api.xOpen(manage/api.ts) — 답은 바로잡은 값. 띄울 것이 없으면 null
  apply?: (input: I) => void; // 바로잡은 값을 설정창의 고른 값에 되돌린다
  afterClosed: () => boolean; // 기기 창이 닫혔다 — 고른 것을 비운다. 다시 그릴 것이면 true
  redraw: () => void; // afterClosed 가 true 면 부른다
}

export function createDeviceLink<I>(opts: DeviceLinkOptions<I>): DeviceLink {
  let gen = 0;
  let open = false;
  let sent = ""; // 마지막으로 보낸 내용(바로잡은 값을 받으면 그 값) — 같으면 다시 보내지 않는다
  let asked = 0; // 보낸 요청 번호 — 늦은 답을 가린다
  let stamped: unknown = undefined; // 마지막으로 보낼 때의 스냅샷

  function sync(): void {
    const input = opts.build();
    if (input === null) {
      // 늘 닫으라고 보낸다 — 기기 창의 ✕ 와 새로 읽기가 겹쳐 메인이 창을 새로 만든 경우도 닫힌다
      if (open || sent) void opts.open(null);
      asked += 1;
      open = false;
      sent = "";
      return;
    }
    const key = JSON.stringify(input);
    const stamp = opts.stamp();
    if (open && key === sent && stamp === stamped) return;
    const ask = ++asked;
    open = true;
    sent = key;
    stamped = stamp;
    void opts.open(input, gen).then((fixed) => {
      if (ask !== asked) return;
      if (fixed === null) {
        // 메인이 띄울 것이 없다고 닫았다
        open = false;
        sent = "";
        return;
      }
      const fixedKey = JSON.stringify(fixed);
      if (fixedKey === key) return;
      sent = fixedKey;
      opts.apply?.(fixed);
    });
  }

  function onClosed(next: number): void {
    gen = next;
    open = false;
    sent = "";
    if (opts.afterClosed()) opts.redraw();
  }

  return { sync, onClosed, isOpen: () => open };
}
