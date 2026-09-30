// E2E 가 띄우는 앱에 가짜 키체인을 쓰게 한다 — NODE_OPTIONS 로 싣는다. pokebuddy CLI(node) 프로세스에서만 돈다.
//   임시 HOME 에는 mac 키체인이 없다. 앱이 진짜 키체인에 닿으면 "키체인을 찾을 수 없음" 창이 사용자 화면에 뜨고,
//   safeStorage 암호화가 실패해 세션 파일(session.bin)도 남지 않는다
//   Electron 을 띄우는 spawn 에 명령행 인자 --use-mock-keychain 을 붙인다. 앱 안에서 appendSwitch 로 거는 것보다 이르다.
//   앱이 스스로 다시 켤 때(app.relaunch)는 argv 를 물려주므로 인자가 이어진다
//   Windows 는 CLI 가 PowerShell 로 띄워 이 경로를 타지 않는다 — DPAPI 는 창을 띄우지 않는다
if (!process.versions.electron && process.env.PB_E2E_DIR) {
  const cp = require('node:child_process');
  const spawn = cp.spawn;
  const SWITCH = '--use-mock-keychain';
  cp.spawn = function spawnWithMockKeychain(command, args, ...rest) {
    const electron = typeof command === 'string' && /[\\/]Electron(\.app[\\/]Contents[\\/]MacOS[\\/]Electron)?$/i.test(command);
    if (electron && Array.isArray(args) && !args.includes(SWITCH)) args = [...args, SWITCH];
    return spawn.call(this, command, args, ...rest);
  };
}
