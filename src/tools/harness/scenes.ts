// 실기·화면 검사용 장면 — 저장을 확인할 장면에 맞게 고친다. 개발 실행기(dev-test·dev-manage)와 A/B 화면 값 비교(models-dump.cjs)가 같이 쓴다
// (예전 src/tools/dev/dev-test.ts 의 장면 부분. 도구 레인 H0 에서 공용 틀로 옮겼다. 본문은 줄 그대로다)
import type { MegaV3, SaveV3 } from "../../shared/save-v3";
import { rollGender } from "../../dex/gender";
import { expForLevel, growthOf } from "../../dex/growth";
import { randomNature } from "../../dex/natures";
import { addToBox } from "../../box/slots";
import { newPet, nextPetId } from "../../party/create";
import { applyStarter } from "../../party/starter";
import { recordDex } from "../../dex/record";
import { MEGA_RULES } from "../../dex/rules";
import { newEgg } from "../../egg/pool";
import { SCREEN_TUTORIALS, TUTORIALS } from "../../tutorial/conditions";

export const SCENE_RULES = {
  starter: "charmander", // 저장이 없을 때 첫 포켓몬
  extra: "pikachu", // 파티 장면에서 새로 얻은 개체
  points: 1000, // 상점 장면의 포인트 하한
  achievement: "show-two", // 업적 장면에서 달성으로 적는 업적
};

// ── 장면 ───────────────────────────────────────────────────────────────────────
// 튜토리얼 장면은 그 튜토리얼 앞의 것을 완료로, 그 튜토리얼과 뒤의 것을 미시작으로 둔다. 시작 조건은 앱이 다음 틱에 다시 본다
function tutorialsFrom(save: SaveV3, id: string): void {
  const at = TUTORIALS.findIndex((t) => t.id === id);
  save.tutorials = {};
  TUTORIALS.forEach((t, i) => {
    if (i < at) save.tutorials[t.id] = { state: "done", steps: 0 };
  });
}

function ensureStarter(save: SaveV3, now: number): void {
  if (save.pets.length) return;
  applyStarter(save, SCENE_RULES.starter, now, Math.random);
}

function addHiddenPet(save: SaveV3, now: number): void {
  let slot = save.party.slots.findIndex((s) => s.state === "empty");
  if (slot < 0) {
    slot = save.party.slots.findIndex((s) => s.state === "locked");
    if (slot < 0) throw new Error("파티에 넣을 칸이 없다");
  }
  const id = nextPetId(save);
  const species = save.dex.unlocked.find((s) => !save.pets.some((p) => p.species === s)) ?? SCENE_RULES.extra;
  save.pets.push(newPet({ id, species, shiny: false, nature: randomNature(Math.random).id, gender: rollGender(species, Math.random), now }));
  save.party.slots[slot] = { state: "pokemon", petId: id, hidden: true }; // 숨긴 채로 — 파티 튜토리얼(지금 꺼짐, src/tutorial/queue.ts)을 다시 켤 때 확인용
  recordDex(save, species, false);
}

type Scene = (save: SaveV3, now: number) => void;

// showcase 장면의 내용 — [종, 레벨, 친밀도, 이로치]
const SHOWCASE: { points: number; bagCount: number; party: [string, number, number, boolean?][]; box: [string, number, number, boolean?][]; bag: string[] } = {
  points: 50000,
  bagCount: 20,
  party: [["pikachu", 24, 120], ["gimmighoul", 12, 60], ["eevee", 18, 200]],
  box: [
    // PMD 그림이 없어 대체 그림으로 서는 종 (src/main/art/overworld-art.ts)
    ["rolycoly", 8, 30], ["maschiff", 15, 40], ["amoonguss", 40, 80], ["gimmighoul", 5, 10, true],
    // 리전폼
    ["vulpix-alola", 10, 50], ["raichu-alola", 30, 90],
    // 진화 조건이 다른 종 — 레벨 · 돌 · 친밀도 · 교환
    ["dratini", 29, 70], ["magikarp", 19, 20], ["growlithe", 20, 60], ["togepi", 6, 210], ["gastly", 24, 30], ["riolu", 12, 150],
    ["ralts", 19, 40], ["larvitar", 54, 100], ["snorlax", 35, 110], ["mimikyu", 22, 45], ["rotom", 17, 25], ["eevee", 9, 15, true],
  ],
  bag: [
    "basic-food", "premium-food", "toy", "exp-candy-xs", "exp-candy-s", "exp-candy-m", "exp-candy-l", "exp-candy-xl", "rare-candy", "shiny-potion", "normal-potion",
    "fire-stone", "water-stone", "thunder-stone", "leaf-stone", "ice-stone", "moon-stone", "sun-stone", "dusk-stone", "dawn-stone", "shiny-stone", "bond-cord", "region-map",
  ],
};

