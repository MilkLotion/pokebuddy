// 켤 때 훅 정리와 Codex 창 깜빡임 한 번 알림 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-hook-upkeep.js
// 임시 HOME 을 쓴다 — 진짜 ~/.claude·~/.codex·~/.gemini 설정 파일을 건드리지 않는다 (2026-09-28 사용자 결정 "기존 훅 사용자 자동 정리")
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BannerView } from "../../shared/model/overlays";
import { makeTmp } from "../harness/tmp-dir";

const home = makeTmp("selftest-hook-upkeep");
process.env.HOME = home; // config.js · setup.js 가 require 될 때 os.homedir() 로 읽는다 (mac · linux)
process.env.USERPROFILE = home;
// 사용자 환경 변수가 설정 폴더를 진짜 자리로 돌리지 않게 임시 HOME 안으로 묶는다
process.env.CODEX_HOME = path.join(home, ".codex");
delete process.env.CLAUDE_CONFIG_DIR;

// HOME 을 바꾼 뒤에 읽어야 해서 import 문이 아니라 require 꼴 — ES import 는 파일 맨 위로 끌어올려진다
import registry = require("../../agents/registry");
import notice = require("../../agents/notice");
import upkeep = require("../../main/hook-upkeep");
import { okCounter, printLine as say } from "../harness/report";

const checks = okCounter();
const ok = checks.ok;


type HookEntry = { type?: string; command?: string };
type HookFile = { hooks?: Record<string, Array<{ matcher?: string; hooks?: HookEntry[] }>> };
const hookFile = path.join(home, ".claude", "scripts", "hooks", "pokebuddy-state.cjs");
const codexFile = path.join(home, ".codex", "hooks.json");
const geminiDir = path.join(home, ".gemini");
const noticesFile = path.join(home, ".claude", "pokebuddy", "notices.json");
const ours = `node "${hookFile}" --cli codex`;
const other = { type: "command", command: "echo 남의 훅" };
const readJson = (file: string): HookFile => JSON.parse(fs.readFileSync(file, "utf8")) as HookFile;
const commands = (data: HookFile, event: string): string[] => (data.hooks?.[event] ?? []).flatMap((g) => (g.hooks ?? []).map((h) => String(h.command)));
const backups = (file: string): string[] => fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(`${path.basename(file)}.pokebuddy-backup-`));
const source = path.join(__dirname, "..", "..", "hooks", "pokebuddy-state.js"); // dist/hooks — 앱이 비교하는 원본

