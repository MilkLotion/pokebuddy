// [임시] 옛 자리 — 본체는 src/dex/dex-number.ts(빌드 dist/dex/dex-number.js). cli/status.js 가 dexPath·suggest 를 이 경로로 읽는다.
// cli 를 TypeScript 로 옮기는 도구 레인 T7b 에서 지운다. dist/ 가 있어야 돈다(cli/status.js 도 dist/ 를 요구한다)
const { dexPath, suggestSlugs } = require("../dist/dex/dex-number.js");

module.exports = { dexPath, suggest: suggestSlugs };
