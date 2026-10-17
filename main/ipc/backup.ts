/* ============================================================
   IPC: backup:create, backup:list, backup:preview, backup:restore, and the
   cloud backup folder: cloud:status, cloud:choose, cloud:disconnect.

   The DB is the live source of truth, so creating a backup is just a snapshot
   of the current file - and then, if a cloud folder is set, a copy of that
   snapshot (main/cloudBackup.ts; local always first).

   Restore is the only irreversible action in the app, so it is staged:
   'backup:preview' validates the candidate file and reports what both sides
   hold, letting the renderer name exactly what is at risk before asking. Only
   then does 'backup:restore' run, and it takes its own safety snapshot of the
   live database first, so a restore is always undoable from the backup list.
   A candidate in the cloud folder is copied to a local staging folder before
   either step reads it.
   ============================================================ */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import { getDb, closeDb, initDb } from '../db';
import { backupsDir, dbPath } from '../paths';
import {
  inspectBackupFile,
  listBackups,
  restoreFromFile,
  summariseDb,
} from '../../database/repositories/backups';
import { listCloudBackups } from '../../database/repositories/cloudFolder';
import {
  backupNow,
  chooseCloudFolder,
  cloudStatus,
  disconnectCloud,
  localPathFor,
  suggestedCloudFolder,
} from '../cloudBackup';
import { guardAsync } from './envelope';
import type { CloudStatus, ListedBackup, RestorePreview } from '../../shared/types';

export function registerBackupIpc(): void {
  // Snapshot the (already-current) DB to a dated file, then copy it to the
  // cloud folder. 'cloud' says how the copy went; only the local snapshot
  // failing makes this an error.
  ipcMain.handle('backup:create', () =>
    guardAsync(async () => {
      const { info, cloud } = await backupNow(getDb());
      return { path: info.path, savedAt: info.savedAt, cloud };
    })
  );

  // The app's own snapshots, newest first - so restoring is recognition from a
  // labelled list rather than hunting a filename in an OS file picker.
  // Cloud copies of this device's own snapshots that still exist locally are
  // left out: the local one is the same backup, and local comes first.
  ipcMain.handle('backup:list', () =>
    guardAsync(async (): Promise<ListedBackup[]> => {
      const local: ListedBackup[] = listBackups(backupsDir()).map((b) => ({
        ...b,
        source: 'local',
        device: null,
      }));
      const { folder, device } = cloudStatus();
      const have = new Set(local.map((b) => b.fileName));
      const cloud = listCloudBackups(folder).filter(
        (b) => !(b.device === device && have.has(b.fileName))
      );
      return [...local, ...cloud];
    })
  );

  // Validate a candidate and report both sides. Writes nothing.
  ipcMain.handle('backup:preview', (_event, filePath: string) =>
    guardAsync(async (): Promise<RestorePreview> => {
      // incoming.path is the staged local copy for a cloud backup, and that
      // is the path the renderer hands back to backup:restore.
      const incoming = inspectBackupFile(localPathFor(filePath));
      return { live: summariseDb(getDb()), incoming };
    })
  );

  // Overwrite the live DB with a backup and reopen. A safety snapshot of the
  // current data is taken first and returned, so the renderer can tell the user
  // where their pre-restore state went. The renderer re-bootstraps afterwards.
  ipcMain.handle('backup:restore', (_event, filePath: string) =>
    guardAsync(async () => {
      // Validate before touching anything, so a bad file costs nothing.
      const source = localPathFor(filePath);
      inspectBackupFile(source);

      // The safety snapshot is an ordinary backup, so it reaches the cloud
      // folder too.
      const { info: safety } = await backupNow(getDb());
      closeDb();
      try {
        restoreFromFile(source, dbPath());
      } finally {
        // Reopen either way: a failed copy must not leave the app without a DB.
        initDb();
      }
      return { ok: true as const, safetyCopy: safety.fileName, savedAt: safety.savedAt };
    })
  );

  /* ---- cloud backup folder ---- */
  ipcMain.handle('cloud:status', () => guardAsync(async (): Promise<CloudStatus> => cloudStatus()));

  // The native folder picker, opened here rather than in the renderer so the
  // path never has to be trusted from the page. Cancelling returns null.
  ipcMain.handle('cloud:choose', (event) =>
    guardAsync(async (): Promise<CloudStatus | null> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts: Electron.OpenDialogOptions = {
        title: 'Choose your cloud backup folder',
        buttonLabel: 'Use this folder',
        defaultPath: suggestedCloudFolder(),
        properties: ['openDirectory', 'createDirectory'],
      };
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (res.canceled || !res.filePaths[0]) return null;
      return chooseCloudFolder(path.resolve(res.filePaths[0]));
    })
  );

  ipcMain.handle('cloud:disconnect', () => guardAsync(async (): Promise<CloudStatus> => disconnectCloud()));
}
