// 알림 창 검사 — 멈춤·분실·저장 잠김·정지·업데이트 창 함수 7개의 경우 10가지를 실제 함수(src/main/halt-dialog.ts)로 띄워 본다
// 손으로 돌리는 시험이다(npm run selftest 에 없다 — 화면에 창이 뜬다)
//   npm run build && npx electron dist/tools/smoke/smoke-alert.js [캡처 폴더]
// 확인: 문구·단추 순서(왼쪽 보조 → 오른쪽 주)·항상 위·창 크기, 단추 답, Esc 는 취소, 밖에서 닫기·시간 초과는 closed,
//       보인 뒤 렌더러가 죽으면 취소, 문서를 읽지 못하면 null(부른 쪽이 OS 창으로). 캡처 폴더를 주면 창마다 PNG 를 남긴다
// 못 보는 것: OS 창 대비 경로, 실제 무대 창 위 여부, mac 포커스 — 실기로 본다
// 설계는 worklog/records/alert-window/record.md
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ALERT_RULES, askAlert } from "../../main/windows/alert-window";
import { askBlocked, askConfirm, askLost, askSaveLocked, askUpdateRequired, askHeld, askKicked } from "../../main/halt-dialog";
import { preloadFile, rendererFile } from "../../main/windows/files";
import { setLang } from "../../main/text";
import { makeTmp } from "../harness/tmp-dir";
import { sleep } from "../harness/wait";

const dir = makeTmp("alert");
const shots = process.argv.slice(2).find((a) => !a.startsWith("-") && !a.endsWith(".js")) ?? null;
app.setPath("userData", path.join(dir, "user-data"));


// 보이는 알림 창을 기다린다
async function shown(): Promise<BrowserWindow> {
  for (let i = 0; i < 100; i++) {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.isVisible());
    if (w) return w;
    await sleep(50);
  }
  throw new Error("알림 창이 보이지 않는다");
}

interface Seen {
  title: string;
  lead: string;
  detail: string;
  detailHidden: boolean;
  buttons: { label: string; primary: boolean }[];
}

async function read(w: BrowserWindow): Promise<Seen> {
  return (await w.webContents.executeJavaScript(`(() => ({
    title: document.getElementById('title').textContent,
    lead: document.getElementById('lead').textContent,
    detail: document.getElementById('detail').textContent,
    detailHidden: document.getElementById('detail').hidden,
    buttons: [...document.querySelectorAll('#actions button')].map((b) => ({ label: b.textContent, primary: b.classList.contains('primary') })),
  }))()`)) as Seen;
}

async function capture(w: BrowserWindow, name: string): Promise<void> {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  const img = await w.webContents.capturePage();
  fs.writeFileSync(path.join(shots, `${name}.png`), img.toPNG());
}

// 창을 띄우고(open), 보이면 확인하고 단추를 누른다(label) 또는 Esc(null)
async function run<T>(name: string, open: () => Promise<T>, expect: { title: string; buttons: string[]; primary: string }, press: string | null): Promise<T> {
  const answer = open();
  const w = await shown();
  const seen = await read(w);
  assert.equal(seen.title, expect.title, `${name} 제목`);
  assert.ok(seen.lead.length > 0, `${name} 강조 줄`);
  assert.deepEqual(seen.buttons.map((b) => b.label), expect.buttons, `${name} 단추 순서`);
  assert.deepEqual(seen.buttons.filter((b) => b.primary).map((b) => b.label), [expect.primary], `${name} 주 단추`);
  assert.ok(w.isAlwaysOnTop(), `${name} 항상 위`);
  const b = w.getBounds();
  assert.equal(b.width, ALERT_RULES.box + ALERT_RULES.margin * 2, `${name} 창 폭`);
  assert.ok(b.height > 120 && b.height < 400, `${name} 창 높이 ${b.height}`);
  await capture(w, name);
  if (press === null) {
    w.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  } else {
    const ok = (await w.webContents.executeJavaScript(
      `(() => { const b = [...document.querySelectorAll('#actions button')].find((x) => x.textContent === ${JSON.stringify(press)}); if (!b) return false; b.click(); return true; })()`,
    )) as boolean;
    assert.ok(ok, `${name} 단추 ${press}`);
  }
  const r = await answer;
  await sleep(50);
  assert.ok(w.isDestroyed(), `${name} 답한 뒤 창을 부순다`);
  return r;
}

const mac = { other: { label: "Mac", seen: Date.now() - 5 * 60_000 }, code: null };

