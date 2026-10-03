// pid 잠금 파일의 ready 적기 자체 확인 (src/platform/pid-lock.ts markLockReady·isLockReady)
//   npm run build 뒤 node dist/tools/selftest/selftest-pid-lock.js
// 확인: 없는 파일은 만들지 않는다, 남의 lock·파손 lock 은 고치지 않는다(주인만 고친다), 내 lock 은 맨 앞부터 "<pid>\nready\n"
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { claimLock, isLockReady, markLockReady } from "../../platform/pid-lock";
import { makeTmp } from "../harness/tmp-dir";

const root = makeTmp("pid-lock");
const file = path.join(root, "companion.lock");
const text = (): string => fs.readFileSync(file, "utf8");
try {
  // (1) 없는 파일 — 적지 않고 만들지도 않는다(방금 내린 동반자를 되살리지 않게)
  assert.equal(markLockReady(file, 123), false);
  assert.equal(fs.existsSync(file), false, "파일을 만들지 않는다");

  // (2) 남의 lock·파손 lock — 주인이 아니면 고치지 않는다
  fs.writeFileSync(file, "999999\n");
  assert.equal(markLockReady(file, 123), false, "남의 lock");
  assert.equal(text(), "999999\n", "남의 lock 은 그대로");
  fs.writeFileSync(file, "garbage");
  assert.equal(markLockReady(file, 123), false, "파손 lock");
  assert.equal(text(), "garbage");

  // (3) 내 lock — 맨 앞부터 적는다. 읽기가 옮긴 자리에 적어 앞이 빈 바이트로 차지 않게
  fs.writeFileSync(file, "123\n");
  assert.equal(markLockReady(file, 123), true);
  assert.equal(text(), "123\nready\n");
  assert.equal(isLockReady(file, 123), true);
  assert.equal(isLockReady(file, 456), false, "다른 pid 의 ready 는 보지 않는다");
  assert.equal(markLockReady(file, 123), true, "다시 적어도 같다");
  assert.equal(text(), "123\nready\n");
  fs.writeFileSync(file, "123\nsome-longer-tail\n");
  assert.equal(markLockReady(file, 123), true);
  assert.equal(text(), "123\nready\n", "긴 내용은 잘라 낸다");

  // (4) claimLock 으로 잡은 lock 에 적는다 — 동반자의 흐름
  fs.rmSync(file);
  assert.equal(claimLock(file, process.pid).ok, true);
  assert.equal(markLockReady(file, process.pid), true);
  assert.equal(isLockReady(file, process.pid), true);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
process.stdout.write("selftest-pid-lock: 통과 (없는 파일·남의 lock·파손·내 lock 맨 앞부터·claimLock 뒤)\n");
