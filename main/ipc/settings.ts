/* ============================================================
   IPC: settings:update - persists currency / theme / autoBackup /
   sidebarCollapsed / lockTransfers to app_meta.
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
  sidebarCollapsed?: boolean;
  lockTransfers?: boolean;
}

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:update', (_e, p: { patch: SettingsPatch }) =>
    guardAsync(async () => {
      // Checked before anything is written, so a bad patch changes nothing.
      const mode = p.patch.autoBackup;
      if (mode !== undefined && mode !== 'off' && mode !== 'onclose') {
        throw new Error(`Unknown automatic backup setting: ${String(mode)}`);
      }
      const db = getDb();
      if (p.patch.currency !== undefined) setMeta(db, 'currency', p.patch.currency);
      if (p.patch.theme !== undefined) setMeta(db, 'theme', p.patch.theme);
      if (p.patch.autoBackup !== undefined) setMeta(db, 'autoBackup', p.patch.autoBackup);
      if (p.patch.sidebarCollapsed !== undefined)
        setMeta(db, 'sidebarCollapsed', p.patch.sidebarCollapsed ? '1' : '0');
      if (p.patch.lockTransfers !== undefined) setMeta(db, 'lockTransfers', p.patch.lockTransfers ? '1' : '0');
      return { ok: true };
    })
  );
}
