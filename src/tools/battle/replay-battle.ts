// 배틀 재생 뷰어 — 엔진의 판을 브라우저에서 눈으로 보는 개발 도구. 앱·서버에 들어가지 않는다
//
//   npm run build && node dist/tools/battle/replay-battle.js [--seeds 6] [--hp 2,3] [--out <html 경로>]
//
// 같은 두 팀·같은 시드로 HP 배율만 바꾼 판을 나란히 고를 수 있다. 결과는 HTML 파일 하나(데이터 내장, 네트워크 없음)
// 포켓몬은 점과 이름으로 그린다. 화면 시안(Figma 99 Battle / Window)과는 다르다 — 판의 흐름과 길이를 보려는 것이다
import fs from "node:fs";
import path from "node:path";
import { ENGINE_RULES, runBattle, type EngineFighter } from "../../battle/engine";
import { battleTypeChart, buildFighter } from "../../battle/fighter";
import { tierOf } from "../../battle/tier";
import { isMetaKey } from "../../dex/data";
import { profileOf } from "../../dex/species";
import { moveTable, speciesMoveTable, speciesTable } from "../../dex/tables";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const ROOT = path.join(__dirname, "..", "..", "..");
const SEEDS = Number(arg("seeds", "6"));
const HPS = arg("hp", "2,3").split(",").map(Number);
const OUT = path.resolve(arg("out", path.join(ROOT, "worklog", "records", "battle-server", "evidence", "replay.html")));

const names = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "names.json"), "utf8")) as Record<string, { ko: string }>;
const moves = moveTable();
const pool: EngineFighter[] = [];
for (const slug of Object.keys(speciesTable())) {
  if (isMetaKey(slug) || !speciesMoveTable()[slug]) continue;
  if ((profileOf(slug).bst ?? 0) < 400 || tierOf(slug)) continue;
  const f = buildFighter({ species: slug, level: 100 });
  if (f) pool.push(f);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const chart = battleTypeChart();
const battles: unknown[] = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const rand = mulberry32(seed * 7919);
  const pick = (): EngineFighter[] => Array.from({ length: 6 }, () => pool[Math.floor(rand() * pool.length)]!);
  const sides = [pick(), pick()] as const;
  for (const hp of HPS) {
    const r = runBattle({ seed, sides, typeChart: chart, hpScale: hp });
    battles.push({
      label: `판 ${seed} · HP ×${hp} · ${(r.endMs / 1000).toFixed(1)}초 · ${r.winner === null ? "무승부" : r.winner === 0 ? "왼쪽 승" : "오른쪽 승"}${r.timeout ? " (90초 판정)" : ""}`,
      units: sides.map((team, s) =>
        team.map((f, slot) => ({
          name: names[f.species]?.ko ?? f.species,
          type: f.types[0],
          maxHp: r.maxHp[s]![slot],
          moves: f.moves.map((m) => moves[m.id]?.ko ?? m.id),
        })),
      ),
      endMs: r.endMs,
      events: r.events,
    });
  }
}

