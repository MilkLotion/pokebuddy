// 저장 암호화 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-save-crypt.js
//
// 암호(src/save/crypt.ts)·저장 파일(src/save/save-file.ts)·키 준비(src/save/key.ts)를 임시 폴더에서 본다.
// 키 저장소는 가짜다 — 사용자의 키체인·DPAPI 에 닿지 않는다. 사용자의 ~/.claude/pokebuddy/ 는 건드리지 않는다.
// 설계는 worklog/records/cloud-authority/record.md "P3 로컬 암호화"
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { currentSaveKey, isSealed, newSaveKey, sealText, setSaveKey, unsealText } from "../../save/crypt";
import { keyFileOf, prepareSaveKey, setAsideKeyAndSave } from "../../save/key";
import type { KeyVault } from "../../platform/key-vault";
import * as store from "../../save/save-file";
import { readCloudFile } from "../../online/lost";
import { empty } from "../../save/v3";
import { makeTmp } from "../harness/tmp-dir";
import { printLine as out } from "../harness/report";


const T0 = new Date(2026, 8, 30, 10, 0, 0).getTime();

// 가짜 키 저장소 — 앞에 표시를 붙여 감싼다. broken 이면 풀기를 거부한다(키체인 초기화)
function fakeVault(o: { available?: boolean; broken?: boolean; reEncrypt?: boolean } = {}): KeyVault & { writes: number } {
  const v = {
    writes: 0,
    available: async () => o.available ?? true,
    encrypt: async (text: string) => {
      v.writes++;
      return Buffer.from(`V:${text}`, "utf8");
    },
    decrypt: async (data: Buffer) => {
      if (o.broken) throw new Error("키체인 거부");
      const s = data.toString("utf8");
      if (!s.startsWith("V:")) throw new Error("모르는 형식");
      return { result: s.slice(2), shouldReEncrypt: o.reEncrypt ?? false };
    },
  };
  return v;
}

const tmpDir = (): string => makeTmp("crypt");
const saveWithPet = () => {
  const s = empty(T0);
  s.points.balance = 777;
  return s;
};
const files = (dir: string, prefix: string): string[] => fs.readdirSync(dir).filter((f) => f.startsWith(prefix));

