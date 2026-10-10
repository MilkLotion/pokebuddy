// 웹 가이드 만들기 — docs/guide.md 하나를 정적 HTML 한 쪽으로 바꾼다. GitHub Pages 배포(.github/workflows/pages.yml)가 돌린다
// - 원본은 docs/guide.md 하나뿐이다. 웹 가이드만 고치지 않는다 (2026-10-10 사용자 "설치부터 전부")
// - guide.md 가 쓰는 마크다운만 다룬다: 제목 #~####(목차에는 ##·### 만), 문단, 목록(-, 1. 두 칸 들여쓰기), 표, 그림, 인라인 코드·링크·굵게, HTML 주석
// - 상대 링크(specs/…·contributing/…·../README.md)는 GitHub 저장소 주소로, 그림은 출력 폴더 images/ 로 복사한다
// - 새 패키지 없이 node 기본 모듈만 쓴다
// 실행: node scripts/build-guide-site.cjs [출력 폴더, 기본 site/guide]
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'guide.md');
const OUT = path.resolve(ROOT, process.argv[2] || 'site/guide');
const REPO = 'https://github.com/MilkLotion/pokebuddy';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// GitHub 과 같은 제목 앵커 — 소문자, 문장 부호 빼기, 빈칸은 -
const slug = (s) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

const images = new Set();

