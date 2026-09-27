// 관리 창이 쓰는 길 자체 확인 — npm run build 뒤 node dist/tools/selftest-manage.js
//
// Electron 없이 확인한다. 창은 `src/main/game.ts` 하나만 부르므로 그것을 직접 부른다.
// 임시 폴더에 실제 저장 파일을 만들고, 스냅샷을 읽고 명령을 보낸 뒤 다시 읽는다.
// 계약은 docs/specs/modules.md 의 명령 계약과 `src/shared/manage.d.ts` 다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGame } from "../main/game";
import { SAVE_V3_RULES } from "../save/rules";
import * as store from "../save/store";
import { empty } from "../save/v3";
import { SOUND_RULES, gainOf } from "../state/settings";
import type { SaveV3 } from "../shared/save-v3";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();
const HOUR = 3_600_000;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pokebuddy-selftest-manage-"));
const file = path.join(root, "save-v3.json");

function seed(): SaveV3 {
  const s = empty(T0);
  s.points.balance = 340;
  s.pets.push({
    id: "p1", species: "pikachu", shiny: false, nature: "hardy", size: 2,
    level: 12, exp: 2000, affinity: 80, affinityProgressMs: 0, fullness: 55, fullnessProgressMs: 0,
    mood: 60, moodProgressMs: 0, feedCooldownMs: 0, playCooldownMs: 0, playWindowMs: 0, playStreak: 0,
    buffs: [], home: { dx: -24, dy: -60 }, since: T0, stage: 0, evolved: [],
    daily: { date: "2026-09-24", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  });
  s.starterPetId = "p1";
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: true };
  s.dex.unlocked = ["pikachu"];
  s.dex.obtained = ["pikachu"];
  return s;
}

