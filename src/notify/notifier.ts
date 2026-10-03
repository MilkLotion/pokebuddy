// 알림 배너 진행 — 줄을 notify.json 에 두고, 배너를 하나씩 내보낸다
//
// 저장을 쓰는 프로세스(writer) 하나만 부른다. 틱마다 저장을 훑고, 보이는 배너가 없으면 줄 맨 앞을 내보낸다.
// 배너가 끝나면(done) 다음 것을 내보낸다. 배너를 얼마나 보일지는 배너 창이 정한다.
// 파일을 쓰지 못해도 배너는 보인다. 바뀐 줄은 기억해 두었다가 다음 틱에 다시 쓴다
import fs from "node:fs";
import { writeAtomic } from "../platform/atomic-write.js";
import type { BannerView } from "../shared/model/overlays";
import type { SaveV3 } from "../shared/save-v3";
import { isNotifyState, refresh, sameState, settle, take, type NotifyState } from "./queue.js";

export interface NotifierOptions {
  file: string; // notify.json — 저장과 같은 폴더
  read: () => SaveV3 | null;
  now?: () => number;
  show: (banner: BannerView) => void;
  // 키 하나의 배너 — 문구는 화면 값이 만든다(src/view/banner.ts). 대상이 사라졌으면 null 이고 그 배너를 건너뛴다
  bannerOf: (save: SaveV3, key: string) => BannerView | null;
}

export interface Notifier {
  tick(): void; // 저장을 훑어 줄을 고치고, 비어 있으면 다음 배너를 내보낸다
  done(): void; // 보이던 배너가 사라졌다
  showing(): string | null; // 지금 보이는 배너의 키
  settle(): void; // 저장을 통째로 바꿔 받았다 — 받은 저장의 미처리 상태는 표시한 것으로 두고 줄을 비운다. 보이던 배너는 그대로 끝난다
  showOnce(banner: BannerView): boolean; // 줄 밖의 배너(안내) — 보이는 배너가 없을 때만 보이고 true. 보이는 동안 틱이 덮지 않는다
}

// 파일이 없거나 모양이 틀리면 null — 처음 켠 것으로 본다
function load(file: string): NotifyState | null {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return isNotifyState(v) ? v : null;
  } catch {
    return null;
  }
}

export function createNotifier({ file, read, now = Date.now, show, bannerOf }: NotifierOptions): Notifier {
  let state = load(file);
  let dirty = false; // 쓰지 못한 변경이 있다
  let current: string | null = null;

  const update = (next: NotifyState): void => {
    if (!sameState(state, next)) dirty = true;
    state = next;
  };
  const flush = (): void => {
    if (dirty && state && writeAtomic(file, state)) dirty = false;
  };

  const showNext = (save: SaveV3): void => {
    while (state && !current) {
      const next = take(state);
      if (!next) break;
      update(next.state);
      const banner = bannerOf(save, next.key);
      if (!banner) continue; // 대상이 사라졌다 — 표시한 것으로 두고 넘어간다
      current = next.key;
      flush(); // 보이기 전에 쓴다. 보이는 중에 앱이 끝나도 다시 뜨지 않는다
      show(banner);
      return;
    }
    flush();
  };

  const scan = (): void => {
    const save = read();
    if (!save) return;
    update(refresh(state, save, now()));
    if (current) flush();
    else showNext(save);
  };

  return {
    tick: scan,
    done() {
      current = null;
      scan();
    },
    showing: () => current,
    settle() {
      const save = read();
      if (!save) return;
      update(settle(state, save, now()));
      flush();
    },
    showOnce(banner) {
      if (current) return false;
      current = banner.key; // done 이 올 때까지 줄의 다음 배너를 내보내지 않는다
      show(banner);
      return true;
    },
  };
}
