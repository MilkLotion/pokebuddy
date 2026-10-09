// 화면 모델 — 설정창 안의 목적지. 설정창과 알림 배너가 함께 쓴다. 타입만 둔다

// 관리 창 안의 목적지. 부화는 돌보미집, 진화는 개체 상세, 업적은 업적 창 (docs/specs/game.md "알림 배너의 개별 표시")
// form 은 포켓몬 메뉴의 모습 말풍선에서 고른 모습 — 바꾸기 확인 창을 띄운다
// 교환은 교환 링크(딥링크)로 앱을 열었을 때 박스 탭을 열고 교환 모달을 띄운다. 계정은 GitHub 로그인 뒤 브라우저에서 돌아왔을 때 설정의 계정 탭으로 간다
export type ManageRoute = { to: "daycare" } | { to: "pet"; petId: string } | { to: "achievements"; id: string } | { to: "trade" } | { to: "account" } | { to: "agents" } | { to: "bag" } | { to: "shop" } | { to: "form"; petId: string; species: string } | { to: "move"; petId: string } | { to: "swap"; petId: string } | { to: "sell"; petId: string; price: number } | { to: "battle-pick"; slot: number } | { to: "battle-record" };
