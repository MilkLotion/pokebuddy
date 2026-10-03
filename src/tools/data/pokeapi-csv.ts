// 데이터 빌드 스크립트(build-*.ts) 공통 — PokeAPI CSV 내려받기·파싱, 프로젝트 경로, 도감표 읽기, 한 줄 JSON 쓰기.
// 개발용 — 네트워크가 필요하고 배포 패키지에는 결과 JSON 만 들어간다.
//
// 출처: PokeAPI 저장소의 CSV (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)
// 경로는 dist/tools 기준으로 프로젝트 루트를 잡는다 — 실행은 npm run build 뒤 node dist/tools/<이름>.js
import fs from "node:fs";
import path from "node:path";

export const BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";

// dist/tools/data → 프로젝트 루트
export const PROJECT_ROOT = path.join(__dirname, "..", "..", "..");
export const DATA_DIR = path.join(PROJECT_ROOT, "data");

// CSV 한 줄 — 열 이름 → 값. 열 목록(K)을 밝힌 표는 그 열이 있음이 보장된다 (csv 가 헤더로 검사)
export type CsvRow<K extends string = string> = Record<K, string>;

// 도감표 data/dex.json — 슬러그 → 도감 번호
export type DexTable = Record<string, number>;

// 따옴표·쉼표가 든 값(Farfetch'd, "Type: Null", 설명글)을 다루는 최소 CSV 파서.
// 반환 { header, rows } — 헤더보다 짧은 줄은 빈 칸으로 채우고, 칸이 하나뿐인 줄(빈 줄)은 버린다
export function parseCsvTable(text: string): { header: string[]; rows: CsvRow[] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return {
    header,
    rows: rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])) as CsvRow),
  };
}

export const parseCsv = (text: string): CsvRow[] => parseCsvTable(text).rows;

async function download(name: string): Promise<string> {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name} 내려받기 실패: ${res.status}`);
  return res.text();
}

// CSV 한 장 내려받아 파싱. columns 에 적은 열이 헤더에 없으면 던진다 — 상류가 열 이름을 바꿨을 때 조용히 빈 값으로 만들지 않게
export async function csv<K extends string>(name: string, columns: readonly K[]): Promise<CsvRow<K>[]> {
  const { header, rows } = parseCsvTable(await download(name));
  const missing = columns.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`${name} 에 열이 없다: ${missing.join(", ")}`);
  return rows as CsvRow<K>[];
}

// data/dex.json — 우리 도감표 (PokeAPI 의 종 전부 + 고른 폼. src/tools/data/build-dex.ts)
export function readDex(): DexTable {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "dex.json"), "utf8")) as DexTable;
}

// 한 항목 한 줄 — diff 를 읽을 수 있게. 키 순서는 들어온 그대로
export function writeLineJson(file: string, table: Record<string, unknown>): void {
  const lines = Object.keys(table).map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(table[k])}`);
  fs.writeFileSync(file, `{\n${lines.join(",\n")}\n}\n`);
}

// 있어야 하는 값 — 없으면 던진다 (noUncheckedIndexedAccess 로 undefined 가 섞인 자리에서 뜻을 밝힌다)
export function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`${what} 이(가) 없다`);
  return v;
}

// 빌드 진입점 공통 — 실패는 메시지 한 줄과 종료 코드 1
export function runBuild(build: () => Promise<void>): void {
  build().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
