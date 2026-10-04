// 설정창의 그림 캐시 — 포켓몬 초상과 도구·알 그림 (P10f)
// 초상을 메인에서 data URI 로 받아 원 안에 채운다 (src/main/art/portraits.ts). 받기 전·못 받으면 빈 원 그대로다.
// 창을 열 때 디스크에 있는 그림 전부를 먼저 받는다(loadArt). 그래서 상점·상세에 들어가자마자 그림이 모두 보인다.
// 디스크에 없는 그림만 칸을 그린 뒤 청한다. 도감은 1000 칸이 넘어 보이는 칸만 청한다(lazy).
// 보이는 칸은 그린 뒤와 스크롤할 때 위치를 재서 고른다 — IntersectionObserver 는 창이 가려져 있으면 반응하지 않았다.
// 받은 것은 창이 떠 있는 동안 기억한다
// 메가스톤 표식(pet-forms.ts megaMark)도 도구 그림 캐시를 같이 쓴다
import type { ArtImage, PortraitAsk } from "../../shared/model/snapshot.js";
import { el } from "../ui/dom.js";
import { portraitImg, rememberPortrait, rememberPortraitBox } from "../ui/portrait.js";
import { api } from "./api.js";

const portraitCache = new Map<string, string | null>();
const portraitWant = new Map<string, PortraitAsk>();
let portraitTimer: ReturnType<typeof setTimeout> | null = null;

function paintPortrait(host: HTMLElement, uri: string, cls = "art"): void {
  if (host.classList.contains("has-art")) return;
  for (const n of [...host.childNodes]) if (n.nodeType === Node.TEXT_NODE) n.remove(); // 자리 글자는 그림이 대신한다
  // 포켓몬 초상은 보는 네모를 그림에 맞춘다(portrait.ts). 도구·알 그림(icon-art)은 그대로 그린다
  const img = cls === "art" ? portraitImg(uri, cls) : document.createElement("img");
  if (cls !== "art") {
    img.className = cls;
    img.alt = "";
    img.decoding = "sync"; // 칸과 그림이 한 프레임에 같이 보이게 한다
    img.src = uri;
  }
  host.prepend(img);
  host.classList.add("has-art");
}

function askPortraits(): void {
  if (portraitTimer) return;
  portraitTimer = setTimeout(() => {
    portraitTimer = null;
    const asks = [...portraitWant.values()];
    portraitWant.clear();
    if (!asks.length) return;
    void api.portraits(asks).then((got) => {
      for (const [key, uri] of Object.entries(got)) portraitCache.set(key, uri);
      for (const host of document.querySelectorAll<HTMLElement>("[data-portrait]")) {
        const uri = portraitCache.get(host.dataset.portrait ?? "");
        if (uri) paintPortrait(host, uri);
      }
    });
  }, 30);
}

function wantPortrait(key: string): void {
  if (portraitCache.has(key)) return;
  const [slug = "", shiny] = key.split(":");
  portraitWant.set(key, { slug, shiny: shiny === "shiny" });
  askPortraits();
}

// 화면에 들어온 lazy 칸을 청한다. 위아래로 한 화면씩 미리 받는다
let lazyTimer: ReturnType<typeof setTimeout> | null = null;
function askVisiblePortraits(): void {
  if (lazyTimer) return;
  lazyTimer = setTimeout(() => {
    lazyTimer = null;
    const view = window.innerHeight;
    for (const host of document.querySelectorAll<HTMLElement>("[data-portrait-lazy]")) {
      const r = host.getBoundingClientRect();
      if (r.bottom < -view || r.top > view * 2) continue;
      host.removeAttribute("data-portrait-lazy");
      wantPortrait(host.dataset.portrait ?? "");
    }
  }, 60);
}
document.addEventListener("scroll", askVisiblePortraits, true); // 스크롤은 거품이 없어 잡는 단계에서 받는다

// 초상 자리 하나 — cls 는 크기(portrait 80 · dot 26 등)를 정하는 기존 클래스다. lazy 면 보일 때 청한다
export function portraitOf(slug: string, shiny: boolean, cls: string, text = "", lazy = false): HTMLElement {
  const host = el("div", cls, text);
  const key = shiny ? `${slug}:shiny` : slug;
  host.dataset.portrait = key;
  const uri = portraitCache.get(key);
  if (uri) paintPortrait(host, uri);
  else if (uri === undefined) {
    if (lazy) {
      host.dataset.portraitLazy = "";
      askVisiblePortraits();
    } else wantPortrait(key);
  }
  return host;
}

// 도구·알 그림 — PokeAPI 에 그림이 있는 것만 채운다(이상한사탕·진화의 돌·알). 없으면 Figma 처럼 빈 칸이다
export const iconCache = new Map<string, string | null>();
const iconWant = new Set<string>();
let iconTimer: ReturnType<typeof setTimeout> | null = null;

export function iconOf(key: string | null, cls: string): HTMLElement {
  const host = el("div", cls);
  if (!key) return host;
  host.dataset.icon = key;
  const uri = iconCache.get(key);
  if (uri) paintPortrait(host, uri, "icon-art");
  else if (uri === undefined) {
    iconWant.add(key);
    iconTimer ??= setTimeout(() => {
      iconTimer = null;
      const keys = [...iconWant];
      iconWant.clear();
      void api.icons(keys).then((got) => {
        for (const [k, u] of Object.entries(got)) iconCache.set(k, u);
        for (const h of document.querySelectorAll<HTMLElement>("[data-icon]")) {
          const u = iconCache.get(h.dataset.icon ?? "");
          if (u) paintPortrait(h, u, "icon-art");
        }
      });
    }, 30);
  }
  return host;
}

// 디스크에 있는 그림을 전부 받아 캐시에 채운다. 받은 그림은 미리 디코딩해 둔다 —
// 같은 주소의 그림은 문서가 이미 가진 그림이 되어, 칸을 그리는 순간 바로 보인다
const warmed: HTMLImageElement[] = [];
export async function loadArt(): Promise<void> {
  let art: Record<string, ArtImage> = {};
  try {
    art = await api.art();
  } catch {
    return; // 그림 없이도 창은 돈다 — 칸을 그린 뒤 하나씩 청하는 길이 남아 있다
  }
  const got: Record<string, string> = Object.fromEntries(Object.entries(art).map(([key, image]) => [key, image.uri]));
  for (const [key, uri] of Object.entries(got)) (key === "egg" || key.startsWith("item:") ? iconCache : portraitCache).set(key, uri);
  // 초상은 메인이 잰 불투명 네모(box)로 보는 네모를 먼저 정한다 — 몸이 큰 그림이 첫 프레임부터 잘리지 않는다 (portrait.ts, X15).
  // 네모가 없는 초상만 디코딩이 끝난 뒤에 잰다
  const portraits = new Set<string>();
  for (const [key, image] of Object.entries(art)) {
    if (key === "egg" || key.startsWith("item:")) continue;
    if (image.box) rememberPortraitBox(image.uri, image.box);
    else portraits.add(image.uri);
  }
  for (const uri of new Set(Object.values(got))) {
    const img = new Image();
    img.src = uri;
    warmed.push(img);
    void img.decode().then(() => { if (portraits.has(uri)) rememberPortrait(img); }).catch(() => undefined);
  }
}
