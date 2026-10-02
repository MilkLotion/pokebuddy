// 알림 배너 창 — 메인이 준 배너 하나를 그린다. 문구와 목적지는 메인이 정한다 (src/notify/banner.ts)
//
// 배너 본문 클릭 동작은 없다. `바로가기` 와 제목 줄 `✕`(닫기)만 누른다 (docs/specs/game.md "알림 배너의 개별 표시")
import type { BannerView } from "../../shared/model/overlays.js";
import { needEl } from "../ui/dom.js";


const bannerEl = needEl("banner", HTMLElement, "banner");
const titleEl = needEl("title", HTMLElement, "banner");
const targetEl = needEl("target", HTMLElement, "banner");
const nameEl = needEl("name", HTMLElement, "banner");
const goEl = needEl("go", HTMLButtonElement, "banner");
const closeEl = needEl("close", HTMLButtonElement, "banner");

const api = window.pokebuddyBanner;
let key: string | null = null;

// 알림음 — 짧은 두 음(원작 메뉴 효과음 느낌). 파일 없이 WebAudio 로 만든다. 음량은 메인이 준다(설정의 소리 크기)
let audio: AudioContext | null = null;
function chime(gain: number): void {
  if (gain <= 0) return;
  try {
    audio ??= new AudioContext();
    const t0 = audio.currentTime;
    for (const [freq, at] of [
      [988, 0],
      [1319, 0.09],
    ] as const) {
      const osc = audio.createOscillator();
      const env = audio.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      // 네모파는 사인파보다 크게 들려 한 번 더 줄인다
      env.gain.setValueAtTime(0, t0 + at);
      env.gain.linearRampToValueAtTime(gain * 0.25, t0 + at + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.16);
      osc.connect(env).connect(audio.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.18);
    }
  } catch {
    // 소리를 낼 수 없는 환경이면 배너만 보인다
  }
}

api.onShow((view: BannerView) => {
  key = view.key;
  chime(view.chime ?? 0);
  titleEl.textContent = view.title;
  titleEl.title = view.title;
  targetEl.className = `target ${view.kind}`;
  targetEl.textContent = view.kind === "achievement" ? "A" : "";
  nameEl.textContent = view.target;
  nameEl.title = view.target;
  // 안내(notice)·줍기(find)는 대상 그림 없이 문구를 두 줄까지 보인다 — 한 줄 말줄임이면 문구가 잘린다
  nameEl.classList.toggle("wrap", view.kind === "notice" || view.kind === "find");
  goEl.textContent = view.go;
  bannerEl.hidden = false;
});

goEl.addEventListener("click", () => {
  if (key) api.go(key);
});
// 닫기는 그 알림만 닫는다 — 다른 동작으로 번지지 않게 (2026-09-30 사용자 요청)
closeEl.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (key) api.close(key);
});
closeEl.addEventListener("pointerdown", (e) => e.stopPropagation());
