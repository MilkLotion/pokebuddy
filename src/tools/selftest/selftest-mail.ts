// 우편함 자체 검사 — 선물 검사·저장에 넣기·중복 방지·끊김 복구·명령 통로 차단
// 설계: worklog/records/post-box/record.md "구현 설계". 서버 SQL 검사는 supabase/tests/mail_test.sql
import assert from "node:assert";
import { MINT_REFUND_EACH, MINT_RETIRED } from "../../bag/mint";
import { createMailInbox, type RpcResult } from "../../online/mail-inbox";
import { mailScreenOf } from "../../view/mail";
import { empty, normalize } from "../../save/v3";
import { createExecutor } from "../../tx/executor";
import type { SaveV3 } from "../../shared/save-v3";
import { isSinglePet } from "../../dex/forms";
import { singleSpecies } from "../../dex/obtain";
import { applyGifts, parseGifts } from "../../mail/gifts";
import { markRead, normalizeMail } from "../../mail/letters";
import { HANDLERS } from "../../tx/command-table";

const T0 = Date.UTC(2026, 8, 29, 3, 0, 0);

// (1) 선물 검사 — 아는 도구·진화용 도구·포인트만. 하나라도 모르면 편지 전체를 넣지 않는다
{
  assert.deepStrictEqual(parseGifts([{ kind: "item", id: "exp-candy-m", count: 3 }, { kind: "points", count: 500 }]), [{ kind: "item", id: "exp-candy-m", count: 3 }, { kind: "points", count: 500 }]);
  assert.ok(parseGifts([{ kind: "item", id: "fire-stone", count: 1 }]), "진화용 도구");
  assert.equal(parseGifts([{ kind: "item", id: "basic-food", count: 1 }]), null, "기본먹이는 선물이 아니다");
  assert.equal(parseGifts([{ kind: "item", id: "no-such-item", count: 1 }]), null, "모르는 도구");
  assert.equal(parseGifts([{ kind: "egg", id: "random", count: 1 }]), null, "모르는 종류 — 알은 1판에 없다");
  assert.equal(parseGifts([{ kind: "item", id: "toy", count: 0 }]), null, "개수는 1 이상");
  assert.equal(parseGifts([{ kind: "item", id: "toy", count: 1000 }]), null, "개수는 999 이하");
  assert.equal(parseGifts([{ kind: "points", count: 1.5 }]), null, "정수만");
  assert.equal(parseGifts({}), null, "배열이 아니다");
  // 옛 민트 식별자는 민트 한 종류로 바꿔 받는다 — 편지를 버리지 않는다 (2026-09-29 민트 통일)
  // 성격민트 은퇴(2026-09-30) 동안은 민트 선물을 개당 구매가만큼 포인트로 받는다 (src/bag/mint.ts)
  assert.deepStrictEqual(
    parseGifts([{ kind: "item", id: "adamant-mint", count: 2 }, { kind: "item", id: "mint", count: 1 }]),
    MINT_RETIRED
      ? [{ kind: "points", count: 2 * MINT_REFUND_EACH }, { kind: "points", count: MINT_REFUND_EACH }]
      : [{ kind: "item", id: "mint", count: 2 }, { kind: "item", id: "mint", count: 1 }],
  );
  {
    const s = empty(0);
    assert.deepStrictEqual(applyGifts(s, "old-mint", [{ kind: "item", id: "serious-mint", count: 3 }], undefined, { now: T0, rand: () => 0.5 }), { ok: true, applied: true });
    if (MINT_RETIRED) {
      assert.deepStrictEqual(s.bag, {}, "은퇴한 민트는 가방에 넣지 않는다");
      assert.equal(s.points.balance, 3 * MINT_REFUND_EACH, "옛 성실민트 3개 선물은 300P");
    } else assert.deepStrictEqual(s.bag, { mint: 3 }, "옛 성실민트 선물은 민트 3개");
  }
  process.stdout.write("(1) 선물 검사  ok\n");
}

