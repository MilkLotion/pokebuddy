// 옛 저장(v2) 파일 만들기 — 자체 검사가 v2 → v3 옮기기를 시험할 때 쓴다. 앱은 v2 파일을 쓰지 않는다(읽어서 옮기기만, src/save/save-file.ts)
import { writeAtomic } from "../../platform/atomic-write";
import type { SaveV2 } from "../../save/v2/types";

// v2 저장을 파일로 — 원자적 쓰기, 성공 여부만
export const writeSaveV2 = (file: string, state: SaveV2): boolean => writeAtomic(file, state);
