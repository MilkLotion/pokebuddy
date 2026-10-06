// 문서 위치·파일 링크·백틱 경로·JSON 구문 검사. 문장 의미와 STE 준수는 수동 검수.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const docs = path.join(root, 'docs');
// 작업 기록 — 저장소 밖(.gitignore). 있으면 링크를 검사하고, 공개 문서가 이곳을 가리키지 않는지 본다 (2026-09-27 문서 구조 개편)
const worklog = path.join(root, 'worklog');
const allowedRootFiles = new Set(['README.md', 'design.md', 'terms.md', 'guide.md']);
const allowedRootDirectories = new Set(['specs', 'contributing', 'images']);
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

// \uC904\uBC14\uAFC8\uC744 LF \uB85C \uB9DE\uCDB0 \uC77D\uB294\uB2E4. Windows \uB294 core.autocrlf \uB85C CRLF \uB97C \uBC1B\uC544 \uC808 \uAC80\uC0AC\uAC00 \uC5B4\uAE0B\uB09C\uB2E4
function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function display(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

for (const entry of fs.readdirSync(docs, { withFileTypes: true })) {
  const allowed = entry.isDirectory() ? allowedRootDirectories : allowedRootFiles;
  if (!allowed.has(entry.name)) failures.push(`문서 루트 위치 오류: docs/${entry.name}`);
}
for (const name of allowedRootFiles) {
  if (!fs.existsSync(path.join(docs, name))) failures.push(`필수 문서 누락: docs/${name}`);
}

const publicFiles = walk(docs);
const worklogFiles = fs.existsSync(worklog) ? walk(worklog) : [];
const allFiles = [...publicFiles, ...worklogFiles];
const isPublic = (file) => !file.startsWith(worklog + path.sep);
const documents = [
  ...allFiles.filter((file) => /\.(md|html)$/.test(file)),
  path.join(root, 'AGENTS.md'),
  path.join(root, 'README.md'),
];
let checkedLinks = 0;
for (const file of documents) {
  // 코드 예제의 문자열은 실제 문서 링크로 취급하지 않음.
  let content = read(file).replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
  if (file.endsWith('.html')) {
    // 스크립트의 HTML 템플릿 문자열은 정적 파일 참조가 아님.
    content = content.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
  }
  const links = [...content.matchAll(/\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]);
  links.push(...[...content.matchAll(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm)].map((match) => match[1]));
  if (file.endsWith('.html')) {
    links.push(...[...content.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map((match) => match[1]));
  }
  for (let link of links) {
    link = link.replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(link)) continue;
    let target;
    try {
      target = decodeURIComponent(link.split(/[?#]/)[0]);
    } catch {
      failures.push(`링크 인코딩 오류: ${display(file)} → ${link}`);
      continue;
    }
    if (!target) continue;
    const absolute = target.startsWith('/')
      ? path.join(root, target)
      : path.resolve(path.dirname(file), target);
    checkedLinks++;
    // 공개 문서(docs/·README·AGENTS)는 저장소에 없는 작업 기록을 가리키지 않는다 — 클론에서 끊긴다
    if (isPublic(file) && (absolute === worklog || absolute.startsWith(worklog + path.sep))) failures.push(`공개 문서가 작업 기록을 가리킴: ${display(file)} → ${link}`);
    else if (!fs.existsSync(absolute)) failures.push(`파일 링크 누락: ${display(file)} → ${link}`);
  }
}

// 공개 문서(docs/)의 백틱 안 저장소 경로 — 파일 링크가 아닌 `src/…` 글자도 트리에 있어야 한다 (2026-10-04 코드 구조 정리 뒤 옛 경로 100여 곳이 남았다)
// - 저장소 꼭대기 폴더로 시작하는 글자만 본다. 글롭(*)·자리표시(<>)·빌드 산출물(dist/)·로컬 전용 폴더는 보지 않는다
// - `pet.ts` 처럼 앞 경로에 기대는 짧은 이름은 보지 않는다
// - 옛 꼭대기 폴더 art·lib·cli 는 넣지 않는다. src/main/art/ 를 줄여 쓴 `art/` 와 구별하지 못한다(옛 자리는 2026-10-04 정리에서 모두 고쳤다)
const PATH_ROOTS = /^(src|scripts|data|bin|helpers|supabase|assets|site|shell)\//;
const PATH_SKIP = /[*<>{}$]/;
const LOCAL_ONLY = new Set([
  'helpers/winbounds', // npm install 이 만드는 mac 헬퍼 실행 파일
  'shell/termimon.zsh', // 옛 이름 — development.md 가 옮기는 법을 적는다
  'shell/pkmon.zsh',
]);
let checkedPaths = 0;
for (const file of publicFiles.filter((file) => file.endsWith('.md'))) {
  const content = read(file).replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    for (let token of match[1].split(/[\s,·]+/)) {
      token = token.replace(/^[("']+|[)"'.;:]+$/g, '').replace(/:\d+(?:-\d+)?$/, '').replace(/#.*$/, '');
      if (!PATH_ROOTS.test(token) || PATH_SKIP.test(token) || LOCAL_ONLY.has(token)) continue;
      checkedPaths++;
      if (!fs.existsSync(path.join(root, token))) failures.push(`백틱 경로 누락: ${display(file)} → ${token}`);
    }
  }
}

const jsonFiles = allFiles.filter((file) => file.endsWith('.json'));
for (const file of jsonFiles) {
  try {
    JSON.parse(read(file));
  } catch (error) {
    failures.push(`JSON 구문 오류: ${display(file)}: ${error.message}`);
  }
}

// 작업 기록 본문 — worklog/records/<작업>/<작업>.md (공개 문서와 이름이 겹치면 <작업>-record.md). Obsidian 그래프에서 이름이 겹치지 않게 (2026-10-07)
const isRecordMain = (file) => {
  const parts = display(file).split('/');
  if (parts.length !== 4 || parts[0] !== 'worklog' || parts[1] !== 'records') return false;
  return parts[3] === `${parts[2]}.md` || parts[3] === `${parts[2]}-record.md`;
};
// worklog 의 Markdown 이름은 하나뿐이어야 한다 — record.md·README.md 금지, 공개 문서·다른 기록과 겹침 금지
const mdNames = new Map();
for (const file of allFiles.filter((file) => file.endsWith('.md'))) {
  const name = path.basename(file).toLowerCase();
  mdNames.set(name, [...(mdNames.get(name) ?? []), file]);
}
for (const file of worklogFiles.filter((file) => file.endsWith('.md'))) {
  const name = path.basename(file).toLowerCase();
  if (name === 'record.md' || name === 'readme.md') failures.push(`작업 기록 이름 금지: ${display(file)} → <작업>.md 처럼 고유한 이름`);
  else if ((mdNames.get(name) ?? []).length > 1) failures.push(`작업 기록 이름 겹침: ${display(file)} ↔ ${mdNames.get(name).filter((other) => other !== file).map(display).join(', ')}`);
}

for (const file of allFiles.filter(isRecordMain)) {
  const content = read(file);
  for (const section of ['설계', '작업', '검수', '피드백과 수정']) {
    if (!content.includes(`\n## ${section}\n`)) failures.push(`작업 기록 절 누락: ${display(file)} → ${section}`);
  }
}

if (failures.length > 0) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write(`PASS: 문서 ${documents.length}개, 파일 링크 ${checkedLinks}개, 백틱 경로 ${checkedPaths}개, JSON ${jsonFiles.length}개.\n`);
  process.stdout.write('구조 검사만 통과했습니다. 변경 문장의 의미 검수를 별도로 기록하세요.\n');
}
