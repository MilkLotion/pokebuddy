// 걷기 대체 그림(src/main/overworld-art.ts)을 실제 주소에서 받아 본다 — 개발용, 네트워크 필요. 배포 패키지에는 들어가지 않는다.
//
//   npm run build && node dist/tools/check-overworld.js                  PMD 에 그림이 없는 35종 (2026-10-02 조사)
//   npm run build && node dist/tools/check-overworld.js pikachu eevee    고른 종만
//
// OVERWORLD_RULES.ref(릴리스 태그)를 올릴 때 다시 돌린다. 확인 (worklog/records/fallback-art/record.md 수용 조건)
//   1. overworld.png · overworld_normal.pal · overworld_shiny.pal 을 받는다
//   2. 왼쪽 위 점이 팔레트 0번이다 — 0번을 배경으로 지우는 규칙의 근거
//   3. 그림이 쓰는 번호가 두 팔레트 파일에 모두 있다 — 팔레트 파일의 같은 번호 색으로 칠하는 규칙의 근거
//   4. 보통·이로치 모두 시트로 만들어진다
// PNG 에 든 팔레트가 overworld_normal.pal 과 다른 종은 알리기만 한다(어긋남 아님) — 앱은 팔레트 파일의 색을 쓴다
// 결과는 출력만 한다. 어긋남이 있으면 종료 코드 1
import { overworldArt, overworldUrl, parsePal } from "../main/overworld-art";
import { decodePng } from "../main/png";

// PMD ZIP 을 앱 로더로 읽지 못한 등장 종 — worklog/records/fallback-art/evidence/fallback-survey.json
const MISSING = [
  "simisear", "simipour", "tranquill", "blitzle", "zebstrika", "throh", "crustle", "carracosta", "amoonguss", "frillish", "shelmet", "bouffalant",
  "pyroar",
  "trumbeak", "gumshoos", "shiinotic", "oranguru",
  "rolycoly", "carkol", "coalossal", "mr-rime", "falinks", "cufant",
  "squawkabilly", "maschiff", "mabosstiff", "shroodle", "brambleghast", "toedscruel", "klawf", "rabsca", "espathra", "bombirdier", "flamigo", "gimmighoul",
];

async function get(url: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return null;
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      // 다시 시도
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return null;
}

// PNG 의 PLTE 조각 → 번호 순 RGB
function plte(png: Buffer): number[][] {
  for (let at = 8; at + 8 <= png.length; ) {
    const len = png.readUInt32BE(at);
    const name = png.toString("ascii", at + 4, at + 8);
    if (name === "PLTE") {
      const out: number[][] = [];
      for (let i = 0; i + 2 < len; i += 3) out.push([png[at + 8 + i]!, png[at + 9 + i]!, png[at + 10 + i]!]);
      return out;
    }
    if (name === "IDAT") break;
    at += 12 + len;
  }
  return [];
}

async function main(): Promise<void> {
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : MISSING;
  const problems: string[] = [];
  const differs: string[] = []; // PNG 에 든 팔레트가 보통 팔레트 파일과 다른 종
  let made = 0;
  for (const slug of slugs) {
    const [png, shiny, normal] = await Promise.all(["overworld.png", "overworld_shiny.pal", "overworld_normal.pal"].map((f) => get(overworldUrl(slug, f))));
    if (!png) {
      problems.push(`${slug}: overworld.png 를 못 받았다`);
      continue;
    }
    const img = decodePng(png);
    const corner = img?.idx ? img.idx[0] : -1;
    if (corner !== 0) problems.push(`${slug}: 왼쪽 위 점이 팔레트 ${corner}번이다`);
    const pal = normal ? parsePal(normal.toString("utf8")) : null;
    const shinyPal = shiny ? parsePal(shiny.toString("utf8")) : null;
    const own = plte(png);
    const used = [...new Set(img?.idx ?? [])].sort((a, b) => a - b);
    if (!pal) problems.push(`${slug}: overworld_normal.pal 을 못 받았다`);
    else if (used.some((i) => !pal[i])) problems.push(`${slug}: 그림이 쓰는 번호가 overworld_normal.pal 에 없다`);
    if (!shinyPal) problems.push(`${slug}: overworld_shiny.pal 을 못 받았다`);
    else if (used.some((i) => !shinyPal[i])) problems.push(`${slug}: 그림이 쓰는 번호가 overworld_shiny.pal 에 없다`);
    const same = !!pal && used.every((i) => pal[i] && own[i] && own[i]!.every((v, k) => v === pal[i]![k]));
    if (!same) differs.push(slug);
    const plain = overworldArt(png, normal ?? null, slug);
    const alt = shiny ? overworldArt(png, shiny, slug) : null;
    if (!plain) problems.push(`${slug}: 보통 시트를 못 만들었다`);
    else made++;
    if (shiny && !alt) problems.push(`${slug}: 이로치 시트를 못 만들었다`);
    else if (alt) made++;
    process.stdout.write(
      `${slug.padEnd(14)} ${img ? `${img.w}x${img.h} ${img.w / img.h}칸` : "해석 실패"} · 쓰는 색 ${used.length} · PNG 팔레트 ${same ? "같음" : "다름"} · 몸 ${plain ? `${plain.body.w}x${plain.body.h}` : "-"} · 이로치 ${alt ? "됨" : "안 됨"}\n`,
    );
  }
  process.stdout.write(`\n${slugs.length}종 · 만든 시트 ${made}/${slugs.length * 2}\n`);
  if (differs.length) process.stdout.write(`PNG 팔레트가 보통 팔레트 파일과 다른 종 ${differs.length}: ${differs.join(", ")}\n`);
  if (problems.length) {
    process.stdout.write(`어긋남 ${problems.length}건\n${problems.map((p) => `  ${p}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("어긋남 없음\n");
}

void main();
