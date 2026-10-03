// 설정창 → 기기 창 연결 뼈대 — 파티 상세·상점·가방·파티 기기 창이 같은 틀을 쓴다
// - sync: 보낼 값이 없으면 닫으라고 보내고, 있으면 직전에 보낸 것과 다를 때만 보낸다(1초 새로 읽기마다 기기 창을 다시 그리지 않게)
// - onClosed: 메인의 닫힘 알림. 세대 번호를 받아 두고 열림·보낸 값을 비운다
// - 세대 번호 — 메인이 닫힘 알림에 실어 준 마지막 번호. 여는 요청에 싣는다. 닫힘을 알기 전에 보낸 요청은 메인이 버린다 (src/main/device-gen.ts)

export interface DeviceLink {
  sync(): void;
  onClosed(gen: number): void;
  isOpen(): boolean;
}

export interface DeviceLinkOptions<M> {
  build: () => M | null; // 보낼 값. null 이면 닫는다
  open: (model: M | null, gen?: number) => void; // window.pokebuddyManage.xOpen
  afterClosed: () => boolean; // 기기 창이 닫혔다 — 고른 것을 비운다. 다시 그릴 것이면 true
  redraw: () => void; // afterClosed 가 true 면 부른다
}

export function createDeviceLink<M>(opts: DeviceLinkOptions<M>): DeviceLink {
  let gen = 0;
  let open = false;
  let sent = ""; // 마지막으로 보낸 내용 — 같으면 다시 보내지 않는다

  function sync(): void {
    const model = opts.build();
    if (model === null) {
      // 늘 닫으라고 보낸다 — 기기 창의 ✕ 와 새로 읽기가 겹쳐 메인이 창을 새로 만든 경우도 닫힌다
      if (open || sent) opts.open(null);
      open = false;
      sent = "";
      return;
    }
    const key = JSON.stringify(model);
    if (open && key === sent) return;
    opts.open(model, gen);
    open = true;
    sent = key;
  }

  function onClosed(next: number): void {
    gen = next;
    open = false;
    sent = "";
    if (opts.afterClosed()) opts.redraw();
  }

  return { sync, onClosed, isOpen: () => open };
}
