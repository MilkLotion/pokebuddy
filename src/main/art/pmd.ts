// PMDCollab/SpriteCollab 스프라이트 — 동작마다 그림이 따로 있다.
//
// 자산: https://spriteserver.pmdcollab.org/assets/<4자리도감>/sprites.zip
//   안에 AnimData.xml 과 <동작>-Anim.png 들이 들어 있다. 풀지 않고 메모리에서 읽는다.
// 시트 배치: 행 = 방향 8종(0=정면 2=오른쪽 4=뒤 6=왼쪽), 열 = 프레임. 동작마다 칸 크기가 다르다.
// 라이선스: CC BY-NC 4.0 — 저장소에 넣지 않고 실행할 때 받아서 캐시한다.
// (예전 art/pmd.js. 도구 레인 T7a 에서 타입 검사를 받게 옮겼다)
import { readZip } from "../../platform/zip";
import type { PlayMode, SpriteSheet, StageSize } from "../../shared/model/stage";

type Zip = Map<string, Buffer>;
type WorkPlay = "once" | "loop";
interface AnimDecl {
  name: string;
  copyOf: string | null;
  fw: number;
  fh: number;
  durations: number[];
  sheet: string;
}
export interface Clip {
  anim: string;
  mode: PlayMode;
  row: number;
}
export interface Clips {
  cell: StageSize;
  body: StageSize;
  anims: Record<string, SpriteSheet>;
  clips: Record<string, Clip>;
  work: Record<string, WorkPlay>;
  workOnly: string[];
}

// 상태 → 쓸 동작. 앞에서부터 보유한 것을 고른다 (없으면 조용히 다음 것)
// mode: loop(반복) · once(한 번 재생하고 then 으로) · hold(한 번 재생하고 마지막 프레임에서 정지)
const STATE_ANIMS: Record<string, [string, PlayMode][]> = {
  idle: [["Idle", "loop"], ["Walk", "loop"]],
  running: [["Walk", "loop"], ["Hop", "loop"], ["Idle", "loop"]],
  waiting: [["Rotate", "loop"], ["LookUp", "loop"], ["Nod", "loop"], ["Idle", "loop"]],
  waving: [["Pose", "once"], ["Charge", "loop"], ["Nod", "once"], ["Idle", "loop"]],
  failed: [["Faint", "hold"], ["Trip", "hold"], ["Cringe", "once"], ["Hurt", "once"], ["Idle", "loop"]],
  review: [["Nod", "loop"], ["LookUp", "loop"], ["Idle", "loop"]],
};
// 옆모습이라 걷는 티가 나는 것만 오른쪽 행. 나머지는 정면
const ROW_OF: Record<string, number> = { running: 2 };
// 상태와 별개로 buddy 가 요청할 수 있는 동작 — 산책·수면·드래그·클릭 반응·한가할 때의 제자리 동작에 쓴다.
// 없는 동작은 조용히 빠지고, buddy 쪽이 후보 중 있는 것을 고른다
const EXTRA_ANIMS = [
  "Walk", "Sleep", "EventSleep", "Laying", "Wake", "Hurt", "Cringe", "Nod", "Pose", "Hop", "LookUp", "Rotate", "Sit", "DeepBreath",
];
// 추가 동작의 칸 크기 상한 — 상태 동작이 정한 칸의 이 배수까지만 받는다. 여기까지가 펫 "몸"이다.
// 자리(집·산책·가두기·저장)는 몸 칸으로 계산한다 — 작업 동작이 창을 키워도 펫이 서는 자리는 그대로다 (src/main/stage/layout.ts)
//   Hop  점프 높이까지 칸에 담겨 이브이 48→80, 썬더 104→136 — 몸에서는 빠지고 작업 동작으로만 들어온다
//   Hurt 이브이 40x48 → 48x48 로 가로 20% 늘지만 받는다 — 집어 들 때 아파하는 반응이 buddy 의 핵심이다
const EXTRA_BUDGET = 1.25;
// 작업 중(running)에만 하는 동작 → 재생 방식. 한가할 때는 쓰지 않아 일하는 중인지 한눈에 갈린다 (src/motion/brain.ts)
//   once  한 번 내지르고 숨을 고른다 — PMD 공격 동작은 게임에서 한 번 쓰는 0.3초 안팎의 동작이라 프레임이 17~33ms 이고
//         캐릭터가 칸 안에서 크게 움직인다. 이어서 반복하면 쪼는 것처럼 떨린다
//   loop  이어서 반복한다 — 움직임이 부드러운 것만
// 19종 시트를 재서 정했다 (50ms 이하 프레임 사이 중심 이동 · 좌우 뒤집힘). 동작 이름마다 종이 달라도 거의 같게 나온다
//   Attack·Strike 15~22px · Swing 11~16px · Hop 12px · Shoot 0~17px — 내지르고 제자리로 온다 → once
//   Charge 1px(19종) · Pull 0px(11종) · Twirl·Appeal·TailWhip 0~3px — 부드럽다 → loop
// 넣지 않는 것
//   Double       좌우 두 자리를 33ms 마다 번갈아 그린다(37px · 14번 뒤집힘, 19종 모두) — 두 마리로 보였다
//   Shock        번개 효과로 그림 면적이 2.2배를 오간다 — 도트가 흩어져 보인다
//   QuickStrike  한 프레임에 27~56px 순간이동한다
//   LeapForth    앞으로 뛰쳐나간 자세로 끝난다(끝이 시작에서 16~25px) — 제자리로 돌아올 때 튄다
//   Emit         2종 중 1종이 떨린다(5번 뒤집힘)
// 공격 동작은 몸을 내밀어 칸이 크다(피카츄 Idle 40x56 · Attack 80x80 · Swing 80x96). 그래서 몸보다 넉넉한 WORK_BUDGET 까지 받는다.
// 창은 이 칸만큼 커지지만 그림이 없는 투명한 곳의 클릭은 아래 창으로 통과한다 (src/main/stage/stage-window.ts hoverTick)
// 표본 50종 실측 — 2배면 Attack 40종 · Swing 31종이 들어오고 창 면적은 중앙값 2.7배(최대 4배). 1.5배는 Attack 9종뿐이다
const WORK_PLAY: Record<string, WorkPlay> = {
  Attack: "once", Strike: "once", MultiStrike: "once", Kick: "once", Punch: "once", Slam: "once", Stomp: "once",
  Swing: "once", Shoot: "once", SpAttack: "once", Rumble: "once", RearUp: "once", Hop: "once",
  Charge: "loop", Pull: "loop", Twirl: "loop", Appeal: "loop", TailWhip: "loop", Dance: "loop", Shake: "loop",
};
const WORK_BUDGET = 2;
const DUR_UNIT = 1000 / 60; // AnimData 의 Duration 은 1/60초 단위

