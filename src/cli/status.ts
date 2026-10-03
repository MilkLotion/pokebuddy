// pokebuddy status — 동반자가 이상하게 보일 때 지금 판정 상태를 한 번에 보여 준다.
// 경로·설정·판정은 전부 공통 모듈에서 온다 — 동반자와 같은 코드를 쓴다 (두 벌이면 진단이 거짓말을 한다)
// (예전 cli/status.js. 도구 레인 T7b-3 에서 TypeScript 로 옮겼다)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { hookInstalled } from "../agents/hooks";
import { dexPath, suggestSlugs } from "../dex/dex-number";
import { frontWindow, hostOf } from "../follow/front";
import { agentStateOf, readStateRecords, stateFor } from "../follow/state";
import { PATHS } from "../platform/paths";
import { USER_DEFAULTS, readConfig } from "../platform/user-config";
import { parseCredits } from "../shared/pmd-credits";
import { companionPid } from "./run";

// 프로젝트 뿌리 — dist/cli 에서 두 칸 위 (창 추적 헬퍼 helpers/ 가 있는 곳)
const PROJECT = path.join(__dirname, "..", "..");

const say = (line = ""): void => void process.stdout.write(`${line}\n`);
const age = (at: unknown): string => (Date.now() / 1000 - (Number(at) || 0)).toFixed(1);

