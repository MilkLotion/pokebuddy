// 샘플 파티 대 지정 파티 — 정한 6마리가 샘플마다 몇 % 이기고, 이긴 판에 HP 가 얼마나 남는지 잰다. 개발 도구이며 앱·서버에 들어가지 않는다
// 하 난이도 기준(이브이 진화형 파티가 간당간당하게 이긴다)을 맞출 때 쓴다 — 규칙은 docs/specs/adventure.md "샘플 파티"
//
//   npm run build && node dist/tools/battle/sample-vs.js --team vaporeon,espeon,umbreon,jolteon,sylveon,glaceon [--level easy] [--n 200] [--seed 1]
//
// --team 은 칸 순서(1~6번 칸)대로 쉼표로 잇는다. 2·4·6번 칸이 앞라인이다. 메가 모습은 종:메가슬러그(예: garchomp:garchomp-mega)
// 판마다 지정 파티가 건 쪽(0)과 받은 쪽(1)을 번갈아 맡는다. 무승부는 0.5승
// 남은 HP: 지정 파티가 이긴 판에서 지정 파티 6마리의 남은 HP 합 ÷ 최대 HP 합의 평균
import { runBattle, type EngineFighter } from "../../battle/engine";
import { battleTypeChart, buildFighter } from "../../battle/fighter";
import { battleSamples } from "../../battle/samples";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const N = Number(arg("n", "200"));
const SEED = Number(arg("seed", "1"));
const LEVEL = arg("level", "");
const TEAM = arg("team", "");
if (!TEAM) throw new Error("--team 이 필요하다");

const team: (EngineFighter | null)[] = TEAM.split(",").map((cell) => {
  const [species, form] = cell.trim().split(":");
  const f = buildFighter({ species: species!, ...(form ? { form } : {}) });
  if (!f) throw new Error(`전투 개체를 만들지 못했다: ${cell}`);
  return f;
});
if (team.length !== 6) throw new Error("--team 은 6마리다");

const chart = battleTypeChart();
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
process.stdout.write(`지정 파티 ${TEAM} · 샘플마다 ${N}판 · 시드 ${SEED}\n\n`);
process.stdout.write(`${"id".padEnd(10)} ${"승률".padStart(6)} ${"남은 HP".padStart(7)}\n`);
const rates: number[] = [];
for (const s of battleSamples().filter((x) => !LEVEL || x.level === LEVEL)) {
  const foe = s.slots.map((c) => buildFighter(c));
  let win = 0;
  let left = 0;
  let wins = 0;
  for (let i = 0; i < N; i++) {
    const mine = i % 2 === 0 ? 0 : 1;
    const r = runBattle({ seed: SEED * 104_729 + i, sides: mine === 0 ? [team, foe] : [foe, team], typeChart: chart });
    if (r.winner === null) win += 0.5;
    else if (r.winner === mine) {
      win += 1;
      wins += 1;
      const hp = r.hp[mine].reduce((a, b) => a + b, 0);
      const max = r.maxHp[mine].reduce((a, b) => a + b, 0);
      left += max ? hp / max : 0;
    }
  }
  rates.push(win / N);
  process.stdout.write(`${s.id.padEnd(10)} ${pct(win / N).padStart(6)} ${(wins ? pct(left / wins) : "—").padStart(7)}  ${s.name}\n`);
}
const avg = rates.reduce((a, b) => a + b, 0) / Math.max(1, rates.length);
process.stdout.write(`\n평균 승률 ${pct(avg)} · 최소 ${pct(Math.min(...rates))} · 최대 ${pct(Math.max(...rates))}\n`);
