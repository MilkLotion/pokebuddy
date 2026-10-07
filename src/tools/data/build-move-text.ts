// 기술 설명(data/move-text.ko.json — 기술 id → 한국어 설명문)을 만든다 — 개발용, 네트워크 필요. 배포 패키지에는 결과 JSON 만 들어간다.
//
//   npm run build && node dist/tools/data/build-move-text.js   (npm run data:build 가 차례로 돈다)
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
//   moves.csv               기술 번호 → 식별자 (data/moves.json 의 기술 id 와 같다)
//   move_flavor_text.csv    기술 번호 · 버전 그룹 → 언어별 설명문
//   version_groups.csv      버전 그룹 → 출시 순서(order)
//
// 결과: { "<기술 id>": "<설명문>" } — data/moves.json 의 기술만, 키 순서도 moves.json 과 같다
//   - 한국어 설명문이 있는 버전 그룹 가운데 order 가 가장 큰 것(가장 최근 게임)의 문장을 쓴다
//   - 줄바꿈·쪽바꿈·소프트 하이픈은 빈칸 하나로 바꿔 한 문단으로 둔다
//   - 한국어 설명문이 없는 기술은 키를 두지 않고 개수와 id 를 출력한다 — 문장을 지어내지 않는다
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, csv, runBuild, writeLineJson } from "./pokeapi-csv";

const OUT = path.join(DATA_DIR, "move-text.ko.json");
const MOVES = path.join(DATA_DIR, "moves.json");
const KO = "3";

const clean = (text: string): string => text.replace(/[\s\u000c­]+/g, " ").trim();

export async function build(): Promise<void> {
  const [moveRows, flavorRows, groupRows] = await Promise.all([
    csv("moves.csv", ["id", "identifier"]),
    csv("move_flavor_text.csv", ["move_id", "version_group_id", "language_id", "flavor_text"]),
    csv("version_groups.csv", ["id", "identifier", "order"]),
  ]);
  const ids = Object.keys(JSON.parse(fs.readFileSync(MOVES, "utf8")) as Record<string, unknown>).filter((k) => !k.startsWith("_"));
  const moveNo = new Map(moveRows.map((r) => [r.identifier, r.id]));
  const order = new Map(groupRows.map((r) => [r.id, Number(r.order)]));
  const groupName = new Map(groupRows.map((r) => [r.id, r.identifier]));

  // 기술 번호 → 가장 최근 버전 그룹의 한국어 문장
  const latest = new Map<string, { order: number; group: string; text: string }>();
  for (const r of flavorRows) {
    if (r.language_id !== KO || !r.flavor_text) continue;
    const o = order.get(r.version_group_id) ?? -1;
    if ((latest.get(r.move_id)?.order ?? -1) >= o) continue;
    latest.set(r.move_id, { order: o, group: r.version_group_id, text: clean(r.flavor_text) });
  }

  const out: Record<string, string> = {};
  const missing: string[] = [];
  const byGroup = new Map<string, number>();
  for (const id of ids) {
    const no = moveNo.get(id);
    const hit = no ? latest.get(no) : undefined;
    if (!hit) {
      missing.push(id);
      continue;
    }
    out[id] = hit.text;
    const g = groupName.get(hit.group) ?? hit.group;
    byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
  }

  writeLineJson(OUT, out);
  process.stdout.write(`기술 설명: ${OUT} — ${Object.keys(out).length} / ${ids.length}\n`);
  process.stdout.write(`버전 그룹: ${[...byGroup].map(([k, v]) => `${k} ${v}`).join(" · ")}\n`);
  process.stdout.write(`설명 없음 ${missing.length}${missing.length ? `: ${missing.join(", ")}` : ""}\n`);
  if (out["volt-tackle"]) process.stdout.write(`  volt-tackle ${JSON.stringify(out["volt-tackle"])}\n`);
}

if (require.main === module) runBuild(build);
