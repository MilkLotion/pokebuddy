// 작업 표시줄 점프 목록 (Windows) — 작업 표시줄 아이콘을 우클릭하면 파티 포켓몬마다 밥 주기·놀아주기가 보인다
//   (2026-09-28 사용자 "크롬 우클릭 메뉴처럼 냐오하 [아이콘] 밥주기 [아이콘] 놀아주기 …")
//
// 항목을 누르면 Windows 가 앱을 인자(--pokebuddy-care=feed:<개체>)와 함께 다시 실행한다.
// 이미 떠 있는 동반자가 second-instance 로 그 인자를 받아 명령을 돌린다 (src/main/app/launch.ts).
// 앱 이름·작업 표시줄에 고정·창 닫기 줄은 Windows 가 붙인다.
// 항목 아이콘은 점프 목록 전용 도트 그림이다 — assets/items/jump-feed.ico·jump-play.ico (Figma 99 `803:782`, 16·32·48px).
//   아이콘이 없으면 Windows 가 실행 파일 아이콘을 대신 붙인다(2026-09-28 사용자 "이게 더 에바네. 이거 아이콘은 새로 만들어야겠다")
import fs from "node:fs";
import path from "node:path";
import { app, type JumpListCategory } from "electron";
import type { CareKind } from "../state/care";


export interface JumpPet {
  id: string;
  name: string;
  level: number;
}

const ARG = "--pokebuddy-care=";

// 실행 인자에서 점프 목록 명령을 찾는다 — 없으면 null
export function careArgOf(argv: readonly string[]): { action: CareKind; petId: string } | null {
  const raw = argv.find((a) => a.startsWith(ARG));
  const m = raw ? /^(feed|play):(.+)$/.exec(raw.slice(ARG.length)) : null;
  return m ? { action: m[1] as CareKind, petId: m[2]! } : null;
}

let lastKey = "";

// 파티가 바뀌었을 때만 다시 만든다 — 같은 목록이면 그대로 둔다
export function syncJumpList(pets: readonly JumpPet[], labels: { feed: string; play: string }): void {
  if (process.platform !== "win32") return;
  const key = JSON.stringify([pets, labels]);
  if (key === lastKey) return;
  lastKey = key;
  // 개발 실행(electron .)은 앱 폴더를 첫 인자로 넘겨야 같은 앱이 뜬다
  const lead = process.defaultApp ? `"${app.getAppPath()}" ` : "";
  const icon = (action: CareKind): string | null => {
    const file = path.join(app.getAppPath(), "assets", "items", `jump-${action}.ico`);
    return fs.existsSync(file) ? file : null;
  };
  const categories: JumpListCategory[] = pets.map((p) => ({
    type: "custom",
    name: `${p.name} · Lv.${p.level}`,
    items: (["feed", "play"] as const).map((action) => ({
      type: "task" as const,
      title: labels[action],
      program: process.execPath,
      args: `${lead}${ARG}${action}:${p.id}`,
      ...(icon(action) ? { iconPath: icon(action)!, iconIndex: 0 } : {}),
    })),
  }));
  try {
    app.setJumpList(categories.length ? categories : null);
  } catch (e) {
    console.error(e);
  }
}
