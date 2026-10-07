// 운영 upload-save 의 규칙 데이터가 지금 저장소와 같은지 본다 — 설치 파일을 만들기 전에 scripts/build-exe.cjs 가 부른다
//   앱이 규칙 데이터보다 먼저 나가면 정상 사용자의 올리기가 위반으로 적히고 trust 가 unverified 로 묶인다(2026-10-07 교환 막힘)
//   1. 로컬 복사본이 지금 규칙과 같은지 — dist/tools/data/build-verify.js --check (npm run build 뒤)
//   2. 운영 함수가 GET 으로 돌려준 지문이 로컬 verify-data.json 의 hash 와 같은지
// 다르면 종료 코드 1. 운영 함수를 먼저 배포한다: npx supabase functions deploy upload-save --use-api
//   node scripts/check-verify-deploy.cjs
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function stop(msg) {
  process.stderr.write(`규칙 데이터 배포 확인 실패: ${msg}\n`);
  process.exit(1);
}

async function main() {
  const builder = path.join(root, "dist", "tools", "data", "build-verify.js");
  if (!fs.existsSync(builder)) stop("dist 가 없다 — npm run build 뒤에 돌린다");
  try {
    execFileSync(process.execPath, [builder, "--check"], { stdio: "inherit" });
  } catch {
    stop("로컬 검증 파일이 지금 규칙과 다르다 — npm run verify:build 뒤 커밋하고 함수를 배포한다");
  }
  const local = JSON.parse(fs.readFileSync(path.join(root, "supabase", "functions", "_shared", "verify-data.json"), "utf8")).hash;
  if (!local) stop("로컬 verify-data.json 에 hash 가 없다 — npm run verify:build");
  const online = JSON.parse(fs.readFileSync(path.join(root, "data", "online.json"), "utf8"));
  let res;
  try {
    res = await fetch(`${online.url}/functions/v1/upload-save`, {
      headers: { apikey: online.publishableKey, Authorization: `Bearer ${online.publishableKey}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    stop(`운영 함수에 닿지 못했다 (${err && err.message ? err.message : err})`);
  }
  const body = await res.json().catch(() => ({}));
  // 지문을 돌려주기 전의 함수는 GET 을 405 로 거절한다
  if (!res.ok || typeof body.hash !== "string") stop(`운영 함수가 지문을 주지 않는다 (HTTP ${res.status}) — 함수를 배포한다: npx supabase functions deploy upload-save --use-api`);
  if (body.hash !== local) stop(`운영 ${body.hash} ≠ 로컬 ${local} — 함수를 배포한다: npx supabase functions deploy upload-save --use-api`);
  process.stdout.write(`규칙 데이터 배포 확인: 운영과 로컬이 같다 (${local})\n`);
}

main();
