// 도감 설명의 한국어 보충분(data/dex-text.ko.json)을 만든다 — 개발용, 네트워크 필요
//   node scripts/fetch-dex-ko.cjs [시작 view 번호]
// PokeAPI 에는 899번부터 한국어 설명문이 없다(src/tools/build-dex-text.ts). 그 종만 포켓몬코리아 공식 도감에서 가져온다.
//   출처: https://pokemonkorea.co.kr/pokedex/view/<view 번호> — view 번호는 도감 번호가 아니다. 모습마다 한 쪽이고 `다음` 링크로 이어진다
//   시작 view 번호(기본 1017 = No. 0803)에서 `다음` 으로 넘기며 No. 899~1025 를 모은다. 번호가 줄어들면(끝에서 1번으로 돈다) 멈춘다
//   종마다 처음 나온 모습의 쪽을 쓴다. 설명이 둘이면 뒤의 것(PokeAPI 의 "가장 최근 버전"과 같은 쪽)을 쓴다. `※` 로 시작하는 사이트 안내는 뺀다
// 만든 뒤 `npm run build && node dist/tools/build-dex-text.js` 로 data/dex-text.json 에 합친다
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'data', 'dex-text.ko.json');
const FROM = 899;
const TO = 1025;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(id) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://pokemonkorea.co.kr/pokedex/view/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.ok) return await r.text();
    } catch {
      // 다시 받는다
    }
    await sleep(1500);
  }
  throw new Error(`받지 못함: view ${id}`);
}

function parse(html) {
  const head = /<h3><p class="font-lato">No\. (\d+)<\/p>/.exec(html);
  const desc = [...html.matchAll(/<p class="para descript"[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/※.*$/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const next = /<a href="\/pokedex\/view\/(\d+)" class="right">/.exec(html);
  return { no: head ? Number(head[1]) : null, desc, next: next ? Number(next[1]) : null };
}

async function main() {
  let id = Number(process.argv[2] || 1017);
  let last = 0;
  const found = {};
  while (id) {
    const page = parse(await get(id));
    if (page.no == null) throw new Error(`도감 번호를 읽지 못함: view ${id}`);
    if (page.no < last) break; // 끝에서 1번으로 돌았다
    last = page.no;
    if (page.no >= FROM && page.no <= TO && !found[page.no] && page.desc.length) found[page.no] = page.desc[page.desc.length - 1];
    if (page.no > TO) break;
    id = page.next;
    await sleep(250);
  }
  const missing = [];
  for (let n = FROM; n <= TO; n++) if (!found[n]) missing.push(n);
  if (missing.length) throw new Error(`설명을 못 찾은 번호: ${missing.join(', ')}`);
  const lines = [
    `"_comment": ${JSON.stringify('한국어 설명문 보충 — PokeAPI 에 한국어가 없는 899~1025번. 출처는 포켓몬코리아 공식 도감(pokemonkorea.co.kr/pokedex). scripts/fetch-dex-ko.cjs 가 만든다. src/tools/build-dex-text.ts 가 data/dex-text.json 에 합친다')}`,
    ...Object.keys(found).sort((a, b) => a - b).map((n) => `${JSON.stringify(n)}: ${JSON.stringify(found[n])}`),
  ];
  fs.writeFileSync(OUT, `{\n${lines.join(',\n')}\n}\n`);
  process.stdout.write(`한국어 설명 보충: ${OUT} — ${Object.keys(found).length}종\n`);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
