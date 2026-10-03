// E2E 공용 — 로컬 Supabase, 임시 HOME 으로 띄운 실제 앱(동반자), 관리 창 조작. e2e-trade·e2e-account 가 쓴다
//   앱마다 HOME·USERPROFILE·APPDATA·LOCALAPPDATA·TEMP·TMP 를 임시 폴더로 바꾼다. 사용자의 저장·세션은 건드리지 않는다
//   관리 창은 scripts/e2e/manage-observer.cjs 가 숨긴 채로 열고 누르고 찍는다
// (예전 scripts/e2e/apps.cjs. 앱 코드를 부르므로 타입 검사를 받게 src/tools 로 옮겼다. 관측기는 앱 프로세스가 경로로 싣는 JS 라 scripts/e2e 에 남는다)
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { newPet } from "../../party/create";
import { empty } from "../../save/v3";
import { makeTmp } from "../harness/tmp-dir";

export const root = path.resolve(__dirname, "..", "..", "..");
// 앱 프로세스에 `--require` 로 싣는 관측기 — 경로가 고정된 JS 다
export const observerFile = (file: string): string => path.join(root, "scripts", "e2e", file);
// 로컬 DB 컨테이너 이름 — supabase/config.toml 의 project_id 로 정해진다
export const DB_CONTAINER = `supabase_db_${/^project_id\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8"))![1]}`;
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any — 앱이 쓴 JSON 을 시험이 그대로 읽는다

export interface Server {
  url: string;
  key: string;
}
export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export interface E2eApp {
  name: string;
  dir: string;
  env: NodeJS.ProcessEnv;
  data: string;
  lock: string;
  cli(args: string[]): Promise<CliResult>;
  start(): Promise<void>;
  pid(): number | null;
  alive(): boolean;
  stop(): Promise<void>;
  game(...args: string[]): Promise<Json>;
  status(): Promise<Json>;
  save(): Json;
  partyPet(): Json;
  ui(kind: string, extra?: Record<string, unknown>): Promise<Json>;
  dom(js: string): Promise<Json>;
  text(): Promise<string>;
  press(label: string): Promise<boolean>;
  shot(file: string): Promise<Json>;
  has(words: string[]): Promise<boolean>;
  fill(id: string, value: string): Promise<boolean>;
  indicator(): Promise<string>;
  cloud(): Json;
  events(): Json[];
  dialogs(): Json[];
  answer(button: string): Promise<Json>;
  pickEevee(seen: number): Promise<void>;
  startFresh(): Promise<void>;
  accountTab(): Promise<void>;
  closeDialog(): Promise<void>;
  signUp(username: string, password: string, displayName?: string): Promise<void>;
}
export interface PetSpec {
  id: string;
  species: string;
  where: "party" | "box";
}

export const apps: E2eApp[] = [];

// ── 로컬 서버 ─────────────────────────────────────────────────────────────────
export function localServer(): Server {
  const raw = execSync("npx supabase status -o json", { cwd: root, stdio: ["ignore", "pipe", "ignore"], timeout: 90_000 }).toString();
  const j = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<string, string>;
  const url = j.API_URL, key = j.PUBLISHABLE_KEY || j.ANON_KEY;
  if (!url || !key) throw new Error("로컬 Supabase 주소·키를 읽지 못했다. `npx supabase start` 를 먼저 한다");
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url)) throw new Error(`로컬 주소가 아니다: ${url}`);
  return { url, key };
}

// 로컬 DB 컨테이너에서만 SQL 을 돌린다 — 만료 재현용
export function sql(query: string): string {
  const names = execSync('docker ps --format "{{.Names}}"').toString().split(/\r?\n/);
  if (!names.includes(DB_CONTAINER)) throw new Error(`로컬 DB 컨테이너가 없다: ${DB_CONTAINER}`);
  return execSync(`docker exec ${DB_CONTAINER} psql -U postgres -d postgres -tAc "${query.replace(/"/g, '\\"')}"`).toString().trim();
}

