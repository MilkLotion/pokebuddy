// 기술 칸 — 타입 조각(타입 색 + 흰 타입 아이콘)과 이름 조각. 모양은 styles/move-pill.css
// 설정창 모험 칸 카드(작은 칸)와 배틀 파티 상세 기기 창(큰 칸)이 같이 쓴다 (docs/specs/adventure.md "기술 칸")
import type { MoveView } from "../../shared/model/snapshot.js";
import { el } from "./dom.js";

// icon — 흰 타입 아이콘. 그림 주소(data URI)나, 늦게 칠해지는 요소(설정창 art-cache 의 iconOf). 없으면 타입 색만 칠한다
export function movePillEl(move: MoveView, size: "small" | "large", icon: string | HTMLElement | null): HTMLElement {
  const pill = el("span", size === "large" ? "move-pill lg" : "move-pill");
  pill.dataset.type = move.typeId;
  const type = el("span", "mp-type");
  if (typeof icon === "string") {
    const img = document.createElement("img");
    img.src = icon;
    img.alt = "";
    img.draggable = false;
    type.appendChild(img);
  } else if (icon) type.appendChild(icon);
  pill.append(type, el("span", "mp-name", move.name));
  pill.setAttribute("aria-label", `${move.typeName} 타입 · ${move.name}`);
  return pill;
}
