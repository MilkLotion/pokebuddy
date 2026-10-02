// 스프라이트 — look 별 시트 캐시(Image + 히트용 ImageData)와 마리별 재생 상태기(Animator).
//
// PMD 시트: 행 = 방향 8종(0=정면 2=오른쪽 4=뒤 6=왼쪽), 열 = 프레임. 칸 크기가 동작마다 다르다.
// 프레임 지속시간이 프레임마다 다르다(AnimData.xml) — 균일 간격으로는 표현할 수 없어 누적 시간으로 넘긴다.
//
// 무엇을 재생할지는 두 갈래다 (옛 renderer/pmd.js 와 같다. 이제 마리마다 따로 돈다).
//   상태  Claude 상태(idle·running…)에 붙은 동작 clips[state]. 기본값
//   play  움직임 모듈이 고른 동작 — 산책·수면·반응. 있으면 상태보다 앞선다. null 이면 상태로 돌아간다
import type { LookSheets, Play, PlayMode, SpriteSheet, StagePet, StageState } from "../shared/model/stage.js";

export const TICK_MS = 16;
// 창이 숨었다 돌아오면 밀린 시간이 쌓여 있다. 따라잡지 않고 지금부터 다시 센다
const CATCHUP_LIMIT_MS = 250;
// 한 번만 재생하는 상태 동작(턴 끝 인사 Pose 등)의 최소 길이 — 인사 한 번이 0.4초라 한 번만 틀면 못 본다.
// 이 길이가 될 때까지 처음부터 되풀이한 뒤 대기로 돌아간다
const ONCE_MIN_MS = 2000;

export interface Clip {
  anim: string;
  mode: PlayMode;
  row: number;
}

// 디코드가 끝난 look 하나 — 못 읽은 시트와 그것을 가리키는 clip 은 빠져 있다. idle 은 보장
export interface LookArt {
  look: string;
  body: LookSheets["body"];
  cell: LookSheets["cell"];
  anims: Record<string, SpriteSheet>;
  clips: Record<string, Clip>;
  idle: Clip;
  images: Map<string, HTMLImageElement>;
  alpha: Map<string, ImageData>; // 히트용 — 시트 전체 RGBA 를 한 번만 읽어 둔다 (무대 캔버스는 되읽지 않는다)
}

// 시트 픽셀을 한 번 읽는 숨긴 캔버스 — 무대 캔버스는 되읽지 않는다(GPU 가속 유지).
// 시트마다 새 캔버스 — 한 캔버스를 여러 번 되읽으면 Chrome 이 willReadFrequently 를 권하는 경고를 낸다. 읽고 버린다
function readAlpha(img: HTMLImageElement): ImageData | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w < 1 || h < 1) return null;
  const scratch = document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  const c = scratch.getContext("2d");
  if (!c) return null;
  c.drawImage(img, 0, 0);
  return c.getImageData(0, 0, w, h);
}

async function decode(dataUrl: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = dataUrl;
  try {
    await img.decode();
    return img;
  } catch {
    return null; // 깨진 시트 — 그 동작만 뺀다 (이유는 SpriteStore.reason 으로)
  }
}

export class SpriteStore {
  private readonly looks = new Map<string, LookArt>();
  private readonly reasons = new Map<string, string>(); // look → 못 쓰는 이유
  private readonly tokens = new Map<string, number>(); // 같은 look 이 다시 오면 늦게 끝난 옛 디코드를 버린다

  get(look: string): LookArt | null {
    return this.looks.get(look) ?? null;
  }

  reason(look: string): string | null {
    return this.reasons.get(look) ?? null;
  }

  keys(): string[] {
    return [...this.looks.keys()];
  }

