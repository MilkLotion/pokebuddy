// 실기 확인 전용 — 지정 HOME 아래 .claude/pokebuddy/save.json 을 저장 v3 로 만든다 (마리 수만큼, 집은 60px 씩 벌림 또는 --same-home 이면 전부 기본값)
//   node dist/tools/dev-save.js <HOME> <종>[,<종>…] [--same-home]
// 앞에서부터 파티 칸에 꺼내 놓는다. 잠긴 칸도 연다. 파티 칸 수(6)를 넘는 마리는 자른다. 진짜 ~/.claude/pokebuddy/ 는 건드리지 않는다 — HOME 을 꼭 준다
import fs from "node:fs";
import path from "node:path";
import { rollGender } from "../dex/gender";
import { randomNature } from "../dex/natures";
import { newPet, recordDex } from "../party/create";
import { SAVE_V3_RULES } from "../save/rules";
import * as store from "../save/store";
import { empty } from "../save/v3";
import type { SaveV3 } from "../shared/save-v3";

export interface DevSaveOptions {
  sameHome?: boolean;
  now?: number;
  rng?: () => number;
  spreadPx?: number; // 마리마다 왼쪽으로 벌리는 간격
}

export const DEV_SAVE_RULES = { spreadPx: 60 };

// HOME → save.json 경로 (config.js PATHS 와 같은 규칙)
export const devSaveFile = (home: string): string => path.join(home, ".claude", "pokebuddy", "save.json");

export function devSaveState(speciesList: string[], opts: DevSaveOptions = {}): SaveV3 {
  const now = opts.now ?? Date.now();
  const rng = opts.rng ?? Math.random;
  const spread = opts.spreadPx ?? DEV_SAVE_RULES.spreadPx;
  const list = speciesList.filter(Boolean).slice(0, SAVE_V3_RULES.party.total);
  const save = empty(now);
  list.forEach((species, i) => {
    const id = `p${i + 1}`;
    const pet = newPet({ id, species, shiny: false, nature: randomNature(rng).id, gender: rollGender(species, rng), now });
    if (!opts.sameHome) pet.home = { dx: SAVE_V3_RULES.pet.home.dx - spread * i, dy: SAVE_V3_RULES.pet.home.dy };
    save.pets.push(pet);
    save.party.slots[i] = { state: "pokemon", petId: id, hidden: false };
    recordDex(save, species, false);
  });
  save.starterPetId = save.pets[0]?.id ?? null;
  return save;
}

export function devSave(home: string, speciesList: string[], opts: DevSaveOptions = {}): { file: string; save: SaveV3 } {
  const file = devSaveFile(home);
  const save = devSaveState(speciesList, opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!store.write(file, save)) throw new Error(`쓰지 못함: ${file}`);
  return { file, save };
}

function main(argv: string[]): void {
  const args = argv.filter((a) => !a.startsWith("--"));
  const sameHome = argv.includes("--same-home");
  const [home, species] = args;
  if (!home || !species) {
    process.stderr.write("사용법: node dist/tools/dev-save.js <HOME> <종>[,<종>…] [--same-home]\n");
    process.exit(2);
  }
  const { file, save } = devSave(path.resolve(home), species.split(","), { sameHome });
  process.stdout.write(`${file}\n${save.pets.map((p) => `${p.id} ${p.species} ${p.nature} home=${p.home.dx},${p.home.dy}`).join("\n")}\n`);
  if (!fs.existsSync(path.join(path.resolve(home), ".claude", "pokebuddy", "pmd"))) {
    process.stderr.write("참고: pmd 캐시가 없다 — 실기에서 그림을 네트워크로 받는다 (~/.claude/pokebuddy/pmd/*.zip 을 복사해 두면 빠르다)\n");
  }
}

if (require.main === module) main(process.argv.slice(2));
