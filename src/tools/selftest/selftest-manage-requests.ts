// 설정창 요청 모양 검사 자체 확인 (src/main/manage/requests.ts) — Electron 없이 돈다
//   npm run build 뒤 node dist/tools/selftest/selftest-manage-requests.js
// 확인: 명령·internal 명령, CLI 연결 요청, 초상·아이콘 상한, 복사 글자 상한, 계정·우편·업데이트·패치노트 행동
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import {
  isInternalCommand, parseAccountAction, parseAgentRequest, parseCommand, parseCopyText, parseIconKeys,
  parseMailAction, parseNotesAction, parsePortraitAsks, parseUpdateAction,
} from "../../main/manage/requests";
import { INPUT_LIMITS } from "../../main/windows/input";

// (1) 거래 명령 — cmd 가 글자면 그대로. 아니면 null
assert.deepEqual(parseCommand({ cmd: "shop.buy", target: "toy", args: { reqId: "r" } }), { cmd: "shop.buy", target: "toy", args: { reqId: "r" } });
for (const bad of [null, undefined, "shop.buy", 3, {}, { cmd: 1 }]) assert.equal(parseCommand(bad), null, `명령 아님: ${JSON.stringify(bad)}`);
assert.equal(isInternalCommand("mail.apply"), true, "우편 넣기는 internal");
assert.equal(isInternalCommand("trade.lock"), true, "교환 잠금은 internal");
assert.equal(isInternalCommand("shop.buy"), false);

// (2) CLI 연결 — 이름 글자와 동작 넷
for (const action of ["connect", "disconnect", "check", "probe"]) assert.deepEqual(parseAgentRequest({ name: "claude", action }), { name: "claude", action });
for (const bad of [null, { name: "claude" }, { name: 1, action: "check" }, { name: "claude", action: "remove" }]) assert.equal(parseAgentRequest(bad), null);

// (3) 초상 — 배열이 아니면 null, slug 글자만, 상한, shiny 는 true 만
assert.equal(parsePortraitAsks({}), null);
assert.deepEqual(parsePortraitAsks([{ slug: "eevee", shiny: 1 }, { slug: 3 }, null, { slug: "pikachu", shiny: true }]), [{ slug: "eevee", shiny: false }, { slug: "pikachu", shiny: true }]);
assert.equal(parsePortraitAsks(Array.from({ length: INPUT_LIMITS.portraitAsks + 5 }, () => ({ slug: "a" })))!.length, INPUT_LIMITS.portraitAsks, "초상 상한");

// (4) 아이콘 — 배열이 아니면 null, 글자만, 상한
assert.equal(parseIconKeys("a"), null);
assert.deepEqual(parseIconKeys(["a", 1, "b"]), ["a", "b"]);
assert.equal(parseIconKeys(Array.from({ length: INPUT_LIMITS.iconKeys + 5 }, () => "k"))!.length, INPUT_LIMITS.iconKeys, "아이콘 상한");

// (5) 복사 — 짧은 글자만
assert.equal(parseCopyText("https://x"), "https://x");
assert.equal(parseCopyText("x".repeat(INPUT_LIMITS.copyChars)), "x".repeat(INPUT_LIMITS.copyChars), "상한까지는 받는다");
assert.equal(parseCopyText("x".repeat(INPUT_LIMITS.copyChars + 1)), null, "상한을 넘으면 받지 않는다");
assert.equal(parseCopyText(3), null);

// (6) 계정 — action 이 글자면 그대로(값 검사는 계정 쪽)
assert.deepEqual(parseAccountAction({ action: "status" }), { action: "status" });
for (const bad of [null, "status", { action: 1 }]) assert.equal(parseAccountAction(bad), null);

// (7) 우편 — 세 동작, id 는 uuid 모양만. 다른 칸은 버린다
const id = "10000000-0000-0000-0000-000000000001";
assert.deepEqual(parseMailAction({ action: "refresh", id: "x" }), { action: "refresh" }, "refresh 는 id 를 싣지 않는다");
assert.deepEqual(parseMailAction({ action: "claim", id, gifts: [{ kind: "points", count: 9 }] }), { action: "claim", id }, "선물 값은 받지 않는다");
assert.deepEqual(parseMailAction({ action: "read", id }), { action: "read", id });
for (const bad of [null, { action: "claim" }, { action: "claim", id: "nope" }, { action: "delete", id }]) assert.equal(parseMailAction(bad), null);

// (8) 업데이트·패치노트 — 정한 글자만
for (const a of ["status", "check", "install"]) assert.equal(parseUpdateAction(a), a);
assert.equal(parseUpdateAction("download"), null);
assert.equal(parseNotesAction("list"), "list");
assert.equal(parseNotesAction("seen"), "seen");
assert.equal(parseNotesAction("clear"), null);

process.stdout.write("selftest-manage-requests: 통과 (명령·internal·CLI 연결·초상·아이콘·복사·계정·우편·업데이트·패치노트)\n");
