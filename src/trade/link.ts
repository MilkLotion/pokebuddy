// 공유 링크의 글자 규칙 — 친구 교환과 친선 배틀이 같은 모양을 쓴다.
//   앱 실행 인자 pokebuddy://trade/<토큰> · pokebuddy://battle/<토큰>, 공유 주소 <linkBase>#<토큰>, 토큰만 붙여 넣은 것
// 웹 페이지(site/trade/index.html · site/battle/index.html)의 같은 정규식은 공유하지 못한다 — 바꾸면 그쪽도 같이 바꾼다
export type LinkKind = "trade" | "battle";

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const schemeOf = (kind: LinkKind): string => `pokebuddy://${kind}/`;

// 링크에서 토큰을 꺼낸다 — https …#<토큰>, pokebuddy://<kind>/<토큰>, 토큰만 붙여 넣은 것. 다른 종류의 앱 링크는 받지 않는다
export function tokenOf(input: string, kind: LinkKind = "trade"): string | null {
  const text = input.trim();
  if (!text) return null;
  const hash = text.indexOf("#");
  const deep = /^pokebuddy:\/\/([a-z]+)\/([A-Za-z0-9_-]+)/.exec(text);
  if (deep && deep[1] !== kind) return null;
  const raw = deep ? deep[2] : hash >= 0 ? text.slice(hash + 1) : text;
  return raw && TOKEN.test(raw) ? raw : null;
}

// 앱 실행 인자가 교환 링크인가 (src/main/app.ts)
export const isTradeLink = (arg: string): boolean => arg.startsWith(schemeOf("trade"));
// 앱 실행 인자가 친선 배틀 링크인가 (docs/specs/adventure.md "친선 배틀")
export const isFriendlyLink = (arg: string): boolean => arg.startsWith(schemeOf("battle"));

// 친구에게 보낼 주소
export const linkOf = (linkBase: string, token: string): string => `${linkBase}#${token}`;

// 친선 배틀 공유 주소의 앞부분 — 교환 페이지 주소의 마지막 /trade 를 /battle 로 (site/battle/index.html)
export const friendlyLinkBase = (tradeLinkBase: string): string => tradeLinkBase.replace(/\/trade\/?$/, "/battle");
