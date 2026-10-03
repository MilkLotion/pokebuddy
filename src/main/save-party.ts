// 마리 목록의 출처 (저장 v3) — 무대는 이것 하나만 본다.
//
// 저장을 직접 고치지 않는다. 모든 변경은 거래 실행기(`src/main/game.ts`)를 거친다.
// 그래서 여기는 세 가지만 한다 — 잠금 잡기, 파일 다시 읽기, 무대가 읽을 모양으로 바꾸기.
//
// 잠금 파일은 `save.lock` 이다. 기기에서 저장을 쓰는 프로세스는 하나다
// (docs/specs/modules.md "창이 여러 개여도 저장 쓰기는 주 프로세스 하나가 한다").
//   writer  잠금을 잡았다. 명령을 직접 실행한다
//   reader  못 잡았다. 명령을 mailbox 로 보내고, 파일이 바뀌면 다시 읽는다. 10초마다 다시 잡아 본다
//
// 파일 감시는 두 역할 모두 건다. 자기가 쓴 것도 감시로 돌아와 읽으므로 메모리와 파일이 갈라지지 않는다.
import fs from "node:fs";
import { appearanceOf } from "../dex/appearance";
import path from "node:path";
import * as mailbox from "../save/mailbox.js";
import * as store from "../save/store.js";
import { emptySave as empty } from "../save/normalize.js";
import * as writer from "../save/writer.js";
import type { CommandResult } from "../shared/command";
import type { NatureId } from "../shared/species";
import type { SaveV3, ScreenRefV3 } from "../shared/save-v3";
import type { GameV3 } from "./game";
import type { Home } from "./layout";
import type { Paths } from "./paths";

// 무대가 보는 마리 하나 — 무대에 필요한 것만
export interface PartyPet {
  id: string;
  species: string;
  look: string; // 그릴 그림 — 종(이로치면 ":shiny" 를 붙인다)
  size: number; // 도트 배율 (zoomOf 로 가둔다)
  nature: NatureId | null;
  home: Home;
  screen: ScreenRefV3 | null; // 모든 화면 방식에서 사는 화면 — 없으면 무대 묶음이 개체가 가장 적은 화면에 둔다 (src/main/stage-group.ts)
  shown: boolean;
}

export const SAVE_PARTY_RULES = {
  reclaimMs: 10_000, // reader 가 writer 자리를 다시 잡아 보는 간격
};

export interface SavePartyOptions {
  game: GameV3;
  paths: Pick<Paths, "save" | "saveLock" | "mailbox">;
  now?: () => number;
  pid?: number;
  log?: ((o: Record<string, unknown>) => void) | null;
}

export interface SaveParty {
  pets(): PartyPet[]; // 무대에 나올 마리 — 꺼내 놓은 것만
  all(): PartyPet[]; // 파티 칸에 있는 마리 전부 — 숨긴 것도
  isWriter(): boolean;
  needsStarter(): boolean;
  begin(species: string): boolean;
  setHome(id: string, home: Home, screen?: unknown): Promise<CommandResult>; // 저장하지 못하면 그 이유를 돌려준다. screen 은 사는 화면(모든 화면 방식)
  setSize(id: string, size: number): Promise<CommandResult>; // 그림 크기 단계 번호. 규칙은 src/party/home.ts · src/save/rules.ts SIZE_STEPS
  setShown(id: string, shown: boolean): Promise<CommandResult>;
  save(): SaveV3 | null;
  refresh(): void; // 명령을 보낸 뒤 바로 다시 읽는다 — 감시를 기다리지 않는다
  onChange(cb: () => void): () => void;
  onRole(cb: (isWriter: boolean) => void): () => void;
  stop(): void;
}

