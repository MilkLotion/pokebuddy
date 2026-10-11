// 데이터 폴더 자리와 옛 자리 옮기기 자체 확인 (src/platform/paths.ts dataHomeOf·findDataHome·pickDataHome)
//   npm run build 뒤 node dist/tools/selftest/selftest-data-home.js
// 확인: OS 별 새 자리, 새 사용자, 옮김(안의 파일째), 옮기지 않는 프로세스, 떠 있는 옛 앱, 옮기기 실패, 둘 다 있음, 빈 새 자리
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { claudeDataHomeOf, dataHomeOf, findDataHome, oldHomeBusy, pickDataHome } from "../../platform/paths";
import { makeTmp } from "../harness/tmp-dir";

const root = makeTmp("data-home");
let n = 0;
// 경우마다 새 홈 — 앞 경우가 만든 폴더가 섞이지 않게
const freshHome = (): string => {
  const home = path.join(root, `h${++n}`);
  fs.mkdirSync(home, { recursive: true });
  return home;
};
// 옛 자리에 저장·키·Electron 키 파일을 둔다 — 옮긴 뒤 셋이 같이 있어야 저장을 푼다
const seedOld = (home: string): string => {
  const old = claudeDataHomeOf(home);
  fs.mkdirSync(path.join(old, "electron"), { recursive: true });
  fs.writeFileSync(path.join(old, "save.json"), "save");
  fs.writeFileSync(path.join(old, "save.key"), "key");
  fs.writeFileSync(path.join(old, "electron", "Local State"), "state");
  return old;
};