export const SCENES: Record<string, { note: string; apply: Scene }> = {
  tutorials: { note: "튜토리얼 기록만 비운다(나머지 진행은 그대로)", apply: (s) => void (s.tutorials = {}) },
  "first-care": {
    note: "바탕화면 첫 돌봄 — 밥·놀아주기 기록을 0 으로",
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "first-care");
      s.totals.fed = 0;
      s.totals.played = 0;
    },
  },
  shop: {
    note: "관리 창 상점 — 알을 산 적 없고 포인트가 넉넉하다",
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "shop");
      s.eggs = [];
      s.eggSeq = 0;
      s.points.balance = Math.max(s.points.balance, SCENE_RULES.points);
    },
  },
  hatch: {
    note: "관리 창 부화 — 준비된 랜덤알 하나",
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "hatch");
      const egg = newEgg(s, "random", now);
      egg.remainMs = 0;
      egg.ready = true;
      s.eggs.push(egg);
    },
  },
  party: {
    note: "관리 창 파티 — 숨긴 채 파티 칸에 든 새 개체 하나",
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "party");
      s.eggs = s.eggs.filter((e) => e.kind !== "random");
      addHiddenPet(s, now);
    },
  },
  achievement: {
    note: `관리 창 업적 — ${SCENE_RULES.achievement} 달성, 받지 않음. 받은 업적 기록은 지운다`,
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "achievement");
      for (const row of Object.values(s.achievements)) row.claimedAt = null;
      s.achievements[SCENE_RULES.achievement] = { achievedAt: now, claimedAt: null };
    },
  },
  playground: {
    note: "바탕화면 놀이공간 — 첫 돌봄을 마쳤고 놀이공간은 주 화면",
    apply: (s, now) => {
      ensureStarter(s, now);
      tutorialsFrom(s, "playground");
      s.settings.playArea = { mode: "screen", rect: null, screen: null };
    },
  },
  "done-all": {
    note: "튜토리얼을 모두 완료로 — 튜토리얼 없이 다른 화면을 확인할 때",
    apply: (s) => {
      s.tutorials = {};
      // 대기열 밖(개체 상세·화면을 처음 열 때)도 끝낸다
      for (const id of [...TUTORIALS.map((t) => t.id), "detail", ...SCREEN_TUTORIALS]) s.tutorials[id] = { state: "done", steps: 0 };
    },
  },
  box: {
    note: "박스 정렬·끌기 — 레벨·친밀도가 다른 개체 8마리를 박스에 넣는다",
    apply: (s, now) => {
      ensureStarter(s, now);
      const rows: [string, number, number][] = [["bulbasaur", 9, 20], ["squirtle", 14, 60], ["eevee", 7, 80], ["machop", 21, 10], ["pichu", 3, 40], ["totodile", 18, 5], ["mudkip", 11, 90], ["riolu", 25, 30]];
      rows.forEach(([species, level, affinity], i) => {
        const pet = newPet({ id: nextPetId(s), species, shiny: false, nature: randomNature(Math.random).id, gender: rollGender(species, Math.random), now: now - (rows.length - i) * 60_000 });
        pet.level = level;
        pet.affinity = affinity;
        s.pets.push(pet);
        addToBox(s.boxes, pet.id);
        recordDex(s, species, false);
      });
    },
  },
  boxes: {
    note: "박스 넘기기·가득 참 — 박스를 모두 비우고 첫 박스 30칸을 채운 뒤 둘째 박스에 3마리",
    apply: (s, now) => {
      ensureStarter(s, now);
      const inBox = new Set(s.boxes.flatMap((b) => b.slots).filter((id): id is string => id != null));
      s.pets = s.pets.filter((p) => !inBox.has(p.id));
      for (const b of s.boxes) b.slots = b.slots.map(() => null);
      const kinds = ["bulbasaur", "charmander", "squirtle", "pikachu", "eevee", "machop", "pichu", "totodile", "mudkip", "riolu"];
      for (let i = 0; i < 33; i++) {
        const species = kinds[i % kinds.length] ?? "pikachu";
        const pet = newPet({ id: nextPetId(s), species, shiny: false, nature: randomNature(Math.random).id, gender: rollGender(species, Math.random), now: now - (33 - i) * 60_000 });
        pet.level = 1 + ((i * 7) % 40);
        s.pets.push(pet);
        addToBox(s.boxes, pet.id);
        recordDex(s, species, false);
      }
    },
  },
  showcase: {
    note: "시험 계정용 — 튜토리얼 완료, 파티 4칸, 박스에 여러 종(대체 그림 종·리전폼·이로치 포함), 도구 전 종류, 준비된 알, 포인트 넉넉히",
    apply: (s, now) => {
      ensureStarter(s, now);
      applyScene(s, "done-all", now);
      s.points.balance = Math.max(s.points.balance, SHOWCASE.points);
      const add = (species: string, level: number, affinity: number, shiny = false): string => {
        const pet = newPet({ id: nextPetId(s), species, shiny, nature: randomNature(Math.random).id, gender: rollGender(species, Math.random), now });
        pet.level = level;
        pet.exp = expForLevel(growthOf(species), level); // 레벨만 올리면 서버 검증의 level 규칙에 걸린다(레벨 ≤ 경험치가 허락하는 레벨)
        pet.affinity = affinity;
        s.pets.push(pet);
        recordDex(s, species, shiny);
        return pet.id;
      };
      // 파티 — 상점 칸 둘을 열고 보이는 채로 채운다. 이미 든 칸은 그대로 둔다
      const party = [...SHOWCASE.party];
      s.party.slots = s.party.slots.map((slot) => {
        if (slot.state === "pokemon") return slot;
        if (slot.state === "locked" && slot.unlockBy !== "shop") return slot;
        const next = party.shift();
        return next ? { state: "pokemon", petId: add(...next), hidden: false } : { state: "empty" };
      });
      for (const row of SHOWCASE.box) addToBox(s.boxes, add(...row));
      for (const id of SHOWCASE.bag) s.bag[id] = Math.max(s.bag[id] ?? 0, SHOWCASE.bagCount);
      if (!s.eggs.some((e) => e.ready)) {
        const egg = newEgg(s, "random", now);
        egg.remainMs = 0;
        egg.ready = true;
        s.eggs.push(egg);
      }
    },
  },
  mega: {
    note: "메가진화 — 파티에 메가스톤을 지닌 리자몽(기본 모습)·팬텀(메가 모습)과 조건 직전의 루카리오, 박스에 메가스톤을 지닌 뮤츠·거북왕",
    apply: (s, now) => {
      ensureStarter(s, now);
      applyScene(s, "done-all", now);
      const full = { bondMs: MEGA_RULES.bondMs, care: MEGA_RULES.care };
      const add = (species: string, level: number, mega: MegaV3): string => {
        const pet = newPet({ id: nextPetId(s), species, shiny: false, nature: randomNature(Math.random).id, gender: rollGender(species, Math.random), now });
        pet.level = level;
        pet.exp = expForLevel(growthOf(species), level);
        pet.affinity = 100;
        pet.mega = mega;
        s.pets.push(pet);
        recordDex(s, species, false);
        if (mega.stone && !(s.dex.megaOpened ??= []).includes(species)) s.dex.megaOpened.push(species);
        return pet.id;
      };
      // 파티 — 빈 칸, 그다음 잠긴 칸에 차례로 넣는다. 루카리오는 돌봄 한 번이면 메가스톤이 생긴다(배너 확인용)
      const party = [add("charizard", 62, { ...full, stone: true }), add("gengar", 60, { ...full, stone: true, on: "gengar-mega" }), add("lucario", 60, { bondMs: full.bondMs, care: full.care - 1 })];
      for (const petId of party) {
        const at = s.party.slots.findIndex((slot) => slot.state === "empty");
        const i = at >= 0 ? at : s.party.slots.findIndex((slot) => slot.state === "locked");
        if (i >= 0) s.party.slots[i] = { state: "pokemon", petId, hidden: false };
        else addToBox(s.boxes, petId);
      }
      addToBox(s.boxes, add("mewtwo", 70, { ...full, stone: true }));
      addToBox(s.boxes, add("blastoise", 60, { ...full, stone: true }));
    },
  },
  "mega-free": {
    note: "한 마리 제한 밖의 모습 — 메가스톤을 지닌 그란돈·레쿠쟈를 파티의 빈 칸이나 잠긴 칸에 넣는다(mega 장면 뒤에 쓴다)",
    apply: (s, now) => {
      ensureStarter(s, now);
      const full = { bondMs: MEGA_RULES.bondMs, care: MEGA_RULES.care, stone: true as const };
      for (const species of ["groudon", "rayquaza"]) {
        const pet = newPet({ id: nextPetId(s), species, shiny: false, nature: randomNature(Math.random).id, gender: rollGender(species, Math.random), now });
        pet.level = 70;
        pet.exp = expForLevel(growthOf(species), 70);
        pet.affinity = 100;
        pet.mega = { ...full };
        s.pets.push(pet);
        recordDex(s, species, false);
        if (!(s.dex.megaOpened ??= []).includes(species)) s.dex.megaOpened.push(species);
        const at = s.party.slots.findIndex((slot) => slot.state === "empty");
        const i = at >= 0 ? at : s.party.slots.findIndex((slot) => slot.state === "locked");
        if (i >= 0) s.party.slots[i] = { state: "pokemon", petId: pet.id, hidden: false };
        else addToBox(s.boxes, pet.id);
      }
    },
  },
  forms: {
    note: "특수 폼 — 파티에 진화 직전의 암멍이·치고마·일레즌과 기라티나·플라엣테(영원의 꽃)·대쓰여너 암컷, 박스에 디아루가·펄기아(모습 바꾸기)와 나머지 특수 폼, 배쓰나이만 나오는 알 셋",
    apply: (s, now) => {
      ensureStarter(s, now);
      applyScene(s, "done-all", now);
      // [종, 레벨, 친밀도, 성별(정할 때만)]
      type Row = [string, number, number, ("male" | "female")?];
      const add = ([species, level, affinity, gender]: Row): string => {
        const pet = newPet({ id: nextPetId(s), species, shiny: false, nature: randomNature(Math.random).id, gender: gender ?? rollGender(species, Math.random), now });
        pet.level = level;
        pet.exp = expForLevel(growthOf(species), level);
        pet.affinity = affinity;
        s.pets.push(pet);
        recordDex(s, species, false);
        return pet.id;
      };
      // 파티 — 암멍이는 Lv.25·친밀도 100 이라 낮밤의 종과 황혼이 함께 후보다. 치고마는 족자, 기라티나는 모습 바꾸기
      const party: Row[] = [["rockruff", 25, 100], ["kubfu", 30, 60], ["toxel", 30, 60], ["giratina", 50, 80], ["floette-eternal", 60, 100], ["basculegion", 40, 80, "female"]];
      for (const row of party) {
        const petId = add(row);
        const at = s.party.slots.findIndex((slot) => slot.state === "empty");
        const i = at >= 0 ? at : s.party.slots.findIndex((slot) => slot.state === "locked");
        if (i >= 0) s.party.slots[i] = { state: "pokemon", petId, hidden: false };
        else addToBox(s.boxes, petId);
      }
      const box: Row[] = [
        ["basculin", 20, 100], ["basculin-blue-striped", 20, 100], ["basculin-white-striped", 20, 100], ["basculegion", 40, 80, "male"],
        ["dialga", 50, 80], ["palkia", 50, 80], ["ursaluna-bloodmoon", 50, 80],
        ["lycanroc", 30, 60], ["lycanroc-midnight", 30, 60], ["lycanroc-dusk", 30, 60], ["toxtricity", 35, 60], ["toxtricity-low-key", 35, 60],
        ["magearna-original", 50, 80], ["pichu-spiky-eared", 10, 60],
      ];
      for (const row of box) addToBox(s.boxes, add(row));
      // 플라엣테(영원의 꽃)는 메가스톤을 지닌다 — 메가플라엣테는 이 종만 된다
      const eternal = s.pets.find((p) => p.species === "floette-eternal" && !p.mega?.stone);
      if (eternal) {
        eternal.mega = { bondMs: MEGA_RULES.bondMs, care: MEGA_RULES.care, stone: true };
        if (!(s.dex.megaOpened ??= []).includes("floette-eternal")) s.dex.megaOpened.push("floette-eternal");
      }
      s.bag["scroll-of-darkness"] = Math.max(s.bag["scroll-of-darkness"] ?? 0, 2);
      s.points.balance = Math.max(s.points.balance, SCENE_RULES.points * 10);
      // 배쓰나이만 나오는 알 — 열 때마다 적색근 45 · 청색근 45 · 백색근 10 으로 모습이 정해진다
      for (let i = s.eggs.filter((e) => e.ready).length; i < 3; i++) {
        const egg = newEgg(s, "random", now);
        egg.candidates = ["basculin"];
        egg.remainMs = 0;
        egg.ready = true;
        s.eggs.push(egg);
      }
    },
  },
  presets: {
    note: "프리셋 전체보기 — showcase 에 프리셋 5개(가득·일부·빈 칸·잠긴 칸)와 이름 하나를 더한다",
    apply: (s, now) => {
      applyScene(s, "showcase", now);
      const add = (species: string, level: number): string => {
        const pet = newPet({ id: nextPetId(s), species, shiny: false, nature: randomNature(Math.random).id, gender: rollGender(species, Math.random), now });
        pet.level = level;
        pet.exp = expForLevel(growthOf(species), level);
        s.pets.push(pet);
        recordDex(s, species, false);
        return pet.id;
      };
      const row = (species: string[], open: number): SaveV3["party"]["slots"] =>
        Array.from({ length: 6 }, (_, i) => {
          const sp = species[i];
          if (sp) return { state: "pokemon" as const, petId: add(sp, 10 + i * 3) };
          return i < open ? { state: "empty" as const } : { state: "locked" as const, unlockBy: "shop" as const };
        });
      s.party.active = 0;
      s.party.presetCount = 5;
      s.party.presets = [null, row(["eevee", "squirtle", "charmander", "bulbasaur"], 6), row(["mew", "dragonite"], 4), row([], 2), row(["garchomp"], 2)];
      s.party.presetNames = ["", "산책 파티", "", "", ""];
    },
  },
  rich: { note: `포인트를 ${SCENE_RULES.points * 10} 이상으로`, apply: (s) => void (s.points.balance = Math.max(s.points.balance, SCENE_RULES.points * 10)) },
  "calyrex-reins": {
    note: "버드렉스의 말 부르기 — 파티 첫 칸에 버드렉스 Lv.70, 가방에 유대의고삐 1개 (bugs-1007 항목 2)",
    apply: (s, now) => {
      applyScene(s, "showcase", now);
      const pet = newPet({ id: nextPetId(s), species: "calyrex", shiny: false, nature: randomNature(Math.random).id, gender: rollGender("calyrex", Math.random), now });
      pet.level = 70;
      pet.exp = expForLevel(growthOf("calyrex"), 70);
      s.pets.push(pet);
      recordDex(s, "calyrex", false);
      s.party.slots[0] = { state: "pokemon", petId: pet.id, hidden: false };
      s.bag["reins-of-unity"] = 1;
    },
  },
};

export function applyScene(save: SaveV3, name: string, now = Date.now()): SaveV3 {
  const scene = SCENES[name];
  if (!scene) throw new Error(`모르는 장면: ${name}`);
  scene.apply(save, now);
  return save;
}