void app.whenReady().then(async () => {
  try {
    setLang("ko");
    let n = 0;
    const step = (label: string): void => {
      n += 1;
      process.stdout.write(`(${n}) ${label}  ok\n`);
    };

    assert.equal(await run("lost-member", () => askLost("member", false), { title: "저장 정보를 찾지 못했어요", buttons: ["이 PC 저장으로 계속", "로그인"], primary: "로그인" }, "로그인"), "login");
    assert.equal(await run("lost-member-esc", () => askLost("member", false), { title: "저장 정보를 찾지 못했어요", buttons: ["이 PC 저장으로 계속", "로그인"], primary: "로그인" }, null), "login", "Esc 는 로그인(취소 단추)");
    step("분실(로그인) — 로그인·Esc");
    assert.equal(await run("lost-anonymous", () => askLost("anonymous", true), { title: "저장 정보를 찾지 못했어요", buttons: ["처음부터", "이 PC 저장으로 계속"], primary: "이 PC 저장으로 계속" }, "처음부터"), "fresh");
    step("분실(익명) — 처음부터");
    assert.equal(await run("kicked", () => askKicked(mac), { title: "다른 PC 에서 시작했어요", buttons: ["확인"], primary: "확인" }, "확인"), "stop");
    step("밀려남 — 단추 하나");
    assert.equal(await run("confirm", () => askConfirm(mac), { title: "이 PC 에서 시작할까요?", buttons: ["취소", "여기서 시작"], primary: "여기서 시작" }, "여기서 시작"), "go");
    assert.equal(await run("confirm-esc", () => askConfirm(mac), { title: "이 PC 에서 시작할까요?", buttons: ["취소", "여기서 시작"], primary: "여기서 시작" }, null), "stop", "Esc 는 취소");
    step("넘겨받기 확인 — 여기서 시작·Esc");
    assert.equal(await run("blocked-active", () => askBlocked({ ...mac, code: "CLOUD_TRADE_ACTIVE" }), { title: "아직 넘겨받을 수 없어요", buttons: ["종료", "다시 시도"], primary: "다시 시도" }, "종료"), "stop");
    assert.equal(await run("blocked-unsynced", () => askBlocked({ ...mac, code: "CLOUD_TRADE_UNSYNCED" }), { title: "아직 넘겨받을 수 없어요", buttons: ["종료", "다시 시도"], primary: "다시 시도" }, "다시 시도"), "go");
    step("넘겨받기 막힘 두 경우");
    assert.equal(await run("save-locked", () => askSaveLocked(), { title: "저장을 열지 못했어요", buttons: ["새로 시작", "종료"], primary: "종료" }, "새로 시작"), "fresh");
    assert.equal(await run("save-locked-esc", () => askSaveLocked(), { title: "저장을 열지 못했어요", buttons: ["새로 시작", "종료"], primary: "종료" }, null), "quit", "Esc 는 종료");
    step("저장 잠김 — 새로 시작·Esc");
    assert.equal(await run("held", () => askHeld(), { title: "이용이 정지됐어요", buttons: ["종료"], primary: "종료" }, "종료"), "stop");
    step("이용 정지 — 단추 하나");
    assert.equal(await run("update-ready", () => askUpdateRequired("0.15.0", false), { title: "새 버전으로 바꿔야 해요", buttons: ["나중에", "지금 다시 시작"], primary: "지금 다시 시작" }, "지금 다시 시작"), true);
    assert.equal(await run("update-manual", () => askUpdateRequired("0.15.0", true), { title: "새 버전으로 바꿔야 해요", buttons: ["나중에", "받기"], primary: "받기" }, null), false, "Esc 는 나중에");
    step("업데이트 필요 — 지금 다시 시작·수동 Esc");

    // 설명이 비면 줄을 숨긴다(업데이트 수동)
    const manual = askUpdateRequired("0.15.0", true);
    const mw = await shown();
    assert.equal((await read(mw)).detailHidden, true, "빈 설명은 숨긴다");
    mw.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    assert.equal(await manual, false);
    step("빈 설명 숨김");

    // 밖에서 닫기(signal) — closed
    const abort = new AbortController();
    const aborted = askConfirm(mac, abort.signal);
    const aw = await shown();
    abort.abort();
    assert.equal(await aborted, "closed");
    await sleep(50);
    assert.ok(aw.isDestroyed(), "밖에서 닫으면 창을 부순다");
    step("밖에서 닫기 — closed");

    // 시간 초과 — closed (밀려남 30초와 같은 길)
    const view = { title: "t", lead: "l", detail: "", buttons: [{ label: "확인", index: 0, primary: true }] };
    assert.equal(await askAlert({ preload: preloadFile(), html: rendererFile("alert.html"), view, cancelId: 0, timeoutMs: 800 }), "closed");
    step("시간 초과 — closed");

    // 보인 뒤 렌더러가 죽음 — 취소 단추(분실 로그인은 로그인)
    const crashed = askSaveLocked();
    const cw = await shown();
    cw.webContents.forcefullyCrashRenderer();
    assert.equal(await crashed, "quit", "렌더러가 죽으면 취소 단추");
    await sleep(50);
    assert.ok(cw.isDestroyed(), "죽은 창을 부순다");
    step("렌더러 죽음 — 취소");

    // 문서를 읽지 못함 — null(부른 쪽이 OS 창으로)
    assert.equal(await askAlert({ preload: preloadFile(), html: path.join(dir, "없음.html"), view, cancelId: 0 }), null);
    assert.equal(BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length, 0, "실패한 창은 남지 않는다");
    step("문서 없음 — null");

    process.stdout.write(`smoke-alert: 통과 (9종·단추·Esc·밖에서 닫기·시간 초과·렌더러 죽음·실패 대비)${shots ? ` 캡처 ${shots}` : ""}\n`);
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});

app.on("window-all-closed", () => undefined); // 창을 닫아도 끝내지 않는다 — 시험이 끝낸다
