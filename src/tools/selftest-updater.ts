// 앱 업데이트 확인 — 가짜 autoUpdater 로 상태 전이·주기 확인·다시 시작·꺼 둔 경우를 본다
//   npm run build && node dist/tools/selftest-updater.js
// 실제 받기·설치는 업데이트 실기 시험(worklog/records/app-update/record.md "검사 계획")이 본다
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { createAppUpdater, urgentStep, type UpdaterLike } from "../main/updater";
import type { UpdateView } from "../shared/manage";

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  logger: unknown = "default";
  checks = 0;
  installed: [boolean | undefined, boolean | undefined] | null = null;
  fail = false;
  async checkForUpdates(): Promise<unknown> {
    this.checks += 1;
    if (this.fail) throw new Error("net::ERR_INTERNET_DISCONNECTED");
    this.emit("checking-for-update");
    return null;
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installed = [isSilent, isForceRunAfter];
  }
  opened = 0;
  openDownload(): void {
    this.opened += 1;
  }
}

async function main(): Promise<void> {
  // (1) 개발 실행·npm 설치본 — 버전만, 확인하지 않는다
  const views: UpdateView[] = [];
  const off = createAppUpdater({ version: "0.6.0", enabled: false, onView: (v) => views.push(v), beforeInstall: async () => undefined });
  assert.deepEqual(off.view(), { version: "0.6.0", status: "off", next: null, percent: null, error: null });
  assert.equal(await off.install(), false);
  process.stdout.write("(1) 꺼 둔 경우 — 버전만  ok\n");

  // (2) 설치본 — 설정, 첫 확인 예약, 상태 전이
  const fake = new FakeUpdater();
  const timers: { fn: () => void; ms: number }[] = [];
  let flushed = 0;
  const up = createAppUpdater({
    version: "0.6.0", enabled: true, updater: fake, onView: (v) => views.push(v),
    beforeInstall: async () => { flushed += 1; },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => undefined,
  });
  assert.equal(fake.autoDownload, true);
  assert.equal(fake.autoInstallOnAppQuit, true, "끌 때 적용");
  assert.equal(fake.logger, null);
  assert.equal(timers[0]?.ms, 60_000, "켜진 뒤 1분에 첫 확인");
  timers[0]!.fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(fake.checks, 1);
  assert.equal(timers[1]?.ms, 6 * 60 * 60_000, "그 뒤 6시간마다");
  fake.emit("update-not-available");
  assert.equal(up.view().status, "latest");
  process.stdout.write("(2) 설정·주기 확인·최신  ok\n");

  // (3) 새 버전 — 받는 중 → 준비됨. 준비된 뒤의 오류는 준비됨을 덮지 않는다
  fake.emit("update-available", { version: "0.7.0" });
  assert.deepEqual({ s: up.view().status, n: up.view().next, p: up.view().percent }, { s: "downloading", n: "0.7.0", p: 0 });
  fake.emit("download-progress", { percent: 42.7 });
  assert.equal(up.view().percent, 42);
  await up.check();
  assert.equal(fake.checks, 1, "받는 중에는 다시 확인하지 않는다");
  fake.emit("update-downloaded", { version: "0.7.0" });
  assert.equal(up.view().status, "ready");
  fake.emit("error", new Error("late"));
  assert.equal(up.view().status, "ready", "준비됨은 그대로");
  process.stdout.write("(3) 받는 중·준비됨  ok\n");

  // (4) 다시 시작 — 먼저 정리(클라우드 저장)하고 조용히 설치해 다시 켠다. 두 번 눌러도 한 번
  assert.equal(await up.install(), true);
  assert.equal(flushed, 1);
  assert.deepEqual(fake.installed, [false, true], "진행 창을 보이며 설치하고 다시 켠다");
  assert.equal(await up.install(), false, "두 번째는 무시");
  process.stdout.write("(4) 다시 시작 — 정리 뒤 조용히 설치  ok\n");

  // (5) 확인 실패 — 오류로 보이고 다시 확인할 수 있다
  const fake2 = new FakeUpdater();
  fake2.fail = true;
  const up2 = createAppUpdater({ version: "0.6.0", enabled: true, updater: fake2, onView: () => undefined, beforeInstall: async () => undefined, setTimer: () => 0, clearTimer: () => undefined });
  await up2.check();
  assert.equal(up2.view().status, "error");
  assert.match(up2.view().error ?? "", /INTERNET_DISCONNECTED/);
  fake2.fail = false;
  await up2.check();
  assert.equal(up2.view().status, "checking");
  assert.equal(await up2.install(), false, "준비되지 않았으면 다시 시작하지 않는다");
  process.stdout.write("(5) 확인 실패·다시 확인  ok\n");

  // (6) mac 수동 — 앱을 그 자리에서 바꿀 수 없다. 새 버전만 보이고 `받기` 는 받을 곳을 열 뿐 앱을 끄지 않는다
  const fake3 = new FakeUpdater();
  let flushed3 = 0;
  const up3 = createAppUpdater({ version: "0.8.0", enabled: true, updater: fake3, onView: () => undefined, beforeInstall: async () => { flushed3 += 1; }, setTimer: () => 0, clearTimer: () => undefined });
  fake3.emit("update-manual", { version: "0.9.0", reason: "disk-image" });
  assert.deepEqual({ s: up3.view().status, n: up3.view().next }, { s: "manual", n: "0.9.0" });
  assert.equal(await up3.install(), true);
  assert.equal(fake3.opened, 1, "받을 곳을 연다");
  assert.equal(fake3.installed, null, "앱을 끄고 설치하지 않는다");
  assert.equal(flushed3, 0, "끄지 않으니 정리도 하지 않는다");
  process.stdout.write("(6) mac 수동 — 새 버전 알림·받기  ok\n");

  // (7) 업데이트 필요 — 준비·수동이면 창 한 번, 대기·최신·실패면 바로 확인 한 번, 확인·받는 중·꺼짐은 기다린다
  const steps = (asked: boolean, checked: boolean): Record<UpdateView["status"], string> => ({
    off: urgentStep("off", asked, checked),
    idle: urgentStep("idle", asked, checked),
    checking: urgentStep("checking", asked, checked),
    latest: urgentStep("latest", asked, checked),
    downloading: urgentStep("downloading", asked, checked),
    ready: urgentStep("ready", asked, checked),
    manual: urgentStep("manual", asked, checked),
    error: urgentStep("error", asked, checked),
  });
  assert.deepEqual(steps(false, false), { off: "none", idle: "check", checking: "none", latest: "check", downloading: "none", ready: "ask", manual: "ask", error: "check" });
  assert.deepEqual(steps(false, true), { off: "none", idle: "none", checking: "none", latest: "none", downloading: "none", ready: "ask", manual: "ask", error: "none" }, "확인은 실행마다 한 번");
  assert.deepEqual(steps(true, true), { off: "none", idle: "none", checking: "none", latest: "none", downloading: "none", ready: "none", manual: "none", error: "none" }, "창은 실행마다 한 번");
  process.stdout.write("(7) 업데이트 필요 — 바로 확인·창 한 번  ok\n");

  process.stdout.write("selftest-updater: 통과 (꺼 둠·주기 확인·받기·준비됨·다시 시작·실패·mac 수동·업데이트 필요)\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
