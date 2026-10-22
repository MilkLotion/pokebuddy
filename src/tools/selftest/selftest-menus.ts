// 메뉴 모델 자체 확인 — npm run build 뒤 node dist/tools/selftest/selftest-menus.js
//
// 포켓몬 메뉴의 모델(src/view/menus.ts petMenuOf)이 개체의 자리(파티·볼 안·박스)와 돌봄 규칙(src/state/care.ts checkCare)대로
// 항목을 켜고 끄는지, 첫 돌봄 튜토리얼 중의 잠금과 대기 글자, 트레이·점프 목록의 항목을 본다.
// 항목의 순서·라벨과 메뉴 창의 모양은 selftest-stage 의 메뉴 절이 본다.
// 끝에 "통과" 한 줄. 실패하면 어디서 깨졌는지와 함께 종료 코드 1
import assert from "node:assert";
import { emptySave as empty } from "../../save/normalize";
import type { PetV3, SaveV3 } from "../../shared/save-v3";
import { battleMenu, battleMenuOf, petMenu, petMenuOf, trayMenuOf, typeGridOf } from "../../view/menus";
import { FORM_NEED, menuView } from "../../view/menu-view";
import { formsOf } from "../../dex/forms";
import { boredText, t } from "../../view/text";

const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();

const pet = (over: Partial<PetV3> = {}): PetV3 => ({
  id: "p1", species: "charmander", shiny: false, nature: "hardy", gender: "male", size: 2,
  level: 1, exp: 0, affinity: 0, affinityProgressMs: 0, fullness: 100, fullnessProgressMs: 0,
  boredom: 0, boredomProgressMs: 0, feedCooldownMs: 0, playCooldownMs: 0, buffs: [], home: { dx: -24, dy: -60 }, since: T0, stage: 0, evolved: [],
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

// (1) 파티에 나온 개체 — 상태 줄, 돌봄 켜짐, 볼에 넣기. 옮기기는 관리 창에서 연 메뉴에만(2026-10-10)
{
  const r = menuOf(seed(), "p1");
  assert.ok(r);
  assert.equal(r.model.status, `${t("zone.normal")} · ${boredText(null)}`, "상태 줄은 구간 낱말 · 심심함 단계 말");
  assert.deepEqual([r.model.feed, r.model.play], [{ enabled: true }, { enabled: true }]);
  assert.deepEqual(r.model.ball, { enabled: true, hidden: false });
  assert.deepEqual(r.model.move, { enabled: true }, "관리 창에서 연 파티 개체 메뉴 — 옮기기(파티 칸 순서 누르기로)");
  assert.equal(menuOf(seed(), "p1", "stage")?.model.move, undefined, "무대에서 연 파티 개체 메뉴에는 옮기기가 없다");
  assert.deepEqual(r.model.swap, { enabled: true }, "관리 창 메뉴의 파티 개체 — 교체");
  assert.equal(menuOf(seed(), "p1", "stage")?.model.swap, undefined, "무대 메뉴에는 교체가 없다");
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
  assert.deepEqual(r.model.swap, { enabled: true }, "박스 개체 — 옮기기와 교체");
  const rows = petMenu(r.model, { move: () => undefined, swap: () => undefined, sell: () => undefined }).map((m) => m.label ?? m.type);
  assert.deepEqual(rows.slice(1, 5), ["separator", t("menu.move"), t("menu.swap"), "separator"], "이름·상태 / 옮기기·교체 / 구분선 (Figma `Context Menu` Show Swap)");
  const partyRows = petMenu(menuOf(seed(), "p1")!.model, { move: () => undefined, swap: () => undefined }).map((m) => m.label ?? m.type);
  assert.deepEqual(partyRows.slice(1, 5), ["separator", t("menu.move"), t("menu.swap"), "separator"], "관리 창의 파티 개체 — 옮기기·교체 뒤 구분선 (2026-10-10)");
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
  }), "p1", "stage")?.firstCare;
  assert.equal(full?.keep, t("menu.play"), "배부르면 놀아주기를 남긴다");
}

// (5) 트레이 — 맨 위 설정창 열기, 그 아래 트레이 항목
{
  const tray = trayMenuOf({ hidden: false, ghost: false }, { openManage: () => undefined, toggleHidden: () => undefined, quit: () => undefined });
  assert.deepEqual(tray.map((m) => m.label ?? m.type), [t("menu.manage"), "separator", t("menu.hide"), t("menu.ghost"), "separator", t("menu.quit")]);
}