// 링크 주소 — 저장소 안 상대 경로는 GitHub 주소로. 같은 쪽 앵커와 바깥 주소는 그대로
function href(url) {
  if (/^(https?:|mailto:|#)/.test(url)) return url;
  const [file, hash] = url.split('#');
  const abs = path.posix.normalize(path.posix.join('docs', file));
  if (abs === 'docs/guide.md') return hash ? `#${hash}` : '#';
  return `${REPO}/blob/main/${abs}${hash ? `#${hash}` : ''}`;
}

// 인라인 — 코드 조각을 먼저 떼어 두고, 그림·링크·굵게를 바꾼 뒤 되돌린다
function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    images.add(src);
    return `<img src="${src}" alt="${alt}" loading="lazy">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const to = href(url.replace(/&amp;/g, '&'));
    const outside = /^https?:/.test(to) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${esc(to)}"${outside}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

// 표 한 줄 — 앞뒤 | 를 떼고 \| 는 글자로 둔다
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

function render(md) {
  const lines = md.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = [];
  const toc = [];
  let title = 'pokebuddy';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      if (level === 1) title = text;
      else {
        const id = slug(text);
        if (level <= 3) toc.push({ level, text, id });
        out.push(`<h${level} id="${esc(id)}">${inline(text)}</h${level}>`);
      }
      i += 1;
      continue;
    }
    // 표 — 머리 줄 다음이 --- 구분 줄
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push('<div class="table"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    // 목록 — 들여쓰기 두 칸마다 한 단계. 이어지는 줄은 앞 항목에 붙인다
    if (/^\s*(-|\d+\.)\s+/.test(line)) {
      const stack = [];
      while (i < lines.length && lines[i].trim() && !/^#{1,4}\s/.test(lines[i]) && !lines[i].trim().startsWith('|')) {
        const m = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m) {
          out.push(` ${inline(lines[i].trim())}`);
          i += 1;
          continue;
        }
        const depth = Math.floor(m[1].length / 2);
        const tag = m[2] === '-' ? 'ul' : 'ol';
        while (stack.length > depth + 1) out.push(`</li></${stack.pop()}>`);
        if (stack.length === depth + 1) {
          if (stack[depth] !== tag) { out.push(`</li></${stack.pop()}>`); out.push(`<${tag}>`); stack.push(tag); }
          else out.push('</li>');
        } else while (stack.length < depth + 1) { out.push(`<${tag}>`); stack.push(tag); }
        out.push(`<li>${inline(m[3])}`);
        i += 1;
      }
      while (stack.length) out.push(`</li></${stack.pop()}>`);
      continue;
    }
    // 그림만 있는 줄
    if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(line.trim())) {
      out.push(`<figure>${inline(line.trim())}</figure>`);
      i += 1;
      continue;
    }
    // 문단 — 빈 줄·제목·목록·표 앞까지 이어 붙인다
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,4}\s/.test(lines[i]) && !/^\s*(-|\d+\.)\s+/.test(lines[i]) && !lines[i].trim().startsWith('|')) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return { title, toc, body: out.join('\n') };
}

function tocHtml(toc) {
  const items = [];
  let open = false;
  for (const t of toc) {
    if (t.level === 2) {
      if (open) items.push('</ul></li>');
      items.push(`<li><a href="#${esc(t.id)}">${inline(t.text)}</a><ul>`);
      open = true;
    } else items.push(`<li><a href="#${esc(t.id)}">${inline(t.text)}</a></li>`);
  }
  if (open) items.push('</ul></li>');
  return `<ul>${items.join('')}</ul>`.replace(/<ul><\/ul>/g, '');
}

const CSS = `
:root { --bg: #f0efea; --card: #ffffff; --ink: #1a3330; --sub: #5c6f6c; --line: #dcdcd4; --accent: #1e7a6c; --tone: #e2efec; }
@media (prefers-color-scheme: dark) { :root { --bg: #141c1b; --card: #1c2726; --ink: #e6eeec; --sub: #9db0ad; --line: #2c3a38; --accent: #2aa593; --tone: #203533; } }
* { box-sizing: border-box; }
html { scroll-padding-top: 16px; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.7 system-ui, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; }
a { color: var(--accent); }
.wrap { display: grid; grid-template-columns: 240px minmax(0, 760px); gap: 32px; max-width: 1080px; margin: 0 auto; padding: 32px 20px 64px; }
nav { position: sticky; top: 16px; align-self: start; max-height: calc(100vh - 32px); overflow: auto; font-size: 13px; }
nav ul { list-style: none; margin: 0; padding: 0; }
nav > ul > li { margin: 6px 0; }
nav > ul > li > a { font-weight: 600; color: var(--ink); }
nav ul ul { padding-left: 12px; }
nav ul ul a { color: var(--sub); }
nav a { text-decoration: none; display: block; padding: 2px 0; }
nav a:hover { color: var(--accent); }
main { min-width: 0; }
header.top { margin-bottom: 24px; }
header.top h1 { margin: 0 0 4px; font-size: 28px; }
header.top p { margin: 0; color: var(--sub); }
h2 { margin: 48px 0 12px; padding-top: 8px; font-size: 22px; border-top: 1px solid var(--line); }
h3 { margin: 28px 0 8px; font-size: 17px; }
h4 { margin: 20px 0 6px; font-size: 15px; }
p, li { word-break: keep-all; overflow-wrap: anywhere; }
ul, ol { padding-left: 22px; }
li { margin: 4px 0; }
code { font: 13px/1.4 ui-monospace, Consolas, monospace; background: var(--tone); padding: 1px 5px; border-radius: 4px; }
.table { overflow-x: auto; margin: 12px 0; }
table { border-collapse: collapse; width: 100%; background: var(--card); border-radius: 8px; overflow: hidden; font-size: 14px; }
th, td { border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
th { background: var(--tone); }
td code, th code { white-space: nowrap; }
figure { margin: 16px 0; }
figure img { max-width: 100%; border-radius: 8px; border: 1px solid var(--line); }
footer { margin-top: 48px; font-size: 12px; color: var(--sub); }
@media (max-width: 860px) {
  .wrap { grid-template-columns: 1fr; gap: 16px; padding-top: 20px; }
  nav { position: static; max-height: none; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; }
  nav ul ul { display: none; }
}
`;

function main() {
  const { title, toc, body } = render(fs.readFileSync(SRC, 'utf8'));
  const html = `<!doctype html>
<!-- 만든 파일 — 고치지 말 것. 원본은 docs/guide.md, 만드는 곳은 scripts/build-guide-site.cjs -->
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<nav aria-label="목차">${tocHtml(toc)}</nav>
<main>
<header class="top"><h1>${esc(title)}</h1><p><a href="${REPO}/releases/latest" target="_blank" rel="noopener">최신 버전 받기</a> · <a href="${REPO}" target="_blank" rel="noopener">GitHub 저장소</a></p></header>
${body}
<footer>pokebuddy 는 팬이 만든 비공식 앱이에요. Nintendo · Creatures Inc. · GAME FREAK inc. · The Pokémon Company 와 제휴하지 않았어요.<br>포켓몬의 권리는 Nintendo · Creatures Inc. · GAME FREAK inc. 에 있어요.</footer>
</main>
</div>
</body>
</html>
`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  for (const src of images) {
    const from = path.join(ROOT, 'docs', src);
    if (!fs.existsSync(from)) throw new Error(`그림 없음: docs/${src}`);
    fs.mkdirSync(path.dirname(path.join(OUT, src)), { recursive: true });
    fs.copyFileSync(from, path.join(OUT, src));
  }
  console.log(`웹 가이드: ${path.relative(ROOT, OUT)}/index.html · 제목 ${toc.length}개 · 그림 ${images.size}개`);
}

main();
