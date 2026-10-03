// 부팅 단계 가운데 앱 전역을 쓰지 않는 것 (worklog/records/code-structure/design/10-main.md 3.13절 app/boot.ts, 4.1절)
//
// 4단계 저장 키 — 저장 읽기·쓰기가 이 키로 암호화한다 (src/save/key.ts). 기존 평문 저장은 여기서 한 번 옮긴다.
// 비동기 safeStorage 만 쓴다 — mac 은 키체인 허용 창이 뜨면 동기 호출이 메인을 멈춘다(src/main/trade.ts 와 같은 이유)
import { safeStorage } from "electron";
import { prepareSaveKey, setAsideKeyAndSave, type PrepareSaveKeyOptions } from "../../save/key";
import { isSealedOnDisk } from "../../save/save-file";
import type { DebugLog } from "./log";

export interface SaveKeyDeps {
  saveFile: string;
  // 새 키를 만들어도 되는가 — 개발 실행·업데이트 시험 빌드만 POKEBUDDY_SAVE_CRYPT=off 로 새 키를 만들지 않는다(저장을 직접 읽는 E2E 용).
  // 이미 키가 있으면 그대로 쓴다
  create: boolean;
  askLocked(): Promise<"quit" | "fresh">; // 잠긴 저장 창 — 종료·새로 시작
  onLocked(): void; // 종료를 골랐거나 백업을 못 했다 — 실패를 알리고 끝낸다
  log: DebugLog;
}

// 저장 키를 준비한다. 끝내야 하면 onLocked 를 부르고 false
export async function bootSaveKey(deps: SaveKeyDeps): Promise<boolean> {
  const keyOptions: PrepareSaveKeyOptions = {
    saveFile: deps.saveFile,
    vault: {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptStringAsync(text),
      decrypt: (data) => safeStorage.decryptStringAsync(data),
    },
    create: deps.create,
  };
  let saveKey = await prepareSaveKey(keyOptions);
  deps.log?.({ boot: "save-key", ...saveKey });
  // 키 없이 도는데 암호화 저장이 있다(키체인 거부·키 파일 잠김·키 저장소 없음) — 저장을 옮기지 않고 묻는다.
  // 종료면 저장을 그대로 두고 끝낸다. 새로 시작이면 키와 저장을 백업(.unreadable-<시각>)하고 다시 준비한다 — 계정 저장은 클라우드가 받는다
  if (saveKey.status !== "ok" && saveKey.status !== "reset" && isSealedOnDisk(deps.saveFile)) {
    const answer = await deps.askLocked();
    if (answer === "fresh" && setAsideKeyAndSave(deps.saveFile)) {
      saveKey = await prepareSaveKey(keyOptions);
      deps.log?.({ boot: "save-key", after: "fresh", ...saveKey });
    } else {
      deps.onLocked();
      return false;
    }
  }
  return true;
}
