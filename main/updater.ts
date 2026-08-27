/* ============================================================
   Auto-update (electron-updater), driven from the main process.

   Checks the GitHub releases feed named by the `publish` block in
   package.json and tells the renderer what is happening so it can show a
   banner. Nothing is downloaded until the user asks for it: the check only
   reports that a version is available, and downloadUpdate() starts the
   transfer. Nothing here ever blocks startup, opens a dialog, or throws: an
   offline machine, a rate-limited GitHub or a release with no latest.yml all
   resolve to an 'error' status that the UI is free to ignore.

   The latest status is cached because the renderer mounts after the first
   check can fire. A late listener calls getUpdateStatus() to catch up.

   Disabled unless the app is packaged, unless a dev-app-update.yml sits in the
   app root, which forces the real feed on for local testing, or an update
   simulation is requested (see updater-sim.ts) to look at the UI in dev.
   ============================================================ */
import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import type { UpdateStatus } from '../shared/types';
import { requestedScenario, createUpdateSim, type UpdateSim } from './updater-sim';

let enabled = false;
/** Non-null only in dev with --update-sim; replaces every electron-updater call. */
let sim: UpdateSim | null = null;
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
  // Simulation short-circuits the whole thing: no feed, no listeners, no
  // installer. checkForUpdates/downloadUpdate/installUpdate route to the sim.
  const scenario = requestedScenario();
  if (scenario) {
    enabled = true;
    sim = createUpdateSim(scenario, broadcast);
    console.log(`[updater] SIMULATION "${scenario}": faking the feed, nothing will be downloaded`);
    return;
  }

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

  // Never download behind the user's back: a check that finds something stops
  // at 'available' and waits for downloadUpdate(). Once a download has
  // finished, the user still chooses when to restart, and the update installs
  // on quit either way.
  autoUpdater.autoDownload = false;
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
 * the time the check settles ('available' or 'none'). Nothing is fetched here;
 * an 'available' result is an offer the user accepts via downloadUpdate().
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

  if (sim) {
    await sim.check();
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
 * Start downloading the update the last check found. Only meaningful from the
 * 'available' state: a download already running, or one that finished, is left
 * alone so a double-click cannot stack up two transfers. Progress and the
 * final 'downloaded' status arrive through the pushed events.
 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!enabled || lastStatus.state !== 'available') return lastStatus;

  // Taken from the offer rather than pendingVersion, which only the real feed
  // fills in. download-progress can take a moment to fire, and the banner
  // should react to the click straight away rather than sitting on "Download".
  const version = lastStatus.version;
  broadcast({ state: 'downloading', version, percent: 0 });

  if (sim) {
    await sim.download();
    return lastStatus;
  }

  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    console.error('[updater] download failed:', messageOf(err));
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
  if (sim) {
    sim.install();
    return;
  }
  autoUpdater.quitAndInstall(true, true);
}