// 그림·소리 인스턴스 한 벌 — 앱(무대 말풍선·선택 창·미리 받기·울음소리)과 설정창(초상·기기 창·울음소리)이 같은 것을 쓴다
// (worklog/records/code-structure/design/10-main.md 3.11절 art/services.ts)
//
// 같은 인스턴스라 같은 그림을 두 번 받지 않고, 받는 중인 그림을 함께 기다리고, 메모를 함께 쓴다.
// 앱 안 그림 폴더 — 설치본은 sprites/, 개발 중에는 src/tools/data/fetch-sprites.ts 가 받아 둔 .cache/sprites/ (설치본에는 둘 다 없다 — package.json files)
// 처음 부를 때 만든다
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../platform/paths.js";
import { createCries, type Cries } from "./cries";
import { createPortraits, type Portraits } from "./portraits";

export interface ArtServices {
  portraits: Portraits;
  cries: Cries;
}

const bundledSprites = (): string => {
  const packed = path.join(PATHS.project, "sprites");
  return fs.existsSync(packed) ? packed : path.join(PATHS.project, ".cache", "sprites");
};

let services: ArtServices | null = null;

export function artServices(): ArtServices {
  services ??= {
    portraits: createPortraits(path.join(PATHS.home, "sprites"), bundledSprites()),
    cries: createCries(path.join(PATHS.home, "cries")),
  };
  return services;
}
