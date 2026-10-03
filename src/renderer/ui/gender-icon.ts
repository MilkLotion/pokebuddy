// 성별 아이콘 — Figma `Gender Icon` `995:333` 과 같은 도트 비트맵 (2026-09-30 사용자 결정 "이정도면 될듯")
// 원작 ♂(파랑)·♀(빨강) 모양을 도트로 그렸다. Galmuri 에 ♂♀ 글리프가 없어 글자 대신 쓴다. 무성은 아이콘을 두지 않는다
// 그림은 10×10 도트 판 가운데에 놓고, 크기(px)만큼 늘려 그린다
import { dotIconEl } from "./dot-icon.js";

type Sex = "male" | "female";

const BITMAP: Readonly<Record<Sex, readonly string[]>> = {
  male: [".....####", ".......##", "......#.#", "..####...", ".##..##..", ".#....#..", ".#....#..", ".##..##..", "..####..."],
  female: ["..###..", ".#...#.", "#.....#", "#.....#", "#.....#", ".#...#.", "..###..", "...#...", ".#####.", "...#..."],
};

// 성별 색 — Figma 와 같은 값 (제안값)
const COLOR: Readonly<Record<Sex, string>> = { male: "#3885f0", female: "#ed4d66" };
const LABEL: Readonly<Record<Sex, string>> = { male: "수컷", female: "암컷" };

// 성별 아이콘 — 무성이면 null. 부르는 쪽이 이름 옆에 붙인다
export function genderIcon(gender: string, size: number): SVGSVGElement | null {
  if (gender !== "male" && gender !== "female") return null;
  return dotIconEl({ rows: BITMAP[gender], className: `gender ${gender}`, label: LABEL[gender], size, color: COLOR[gender] });
}