// (2) 넣기 — 가방·포인트에 더하고, 같은 편지는 두 번 넣지 않는다. 받으면 읽은 것이다
{
  const s = empty(T0);
  s.points.balance = 10;
  s.bag.toy = 998;
  const gifts = [{ kind: "item", id: "toy", count: 5 }, { kind: "item", id: "exp-candy-m", count: 3 }, { kind: "points", count: 500 }];
  assert.deepStrictEqual(applyGifts(s, "L1", gifts, undefined, { now: T0, rand: () => 0.5 }), { ok: true, applied: true });
  assert.equal(s.bag.toy, 1003, "받는 선물은 가방 상한(999)으로 막지 않는다");
  assert.equal(s.bag["exp-candy-m"], 3);
  assert.equal(s.points.balance, 510);
  assert.deepStrictEqual(applyGifts(s, "L1", gifts, undefined, { now: T0, rand: () => 0.5 }), { ok: true, applied: false }, "같은 편지는 다시 넣지 않는다");
  assert.equal(s.points.balance, 510);
  assert.ok(s.mail?.read.includes("L1"), "받으면 읽은 것이다");
  assert.deepStrictEqual(applyGifts(s, "L2", [{ kind: "item", id: "nope", count: 1 }], undefined, { now: T0, rand: () => 0.5 }), { ok: false, reason: "bad-gift" });
  assert.deepStrictEqual(applyGifts(s, "L3", [], undefined, { now: T0, rand: () => 0.5 }), { ok: false, reason: "bad-gift" }, "공지 편지는 넣을 것이 없다");
  assert.ok(markRead(s, "N1"));
  // 저장 정규화 — 문자열 id 만 남는다. 옛 저장에는 mail 이 없다
  const round = normalize(JSON.parse(JSON.stringify({ ...s, mail: { applied: ["L1", 3, ""], read: ["L1", "N1"] } })) as unknown, T0);
  assert.deepStrictEqual(round?.mail, { applied: ["L1"], read: ["L1", "N1"] });
  assert.deepStrictEqual(normalizeMail(undefined), { applied: [], read: [] });
  process.stdout.write("(2) 저장에 넣기 · 중복 방지 · 정규화  ok\n");
}

// (2b) 포켓몬 선물 — 레벨 1 새 개체를 박스에 넣는다. 파티가 비어 있어도 박스. 도감에 입수로 남긴다
{
  assert.deepStrictEqual(parseGifts([{ kind: "pokemon", species: "dratini", count: 1 }]), [{ kind: "pokemon", species: "dratini", count: 1 }]);
  assert.equal(parseGifts([{ kind: "pokemon", species: "no-such-mon", count: 1 }]), null, "모르는 종");
  assert.equal(parseGifts([{ kind: "pokemon", species: "dratini", count: 7 }]), null, "한 편지에 같은 종 6마리까지");
  assert.equal(parseGifts([{ kind: "pokemon", count: 1 }]), null, "종이 없다");
  const s = empty(T0);
  const petsBefore = s.pets.length;
  const partyBefore = JSON.stringify(s.party.slots);
  assert.deepStrictEqual(applyGifts(s, "P1", [{ kind: "pokemon", species: "haunter", count: 2 }, { kind: "points", count: 10 }], undefined, { now: T0, rand: () => 0.3 }), { ok: true, applied: true });
  const got = s.pets.slice(petsBefore);
  assert.equal(got.length, 2, "두 마리");
  for (const p of got) {
    assert.equal(p.species, "haunter");
    assert.equal(p.level, 1);
    assert.equal(p.shiny, false, "이로치가 아니다");
    assert.equal(p.since, T0);
    assert.ok(s.boxes.some((b) => b.slots.includes(p.id)), "박스에 들어간다");
  }
  assert.notEqual(got[0]!.id, got[1]!.id, "개체 id 가 겹치지 않는다");
  assert.equal(JSON.stringify(s.party.slots), partyBefore, "파티는 그대로다");
  assert.ok(s.dex.obtained.includes("haunter"), "도감에 입수로 남는다");
  assert.equal(s.points.balance, empty(T0).points.balance + 10, "함께 담긴 포인트도 넣는다");
  assert.deepStrictEqual(applyGifts(s, "P1", [{ kind: "pokemon", species: "haunter", count: 2 }], undefined, { now: T0, rand: () => 0.5 }), { ok: true, applied: false }, "같은 편지로 다시 만들지 않는다");
  assert.equal(s.pets.length, petsBefore + 2);
  process.stdout.write("(2b) 포켓몬 선물  ok\n");
}