// (6) 로토무 — 작업 시간 조건이 없어 얻자마자 다섯 모습 + 맨 아래 `로토무 · 원래대로` 말풍선 (2026-10-22 사용자 "로토무는 2시간 그거 풀어버리자").
//     카탈로그가 없으면 모습 줄이 흐리지만 누를 수 있다(실패 안내 창). `모습 바꾸기` 줄은 살아 있고 머리 글은 `모습 바꾸기` 만 (2026-10-22, Figma 99 `2107:113348`)
{
  const s = seed();
  s.pets.push(pet({ id: "p4", species: "rotom", level: 20 }));
  s.party.slots[2] = { state: "pokemon", petId: "p4", hidden: false };
  const noBook = menuOf(s, "p4")!.model;
  assert.equal(noBook.formsLocked, undefined, "작업 시간 없이 열려 있다");
  assert.equal(noBook.forms?.length, 6);
  const noBookItem = petMenu(noBook, { form: () => undefined }).find((m) => m.label === t("menu.form"));
  assert.equal(noBookItem?.enabled !== false, true, "카탈로그가 없어도 `모습 바꾸기` 줄은 누를 수 있다");
  assert.equal(noBookItem?.toolTip, t("menu.form"), "도구가 없으면 머리 글은 `모습 바꾸기` 만");
  const noBookRows = Array.isArray(noBookItem?.submenu) ? noBookItem.submenu : [];
  assert.deepEqual(noBookRows.map((r) => [r.enabled, r.id]), [[true, FORM_NEED], [true, FORM_NEED], [true, FORM_NEED], [true, FORM_NEED], [true, FORM_NEED], [false, undefined]], "다섯 모습은 흐리지만 누르고(form-need), 지금 로토무는 누를 수 없다");
  const dimView = menuView(petMenu(noBook, { form: () => undefined }), "켜짐").find((r) => r.kind === "item" && r.label === t("menu.form"));
  assert.deepEqual(dimView?.kind === "item" ? dimView.sub?.rows.map((r) => [r.dim === true, r.disabled]) : null, [[true, false], [true, false], [true, false], [true, false], [true, false], [false, true]], "메뉴 창에서는 dim 으로 그린다");
  s.bag["rotom-catalog"] = 1;
  const open = menuOf(s, "p4")!.model;
  const openItem = petMenu(open, { form: () => undefined }).find((m) => m.label === t("menu.form"));
  const rows = Array.isArray(openItem?.submenu) ? openItem.submenu : [];
  assert.equal(openItem?.toolTip, t("menu.form"), "카탈로그가 있어도 머리 글은 `모습 바꾸기` 만 (2026-10-22)");
  assert.deepEqual(rows.map((r) => r.label), ["히트로토무", "워시로토무", "프로스트로토무", "스핀로토무", "커트로토무", "로토무"], "다섯 모습 다음 맨 아래 로토무");
  assert.deepEqual(rows.map((r) => r.sublabel), [t("menu.form.go"), t("menu.form.go"), t("menu.form.go"), t("menu.form.go"), t("menu.form.go"), t("menu.form.now")]);
  // 다른 모습이면 맨 아래 줄은 `원래대로`, 카탈로그가 없어도 누를 수 있다
  s.pets.find((p) => p.id === "p4")!.species = "rotom-heat";
  delete s.bag["rotom-catalog"];
  const heat = petMenu(menuOf(s, "p4")!.model, { form: () => undefined }).find((m) => m.label === t("menu.form"));
  const heatRows = Array.isArray(heat?.submenu) ? heat.submenu : [];
  assert.equal(heat?.enabled !== false, true, "줄이 살아 있다");
  assert.deepEqual(heatRows.map((r) => [r.enabled, r.id]), [[false, undefined], [true, FORM_NEED], [true, FORM_NEED], [true, FORM_NEED], [true, FORM_NEED], [true, undefined]], "지금 모습만 누를 수 없고, 카탈로그 없는 모습은 흐린 채 누르며, 원래대로는 그냥 누른다");
  assert.equal(heatRows[5]?.sublabel, t("menu.form.back"));
  assert.equal(menuOf(s, "p1")!.model.forms?.length ?? 0, 0, "모습이 없는 종은 줄이 없다");
}

