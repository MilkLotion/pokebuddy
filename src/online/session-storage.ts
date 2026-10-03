// 온라인 세션 파일 저장소 — supabase-js 의 세션(토큰)을 파일에 둔다. 계정·교환·클라우드 저장이 같은 세션을 본다
// 설계는 worklog/records/trade/record.md "세션 저장", 세션 파일 상태는 worklog-mac/records/cloud-authority/design-p2.md 2절·12절 Q3
//
// 세션은 키 저장소로 암호화해 ~/.claude/pokebuddy/online/session.bin 에 둔다.
// 암호화를 쓸 수 없는 환경(키 저장소 없음)이면 같은 폴더의 session.json 에 평문으로 둔다 — 권한 0600(Q3)
// 암호화가 한 번 실패해도 평문으로 둔다. 두 파일이 다 있으면 더 나중에 쓴 쪽을 읽는다(W5)
// Electron 을 모른다 — 키 저장소(KeyVault)를 받아서 쓴다
// (예전 src/main/trade.ts 의 encryptedStorage. 메인 레인 M8-7 에서 온라인 층으로 옮겼다)
import fs from "node:fs";
import path from "node:path";
import type { KeyVault } from "../platform/key-vault.js";
import { writeAtomic } from "../platform/atomic-write.js";
import { moveFile, stampOf } from "../platform/move-file.js";
import { PATHS } from "../platform/paths.js";
import type { SessionStorage } from "./client.js";

// 세션 파일 자리 — ~/.claude/pokebuddy/online/session.bin
export const sessionFile = (): string => path.join(PATHS.home, "online", "session.bin");

// 세션 파일 상태 — 첫 읽기 뒤에 정해진다
//   ok           암호화 파일을 읽었다
//   missing      세션 파일이 없다(처음·로그아웃 뒤)
//   unreadable   암호화 파일을 풀지 못했다(키가 바뀜·키체인 거부) — 첫 쓰기 전에 session.bin.unreadable-<시각>.bak 으로 옮긴다(저장 옮기기와 같은 이름·복사 대체)
//   unavailable  이 환경은 암호화를 쓸 수 없다 — 평문 session.json(0600)을 쓴다
export type SessionFileStatus = "ok" | "missing" | "unreadable" | "unavailable";

export interface SessionFileStorage extends SessionStorage {
  status: () => Promise<SessionFileStatus>;
}

