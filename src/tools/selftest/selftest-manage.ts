// 관리 창이 쓰는 길 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-manage.js
//
// Electron 없이 확인한다. 창은 `src/tx/game.ts` 하나만 부르므로 그것을 직접 부른다.
// 임시 폴더에 실제 저장 파일을 만들고, 스냅샷을 읽고 명령을 보낸 뒤 다시 읽는다.
// 계약은 docs/specs/modules.md 의 명령 계약과 `src/shared/manage.d.ts` 다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createGenGate } from "../../main/windows/device-gen";
import { createGame } from "../../tx/game";
import { petName } from "../../view/text";
import { snapshotOfGame } from "../../view/snapshot";
import { dexList } from "../../view/dex-list";
import * as store from "../../save/save-file";
import { empty } from "../../save/v3";
import { gainOf } from "../../state/settings";
import type { SaveV3 } from "../../shared/save-v3";
import { makeTmp } from "../harness/tmp-dir";
import { BAG_RULES } from "../../bag/rules";
import { PARTY_RULES } from "../../party/rules";
import { SOUND_RULES } from "../../state/rules";
import { T0 } from "../harness/clock"; // 2026-09-24 10:00 로컬 — 게임 시간 낮
import { testPet } from "../harness/fixtures";

const HOUR = 3_600_000;

const root = makeTmp("selftest-manage");
const file = path.join(root, "save-v3.json");

function seed(): SaveV3 {
  const s = empty(T0);
  s.points.balance = 340;
  s.pets.push(testPet({ species: "pikachu", size: 2, level: 12, exp: 2000, affinity: 80, fullness: 55 }));
  s.starterPetId = "p1";
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: true };
  s.dex.unlocked = ["pikachu"];
  s.dex.obtained = ["pikachu"];
  return s;
}

