// 부팅 단계 가운데 앱 쪽 값이 적은 것 (worklog/records/code-structure/design/10-main.md 3.13절 app/boot.ts, 4.1절)
// 배선 단계(핵심·무대·명령·서비스·마무리)는 진입점 src/main/app.ts 에 둔다 — 앱 쪽 값 수십 개를 쓰는 배선을 두 파일로 가르면
// 콜백을 빠뜨려도 형 검사가 잡지 못한다 (2026-10-04 메인 레인 96-F, 오케스트레이터 결정)
//
// 4단계 저장 키 — 저장 읽기·쓰기가 이 키로 암호화한다 (src/save/key.ts). 기존 평문 저장은 여기서 한 번 옮긴다.
import { prepareSaveKey, setAsideKeyAndSave, type PrepareSaveKeyOptions } from "../../save/key";
import { isSealedOnDisk } from "../../save/save-file";
import { starterSlugs, unlockRules } from "../../dex/unlocks";
import { clearLastError, writeLastError } from "../../platform/last-error.js";
import type { Paths } from "../../platform/paths";
import { failTextOf } from "../../shared/fail-text";
import { partyPetsOf } from "../../view/party-pet.js";
import { currentLang, t } from "../../view/text";
import { artServices } from "../art/services";
import { preloadFile, rendererFile } from "../windows/files";
import { askStarter } from "../windows/picker-window";
import { createLifetime } from "./lifetime";
import { createKeyVault } from "../services/vault";
import type { Notifier } from "../../notify/notifier";
import type { HostWatch } from "../stage/host-watch";
import type { Commands } from "./commands";
import type { GameV3 } from "../../tx/game";
import type { HookUpkeep } from "./hook-upkeep";
import type { Lifetime } from "./lifetime";
import type { Portraits } from "../art/portraits";
import type { SaveParty } from "../../save/save-party";
import type { StageGroup } from "../stage/stage-group";
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
  hostWatch: HostWatch | null; // 호스트·표시 판정(헬퍼)
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

// 부팅 단계가 함께 받는 앱 쪽 값 — 실패 기록 자리, 실패 기록에 적을 펫 이름, 끝내기, 로그
export interface BootSteps {
  paths: Pick<Paths, "home" | "lastError" | "companionLock">;
  slug: string; // 실행 인자의 펫 이름 — 실패 기록의 slug
  quitting(): boolean;
  quit(): void; // app.quit — 끝내기 순서를 탄다
  exit(code: number): void; // app.exit — 종료 코드를 남기고 바로 끝낸다
  log: DebugLog;
}

// 6단계 수명 감시 — 첫 실행 선택 창보다 먼저. 고르는 동안 companion stop(lock 삭제)이 와도 끝나야 한다
// hasWindow — 창이 생긴 뒤에만 lock 에 ready 를 적는다
export function bootLifetime(s: BootSteps, hasWindow: () => boolean): Lifetime {
  const life = createLifetime({
    lockFile: s.paths.companionLock,
    hasWindow,
    quit: s.quit,
  });
  life.start();
  return life;
}

// 그림 미리 받기 — 설치 파일에 그림이 없다. 빠진 초상·도구·알 그림을 뒤에서 받아 캐시에 둔다(src/main/art/portraits.ts).
// 첫 실행이면 선택 창에서 고르는 동안 받는다. 관리 창은 창을 열 때 캐시를 한 번에 읽는다
// 첫 실행이면 스타터 초상부터 받는다. 선택 창·설정창도 같은 portraits 를 써서 받는 중인 그림을 함께 기다린다 (src/main/art/services.ts)
export function bootPrefetch(s: BootSteps, saveSource: SaveParty): { pics: Portraits; starterList: string[] } {
  const pics = artServices().portraits;
  const starterList = saveSource.needsStarter() ? starterSlugs(unlockRules()) : [];
  const prefetchAt = Date.now();
  void pics
    .prefetch(undefined, starterList)
    .then((r) => s.log?.({ prefetch: "done", ms: Date.now() - prefetchAt, ...r }))
    .catch((e) => s.log?.({ prefetch: "failed", message: String(e) }));
  return { pics, starterList };
}

// 첫 실행 선택 — 명령에 스타터를 직접 줬으면(given, 목록 안일 때) 그걸로 바로 시작하고, 아니면 선택 창. reader 면 writer 쪽이 첫 실행을 맡는다.
// 취소했거나 저장을 만들지 못했으면 실패를 적고 끝내기를 부르고 false
export async function bootStarter(
  s: BootSteps,
  saveSource: SaveParty,
  pics: Portraits,
  starterList: string[],
  o: { given: string | null; onPicking(on: boolean): void },
): Promise<boolean> {
  if (!saveSource.needsStarter()) return true;
  let species: string | null = o.given && starterList.includes(o.given) ? o.given : null;
  if (!species) {
    species = await askStarter({
      preload: preloadFile(),
      html: rendererFile("picker.html"),
      starters: starterList,
      portraits: pics,
      onPicking: o.onPicking,
    });
  }
  if (s.quitting() || !species) {
    writeLastError(s.paths, { slug: s.slug, message: t("starter.skipped"), reason: "starter-cancelled" });
    if (!s.quitting()) s.quit();
    return false;
  }
  if (!saveSource.begin(species)) {
    writeLastError(s.paths, { slug: s.slug, message: failTextOf("save-failed", "command", currentLang()).text, reason: "save-failed" });
    s.quit();
    return false;
  }
  return true;
}

// 첫 무대 그리기와 수명 잠금 — 그림을 하나도 못 받았거나 다른 동반자가 떠 있으면 끝내고 false
export async function bootClaim(s: BootSteps, saveSource: SaveParty, group: StageGroup, life: Lifetime, refreshParty: () => Promise<void>): Promise<boolean> {
  await refreshParty();
  if (s.quitting()) return false;
  const shown = partyPetsOf(saveSource.save(), true);
  if (shown.length && !group.petIds().length) {
    // 나올 마리가 있는데 하나도 그림을 못 받았다 — 실패로 끝낸다. pokebuddy 가 종료 코드를 보고 "펫이 뜨지 못함"을 알린다
    process.stderr.write(`펫 그림을 찾을 수 없음: ${shown.map((p) => p.look).join(", ")}\n`);
    s.exit(3);
    return false;
  }
  clearLastError(s.paths, s.slug);
  if (!life.claim()) {
    // 살아 있는 다른 동반자가 lock 을 쥐고 있다 — 이쪽이 물러난다
    process.stderr.write("동반자가 이미 떠 있음 — 이 프로세스는 끝낸다\n");
    s.quit();
    return false;
  }
  return true;
}