// (2c) 단일 포켓몬 선물 — 한 마리만 넣는다. 이미 얻은 종이면 넣지 않고 다른 선물은 받는다. 우편 전용 특수 폼도 단일 포켓몬이다
// (2026-10-03 사용자 결정 "이벤트같은거로 우편으로 보낼 예정이긴해. 대신 단일종 그거여야해.")
{
  for (const slug of ["magearna-original", "pichu-spiky-eared", "floette-eternal", "mewtwo"]) assert.ok(singleSpecies().has(slug), `단일 포켓몬 ${slug}`);
  for (const slug of ["lycanroc-dusk", "toxtricity-low-key", "pichu", "magearna-mega"]) assert.ok(!singleSpecies().has(slug), `단일 포켓몬이 아니다 ${slug}`);
  assert.equal(isSinglePet({ species: "pichu-spiky-eared", evolved: [] }), true, "교환할 수 없다");
  const s = empty(T0);
  const before = s.pets.length;
  assert.deepStrictEqual(applyGifts(s, "S1", [{ kind: "pokemon", species: "magearna-original", count: 3 }, { kind: "pokemon", species: "pichu-spiky-eared", count: 1 }], undefined, { now: T0, rand: () => 0.3 }), { ok: true, applied: true });
  assert.deepStrictEqual(s.pets.slice(before).map((p) => p.species), ["magearna-original", "pichu-spiky-eared"], "단일 포켓몬은 한 마리씩");
  assert.deepStrictEqual(applyGifts(s, "S2", [{ kind: "pokemon", species: "magearna-original", count: 1 }, { kind: "points", count: 5 }], undefined, { now: T0, rand: () => 0.3 }), { ok: true, applied: true });
  assert.equal(s.pets.length, before + 2, "이미 얻은 단일 포켓몬은 다시 넣지 않는다");
  assert.equal(s.points.balance, empty(T0).points.balance + 5, "같은 편지의 다른 선물은 받는다");
  // 개체를 내보내도 획득 이력으로 막는다
  s.pets = s.pets.filter((p) => p.species !== "magearna-original");
  assert.deepStrictEqual(applyGifts(s, "S3", [{ kind: "pokemon", species: "magearna-original", count: 1 }], undefined, { now: T0, rand: () => 0.5 }), { ok: true, applied: true });
  assert.ok(!s.pets.some((p) => p.species === "magearna-original"), "획득 이력으로 본다");
  process.stdout.write("(2c) 단일 포켓몬 선물  ok\n");
}

// (3) 실행기 — mail.apply 는 실행기에만 있다. 같은 요청 id 는 다시 돌리지 않는다
{
  let save: SaveV3 = empty(T0);
  const tx = createExecutor({ read: () => structuredClone(save), write: (s) => ((save = s), true), now: () => T0, rand: Math.random }, HANDLERS);
  const res = tx.run({ id: "mail-apply:L9", name: "mail.apply", args: { letterId: "L9", gifts: [{ kind: "points", count: 50 }] } });
  assert.equal(res.ok, true);
  const before = save.points.balance;
  tx.run({ id: "mail-apply:L9b", name: "mail.apply", args: { letterId: "L9", gifts: [{ kind: "points", count: 50 }] } });
  assert.equal(save.points.balance, before, "다른 요청 id 로 같은 편지를 넣어도 한 번만");
  assert.equal(tx.run({ id: "x", name: "mail.apply", args: { gifts: [] } }).ok, false, "편지 id 없음");
  process.stdout.write("(3) 실행기 mail.apply  ok\n");
}