const moveNames: Record<string, string> = {};
for (const [id, m] of Object.entries(moves)) if (!isMetaKey(id) && m && typeof m === "object") moveNames[id] = m.ko;

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>배틀 재생</title>
<style>
  body { margin: 0; background: #1b1d22; color: #e8e8e8; font: 13px system-ui, sans-serif; }
  .bar { display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: #24272e; flex-wrap: wrap; }
  select, button { font: inherit; background: #33363f; color: inherit; border: 1px solid #444; border-radius: 4px; padding: 3px 8px; }
  input[type=range] { width: 360px; }
  #time { min-width: 90px; font-variant-numeric: tabular-nums; }
  canvas { display: block; margin: 12px auto; background: #2b3a2b; border-radius: 6px; }
  .note { text-align: center; color: #999; }
</style></head><body>
<div class="bar">
  <select id="pick"></select>
  <button id="play">일시정지</button>
  <select id="speed"><option value="1">1배</option><option value="2" selected>2배</option><option value="4">4배</option></select>
  <input id="seek" type="range" min="0" max="1000" value="0"><span id="time"></span>
</div>
<canvas id="cv"></canvas>
<div class="note">왼쪽 파랑 = 내 쪽, 오른쪽 빨강 = 상대. 위 막대 HP, 이름 아래 글자는 방금 쓴 기술. 회색 칸은 장애물.</div>
<script>
const BATTLES = ${JSON.stringify(battles)};
const MOVES = ${JSON.stringify(moveNames)};
const W = ${ENGINE_RULES.fieldW}, H = ${ENGINE_RULES.fieldH}, BODY = ${ENGINE_RULES.body}, STEP = ${ENGINE_RULES.stepMs};
const C = 36; // 계산 칸 한 칸의 픽셀
const TYPE = { normal:'#9fa19f', fire:'#e62829', water:'#2980ef', grass:'#3fa129', electric:'#fac000', ice:'#3dcef3', fighting:'#ff8000', poison:'#9141cb', ground:'#915121', flying:'#81b9ef', psychic:'#ef4179', bug:'#91a119', rock:'#afa981', ghost:'#704170', dragon:'#5060e1', dark:'#624d4e', steel:'#60a1b8', fairy:'#ef70ef' };
const cv = document.getElementById('cv'), g = cv.getContext('2d');
cv.width = W * C; cv.height = H * C + 24;
const pick = document.getElementById('pick'), seek = document.getElementById('seek'), timeEl = document.getElementById('time');
BATTLES.forEach((b, i) => pick.add(new Option(b.label, i)));
let cur, t = 0, playing = true, last = performance.now();

function load(i) { cur = BATTLES[i]; t = 0; seek.max = cur.endMs; }
pick.onchange = () => load(+pick.value);
document.getElementById('play').onclick = (e) => { playing = !playing; e.target.textContent = playing ? '일시정지' : '재생'; };
seek.oninput = () => { t = +seek.value; };
load(0);

// t 까지의 상태를 이벤트로 다시 쌓는다
function state(at) {
  const start = cur.events[0];
  const u = [0, 1].map((s) => cur.units[s].map((info, slot) => {
    const p = start.pos[s][slot];
    return p && { ...info, x: p.x, y: p.y, px: p.x, py: p.y, stepT: -1e9, hp: info.maxHp, fainted: -1, move: null, moveT: -1e9 };
  }));
  const pops = [];
  for (const e of cur.events) {
    if (e.t > at) break;
    const me = e.side !== undefined ? u[e.side][e.slot] : null;
    if (e.kind === 'step') { me.px = me.x; me.py = me.y; me.x = e.x; me.y = e.y; me.stepT = e.t; }
    else if (e.kind === 'move') { me.move = MOVES[e.move] || e.move; me.moveT = e.t; }
    else if (e.kind === 'charge') { me.move = (MOVES[e.move] || e.move) + ' 충전'; me.moveT = e.t; }
    else if (e.kind === 'damage') { const o = u[1 - e.side][e.target]; o.hp = e.hp; pops.push({ who: o, t: e.t, text: e.amount === 0 ? '효과 없음' : '-' + e.amount, mult: e.mult }); }
    else if (e.kind === 'miss') { pops.push({ who: u[1 - e.side][e.target], t: e.t, text: '빗나감', mult: 1 }); }
    else if (e.kind === 'self') { me.hp = e.hp; pops.push({ who: me, t: e.t, text: e.amount < 0 ? '+' + (-e.amount) : '-' + e.amount, mult: e.amount < 0 ? -1 : 1 }); }
    else if (e.kind === 'reflect') { const o = u[1 - e.side][e.target]; o.hp = e.hp; pops.push({ who: o, t: e.t, text: '반사 -' + e.amount, mult: 2 }); }
    else if (e.kind === 'blocked') { pops.push({ who: u[1 - e.side][e.target], t: e.t, text: '막음', mult: 0.5 }); }
    else if (e.kind === 'faint') { me.fainted = e.t; me.hp = 0; }
  }
  return { u, pops, obstacles: start.obstacles };
}

function draw() {
  const { u, pops, obstacles } = state(t);
  g.clearRect(0, 0, cv.width, cv.height);
  // 화면 칸 격자와 진영
  for (let x = 0; x < W / 2; x++) for (let y = 0; y < H / 2; y++) {
    g.fillStyle = x < 2 ? '#2c3550' : x >= W / 2 - 2 ? '#4a2c30' : ((x + y) % 2 ? '#2f3f2f' : '#2b3a2b');
    g.fillRect(x * 2 * C, y * 2 * C, 2 * C, 2 * C);
  }
  g.fillStyle = '#6b6b6b';
  for (const o of obstacles) g.fillRect(o.x * C + 1, o.y * C + 1, o.size * C - 2, o.size * C - 2);
  for (const s of [0, 1]) for (const p of u[s]) {
    if (!p) continue;
    if (p.fainted >= 0 && t - p.fainted > 1200) continue;
    const k = Math.min(1, (t - p.stepT) / STEP);
    const x = (p.px + (p.x - p.px) * k + BODY / 2) * C, y = (p.py + (p.y - p.py) * k + BODY / 2) * C;
    g.globalAlpha = p.fainted >= 0 ? 0.3 : 1;
    g.fillStyle = TYPE[p.type] || '#999';
    g.beginPath(); g.arc(x, y, C * 0.8, 0, Math.PI * 2); g.fill();
    g.lineWidth = 3; g.strokeStyle = s === 0 ? '#5aa0ff' : '#ff5a5a'; g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 12px system-ui'; g.textAlign = 'center';
    g.fillText(p.name, x, y + 4);
    // HP 막대
    const bw = C * 1.7, by = y - C * 1.05;
    g.fillStyle = '#111'; g.fillRect(x - bw / 2, by, bw, 6);
    const r = p.hp / p.maxHp;
    g.fillStyle = r > 0.5 ? '#5bd36b' : r > 0.2 ? '#f0c53a' : '#ef5350';
    g.fillRect(x - bw / 2, by, bw * r, 6);
    if (t - p.moveT < 900) {
      g.font = '11px system-ui'; const w = g.measureText(p.move).width + 10;
      g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(x - w / 2, y + C * 0.85, w, 16);
      g.fillStyle = '#ffe082'; g.fillText(p.move, x, y + C * 0.85 + 12);
    }
    g.globalAlpha = 1;
  }
  for (const d of pops) {
    const age = t - d.t; if (age > 800 || !d.who) continue;
    const p = d.who, k = Math.min(1, (t - p.stepT) / STEP);
    const x = (p.px + (p.x - p.px) * k + BODY / 2) * C, y = (p.py + (p.y - p.py) * k + BODY / 2) * C - C * 1.3 - age / 25;
    g.globalAlpha = 1 - age / 800;
    g.font = 'bold ' + (d.mult >= 2 ? 18 : d.mult < 1 && d.mult >= 0 ? 12 : 15) + 'px system-ui';
    g.fillStyle = d.mult < 0 ? '#7cf0c0' : d.mult >= 2 ? '#ffd54a' : d.mult < 1 ? '#bbb' : '#fff';
    g.textAlign = 'center'; g.fillText(d.text, x, y);
    g.globalAlpha = 1;
  }
  const alive = (s) => u[s].filter((p) => p && p.hp > 0).length;
  g.fillStyle = '#ddd'; g.font = '13px system-ui'; g.textAlign = 'left';
  g.fillText('왼쪽 ' + alive(0) + '마리', 8, H * C + 17);
  g.textAlign = 'right'; g.fillText('오른쪽 ' + alive(1) + '마리', cv.width - 8, H * C + 17);
  g.textAlign = 'center'; g.fillText(t >= cur.endMs ? cur.label : '남은 시간 ' + Math.max(0, Math.ceil((90000 - t) / 1000)) + '초', cv.width / 2, H * C + 17);
}

function frame(now) {
  if (playing && t < cur.endMs) t = Math.min(cur.endMs, t + (now - last) * +document.getElementById('speed').value);
  last = now;
  seek.value = t; timeEl.textContent = (t / 1000).toFixed(1) + ' / ' + (cur.endMs / 1000).toFixed(1) + '초';
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
process.stdout.write(`재생 파일: ${OUT} — ${battles.length}판\n`);
for (const b of battles as { label: string }[]) process.stdout.write(`  ${b.label}\n`);
