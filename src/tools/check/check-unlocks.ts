// 해금 사슬 보고 — npm run build 뒤 node dist/tools/check/check-unlocks.js
//
// 모든 종이 실제로 얻어질 수 있는지 보고한다 (src/dex/reach.ts). 막지 않고 알리기만 한다 —
// 전설·환상·울트라비스트 종의 입수 경로는 스펙에서 아직 정하지 않았다 (docs/specs/game.md "이후 획득").
// 막아야 하는 규칙(첫 선택 후보 도달, 진화 규칙의 출발 종이 도감에 있음)은 selftest-unlocks 가 본다
import { reachReport } from "../../dex/reach";
import { empty } from "../../save/v3";
import { dexList } from "../../view/dex-list";

const r = reachReport();
const all = dexList(empty(0)).map((e) => e.slug);
const obtainable = all.filter((s) => r.obtainable.has(s));
const noPath = all.filter((s) => !r.obtainable.has(s));
process.stdout.write(`종 ${all.length} · 얻을 수 있음 ${obtainable.length} · 경로 없음 ${noPath.length}\n`);
process.stdout.write(`해금 규칙이 있는 종 ${r.withRule.length} · 그중 끊긴 사슬 ${r.unreachable.length}\n`);
process.stdout.write(`진화 규칙의 출발 종이 규칙·알 어디에도 없는 종 ${r.brokenFrom.length} (출발 종이 전설·환상·울트라비스트라 해금 규칙이 없다)\n`);
process.stdout.write(`경로 없음 앞 40: ${noPath.slice(0, 40).join(", ")}\n`);
