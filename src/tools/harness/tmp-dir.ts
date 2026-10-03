// 시험·개발 도구의 임시 폴더 — 모두 <시스템 임시 폴더>/pokebuddy/ 아래에 만든다 (2026-10-03 사용자 결정, docs/contributing/development.md "임시 폴더")
//
// 예전에는 도구마다 임시 폴더 최상위에 `pokebuddy-<이름>-XXXXXX` 를 만들고 지우지 않았다. 772개(3.9G)가 쌓였다.
//   한 폴더 아래   정리할 때 그 폴더 하나만 지우면 된다
//   끝나면 지운다   프로세스가 종료 코드 0 으로 끝나면 만든 폴더를 지운다. 실패하면 원인을 보게 남긴다
//   남은 것 치우기  처음 폴더를 만들 때 남은 것을 치운다. 만든 프로세스가 끝난 폴더는 바로, 주인을 모르는 폴더는 하루 뒤에.
//                  Electron 으로 도는 도구는 끝날 때 자식 프로세스가 파일을 잡고 있어 스스로 다 지우지 못한다 — 다음 실행이 치운다
// 저장소의 node_modules 로 가는 연결을 가진 폴더(커밋만 꺼낸 worktree)는 여기에 두지 않는다 — 치우기가 그 폴더도 지운다
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TMP_RULES = {
  root: "pokebuddy", // 시스템 임시 폴더 아래의 폴더 이름
  ownerExt: ".pid", // 폴더 옆에 두는 파일의 꼬리 — 폴더를 만든 프로세스 번호를 적는다. 폴더 안에 두지 않는다(빈 폴더를 단언하는 시험이 있다)
  sweepAfterMs: 24 * 60 * 60_000, // 주인을 모르는 폴더는 이보다 오래 바뀌지 않았으면 치운다
};

export const tmpRoot = (): string => path.join(os.tmpdir(), TMP_RULES.root);

const remove = (target: string): boolean => {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    return true;
  } catch {
    return false; // 다른 프로세스가 잡고 있다 — 다음 치우기에 맡긴다
  }
};

function alive(pid: number): boolean {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// 남은 임시 폴더를 치운다. 지운 수를 돌려준다
export function sweepTmp(now: number = Date.now()): number {
  let removed = 0;
  let names: string[] = [];
  try {
    names = fs.readdirSync(tmpRoot());
  } catch {
    return 0;
  }
  for (const name of names) {
    if (name.endsWith(TMP_RULES.ownerExt)) continue; // 주인 파일은 폴더와 함께 지운다
    const target = path.join(tmpRoot(), name);
    const ownerFile = `${target}${TMP_RULES.ownerExt}`;
    let stale = false;
    try {
      const owner = Number(fs.readFileSync(ownerFile, "utf8"));
      stale = !alive(owner);
    } catch {
      try {
        stale = now - fs.statSync(target).mtimeMs >= TMP_RULES.sweepAfterMs;
      } catch {
        continue;
      }
    }
    if (stale && remove(target)) {
      remove(ownerFile);
      removed += 1;
    }
  }
  return removed;
}

let swept = false;

// 임시 폴더 하나를 만든다 — <임시 폴더>/pokebuddy/<이름>-XXXXXX. keep 이면 끝나도 지우지 않는다(다음 치우기는 지운다)
export function makeTmp(name: string, opts: { keep?: boolean } = {}): string {
  fs.mkdirSync(tmpRoot(), { recursive: true });
  if (!swept) {
    swept = true;
    sweepTmp();
  }
  const dir = fs.mkdtempSync(path.join(tmpRoot(), `${name}-`));
  const ownerFile = `${dir}${TMP_RULES.ownerExt}`;
  fs.writeFileSync(ownerFile, String(process.pid));
  if (!opts.keep)
    process.on("exit", (code) => {
      if (code === 0 && remove(dir)) remove(ownerFile);
    });
  return dir;
}
