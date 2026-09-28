// pokebuddy status — 동반자가 이상하게 보일 때 지금 판정 상태를 한 번에 보여 준다.
// 경로·설정·판정은 전부 공통 모듈에서 온다 — 동반자와 같은 코드를 쓴다 (두 벌이면 진단이 거짓말을 한다)
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const settings = require("../config.js");
const state = require("../dist/follow/state.js");
const front = require("../dist/follow/front.js");
const dex = require("../lib/dex.js");
const { parseCredits } = require("../art/pmd-load.js");
const { companionPid } = require("./run.js");
const { hookInstalled } = require("./setup.js");
const i18n = require("../lib/i18n.js");
const { petName } = require("../lib/names.js");

const PROJECT = path.join(__dirname, "..");
const { PATHS, USER_DEFAULTS } = settings;

const say = (line = "") => process.stdout.write(`${line}\n`);
const age = (at) => (Date.now() / 1000 - (at || 0)).toFixed(1);

function status(petArg) {
  const config = settings.load();

  say(`설정 파일: ${PATHS.config}`);
  say(`  ${Object.keys(USER_DEFAULTS).map((k) => `${k}=${config[k]}`).join(" ")}`);

  // 설치 상태 — 훅이 없는 CLI 에서는 상태별 동작 없이 기본 동작(산책·수면)만 돈다
  const hooks = hookInstalled();
  say(`상태 훅 파일: ${!hooks.file ? "없음 — pokebuddy setup" : hooks.current ? "최신" : "옛 버전 — pokebuddy setup 으로 바꾼다"}`);
  for (const cli of hooks.clis) {
    const head = `  ${cli.name.padEnd(12)}`;
    if (!cli.used) say(`${head}안 씀 (설정 폴더 없음)`);
    else if (cli.error) say(`${head}${cli.error}`);
    // 연결은 설정창 → 사용자 → 연결 탭에서만 한다 (setup 은 등록하지 않는다)
    else if (!cli.registered && !(cli.stale || []).length) say(`${head}연결 안 됨 — 설정창 → 사용자 → 연결 탭`);
    else if (cli.registered < cli.total || (cli.stale || []).length) say(`${head}갱신 필요 (${cli.registered}/${cli.total}) — 설정창 → 사용자 → 연결 탭의 갱신`);
    else say(`${head}연결됨 (${cli.registered}/${cli.total})`);
  }

  // 동반자가 스스로 끝난 이유 — 동반자의 출력은 평소 버려지므로 여기서만 보인다
  try {
    const e = JSON.parse(fs.readFileSync(PATHS.lastError, "utf8"));
    if (e.reason !== "starter-cancelled") say(`마지막 실패: ${e.slug} — ${e.message} (${Math.round(Number(age(e.at)) / 60)}분 전)`);
  } catch {
    // 실패 기록 없음
  }

  const records = state.readStateRecords(PATHS.state);

  // 맨 앞 창과 그 창이 터미널 호스트인지 — 동반자와 같은 판정 (follow/front hostOf)
  try {
    const [cmd, args] =
      process.platform === "win32"
        ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(PROJECT, "helpers", "winbounds.ps1")]]
        : [path.join(PROJECT, "helpers", "winbounds"), []];
    const info = JSON.parse(execFileSync(cmd, args, { encoding: "utf8", windowsHide: true }));
    // 이 명령을 띄운 창이 맨 앞이다 — 펫 자신을 가리는 표는 필요 없다
    const top = front.frontWindow(info, info.windows);
    const host = front.hostOf(top, records);
    const kind = !host ? "터미널 호스트가 아님 — 동반자는 마지막 자리에 남는다" : host.kind === "hook" ? "훅 기록이 있는 터미널 — 그 앱의 최신 세션을 따른다" : "알려진 터미널 — 아직 CLI 기록이 없어 대기";
    say(`\n지금 화면 맨 앞 창: ${top ? `${top.app} (pid ${top.pid})` : "없음"} — ${kind}`);
    if (host) say(`  동반자가 보일 동작: ${state.stateFor(records, host.pids).state}`);
  } catch {
    say("\n창 목록을 읽지 못했다 — 창 추적 헬퍼가 없거나 이 플랫폼에서 못 쓴다");
  }

  say(`\n세션 상태 기록 ${records.length}건 (최신순)${records.length ? "" : " — 훅을 설치한 뒤 CLI LLM 을 한 번 실행하면 생긴다"}`);
  for (const record of records.slice(0, 10)) {
    const prompt = record.promptAt ? `  프롬프트 ${age(record.promptAt)}초 전` : "";
    say(
      `  ${String(record.cli || "claude").padEnd(6)}  기록=${record.state} → 지금=${state.resolveState(record)}  ${age(record.at)}초 전${prompt}` +
        `  조상 ${Array.isArray(record.ancestors) ? record.ancestors.length : 0}개`,
    );
  }

  // PMD 그림 — CC BY-NC 4.0 이라 저작자 표시가 조건이다. 포켓몬마다 그린 사람이 다르다
  const slug = petArg || savedSpecies() || config.slug;
  const d = dex.dexPath(slug);
  say(`\nPMD 그림 (${slug}${d ? ` · 도감 ${d}` : ""}) — ${PATHS.pmd}`);
  if (!d) {
    say(`  도감 번호를 모름 — PMD 로는 못 그린다. 비슷한 이름: ${dex.suggest(slug).join(", ") || "없음"}`);
  } else {
    const zip = path.join(PATHS.pmd, `${d}.zip`);
    say(`  캐시: ${fs.existsSync(zip) ? `${Math.round(fs.statSync(zip).size / 1024)}KB` : "없음 — 처음 띄울 때 받는다"}`);
    let authors = [];
    try {
      authors = parseCredits(fs.readFileSync(path.join(PATHS.pmd, `${d}.credits.txt`), "utf8"));
    } catch {
      // 저작자 목록을 아직 못 받음
    }
    const names = [...new Set(authors.map((a) => a.author))];
    say(`  그린 사람: ${names.length ? names.join(", ") : "목록 없음"}`);
    say("  출처: PMDCollab/SpriteCollab (https://sprites.pmdcollab.org) · CC BY-NC 4.0");
  }

  const companion = companionPid();
  say(`\n동반자: ${companion ? `떠 있음 (pid ${companion}) — 내리기: pokebuddy companion stop` : "없음 — 띄우기: pokebuddy companion"}`);

  // 게임 진행 — 저장 v3 를 읽기 전용으로 본다 (쓰는 쪽은 떠 있는 동반자). repair:false — 파손 파일을 옮기는 것은 writer 의 일.
  // 옛 v2 파일이면 읽는 값만 v3 로 옮겨 보인다
  try {
    const { state: save, corrupted, reason } = require("../dist/save/store.js").read(PATHS.save, { repair: false });
    const { nature } = require("../dist/dex/natures.js");
    const lang = i18n.langOf(config);
    if (corrupted) say(`\n게임: 저장이 깨짐 — 동반자가 다음에 열 때 save.json.bak 으로 옮기고 새로 시작한다 (${PATHS.save})`);
    else if (reason === "unreadable") say(`\n게임: 저장을 읽지 못함 — 잠김·권한. 잠시 뒤 다시 (${PATHS.save})`);
    else if (!save) say(`\n게임: 저장 없음 — 처음 띄울 때 스타터를 고른다 (${PATHS.save})`);
    else {
      const open = save.party.slots.filter((s) => s.state !== "locked").length;
      const inParty = save.party.slots.filter((s) => s.state === "pokemon" && s.petId);
      say(`\n게임: 파티 칸 ${open} · 포인트 ${save.points.balance} · 파티 ${inParty.length}마리 · 전체 ${save.pets.length}마리 · 알 ${save.eggs.length}개 (${PATHS.save})`);
      // 파티의 마리마다 종 이름 · 성격(표의 이름, 모르면 id) · 보임 · 레벨 · 친밀도 · 만복도 · 기분
      const pets = inParty.map((slot) => {
        const p = save.pets.find((x) => x.id === slot.petId);
        if (!p) return null;
        const n = nature(p.nature);
        const natureLabel = (n && (n.name[lang] || n.name.ko)) || p.nature;
        return `${petName(p.species, lang)}(${natureLabel} · ${slot.hidden ? "숨김" : "보임"} · Lv.${p.level} · 친밀도 ${Math.floor(p.affinity)} · 만복도 ${Math.round(p.fullness)} · ${i18n.t("state.mood", { mood: i18n.moodWord(p.mood) })})`;
      }).filter(Boolean);
      if (pets.length) say(`  ${pets.join(", ")}`);
    }
  } catch (e) {
    say(`\n게임: 읽지 못함 — ${e.message}`);
  }
}

// 파티에서 꺼내 놓은 첫 마리의 종 — 없으면 null
function savedSpecies() {
  try {
    const { state: save } = require("../dist/save/store.js").read(PATHS.save, { repair: false });
    const slot = save ? save.party.slots.find((s) => s.state === "pokemon" && s.petId && !s.hidden) : null;
    const pet = slot ? save.pets.find((p) => p.id === slot.petId) : null;
    return pet ? pet.species : null;
  } catch {
    return null;
  }
}

module.exports = { status };
