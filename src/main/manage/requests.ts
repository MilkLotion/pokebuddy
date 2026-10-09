// 설정창이 보낸 값의 모양 검사 — 순수 함수. 설정창 처리기(src/main/manage/window.ts)가 부른다. 렌더러가 보낸 값은 믿지 않는다
// 모양이 맞지 않으면 null — 처리기는 그때 각 채널의 빈 답을 돌려준다. 값의 뜻(잔액·소유 등)은 실행기·서비스가 따로 검사한다
// 기기 창 다섯의 고른 값(…DeviceInput)은 src/main/windows/devices.ts 의 is…Input 이 본다
// (예전 src/main/manage-window.ts 처리기 안에 흩어져 있었다. 메인 레인 M6a 에서 모았다)
import type { AccountAction, UpdateAction } from "../../shared/model/account";
import type { AgentAction } from "../../shared/model/agents";
import type { MailAction } from "../../shared/model/mail";
import type { BattleAction } from "../../shared/model/battle-net";
import type { PortraitAsk } from "../../shared/model/snapshot";
import type { ManageRequest } from "../../shared/ipc/manage";
import { hasCommandFlag } from "../../shared/names/commands.js";
import { INPUT_LIMITS } from "../windows/input.js";

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object";

// 거래 명령 — cmd 가 글자면 받는다. 나머지 칸은 실행기가 본다
export function parseCommand(v: unknown): ManageRequest | null {
  return isObj(v) && typeof v.cmd === "string" ? (v as unknown as ManageRequest) : null;
}

// 표면이 보내지 못하는 명령 — 명령 이름 표의 internal 표시 하나로 가린다(교환 잠금·반영, 우편 받기·읽음). 메인의 서비스만 실행기에 낸다
export const isInternalCommand = (cmd: string): boolean => hasCommandFlag(cmd, "internal");

const AGENT_ACTIONS: readonly AgentAction[] = ["connect", "disconnect", "check", "probe"];

// CLI 연결 탭 — 이름 글자와 정한 동작 넷. 아니면 null(목록만 읽는 요청으로 본다)
export function parseAgentRequest(v: unknown): { name: string; action: AgentAction } | null {
  if (!isObj(v) || typeof v.name !== "string" || !AGENT_ACTIONS.includes(v.action as AgentAction)) return null;
  return v as { name: string; action: AgentAction };
}

// 초상 요청 — 배열이 아니면 null. slug 가 글자인 것만, 한 화면 분량(INPUT_LIMITS.portraitAsks)까지. shiny 는 true 일 때만 참
export function parsePortraitAsks(v: unknown): PortraitAsk[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter((a): a is PortraitAsk => isObj(a) && typeof a.slug === "string")
    .slice(0, INPUT_LIMITS.portraitAsks)
    .map((a) => ({ slug: a.slug, shiny: a.shiny === true }));
}

// 아이콘 열쇠 — 배열이 아니면 null. 글자만, INPUT_LIMITS.iconKeys 개까지
export function parseIconKeys(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((k): k is string => typeof k === "string").slice(0, INPUT_LIMITS.iconKeys);
}

// 복사할 글자 — 교환 링크처럼 짧은 글자만(INPUT_LIMITS.copyChars)
export function parseCopyText(v: unknown): string | null {
  return typeof v === "string" && v.length <= INPUT_LIMITS.copyChars ? v : null;
}

// 계정 — action 이 글자인지만 본다. 값의 검사는 src/online/account.ts 가 한다
export function parseAccountAction(v: unknown): AccountAction | null {
  return isObj(v) && typeof v.action === "string" ? (v as unknown as AccountAction) : null;
}

// 우편함 — 정한 세 동작만. 편지 id 는 uuid 모양만. 선물 값은 렌더러에서 받지 않는다
export function parseMailAction(v: unknown): MailAction | null {
  if (!isObj(v)) return null;
  if (v.action === "refresh") return { action: "refresh" };
  if ((v.action === "read" || v.action === "claim") && typeof v.id === "string" && /^[0-9a-f-]{36}$/i.test(v.id)) return { action: v.action, id: v.id };
  return null;
}

// 랜덤 배틀 — offer, 또는 start(offerId 는 uuid, pick 은 1~3)
export function parseBattleAction(v: unknown): BattleAction | null {
  if (!isObj(v)) return null;
  if (v.action === "offer") return { action: "offer" };
  if (v.action === "record") return { action: "record" };
  if (v.action === "start" && typeof v.offerId === "string" && /^[0-9a-f-]{36}$/i.test(v.offerId) && typeof v.pick === "number" && Number.isInteger(v.pick) && v.pick >= 1 && v.pick <= 3)
    return { action: "start", offerId: v.offerId, pick: v.pick };
  return null;
}

// 업데이트 — 정한 네 동작만
export function parseUpdateAction(v: unknown): UpdateAction | null {
  return v === "status" || v === "check" || v === "peek" || v === "install" ? v : null;
}

// 패치노트 — 목록 읽기와 본 것으로 적기
export function parseNotesAction(v: unknown): "list" | "seen" | null {
  return v === "list" || v === "seen" ? v : null;
}