try {
  assert.ok(fs.existsSync(source), "훅 원본(dist/hooks/pokebuddy-state.js)이 있어야 한다 — npm run build 뒤에 돈다");

  ok("정리: 연결된 CLI 가 없으면 아무 파일도 쓰지 않는다 · 훅 파일이 없으면 만들지 않는다", () => {
    fs.mkdirSync(geminiDir, { recursive: true });
    fs.writeFileSync(path.join(geminiDir, "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [other] }] } }));
    const r = registry.tidy();
    assert.deepStrictEqual(r.clis, []);
    assert.strictEqual(r.hookFile, "없음");
    assert.ok(!fs.existsSync(hookFile), "훅 파일을 만들지 않는다");
    assert.deepStrictEqual(backups(path.join(geminiDir, "settings.json")), [], "연결 안 된 CLI 설정은 쓰지 않는다");
    assert.ok(!fs.existsSync(codexFile), "codex 설정을 만들지 않는다");
  });

  ok("정리: 옛 codex PreToolUse 만 걷는다 · 남의 훅·다른 이벤트 유지 · 백업 · 새 이벤트는 더하지 않는다", () => {
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    // 0.8.0 이하 setup 이 건 모양 — PreToolUse 포함. PermissionRequest 는 일부러 뺀다(정리는 채우지 않는다)
    const group = (): { hooks: HookEntry[] } => ({ hooks: [{ type: "command", command: ours }] });
    fs.writeFileSync(
      codexFile,
      JSON.stringify({ hooks: { SessionStart: [group()], PreToolUse: [{ hooks: [{ type: "command", command: ours }, other] }], PostToolUse: [group()], Stop: [group()] } }),
    );
    const r = registry.tidy();
    assert.deepStrictEqual(r.clis.map((c) => [c.cli, c.removed]), [["codex", ["PreToolUse"]]]);
    const after = readJson(codexFile);
    assert.deepStrictEqual(commands(after, "PreToolUse"), [other.command], "남의 PreToolUse 훅은 남긴다");
    for (const e of ["SessionStart", "PostToolUse", "Stop"]) assert.deepStrictEqual(commands(after, e), [ours], e);
    assert.ok(!after.hooks?.PermissionRequest, "빠진 이벤트를 더하지 않는다 — 등록은 연결 탭 버튼으로만");
    assert.strictEqual(backups(codexFile).length, 1, "고치기 전 백업");
    // 한 번 더 — 걷을 게 없으면 쓰지 않는다
    const before = fs.readFileSync(codexFile, "utf8");
    assert.deepStrictEqual(registry.tidy().clis, []);
    assert.strictEqual(fs.readFileSync(codexFile, "utf8"), before);
    assert.strictEqual(backups(codexFile).length, 1, "쓰지 않았으니 백업도 없다");
  });

  ok("정리: 있는 훅 파일만 새 버전으로 바꾼다", () => {
    fs.mkdirSync(path.dirname(hookFile), { recursive: true });
    fs.writeFileSync(hookFile, "// 옛 훅\n");
    assert.strictEqual(registry.tidy().hookFile, "바꿈");
    assert.ok(fs.readFileSync(hookFile).equals(fs.readFileSync(source)), "원본과 같아진다");
    assert.strictEqual(registry.tidy().hookFile, "최신");
    // 정리 뒤 codex 는 연결됨이고, 남은 갱신 필요는 빠진 이벤트(PermissionRequest) 때문뿐이다
    const row = registry.status().find((a) => a.name === "codex");
    assert.strictEqual(row?.connected, true);
    assert.strictEqual(row?.outdated, true);
  });

  ok("알림 판정: win32 + codex 연결 → 한 번 · 띄웠으면 다시 없음 · darwin·미연결은 없음", () => {
    const base = { codexConnected: true, shown: [] as string[] };
    assert.strictEqual(notice.codexNoticeDue({ ...base, platform: "win32" }), true);
    assert.strictEqual(notice.codexNoticeDue({ ...base, platform: "darwin" }), false);
    assert.strictEqual(notice.codexNoticeDue({ ...base, platform: "linux" }), false);
    assert.strictEqual(notice.codexNoticeDue({ ...base, platform: "win32", codexConnected: false }), false);
    assert.strictEqual(notice.codexNoticeDue({ ...base, platform: "win32", shown: [notice.CODEX_FLASH_NOTICE] }), false);
    assert.deepStrictEqual(notice.readNotices(path.join(home, "none.json")), [], "파일이 없으면 빈 목록");
    fs.writeFileSync(path.join(home, "bad.json"), "{");
    assert.deepStrictEqual(notice.readNotices(path.join(home, "bad.json")), [], "깨진 파일이면 빈 목록");
  });

  ok("upkeep(win32): 켤 때 정리 → 다른 배너가 보이는 동안 기다림 → 한 번 띄우고 notices.json 에 남김 → 다시 켜도 없음", () => {
    fs.mkdirSync(path.dirname(noticesFile), { recursive: true });
    const shown: BannerView[] = [];
    let busy = true;
    const logs: Record<string, unknown>[] = [];
    const make = (): ReturnType<typeof upkeep.createHookUpkeep> =>
      upkeep.createHookUpkeep({
        noticesFile,
        platform: "win32",
        log: (o) => logs.push(o),
        show: (b) => {
          if (busy) return false;
          shown.push(b);
          return true;
        },
      });
    const u = make();
    u.start();
    assert.strictEqual(u.due(), true, "codex 가 연결돼 있다");
    u.tick();
    assert.strictEqual(shown.length, 0, "다른 배너가 보이는 동안은 띄우지 않는다");
    busy = false;
    u.tick();
    u.tick();
    assert.strictEqual(shown.length, 1, "한 번만");
    const b = shown[0];
    assert.ok(b);
    assert.strictEqual(b.kind, "notice");
    assert.deepStrictEqual(b.route, { to: "agents" });
    assert.match(b.target, /--no-daemon/);
    assert.deepStrictEqual(notice.readNotices(noticesFile), [notice.CODEX_FLASH_NOTICE]);
    const again = make();
    again.start();
    assert.strictEqual(again.due(), false, "다시 켜도 띄우지 않는다");
    assert.ok(!logs.some((l) => String(l.hooks).endsWith("failed")), "실패 기록 없음");
  });

  ok("upkeep(darwin): 정리는 하지만 알림은 없다 · 정리 실패는 기록만", () => {
    const logs: Record<string, unknown>[] = [];
    const u = upkeep.createHookUpkeep({
      noticesFile: path.join(home, "notices-mac.json"),
      platform: "darwin",
      log: (o) => logs.push(o),
      show: () => true,
      tidy: () => {
        throw new Error("읽기 실패");
      },
    });
    assert.doesNotThrow(() => u.start(), "앱 시작을 막지 않는다");
    assert.strictEqual(u.due(), false);
    assert.ok(logs.some((l) => l.hooks === "tidy-failed"));
  });

  say(`통과 (${checks.count()}건)`);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
