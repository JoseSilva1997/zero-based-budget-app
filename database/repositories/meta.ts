/* ============================================================
   app_meta - key/value store for blob-level state with no normalised
   home: currency, theme, autoBackup, lastBackup, the sidebar's collapsed
   state, and the active month key.
   ============================================================ */
import type Database from 'better-sqlite3';
import type { AutoBackupMode } from '../../shared/types';

/* 'accentColor' was dropped when themes stopped being a background x accent
   grid and became one complete palette each. Nothing reads or writes it any
   more; the row an older install left behind is simply ignored. */
export type MetaKey =
  | 'currency'
  | 'theme'
  | 'autoBackup'
  | 'lastBackup'
  /* '1' or '0'. A window-layout preference rather than budget data, but it
     lives here for the same reason the theme does: app_meta is where a
     setting with no normalised home goes, and the renderer already has one
     chain for reading and writing those. */
  | 'sidebarCollapsed'
  /* '1' or '0'. On the upload review: a transfer row's tick is disabled, so
     a transfer can only be imported by switching it back to a spend. */
  | 'lockTransfers'
  /* JSON: the Dashboard's four cards (DashboardCard[]). Read and written only
     through repositories/dashboardCards.ts, which checks the shape. */
  | 'dashboardCards'
  | 'activeMonth';

export function getMeta(db: Database.Database, key: MetaKey): string | null {
  const row = db.prepare(`SELECT value FROM app_meta WHERE key = ?`).get(key) as
    | { value: string | null }
    | undefined;
  return row ? row.value : null;
}

export function setMeta(db: Database.Database, key: MetaKey, value: string | null): void {
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

/**
 * The auto-backup setting, normalised. Only an explicit 'off' turns backups
 * off; anything else - unset, the retired 'daily', or a value an old backup
 * carried in on restore - reads as the default 'onclose'. Someone who chose
 * 'daily' asked for automatic backups, so they keep getting them.
 */
export function readAutoBackupMode(db: Database.Database): AutoBackupMode {
  return getMeta(db, 'autoBackup') === 'off' ? 'off' : 'onclose';
}