  // 시트를 전부 불러온 뒤 등록한다 — 중간에 비면 빈 칸이 보인다. ok 면 등록됨, missing 은 못 읽어 뺀 동작
  async put(sheets: LookSheets): Promise<PutResult> {
    const token = (this.tokens.get(sheets.look) ?? 0) + 1;
    this.tokens.set(sheets.look, token);

    const images = new Map<string, HTMLImageElement>();
    const alpha = new Map<string, ImageData>();
    const missing: string[] = [];
    await Promise.all(
      Object.entries(sheets.anims).map(async ([name, sheet]) => {
        const img = await decode(sheet.dataUrl);
        const px = img && readAlpha(img);
        if (!img || !px) {
          missing.push(name);
          return;
        }
        images.set(name, img);
        alpha.set(name, px);
      }),
    );
    if (this.tokens.get(sheets.look) !== token) return { ok: false, missing, reason: "더 새 시트가 이미 왔다" };

    const anims: Record<string, SpriteSheet> = {};
    for (const [name, sheet] of Object.entries(sheets.anims)) if (images.has(name)) anims[name] = sheet;
    // 못 불러온 동작을 가리키는 상태는 지운다 — 남겨두면 그 상태를 골라 그리기가 아무것도 안 그리고,
    // 직전 그림이 캔버스에 그대로 남는다(hold 면 그 상태로 굳는다)
    const clips: Record<string, Clip> = {};
    for (const [state, c] of Object.entries(sheets.clips)) if (images.has(c.anim)) clips[state] = { anim: c.anim, mode: c.mode, row: c.row };
    const idle = clips["idle"];
    if (!idle) {
      const reason = `idle 그림을 불러오지 못했다 (빠진 시트: ${missing.join(" ") || "없음"})`;
      this.looks.delete(sheets.look);
      this.reasons.set(sheets.look, reason);
      return { ok: false, missing, reason };
    }
    this.reasons.delete(sheets.look);
    this.looks.set(sheets.look, { look: sheets.look, body: sheets.body, cell: sheets.cell, anims, clips, idle, images, alpha });
    return { ok: true, missing, reason: null };
  }
}

export interface PutResult {
  ok: boolean;
  missing: string[];
  reason: string | null;
}

// 지금 그릴 프레임
export interface Shown {
  anim: string;
  row: number;
  col: number;
}

const asPlay = (c: Clip): Play => ({ anim: c.anim, row: c.row, mode: c.mode, rate: 1 });
const samePlay = (a: Play | null, b: Play | null) =>
  a === b || (!!a && !!b && a.anim === b.anim && a.row === b.row && a.mode === b.mode && a.rate === b.rate);
const sameShown = (a: Shown | null, b: Shown | null) =>
  a === b || (!!a && !!b && a.anim === b.anim && a.row === b.row && a.col === b.col);
// 프레임 지속시간 — rate 배 빠르게 (산책 속도에 맞춰 걷는 그림도 빨라지고 느려진다)
const msOf = (sheet: SpriteSheet, i: number, rate: number) => (sheet.frames[i]?.ms ?? 100) / rate;

// 있는 동작만 받는다 — 방향 행은 그 시트에 있는 범위로 줄인다 (1행짜리 동작 방어)
// 이름은 자기 키로만 찾는다 — "constructor" 같은 프로토타입 이름이 통과하면 그리다 죽는다
function sanitize(art: LookArt, req: Play): Play | null {
  if (typeof req.anim !== "string" || !Object.hasOwn(art.anims, req.anim)) return null;
  const sheet = art.anims[req.anim];
  if (!sheet) return null;
  const row = Math.min(Math.max(0, Math.round(req.row) || 0), sheet.rows - 1);
  const mode: PlayMode = req.mode === "hold" ? "hold" : "loop"; // play 는 반복 또는 끝 자세 유지 — 언제 끝낼지는 메인이 정한다
  // 재생 속도 — 없거나 망가진 값이면 원래 속도. 0 에 가까우면 멈춘 것처럼 보이고 너무 크면 깜박이므로 가둔다
  const rate = Number.isFinite(req.rate) ? Math.min(Math.max(req.rate, 0.25), 4) : 1;
  return { anim: req.anim, row, mode, rate };
}

// 마리 하나의 재생 상태기 — 옛 pmd.js setup() 안의 cur·frame·due·frozen·doneState·onceUntil 을 인스턴스로
export class Animator {
  private act: Play | null = null; // 메인이 고른 동작 (걸러진 것만) — 상태보다 앞선다
  private cur: Play | null = null; // 지금 재생 중. 첫 재생 전·시트 없을 때 null
  private frame = 0;
  private due = 0;
  private frozen = false; // 한 번 재생이 끝나 마지막 프레임에서 멈춘 상태
  private state: StageState = "idle";
  // 한 번만 재생하는 상태 동작(waving=Pose once · failed=Faint hold)을 이미 끝까지 보여준 상태.
  // play 가 끼어들었다 null 로 돌아와도 다시 재생하지 않는다 — 또 인사하고, 또 쓰러지면 이상하다. 상태가 바뀌면 지운다
  private doneState: StageState | null = null;
  private onceUntil = 0; // 한 번만 재생하는 상태 동작을 되풀이할 끝 시각 (ONCE_MIN_MS)

  constructor(
    private readonly store: SpriteStore,
    readonly look: string,
  ) {}

