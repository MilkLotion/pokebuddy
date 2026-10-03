// 온라인 세션 파일 저장소 자체 확인 (src/online/session-storage.ts) — 가짜 키 저장소로 Electron 없이 돈다
//   npm run build 뒤 node dist/tools/selftest/selftest-session-storage.js
// 확인: 파일 없음(missing)·암호화 파일 읽기(ok)·풀지 못한 파일 옮기기(unreadable)·암호화 없음 평문(unavailable)·
//       더 나중에 쓴 평문 먼저·암호화 실패 때 평문·키가 바뀌면 다시 쓰기
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import type { KeyVault } from "../../platform/key-vault";
import { createSessionStorage } from "../../online/session-storage";
import { makeTmp } from "../harness/tmp-dir";

// 가짜 키 저장소 — "ENC:" 앞붙이기가 암호화다. 앞붙이기가 없는 파일은 풀지 못한다
function fakeVault(o: { available?: boolean; failEncrypt?: number; reEncrypt?: boolean } = {}): KeyVault & { encrypts: number } {
  let fails = o.failEncrypt ?? 0;
  const v = {
    encrypts: 0,
    available: async () => o.available ?? true,
    encrypt: async (text: string) => {
      if (fails > 0) {
        fails -= 1;
        throw new Error("키 저장소 거부(시험)");
      }
      v.encrypts += 1;
      return Buffer.from(`ENC:${text}`);
    },
    decrypt: async (data: Buffer) => {
      const s = data.toString("utf8");
      if (!s.startsWith("ENC:")) throw new Error("풀지 못함(시험)");
      return { result: s.slice(4), shouldReEncrypt: o.reEncrypt ?? false };
    },
  };
  return v;
}

const plainOf = (file: string): string => path.join(path.dirname(file), "session.json");
const sealed = (obj: Record<string, string>): string => `ENC:${JSON.stringify(obj)}`;
const readJson = (f: string): unknown => JSON.parse(fs.readFileSync(f, "utf8"));

