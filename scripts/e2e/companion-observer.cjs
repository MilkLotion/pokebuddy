// 실제 CLI가 실행한 Electron의 UI 관측. 앱 로직·저장·IPC·그림 로더는 교체하지 않음.
if (process.versions.electron && process.type === 'browser' && process.env.PB_E2E_DIR) {
  // NODE_OPTIONS 로드 시점에는 Electron API 초기화가 끝나지 않았을 수 있음.
  setImmediate(() => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { app, BrowserWindow } = require('electron');
    const dir = process.env.PB_E2E_DIR;
    const events = path.join(dir, 'events.jsonl');
    const command = path.join(dir, 'action.json');
    const emit = (event) => fs.appendFileSync(events, `${JSON.stringify({ pid: process.pid, ...event })}\n`);
    emit({ event: 'boot', slugEnv: process.env.POKEBUDDY_SLUG ?? null });
    app.on('browser-window-created', (_event, win) => {
      // 시험 창이 사용자의 작업 화면을 가리지 않게 숨김.
      win.hide();
      win.on('show', () => { if (!global.__pbE2eShooting) win.hide(); }); // 관리 창 찍기 중에는 두 관측기가 함께 비킨다 (e2e/manage-observer.cjs)
      win.webContents.on('preload-error', (_event, file, error) => emit({ event: 'preload-error', file, message: error.message }));
      win.webContents.on('console-message', (_event, details, message) => emit({ event: 'console', message: message ?? details?.message }));
      win.webContents.on('did-finish-load', async () => {
        const url = win.webContents.getURL();
        emit({ event: 'window', url });
        if (url.includes('picker.html')) {
          emit({ event: 'picker-dom', state: await win.webContents.executeJavaScript('({bridge:typeof window.pokebuddy,text:document.body.innerText})') });
          const timer = setInterval(async () => {
            if (win.isDestroyed()) return clearInterval(timer);
            const count = await win.webContents.executeJavaScript('document.querySelectorAll(".card").length').catch(() => 0);
            if (count) {
              clearInterval(timer);
              emit({ event: 'picker-ready', count });
            }
          }, 100);
        }
      });
    });
    let busy = false;
    const timer = setInterval(async () => {
      if (busy || !fs.existsSync(command)) return;
      busy = true;
      try {
        const action = JSON.parse(fs.readFileSync(command, 'utf8'));
        const picker = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('picker.html'));
        if (!picker) return;
        fs.rmSync(command);
        if (action.kind === 'pick-eevee') {
          const selected = await picker.webContents.executeJavaScript(`(() => {
            const cell = document.querySelector('.card[data-slug="eevee"]');
            if (!cell) return false;
            cell.click();
            document.querySelector('#start').click();
            return true;
          })()`);
          emit({ event: 'picked', selected });
        } else if (action.kind === 'cancel') picker.close();
      } catch (error) {
        emit({ event: 'observer-error', message: error.message });
      } finally {
        busy = false;
      }
    }, 100);
    app.on('will-quit', () => { clearInterval(timer); emit({ event: 'quit' }); });
  });
}
