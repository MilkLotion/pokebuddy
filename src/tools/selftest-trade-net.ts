// 친구 교환 서버 통합 확인 — 로컬 Supabase 에 두 사용자를 붙여 교환을 끝까지 돌린다
//   npx supabase start 뒤: npm run build && node dist/tools/selftest-trade-net.js
//   주소와 키는 POKEBUDDY_SUPABASE_URL, POKEBUDDY_SUPABASE_KEY 로 받는다. 없으면 `npx supabase status -o json` 에서 읽는다
//   로컬 서버가 없으면 건너뛴다(종료 코드 0). 실제 프로젝트에는 붙지 않는다 — 주소가 127.0.0.1 이 아니면 멈춘다
// 설계는 worklog/records/trade/record.md "전체 구조", "로컬 저장과 복구"
import assert from "node:assert";
import { execSync } from "node:child_process";
import { createTradeNet, type SessionStorage } from "../trade/net";
import { createTradeSession, type TradeViewModel } from "../trade/session";
import { dataVersion } from "../trade/config";
import { newPet } from "../party/create";
import { empty } from "../save/v3";
import type { SaveV3 } from "../shared/save-v3";
import { createExecutor } from "../tx/executor";
import { HANDLERS } from "../tx/handlers";

function local(): { url: string; key: string } | null {
  if (process.env.POKEBUDDY_SUPABASE_URL && process.env.POKEBUDDY_SUPABASE_KEY) return { url: process.env.POKEBUDDY_SUPABASE_URL, key: process.env.POKEBUDDY_SUPABASE_KEY };
  try {
    const raw = execSync("npx supabase status -o json", { stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 }).toString();
    const j = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<string, string>;
    const url = j.API_URL, key = j.PUBLISHABLE_KEY ?? j.ANON_KEY;
    return url && key ? { url, key } : null;
  } catch {
    return null;
  }
}

const memory = (): SessionStorage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

function player(species: string, url: string, key: string) {
  const T0 = Date.now();
  let disk: SaveV3 = empty(T0);
  disk.pets.push(newPet({ id: "p1", species, shiny: false, nature: "hardy", now: T0 }));
  disk.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  const exec = createExecutor({ read: () => structuredClone(disk), write: (x) => { disk = x; return true; }, now: () => Date.now() }, HANDLERS);
  const views: TradeViewModel[] = [];
  const session = createTradeSession({
    net: createTradeNet({ url, key, storage: memory() }),
    run: (id, name, args) => exec.run({ id, name, args }),
    read: () => disk,
    protocol: 1,
    dataVersion: dataVersion(),
    linkOf: (t) => `https://example.invalid/trade#${t}`,
    onView: (v) => views.push(v),
    pollMs: 3_600_000,
  });
  return { session, views, save: () => disk };
}

async function main(): Promise<void> {
  const cfg = local();
  if (!cfg) { process.stdout.write("selftest-trade-net: 로컬 Supabase 가 없어 건너뜀\n"); return; }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(cfg.url)) throw new Error("로컬 주소가 아니다 — 실제 프로젝트에는 붙지 않는다");

  const a = player("charmander", cfg.url, cfg.key);
  const b = player("eevee", cfg.url, cfg.key);
  try {
    await a.session.create();
    const link = a.session.view().link;
    assert.ok(link && link.includes("#"), "A 가 링크를 만든다");
    await b.session.join(link!);
    assert.equal(b.session.view().phase, "trading", "B 가 참가한다");
    await a.session.refresh();
    assert.equal(a.session.view().phase, "trading");
    process.stdout.write("(1) 링크 만들기·참가  ok\n");

    await a.session.offer("p1");
    await b.session.offer("p1");
    await a.session.refresh();
    assert.equal(a.session.view().friendPet?.species, "eevee", "A 가 친구 제안을 본다");
    assert.equal(b.session.view().friendPet?.species, "charmander");
    process.stdout.write("(2) 제안  ok\n");

    await a.session.ready();
    assert.equal(a.save().trade?.pending?.petId, "p1", "A 가 확정하면 로컬에 잠근다");
    await b.session.ready(); // 뒤에 확정한 B 가 완료를 쓰고 반영한다
    assert.equal(b.session.view().phase, "done");
    await a.session.refresh();
    assert.equal(a.session.view().phase, "done");
    process.stdout.write("(3) 확정·완료  ok\n");

    const sa = a.save(), sb = b.save();
    assert.equal(sa.pets.length, 1);
    assert.equal(sa.pets[0]!.species, "eevee", "A 는 이브이를 받는다");
    assert.equal(sb.pets[0]!.species, "charmander", "B 는 파이리를 받는다");
    assert.equal(sa.party.slots[0]!.petId, sa.pets[0]!.id, "받은 개체가 같은 칸에");
    assert.equal(sa.trade?.pending, null);
    assert.equal(sb.trade?.pending, null);
    process.stdout.write("(4) 양쪽 저장 반영  ok\n");

    // 완료 뒤 다시 읽어도 한 번만 반영된다
    await a.session.refresh();
    assert.equal(a.save().pets.length, 1);
    process.stdout.write("(5) 다시 읽어도 한 번만  ok\n");

    // 나가기: 새 채널에서 B 가 나가면 A 는 닫힌다
    await a.session.create();
    await b.session.join(a.session.view().link!);
    await b.session.leave();
    await a.session.refresh();
    assert.equal(a.session.view().phase, "closed");
    assert.equal(a.session.view().channel?.closed_reason, "guest_left");
    process.stdout.write("(6) 친구 나감  ok\n");

    // 오류: 닫힌 채널의 링크는 만료, 참가가 끝난 채널의 링크는 사용됨
    const closed = a.session.view().link!;
    const c = player("pikachu", cfg.url, cfg.key);
    await c.session.join(closed);
    assert.equal(c.session.view().error?.code, "TRADE_LINK_EXPIRED", "닫힌 채널의 링크");
    await a.session.create();
    const open = a.session.view().link!;
    await b.session.join(open);
    await c.session.join(open);
    assert.equal(c.session.view().error?.code, "TRADE_LINK_USED", "세 번째 사람");
    process.stdout.write("(7) 오류 코드 전달  ok\n");

    // 거절 이유: 진행 중 채널이 있으면 새로 만들지 않는다. 채널이 없으면 확정하지 않는다. 멈춘 세션은 조작하지 않는다
    assert.deepEqual(await a.session.create(), { ok: false, reason: "in-trade" });
    assert.deepEqual(await c.session.ready(), { ok: false, reason: "no-channel" });
    assert.equal((await b.session.ready()).ok, false, "제안이 없으면 확정하지 않는다");
    assert.deepEqual(await a.session.leave(), { ok: true });
    c.session.stop();
    assert.deepEqual(await c.session.create(), { ok: false, reason: "stopped" });
    await b.session.leave();
    process.stdout.write("(8) 조작 거절 이유  ok\n");
  } finally {
    a.session.stop();
    b.session.stop();
  }
  process.stdout.write("selftest-trade-net: 통과 (만들기·참가·제안·확정·완료·반영·나가기·오류·거절)\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
