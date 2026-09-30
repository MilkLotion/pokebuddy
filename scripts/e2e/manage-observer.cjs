// 실제 앱의 관리 창 관측·조작 — E2E 가 NODE_OPTIONS 로 싣는다. 앱 로직·저장·IPC 는 바꾸지 않는다.
// PB_E2E_DIR 의 ui.json 요청을 하나씩 처리하고 결과를 ui-events.jsonl 에 적는다.
//   { id, kind: "open" }                  떠 있는 동반자를 다시 실행한 것처럼 second-instance 를 낸다 — 관리 창이 열린다
//   { id, kind: "link", url }             교환 링크로 다시 실행한 것처럼 second-instance 를 낸다
//   { id, kind: "eval", js }              관리 창 문서에서 js 를 돌리고 값을 돌려준다
//   { id, kind: "shot", file }            관리 창을 투명하게 잠깐 띄워 찍고 PNG 로 저장한다
//   { id, kind: "dialog", button }        떠 있는 네이티브 메시지 창(dialog.showMessageBox)에서 글자가 같은 단추를 고른다
// 창은 사용자의 화면을 가리지 않게 숨긴다
// 네이티브 메시지 창은 띄우지 않고 가로챈다 — 부모 창을 숨기면 창이 바로 닫혀 기본 단추로 답한 것처럼 된다.
//   뜬 창은 dialogs.jsonl 에 적는다. 앱이 창을 닫으면(signal — 시간 초과·밀려남) cancelId 로 답한다. 그 밖에는 dialog 요청을 기다린다
if (process.versions.electron && process.type === 'browser' && process.env.PB_E2E_DIR) {
  // 교환 링크로 처음 켜진 것처럼 — 앱 코드가 읽기 전에 인자에 링크를 더한다(OS 가 pokebuddy://… 로 앱을 실행한 경우)
  if (process.env.PB_E2E_ARGV_LINK) process.argv.push(process.env.PB_E2E_ARGV_LINK);
  setImmediate(() => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { app, BrowserWindow } = require('electron');
    const dir = process.env.PB_E2E_DIR;
    const request = path.join(dir, 'ui.json');
    const events = path.join(dir, 'ui-events.jsonl');
    const emit = (event) => fs.appendFileSync(events, `${JSON.stringify(event)}\n`);
    const manage = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('manage.html'));
    const { dialog } = require('electron');
    const dialogs = [];
    dialog.showMessageBox = (a, b) => {
      const opts = (b ?? a) || {};
      fs.appendFileSync(path.join(dir, 'dialogs.jsonl'), `${JSON.stringify({ title: opts.title, message: opts.message, detail: opts.detail, buttons: opts.buttons })}\n`);
      return new Promise((resolve) => {
        const entry = { buttons: opts.buttons ?? [], done: null };
        entry.done = (response) => {
          const i = dialogs.indexOf(entry);
          if (i < 0) return;
          dialogs.splice(i, 1);
          resolve({ response, checkboxChecked: false });
        };
        dialogs.push(entry);
        const cancel = opts.cancelId ?? 0;
        if (opts.signal?.aborted) entry.done(cancel);
        else opts.signal?.addEventListener('abort', () => entry.done(cancel), { once: true });
      });
    };
    app.on('browser-window-created', (_e, win) => {
      win.hide();
      win.on('show', () => { if (!global.__pbE2eShooting) win.hide(); });
    });
    let busy = false;
    const timer = setInterval(async () => {
      if (busy || !fs.existsSync(request)) return;
      busy = true;
      let req = null;
      try {
        req = JSON.parse(fs.readFileSync(request, 'utf8'));
        fs.rmSync(request);
        if (req.kind === 'open') {
          app.emit('second-instance', {}, [process.execPath], dir);
          emit({ id: req.id, ok: true });
        } else if (req.kind === 'link') {
          app.emit('second-instance', {}, [process.execPath, req.url], dir);
          emit({ id: req.id, ok: true });
        } else if (req.kind === 'dialog') {
          const entry = [...dialogs].reverse().find((d) => d.buttons.includes(req.button));
          if (entry) entry.done(entry.buttons.indexOf(req.button));
          emit({ id: req.id, ok: !!entry, ...(entry ? {} : { message: 'no-dialog' }) });
        } else {
          const win = manage();
          if (!win) {
            emit({ id: req.id, ok: false, message: 'no-manage-window' });
          } else if (req.kind === 'eval') {
            const value = await win.webContents.executeJavaScript(req.js);
            emit({ id: req.id, ok: true, value });
          } else if (req.kind === 'shot') {
            // 찍는 동안만 투명하게 띄운다 — 숨긴 창은 그릴 면이 없어 찍히지 않는다
            global.__pbE2eShooting = true;
            let image;
            try {
              win.setOpacity(0);
              win.showInactive();
              // 숨겨 둔 동안은 그리지 않는다 — 다시 그리게 하고 기다린다. 안 그러면 숨기기 전의 옛 화면이 찍힌다
              win.webContents.invalidate();
              await new Promise((r) => setTimeout(r, 1000));
              image = await win.webContents.capturePage();
            } finally {
              win.hide();
              win.setOpacity(1);
              global.__pbE2eShooting = false;
            }
            fs.writeFileSync(req.file, image.toPNG());
            emit({ id: req.id, ok: true, size: image.getSize() });
          }
        }
      } catch (error) {
        emit({ id: req?.id ?? null, ok: false, message: error.message });
      } finally {
        busy = false;
      }
    }, 100);
    app.on('will-quit', () => clearInterval(timer));
  });
}
