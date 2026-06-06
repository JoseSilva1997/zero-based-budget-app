/* ============================================================
   Electron entry point.
   - Initialises the DB (schema + migrations) before anything else.
   - Registers ALL IPC handlers before the window is created.
   - Creates the BrowserWindow with a context-isolated preload.
   - Auto-backs-up on close (when enabled) and closes the DB on quit.
   ============================================================ */
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { initDb, getDb, closeDb } from './db';
import { backupsDir, userDataDir } from './paths';
import { registerIpcHandlers } from './ipc';
import { createDbBackup } from '../database/repositories/backups';
import { getMeta, setMeta } from '../database/repositories/meta';

let mainWindow: BrowserWindow | null = null;
let didCloseTasks = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0d1016',
    show: false,
    icon: path.join(app.getAppPath(), 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // Both dev and packaged builds load the esbuild-bundled renderer from
  // renderer/dist. In dev, `npm run dev` keeps that bundle rebuilt on save
  // (esbuild watch); press Ctrl+R to reload after a change.
  const rendererHtml = path.join(app.getAppPath(), 'renderer', 'dist', 'index.html');
  mainWindow.loadFile(rendererHtml);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // DB and IPC must be ready before the renderer can call window.api.
  initDb();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Auto-backup on close (when enabled), then close the DB cleanly.
app.on('before-quit', (event) => {
  if (didCloseTasks) return;

  const db = getDb();
  const wantsBackup = getMeta(db, 'autoBackup') === 'onclose' && getMeta(db, 'saved') === '1';

  if (!wantsBackup) {
    didCloseTasks = true;
    closeDb();
    return;
  }

  event.preventDefault();
  createDbBackup(db, backupsDir())
    .then((info) => setMeta(db, 'lastBackup', info.savedAt))
    .catch((err) => console.error('[backup] auto-backup on close failed:', err))
    .finally(() => {
      didCloseTasks = true;
      closeDb();
      app.quit();
    });
});

// Surface the data folder location at startup (useful for debugging).
console.log('[house-budget] userData:', userDataDir());
