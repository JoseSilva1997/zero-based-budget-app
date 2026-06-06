/* ============================================================
   IPC: backup:create and backup:restore.

   The DB is the live source of truth, so creating a backup is just a snapshot
   of the current file. Restore overwrites the live DB and reopens; it returns
   only an ok flag, and the renderer re-runs 'bootstrap:load' and refetches.
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb, closeDb, initDb } from '../db';
import { backupsDir, dbPath } from '../paths';
import { createDbBackup, restoreFromFile } from '../../database/repositories/backups';
import { setMeta } from '../../database/repositories/meta';
import { guardAsync } from './envelope';

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

  // Overwrite the live DB with a backup file and reopen. The renderer
  // re-bootstraps afterwards, so nothing is returned here.
  ipcMain.handle('backup:restore', (_event, filePath: string) =>
    guardAsync(async () => {
      closeDb();
      restoreFromFile(filePath, dbPath());
      initDb();
      return { ok: true };
    })
  );
}
