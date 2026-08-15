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
import { buildAppMenu } from './menu';
import { createDbBackup } from '../database/repositories/backups';
import { getMeta, setMeta } from '../database/repositories/meta';
import { initUpdater, checkForUpdates } from './updater';

let mainWindow: BrowserWindow | null = null;
let didCloseTasks = false;

/* ============================================================
   Dev-only renderer hot reload.

   `npm run dev` keeps renderer/dist rebuilt on save (esbuild watch, plus the
   app.css copy watcher in scripts/build-renderer.mjs). electron-reload watches
   that output and reloads the window itself, so a save lands in the app without
   Ctrl+R. Only app.js and app.css are watched: the sourcemap, index.html and
   the fonts are rewritten by the same builds and would each fire a second
   reload.

   This is a page reload, not state-preserving HMR: the React tree remounts and
   the app returns to its start screen. Main/preload changes are not covered,
   since tsc only runs once at the start of `npm run dev`.

   Gated on HB_DEV, which scripts/dev.mjs sets, rather than on !isPackaged
   alone: the test suite also runs Electron unpackaged, and it has no watcher
   to feed and no reason to hold file handles on renderer/dist. electron-reload
   is a devDependency and so absent from packaged builds; the require sits
   behind the same gate and is never reached there.
   ============================================================ */
function enableHotReload(): void {
  if (app.isPackaged || !process.env.HB_DEV) return;
  const dist = path.join(app.getAppPath(), 'renderer', 'dist');
  const electronReload = require('electron-reload') as (
    paths: string[],
    options?: Record<string, unknown>
  ) => void;
  electronReload([path.join(dist, 'app.js'), path.join(dist, 'app.css')], {
    // The dev bundle is ~2.3MB and lands in more than one filesystem event;
    // 200ms was not enough to coalesce them and every save reloaded twice.
    awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 100 },
  });
  console.log('[house-budget] hot reload: watching renderer/dist');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    // 1024 is the narrowest window the budget screen runs at undegraded: it is
    // the width at which the grid still gives every money column its natural
    // size and the item name column 308px, with the sidebar at 200px. The
    // renderer does have a tier below this (see the breakpoints in app.css),
    // but that tier shrinks the money columns and the sidebar, and it exists
    // for the View menu's zoom levels, which shrink the CSS viewport under the
    // window and so cannot be held off by a window minimum. The old 960 left
    // the item name column 32px wide, 26px of it usable, with the funding
    // account chip underneath it.
    minWidth: 1024,
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
  // Dev-only: confirm in the terminal that a save reached the window, so a
  // reload that did not happen is distinguishable from one that changed
  // nothing visible. Fires on the first load too.
  if (process.env.HB_DEV) {
    mainWindow.webContents.on('did-finish-load', () =>
      console.log('[hot reload] renderer loaded', new Date().toLocaleTimeString())
    );
  }
  // Both dev and packaged builds load the esbuild-bundled renderer from
  // renderer/dist. In dev, `npm run dev` keeps that bundle rebuilt on save
  // (esbuild watch) and enableHotReload reloads the window for you.
  const rendererHtml = path.join(app.getAppPath(), 'renderer', 'dist', 'index.html');
  mainWindow.loadFile(rendererHtml);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Must run before the first window exists: electron-reload collects windows
  // through browser-window-created and never sees one created before it.
  enableHotReload();
  // DB and IPC must be ready before the renderer can call window.api.
  initDb();
  registerIpcHandlers();
  buildAppMenu();
  createWindow();
  // Auto-update: wire the events now, but hold the first check back so it
  // never competes with DB init and first paint. checkForUpdates swallows its
  // own failures, so an offline start is a no-op.
  initUpdater();
  setTimeout(() => { void checkForUpdates(); }, 5_000);

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
  // Back up on close when enabled, but skip an empty database (no months) so a
  // never-used app makes no backups.
  const hasData =
    (db.prepare(`SELECT COUNT(*) AS n FROM budget_months`).get() as { n: number }).n > 0;
  const wantsBackup = getMeta(db, 'autoBackup') === 'onclose' && hasData;

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
