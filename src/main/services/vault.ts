// OS 키 저장소 — Electron safeStorage 의 비동기 함수로 KeyVault(src/platform/key-vault.ts)를 채운다
// 저장 키(src/save/key.ts)와 온라인 세션 파일(src/online/session-storage.ts)이 같은 모양을 받는다
// 비동기 safeStorage 만 쓴다 — mac 은 키체인 허용 창이 뜨면 동기 호출이 답할 때까지 메인을 멈춘다.
// 멈추면 무대·꺼내기 처리가 서서 포켓몬이 안 보인다 (2026-09-28 사용자 "업데이트하니 기존포켓몬들을 꺼내도 안보이는데")
// (예전 src/main/app/boot.ts·src/main/trade.ts 에 따로 있었다. 메인 레인 M8-7 에서 하나로 모았다)
import { safeStorage } from "electron";
import type { KeyVault } from "../../platform/key-vault.js";

export function createKeyVault(): KeyVault {
  return {
    available: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptStringAsync(text),
    decrypt: (data) => safeStorage.decryptStringAsync(data),
  };
}
