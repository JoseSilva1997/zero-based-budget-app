/* ============================================================
   IPC: backup:create, backup:list, backup:preview, backup:restore.

   The DB is the live source of truth, so creating a backup is just a snapshot
   of the current file.

   Restore is the only irreversible action in the app, so it is staged:
   'backup:preview' validates the candidate file and reports what both sides
   hold, letting the renderer name exactly what is at risk before asking. Only
   then does 'backup:restore' run, and it takes its own safety snapshot of the
   live database first, so a restore is always undoable from the backup list.
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb, closeDb, initDb } from '../db';
import { backupsDir, dbPath } from '../paths';
import {
  createDbBackup,
  inspectBackupFile,
  listBackups,
  restoreFromFile,
  summariseDb,
} from '../../database/repositories/backups';
import { setMeta } from '../../database/repositories/meta';
import { guardAsync } from './envelope';
import type { RestorePreview } from '../../shared/types';

export function registerBackupIpc(): void {
  // Snapshot the (already-current) DB to a dated file.
  ipcMain.handle('backup:create', () =>
    guardAsync(async () => {
      const db = getDb();
      const info = await createDbBackup(db, backupsDir());
      setMeta(db, 'lastBackup', info.savedAt);
      return { path: info.path, savedAt: info.savedAt };
    })
  );

  // The app's own snapshots, newest first - so restoring is recognition from a
  // labelled list rather than hunting a filename in an OS file picker.
  ipcMain.handle('backup:list', () => guardAsync(async () => listBackups(backupsDir())));

  // Validate a candidate and report both sides. Writes nothing.
  ipcMain.handle('backup:preview', (_event, filePath: string) =>
    guardAsync(async (): Promise<RestorePreview> => {
      const incoming = inspectBackupFile(filePath);
      return { live: summariseDb(getDb()), incoming };
    })
  );

  // Overwrite the live DB with a backup and reopen. A safety snapshot of the
  // current data is taken first and returned, so the renderer can tell the user
  // where their pre-restore state went. The renderer re-bootstraps afterwards.
  ipcMain.handle('backup:restore', (_event, filePath: string) =>
    guardAsync(async () => {
      // Validate before touching anything, so a bad file costs nothing.
      inspectBackupFile(filePath);

      const safety = await createDbBackup(getDb(), backupsDir());
      closeDb();
      try {
        restoreFromFile(filePath, dbPath());
      } finally {
        // Reopen either way: a failed copy must not leave the app without a DB.
        initDb();
      }
      return { ok: true as const, safetyCopy: safety.fileName, savedAt: safety.savedAt };
    })
  );
}