// (7) 한 방향 모습 바꾸기 — 플라엣테의 말풍선은 플라엣테(영원의 꽃) 한 줄. 머리는 늘 "모습 바꾸기". 도구가 없으면 흐린 줄(누르면 실패 안내 창).
//     바뀐 개체(플라엣테(영원의 꽃))에는 "모습 바꾸기" 줄이 없다 (2026-10-08 사용자 결정·지시 "모습바꾸기 말풍선에 플라엣테(영원의 꽃) 만 있어야지")
{
  const s = seed();
  s.pets.push(pet({ id: "p5", species: "floette", level: 30 }));
  s.party.slots[2] = { state: "pokemon", petId: "p5", hidden: false };
  const none = petMenu(menuOf(s, "p5")!.model, { form: () => undefined }).find((m) => m.label === t("menu.form"));
  assert.equal(none?.enabled !== false, true, "영원의 꽃이 없어도 줄은 누를 수 있다 (2026-10-22)");
  assert.equal(none?.toolTip, "모습 바꾸기", "도구가 없으면 `· 영원의 꽃 1개를 써요` 를 적지 않는다");
  const noneRows = Array.isArray(none?.submenu) ? none.submenu : [];
  assert.deepEqual(noneRows.map((r) => [r.label, r.enabled, r.id]), [["플라엣테(영원의 꽃)", true, FORM_NEED]], "흐린 채 누르는 한 줄");
  s.bag["eternal-flower"] = 1;
  const item = petMenu(menuOf(s, "p5")!.model, { form: () => undefined }).find((m) => m.label === t("menu.form"));
  const rows = Array.isArray(item?.submenu) ? item.submenu : [];
  assert.equal(item?.toolTip, "모습 바꾸기", "영원의 꽃이 있어도 도구 수를 적지 않는다 (2026-10-22)");
  assert.deepEqual(rows.map((r) => [r.label, r.sublabel, r.enabled]), [["플라엣테(영원의 꽃)", t("menu.form.go"), true]], "바뀔 모습 한 줄 — 지금 모습·원래대로 줄이 없다");
  s.pets.find((p) => p.id === "p5")!.species = "floette-eternal";
  assert.equal(petMenu(menuOf(s, "p5")!.model, { form: () => undefined }).some((m) => m.label === t("menu.form")), false, "바뀐 개체에는 모습 바꾸기 줄이 없다");
}

// (8) 배틀 파티 칸 메뉴 — 바꾸기·빼기, 모습이 있으면 모습 바꾸기(배틀 파티 모습만, 도구 없음). 짝이 없는 모습은 흐리다. 한 방향 묶음은 줄이 없다
//     (2026-10-09 사용자 결정 "우클릭메뉴에 모습바꾸기같은거 넣어야해", "기존에 해금했으면 되게")
{
  const s = seed();
  s.pets.push(pet({ id: "p6", species: "kyurem", level: 60 }), pet({ id: "p7", species: "floette", level: 30 }), pet({ id: "p8", species: "zekrom", level: 60 }));
  s.battle = { ...(s.battle ?? {}), slots: ["p6", "p7", null, null, null, null] } as SaveV3["battle"];
  const noop = { move: () => undefined, change: () => undefined, clear: () => undefined, form: () => undefined, need: () => undefined };
  const k = battleMenu(battleMenuOf(s, 0)!, noop);
  assert.deepEqual(k.filter((m) => m.type !== "separator").map((m) => m.label).slice(1), [t("menu.move"), t("menu.battle.change"), t("menu.battle.clear"), t("menu.form")], "옮기기·바꾸기·빼기·모습 바꾸기");
  const kRows = (k.find((m) => m.label === t("menu.form"))?.submenu ?? []) as { label?: string; enabled?: boolean; sublabel?: string }[];
  assert.deepEqual(kRows.map((r) => [r.label, r.sublabel, r.enabled]), [["큐레무", t("menu.form.now"), false], ["블랙큐레무", t("menu.form.go"), true], ["화이트큐레무", t("menu.form.go"), true]], "제크로무가 있으면 블랙큐레무, 레시라무가 없는 화이트는 흐린 채 누른다");
  const asked: string[] = [];
  const kNeed = battleMenu(battleMenuOf(s, 0)!, { ...noop, form: () => asked.push("form"), need: (sp) => asked.push(`need:${sp}`) });
  const kNeedRows = (kNeed.find((m) => m.label === t("menu.form"))?.submenu ?? []) as { click?: () => void }[];
  kNeedRows[2]?.click?.();
  kNeedRows[1]?.click?.();
  assert.deepEqual(asked, ["need:kyurem-white", "form"], "흐린 줄은 실패 안내(need), 나머지는 배틀 파티 모습 바꾸기");
  s.battle!.forms = { p6: "kyurem-black" };
  assert.equal(battleMenuOf(s, 0)!.name, "블랙큐레무", "이름은 배틀 파티의 모습");
  assert.equal(battleMenu(battleMenuOf(s, 1)!, noop).some((m) => m.label === t("menu.form")), false, "한 방향 묶음(플라엣테)은 도구를 써야 해서 줄이 없다");
}