try {
  // (1) OS 별 새 자리 — 홈에서 계산한다
  assert.equal(dataHomeOf("H", "win32"), path.join("H", "AppData", "Roaming", "pokebuddy"));
  assert.equal(dataHomeOf("H", "darwin"), path.join("H", "Library", "Application Support", "pokebuddy"));
  assert.equal(dataHomeOf("H", "linux"), path.join("H", ".config", "pokebuddy"));
  assert.equal(claudeDataHomeOf("H"), path.join("H", ".claude", "pokebuddy"));

  // (2) 새 사용자 — 둘 다 없으면 새 자리. 폴더를 만들지 않는다
  {
    const home = freshHome();
    assert.equal(pickDataHome({ userHome: home, migrate: true }), dataHomeOf(home));
    assert.equal(fs.existsSync(dataHomeOf(home)), false, "새 자리를 만들지 않는다");
  }

  // (3) 옛 자리만 있음 + 앱 메인 — 폴더째 옮긴다. 안의 파일이 그대로 따라간다
  {
    const home = freshHome();
    const old = seedOld(home);
    const next = dataHomeOf(home);
    assert.equal(pickDataHome({ userHome: home, migrate: true, busy: () => false }), next);
    assert.equal(fs.existsSync(old), false, "옛 자리가 남지 않는다");
    assert.equal(fs.readFileSync(path.join(next, "save.json"), "utf8"), "save");
    assert.equal(fs.readFileSync(path.join(next, "save.key"), "utf8"), "key");
    assert.equal(fs.readFileSync(path.join(next, "electron", "Local State"), "utf8"), "state");
    // 다시 불러도 그대로
    assert.equal(pickDataHome({ userHome: home, migrate: true }), next);
  }

  // (4) 옛 자리만 있음 + CLI·도구 — 옮기지 않고 옛 자리를 쓴다
  {
    const home = freshHome();
    const old = seedOld(home);
    assert.equal(pickDataHome({ userHome: home, migrate: false }), old);
    assert.equal(fs.existsSync(old), true);
    assert.equal(findDataHome(home), old, "찾기도 옛 자리");
  }

  // (5) 옛 자리를 쓰는 앱이 떠 있음 — 옮기지 않는다
  {
    const home = freshHome();
    const old = seedOld(home);
    assert.equal(pickDataHome({ userHome: home, migrate: true, busy: () => true }), old);
    assert.equal(fs.existsSync(old), true);
    // 실제 잠금 검사 — 살아 있는 pid 를 적은 companion.lock·save.lock, 죽은 pid 는 떠 있지 않다
    assert.equal(oldHomeBusy(old), false, "잠금 없음");
    fs.writeFileSync(path.join(old, "save.lock"), `${process.pid}\n`);
    assert.equal(oldHomeBusy(old), true, "save.lock 주인이 살아 있다");
    assert.equal(pickDataHome({ userHome: home, migrate: true, busy: oldHomeBusy }), old);
    fs.writeFileSync(path.join(old, "save.lock"), "999999\n");
    fs.writeFileSync(path.join(old, "companion.lock"), `${process.pid}\nready\n`);
    assert.equal(oldHomeBusy(old), true, "companion.lock 주인이 살아 있다");
    fs.rmSync(path.join(old, "companion.lock"));
    assert.equal(oldHomeBusy(old), false, "죽은 pid 의 save.lock 은 떠 있지 않다");
  }

  // (6) 옮기기 실패(EPERM·EXDEV) — 이번 실행은 옛 자리. 데이터는 그대로
  {
    const home = freshHome();
    const old = seedOld(home);
    const fail = (): void => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    };
    assert.equal(pickDataHome({ userHome: home, migrate: true, busy: () => false, move: fail }), old);
    assert.equal(fs.readFileSync(path.join(old, "save.json"), "utf8"), "save");
  }

  // (7) 다른 프로세스가 먼저 옮김 — 실패해도 새 자리
  {
    const home = freshHome();
    const old = seedOld(home);
    const next = dataHomeOf(home);
    const raced = (from: string, to: string): void => {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    assert.equal(pickDataHome({ userHome: home, migrate: true, busy: () => false, move: raced }), next);
    assert.equal(fs.existsSync(old), false);
  }

  // (8) 둘 다 있음(옮긴 뒤 옛 버전을 다시 깔았다) — 새 자리. 옛 자리는 건드리지 않는다
  {
    const home = freshHome();
    const old = seedOld(home);
    const next = dataHomeOf(home);
    fs.mkdirSync(next, { recursive: true });
    fs.writeFileSync(path.join(next, "save.json"), "new");
    assert.equal(pickDataHome({ userHome: home, migrate: true, busy: () => false }), next);
    assert.equal(fs.readFileSync(path.join(old, "save.json"), "utf8"), "save", "옛 자리를 덮지 않는다");
    assert.equal(fs.readFileSync(path.join(next, "save.json"), "utf8"), "new");
    assert.equal(findDataHome(home), next);
  }

  // (9) 빈 새 자리 — 없는 것으로 보고 옛 자리를 옮긴다
  {
    const home = freshHome();
    seedOld(home);
    const next = dataHomeOf(home);
    fs.mkdirSync(next, { recursive: true });
    assert.equal(findDataHome(home), claudeDataHomeOf(home), "찾기는 옛 자리");
    assert.equal(pickDataHome({ userHome: home, migrate: true, busy: () => false }), next);
    assert.equal(fs.readFileSync(path.join(next, "save.key"), "utf8"), "key");
  }

  // (10) 빈 옛 자리 — 옮기지 않고 새 자리
  {
    const home = freshHome();
    fs.mkdirSync(claudeDataHomeOf(home), { recursive: true });
    assert.equal(pickDataHome({ userHome: home, migrate: true, busy: () => false }), dataHomeOf(home));
    assert.equal(fs.existsSync(claudeDataHomeOf(home)), true, "빈 옛 자리는 그대로 둔다");
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
process.stdout.write("selftest-data-home: 통과 (OS 별 자리·새 사용자·옮김·CLI·떠 있는 옛 앱·실패·먼저 옮김·둘 다 있음·빈 새 자리·빈 옛 자리)\n");
