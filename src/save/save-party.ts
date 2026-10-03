// 파티 저장의 writer·reader 나누기 — 무대·메뉴의 파티 명령을 writer 면 실행기로, reader 면 writer 에게 보낸다.
//
// 저장을 직접 고치지 않는다. 모든 변경은 거래 실행기를 거친다 — 앱이 실행기의 입구(send)를 넘긴다 (src/main/game.ts).
// 그래서 여기는 명령 보내기만 한다. 잠금 잡기와 파일 다시 읽기는 저장 감시(src/save/save-watch.ts)다.
// 무대가 읽을 모양(PartyPet)은 화면 값이 만든다 — 부르는 쪽이 partyPetsOf(party.save(), …)를 부른다 (src/view/party-pet.ts)
//
// 잠금 파일은 `save.lock` 이다. 기기에서 저장을 쓰는 프로세스는 하나다
// (docs/specs/modules.md "창이 여러 개여도 저장 쓰기는 주 프로세스 하나가 한다").
//   writer  잠금을 잡았다. 명령을 직접 실행한다
//   reader  못 잡았다. 명령을 mailbox 로 보내고, 파일이 바뀌면 다시 읽는다. 10초마다 다시 잡아 본다
// (예전 src/main/save-party.ts. 메인 레인 M8-8 에서 저장 층으로 옮겼다)
import { sendToWriter } from "./command-channel.js";
import { createEmptySave } from "./save-file.js";
import { createSaveWatch } from "./save-watch.js";
import type { CommandResult } from "../shared/command";
import type { HomePoint } from "../party/home";
import type { ManageReply, ManageRequest } from "../shared/ipc/manage";
import type { CommandSource } from "../shared/names/commands";
import type { SaveV3 } from "../shared/save-v3";
import type { Paths } from "../platform/paths";

export interface SavePartyOptions {
  send: (req: ManageRequest, from: CommandSource) => ManageReply; // 거래 실행기의 입구 — 앱은 game.send
  paths: Pick<Paths, "save" | "saveLock" | "mailbox">;
  now?: () => number;
  pid?: number;
  log?: ((o: Record<string, unknown>) => void) | null;
}

export interface SaveParty {
  isWriter(): boolean;
  needsStarter(): boolean;
  begin(species: string): boolean;
  setHome(id: string, home: HomePoint, screen?: unknown): Promise<CommandResult>; // 저장하지 못하면 그 이유를 돌려준다. screen 은 사는 화면(모든 화면 방식)
  setSize(id: string, size: number): Promise<CommandResult>; // 그림 크기 단계 번호. 규칙은 src/party/home.ts · src/save/rules.ts SIZE_STEPS
  setShown(id: string, shown: boolean): Promise<CommandResult>;
  save(): SaveV3 | null;
  refresh(): void; // 명령을 보낸 뒤 바로 다시 읽는다 — 감시를 기다리지 않는다
  onChange(cb: () => void): () => void;
  onRole(cb: (isWriter: boolean) => void): () => void;
  stop(): void;
}

export function createSaveParty(opts: SavePartyOptions): SaveParty {
  const { send, paths } = opts;
  const now = opts.now ?? Date.now;
  const sw = createSaveWatch({ paths, ...(opts.pid !== undefined ? { pid: opts.pid } : {}), log: opts.log ?? null });

  // reader 의 요청 — writer 가 처리해 파일에 쓰면 감시가 읽어 온다
  const ask = (cmd: "pet.set" | "party.show" | "party.hide", target: string, args?: Record<string, unknown>): Promise<CommandResult> =>
    sendToWriter(paths.mailbox, { cmd, target, ...(args ? { args } : {}), from: "pet" });

  return {
    isWriter: sw.isWriter,
    needsStarter: () => {
      const state = sw.save();
      return sw.holdsRole() && (!state || state.pets.length === 0);
    },
    begin(species) {
      if (!sw.holdsRole()) return false;
      // 저장이 아직 없으면 빈 저장을 먼저 만든다. 실행기는 읽을 것이 있어야 돈다
      if (!sw.save() && !createEmptySave(paths.save, now())) return false;
      const r = send({ cmd: "starter.pick", target: species, args: { reqId: `starter:${species}:${now()}` } }, "menu");
      sw.refresh();
      return r.ok;
    },
    async setHome(id, home, screen) {
      const extra = screen !== undefined ? { screen } : {};
      if (!sw.holdsRole()) return ask("pet.set", id, { home, ...extra });
      const r = send({ cmd: "pet.set", target: id, args: { home, ...extra, reqId: `home:${id}:${now()}` } }, "pet");
      sw.refresh();
      return r;
    },
    async setSize(id, size) {
      if (!sw.holdsRole()) return ask("pet.set", id, { size });
      const r = send({ cmd: "pet.set", target: id, args: { size, reqId: `size:${id}:${now()}` } }, "menu");
      sw.refresh();
      return r;
    },
    async setShown(id, shown) {
      if (!sw.holdsRole()) return ask(shown ? "party.show" : "party.hide", id);
      const r = send({ cmd: shown ? "party.show" : "party.hide", target: id, args: { reqId: `shown:${id}:${now()}` } }, "menu");
      sw.refresh();
      return r;
    },
    save: sw.save,
    refresh: sw.refresh,
    onChange: sw.onChange,
    onRole: sw.onRole,
    stop: sw.stop,
  };
}
