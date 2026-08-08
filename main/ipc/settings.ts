/* ============================================================
   IPC: settings:update - persists currency / theme / autoBackup to app_meta.
   (lastBackup is owned by the backup flow, not the renderer.)
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { guardAsync } from './envelope';
import { setMeta } from '../../database/repositories/meta';
import type { AutoBackupMode } from '../../shared/types';

interface SettingsPatch {
  currency?: string;
  theme?: string;
  autoBackup?: AutoBackupMode;
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:update', (_e, p: { patch: SettingsPatch }) =>
    guardAsync(async () => {
      const db = getDb();
      if (p.patch.currency !== undefined) setMeta(db, 'currency', p.patch.currency);
      if (p.patch.theme !== undefined) setMeta(db, 'theme', p.patch.theme);
      if (p.patch.autoBackup !== undefined) setMeta(db, 'autoBackup', p.patch.autoBackup);
      return { ok: true };
    })
  );
}
