// 켤 때 훅 정리와 한 번 알림 — 저장을 쓰는 동반자(writer) 하나가 부른다 (2026-09-28 사용자 결정 "기존 훅 사용자 자동 정리").
//
//   start  옛 이벤트(지금 목록에 없는 우리 등록, 예: codex PreToolUse)를 걷고, 이미 있는 훅 파일을 새 버전으로 바꾼다(src/agents/registry.ts tidyAgentHooks).
//          새로 등록하지 않는다. 그 뒤 Codex 창 깜빡임 알림을 띄울 때인지 본다
//   tick   알림이 남았고 다른 배너가 없으면 띄운다. 띄웠으면 notices.json 에 남겨 다시 띄우지 않는다
//
// 실패는 기록만 하고 사용자에게 알리지 않는다. 앱 시작을 막지 않는다
import { agentStatusList, tidyAgentHooks, type AgentStatus, type TidyResult } from "../agents/registry.js";
import { CODEX_FLASH_NOTICE, codexNoticeDue, markNotice, readNotices } from "../agents/notice.js";
import type { BannerView } from "../shared/model/overlays";
import { t } from "./text.js";

export interface HookUpkeepOptions {
  noticesFile: string; // notices.json — save.json 과 같은 폴더
  show: (banner: BannerView) => boolean; // notifier.showOnce — 다른 배너가 보이는 중이면 false
  platform?: NodeJS.Platform | string;
  log?: ((o: Record<string, unknown>) => void) | null;
  tidy?: () => TidyResult; // 자체 시험은 가짜를 넘긴다
  status?: () => AgentStatus[];
}

export interface HookUpkeep {
  start(): void;
  tick(): void;
  due(): boolean; // 아직 띄우지 못한 알림이 있다
}

// Codex 창 깜빡임 알림 — `바로가기` 는 사용자 모달의 연결 탭
export const codexFlashBanner = (): BannerView => ({
  key: `notice:${CODEX_FLASH_NOTICE}`,
  kind: "notice",
  title: t("banner.codexFlash"),
  target: t("banner.codexFlashBody"),
  go: t("banner.go"),
  route: { to: "agents" },
});

export function createHookUpkeep(o: HookUpkeepOptions): HookUpkeep {
  const platform = o.platform ?? process.platform;
  let due = false;
  return {
    start() {
      try {
        const r = (o.tidy ?? tidyAgentHooks)();
        if (r.clis.length || r.hookFile === "바꿈" || r.hookFile === "실패") {
          o.log?.({ hooks: "tidy", hookFile: r.hookFile, clis: r.clis, ...(r.error ? { error: r.error } : {}) });
        }
      } catch (e) {
        o.log?.({ hooks: "tidy-failed", message: String(e) });
      }
      try {
        const codex = (o.status ?? agentStatusList)().find((a) => a.name === "codex");
        due = codexNoticeDue({ platform, codexConnected: !!codex?.connected, shown: readNotices(o.noticesFile) });
      } catch (e) {
        o.log?.({ hooks: "notice-check-failed", message: String(e) });
      }
    },
    tick() {
      if (!due) return;
      if (!o.show(codexFlashBanner())) return;
      due = false;
      if (!markNotice(o.noticesFile, CODEX_FLASH_NOTICE)) o.log?.({ hooks: "notice-mark-failed" });
    },
    due: () => due,
  };
}
