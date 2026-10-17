/* ============================================================
   Cloud backup folder: the service the IPC handlers and the close flow use.

   THE RULE: local first, cloud second. backupNow() writes the local snapshot
   and only then copies it to the cloud folder. A cloud failure is recorded and
   reported, never thrown: the local backup has already succeeded and stays
   the backup. Every place that makes a backup goes through backupNow(), so the
   rule lives here once.

   Settings are per machine, in userData/cloud-backup.json (see paths.ts for
   why they are not in the database).
   ============================================================ */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { backupsDir, cloudConfigPath, restoreStagingDir } from './paths';
import { createDbBackup, friendlyDate } from '../database/repositories/backups';
import { setMeta } from '../database/repositories/meta';
import {
  catchUp,
  isFolderReady,
  isInside,
  mirrorBackup,
  prepareCloudFolder,
  safeDeviceName,
  stageForRestore,
} from '../database/repositories/cloudFolder';
import type { BackupInfo, CloudCopyResult, CloudStatus } from '../shared/types';

interface CloudConfig {
  folder: string | null;
  device: string | null;
  lastCopyAt: string | null;
  lastError: string | null;
}

const EMPTY: CloudConfig = { folder: null, device: null, lastCopyAt: null, lastError: null };

/** A hung network mount must never hold up a backup, or quitting. */
export const CLOUD_COPY_TIMEOUT_MS = 10_000;

function loadConfig(): CloudConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(cloudConfigPath(), 'utf8'));
    return { ...EMPTY, ...raw };
  } catch {
    return { ...EMPTY }; // missing or unreadable: cloud copying is simply off
  }
}

function saveConfig(patch: Partial<CloudConfig>): CloudConfig {
  const next = { ...loadConfig(), ...patch };
  fs.writeFileSync(cloudConfigPath(), JSON.stringify(next, null, 2) + '\n');
  return next;
}

export function cloudStatus(): CloudStatus {
  const c = loadConfig();
  return { ...c, ready: isFolderReady(c.folder) };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error('Copying to your cloud folder took too long. The app will try again next time.')),
      ms
    );
    work.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

/** Runs one cloud step and records how it went. Never throws. */
async function runCloudStep(
  step: (folder: string, device: string) => Promise<unknown>
): Promise<CloudCopyResult> {
  const c = loadConfig();
  if (!c.folder || !c.device) return { state: 'off' };
  try {
    await withTimeout(step(c.folder, c.device), CLOUD_COPY_TIMEOUT_MS);
    saveConfig({ lastCopyAt: friendlyDate(new Date()), lastError: null });
    return { state: 'copied' };
  } catch (err) {
    const error =
      err instanceof Error && /^(Couldn't|Copying|That)/.test(err.message)
        ? err.message
        : "Couldn't copy to your cloud folder. The app will try again next time.";
    console.error('[cloud] copy failed:', err);
    try { saveConfig({ lastError: error }); } catch { /* status only */ }
    return { state: 'failed', error };
  }
}

/** Copies an existing local snapshot to the cloud folder, if one is set. */
export function copyToCloud(localFile: string): Promise<CloudCopyResult> {
  return runCloudStep((folder, device) => mirrorBackup(localFile, folder, device));
}

/** Copies any local snapshots the cloud folder is missing. Never throws. */
export function catchUpCloud(): Promise<CloudCopyResult> {
  return runCloudStep((folder, device) => catchUp(backupsDir(), folder, device));
}

/**
 * The one way the app makes a backup: local snapshot first (its failure
 * throws, as it always has), then the cloud copy (its failure is reported).
 */
export async function backupNow(
  db: Database.Database
): Promise<{ info: BackupInfo; cloud: CloudCopyResult }> {
  const info = await createDbBackup(db, backupsDir());
  setMeta(db, 'lastBackup', info.savedAt);
  const cloud = await copyToCloud(info.path);
  return { info, cloud };
}

/**
 * Sets the cloud folder from the one the user picked, then copies the local
 * snapshots across straight away so the folder is useful from the start. The
 * device name is chosen once and kept, so renaming the computer does not
 * split its backups into a second folder.
 */
export async function chooseCloudFolder(picked: string): Promise<CloudStatus> {
  const folder = prepareCloudFolder(picked);
  const device = loadConfig().device || safeDeviceName(os.hostname());
  saveConfig({ folder, device, lastError: null });
  await catchUpCloud();
  return cloudStatus();
}

/** Stops copying. The files already in the cloud folder are left alone. */
export function disconnectCloud(): CloudStatus {
  saveConfig({ folder: null, lastCopyAt: null, lastError: null });
  return cloudStatus();
}

/** Where the folder picker opens: a sync folder this machine already has. */
export function suggestedCloudFolder(): string {
  const home = os.homedir();
  const candidates =
    process.platform === 'win32'
      ? [process.env.OneDriveConsumer, process.env.OneDrive]
      : [path.join(home, 'Dropbox'), path.join(home, 'Nextcloud')];
  return candidates.find((p): p is string => !!p && fs.existsSync(p)) || home;
}

/**
 * A restore candidate as a local path: a file in the cloud folder is first
 * copied to a local staging folder, so the checks and the restore read a file
 * the sync app cannot change underneath them. A local file is returned as is.
 */
export function localPathFor(filePath: string): string {
  return isInside(filePath, loadConfig().folder)
    ? stageForRestore(filePath, restoreStagingDir())
    : filePath;
}
