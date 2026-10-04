// 교환 링크의 글자 규칙 — 앱 실행 인자(pokebuddy://trade/<토큰>), 공유 주소(<linkBase>#<토큰>), 토큰.
// 웹 페이지(site/trade/index.html)의 같은 정규식은 공유하지 못한다 — 바꾸면 그쪽도 같이 바꾼다
const TRADE_LINK = {
  scheme: "pokebuddy://trade/",
  token: /^[A-Za-z0-9_-]{16,64}$/,
} as const;

// 링크에서 토큰을 꺼낸다 — https …/trade#<토큰>, pokebuddy://trade/<토큰>, 토큰만 붙여 넣은 것
export function tokenOf(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const hash = text.indexOf("#");
  const deep = /^pokebuddy:\/\/trade\/([A-Za-z0-9_-]+)/.exec(text);
  const raw = deep ? deep[1] : hash >= 0 ? text.slice(hash + 1) : text;
  return raw && TRADE_LINK.token.test(raw) ? raw : null;
}

// 앱 실행 인자가 교환 링크인가 (src/main/app.ts)
export const isTradeLink = (arg: string): boolean => arg.startsWith(TRADE_LINK.scheme);

// 친구에게 보낼 주소
export const linkOf = (linkBase: string, token: string): string => `${linkBase}#${token}`;