  // 메인 프레임을 반영한다 — 그릴 프레임이 바뀌었으면 true. 시트가 아직 없으면 그릴 것이 없다(null)
  update(pet: StagePet, state: StageState, now: number): boolean {
    const art = this.store.get(this.look);
    if (!art) {
      const had = this.cur !== null;
      this.cur = null;
      return had;
    }
    const before = this.current();
    let stateChanged = false;
    if (state !== this.state) {
      this.state = state;
      this.doneState = null;
      stateChanged = true;
    }
    let actChanged = false;
    if (pet.play === null) {
      if (this.act) {
        this.act = null; // 이미 상태 동작이면 같은 null 이 또 와도 되감지 않는다
        actChanged = true;
      }
    } else {
      const ok = sanitize(art, pet.play);
      // 없는 동작 — 지금 재생 중인 것을 지우지 않고 무시한다
      if (ok && !samePlay(ok, this.act)) {
        this.act = ok;
        actChanged = true;
      }
    }
    // 상태만 바뀌었을 때 play 가 있으면 그대로 둔다 — 상태 동작은 play 가 끝난 뒤 wanted() 가 고른다
    if (!this.cur || actChanged || (stateChanged && !this.act)) this.play(art, this.wanted(art), now);
    return !sameShown(before, this.current());
  }

  // 16ms 마다 — 프레임을 넘겼으면 true
  step(now: number): boolean {
    if (this.frozen || !this.cur || now < this.due) return false;
    const art = this.store.get(this.look);
    const sheet = art?.anims[this.cur.anim];
    if (!art || !sheet) return false;
    const before = this.current();

    if (this.frame + 1 >= sheet.frames.length) {
      if (this.cur.mode === "loop") this.frame = 0;
      else if (this.cur.mode === "hold") {
        this.frozen = true; // 쓰러진 채로·반응 끝 자세로 있는다. play 면 메인이 다음 동작을 보낸다
        if (!this.act) this.doneState = this.state;
        return false;
      } else if (now < this.onceUntil) {
        this.frame = 0; // once — 최소 길이가 안 됐다. 처음부터 한 번 더
      } else {
        // once — 상태 동작(waving=Pose)만 쓴다. 보여주고 돌아온다. 끝났다고 적어 두어, 상태가 그대로여도 다시 고르지 않게 한다
        this.doneState = this.state;
        this.play(art, this.wanted(art), now);
        return !sameShown(before, this.current());
      }
    } else {
      this.frame += 1;
    }

    this.due += msOf(sheet, this.frame, this.cur.rate);
    if (now - this.due > CATCHUP_LIMIT_MS) this.due = now + msOf(sheet, this.frame, this.cur.rate);
    return !sameShown(before, this.current());
  }

  current(): Shown | null {
    if (!this.cur) return null;
    const sheet = this.store.get(this.look)?.anims[this.cur.anim];
    if (!sheet) return null;
    return { anim: this.cur.anim, row: this.cur.row, col: sheet.frames[this.frame]?.x ?? 0 };
  }

  // 디버그 표시용
  describe(): string {
    const c = this.cur;
    if (!c) return "(시트 없음)";
    return `${this.act ? "play" : this.state}:${c.anim}#${c.row}/${this.frame}${c.mode === "loop" ? "" : ` ${c.mode}`}${this.frozen ? " ■" : ""}`;
  }

  // 지금 보여야 할 동작 — play 가 있으면 그것, 없으면 상태에 붙은 것
  private wanted(art: LookArt): Play {
    if (this.act) return this.act;
    const c = art.clips[this.state] ?? art.idle;
    if (this.doneState === this.state && c.mode === "once") return asPlay(art.idle); // 인사는 끝났다
    return asPlay(c);
  }

  private play(art: LookArt, next: Play, now: number) {
    const prev = this.cur;
    this.cur = next;
    // 같은 그림을 계속 도는 전환은 되감지 않는다 — 되감으면 뚝 끊긴다.
    // idle→waiting 이 둘 다 Idle 루프인 경우, 산책 중 방향·속도만 바뀌는 경우(프레임은 잇고 행만 바꿔 그린다)
    if (prev && prev.anim === next.anim && prev.mode === "loop" && next.mode === "loop") return;
    const sheet = art.anims[next.anim];
    if (!sheet) return;
    // 되풀이 동작은 아무 프레임에서 시작한다 — 여러 마리가 같은 틱에 같은 동작을 받아도 박자가 어긋난다
    this.frame = next.mode === "loop" ? Math.floor(Math.random() * sheet.frames.length) : 0;
    this.frozen = false;
    // 이미 쓰러진 상태로 돌아오면 쓰러지는 과정을 다시 보이지 않고 마지막 자세로 둔다
    if (!this.act && next.mode === "hold" && this.doneState === this.state) {
      this.frame = sheet.frames.length - 1;
      this.frozen = true;
    }
    this.due = now + msOf(sheet, this.frame, next.rate) * (next.mode === "loop" ? Math.random() : 1);
    if (next.mode === "once") this.onceUntil = now + ONCE_MIN_MS;
  }
}
