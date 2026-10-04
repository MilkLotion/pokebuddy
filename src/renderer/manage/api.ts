// 설정창의 다리 — 설정창의 모듈은 window.pokebuddyManage 대신 이것을 쓴다 (ui/bridge.ts needBridge, P13)
import { needBridge } from "../ui/bridge.js";

export const api = needBridge("pokebuddyManage");
