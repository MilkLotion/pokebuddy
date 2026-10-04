// 설정창의 업적창 — 업적 줄(진행도·보상 받기), 분류 칩, 미수령 → 미달성 → 받음 순서 (P10j)
import type { AchievementView } from "../../shared/model/snapshot.js";
import { buttonEl, el } from "../ui/dom.js";
import { sendCommand } from "./command.js";
import { actionsRowEl, closeButton, closeDialog, dialogEl, dialogHead, drawDialog, resetDialogScroll } from "./dialog.js";
import { ui } from "./state.js";
import { chipsEl } from "./widgets.js";

// 업적 한 줄 — Figma 05 `Achievements / Base` 의 `Achievement Row` (`State=Claimable|Open|Claimed`, 2026-10-03 업적 개선).
//   미달성   이름 아래에 진행도 줄(막대 + `현재 / 기준`). 오른쪽에 보상
//   미수령   보상 글자와 `보상 받기` 단추
//   받음     `<보상> 받음`
function achievementRow(a: AchievementView): HTMLElement {
  const row = el("div", `achievement ${a.state}`);
  row.dataset.id = a.id; // 알림 배너의 `바로가기` 가 이 줄로 옮겨 온다
  row.appendChild(el("span", "state"));
  const body = el("div", "body");
  body.appendChild(el("div", "label", a.name));
  if (a.desc) body.appendChild(el("div", "hint", a.desc));
  if (a.progress) {
    const line = el("div", "progress");
    const track = el("span", "track");
    const fill = el("span", "fill");
    fill.style.width = `${Math.round((100 * a.progress.now) / a.progress.goal)}%`;
    track.appendChild(fill);
    line.append(track, el("span", "count", `${a.progress.now} / ${a.progress.goal}${a.progress.unit}`));
    body.appendChild(line);
  }
  row.appendChild(body);
  row.appendChild(el("span", "done", a.state === "claimed" ? `${a.reward} 받음` : a.reward));
  if (a.state === "achieved") {
    const claim = buttonEl("act primary", "보상 받기");
    claim.addEventListener("click", () => void sendCommand("achievement.claim", a.id));
    row.appendChild(claim);
  }
  return row;
}

// 업적창의 분류 칩 — `전체` 와 분류 다섯 (2026-10-03 사용자 결정 "전체 + chip으로 볼수 있게"). 탐험·배틀은 그 기능이 생길 때 더한다
const ACHIEVEMENT_TABS: { id: string; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "dex", label: "도감" },
  { id: "grow", label: "육성" },
  { id: "egg", label: "알" },
  { id: "find", label: "탐색" },
  { id: "together", label: "함께" },
];
let achievementTab = "all";

// 업적 배너의 `바로가기` 로 왔다 — 다른 분류를 고른 채면 그 업적 줄이 목록에 없어 `전체` 로 되돌린다
export function resetAchievementTab(): void {
  achievementTab = "all";
}

// 줄 순서 — 미수령 → 미달성 → 수령 완료. 같은 상태는 목록 순서 (docs/specs/ui-components.md C-12)
const ACHIEVEMENT_ORDER: Record<AchievementView["state"], number> = { achieved: 0, locked: 1, claimed: 2 };

export function drawAchievements(): void {
  if (!ui.view) {
    closeDialog();
    return;
  }
  const list = ui.view.achievements.list;
  dialogEl.append(...dialogHead("업적", `달성 ${ui.view.achievements.total} / ${list.length} · 미수령 ${ui.view.achievements.unclaimed}`));
  dialogEl.appendChild(
    chipsEl(ACHIEVEMENT_TABS, achievementTab, (id) => {
      achievementTab = id;
      resetDialogScroll(); // 분류를 바꾸면 목록을 맨 위부터 본다
      drawDialog();
    }),
  );
  const scroll = el("div", "scroll");
  const rows = list
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => achievementTab === "all" || a.group === achievementTab)
    .sort((x, y) => ACHIEVEMENT_ORDER[x.a.state] - ACHIEVEMENT_ORDER[y.a.state] || x.i - y.i);
  for (const { a } of rows) scroll.appendChild(achievementRow(a));
  dialogEl.appendChild(scroll);
  dialogEl.appendChild(actionsRowEl(closeButton()));
}
