// OS 키 저장소 — Electron safeStorage 의 비동기 함수 모양. 플랫폼 층은 Electron 을 가져오지 않는다 — 메인이 safeStorage 로 채운다
export interface KeyVault {
  available: () => Promise<boolean>;
  encrypt: (text: string) => Promise<Buffer>;
  decrypt: (data: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>;
}
