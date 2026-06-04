/* ============================================================
   IPC: backup:create and backup:restore.
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb, closeDb, initDb } from '../db';
import { backupsDir, dbPath } from '../paths';
import { saveAppState, loadAppState } from '../../database/repositories/appState';
import { createDbBackup, restoreFromFile } from '../../database/repositories/backups';
import { setMeta } from '../../database/repositories/meta';
import { guardAsync } from './envelope';
import type { AppState } from '../../shared/types';

export function registerBackupIpc(): void {
  // Persist the latest state, then snapshot the DB to a dated file.
  ipcMain.handle('backup:create', (_event, state: AppState) =>
    guardAsync(async () => {
      const db = getDb();
      saveAppState(db, state);
      const info = await createDbBackup(db, backupsDir());
      setMeta(db, 'lastBackup', info.savedAt);
      return { path: info.path, savedAt: info.savedAt };
    })
  );

  // Overwrite the live DB with a backup file, reopen, and return fresh state.
  ipcMain.handle('backup:restore', (_event, filePath: string) =>
    guardAsync(async () => {
      closeDb();
      restoreFromFile(filePath, dbPath());
      const db = initDb();
      const state = loadAppState(db);
      return { state };
    })
  );
}
