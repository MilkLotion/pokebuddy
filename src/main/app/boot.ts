// 부팅 단계 가운데 앱 전역을 쓰지 않는 것 (worklog/records/code-structure/design/10-main.md 3.13절 app/boot.ts, 4.1절)
//
// 4단계 저장 키 — 저장 읽기·쓰기가 이 키로 암호화한다 (src/save/key.ts). 기존 평문 저장은 여기서 한 번 옮긴다.
import { prepareSaveKey, setAsideKeyAndSave, type PrepareSaveKeyOptions } from "../../save/key";
import { isSealedOnDisk } from "../../save/save-file";
import { createKeyVault } from "../services/vault";
import type { Notifier } from "../../notify/notifier";
import type { Anchor } from "../anchor";
import type { Commands } from "./commands";
import type { GameV3 } from "../../tx/game";
import type { HookUpkeep } from "./hook-upkeep";
import type { Lifetime } from "./lifetime";
import type { Portraits } from "../art/portraits";
import type { SaveParty } from "../../save/save-party";
import type { StageGroup } from "../stage-group";
import type { TrayHandle } from "../menus/tray";
import type { BannerWindow } from "../windows/banner-window";
import type { ScreenPicker } from "../windows/screen-picker";
import type { DebugLog } from "./log";

// 부팅이 만든 핸들 한 벌 — 처음은 모두 null 이고 부팅 단계가 채운다. 끌 때 정리한다
// 앞에서 만든 콜백(관리 창·메뉴·틱·서비스)이 핸들을 부를 때 읽으므로, 값을 돌려받지 않고 한 객체에 채운다
export interface Runtime {
  portraits: Portraits | null; // 그림 캐시 — 관리 창·선택 창과 무대 말풍선 아이콘이 함께 쓴다
  game: GameV3 | null; // 저장을 쓰는 곳은 하나다 — 거래 실행기. 무대·메뉴·관리 창이 모두 이 하나를 본다
  notifier: Notifier | null; // 알림 배너의 줄 — 저장을 쓰는 프로세스만 배너를 띄운다
  hookUpkeep: HookUpkeep | null; // 켤 때 훅 정리와 Codex 창 깜빡임 한 번 알림 — writer 만
  bannerWin: BannerWindow | null; // 알림 배너의 창
  party: SaveParty | null; // 저장 감시 — writer 잡기와 무대가 볼 마리 목록
  lifetime: Lifetime | null; // 동반자 lock 수명 감시
  stages: StageGroup | null; // 무대 — 화면마다 무대 창과 마리 움직임 한 쌍. 한 화면·영역 지정이면 한 쌍이다
  anchor: Anchor | null; // 호스트·표시 판정(헬퍼)
  commands: Commands | null; // 명령 통로
  tray: TrayHandle | null;
  screenPicker: ScreenPicker | null; // 놀이공간 화면 번호 덮개
}

export interface SaveKeyDeps {
  saveFile: string;
  // 새 키를 만들어도 되는가 — 개발 실행·업데이트 시험 빌드만 POKEBUDDY_SAVE_CRYPT=off 로 새 키를 만들지 않는다(저장을 직접 읽는 E2E 용).
  // 이미 키가 있으면 그대로 쓴다
  create: boolean;
  askLocked(): Promise<"quit" | "fresh">; // 잠긴 저장 창 — 종료·새로 시작
  onLocked(): void; // 종료를 골랐거나 백업을 못 했다 — 실패를 알리고 끝낸다
  log: DebugLog;
}

// 저장 키를 준비한다. 끝내야 하면 onLocked 를 부르고 false
export async function bootSaveKey(deps: SaveKeyDeps): Promise<boolean> {
  const keyOptions: PrepareSaveKeyOptions = {
    saveFile: deps.saveFile,
    vault: createKeyVault(),
    create: deps.create,
  };
  let saveKey = await prepareSaveKey(keyOptions);
  deps.log?.({ boot: "save-key", ...saveKey });
  // 키 없이 도는데 암호화 저장이 있다(키체인 거부·키 파일 잠김·키 저장소 없음) — 저장을 옮기지 않고 묻는다.
  // 종료면 저장을 그대로 두고 끝낸다. 새로 시작이면 키와 저장을 백업(.unreadable-<시각>.bak)하고 다시 준비한다 — 계정 저장은 클라우드가 받는다
  if (saveKey.status !== "ok" && saveKey.status !== "reset" && isSealedOnDisk(deps.saveFile)) {
    const answer = await deps.askLocked();
    if (answer === "fresh" && setAsideKeyAndSave(deps.saveFile)) {
      saveKey = await prepareSaveKey(keyOptions);
      deps.log?.({ boot: "save-key", after: "fresh", ...saveKey });
    } else {
      deps.onLocked();
      return false;
    }
  }
  return true;
}
