// 설정창의 게임 읽기와 명령 처리 — 저장만 읽고 Electron 을 쓰지 않는다. 처리기(./handlers.ts)와 기기 창 길(./devices.ts)이 같이 쓴다
// 자체 검사가 실제 처리 순서 그대로 횟수를 잰다 (src/tools/selftest/selftest-perf.ts, worklog/records/perf-refactor 0단계)
import type { ManageReply, ManageRequest } from "../../shared/ipc/manage";
import type { DexDetail, ShopDetail } from "../../shared/model/detail";
import type { Snapshot } from "../../shared/model/snapshot";
import type { GameV3 } from "../../tx/game.js";
import { dexDetail } from "../../view/dex-detail.js";
import { resultLineOf } from "../../view/result-lines.js";
import { shopDetail } from "../../view/shop-detail.js";
import { snapshotOfGame } from "../../view/snapshot.js";
import { isInternalCommand, parseCommand } from "./requests.js";

// 성공 답에 결과 줄을 붙이는 명령 — 기기 창의 초록 상자
const RESULT_COMMANDS = new Set(["bag.use", "bag.sell", "shop.buy"]);

// 화면 읽기 — 저장을 읽어 화면 값을 바로 만든다(실행기는 쓰기만 맡는다). 저장이 없으면 빈 값. 기기 창도 같은 것을 쓴다
export interface GameReads {
  snapshot(): Snapshot | null;
  detailOf(slug: string): DexDetail | null; // 도감 칸 하나의 상세
  shopDetailOf(id: string): ShopDetail | null; // 상점 구매 창의 상세
}

export function gameReads(game: GameV3): GameReads {
  return {
    snapshot: () => snapshotOfGame(game),
    detailOf: (slug: string) => {
      const save = game.read();
      return save ? dexDetail(save, slug) : null;
    },
    shopDetailOf: (id: string) => {
      const save = game.read();
      return save ? shopDetail(save, id) : null;
    },
  };
}

// `manage:snapshot` — 본 값이 지금 값이 되도록 먼저 시간을 적용한다. display 는 화면 배치 값(창이 있을 때만)
export function snapshotReply(game: GameV3, reads: GameReads, display?: () => Snapshot["display"]): Snapshot | null {
  game.tick();
  const view = reads.snapshot();
  return view && display ? { ...view, display: display() } : view;
}

// `manage:command` — 요청 모양을 보고, 흐른 시간을 먼저 적용한 뒤 명령을 보낸다
export async function commandReply(game: GameV3, reads: GameReads, send: (req: ManageRequest) => Promise<ManageReply>, raw: unknown): Promise<ManageReply> {
  const req = parseCommand(raw);
  if (!req) return { ok: false, reason: "bad-request" };
  // 우편함 넣기와 교환의 잠금·반영은 메인의 우편함·교환 세션만 실행기에 낸다 — 받은 길(send)이 명령 처리기를 거치지 않아도(개발용 실행기) 막는다
  if (isInternalCommand(req.cmd)) return { ok: false, reason: "unknown-cmd" };
  game.tick();
  // 결과 줄이 있는 명령은 거래 앞뒤 화면 값을 견줘 성공 답에 붙인다 (src/view/result-lines.ts)
  const before = RESULT_COMMANDS.has(req.cmd) ? reads.snapshot() : null;
  const reply = await send(req);
  const after = reply.ok && before ? reads.snapshot() : null;
  const result = before && after ? resultLineOf(req, before, after) : null;
  return result ? { ...reply, result } : reply;
}
