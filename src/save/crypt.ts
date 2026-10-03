// 저장 파일 암호화 — AES-256-GCM. 설계는 worklog/records/cloud-authority/record.md "P3 로컬 암호화"
//
// 파일 형식: "PBS1" 머리 4바이트 + IV 12바이트 + 태그 16바이트 + 암호문
//   한 바이트라도 고치면 태그 검사가 실패한다 — 부르는 쪽은 파손으로 다룬다
// 키는 이 모듈이 만들거나 보관하지 않는다. 앱이 켜질 때 src/save/key.ts 가 풀어 setSaveKey 로 넘긴다
//   키가 없으면(node 자체 검사·개발 도구·암호화를 못 쓰는 환경) 저장은 평문이다
// 메모리의 키로 동기 암호화한다 — 저장 읽기·쓰기(store.ts)는 동기라서
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const SAVE_CRYPT_RULES = {
  magic: Buffer.from("PBS1", "ascii"),
  keyBytes: 32,
  ivBytes: 12,
  tagBytes: 16,
};

let current: Buffer | null = null;

// 지금 저장 키 — 없으면 null(평문)
export const currentSaveKey = (): Buffer | null => current;

// 저장 키를 정한다. null 이면 평문으로 돌아간다(자체 검사)
export function setSaveKey(key: Buffer | null): void {
  if (key && key.length !== SAVE_CRYPT_RULES.keyBytes) throw new Error(`저장 키 길이 ${key.length}`);
  current = key;
}

export const newSaveKey = (): Buffer => randomBytes(SAVE_CRYPT_RULES.keyBytes);

// 암호화한 저장인가 — 머리만 본다
export function isSealed(buf: Buffer): boolean {
  const { magic } = SAVE_CRYPT_RULES;
  return buf.length >= magic.length && buf.subarray(0, magic.length).equals(magic);
}

export function sealText(key: Buffer, text: string): Buffer {
  const { magic, ivBytes } = SAVE_CRYPT_RULES;
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), body]);
}

// 풀기 — 키가 다르거나 내용을 고쳤으면 null
export function unsealText(key: Buffer, buf: Buffer): string | null {
  const { magic, ivBytes, tagBytes } = SAVE_CRYPT_RULES;
  if (!isSealed(buf) || buf.length < magic.length + ivBytes + tagBytes) return null;
  const iv = buf.subarray(magic.length, magic.length + ivBytes);
  const tag = buf.subarray(magic.length + ivBytes, magic.length + ivBytes + tagBytes);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(magic.length + ivBytes + tagBytes)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
