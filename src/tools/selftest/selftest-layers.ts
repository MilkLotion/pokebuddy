// 설정창의 열림 스택 — 나중에 연 것부터 닫는다 (docs/specs/ui-components.md C-13 닫기 규칙 9, worklog/records/device-links "Esc 열림 스택")
//
//   node dist/tools/selftest/selftest-layers.js
//
// 렌더러의 layers.ts 와 createDeviceLink(src/renderer/manage/device-link.ts)를 그대로 부른다. 메인 쪽 열기는 가짜로 세기만 한다.
// 보는 것: Esc 는 맨 위 겹 하나만 한 단계 닫는다 · 이미 있는 겹은 자리를 지킨다(raise 만 옮긴다) · 겹을 닫으면 그 겹에서 연 겹도 닫는다 ·
// 기기 창 연결은 열 때 겹을 넣고 Esc 가 오면 ✕ 와 같이 닫으라고 보낸다 · 기기 창에서 연 모달이 위에 있으면 Esc 는 모달부터
import assert from "node:assert";
import { webModule } from "../harness/web-module";
import { okCounter, printLine } from "../harness/report";

interface Layers {
  openLayer(key: string, step: () => void, opts?: { close?: () => void; owner?: string; raise?: boolean }): void;
  closeLayer(key: string): void;
  fromLayer(key: string, run: () => void): void;
  escapeTop(): boolean;
  hasLayer(key: string): boolean;
  layerKeys(): string[];
}
interface DeviceLink {
  sync(force?: boolean): void;
  onClosed(gen: number): void;
  isOpen(): boolean;
}
interface LinkOptions<I> {
  build: () => I | null;
  stamp: () => unknown;
  open: (input: I | null, gen?: number) => Promise<I | null>;
  afterClosed: () => boolean;
  redraw: () => void;
  layer: string;
}
const L = webModule<Layers>("renderer/manage/layers.js");
const { createDeviceLink } = webModule<{ createDeviceLink: <I>(o: LinkOptions<I>) => DeviceLink }>("renderer/manage/device-link.js");

// 시험마다 스택을 비운다 — 남은 겹을 아래부터 닫는다
function reset(): void {
  for (const key of L.layerKeys()) L.closeLayer(key);
}

function main(): void {
  const t = okCounter();
  const log: string[] = [];
  const layer = (key: string, opts: { owner?: string; raise?: boolean } = {}): void =>
    L.openLayer(key, () => log.push(`step ${key}`), { ...opts, close: () => log.push(`close ${key}`) });

  t.ok("Esc 는 맨 위 겹 하나만 한 단계 닫는다", () => {
    reset();
    log.length = 0;
    layer("device:pet");
    layer("tip");
    assert.equal(L.escapeTop(), true);
    assert.deepEqual(log, ["step tip"], "나중에 연 탭 팁부터");
    reset();
    assert.equal(L.escapeTop(), false, "겹이 없으면 아무것도 하지 않는다");
  });

  t.ok("이미 있는 겹은 자리를 지키고, raise 만 맨 위로 옮긴다", () => {
    reset();
    layer("device:dex");
    layer("tip");
    layer("device:dex"); // 다른 종으로 다시 보냈다 — 같은 기기 창
    assert.deepEqual(L.layerKeys(), ["device:dex", "tip"]);
    layer("device:dex", { raise: true });
    assert.deepEqual(L.layerKeys(), ["tip", "device:dex"]);
  });

  t.ok("겹을 닫으면 그 겹에서 연 겹을 다 닫는다 — 관계없는 겹은 남는다", () => {
    reset();
    log.length = 0;
    layer("device:pet");
    L.fromLayer("device:pet", () => layer("dialog"));
    layer("beside:dex", { owner: "device:pet" });
    layer("tip");
    L.closeLayer("device:pet");
    assert.deepEqual(log, ["close dialog", "close beside:dex"], "딸린 겹은 한 단계가 아니라 다 닫는다");
    assert.deepEqual(L.layerKeys(), ["tip"]);
  });

  t.ok("하위 모달처럼 같은 겹을 다시 열어도 연 겹(owner)은 그대로다", () => {
    reset();
    log.length = 0;
    layer("device:pet");
    L.fromLayer("device:pet", () => layer("dialog"));
    layer("dialog", { raise: true }); // 진화 → 진화 확인(다른 모달 종류) — fromLayer 밖에서 다시 열었다
    L.closeLayer("device:pet");
    assert.deepEqual(log, ["close dialog"]);
  });

  t.ok("기기 창 연결: 열면 겹을 넣고, Esc 가 오면 닫으라고 보낸다", () => {
    reset();
    const sent: (string | null)[] = [];
    let picked: string | null = "p1";
    const link = createDeviceLink<string>({
      build: () => picked,
      stamp: () => 0,
      open: (input) => {
        sent.push(input);
        return new Promise(() => {}); // 답은 오지 않는다 — 겹만 본다
      },
      afterClosed: () => {
        picked = null;
        return false;
      },
      redraw: () => {},
      layer: "device:pet",
    });
    link.sync();
    assert.deepEqual(L.layerKeys(), ["device:pet"]);
    link.sync(); // 같은 값 — 겹이 둘이 되지 않는다
    assert.deepEqual(L.layerKeys(), ["device:pet"]);
    L.escapeTop();
    assert.deepEqual(sent, ["p1", null], "✕ 와 같이 닫으라고 보낸다");
    assert.deepEqual(L.layerKeys(), [], "닫힘 알림을 기다리지 않고 겹을 뺀다 — 두 번 눌러도 같은 창을 두 번 닫지 않는다");
    link.onClosed(1);
    assert.equal(picked, null);
  });

  t.ok("기기 창에서 연 모달이 위에 있으면 Esc 는 모달부터, 기기 창은 남는다", () => {
    reset();
    log.length = 0;
    const sent: (string | null)[] = [];
    const link = createDeviceLink<string>({
      build: () => "p1",
      stamp: () => 0,
      open: (input) => {
        sent.push(input);
        return new Promise(() => {});
      },
      afterClosed: () => false,
      redraw: () => {},
      layer: "device:battle",
    });
    link.sync();
    L.fromLayer("device:battle", () => layer("dialog", { raise: true }));
    L.escapeTop();
    assert.deepEqual(log, ["step dialog"]);
    assert.deepEqual(sent, ["p1"], "기기 창에는 닫으라고 보내지 않는다");
    assert.deepEqual(L.layerKeys(), ["device:battle", "dialog"], "모달 겹은 모달이 닫힐 때(closeDialog) 빠진다");
  });

  reset();
  printLine(`selftest-layers: 통과 (${t.count()}건)`);
}

main();