// ── 앱 하나 ───────────────────────────────────────────────────────────────────
// pets: [{ id, species, where: 'party'|'box' }]
//   opts.prefix — 임시 폴더 이름 앞부분, opts.points — 시작 포인트, opts.fresh — 저장 없이 새 설치로 시작(첫 포켓몬 선택 창)
export function makeApp(name: string, server: Server, pets: PetSpec[], extraEnv: Record<string, string> = {}, opts: { prefix?: string; points?: number; fresh?: boolean } = {}): E2eApp {
  const dir = makeTmp(`${(opts.prefix ?? "trade-e2e").replace(/^pokebuddy-/, "")}-${name}`);
  const temp = path.join(dir, "tmp");
  fs.mkdirSync(temp);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: dir, USERPROFILE: dir, APPDATA: path.join(dir, "appdata"), LOCALAPPDATA: path.join(dir, "localappdata"), TEMP: temp, TMP: temp };
  for (const key of Object.keys(env)) if (key.startsWith("POKEBUDDY_") || key === "NODE_OPTIONS" || key === "ELECTRON_RUN_AS_NODE") delete env[key];
  env.PB_E2E_DIR = dir;
  // 저장을 직접 읽고 고친다(app.save·시드) — 평문으로 둔다. 개발 실행만 받는다(src/main/app.ts). 암호화 사례는 extraEnv 로 'on' 을 준다
  env.POKEBUDDY_SAVE_CRYPT = "off";
  const observer = (file: string) => `--require "${observerFile(file).split(path.sep).join("/")}"`;
  env.NODE_OPTIONS = `${observer("mock-keychain.cjs")} ${observer("companion-observer.cjs")} ${observer("manage-observer.cjs")}`; // mock-keychain — 임시 HOME 앱이 사용자 키체인에 닿지 않게
  env.POKEBUDDY_SUPABASE_URL = server.url;
  env.POKEBUDDY_SUPABASE_KEY = server.key;
  env.POKEBUDDY_TRADE_POLL_MS = "600000"; // 주기 새로 고침을 사실상 끈다 — 보기가 바뀌면 실시간 신호 때문이다
  env.POKEBUDDY_TRADE_RETRY_MS = "2000";
  Object.assign(env, extraEnv);

  const data = path.join(dir, ".claude", "pokebuddy");
  fs.mkdirSync(data, { recursive: true });
  if (!opts.fresh) {
    const save = empty(Date.now());
    for (const p of pets) {
      save.pets.push(newPet({ id: p.id, species: p.species, shiny: false, nature: "hardy", now: Date.now() } as Parameters<typeof newPet>[0]));
      if (p.where === "party") save.party.slots[save.party.slots.findIndex((s) => s.state === "empty")] = { state: "pokemon", petId: p.id, hidden: false };
      else save.boxes[0]!.slots[save.boxes[0]!.slots.indexOf(null)] = p.id;
    }
    save.starterPetId = pets[0]!.id;
    if (typeof opts.points === "number") save.points.balance = opts.points;
    save.tutorials = Object.fromEntries(["first-care", "playground", "shop", "hatch", "party", "achievement"].map((k) => [k, { state: "skipped", steps: 0 }])) as typeof save.tutorials;
    fs.writeFileSync(path.join(data, "save.json"), JSON.stringify(save));
  }

  const app = { name, dir, env, data, lock: path.join(data, "companion.lock") } as E2eApp;
  app.cli = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, "bin/pokebuddy"), ...args], { cwd: root, env: app.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", (c) => { stdout += c; });
      child.stderr.on("data", (c) => { stderr += c; });
      const timer = setTimeout(() => { child.kill(); reject(new Error(`[${name}] CLI 시간 초과: ${args.join(" ")}`)); }, 150_000);
      child.once("error", (e) => { clearTimeout(timer); reject(e); });
      child.once("exit", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
  app.start = async () => {
    const r = await app.cli(["companion"]);
    assert.equal(r.code, 0, `[${name}] 동반자 시작 실패: ${r.stderr}`);
  };
  // save.lock 의 pid — 살아 있는 writer
  app.pid = () => { try { return Number(fs.readFileSync(path.join(data, "save.lock"), "utf8")) || null; } catch { return null; } };
  app.alive = () => { const pid = app.pid(); if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
  app.stop = async () => {
    await app.cli(["companion", "stop"]);
    try {
      await until(() => !fs.existsSync(app.lock) && !app.alive(), `[${name}] 종료`);
    } catch (e) {
      // 끝나지 않으면 강제로 끝낸다 — 다음 시나리오가 같은 저장을 쓴다
      const pid = app.pid();
      if (pid) try { process.kill(pid); } catch { /* 이미 끝났다 */ }
      if (fs.existsSync(app.lock)) fs.unlinkSync(app.lock);
      throw e;
    }
  };
  app.game = async (...args) => {
    const r = await app.cli(["game", ...args]);
    try { return JSON.parse(r.stdout); } catch { throw new Error(`[${name}] JSON 아님: ${r.stdout} ${r.stderr}`); }
  };
  app.status = async () => (await app.game("trade.status")).trade;
  app.save = () => JSON.parse(fs.readFileSync(path.join(data, "save.json"), "utf8"));
  app.partyPet = () => { const s = app.save(); const id = s.party.slots[0].petId; return s.pets.find((p: Json) => p.id === id); };
  // 관리 창 조작 — scripts/e2e/manage-observer.cjs 가 처리한다
  let uiSeq = 0;
  app.ui = async (kind, extra = {}) => {
    const id = `${name}-${++uiSeq}`;
    fs.writeFileSync(path.join(dir, "ui.json"), JSON.stringify({ id, kind, ...extra }));
    let got: Json = null;
    await until(() => {
      const file = path.join(dir, "ui-events.jsonl");
      if (!fs.existsSync(file)) return false;
      got = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e: Json) => e.id === id) ?? null;
      return got != null;
    }, `[${name}] 관리 창 ${kind}`);
    if (!got.ok) throw new Error(`[${name}] 관리 창 ${kind} 실패: ${got.message}`);
    return got.value;
  };
  app.dom = (js) => app.ui("eval", { js });
  app.text = () => app.dom("document.body.innerText");
  // 글자가 같은 단추를 누른다. 막힌 단추면 false
  app.press = (label) => app.dom(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
  app.shot = (file) => app.ui("shot", { file });
  app.has = async (words) => { const t = await app.text(); return words.every((w) => t.includes(w)); };
  app.fill = (id, value) => app.dom(`(() => { const i = document.getElementById(${JSON.stringify(id)}); if (!i) return false; i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input')); return true; })()`);
  app.indicator = () => app.dom(`(() => { const e = document.getElementById('save-indicator'); return e && !e.hidden ? e.textContent : ''; })()`);
  app.cloud = () => { try { return JSON.parse(fs.readFileSync(path.join(data, "cloud.json"), "utf8")); } catch { return null; } };
  // 동반자 관측기(scripts/e2e/companion-observer.cjs)의 사건 — boot·window·picker-ready·picked·quit
  app.events = () => { const f = path.join(dir, "events.jsonl"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; };
  // 관리 창 관측기(scripts/e2e/manage-observer.cjs)가 가로챈 네이티브 메시지 창 — 뜬 순서대로. answer 는 글자가 같은 단추를 고른다
  app.dialogs = () => { const f = path.join(dir, "dialogs.jsonl"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; };
  app.answer = (button) => app.ui("dialog", { button });
  // 첫 포켓몬 선택 창이 새로 뜨면 이브이를 고른다. 창 수를 세어 이번 창만 본다
  app.pickEevee = async (seen) => {
    await until(() => app.events().filter((e) => e.event === "picker-ready").length > seen, `[${name}] 선택 창`, 60_000);
    fs.writeFileSync(path.join(dir, "action.json"), JSON.stringify({ kind: "pick-eevee" }));
    await until(() => app.events().some((e) => e.event === "picked" && e.selected), `[${name}] 이브이 고르기`);
  };
  // 새 설치 — 저장이 없어 선택 창이 뜬다. 고를 때까지 CLI 가 끝나지 않는다
  app.startFresh = async () => {
    const run = app.cli(["companion"]);
    await app.pickEevee(app.events().filter((e) => e.event === "picker-ready").length);
    const r = await run;
    assert.equal(r.code, 0, `[${name}] 동반자 시작 실패: ${r.stderr}`);
  };
  // 관리 창 → 사용자 모달 → 계정 탭
  app.accountTab = async () => {
    await app.ui("open");
    await until(async () => { try { return await app.dom('!!document.querySelector("nav .tabs button")'); } catch { return false; } }, `[${name}] 관리 창`);
    await app.dom(`document.getElementById('open-user').click()`);
    await until(() => app.press("계정"), `[${name}] 계정 탭`);
  };
  app.closeDialog = async () => {
    await app.dom(`document.querySelector('#dialog .dialog-close')?.click()`);
    await until(async () => !(await app.dom('document.getElementById("scrim").classList.contains("open")')), `[${name}] 모달 닫힘`);
  };
  // 계정 탭에서 아이디로 가입한다 — 익명 저장이 새 계정으로 옮겨진다(진행 옮기기). 가입 뒤 모달을 닫는다
  app.signUp = async (username, password, displayName = username.slice(0, 12)) => {
    await app.accountTab();
    await until(() => app.press("가입"), `[${name}] 가입 화면으로`);
    await until(() => app.dom(`!!document.getElementById('search-acct-new-user')`), `[${name}] 가입 화면`);
    await app.fill("search-acct-new-user", username);
    await until(() => app.has(["사용할 수 있는 아이디"]), `[${name}] 아이디 확인`);
    await app.fill("search-acct-new-name", displayName);
    await app.fill("search-acct-new-pass", password);
    await app.fill("search-acct-new-pass2", password);
    assert.equal(await app.press("가입"), true, `[${name}] 가입 단추`);
    await until(() => app.has([`아이디 ${username}`]), `[${name}] 가입 뒤 화면`, 30_000);
    await app.closeDialog();
  };
  apps.push(app);
  return app;
}

export async function until(test: () => unknown, label: string, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(200);
  }
  throw new Error(`대기 실패: ${label}`);
}
export const ok = (r: { ok?: unknown }, label: string): void => assert.equal(r.ok, true, `${label}: ${JSON.stringify(r)}`);
export const online = (): typeof import("../../trade/config") => require("../../trade/config") as typeof import("../../trade/config");
