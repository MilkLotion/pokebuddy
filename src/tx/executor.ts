// 거래 실행기 — 계약은 docs/specs/modules.md "거래 실행기". 저장을 쓰는 곳은 여기 하나다.
//
// 처리 순서
//   1. 요청 ID 를 확인한다. 이미 완료한 요청이면 저장된 결과를 그대로 돌려준다 (중복 반영 방지)
//   2. 현재 저장 상태를 읽는다
//   3. 도메인 모듈로 검사와 결과를 계산한다 — 사본에만 쓴다
//   4. 모든 검사를 통과하면 바뀔 상태를 한 번에 저장한다
//   5. 실패하면 아무 상태도 바꾸지 않고 실패로 끝낸다. 재시도 버튼은 제공하지 않는다
//
// 전부 동기다. 그래서 거래는 저절로 한 번에 하나이고 들어온 순서대로 처리된다.
// 파일을 직접 다루지 않는다. 읽기·쓰기·시계를 받아서 쓴다 — 자체 검사가 파일 없이 돈다.
import { applySettle } from "./settle.js";
import type { SaveV3, TxRecordV3 } from "../shared/save-v3";
import { SAVE_V3_RULES } from "../save/rules.js";
import type { Reason } from "../shared/names/reasons.js";
import type { TxRequest, TxResult } from "../shared/command.js";

// 도메인 모듈이 돌려주는 것 — 사본을 고치고 성공 여부만 알린다
export type TxOutcome = { ok: true; result?: unknown } | { ok: false; reason: Reason };

export interface TxContext {
  now: number;
  rand: () => number; // 0 이상 1 미만. 자체 검사가 결과를 정할 수 있게 받아서 쓴다
  // 알 하나의 결정적 난수(P4b, 계정 시드 — src/verify/save-rules.ts seededRand). 시드가 없으면 null — 그때는 rand 를 쓴다
  eggRand?: (eggId: string) => (() => number) | null;
}

export type TxHandler = (draft: SaveV3, args: unknown, ctx: TxContext) => TxOutcome;

export interface TxPorts {
  read: () => SaveV3 | null;
  write: (save: SaveV3, name?: string) => boolean; // name — 거래 이름. 앱이 이름으로 클라우드 즉시 올리기를 가른다 (src/online/save-kind.ts)
  now: () => number;
  rand?: () => number; // 없으면 Math.random
  eggRand?: (eggId: string) => (() => number) | null; // 알 열기의 결정적 난수(P4b). 없으면 rand
}

export interface Executor {
  run: (req: TxRequest) => TxResult;
  saveFailStreak: () => number; // 이어서 실패한 횟수. 정해진 수를 넘으면 화면이 안내를 남긴다
  shouldNotifySaveFail: () => boolean;
}

// 완료한 요청 기록을 최근 건수와 보관 기간 중 큰 쪽으로 자른다
export function trimTx(list: TxRecordV3[], now: number): TxRecordV3[] {
  const { keep, ttlMs } = SAVE_V3_RULES.tx;
  const sorted = [...list].sort((a, b) => a.at - b.at);
  const fresh = sorted.filter((t) => now - t.at <= ttlMs);
  return fresh.length >= keep ? fresh : sorted.slice(-keep);
}

export function createExecutor(ports: TxPorts, handlers: Record<string, TxHandler>): Executor {
  let failStreak = 0;

  const run = (req: TxRequest): TxResult => {
    const save = ports.read();
    if (!save) return { ok: false, reason: "no-save" };

    const done = save.tx.find((t) => t.id === req.id);
    if (done) return { ok: true, result: done.result, replayed: true };

    const handler = handlers[req.name];
    if (!handler) return { ok: false, reason: "unknown-cmd" };

    const now = ports.now();
    const draft = structuredClone(save);
    const out = handler(draft, req.args, { now, rand: ports.rand ?? Math.random, ...(ports.eggRand ? { eggRand: ports.eggRand } : {}) });
    if (!out.ok) return { ok: false, reason: out.reason };

    // 상태가 바뀌었으니 메가 모습·메가스톤·해금·튜토리얼·업적을 다시 본다 (./settle.ts). save 는 거래 전 — 레벨업 업적이 비교한다
    const { achieved } = applySettle(draft, now, { prev: save, revertMega: true });

    const result = out.result ?? null;
    draft.tx = trimTx([...draft.tx, { id: req.id, at: now, result }], now);
    draft.savedAt = now;
    if (!ports.write(draft, req.name)) {
      failStreak += 1;
      return { ok: false, reason: "save-failed" };
    }
    failStreak = 0;
    return { ok: true, result, replayed: false, achieved };
  };

  return {
    run,
    saveFailStreak: () => failStreak,
    shouldNotifySaveFail: () => failStreak >= SAVE_V3_RULES.saveFailNotifyAfter,
  };
}
