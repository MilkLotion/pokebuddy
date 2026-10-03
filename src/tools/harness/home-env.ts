// 시험 앱의 환경 — HOME·USERPROFILE·APPDATA·LOCALAPPDATA·TEMP·TMP 를 임시 폴더로 바꾸고, 앱 동작을 바꾸는 변수를 지운다.
// 사용자의 저장·세션·키체인에 닿지 않게 한다. E2E 세 벌(apps·companion·update-win)이 같은 글자로 가지고 있었다
// (도구 레인 H0. 설계 50번 3.5절 harness/home-env.ts)
import path from "node:path";

// dir 는 HOME, temp 는 TEMP·TMP. extra 는 지운 뒤에 얹는다(POKEBUDDY_* 를 일부러 줄 때)
export function homeEnv(dir: string, temp: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: dir, USERPROFILE: dir, APPDATA: path.join(dir, "appdata"), LOCALAPPDATA: path.join(dir, "localappdata"), TEMP: temp, TMP: temp };
  for (const key of Object.keys(env)) if (key.startsWith("POKEBUDDY_") || key === "NODE_OPTIONS" || key === "ELECTRON_RUN_AS_NODE") delete env[key];
  return { ...env, ...extra };
}