try {
  let now = T0;
  const game = createGame({ petName, file, now: () => now, rand: () => 0.5 });

  // (1) 저장이 없으면 스냅샷도 없다
  assert.equal(snapshotOfGame(game), null, "저장이 없으면 null");
  assert.equal(game.tick(), null);
  process.stdout.write("(1) 저장 없음  ok\n");

  assert.equal(store.writeSave(file, seed()), true);

  // (2) 스냅샷은 화면이 바로 쓸 값을 준다
  {
    const v = snapshotOfGame(game);
    assert.ok(v);
    assert.equal(v.points, 340);
    const pet = v.party.slots[0]?.pet;
    assert.equal(pet?.name, "피카츄", "슬러그가 아니라 이름");
    assert.equal(pet?.hidden, true);
    assert.equal(pet?.zone, "normal", "만복도 55 는 보통");
    assert.equal(v.party.shown, 0);
    assert.equal(v.party.usable, PARTY_RULES.openAtStart);
    process.stdout.write("(2) 스냅샷 값  ok\n");
  }

  // 조작 하나마다 새 식별자를 붙인다. 화면이 하는 것과 같다
  let seq = 0;
  const click = (cmd: string, target: string): ReturnType<typeof game.send> =>
    game.send({ cmd, target, args: { reqId: `ui:${++seq}` } }, "settings");
  const click2 = (cmd: string, target: string, args: Record<string, unknown>): ReturnType<typeof game.send> =>
    game.send({ cmd, target, args: { ...args, reqId: `ui:${++seq}` } }, "settings");

  // (3) 명령을 보내면 저장이 바뀌고 다음 스냅샷에 보인다
  {
    const reply = click("party.show", "p1");
    assert.equal(reply.ok, true);
    assert.equal(reply.reason, "ok");
    const v = snapshotOfGame(game);
    assert.equal(v?.party.slots[0]?.pet?.hidden, false, "꺼낸 상태가 보인다");
    assert.equal(v?.party.shown, 1);
    process.stdout.write("(3) 명령 · 꺼내기  ok\n");
  }

  // (4) 규칙에 걸리면 이유가 그대로 온다
  {
    const reply = click("party.show", "p1");
    assert.equal(reply.ok, false);
    assert.equal(reply.reason, "already");
    // 같은 식별자로 다시 보내면 한 번만 반영한다
    const once = game.send({ cmd: "party.hide", target: "p1", args: { reqId: "same" } }, "settings");
    const again = game.send({ cmd: "party.hide", target: "p1", args: { reqId: "same" } }, "settings");
    assert.equal(once.ok, true);
    assert.equal(again.ok, true);
    assert.equal(again.replayed, true, "두 번째는 재생");
    assert.equal(click("party.show", "p1").ok, true, "다시 꺼낸다");
    process.stdout.write("(4) 실패 이유와 중복 방지  ok\n");
  }

  // (5) 앱이 꺼져 있던 틈은 소급하지 않는다. 켜 둔 시간만 흐른다
  {
    now = T0 + 24 * HOUR;
    assert.ok(game.tick());
    assert.equal(snapshotOfGame(game)?.party.slots[0]?.pet?.fullness, 55, "하루 꺼 둔 틈에는 만복도가 줄지 않는다");

    // 앱처럼 짧은 간격으로 2시간을 흘린다
    const step = 30_000;
    let hungry = 0;
    for (let n = 0; n < (2 * HOUR) / step; n++) {
      now += step;
      const events = game.tick();
      assert.ok(events);
      hungry += events.hungerEnter.length;
    }
    const v = snapshotOfGame(game);
    assert.equal(v?.party.slots[0]?.pet?.fullness, 0, "2시간에 60 감소, 0 에서 멈춘다");
    assert.ok(v && v.points > 340, "포인트가 쌓였다");
    assert.ok(hungry >= 1, "배고픔 구간 진입을 알린다");
    process.stdout.write("(5) 틱 · 꺼 둔 틈은 버리고 켜 둔 시간만 적용  ok\n");

    // 틱은 에이전트 작업 시간을 받는다. 흐른 시간을 넘는 몫은 버린다
    const before = store.readSave(file, { repair: false }).state!.totals.workMs;
    now += step;
    assert.ok(game.tick({ workMs: 10 * step }));
    assert.equal(store.readSave(file, { repair: false }).state!.totals.workMs - before, step, "흐른 30초만 작업으로 센다");
    process.stdout.write("(5b) 틱 · 에이전트 작업 시간  ok\n");
  }

  // (6) 밥을 주면 만복도가 오르고 쿨타임이 화면 값으로 온다
  {
    const reply = game.send({ cmd: "feed", target: "p1" }, "settings");
    assert.equal(reply.ok, true);
    const pet = snapshotOfGame(game)?.party.slots[0]?.pet;
    assert.equal(pet?.fullness, 20, "0 에서 20 으로");
    assert.equal(pet?.feedReady, false);
    assert.equal(pet?.feedInSec, BAG_RULES.feedCooldownMs / 1000, "남은 쿨타임을 초로");
    process.stdout.write("(6) 밥 주기와 쿨타임 표시  ok\n");
  }

  // (7) 놀아주면 중첩이 화면 값에 실린다
  {
    assert.equal(game.send({ cmd: "play", target: "p1" }, "settings").ok, true);
    const pet = snapshotOfGame(game)?.party.slots[0]?.pet;
    assert.equal(pet?.playStreak, 1);
    assert.equal(pet?.longPlay, false);
    assert.equal(pet?.playReady, false);
    process.stdout.write("(7) 놀아주기 중첩 표시  ok\n");
  }

  // (8) 박스에 보관하면 파티 칸이 빈다
  {
    assert.equal(game.send({ cmd: "party.keep", target: "p1" }, "settings").ok, true);
    const v = snapshotOfGame(game);
    assert.equal(v?.party.slots[0]?.state, "empty");
    assert.equal(v?.boxes[0]?.used, 1, "박스로 갔다");
    process.stdout.write("(8) 박스 보관  ok\n");
  }

  // (9) 모르는 명령은 이유를 돌려주고 저장을 건드리지 않는다
  {
    const before = JSON.stringify(game.read());
    const reply = game.send({ cmd: "없는명령", target: "p1" }, "settings");
    assert.equal(reply.ok, false);
    assert.equal(reply.reason, "unknown-cmd");
    assert.equal(JSON.stringify(game.read()), before, "저장이 그대로");
    process.stdout.write("(9) 모르는 명령  ok\n");
  }

  // (10) 상점 목록은 스냅샷에 실려 온다. 살 수 없으면 이유가 붙는다
  {
    const shop = snapshotOfGame(game)?.shop ?? [];
    const egg = shop.find((i) => i.id === "random");
    assert.ok(egg, "랜덤알이 있다");
    assert.equal(egg.category, "egg");
    assert.equal(egg.name, "랜덤알", "슬러그가 아니라 이름");
    const slot = shop.find((i) => i.id === "party-slot");
    assert.ok(slot, "파티 칸이 있다");
    assert.equal(slot.category, "slot");
    // 포인트가 모자란 상품은 affordable 이 false 다. 화면이 그것으로 비활성을 정한다
    const dear = shop.find((i) => i.price > (snapshotOfGame(game)?.points ?? 0));
    assert.equal(dear?.affordable, false, "비싼 상품은 살 수 없다");
    process.stdout.write("(10) 상점 목록  ok\n");
  }

  // (11) 도감은 따로 부른다. 도감 번호 순이며 상태가 세 가지다
  {
    const rows = dexList(game.read()!);
    assert.equal(rows.length, 1095, "폼을 뺀 기본 종 1025 + 리전폼 57 + 특수 폼 13 — 리전폼과 특수 폼은 다른 종이라 따로 보인다");
    assert.equal(rows[0]?.slug, "bulbasaur", "1번은 이상해씨");
    let prev = 0;
    let prevForm = 0;
    for (const row of rows) {
      const form = row.form ?? 0;
      assert.ok(row.dex > prev || (row.dex === prev && form > prevForm), `도감 번호, 그다음 폼 순번으로 늘어난다 (${row.slug})`);
      prev = row.dex;
      prevForm = form;
    }
    const meowths = rows.filter((r) => r.dex === 52).map((r) => [r.slug, r.form, r.region]);
    assert.deepStrictEqual(meowths, [["meowth", undefined, undefined], ["meowth-alola", 1, "alola"], ["meowth-galar", 2, "galar"]], "같은 번호는 기본형 → 폼 순번");
    // 특수 폼 — 기본형 다음 칸, 도감 지방 칸은 항목의 지방
    assert.deepStrictEqual(rows.filter((r) => r.dex === 670).map((r) => [r.slug, r.form, r.region]), [["floette", undefined, undefined], ["floette-eternal", 1, "kalos"]]);
    assert.deepStrictEqual(rows.filter((r) => r.dex === 901).map((r) => [r.slug, r.form, r.region]), [["ursaluna", undefined, undefined], ["ursaluna-bloodmoon", 1, "paldea"]]);
    assert.deepStrictEqual(rows.filter((r) => r.dex === 745).map((r) => [r.slug, r.form, r.region]), [["lycanroc", undefined, undefined], ["lycanroc-midnight", 1, "alola"], ["lycanroc-dusk", 2, "alola"]]);
    assert.deepStrictEqual(rows.filter((r) => r.dex === 172).map((r) => [r.slug, r.form, r.region]), [["pichu", undefined, undefined], ["pichu-spiky-eared", 1, "johto"]]);
    assert.deepStrictEqual(rows.filter((r) => r.dex === 550).map((r) => [r.slug, r.form, r.region]), [["basculin", undefined, undefined], ["basculin-blue-striped", 1, "unova"], ["basculin-white-striped", 2, "hisui"]]);
    assert.deepStrictEqual(rows.filter((r) => r.dex === 483).map((r) => [r.slug, r.form, r.region]), [["dialga", undefined, undefined], ["dialga-origin", 1, "hisui"]]);
    assert.deepStrictEqual(rows.filter((r) => r.dex === 484).map((r) => [r.slug, r.form, r.region]), [["palkia", undefined, undefined], ["palkia-origin", 1, "hisui"]]);
    const pika = rows.find((r) => r.slug === "pikachu");
    assert.equal(pika?.name, "피카츄");
    assert.equal(pika?.state, "obtained", "가지고 있는 종");
    const locked = rows.find((r) => r.slug === "mewtwo");
    assert.equal(locked?.state, "locked");
    process.stdout.write("(11) 도감 목록  ok\n");
  }

  // (12) 설정은 한 항목씩 바꾼다. 허용 밖의 값이면 저장을 건드리지 않는다
  {
    assert.equal(snapshotOfGame(game)?.settings.sound, true, "기본은 켬");
    assert.equal(click2("settings.set", "sound", { value: false }).ok, true);
    assert.equal(snapshotOfGame(game)?.settings.sound, false, "끔으로 바뀐다");
    // 소리 크기 — 0~100 정수. 기본 30. 음량은 설정 값 × 소리별 최대, 끄면 0 (src/state/settings.ts gainOf)
    assert.equal(snapshotOfGame(game)?.settings.volume, SOUND_RULES.defaultVolume);
    assert.equal(click2("settings.set", "volume", { value: 55 }).ok, true);
    assert.equal(snapshotOfGame(game)?.settings.volume, 55);
    for (const v of [-1, 101, 12.5, "50"]) assert.equal(click2("settings.set", "volume", { value: v }).reason, "bad-value", String(v));
    assert.equal(gainOf({ sound: true, volume: 30 }, SOUND_RULES.cryMax), 0.105);
    assert.equal(gainOf({ sound: false, volume: 100 }, SOUND_RULES.cryMax), 0, "소리를 끄면 무음");
    assert.equal(gainOf({ sound: true, volume: 0 }, SOUND_RULES.chimeMax), 0);

    const bad = click2("settings.set", "sleepAfterMin", { value: 7 });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "bad-value", "목록에 없는 값은 거절");
    assert.equal(click2("settings.set", "sleepAfterMin", { value: 0 }).ok, true, "0 은 잠들지 않음");
    assert.equal(snapshotOfGame(game)?.settings.sleepAfterMin, 0);

    const unknown = click2("settings.set", "없는키", { value: 1 });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, "bad-args");
    process.stdout.write("(12) 설정 바꾸기  ok\n");
  }

  // (13) 업적창이 읽는 목록 — 이름·설명·보상과 세 가지 상태
  {
    const list = snapshotOfGame(game)?.achievements.list ?? [];
    assert.equal(list.length, 38, "업적 38개");
    assert.equal(list.find((a) => a.id === "work-100h")?.reward, "라프라스", "포켓몬 보상은 종 이름으로");
    const two = list.find((a) => a.id === "show-two");
    assert.equal(two?.name, "두 마리 함께 꺼내기");
    assert.equal(two?.reward, "파티 칸 +1", "보상은 화면 문구로");
    assert.equal(two?.state, "locked", "한 마리뿐이라 아직 달성 전");
    assert.equal(snapshotOfGame(game)?.achievements.unclaimed, 0);

    // 달성하지 않은 업적의 보상은 받을 수 없다
    const claim = click2("achievement.claim", "show-two", {});
    assert.equal(claim.ok, false);
    assert.equal(claim.reason, "not-achieved");
    process.stdout.write("(13) 업적 목록  ok\n");
  }

  // (14) 기기 창 세대 번호 — 닫힌 뒤 낡은 번호의 여는 요청은 버리고, 닫힘을 받은 뒤의 요청은 바로 연다 (src/main/windows/device-gen.ts)
  {
    const gate = createGenGate();
    assert.equal(gate.accepts(0), true, "처음 — 관리 창도 0 에서 센다");
    const closed = gate.bump(); // 기기 창 ✕ — 관리 창에 1 을 알린다
    assert.equal(closed, 1);
    assert.equal(gate.accepts(0), false, "닫힘을 알기 전의 1초 새로 고침(0)은 버린다 — 닫은 창이 다시 뜨지 않는다");
    assert.equal(gate.accepts(1), true, "닫힘을 받은 뒤 같은 개체를 다시 누르면 바로 연다");
    for (const bad of [1.5, "1", null, undefined, Number.NaN, 2 ** 60]) assert.equal(gate.accepts(bad), false, `정수가 아니거나 지금 번호가 아니면 버린다: ${String(bad)}`);
    gate.reset();
    assert.equal(gate.accepts(0), true, "관리 창 문서를 새로 읽으면 0 부터");
    process.stdout.write("(14) 기기 창 세대 번호  ok\n");
  }

  process.stdout.write("selftest-manage: 통과 (스냅샷·명령·틱·실패·목록·설정·업적)\n");
} finally {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // 지우지 못해도 검사 결과는 그대로다
  }
}
