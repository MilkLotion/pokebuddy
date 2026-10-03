// 시험 개체 만들기 — 자체 검사가 손으로 적던 개체 리터럴 대신 앱의 newPet 결과를 쓴다.
// 손 리터럴은 필드가 늘면 빠뜨린다(예: moodProgressMs). newPet 을 거치면 새 필드가 저절로 들어간다
// (도구 레인 H0. 설계 50번 3.5절 harness/fixtures.ts)
import { newPet, type NewPetOptions } from "../../party/create";
import type { PetV3 } from "../../shared/save-v3";
import { T0 } from "./clock";

// 기본값 — id "p1", 파이리, 노력, 수컷, 이로치 아님. now 는 공용 기준 시각
const BASE: NewPetOptions = { id: "p1", species: "charmander", shiny: false, nature: "hardy", gender: "male", now: T0 };

// newPet 의 결과에 over 를 덮는다. newPet 이 받는 값(id·species·shiny·nature·gender)은 over 에 있으면 그 값으로 만든다
export function testPet(over: Partial<PetV3> = {}, now: number = T0): PetV3 {
  const pet = newPet({
    ...BASE,
    now,
    ...(over.id !== undefined ? { id: over.id } : {}),
    ...(over.species !== undefined ? { species: over.species } : {}),
    ...(over.shiny !== undefined ? { shiny: over.shiny } : {}),
    ...(over.nature !== undefined ? { nature: over.nature } : {}),
    ...(over.gender !== undefined ? { gender: over.gender } : {}),
  });
  return { ...pet, ...over };
}
