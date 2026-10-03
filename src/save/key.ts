// 저장 키 준비 — 앱이 켜질 때 게임을 만들기 전에 한 번. 설계는 worklog/records/cloud-authority/record.md "P3 로컬 암호화"
//
// 키는 설치마다 무작위 32바이트다. OS 키 저장소(Electron safeStorage — Windows DPAPI·mac 키체인)로 감싸
// <저장 폴더>/save.key 에 둔다: { "v": 1, "key": "<감싼 값 base64>" }
//   감싼 값을 풀면 { "key": "<키 base64>", "migrated": <기존 평문 저장을 옮겼나> } — 이전 여부도 감싸 둔다.
//   메모장으로 migrated 를 거짓으로 고쳐 평문을 다시 받게 하지 못한다(검수 P3-5)
// Electron 을 모른다 — 키 저장소는 부르는 쪽이 넘긴다(메인은 safeStorage, 자체 검사는 가짜)
//
// 갈래
//   키 저장소 없음        키 없이(평문) 돈다. 암호화 저장이 이미 있으면 store 가 읽지도 덮지도 않는다(locked)
//   save.key 없음         create 면 새 키를 만든다. 아니면(개발 실행 POKEBUDDY_SAVE_CRYPT=off) 키 없이 돈다
//   save.key 를 읽지 못함  잠김·권한(백신·동기화 도구) — 이번 실행은 키 없이 돈다. 저장은 locked 로 지킨다. 다음 실행에 다시 본다(검수 P3-2)
//   save.key 를 풀지 못함  키체인 거부·초기화 — 옮기지 않고 이번만 키 없이 돈다(denied). 앱이 저장 잠김 창으로 묻는다(검수 P3-3,
//                         2026-09-30 사용자 결정 "안내 창으로 묻기"). 새로 시작을 고르면 setAsideKeyAndSave 뒤 다시 준비한다
//   save.key 모양이 틀림   키와 저장을 .unreadable-<시각>.bak 으로 옮기고 새 키로 시작한다(reset).
//                         격리 표시를 남겨 클라우드가 서버 저장을 받게 한다. 옮기지 못하면 옛 키를 덮지 않고 키 없이 돈다(검수 P3-7)
//   migrated 가 거짓       기존 평문 저장을 save.json.plain-<시각>.bak 으로 남기고 암호화해 다시 쓴다.
//                         옮기지 못하면 이번 실행은 키 없이 돈다 — 다음 실행에 다시 옮긴다(평문을 조작으로 격리하지 않게)
// 한계: 키가 PC 에 있으니 앱을 뜯으면 푼다. save.key 를 지우고 평문을 넣으면 새 키가 그 평문을 이전으로 받는다.
//   메모장 수정을 막는 수준이다 — 나머지는 서버 검증(P4)이 막는다
import fs from "node:fs";
import path from "node:path";
import { isSealed, newSaveKey, setSaveKey, SAVE_CRYPT_RULES } from "./crypt.js";
import { writeAtomic } from "../platform/atomic-write.js";
import { moveFile, stampOf } from "../platform/move-file.js";
import type { KeyVault } from "../platform/key-vault.js";
import { sealPlainSave, setAsideSave } from "./save-file.js";

// OS 키 저장소의 모양은 src/platform/key-vault.ts 다
export type { KeyVault }; // [임시] 옛 자리 — src/tools/selftest/selftest-save-crypt.ts 가 읽는다

export interface PrepareSaveKeyOptions {
  saveFile: string;
  vault: KeyVault;
  create: boolean; // 키가 없으면 만든다 — 개발 실행의 POKEBUDDY_SAVE_CRYPT=off 만 거짓
  now?: () => number;
}

// ok 키를 썼다, off 키 없이(평문), unavailable 키 저장소 없음, busy 키 파일을 읽거나 옮기지 못해 이번만 키 없이,
// denied 키 저장소가 풀기를 거부해 이번만 키 없이(저장은 그대로), reset 키 파일이 망가져 새로 만들었다(저장을 옮겼다)
// 키 없이 도는데 암호화 저장이 있으면 앱이 저장 잠김 창을 띄운다(src/main/app.ts)
export type SaveKeyStatus = "ok" | "off" | "unavailable" | "busy" | "denied" | "reset";

export interface PrepareSaveKeyResult {
  status: SaveKeyStatus;
  migrated: boolean; // 이번에 기존 평문 저장을 암호화했다
}

export const keyFileOf = (saveFile: string): string => path.join(path.dirname(saveFile), "save.key");

interface KeyFile {
  v: 1;
  key: string; // 감싼 값 base64
}

interface Sealed {
  key: Buffer;
  migrated: boolean;
}

const errCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | null)?.code;

// missing 없음, io 읽지 못함(잠김·권한), broken 형식이 틀림
function readKeyFile(file: string): KeyFile | "missing" | "io" | "broken" {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return errCode(e) === "ENOENT" ? "missing" : "io";
  }
  try {
    const o = JSON.parse(text) as Partial<KeyFile>;
    if (o.v === 1 && typeof o.key === "string") return { v: 1, key: o.key };
  } catch {
    // 아래
  }
  return "broken";
}

