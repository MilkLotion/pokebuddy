// 메뉴 모델 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-menus.js
//
// 포켓몬 메뉴의 모델(src/view/menus.ts petMenuOf)이 개체의 자리(파티·볼 안·박스)와 돌봄 규칙(src/state/care.ts checkCare)대로
// 항목을 켜고 끄는지, 첫 돌봄 튜토리얼 중의 잠금과 대기 글자, 트레이·점프 목록의 항목을 본다.
// 항목의 순서·라벨과 메뉴 창의 모양은 selftest-stage 의 메뉴 절이 본다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { emptySave as empty } from "../../save/normalize";
import type { PetV3, SaveV3 } from "../../shared/save-v3";
import { jumpListOf, petMenuOf, trayMenuOf } from "../../view/menus";
import { moodText, t } from "../../view/text";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();

const pet = (over: Partial<PetV3> = {}): PetV3 => ({
  id: "p1", species: "charmander", shiny: false, nature: "hardy", gender: "male", size: 2,
  level: 1, exp: 0, affinity: 0, affinityProgressMs: 0, fullness: 100, fullnessProgressMs: 0,
  mood: 60, moodProgressMs: 0, feedCooldownMs: 0, playCooldownMs: 0, playWindowMs: 0, playStreak: 0, buffs: [], home: { dx: -24, dy: -60 }, since: T0, stage: 0, evolved: [],
  daily: { date: "2026-09-24", gained: 0, feeds: 0, plays: 0, pokes: 0, presence: 0, work: 0, turns: 0 },
  ...over,
});

function seed(): SaveV3 {
  const s = empty(T0);
  s.pets.push(pet({ id: "p1", species: "pikachu", level: 12, fullness: 55 }));
  s.pets.push(pet({ id: "p2", species: "charmander", fullness: 30, feedCooldownMs: 90_000 }));
  s.pets.push(pet({ id: "p3", species: "squirtle", level: 5 }));
  s.party.slots[0] = { state: "pokemon", petId: "p1", hidden: false };
  s.party.slots[1] = { state: "pokemon", petId: "p2", hidden: true };
  s.boxes[0]!.slots[0] = "p3";
  s.starterPetId = "p1";
  // 첫 돌봄 튜토리얼은 끝낸 것으로 둔다 — (4)절에서 다시 연다
  s.tutorials["first-care"] = { state: "done", steps: 2 };
  return s;
}

const menuOf = (s: SaveV3, id: string, origin: "stage" | "manage" = "manage") => petMenuOf(s, id, { origin, stagePet: origin === "stage" ? s.pets.find((p) => p.id === id) ?? null : null, formIcons: {}, now: Date.now() });

// (1) 파티에 나온 개체 — 상태 줄, 돌봄 켜짐, 볼에 넣기, 옮기기 없음
{
  const r = menuOf(seed(), "p1");
  assert.ok(r);
  assert.equal(r.model.status, `${t("zone.normal")} · ${moodText(60)}`, "상태 줄은 구간 낱말 · 기분 말");
  assert.deepEqual([r.model.feed, r.model.play], [{ enabled: true }, { enabled: true }]);
  assert.deepEqual(r.model.ball, { enabled: true, hidden: false });
  assert.equal(r.model.move, undefined, "옮기기는 박스 개체에만");
  assert.deepEqual([r.inSave, r.hidden, r.firstCare], [true, false, null]);
}

// (2) 볼 안·쿨타임 — 밥 주기는 흐리고 까닭은 남은 시간(메뉴에는 적지 않는다), 볼 줄은 꺼내기
{
  const r = menuOf(seed(), "p2");
  assert.ok(r);
  assert.equal(r.model.feed?.enabled, false);
  assert.ok(r.model.feed?.reason && r.model.feed.reason !== t("care.full"), "쿨타임의 까닭은 남은 시간 글자");
  assert.deepEqual([r.model.ball, r.hidden], [{ enabled: true, hidden: true }, true]);
  const s = seed();
  s.pets[0]!.fullness = 100;
  assert.deepEqual(menuOf(s, "p1")?.model.feed, { enabled: false, reason: t("care.full") }, "배부름");
}

// (3) 박스 개체 — 돌봄·볼은 흐리고(까닭 없음) 옮기기가 있다. 무대 메뉴는 무대에 없는 개체로 만들지 않는다
{
  const r = menuOf(seed(), "p3");
  assert.ok(r);
  assert.deepEqual([r.model.feed, r.model.play, r.model.ball, r.model.move], [{ enabled: false }, { enabled: false }, { enabled: false, hidden: false }, { enabled: true }]);
  assert.equal(petMenuOf(seed(), "p3", { origin: "stage", stagePet: null, formIcons: {}, now: Date.now() }), null);
  assert.equal(menuOf(seed(), "없음"), null);
}

// (4) 첫 돌봄 튜토리얼 — 무대에서 연 메뉴만. 밥 주기를 남기고, 못 하면 놀아주기, 둘 다 못 하면 잠그고 대기 글자
{
  const open = (change: (s: SaveV3) => void = () => undefined) => {
    const s = seed();
    s.tutorials["first-care"] = { state: "none", steps: 0, queuedAt: T0 };
    change(s);
    return s;
  };
  assert.deepEqual(menuOf(open(), "p1", "stage")?.firstCare, { keep: t("menu.feed"), wait: null });
  assert.equal(menuOf(open(), "p1", "manage")?.firstCare, null, "관리 창 메뉴는 튜토리얼과 무관");
  assert.deepEqual(menuOf(open((s) => void (s.pets[0]!.fullness = 100)), "p1", "stage")?.firstCare, { keep: t("menu.play"), wait: null });
  const both = menuOf(open((s) => {
    s.pets[0]!.fullness = 100;
    s.pets[0]!.playCooldownMs = 600_000;
  }), "p1", "stage")?.firstCare;
  assert.equal(both?.keep, null);
  assert.equal(both?.wait, "10분", "놀아주기 쿨타임이면 남은 시간 — waitText 한 벌 (94 항목 5-1)");
  const full = menuOf(open((s) => {
    s.pets[0]!.fullness = 100;
    s.pets[0]!.playCooldownMs = 0;
    s.pets[0]!.playStreak = 0;
  }), "p1", "stage")?.firstCare;
  assert.equal(full?.keep, t("menu.play"), "배부르면 놀아주기를 남긴다");
}

// (5) 트레이 — 맨 위 설정창 열기, 그 아래 트레이 항목. 점프 목록 — 파티 개체(볼 안 포함)와 두 줄의 라벨
{
  const tray = trayMenuOf({ hidden: false, ghost: false }, { openManage: () => undefined, toggleHidden: () => undefined, quit: () => undefined });
  assert.deepEqual(tray.map((m) => m.label ?? m.type), [t("menu.manage"), "separator", t("menu.hide"), t("menu.ghost"), "separator", t("menu.quit")]);
  const jump = jumpListOf(seed());
  assert.deepEqual(jump.pets.map((p) => [p.id, p.level]), [["p1", 12], ["p2", 1]]);
  assert.deepEqual(jump.labels, { feed: t("menu.feed"), play: t("menu.play") });
}

process.stdout.write("selftest-menus: 통과 (파티 개체·볼 안과 쿨타임·박스 개체·첫 돌봄 잠금·트레이와 점프 목록)\n");
