// mac 업데이트의 공급처·목록 풀이와 번들 위치 — 순수 함수. 파일·네트워크를 쓰지 않는다
// 엔진은 src/main/update/mac-updater.ts 다. 설계: worklog/records/code-structure/design/10-main.md 2절 21번 (G05-07)
import path from "node:path";

// ── 공급처와 목록 ───────────────────────────────────────────────────────────────

export type FeedConfig =
  | { kind: "github"; owner: string; repo: string; cacheName: string | null }
  | { kind: "generic"; url: string; cacheName: string | null };

export interface FeedFile {
  url: string; // 파일 이름 (공급처 기준 상대 주소)
  sha512: string; // base64
  size: number | null;
}

export interface LatestMac {
  version: string;
  files: FeedFile[];
}

// 따옴표를 벗긴 값
const unquote = (v: string): string => {
  const t = v.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  return t;
};

// electron-builder 가 쓰는 두 YAML 의 고정 모양만 읽는다 — 최상위 `키: 값` 과 `files:` 아래 `- url:` 항목
function readYaml(text: string): { top: Record<string, string>; files: Record<string, string>[] } {
  const top: Record<string, string> = {};
  const files: Record<string, string>[] = [];
  let inFiles = false;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0) {
      inFiles = false;
      const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
      if (!m) continue;
      if (m[1] === "files" && !m[2]) inFiles = true;
      else top[m[1]!] = unquote(m[2] ?? "");
      continue;
    }
    if (!inFiles) continue;
    const item = /^-\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (item) {
      files.push({ [item[1]!]: unquote(item[2] ?? "") });
      continue;
    }
    const field = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    const last = files[files.length - 1];
    if (field && last) last[field[1]!] = unquote(field[2] ?? "");
  }
  return { top, files };
}

// app-update.yml → 공급처. 모양이 다르면 null
export function parseUpdateConfig(text: string): FeedConfig | null {
  const { top } = readYaml(text);
  const cacheName = top.updaterCacheDirName || null;
  if (top.provider === "github" && top.owner && top.repo) return { kind: "github", owner: top.owner, repo: top.repo, cacheName };
  if (top.provider === "generic" && top.url) return { kind: "generic", url: top.url, cacheName };
  return null;
}

// latest-mac.yml → 버전과 파일 목록. 모양이 다르면 null
export function parseLatestMac(text: string): LatestMac | null {
  const { top, files } = readYaml(text);
  if (!top.version) return null;
  const list: FeedFile[] = files
    .filter((f) => f.url && f.sha512)
    .map((f) => ({ url: f.url!, sha512: f.sha512!, size: f.size && /^\d+$/.test(f.size) ? Number(f.size) : null }));
  // 옛 모양 — files 없이 path·sha512 만
  if (!list.length && top.path && top.sha512) list.push({ url: top.path, sha512: top.sha512, size: null });
  return { version: top.version, files: list };
}

// 숫자 버전 비교 — 1.2.10 > 1.2.9. `-` 뒤(사전 배포 표시)는 보지 않는다
export function compareVersions(a: string, b: string): number {
  const nums = (v: string): number[] => v.split("-")[0]!.split(".").map((n) => Number(n) || 0);
  const x = nums(a);
  const y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// 이 Mac 아키텍처의 파일 — arm64 는 이름에 arm64, 그 밖은 x64(또는 arm64 가 없는 이름)
export function pickFile(files: FeedFile[], arch: string, ext: "zip" | "dmg"): FeedFile | null {
  const same = files.filter((f) => f.url.toLowerCase().endsWith(`.${ext}`));
  if (arch === "arm64") return same.find((f) => /arm64/i.test(f.url)) ?? null;
  return same.find((f) => /x64/i.test(f.url)) ?? same.find((f) => !/arm64/i.test(f.url)) ?? null;
}

export interface FeedUrls {
  latest: string; // latest-mac.yml
  file: (version: string, name: string) => string;
  page: (version: string) => string; // 수동 받기에 dmg 가 없을 때 여는 곳
}

export function feedUrls(cfg: FeedConfig): FeedUrls {
  if (cfg.kind === "github") {
    const base = `https://github.com/${cfg.owner}/${cfg.repo}/releases`;
    return {
      latest: `${base}/latest/download/latest-mac.yml`,
      file: (v, name) => `${base}/download/v${v}/${encodeURIComponent(name)}`,
      page: (v) => `${base}/tag/v${v}`,
    };
  }
  const base = cfg.url.endsWith("/") ? cfg.url : `${cfg.url}/`;
  return { latest: `${base}latest-mac.yml`, file: (_v, name) => `${base}${encodeURIComponent(name)}`, page: () => base };
}

// ── 번들 위치 ──────────────────────────────────────────────────────────────────

// 실행 파일 경로 → .app 번들 경로 (…/X.app/Contents/MacOS/X → …/X.app). 번들 밖이면 null
export function bundleOf(exePath: string): string | null {
  const m = /^(.*?\.app)(?:\/|$)/.exec(exePath);
  return m ? m[1]! : null;
}

// 그 자리에서 바꿀 수 없는 까닭 — 없으면 null (바꿀 수 있다)
export function manualReason(bundle: string | null, canWrite: (dir: string) => boolean): string | null {
  if (!bundle) return "not-bundle";
  if (bundle.includes("/AppTranslocation/")) return "translocated"; // 격리 실행 — 경로가 임시·읽기 전용이다
  if (bundle.startsWith("/Volumes/")) return "disk-image"; // dmg 안에서 바로 실행
  if (!canWrite(path.dirname(bundle))) return "read-only";
  return null;
}