async function writeKeyFile(file: string, vault: KeyVault, s: Sealed): Promise<boolean> {
  const wrapped = await vault.encrypt(JSON.stringify({ key: s.key.toString("base64"), migrated: s.migrated }));
  return writeAtomic(file, { v: 1, key: wrapped.toString("base64") } satisfies KeyFile);
}

// 푼 값을 읽는다 — 모양이 틀리면 null
function unwrap(out: { result: string; shouldReEncrypt: boolean }): { sealed: Sealed; again: boolean } | null {
  let o: { key?: unknown; migrated?: unknown };
  try {
    o = JSON.parse(out.result) as typeof o;
  } catch {
    return null;
  }
  if (typeof o.key !== "string" || typeof o.migrated !== "boolean") return null;
  const key = Buffer.from(o.key, "base64");
  if (key.length !== SAVE_CRYPT_RULES.keyBytes) return null;
  return { sealed: { key, migrated: o.migrated }, again: out.shouldReEncrypt };
}

// 옮긴다 — 없으면 true, 옮기지 못하면 false. 저장 옮기기(setAsideSave)와 같이 옮기지 못하면 복사 후 삭제로 다시 한다
const moveAside = (file: string, to: string): boolean => !fs.existsSync(file) || moveFile(file, to, { copyFallback: true });

// 키와 저장을 .unreadable-<시각>.bak 으로 옮기고 격리 표시를 남긴다 — 키 파일이 망가졌을 때와, 저장 잠김 창에서 새로 시작을 골랐을 때.
// 키를 먼저 옮긴다. 키를 못 옮기면 저장도 옮기지 않는다 — 남은 옛 키가 새 평문 저장을 조작으로 격리하지 않게. 다 옮겼으면 true
export function setAsideKeyAndSave(saveFile: string, at = Date.now()): boolean {
  const keyFile = keyFileOf(saveFile);
  if (!moveAside(keyFile, `${keyFile}.unreadable-${stampOf(at)}.bak`)) return false;
  return setAsideSave(saveFile, "unreadable", at) !== null; // 저장이 없으면 "" — 옮길 것이 없다
}

const hasPlain = (saveFile: string): boolean => {
  try {
    return !isSealed(fs.readFileSync(saveFile));
  } catch {
    return false;
  }
};

export async function prepareSaveKey({ saveFile, vault, create, now = Date.now }: PrepareSaveKeyOptions): Promise<PrepareSaveKeyResult> {
  setSaveKey(null);
  const without = (status: SaveKeyStatus): PrepareSaveKeyResult => ({ status, migrated: false });
  let can = false;
  try {
    can = await vault.available();
  } catch {
    can = false;
  }
  if (!can) return without("unavailable");

  const keyFile = keyFileOf(saveFile);
  const at = now();
  const found = readKeyFile(keyFile);
  if (found === "io") return without("busy");

  let sealed: Sealed | null = null;
  let status: SaveKeyStatus = "ok";

  if (typeof found === "object") {
    let out: { result: string; shouldReEncrypt: boolean };
    try {
      out = await vault.decrypt(Buffer.from(found.key, "base64"));
    } catch (e) {
      // 키 저장소가 풀기를 거부했다(허용 창 거부·키체인 초기화) — 저장을 옮기지 않는다. 앱이 묻는다(askSaveLocked)
      console.error("저장 키를 풀지 못했다 — 저장은 그대로 두고 묻는다", e);
      return without("denied");
    }
    const got = unwrap(out);
    if (got) {
      sealed = got.sealed;
      if (got.again) await writeKeyFile(keyFile, vault, sealed).catch(() => false);
    }
  }

  if (!sealed && found !== "missing") {
    // 키 파일 모양이 틀렸다 — 이 키로 쓴 저장도 못 읽는다. 둘 다 옮겨 두고 새 키로.
    // 옮기지 못하면 새 키로 덮지 않는다 — 옮긴 저장을 영영 못 풀게 된다
    if (!setAsideKeyAndSave(saveFile, at)) return without("busy");
    status = "reset";
  }

  if (!sealed) {
    if (found === "missing" && !create) return without("off");
    sealed = { key: newSaveKey(), migrated: false };
    try {
      if (!(await writeKeyFile(keyFile, vault, sealed))) return without("off");
    } catch (e) {
      console.error("저장 키를 만들지 못해 평문으로 둔다", e);
      return without("off");
    }
  }

  let didMigrate = false;
  if (!sealed.migrated) {
    const hadPlain = hasPlain(saveFile);
    if (!sealPlainSave(saveFile, sealed.key, at)) return without("off"); // 다음 실행에 다시 — 키 파일은 migrated:false 로 남는다
    sealed = { ...sealed, migrated: true };
    try {
      await writeKeyFile(keyFile, vault, sealed);
    } catch (e) {
      console.error("저장 키 파일에 이전 완료를 적지 못했다", e); // 다음 실행은 이미 암호화된 저장을 보고 그냥 넘어간다
    }
    didMigrate = hadPlain;
  }

  setSaveKey(sealed.key);
  return { status, migrated: didMigrate };
}