try {
  let now = T0;
  const game = createGame({ file, now: () => now, rand: () => 0.5 });

  // (1) 저장이 없으면 스냅샷도 없다
  assert.equal(game.view(), null, "저장이 없으면 null");
  assert.equal(game.tick(), null);
  process.stdout.write("(1) 저장 없음  ok\n");

  assert.equal(store.write(file, seed()), true);

  // (2) 스냅샷은 화면이 바로 쓸 값을 준다
  {
    const v = game.view();
    assert.ok(v);
    assert.equal(v.points, 340);
    const pet = v.party.slots[0]?.pet;
    assert.equal(pet?.name, "피카츄", "슬러그가 아니라 이름");
    assert.equal(pet?.hidden, true);
    assert.equal(pet?.zone, "normal", "만복도 55 는 보통");
    assert.equal(v.party.shown, 0);
    assert.equal(v.party.usable, SAVE_V3_RULES.party.openAtStart);
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
    const v = game.view();
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
    assert.equal(game.view()?.party.slots[0]?.pet?.fullness, 55, "하루 꺼 둔 틈에는 만복도가 줄지 않는다");

    // 앱처럼 짧은 간격으로 2시간을 흘린다
    const step = 30_000;
    let hungry = 0;
    for (let n = 0; n < (2 * HOUR) / step; n++) {
      now += step;
      const events = game.tick();
      assert.ok(events);
      hungry += events.hungerEnter.length;
    }
    const v = game.view();
    assert.equal(v?.party.slots[0]?.pet?.fullness, 0, "2시간에 60 감소, 0 에서 멈춘다");
    assert.ok(v && v.points > 340, "포인트가 쌓였다");
    assert.ok(hungry >= 1, "배고픔 구간 진입을 알린다");
    process.stdout.write("(5) 틱 · 꺼 둔 틈은 버리고 켜 둔 시간만 적용  ok\n");

    // 틱은 에이전트 작업 시간을 받는다. 흐른 시간을 넘는 몫은 버린다
    const before = store.read(file, { repair: false }).state!.totals.workMs;
    now += step;
    assert.ok(game.tick({ workMs: 10 * step }));
    assert.equal(store.read(file, { repair: false }).state!.totals.workMs - before, step, "흐른 30초만 작업으로 센다");
    process.stdout.write("(5b) 틱 · 에이전트 작업 시간  ok\n");
  }

  // (6) 밥을 주면 만복도가 오르고 쿨타임이 화면 값으로 온다
  {
    const reply = game.send({ cmd: "feed", target: "p1" }, "settings");
    assert.equal(reply.ok, true);
    const pet = game.view()?.party.slots[0]?.pet;
    assert.equal(pet?.fullness, 20, "0 에서 20 으로");
    assert.equal(pet?.feedReady, false);
    assert.equal(pet?.feedInSec, SAVE_V3_RULES.feedCooldownMs / 1000, "남은 쿨타임을 초로");
    process.stdout.write("(6) 밥 주기와 쿨타임 표시  ok\n");
  }

  // (7) 놀아주면 중첩이 화면 값에 실린다
  {
    assert.equal(game.send({ cmd: "play", target: "p1" }, "settings").ok, true);
    const pet = game.view()?.party.slots[0]?.pet;
    assert.equal(pet?.playStreak, 1);
    assert.equal(pet?.longPlay, false);
    assert.equal(pet?.playReady, false);
    process.stdout.write("(7) 놀아주기 중첩 표시  ok\n");
  }

  // (8) 박스에 보관하면 파티 칸이 빈다
  {
    assert.equal(game.send({ cmd: "party.keep", target: "p1" }, "settings").ok, true);
    const v = game.view();
    assert.equal(v?.party.slots[0]?.state, "empty");
    assert.equal(v?.boxes[0]?.used, 1, "박스로 갔다");
    process.stdout.write("(8) 박스 보관  ok\n");
  }

  // (9) 모르는 명령은 이유를 돌려주고 저장을 건드리지 않는다
  {
    const before = JSON.stringify(game.read());
    const reply = game.send({ cmd: "없는명령", target: "p1" }, "settings");
    assert.equal(reply.ok, false);
    assert.equal(reply.reason, "unknown-command");
    assert.equal(JSON.stringify(game.read()), before, "저장이 그대로");
    process.stdout.write("(9) 모르는 명령  ok\n");
  }

  // (10) 상점 목록은 스냅샷에 실려 온다. 살 수 없으면 이유가 붙는다
  {
    const shop = game.view()?.shop ?? [];
    const egg = shop.find((i) => i.id === "random");
    assert.ok(egg, "랜덤알이 있다");
    assert.equal(egg.category, "egg");
    assert.equal(egg.name, "랜덤알", "슬러그가 아니라 이름");
    const slot = shop.find((i) => i.id === "party-slot");
    assert.ok(slot, "파티 칸이 있다");
    assert.equal(slot.category, "slot");
    // 포인트가 모자란 상품은 affordable 이 false 다. 화면이 그것으로 비활성을 정한다
    const dear = shop.find((i) => i.price > (game.view()?.points ?? 0));
    assert.equal(dear?.affordable, false, "비싼 상품은 살 수 없다");
    process.stdout.write("(10) 상점 목록  ok\n");
  }

  // (11) 도감은 따로 부른다. 도감 번호 순이며 상태가 세 가지다
  {
    const rows = game.dex();
    assert.equal(rows.length, 1025, "폼을 뺀 기본 종 수 — 공식 전국도감 1025");
    assert.equal(rows[0]?.slug, "bulbasaur", "1번은 이상해씨");
    let prev = 0;
    for (const row of rows) {
      assert.ok(row.dex > prev, `도감 번호가 늘어난다 (${row.slug})`);
      prev = row.dex;
    }
    const pika = rows.find((r) => r.slug === "pikachu");
    assert.equal(pika?.name, "피카츄");
    assert.equal(pika?.state, "obtained", "가지고 있는 종");
    const locked = rows.find((r) => r.slug === "mewtwo");
    assert.equal(locked?.state, "locked");
    process.stdout.write("(11) 도감 목록  ok\n");
  }

  // (12) 설정은 한 항목씩 바꾼다. 허용 밖의 값이면 저장을 건드리지 않는다
  {
    assert.equal(game.view()?.settings.sound, true, "기본은 켬");
    assert.equal(click2("settings.set", "sound", { value: false }).ok, true);
    assert.equal(game.view()?.settings.sound, false, "끔으로 바뀐다");
    // 소리 크기 — 0~100 정수. 기본 30. 음량은 설정 값 × 소리별 최대, 끄면 0 (src/state/settings.ts gainOf)
    assert.equal(game.view()?.settings.volume, SOUND_RULES.defaultVolume);
    assert.equal(click2("settings.set", "volume", { value: 55 }).ok, true);
    assert.equal(game.view()?.settings.volume, 55);
    for (const v of [-1, 101, 12.5, "50"]) assert.equal(click2("settings.set", "volume", { value: v }).reason, "bad-value", String(v));
    assert.equal(gainOf({ sound: true, volume: 30 }, SOUND_RULES.cryMax), 0.105);
    assert.equal(gainOf({ sound: false, volume: 100 }, SOUND_RULES.cryMax), 0, "소리를 끄면 무음");
    assert.equal(gainOf({ sound: true, volume: 0 }, SOUND_RULES.chimeMax), 0);

    const bad = click2("settings.set", "sleepAfterMin", { value: 7 });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "bad-value", "목록에 없는 값은 거절");
    assert.equal(click2("settings.set", "sleepAfterMin", { value: 0 }).ok, true, "0 은 잠들지 않음");
    assert.equal(game.view()?.settings.sleepAfterMin, 0);

    const unknown = click2("settings.set", "없는키", { value: 1 });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, "bad-args");
    process.stdout.write("(12) 설정 바꾸기  ok\n");
  }

  // (13) 업적창이 읽는 목록 — 이름·설명·보상과 세 가지 상태
  {
    const list = game.view()?.achievements.list ?? [];
    assert.equal(list.length, 2, "업적 2개");
    const two = list.find((a) => a.id === "show-two");
    assert.equal(two?.name, "두 마리 함께 꺼내기");
    assert.equal(two?.reward, "파티 칸 +1", "보상은 화면 문구로");
    assert.equal(two?.state, "locked", "한 마리뿐이라 아직 달성 전");
    assert.equal(game.view()?.achievements.unclaimed, 0);

    // 달성하지 않은 업적의 보상은 받을 수 없다
    const claim = click2("achievement.claim", "show-two", {});
    assert.equal(claim.ok, false);
    assert.equal(claim.reason, "not-achieved");
    process.stdout.write("(13) 업적 목록  ok\n");
  }

  process.stdout.write("selftest-manage: 통과 (스냅샷·명령·틱·실패·목록·설정·업적)\n");
} finally {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // 지우지 못해도 검사 결과는 그대로다
  }
}