async function main(): Promise<void> {
  const root = makeTmp("session-storage");
  let n = 0;
  // 경우마다 새 폴더
  const fresh = (): string => {
    const dir = path.join(root, `case-${++n}`);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "session.bin");
  };
  // 쓰기 차례를 기다린다 — setItem 은 앞선 쓰기 뒤에 끝난다
  const settle = async (s: { setItem(k: string, v: string): Promise<void> | void; removeItem(k: string): Promise<void> | void }): Promise<void> => {
    await s.setItem("__settle", "1");
    await s.removeItem("__settle");
  };
  try {
    // (1) 파일 없음 → missing. 쓰면 암호화 파일만 생긴다
    {
      const file = fresh();
      const s = createSessionStorage({ file, vault: fakeVault() });
      assert.equal(await s.status(), "missing");
      assert.equal(await s.getItem("a"), null);
      await s.setItem("a", "1");
      assert.equal(fs.readFileSync(file, "utf8"), sealed({ a: "1" }), "암호화 파일 내용");
      assert.equal(fs.existsSync(plainOf(file)), false, "평문 파일 없음");
      // (2) 같은 파일을 새로 열면 ok
      const again = createSessionStorage({ file, vault: fakeVault() });
      assert.equal(await again.status(), "ok");
      assert.equal(await again.getItem("a"), "1");
      await again.removeItem("a");
      assert.equal(fs.readFileSync(file, "utf8"), sealed({}), "지운 뒤 내용");
      process.stdout.write("(1) missing → 쓰기, (2) ok 읽기·지우기  ok\n");
    }

    // (3) 풀지 못한 파일 → unreadable. 첫 쓰기 전에 .bak 으로 옮긴다
    {
      const file = fresh();
      fs.writeFileSync(file, "broken");
      const s = createSessionStorage({ file, vault: fakeVault() });
      assert.equal(await s.status(), "unreadable");
      assert.equal(await s.getItem("a"), null);
      await s.setItem("a", "2");
      const baks = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith("session.bin.unreadable-") && f.endsWith(".bak"));
      assert.equal(baks.length, 1, "옮긴 파일 하나");
      assert.equal(fs.readFileSync(path.join(path.dirname(file), baks[0] as string), "utf8"), "broken", "옮긴 파일은 옛 내용");
      assert.equal(fs.readFileSync(file, "utf8"), sealed({ a: "2" }), "새 암호화 파일");
      process.stdout.write("(3) unreadable → 옮기고 새로 쓰기  ok\n");
    }

    // (4) 암호화를 쓸 수 없다 → unavailable, 평문 session.json
    {
      const file = fresh();
      const s = createSessionStorage({ file, vault: fakeVault({ available: false }) });
      assert.equal(await s.status(), "unavailable");
      await s.setItem("a", "3");
      assert.deepEqual(readJson(plainOf(file)), { a: "3" }, "평문 파일 내용");
      assert.equal(fs.existsSync(file), false, "암호화 파일 없음");
      // 평문만 있고 암호화를 다시 쓸 수 있게 됐다 → 읽어 암호화 파일로 옮기고 평문을 지운다
      const back = createSessionStorage({ file, vault: fakeVault() });
      assert.equal(await back.status(), "ok");
      assert.equal(await back.getItem("a"), "3");
      await settle(back);
      assert.equal(fs.readFileSync(file, "utf8"), sealed({ a: "3" }), "옮긴 암호화 파일");
      assert.equal(fs.existsSync(plainOf(file)), false, "평문 사본을 남기지 않는다");
      process.stdout.write("(4) unavailable 평문 → 다시 암호화  ok\n");
    }

    // (5) 두 파일이 다 있고 평문이 더 나중 → 평문을 읽는다(W5)
    {
      const file = fresh();
      fs.writeFileSync(file, sealed({ a: "old" }));
      fs.writeFileSync(plainOf(file), JSON.stringify({ a: "new" }));
      const past = new Date(Date.now() - 60_000);
      fs.utimesSync(file, past, past);
      const s = createSessionStorage({ file, vault: fakeVault() });
      assert.equal(await s.status(), "ok");
      assert.equal(await s.getItem("a"), "new", "더 나중에 쓴 평문");
      await settle(s);
      assert.equal(fs.readFileSync(file, "utf8"), sealed({ a: "new" }), "평문을 암호화 파일로 옮긴다");
      assert.equal(fs.existsSync(plainOf(file)), false);
      // 암호화 파일이 더 나중이면 암호화 파일을 읽는다
      const file2 = fresh();
      fs.writeFileSync(plainOf(file2), JSON.stringify({ a: "plain" }));
      fs.utimesSync(plainOf(file2), past, past);
      fs.writeFileSync(file2, sealed({ a: "bin" }));
      const s2 = createSessionStorage({ file: file2, vault: fakeVault() });
      assert.equal(await s2.getItem("a"), "bin", "더 나중에 쓴 암호화 파일");
      process.stdout.write("(5) 더 나중에 쓴 쪽 먼저  ok\n");
    }

    // (6) 암호화가 이번만 실패 → 평문으로 두고 암호화 파일은 그대로
    {
      const file = fresh();
      fs.writeFileSync(file, sealed({ a: "kept" }));
      const s = createSessionStorage({ file, vault: fakeVault({ failEncrypt: 1 }) });
      assert.equal(await s.getItem("a"), "kept");
      await s.setItem("a", "4");
      assert.deepEqual(readJson(plainOf(file)), { a: "4" }, "평문으로 둔다");
      assert.equal(fs.readFileSync(file, "utf8"), sealed({ a: "kept" }), "암호화 파일은 건드리지 않는다");
      process.stdout.write("(6) 암호화 실패 → 평문  ok\n");
    }

    // (7) 키가 바뀌었다(shouldReEncrypt) → 읽은 뒤 다시 쓴다
    {
      // 쓰기 횟수를 견준다 — settle 의 쓰기 둘에 다시 쓰기 하나가 더해진다
      const writesOf = async (reEncrypt: boolean): Promise<number> => {
        const file = fresh();
        fs.writeFileSync(file, sealed({ a: "5" }));
        const vault = fakeVault({ reEncrypt });
        const s = createSessionStorage({ file, vault });
        assert.equal(await s.getItem("a"), "5");
        await settle(s);
        return vault.encrypts;
      };
      assert.equal(await writesOf(false), 2, "키가 그대로면 읽기만으로 쓰지 않는다");
      assert.equal(await writesOf(true), 3, "키가 바뀌면 읽은 뒤 다시 쓴다");
      process.stdout.write("(7) 키가 바뀌면 다시 쓰기  ok\n");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write("selftest-session-storage: 통과 (missing·ok·unreadable·unavailable·더 나중에 쓴 쪽·암호화 실패·다시 쓰기)\n");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
