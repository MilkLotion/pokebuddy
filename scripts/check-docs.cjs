// 문서 위치·파일 링크·JSON 구문 검사. 문장 의미와 STE 준수는 수동 검수.
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

const jsonFiles = allFiles.filter((file) => file.endsWith('.json'));
for (const file of jsonFiles) {
  try {
    JSON.parse(read(file));
  } catch (error) {
    failures.push(`JSON 구문 오류: ${display(file)}: ${error.message}`);
  }
}

for (const file of allFiles.filter((file) => file.endsWith(`${path.sep}record.md`))) {
  if (!display(file).startsWith('worklog/records/')) continue;
  const content = read(file);
  for (const section of ['설계', '작업', '검수', '피드백과 수정']) {
    if (!content.includes(`\n## ${section}\n`)) failures.push(`작업 기록 절 누락: ${display(file)} → ${section}`);
  }
}

if (failures.length > 0) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write(`PASS: 문서 ${documents.length}개, 파일 링크 ${checkedLinks}개, JSON ${jsonFiles.length}개.\n`);
  process.stdout.write('구조 검사만 통과했습니다. 변경 문장의 의미 검수를 별도로 기록하세요.\n');
}
