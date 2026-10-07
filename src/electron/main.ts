import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../server/store';
import { Engine } from '../server/engine';
import { createHub } from '../server/hub';
let window: BrowserWindow | undefined,
  engine: Engine | undefined,
  store: Store | undefined,
  hub: Awaited<ReturnType<typeof createHub>> | undefined;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  process.once('SIGTERM', () => app.quit());
  process.once('SIGINT', () => app.quit());
  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });
  void app.whenReady().then(async () => {
    try {
      store = new Store(process.env.SHELF_DATA_DIR || app.getPath('userData'));
      engine = new Engine(store);
      await engine.start();
      hub = await createHub(engine, {
        port: 0,
        uiDirectory: fileURLToPath(new URL('../ui', import.meta.url)),
      });
      ipcMain.handle('shelf:login', (event) => {
        if (
          event.sender !== window?.webContents ||
          !event.senderFrame?.url.startsWith(hub!.origin + '/')
        )
          throw new Error('Untrusted window');
        return hub!.ownerKey;
      });
      const checkWindow = (event: Electron.IpcMainInvokeEvent) => {
        if (
          event.sender !== window?.webContents ||
          !event.senderFrame?.url.startsWith(hub!.origin + '/')
        )
          throw new Error('Untrusted window');
      };
      ipcMain.handle('shelf:get-theme', (event) => {
        checkWindow(event);
        return store!.get('theme') || 'dark';
      });
      ipcMain.handle('shelf:set-theme', (event, theme) => {
        checkWindow(event);
        if (!['light', 'dark', 'system'].includes(theme)) throw new Error('Invalid theme');
        store!.set('theme', theme);
      });
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      const open = () => {
        window = new BrowserWindow({
          width: 1380,
          height: 900,
          minWidth: 850,
          minHeight: 620,
          title: 'Session Shelf',
          backgroundColor: '#171b22',
          webPreferences: {
            preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', (event, url) => {
          if (new URL(url).origin !== hub!.origin) event.preventDefault();
        });
        window.on('closed', () => {
          window = undefined;
        });
        void window.loadURL(hub!.origin);
      };
      open();
      app.on('activate', () => {
        if (!window) open();
      });
    } catch (e) {
      dialog.showErrorBox('Session Shelf could not start', (e as Error).message);
      app.quit();
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  let closing = false;
  app.on('before-quit', (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    const deadline = setTimeout(() => app.exit(0), 3000);
    void (async () => {
      try {
        await engine?.close();
        await hub?.close();
        store?.close();
      } finally {
        clearTimeout(deadline);
        app.exit(0);
      }
    })();
  });
}