const tag = (block: string, name: string): string | null => {
  const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1]!.trim() : null;
};

// AnimData.xml 은 도구가 만든 고정 형식이라 전용 파서로 충분하다 (메인 프로세스엔 DOMParser 가 없다)
function parseAnimData(xml: string): Map<string, AnimDecl> {
  const raw = new Map<string, Omit<AnimDecl, "sheet">>();
  for (const m of xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)) {
    const block = m[1]!;
    const name = tag(block, "Name");
    if (!name) continue;
    const durs = [...block.matchAll(/<Duration>(\d+)<\/Duration>/g)].map((d) => Number(d[1]));
    raw.set(name, {
      name,
      copyOf: tag(block, "CopyOf"),
      fw: Number(tag(block, "FrameWidth")) || 0,
      fh: Number(tag(block, "FrameHeight")) || 0,
      durations: durs,
    });
  }

  // CopyOf 는 참조 대상보다 먼저 나올 수 있다 — 전부 모은 뒤에 푼다
  const out = new Map<string, AnimDecl>();
  for (const [name, a] of raw) {
    let cur = a;
    for (let depth = 0; cur.copyOf && depth < 4; depth++) cur = raw.get(cur.copyOf) || cur;
    if (!cur.fw || !cur.fh || !cur.durations.length) continue;
    out.set(name, { ...cur, name, sheet: cur.name });
  }
  return out;
}