// (9) 타입 모습 격자 — 아르세우스·실버디는 18 모습이 모두 단일 타입이라 말풍선이 타입 아이콘 칸 6×3 이다. 머리 줄이 없다.
//     칸의 그림은 타입 아이콘(`type:<타입>`), 순서는 상성표 순서(노말·격투·비행 …) (2026-10-18 사용자 "진행")
{
  const order = ["normal", "fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel", "fire", "water", "grass", "electric", "psychic", "ice", "dragon", "dark", "fairy"];
  for (const base of ["arceus", "silvally"]) assert.deepEqual(typeGridOf(formsOf(pet({ species: base })))?.types, order, `${base} — 18 타입 격자, 상성표 순서`);
  assert.equal(typeGridOf(formsOf(pet({ species: "rotom" }))), null, "로토무는 격자가 아니다");
  assert.equal(typeGridOf(formsOf(pet({ species: "oricorio" }))), null, "모습이 없거나 18개가 아니면 격자가 아니다");
  const s = seed();
  s.pets.push(pet({ id: "p9", species: "arceus-fire", level: 60 }));
  s.party.slots[2] = { state: "pokemon", petId: "p9", hidden: false };
  const icons = Object.fromEntries(order.map((type) => [`type:${type}`, `data:${type}`]));
  const model = petMenuOf(s, "p9", { origin: "manage", stagePet: null, formIcons: icons, now: Date.now() })!.model;
  const item = petMenu(model, { form: () => undefined }).find((m) => m.label === t("menu.form"));
  assert.equal(item?.toolTip, t("menu.form"), "격자 말풍선도 머리 글 `모습 바꾸기` (2026-10-23 사용자 확정)");
  const view = menuView(petMenu(model, { form: () => undefined }), "켜짐").find((v) => v.kind === "item" && v.label === t("menu.form"));
  const sub = view?.kind === "item" ? view.sub : undefined;
  assert.equal(sub?.grid, true, "격자 말풍선");
  assert.equal(sub?.title, "모습 바꾸기", "머리 줄");
  assert.deepEqual(sub?.rows.map((r) => r.type), order, "칸마다 타입");
  assert.equal(sub?.rows[9]?.icon, "data:fire", "칸 그림은 타입 아이콘");
  assert.deepEqual([sub?.rows[9]?.current, sub?.rows[9]?.disabled, sub?.rows[0]?.disabled], [true, true, false], "지금 모습(불꽃) 칸은 누를 수 없다");
  // 배틀 파티 칸 메뉴도 같은 격자
  s.battle = { ...(s.battle ?? {}), slots: ["p9", null, null, null, null, null] } as SaveV3["battle"];
  const b = menuView(battleMenu(battleMenuOf(s, 0, icons)!, { move: () => undefined, change: () => undefined, clear: () => undefined, form: () => undefined, need: () => undefined }), "켜짐").find((v) => v.kind === "item" && v.label === t("menu.form"));
  assert.equal(b?.kind === "item" && b.sub?.grid, true, "배틀 파티 칸 메뉴도 격자");
  assert.equal(b?.kind === "item" ? b.sub?.title : null, "모습 바꾸기", "배틀 파티 칸 메뉴도 머리 줄");
  // 격자가 아닌 말풍선도 머리 줄이 있다 — 모든 모습 말풍선 (2026-10-23)
  s.pets.push(pet({ id: "p10", species: "solgaleo", evolved: ["cosmog", "cosmoem"] }));
  const plain = menuView(petMenu(menuOf(s, "p10")!.model, { form: () => undefined }), "켜짐").find((v) => v.kind === "item" && v.label === t("menu.form"));
  assert.deepEqual(plain?.kind === "item" ? [plain.sub?.title, plain.sub?.grid] : null, ["모습 바꾸기", undefined], "공유 계열 말풍선 — 머리 줄 `모습 바꾸기`, 줄 목록");
}

process.stdout.write("selftest-menus: 통과 (파티 개체·볼 안과 쿨타임·박스 개체·첫 돌봄 잠금·트레이·로토무 모습 잠금·배틀 파티 칸·타입 모습 격자)\n");