// (4) 메인 우편함 — 목록, 받기, 로그인 필요, 끊김 복구, 모르는 선물
void (async () => {
  let save: SaveV3 = empty(T0);
  save.points.balance = 0;
  const tx = createExecutor({ read: () => structuredClone(save), write: (s) => ((save = s), true), now: () => T0, rand: Math.random }, HANDLERS);
  const iso = (ms: number): string => new Date(T0 + ms).toISOString();
  const letters = [
    { id: "A", title: "선물", body: "", sender: "PokeBuddy", gifts: [{ kind: "points", count: 100 }], starts_at: iso(-1000), ends_at: iso(86_400_000), claimed_at: null as string | null },
    { id: "B", title: "공지", body: "", sender: "PokeBuddy", gifts: [], starts_at: iso(-2000), ends_at: null, claimed_at: null as string | null },
    { id: "C", title: "끊긴 선물", body: "", sender: "PokeBuddy", gifts: [{ kind: "item", id: "toy", count: 2 }], starts_at: iso(-3000), ends_at: null, claimed_at: iso(-500) },
    { id: "D", title: "새 선물", body: "", sender: "PokeBuddy", gifts: [{ kind: "egg", id: "random", count: 1 }], starts_at: iso(-4000), ends_at: null, claimed_at: null as string | null },
  ];
  let signedIn = false;
  let hold = false; // 클라우드 저장이 올릴 수 있는 상태가 아니다
  let changed = 0;
  let claims = 0;
  const box = createMailInbox({
    rpc: async <T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> => {
      if (fn === "list_mail") return { ok: true, data: letters.map((l) => ({ ...l })) as T };
      claims += 1;
      const l = letters.find((x) => x.id === args.p_letter);
      if (!l) return { ok: false, code: "MAIL_NOT_FOUND" };
      l.claimed_at ??= iso(0);
      return { ok: true, data: [{ gifts: l.gifts, claimed_at: l.claimed_at }] as T };
    },
    run: (id, name, args) => tx.run({ id, name, args }),
    read: () => save,
    signedIn: () => signedIn,
    hold: async () => hold,
    onChanged: () => (changed += 1),
    screen: mailScreenOf,
    now: () => T0,
  });
  await box.refresh();
  let s = box.screen();
  assert.equal(s.letters.length, 4);
  assert.equal(save.bag.toy ?? 0, 0, "로그인하지 않았으면 복구하지 않는다 — 받은 시각은 계정의 것이다");
  assert.equal(s.unread, 4, "안 읽은 편지 넷");
  assert.equal(s.letters.find((l) => l.id === "D")?.unsupported, true, "모르는 선물");
  assert.deepStrictEqual((await box.act({ action: "claim", id: "A" })).code, "MAIL_LOGIN_REQUIRED");
  assert.equal(claims, 0, "로그인 전에는 서버를 부르지 않는다");

  signedIn = true;
  await box.refresh();
  assert.equal(save.bag.toy, 2, "서버에 받은 기록이 있는데 저장에 없으면 넣는다(끊김 복구)");
  hold = true;
  const held = await box.act({ action: "claim", id: "A" });
  assert.equal(held.code, "cloud-wait", "클라우드 저장이 올릴 수 없으면 받지 않는다");
  assert.equal(held.screen.error, "cloud-wait", "거절 사유를 편지 아래에 보인다");
  assert.equal(claims, 0, "막히면 서버를 부르지 않는다");
  hold = false;
  const r = await box.act({ action: "claim", id: "A" });
  assert.equal(r.ok, true);
  assert.equal(save.points.balance, 100);
  assert.equal(r.screen.letters.find((l) => l.id === "A")?.applied, true);
  assert.equal(r.screen.busy, null, "받은 뒤 받는 중 표시가 없다");
  await box.act({ action: "claim", id: "A" });
  assert.equal(save.points.balance, 100, "두 번 받아도 한 번만 넣는다");
  assert.equal((await box.act({ action: "claim", id: "D" })).code, "bad-gift", "모르는 선물은 서버에 받은 기록을 남기지 않는다");
  assert.equal(claims, 2);
  await box.act({ action: "read", id: "B" });
  s = box.screen();
  assert.equal(s.letters.find((l) => l.id === "B")?.read, true);
  assert.equal(s.unread, 1, "남은 것은 모르는 선물의 편지 하나");
  assert.ok(changed >= 2, "넣을 때마다 앱에 알린다");
  process.stdout.write("(4) 메인 우편함 · 받기 · 로그인 · 복구  ok\n");

  // (5) 목록을 읽는 사이 계정이 바뀌면 그 답은 버린다. 넣다가 던져도 받는 중 표시는 풀린다
  {
    let s2: SaveV3 = empty(T0);
    const tx2 = createExecutor({ read: () => structuredClone(s2), write: (x) => ((s2 = x), true), now: () => T0, rand: Math.random }, HANDLERS);
    let release: () => void = () => undefined;
    let slow = true;
    let throwOnChange = false;
    const box2 = createMailInbox({
      rpc: async <T>(fn: string): Promise<RpcResult<T>> => {
        if (fn === "list_mail") {
          if (slow) await new Promise<void>((r) => (release = r));
          return { ok: true, data: [{ ...letters[2]!, claimed_at: iso(-500) }, { ...letters[0]!, claimed_at: null }] as T };
        }
        return { ok: true, data: [{ gifts: letters[0]!.gifts, claimed_at: iso(0) }] as T };
      },
      run: (id, name, args) => tx2.run({ id, name, args }),
      read: () => s2,
      signedIn: () => true,
      onChanged: () => {
        if (throwOnChange) throw new Error("다시 그리기 실패");
      },
      screen: mailScreenOf,
      now: () => T0,
    });
    const pending = box2.refresh();
    box2.userChanged();
    release();
    await pending;
    assert.equal(s2.bag.toy ?? 0, 0, "바뀌기 전 계정의 받은 기록으로 복구하지 않는다");
    assert.equal(box2.screen().letters.length, 0, "지난 목록을 버린다");
    slow = false;
    await box2.refresh();
    assert.equal(s2.bag.toy, 2, "새로 읽은 목록으로 복구한다");
    throwOnChange = true;
    const bad = await box2.act({ action: "claim", id: "A" });
    assert.equal(bad.ok, false);
    assert.equal(bad.screen.busy, null, "던져도 받는 중 표시가 풀린다");
    throwOnChange = false;
    assert.equal((await box2.act({ action: "claim", id: "A" })).screen.busy, null);
    assert.equal(s2.points.balance, 100, "다시 받아도 한 번만 들어간다");
    process.stdout.write("(5) 계정 바뀜 · 받는 중 표시 풀기  ok\n");
  }
  process.stdout.write("selftest-mail: 통과 (선물 검사·넣기·중복·복구)\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
