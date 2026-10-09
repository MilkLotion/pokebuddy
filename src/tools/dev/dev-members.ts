// 고정 시험 계정 둘(로그인 계정) — 교환·친선 배틀처럼 로그인 계정 두 개가 필요한 온라인 실기용. 여러 세션이 같이 쓴다
// (2026-10-10 사용자 "온라인계정 테스트용으로 테스트계정 너가 2개 발급해놔. 이거는 고정계정들로 다른 세션들이 작업할때 쓸 수 있게")
//
//   node dist/tools/dev/dev-members.js ensure [--local]        두 계정을 만들거나 로그인해 세션을 시험 HOME 에 넣는다. 저장이 없으면 만든다
//   node dist/tools/dev/dev-members.js start <a|b> [--local]   그 계정으로 앱을 띄운다(이미 떠 있으면 내렸다 다시)
//   node dist/tools/dev/dev-members.js stop <a|b> [--local]
//   node dist/tools/dev/dev-members.js show [--local]          아이디·표시 이름·계정 번호·저장 요약
//
// 아이디·비밀번호는 저장소의 .claude/test-members/accounts.json(git 제외)에 한 번 만들어 두고 계속 쓴다. 지우지 않는다
// 서버는 기본이 운영(data/online.json), --local 이면 로컬 Supabase. 같은 아이디를 서버마다 따로 만든다
// 시험 HOME 은 .claude/test-members/<prod|local>/<a|b> — 계정마다 하나. 다른 세션도 이 폴더를 그대로 쓴다
// 세션은 앱과 같은 클라이언트 설정으로 로그인한 뒤 저장소 내용을 평문 session.json 으로 둔다(앱은 읽고 암호화 파일로 옮긴다, src/online/session-storage.ts)
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createOnlineClient, type SessionStorage } from "../../online/client";
import { internalEmail } from "../../online/account";
import { onlineConfig } from "../../online/config";
import { localServer } from "../e2e/apps";

const PROJECT = path.join(__dirname, "..", "..", "..");
const ROOT = path.join(PROJECT, ".claude", "test-members");
const ACCOUNTS = path.join(ROOT, "accounts.json");
const WHO = ["a", "b"] as const;
type Who = (typeof WHO)[number];

interface Member {
  username: string;
  password: string;
  name: string; // 표시 이름 — 친선 배틀·교환에서 상대에게 보인다
}

function accounts(): Record<Who, Member> {
  if (fs.existsSync(ACCOUNTS)) return JSON.parse(fs.readFileSync(ACCOUNTS, "utf8")) as Record<Who, Member>;
  const pw = (): string => `pb-${randomBytes(9).toString("base64url")}`;
  const made: Record<Who, Member> = { a: { username: "pbtest_a", password: pw(), name: "시험A" }, b: { username: "pbtest_b", password: pw(), name: "시험B" } };
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(ACCOUNTS, `${JSON.stringify(made, null, 2)}\n`);
  return made;
}

const serverOf = (local: boolean): { url: string; key: string; tag: string } => {
  if (local) return { ...localServer(), tag: "local" };
  const c = onlineConfig(undefined, {});
  return { url: c.url, key: c.publishableKey, tag: "prod" };
};
const homeOf = (tag: string, who: Who): string => path.join(ROOT, tag, who);
const dataDir = (home: string): string => path.join(home, ".claude", "pokebuddy");

// 로그인하거나, 없으면 아이디로 가입한다. 세션 저장소 내용을 돌려준다
async function signIn(server: { url: string; key: string }, m: Member): Promise<{ store: Record<string, string>; userId: string }> {
  const store = new Map<string, string>();
  const storage: SessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  const client = createOnlineClient({ url: server.url, key: server.key, storage });
  const email = internalEmail(m.username);
  let res = await client.auth.signInWithPassword({ email, password: m.password });
  if (res.error) {
    const up = await client.auth.signUp({ email, password: m.password, options: { data: { display_name: m.name } } });
    if (up.error || !up.data.session) throw new Error(`${m.username} 가입 실패: ${up.error?.message ?? "세션 없음"} (로그인 실패: ${res.error.message})`);
    res = await client.auth.signInWithPassword({ email, password: m.password });
    if (res.error) throw new Error(`${m.username} 로그인 실패: ${res.error.message}`);
  }
  return { store: Object.fromEntries(store), userId: res.data.user!.id };
}

// 시험 HOME 의 앱 실행 — 저장소의 dev-test 를 그 HOME·서버로 부른다
function devTest(args: string[], home: string, server: { url: string; key: string; tag: string }): string {
  const env = { ...process.env, POKEBUDDY_TEST_HOME: home, ...(server.tag === "local" ? { POKEBUDDY_SUPABASE_URL: server.url, POKEBUDDY_SUPABASE_KEY: server.key } : {}) };
  return execFileSync(process.execPath, [path.join(__dirname, "dev-test.js"), ...args], { env, encoding: "utf8" });
}

// 저장이 없으면 만든다 — 여러 종·이로치·도구가 있는 저장에 배틀 파티. `battle` 장면의 초전설 셋(뮤츠·루기아·미라이돈) 가운데 뮤츠만 남겨 배틀을 시작할 수 있게
function ensureSave(home: string, server: { url: string; key: string; tag: string }): void {
  const file = path.join(dataDir(home), "save.json");
  if (fs.existsSync(file)) return;
  devTest(["scene", "showcase,battle,done-all"], home, server);
  const save = JSON.parse(fs.readFileSync(file, "utf8")) as { pets: { id: string; species: string }[]; battle: { slots: (string | null)[] } };
  save.battle.slots = save.battle.slots.map((id) => (["miraidon", "lugia"].includes(save.pets.find((p) => p.id === id)?.species ?? "") ? null : id));
  fs.writeFileSync(file, JSON.stringify(save, null, 2));
}

async function ensure(local: boolean): Promise<void> {
  const server = serverOf(local);
  if (!server.url || !server.key) throw new Error("서버 주소·키가 없다");
  const all = accounts();
  for (const who of WHO) {
    const home = homeOf(server.tag, who);
    const { store, userId } = await signIn(server, all[who]);
    const dir = path.join(dataDir(home), "online");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify(store)); // 앱이 읽고 session.bin 으로 옮긴다
    ensureSave(home, server);
    process.stdout.write(`${who}: ${all[who].username} (${all[who].name}) 계정 ${userId.slice(0, 8)}… HOME=${home}\n`);
  }
}

async function main(argv: string[]): Promise<void> {
  const local = argv.includes("--local");
  const [cmd, whoArg] = argv.filter((a) => !a.startsWith("--"));
  if (cmd === "ensure") return ensure(local);
  const server = serverOf(local);
  if (cmd === "show") {
    for (const who of WHO) {
      const m = accounts()[who];
      process.stdout.write(`[${who}] ${m.username} (${m.name})\n${devTest(["show"], homeOf(server.tag, who), server)}`);
    }
    return;
  }
  if ((cmd === "start" || cmd === "stop") && (whoArg === "a" || whoArg === "b")) {
    const home = homeOf(server.tag, whoArg);
    if (cmd === "start" && !fs.existsSync(path.join(dataDir(home), "save.json"))) throw new Error("저장이 없다 — ensure 먼저");
    process.stdout.write(devTest(cmd === "start" ? ["start"] : ["stop"], home, server));
    return;
  }
  process.stdout.write("사용법: dev-members.js ensure|show [--local] · start|stop <a|b> [--local]\n");
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
