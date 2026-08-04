/* ============================================================
   Auto-update (electron-updater), driven from the main process.

   Checks the GitHub releases feed named by the `publish` block in
   package.json, downloads a newer installer in the background, and tells the
   renderer what is happening so it can show a banner. Nothing here ever blocks
   startup, opens a dialog, or throws: an offline machine, a rate-limited
   GitHub or a release with no latest.yml all resolve to an 'error' status that
   the UI is free to ignore.

   The latest status is cached because the renderer mounts after the first
   check can fire. A late listener calls getUpdateStatus() to catch up.

   Disabled unless the app is packaged, unless a dev-app-update.yml sits in the
   app root, which forces the real feed on for local testing.
   ============================================================ */
import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import type { UpdateStatus } from '../shared/types';

let enabled = false;
let lastStatus: UpdateStatus = { state: 'idle' };
/** Set on 'update-available'; download-progress events do not carry a version. */
let pendingVersion = '';

/** Cache the status and push it to every open window. */
function broadcast(status: UpdateStatus): void {
  lastStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:status', status);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The current status, for a renderer that mounted after the events fired. */
export function getUpdateStatus(): UpdateStatus {
  return lastStatus;
}

/**
 * Wire up the updater. Call once from app.whenReady(), after the window
 * exists. Safe to call in dev: it simply does nothing.
 */
export function initUpdater(): void {
  const devConfig = path.join(app.getAppPath(), 'dev-app-update.yml');
  if (!app.isPackaged) {
    if (!fs.existsSync(devConfig)) {
      console.log('[updater] disabled (not packaged)');
      return;
    }
    // Local testing against the real releases feed from an unpackaged build.
    autoUpdater.forceDevUpdateConfig = true;
    console.log('[updater] dev-app-update.yml found, running against the live feed');
  }

  enabled = true;

  // Download in the background as soon as something is available, then let the
  // user choose when to restart. A pending update also installs on quit, so
  // dismissing the banner delays the restart rather than skipping the update.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    broadcast({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version;
    console.log('[updater] update available:', info.version);
    broadcast({ state: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    broadcast({ state: 'none' });
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      state: 'downloading',
      version: pendingVersion,
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    pendingVersion = info.version;
    console.log('[updater] update downloaded:', info.version);
    broadcast({ state: 'downloaded', version: info.version });
  });

  // Fires for offline, DNS failures, HTTP errors and checksum mismatches.
  // Log it and move on; the app is still perfectly usable without an update.
  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', messageOf(err));
    broadcast({ state: 'error', message: messageOf(err) });
  });
}

/**
 * Ask GitHub whether a newer version exists. Resolves to the status reached by
 * the time the check settles ('available' or 'none'); the download that may
 * follow reports itself through the pushed events.
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!enabled) return lastStatus;

  // A check already in flight, or an update waiting to install, means there is
  // nothing useful to do. Stops the menu item from stacking up downloads.
  if (
    lastStatus.state === 'checking' ||
    lastStatus.state === 'downloading' ||
    lastStatus.state === 'downloaded'
  ) {
    return lastStatus;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // The 'error' event has usually broadcast this already; catching here stops
    // it becoming an unhandled rejection.
    console.error('[updater] check failed:', messageOf(err));
    broadcast({ state: 'error', message: messageOf(err) });
  }
  return lastStatus;
}

/**
 * Quit and install a downloaded update. Silent (no NSIS wizard, keeps the
 * existing install location) and relaunches afterwards. Both arguments matter:
 * the build uses `oneClick: false`, so the default would walk the user through
 * the full installer on every update.
 */
export function installUpdate(): void {
  if (lastStatus.state !== 'downloaded') return;
  autoUpdater.quitAndInstall(true, true);
}