async function main(): Promise<void> {
  const dirs: string[] = [];
  const dir = (): string => {
    const d = tmpDir();
    dirs.push(d);
    return d;
  };
  try {
    // 1. 암호 — 되돌리기·고침·다른 키
    {
      const key = newSaveKey();
      const box = sealText(key, "안녕 pokebuddy");
      assert.ok(isSealed(box), "머리 PBS1");
      assert.equal(unsealText(key, box), "안녕 pokebuddy", "되돌리기");
      const bad = Buffer.from(box);
      bad.writeUInt8(bad.readUInt8(bad.length - 1) ^ 1, bad.length - 1);
      assert.equal(unsealText(key, bad), null, "한 바이트 고치면 풀지 못함");
      assert.equal(unsealText(newSaveKey(), box), null, "다른 키");
      assert.equal(isSealed(Buffer.from("{}")), false, "평문은 암호화 아님");
      assert.throws(() => setSaveKey(Buffer.alloc(8)), /길이/, "짧은 키 거부");
      out("1 암호 — 되돌리기·고침·다른 키");
    }

    // 2. 저장 통로 — 키가 있을 때
    {
      const d = dir();
      const file = path.join(d, "save.json");
      setSaveKey(newSaveKey());
      assert.ok(store.writeSave(file, saveWithPet()), "쓰기");
      const buf = fs.readFileSync(file);
      assert.ok(isSealed(buf), "파일은 암호화");
      assert.ok(!buf.toString("latin1").includes("balance"), "메모장으로 읽을 수 없다");
      const r = store.readSave(file);
      assert.equal(r.state?.points.balance, 777, "읽기");
      assert.equal(store.readSaveRaw(file)?.v, 3, "readRaw 는 JSON");

      // 암호문 한 바이트 고침 → 파손 격리 + 표시
      const bad = Buffer.from(buf);
      bad.writeUInt8(bad.readUInt8(bad.length - 5) ^ 0xff, bad.length - 5);
      fs.writeFileSync(file, bad);
      const ro = store.readSave(file, { repair: false });
      assert.equal(ro.corrupted, true, "읽기 전용도 파손으로 본다");
      assert.ok(fs.existsSync(file), "읽기 전용은 격리하지 않는다");
      const rw = store.readSave(file);
      assert.equal(rw.corrupted, true, "고친 암호문은 파손");
      assert.ok(!fs.existsSync(file) && rw.movedTo != null && fs.existsSync(rw.movedTo), "격리");
      assert.ok(fs.existsSync(store.lostMarkerOf(file)), "격리 표시");
      assert.ok(Number(fs.readFileSync(store.lostMarkerOf(file), "utf8")) > 0, "표시는 격리 시각(ms)");
      fs.rmSync(store.lostMarkerOf(file));

      // 키가 있는데 평문 → 손으로 고친 저장. 앞선 격리 파일을 덮지 않는다(이름에 시각)
      fs.writeFileSync(file, JSON.stringify(saveWithPet()));
      await new Promise((r) => setTimeout(r, 5));
      const plain = store.readSave(file);
      assert.equal(plain.corrupted, true, "평문은 파손");
      assert.equal(plain.reason, "plain", "까닭 plain");
      assert.equal(plain.state, null, "평문 값을 쓰지 않는다");
      assert.ok(fs.existsSync(store.lostMarkerOf(file)), "평문 격리 표시");
      assert.equal(files(d, "save.json.broken-").length, 2, "격리 파일 둘 — 덮어쓰지 않는다");
      out("2 저장 통로 — 암호화 쓰기·고침 격리·평문 거부");
    }

    // 3. 키가 없는데 암호화 파일 — 읽지도 덮지도 않는다
    {
      const d = dir();
      const file = path.join(d, "save.json");
      setSaveKey(newSaveKey());
      assert.ok(store.writeSave(file, saveWithPet()));
      const before = fs.readFileSync(file);
      setSaveKey(null);
      const r = store.readSave(file);
      assert.equal(r.reason, "locked", "까닭 locked");
      assert.equal(r.corrupted, false, "파손 아님");
      assert.ok(fs.existsSync(file), "격리하지 않는다");
      assert.equal(store.writeSave(file, empty(T0)), false, "평문 새 저장으로 덮지 않는다");
      assert.ok(fs.readFileSync(file).equals(before), "파일 그대로");
      assert.equal(store.readSaveRaw(file), null, "readRaw 도 못 읽는다");
      // 키가 없고 평문이면 지금처럼
      const other = path.join(d, "plain.json");
      assert.ok(store.writeSave(other, saveWithPet()));
      assert.equal(store.readSave(other).state?.points.balance, 777, "평문 쓰기·읽기");
      out("3 키 없음 — 암호화 파일을 읽지도 덮지도 않는다");
    }

    // 4. 키 준비 — 업데이트 첫 실행: 평문 저장을 백업하고 암호화
    {
      const d = dir();
      const file = path.join(d, "save.json");
      setSaveKey(null);
      assert.ok(store.writeSave(file, saveWithPet()), "기존 평문 저장");
      const vault = fakeVault();
      const r = await prepareSaveKey({ saveFile: file, vault, create: true, now: () => T0 });
      assert.deepEqual(r, { status: "ok", migrated: true }, "첫 실행 이전");
      assert.ok(currentSaveKey(), "키를 정했다");
      assert.ok(isSealed(fs.readFileSync(file)), "저장을 암호화했다");
      assert.equal(files(d, "save.json.plain-").length, 1, "평문 백업");
      assert.equal(store.readSave(file).state?.points.balance, 777, "진행이 이어진다");
      const kf = JSON.parse(fs.readFileSync(keyFileOf(file), "utf8")) as { v: number; key: string; migrated?: unknown };
      assert.equal(kf.v, 1);
      assert.equal(kf.migrated, undefined, "이전 여부는 파일에 평문으로 두지 않는다");
      const inner = JSON.parse(Buffer.from(kf.key, "base64").toString("utf8").slice(2)) as { migrated: boolean };
      assert.equal(inner.migrated, true, "감싼 값 안에 이전 완료를 적었다");
      const first = currentSaveKey();

      // 다음 실행 — 같은 키, 이전 없음
      const again = await prepareSaveKey({ saveFile: file, vault, create: true, now: () => T0 + 1 });
      assert.deepEqual(again, { status: "ok", migrated: false }, "두 번째 실행");
      assert.ok(currentSaveKey()?.equals(first as Buffer), "같은 키");
      assert.equal(files(d, "save.json.plain-").length, 1, "백업을 더 만들지 않는다");

      // 키 저장소가 새로 감싸라고 하면 다시 쓴다
      const re = fakeVault({ reEncrypt: true });
      await prepareSaveKey({ saveFile: file, vault: re, create: true, now: () => T0 + 2 });
      assert.equal(re.writes, 1, "다시 감쌌다");
      assert.ok(currentSaveKey()?.equals(first as Buffer), "키는 그대로");
      out("4 키 준비 — 평문 이전·같은 키·다시 감싸기");
    }

    // 5. 키 저장소가 풀기를 거부 — 옮기지 않고 denied(앱이 묻는다). 새로 시작을 고르면 옮기고 새 키. 키 파일 모양이 틀리면 reset
    {
      const d = dir();
      const file = path.join(d, "save.json");
      setSaveKey(null);
      store.writeSave(file, saveWithPet());
      await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: true, now: () => T0 });
      const old = currentSaveKey();
      const r = await prepareSaveKey({ saveFile: file, vault: fakeVault({ broken: true }), create: true, now: () => T0 + 1 });
      assert.deepEqual(r, { status: "denied", migrated: false }, "denied");
      assert.equal(currentSaveKey(), null, "키 없이");
      assert.equal(files(d, "save.json.unreadable-").length, 0, "저장을 옮기지 않았다");
      assert.ok(store.isSealedOnDisk(file), "암호화 저장이 남았다 — 앱이 저장 잠김 창을 띄운다");
      // 거부를 풀면 그대로 이어진다
      const again = await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: true, now: () => T0 + 2 });
      assert.equal(again.status, "ok");
      assert.equal(store.readSave(file).state?.points.balance, 777, "진행 그대로");
      // 저장 잠김 창의 새로 시작
      assert.ok(setAsideKeyAndSave(file, T0 + 3), "옮겼다");
      assert.equal(files(d, "save.key.unreadable-").length, 1, "키를 옮겼다");
      assert.equal(files(d, "save.json.unreadable-").length, 1, "저장을 옮겼다");
      assert.ok(!fs.existsSync(file), "저장 없음 — 새로 시작하거나 서버 저장을 받는다");
      // 이름은 다른 새로 시작과 같이 .bak 으로 끝난다 (94 항목 5-5)
      assert.ok([...files(d, "save.key.unreadable-"), ...files(d, "save.json.unreadable-")].every((n) => n.endsWith(".bak")), "옮긴 이름은 .bak");
      assert.ok(fs.existsSync(store.lostMarkerOf(file)), "격리 표시");
      const fresh = await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: true, now: () => T0 + 4 });
      assert.equal(fresh.status, "ok");
      assert.ok(currentSaveKey() && !currentSaveKey()?.equals(old as Buffer), "새 키");
      // 키 파일 모양이 틀림 — reset
      store.writeSave(file, saveWithPet());
      fs.writeFileSync(keyFileOf(file), "{ 깨짐");
      const reset = await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: true, now: () => T0 + 5 });
      assert.equal(reset.status, "reset", "reset");
      assert.equal(files(d, "save.json.unreadable-").length, 2, "저장을 옮겼다");
      assert.ok(currentSaveKey(), "새 키");
      out("5 키 거부 — denied·새로 시작·모양 틀림 reset");
    }

    // 6. 키를 지우고 평문을 넣음 — 새 키가 평문을 이전한다(한계: 서버 검증 P4 가 막는다). 암호화 저장만 남기고 키를 지우면 격리
    {
      const d = dir();
      const file = path.join(d, "save.json");
      setSaveKey(null);
      store.writeSave(file, saveWithPet());
      await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: true, now: () => T0 });
      fs.rmSync(keyFileOf(file));
      const r = await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: true, now: () => T0 + 1 });
      assert.deepEqual(r, { status: "ok", migrated: false }, "새 키 — 옮길 평문 없음");
      const read = store.readSave(file);
      assert.equal(read.corrupted, true, "옛 키의 저장은 풀지 못해 격리");
      assert.ok(fs.existsSync(store.lostMarkerOf(file)), "격리 표시");
      out("6 키 삭제 — 옛 암호화 저장은 격리");
    }

    // 7. 개발 실행 POKEBUDDY_SAVE_CRYPT=off · 키 저장소 없음
    {
      const d = dir();
      const file = path.join(d, "save.json");
      setSaveKey(null);
      store.writeSave(file, saveWithPet());
      const off = await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: false });
      assert.deepEqual(off, { status: "off", migrated: false }, "off — 키를 만들지 않는다");
      assert.equal(currentSaveKey(), null);
      assert.ok(!fs.existsSync(keyFileOf(file)), "키 파일 없음");
      assert.ok(!isSealed(fs.readFileSync(file)), "평문 그대로");

      // 키가 이미 있으면 off 여도 그 키를 쓴다 — 개발 실행이 사용자 저장을 평문으로 덮지 않게
      await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: true });
      const keep = await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: false });
      assert.equal(keep.status, "ok", "기존 키는 쓴다");
      assert.ok(currentSaveKey(), "키 있음");

      const none = await prepareSaveKey({ saveFile: file, vault: fakeVault({ available: false }), create: true });
      assert.deepEqual(none, { status: "unavailable", migrated: false }, "키 저장소 없음");
      assert.equal(currentSaveKey(), null, "평문으로 돈다");
      assert.equal(store.readSave(file).reason, "locked", "이미 암호화된 저장은 잠김 — 덮지 않는다");
      out("7 off·키 저장소 없음");
    }

    // 8. save.key 를 읽지 못함(잠김·권한) — 옮기지 않고 이번만 키 없이. 저장은 locked 로 지킨다(검수 P3-2)
    {
      const d = dir();
      const file = path.join(d, "save.json");
      setSaveKey(null);
      store.writeSave(file, saveWithPet());
      await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: true, now: () => T0 });
      const keyText = fs.readFileSync(keyFileOf(file));
      fs.rmSync(keyFileOf(file));
      fs.mkdirSync(keyFileOf(file)); // 읽으면 EISDIR — 잠김·권한 대신
      const r = await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: true, now: () => T0 + 1 });
      assert.deepEqual(r, { status: "busy", migrated: false }, "busy");
      assert.equal(currentSaveKey(), null, "키 없이");
      assert.equal(files(d, "save.json.unreadable-").length, 0, "저장을 옮기지 않았다");
      assert.equal(store.readSave(file).reason, "locked", "저장은 잠김");
      fs.rmdirSync(keyFileOf(file));
      fs.writeFileSync(keyFileOf(file), keyText);
      const back = await prepareSaveKey({ saveFile: file, vault: fakeVault(), create: true, now: () => T0 + 2 });
      assert.equal(back.status, "ok", "다음 실행에 다시 푼다");
      assert.equal(store.readSave(file).state?.points.balance, 777, "진행 그대로");
      out("8 키 파일 읽기 오류 — 옮기지 않고 이번만 키 없이");
    }

    // 9. 격리 표시 → cloud.json (src/online/lost.ts)
    {
      const d = dir();
      const file = path.join(d, "save.json");
      const cloudFile = path.join(d, "cloud.json");
      const base = { deviceId: "d", userId: "u", owner: "u", syncedRev: 7, dirty: false, lastSavedAt: T0, superseded: false, pendingOp: "op", ownerKind: "anonymous", handoff: null };
      // 표시 없음 — 그대로
      fs.writeFileSync(cloudFile, JSON.stringify(base));
      assert.deepEqual(readCloudFile(cloudFile, file), base, "표시 없으면 그대로");
      // 격리 뒤 올린 적 없음 — 잊은 상태를 먼저 쓰고 표시를 지운다(검수 P3-1)
      store.markSaveLost(file, T0 + 10);
      const got = readCloudFile(cloudFile, file) as { syncedRev: number; pendingOp: unknown };
      assert.equal(got.syncedRev, -1, "맞춘 rev 를 잊는다");
      assert.equal(got.pendingOp, null, "보낸 올리기 키도 버린다");
      assert.equal((JSON.parse(fs.readFileSync(cloudFile, "utf8")) as { syncedRev: number }).syncedRev, -1, "cloud.json 에 먼저 썼다");
      assert.ok(!fs.existsSync(store.lostMarkerOf(file)), "표시를 지웠다");
      // 격리 뒤에 올렸다 — 표시만 지운다(검수 P3-8)
      fs.writeFileSync(cloudFile, JSON.stringify(base));
      store.markSaveLost(file, T0 - 10);
      assert.equal((readCloudFile(cloudFile, file) as { syncedRev: number }).syncedRev, 7, "격리 뒤 올리기가 있으면 잊지 않는다");
      assert.ok(!fs.existsSync(store.lostMarkerOf(file)), "표시를 지웠다");
      // cloud.json 없음 — 표시만 지운다
      fs.rmSync(cloudFile);
      store.markSaveLost(file, T0);
      assert.equal(readCloudFile(cloudFile, file), null);
      assert.ok(!fs.existsSync(store.lostMarkerOf(file)), "표시를 지웠다");
      out("9 격리 표시 — cloud.json 먼저 쓰고 표시 삭제, 격리 뒤 올리기는 그대로");
    }

    setSaveKey(null);
    out("통과");
  } finally {
    setSaveKey(null);
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