// 키 하나에 값 하나 — supabase-js 는 키 몇 개만 쓴다. 통째로 암호화해 한 파일에 둔다.
// 키 저장소(vault)는 메인이 Electron safeStorage 의 비동기 함수로 채운다 (src/main/services/vault.ts) — mac 은 키체인 허용 창이 뜨면 동기 호출이 답할 때까지 메인을 멈춘다.
// 멈추면 무대·꺼내기 처리가 서서 포켓몬이 안 보인다 (2026-09-28 사용자 "업데이트하니 기존포켓몬들을 꺼내도 안보이는데")
// 풀지 못한 파일은 덮어쓰지 않는다 — 옮겨 두고 새로 쓴다. 키가 돌아오면 사람이 되살릴 수 있다
// 개발 실행·업데이트 시험 빌드의 use-mock-keychain(src/main/app.ts)은 그대로 — 가짜 키로 암호화 파일을 쓴다
export function createSessionStorage(o: { file: string; vault: KeyVault }): SessionFileStorage {
  const { file, vault } = o;
  const plainFile = path.join(path.dirname(file), "session.json");
  const memory = new Map<string, string>();
  let ready: Promise<SessionFileStatus> | null = null; // 파일을 한 번 읽었다 — 값은 첫 읽기의 상태
  let writing: Promise<void> = Promise.resolve(); // 쓰기를 차례로 — 앞선 쓰기가 뒤의 값을 덮지 않게
  let aside = false; // 풀지 못한 암호화 파일을 아직 옮기지 않았다
  const can = async (): Promise<boolean> => {
    try { return await vault.available(); } catch { return false; }
  };
  const mtimeOf = (f: string): number | null => {
    try { return fs.statSync(f).mtimeMs; } catch { return null; }
  };
  const take = (text: string): void => {
    const obj = JSON.parse(text) as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) if (typeof v === "string" && !memory.has(k)) memory.set(k, v);
  };
  // 평문 파일 — 원자적 쓰기(tmp 를 0600 으로 만들어 rename)라 쓰는 도중에 죽어도 반쪽 파일이 남지 않는다.
  // Windows 는 권한 비트가 거의 뜻이 없다(읽기 전용만 반영) — 대신 사용자 프로필 폴더(~/.claude)라 다른 사용자 계정은 기본 ACL 로 막힌다
  // (예전에는 저장과 달리 바로 덮어썼다 — worklog/records/code-structure/design/94-same-feature-diffs.md 5-6)
  const writePlain = async (): Promise<void> => {
    if (!writeAtomic(plainFile, JSON.stringify(Object.fromEntries(memory)), { mode: 0o600 })) throw new Error("세션 평문 파일을 쓰지 못했다");
  };
  const flushNow = async (): Promise<void> => {
    try {
      if (!(await can())) {
        await writePlain();
        return;
      }
      if (aside) {
        // 풀지 못한 파일을 덮지 않게 먼저 옮긴다 — 못 옮기면 쓰지 않는다
        if (fs.existsSync(file) && !moveFile(file, `${file}.unreadable-${stampOf()}.bak`, { copyFallback: true })) throw new Error("풀지 못한 세션 파일을 옮기지 못했다");
        aside = false;
      }
      let data: Buffer;
      try {
        data = await vault.encrypt(JSON.stringify(Object.fromEntries(memory)));
      } catch (e) {
        // 키 저장소가 이번만 거부했다 — 세션을 잃지 않게 평문(0600)으로 둔다. session.bin 은 그대로 둔다
        // 다음 읽기는 더 나중에 쓴 쪽(평문)을 쓴다 — 옛 암호화 파일의 계정으로 되돌아가지 않게(load)
        console.error("세션을 암호화하지 못해 평문 파일로 둔다", e);
        await writePlain();
        return;
      }
      if (!writeAtomic(file, data)) throw new Error("세션 파일을 쓰지 못했다");
      // 암호화를 다시 쓸 수 있게 됐다 — 평문 사본을 남기지 않는다
      if (fs.existsSync(plainFile)) await fs.promises.rm(plainFile, { force: true });
    } catch (e) {
      console.error("교환 세션 파일을 쓰지 못했다", e);
    }
  };
  const flush = (): Promise<void> => (writing = writing.then(flushNow));
  const load = (): Promise<SessionFileStatus> =>
    (ready ??= (async (): Promise<SessionFileStatus> => {
      if (!(await can())) {
        try {
          if (!fs.existsSync(plainFile)) return "unavailable";
          take(await fs.promises.readFile(plainFile, "utf8"));
        } catch (e) {
          console.error("평문 세션 파일을 읽지 못해 새로 시작한다", e);
        }
        return "unavailable";
      }
      // 평문 파일이 암호화 파일보다 나중에 쓰였다 — 암호화를 못 쓰던 때나 암호화가 한 번 실패한 때의 세션이다.
      // 더 나중에 쓴 쪽을 쓴다 — 옛 암호화 파일의 계정으로 되돌아가지 않게. 읽은 뒤 암호화 파일로 옮긴다
      const binAt = mtimeOf(file);
      const plainAt = mtimeOf(plainFile);
      if (plainAt != null && binAt != null && plainAt > binAt) {
        try {
          take(await fs.promises.readFile(plainFile, "utf8"));
          void flush();
          return "ok";
        } catch (e) {
          console.error("평문 세션 파일을 읽지 못해 암호화 파일을 읽는다", e);
        }
      }
      if (!fs.existsSync(file)) {
        // 암호화를 못 쓰던 때의 평문 파일 — 읽어 암호화 파일로 옮긴다
        if (!fs.existsSync(plainFile)) return "missing";
        try {
          take(await fs.promises.readFile(plainFile, "utf8"));
          void flush();
          return "ok";
        } catch (e) {
          console.error("평문 세션 파일을 읽지 못해 새로 시작한다", e);
          return "missing";
        }
      }
      try {
        const out = await vault.decrypt(await fs.promises.readFile(file));
        take(out.result);
        if (out.shouldReEncrypt) void flush(); // 키가 바뀌었다 — 새 키로 다시 쓴다
        return "ok";
      } catch (e) {
        console.error("교환 세션 파일을 읽지 못해 새로 시작한다 — 쓰기 전에 옮겨 둔다", e);
        aside = true;
        return "unreadable";
      }
    })());
  return {
    getItem: async (k) => { await load(); return memory.get(k) ?? null; },
    setItem: async (k, v) => { await load(); memory.set(k, v); await flush(); },
    removeItem: async (k) => { await load(); memory.delete(k); await flush(); },
    status: load,
  };
}
