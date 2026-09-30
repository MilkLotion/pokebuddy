// 무대 창을 늘 맨 위에 둔다 — Windows 만.
//
// 무대 창은 만들 때 "항상 위"를 한 번 건다(stage-window.ts). Windows 에서는 이것이 두 가지로 무너진다.
//   풀림  절전·잠금·화면 구성 변경 등을 지나며 창의 "항상 위"가 풀린다. 그 뒤로는 모든 창에 가려진다.
//         Chromium 은 값을 기억만 해서 isAlwaysOnTop() 은 계속 true 라 알아챌 수 없다
//         (2026-10-01 사용자 보고 "갑자기 모든 프로그램의 창에 다 가려졌어", 앱 재시작이나 화면 설정을 바꿨다 돌리면 돌아옴)
//   밀림  "항상 위" 창들은 한 층을 같이 쓴다. 다른 항상 위 창(작업 표시줄, 다른 앱의 항상 위 창)이 앞으로 오면 그 밑에 깔린다
// 그래서 주기마다 "항상 위"를 다시 건다 — 풀렸으면 되살고, 밀렸으면 다시 앞으로 온다. 포커스는 건드리지 않는다.
// 우리 앱의 다른 항상 위 창(트레이 메뉴·알림 띠·멈춤 창 등)은 무대 뒤로 깔리지 않게 무대 다음에 다시 앞으로 올린다.
// mac 은 창 수준(level)이 제대로 층을 나눠 이런 일이 없다 — 돌리지 않는다
// 기록: worklog/records/stage-visibility/record.md
import { BrowserWindow } from "electron";

export const KEEP_ON_TOP_MS = 1000;

export interface Raisable {
  raise(): void;
  owns(w: BrowserWindow): boolean;
}

// 타이머를 돌려준다 — 끌 때 부르는 쪽이 clearInterval 한다. Windows 가 아니면 null
export function startKeepOnTop(stages: () => Raisable | null): ReturnType<typeof setInterval> | null {
  if (process.platform !== "win32") return null;
  return setInterval(() => {
    const group = stages();
    if (!group) return;
    group.raise();
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && w.isVisible() && w.isAlwaysOnTop() && !group.owns(w)) w.moveTop();
    }
  }, KEEP_ON_TOP_MS);
}
