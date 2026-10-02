// DOM 도우미 — 렌더러의 모든 창이 같이 쓴다. 창마다 따로 두던 el·button·need 를 한곳에 둔다

// 요소 하나 — 태그에 맞는 타입을 돌려준다. cls 가 비면 class 를 달지 않고, text 가 없으면 글자를 넣지 않는다
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// 단추 — type 은 늘 button. onClick 과 disabled 는 줄 때만 건다
export function buttonEl(cls: string, text?: string, onClick?: () => void, disabled = false): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  if (disabled) b.disabled = true;
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

// 문서 요소 찾기 — 없거나 종류가 다르면 창을 쓸 수 없으니 바로 던진다. windowName 은 문서 이름(확장자 없이)
export function needEl<T extends HTMLElement>(id: string, ctor: new () => T, windowName: string): T {
  const node = document.getElementById(id);
  if (!(node instanceof ctor)) throw new Error(`${windowName}.html 에 #${id} 가 없다`);
  return node;
}