export function createSaveParty(opts: SavePartyOptions): SaveParty {
  const { game, paths } = opts;
  const now = opts.now ?? Date.now;
  const pid = opts.pid ?? process.pid;
  const log = opts.log ?? null;

  let state: SaveV3 | null = null;
  let amWriter = false;
  let closed = false;
  let cacheKey: string | null = null; // mtime·크기가 같으면 다시 파싱하지 않는다
  let watcher: fs.FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  const changeCbs = new Set<() => void>();
  const roleCbs = new Set<(w: boolean) => void>();

  const emitChange = (): void => {
    for (const cb of changeCbs) cb();
  };
  const emitRole = (): void => {
    for (const cb of roleCbs) cb(amWriter);
  };

  // 실제 종의 이름과 그림을 보인다. v2 에서 옮겨 온 별명·모습은 legacy 에 보존만 하고 쓰지 않는다
  // (docs/specs/game.md "별명 입력과 모습 선택을 제공하지 않는다. 실제 종의 이름과 그림을 표시한다")
  const petView = (save: SaveV3, petId: string, hidden: boolean): PartyPet | null => {
    const pet = save.pets.find((p) => p.id === petId);
    if (!pet) return null;
    return {
      id: pet.id,
      species: pet.species,
      look: appearanceOf(pet), // 메가 모습이 켜져 있으면 그 그림이다 (src/dex/mega.ts)
      size: pet.size,
      nature: pet.nature,
      home: { ...pet.home },
      screen: pet.screen ? { ...pet.screen } : null,
      shown: !hidden,
    };
  };

  const slotPets = (onlyShown: boolean): PartyPet[] => {
    if (!state) return [];
    const out: PartyPet[] = [];
    for (const slot of state.party.slots) {
      if (slot.state !== "pokemon" || !slot.petId) continue;
      if (onlyShown && slot.hidden === true) continue;
      const view = petView(state, slot.petId, slot.hidden === true);
      if (view) out.push(view);
    }
    return out;
  };

  // 파일을 다시 읽는다. 바뀐 것이 없으면 아무것도 하지 않는다
  function reload(force = false): void {
    let key: string | null = null;
    try {
      const st = fs.statSync(paths.save);
      key = `${st.mtimeMs}:${st.size}`;
    } catch {
      key = null;
    }
    if (!force && key === cacheKey) return;
    if (key == null) {
      cacheKey = null;
      if (state) {
        state = null;
        emitChange();
      }
      return;
    }
    // 읽기 전용은 파손 파일을 옮기지 않는다 — writer 의 일이다
    const r = store.read(paths.save, { repair: amWriter });
    if (r.reason === "unreadable" || r.reason === "locked") return; // 잠깐 잠겼다·키 없이 암호화 파일 — 지난 값을 그대로 쓴다
    if (r.migrated) log?.({ party: "migrated-v3", backup: store.backupName(paths.save) });
    if (r.corrupted) log?.({ party: "save-corrupted", movedTo: r.movedTo ?? null });
    cacheKey = key;
    state = r.state;
    emitChange();
  }

  // 폴더를 본다. 파일을 직접 보면 원자적 쓰기(rename) 뒤에 감시가 끊긴다
  function watch(): void {
    if (watcher) return;
    const dir = path.dirname(paths.save);
    const base = path.basename(paths.save);
    let pending = false;
    try {
      fs.mkdirSync(dir, { recursive: true });
      watcher = fs.watch(dir, (_event, filename) => {
        if (pending || closed) return;
        if (filename && filename !== base) return;
        pending = true;
        setImmediate(() => {
          pending = false;
          if (!closed) reload();
        });
      });
      watcher.on("error", () => {
        // 폴더가 사라졌다 — 10초 재확인이 받쳐 준다
      });
    } catch {
      watcher = null;
    }
  }

  function claim(): boolean {
    if (closed) return false;
    if (amWriter && writer.isMine(paths.saveLock, pid)) return true;
    const r = writer.claim(paths.saveLock, pid);
    if (!r.ok) {
      if (amWriter) resign();
      return false;
    }
    if (amWriter) return true; // 잠금 파일만 사라졌던 것 — 다시 적었다
    amWriter = true;
    reload(true); // writer 가 되면 파일을 진실로 다시 읽는다 (이전이 필요하면 여기서 일어난다)
    log?.({ party: "writer", pets: state?.pets.length ?? 0 });
    emitRole();
    return true;
  }

  function resign(): void {
    if (amWriter) writer.release(paths.saveLock, pid);
    amWriter = false;
    cacheKey = null;
    log?.({ party: "reader" });
    emitRole();
  }

  function tick(): void {
    if (closed) return;
    if (!amWriter) claim();
  }

  // reader 의 요청 — writer 가 처리해 파일에 쓰면 감시가 읽어 온다
  const ask = (cmd: "pet.set" | "party.show" | "party.hide", target: string, args?: Record<string, unknown>): Promise<CommandResult> =>
    mailbox.send(paths.mailbox, { cmd, target, ...(args ? { args } : {}), from: "pet" });

  // 처음 한 번 — 잡아 보고 파일을 읽는다
  claim();
  reload(true);
  watch();
  timer = setInterval(tick, SAVE_PARTY_RULES.reclaimMs);

  return {
    pets: () => slotPets(true),
    all: () => slotPets(false),
    isWriter: () => amWriter && writer.isMine(paths.saveLock, pid),
    needsStarter: () => amWriter && (!state || state.pets.length === 0),
    begin(species) {
      if (!amWriter) return false;
      // 저장이 아직 없으면 빈 저장을 먼저 만든다. 실행기는 읽을 것이 있어야 돈다
      if (!state && !store.write(paths.save, empty(now()))) return false;
      const r = game.send({ cmd: "starter.pick", target: species, args: { reqId: `starter:${species}:${now()}` } }, "menu");
      reload(true);
      return r.ok;
    },
    async setHome(id, home, screen) {
      const extra = screen !== undefined ? { screen } : {};
      if (!amWriter) return ask("pet.set", id, { home, ...extra });
      const r = game.send({ cmd: "pet.set", target: id, args: { home, ...extra, reqId: `home:${id}:${now()}` } }, "pet");
      reload(true);
      return r;
    },
    async setSize(id, size) {
      if (!amWriter) return ask("pet.set", id, { size });
      const r = game.send({ cmd: "pet.set", target: id, args: { size, reqId: `size:${id}:${now()}` } }, "menu");
      reload(true);
      return r;
    },
    async setShown(id, shown) {
      if (!amWriter) return ask(shown ? "party.show" : "party.hide", id);
      const r = game.send({ cmd: shown ? "party.show" : "party.hide", target: id, args: { reqId: `shown:${id}:${now()}` } }, "menu");
      reload(true);
      return r;
    },
    save: () => state,
    refresh: () => reload(true),
    onChange(cb) {
      changeCbs.add(cb);
      return () => changeCbs.delete(cb);
    },
    onRole(cb) {
      roleCbs.add(cb);
      return () => roleCbs.delete(cb);
    },
    stop() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = null;
      try {
        watcher?.close();
      } catch {
        // 이미 닫혔다
      }
      watcher = null;
      if (amWriter) writer.release(paths.saveLock, pid);
      amWriter = false;
    },
  };
}