export function runStatus(petArg?: string): void {
  const config = readConfig();

  say(`설정 파일: ${PATHS.config}`);
  say(`  ${Object.keys(USER_DEFAULTS).map((k) => `${k}=${String((config as unknown as Record<string, unknown>)[k])}`).join(" ")}`);

  // 설치 상태 — 훅이 없는 CLI 에서는 상태별 동작 없이 기본 동작(산책·수면)만 돈다
  const hooks = hookInstalled();
  say(`상태 훅 파일: ${!hooks.file ? "없음 — pokebuddy setup" : hooks.current ? "최신" : "옛 버전 — pokebuddy setup 으로 바꾼다"}`);
  for (const cli of hooks.clis) {
    const head = `  ${cli.name.padEnd(12)}`;
    if (!cli.used) say(`${head}안 씀 (설정 폴더 없음)`);
    else if (cli.error) say(`${head}${cli.error}`);
    // 연결은 설정창 → 사용자 → 연결 탭에서만 한다 (setup 은 등록하지 않는다)
    else if (!cli.registered && !(cli.stale || []).length) say(`${head}연결 안 됨 — 설정창 → 사용자 → 연결 탭`);
    else if ((cli.registered ?? 0) < (cli.total ?? 0) || (cli.stale || []).length) say(`${head}갱신 필요 (${cli.registered}/${cli.total}) — 설정창 → 사용자 → 연결 탭의 갱신`);
    else say(`${head}연결됨 (${cli.registered}/${cli.total})`);
  }

  // 동반자가 스스로 끝난 이유 — 동반자의 출력은 평소 버려지므로 여기서만 보인다
  try {
    const e = JSON.parse(fs.readFileSync(PATHS.lastError, "utf8")) as { reason?: string; slug?: string; message?: string; at?: number };
    if (e.reason !== "starter-cancelled") say(`마지막 실패: ${e.slug} — ${e.message} (${Math.round(Number(age(e.at)) / 60)}분 전)`);
  } catch {
    // 실패 기록 없음
  }

  const records = readStateRecords(PATHS.state);

  // 맨 앞 창과 그 창이 터미널 호스트인지 — 동반자와 같은 판정 (follow/front hostOf)
  try {
    const [cmd, args]: [string, string[]] =
      process.platform === "win32"
        ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(PROJECT, "helpers", "winbounds.ps1")]]
        : [path.join(PROJECT, "helpers", "winbounds"), []];
    const info = JSON.parse(execFileSync(cmd, args, { encoding: "utf8", windowsHide: true }));
    // 이 명령을 띄운 창이 맨 앞이다 — 펫 자신을 가리는 표는 필요 없다
    const top = frontWindow(info, info.windows);
    const host = hostOf(top, records);
    const kind = !host ? "터미널 호스트가 아님 — 동반자는 마지막 자리에 남는다" : host.kind === "hook" ? "훅 기록이 있는 터미널 — 그 앱의 최신 세션을 따른다" : "알려진 터미널 — 아직 CLI 기록이 없어 대기";
    say(`\n지금 화면 맨 앞 창: ${top ? `${top.app} (pid ${top.pid})` : "없음"} — ${kind}`);
    if (host) say(`  동반자가 보일 동작: ${stateFor(records, host.pids).state}`);
  } catch {
    say("\n창 목록을 읽지 못했다 — 창 추적 헬퍼가 없거나 이 플랫폼에서 못 쓴다");
  }

  say(`\n세션 상태 기록 ${records.length}건 (최신순)${records.length ? "" : " — 훅을 설치한 뒤 CLI LLM 을 한 번 실행하면 생긴다"}`);
  for (const record of records.slice(0, 10)) {
    const prompt = record.promptAt ? `  프롬프트 ${age(record.promptAt)}초 전` : "";
    say(
      `  ${String(record.cli || "claude").padEnd(6)}  기록=${record.state} → 지금=${agentStateOf(record)}  ${age(record.at)}초 전${prompt}` +
        `  조상 ${Array.isArray(record.ancestors) ? record.ancestors.length : 0}개`,
    );
  }

  // PMD 그림 — CC BY-NC 4.0 이라 저작자 표시가 조건이다. 포켓몬마다 그린 사람이 다르다
  const slug = petArg || config.slug; // 저장 내용은 읽지 않는다(cloud-authority D18) — 종은 인자나 설정으로
  const d = dexPath(slug);
  say(`\nPMD 그림 (${slug}${d ? ` · 도감 ${d}` : ""}) — ${PATHS.pmd}`);
  if (!d) {
    say(`  도감 번호를 모름 — PMD 로는 못 그린다. 비슷한 이름: ${suggestSlugs(slug).join(", ") || "없음"}`);
  } else {
    const zip = path.join(PATHS.pmd, `${d}.zip`);
    say(`  캐시: ${fs.existsSync(zip) ? `${Math.round(fs.statSync(zip).size / 1024)}KB` : "없음 — 처음 띄울 때 받는다"}`);
    let authors: { author: string; license: string }[] = [];
    try {
      authors = parseCredits(fs.readFileSync(path.join(PATHS.pmd, `${d}.credits.txt`), "utf8"));
    } catch {
      // 저작자 목록을 아직 못 받음
    }
    const names = [...new Set(authors.map((a) => a.author))];
    say(`  그린 사람: ${names.length ? names.join(", ") : "목록 없음"}`);
    say("  출처: PMDCollab/SpriteCollab (https://sprites.pmdcollab.org) · CC BY-NC 4.0");
    // PMD 에 그림이 없는 종은 걷기 대체 그림으로 선다 (src/main/art/overworld-art.ts) — 받아 둔 것이 있으면 출처를 보여 준다
    const walk = path.join(PATHS.overworld, `${slug.replace(/-/g, "_")}.png`);
    if (!fs.existsSync(zip) && fs.existsSync(walk)) {
      say("  대체 그림: rh-hideout/pokeemerald-expansion 의 걷기 그림 (https://github.com/rh-hideout/pokeemerald-expansion)");
      say("  그림 저작권은 Nintendo · Creatures · GAME FREAK 에 있다. 제작자 목록은 README 의 출처 절에 있다");
    }
  }

  const companion = companionPid();
  say(`\n동반자: ${companion ? `떠 있음 (pid ${companion}) — 내리기: pokebuddy companion stop` : "없음 — 띄우기: pokebuddy companion"}`);

  // 게임 진행 — 저장 내용은 읽지 않는다. 앱이 암호화한다(src/save/crypt.ts, cloud-authority D18). 있는지만 본다
  say(`\n게임: ${fs.existsSync(PATHS.save) ? "저장 있음" : "저장 없음 — 처음 띄울 때 스타터를 고른다"} (${PATHS.save})`);
}
