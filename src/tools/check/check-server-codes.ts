// 서버 코드 대조 — 앱의 서버 코드 목록과 서버가 실제로 내는 코드가 같은가
//
//   node dist/tools/check/check-server-codes.js   (npm run build 뒤)
//
// 서버 쪽 원본: supabase/migrations/*.sql 의 `raise exception '<코드>'`, supabase/functions/** 의 "<코드>" 글자.
// 앱 쪽 목록: src/shared/names/online-codes.ts 의 SERVER_*_CODES 배열 (worklog 의 code-structure 설계 40번 3.1절).
// 그 파일이 아직 없으면 건너뛴다(종료 코드 0) — 이름 목록 단계에서 저절로 켜진다.
// SERVER_ 로 시작하는 코드(SERVER_BUSY 등)는 목록에 넣지 않는다. 분류기가 UNKNOWN 으로 접는다
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./baseline";

const PREFIX = /^(CLOUD|AUTH|TRADE|MAIL|BATTLE|FRIENDLY)_[A-Z0-9_]+$/;

function filesUnder(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const ent of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ext.test(ent.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// 서버가 내는 코드
export function serverCodes(root: string = ROOT): string[] {
  const codes = new Set<string>();
  for (const file of filesUnder(path.join(root, "supabase", "migrations"), /\.sql$/)) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(/raise\s+exception\s+'([A-Z0-9_]+)'/gi)) if (PREFIX.test(m[1]!)) codes.add(m[1]!);
  }
  for (const file of filesUnder(path.join(root, "supabase", "functions"), /\.ts$/)) {
    if (file.includes(`${path.sep}_shared${path.sep}`)) continue; // 규칙 복사본 — 코드를 내지 않는다
    for (const m of fs.readFileSync(file, "utf8").matchAll(/["']([A-Z0-9_]+)["']/g)) if (PREFIX.test(m[1]!)) codes.add(m[1]!);
  }
  return [...codes].sort();
}

// 앱이 아는 서버 코드. 목록 파일이 없으면 null
export function appServerCodes(root: string = ROOT): string[] | null {
  const file = path.join(root, "dist", "shared", "names", "online-codes.js");
  if (!fs.existsSync(file)) return null;
  const mod = require(file) as Record<string, unknown>;
  const codes = new Set<string>();
  for (const [key, value] of Object.entries(mod)) {
    if (!/^SERVER_[A-Z]+_CODES$/.test(key) || !Array.isArray(value)) continue;
    for (const v of value) if (typeof v === "string") codes.add(v);
  }
  return [...codes].sort();
}

export function compareServerCodes(root: string = ROOT): { skipped: boolean; serverOnly: string[]; appOnly: string[] } {
  const app = appServerCodes(root);
  if (!app) return { skipped: true, serverOnly: [], appOnly: [] };
  const server = serverCodes(root);
  return { skipped: false, serverOnly: server.filter((c) => !app.includes(c)), appOnly: app.filter((c) => !server.includes(c)) };
}

if (require.main === module) {
  const res = compareServerCodes();
  if (res.skipped) {
    process.stdout.write(`check-server-codes: 건너뜀 — 앱의 서버 코드 목록(src/shared/names/online-codes.ts)이 아직 없다. 서버가 내는 코드 ${serverCodes().length}종\n`);
  } else if (res.serverOnly.length || res.appOnly.length) {
    process.stderr.write(`check-server-codes: 어긋남\n  서버에만 있다: ${res.serverOnly.join(", ") || "없음"}\n  앱 목록에만 있다: ${res.appOnly.join(", ") || "없음"}\n`);
    process.exit(1);
  } else process.stdout.write("check-server-codes: 통과\n");
}