// PNG 머리말에서 크기만 읽는다 (행 수 = 높이 / 칸 높이)
function pngSize(buf: Buffer): StageSize | null {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// 동작 하나를 시트로 만든다. 시트가 선언과 안 맞으면 null
function sheetOf(zip: Zip, anims: Map<string, AnimDecl>, name: string): SpriteSheet | null {
  const a = anims.get(name);
  if (!a) return null;
  const png = zip.get(`${a.sheet}-Anim.png`);
  const size = png && pngSize(png);
  if (!png || !size) return null;
  const cols = Math.floor(size.w / a.fw);
  const rows = Math.floor(size.h / a.fh);
  // 프레임 수가 선언과 다르면 시트가 깨진 것 — 쓰지 않는다
  if (cols !== a.durations.length || rows < 1) return null;
  return {
    fw: a.fw,
    fh: a.fh,
    rows,
    frames: a.durations.map((d, i) => ({ x: i, ms: Math.round(d * DUR_UNIT) })),
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
  };
}

// 그림 묶음을 만든다.
//   anims     동작 이름 → 시트 (여러 상태가 같은 동작을 쓰면 한 번만 담긴다)
//   clips     상태 → { anim, mode, row }
//   cell      담긴 모든 동작의 최대 칸 — 창 크기가 된다
//   body      작업 동작을 빼고 잰 칸 — 펫 몸. 자리 계산의 기준이다
//   work      가진 작업 동작 이름 → 재생 방식 (WORK_PLAY). 상태 동작으로 이미 담긴 Charge 등도 들어간다
//   workOnly  작업 동작으로만 담긴 이름 — 만지기 반응에는 쓰지 않는다. 예전에 칸이 커서 빠지던 Hop 이
//             작업 동작으로 담기면서 내려놓기·클릭 반응이 끄덕임에서 연속 점프로 바뀌었다
// work 옵션이 false 면 작업 동작을 담지 않는다 — buddy 가 꺼져 있으면 쓸 일이 없는데 창만 커진다
function buildClips(zip: Zip, { work = true }: { work?: boolean } = {}): Clips | null {
  const xml = zip.get("AnimData.xml");
  if (!xml) return null;
  const parsed = parseAnimData(xml.toString("utf8"));

  const anims: Record<string, SpriteSheet | null> = {};
  const clips: Record<string, Clip> = {};
  const take = (name: string): SpriteSheet | null => {
    if (!(name in anims)) anims[name] = sheetOf(zip, parsed, name);
    return anims[name]!;
  };
  for (const [state, candidates] of Object.entries(STATE_ANIMS)) {
    for (const [anim, mode] of candidates) {
      const sheet = take(anim);
      if (!sheet) continue;
      clips[state] = { anim, mode, row: Math.min(ROW_OF[state] ?? 0, sheet.rows - 1) }; // 1행짜리 동작 방어
      break;
    }
  }
  if (!clips.idle) return null; // idle 도 못 구하면 이 펫은 PMD 로 못 그린다

  // 후보로 들여다봤지만 시트가 없던 것(null)을 걷어낸다. 채택된 후보에서 멈추므로 성공한 시트는 모두 쓰인다
  for (const name of Object.keys(anims)) if (!anims[name]) delete anims[name];
  // 담긴 동작 전부를 덮는 칸
  const fitAll = () => {
    const box = { w: 0, h: 0 };
    for (const a of Object.values(anims)) {
      if (!a) continue;
      box.w = Math.max(box.w, a.fw);
      box.h = Math.max(box.h, a.fh);
    }
    return box;
  };
  // 상태 동작의 칸 — 추가 동작의 상한은 이것을 기준으로 잰다
  const base = fitAll();
  const fits = (sheet: SpriteSheet, budget: number): boolean => sheet.fw <= base.w * budget && sheet.fh <= base.h * budget;

  for (const name of EXTRA_ANIMS) {
    if (anims[name]) continue;
    const sheet = sheetOf(zip, parsed, name);
    if (sheet && fits(sheet, EXTRA_BUDGET)) anims[name] = sheet;
  }
  const body = fitAll();

  const workPlay: Record<string, WorkPlay> = {};
  const workOnly: string[] = [];
  if (work) {
    for (const [name, play] of Object.entries(WORK_PLAY)) {
      if (!anims[name]) {
        const sheet = sheetOf(zip, parsed, name);
        if (!sheet || !fits(sheet, WORK_BUDGET)) continue;
        anims[name] = sheet;
        workOnly.push(name);
      }
      workPlay[name] = play;
    }
  }
  return { cell: fitAll(), body, anims: anims as Record<string, SpriteSheet>, clips, work: workPlay, workOnly };
}

export const readZipClips = (buf: Buffer, opts?: { work?: boolean }): Clips | null => buildClips(readZip(buf), opts);
