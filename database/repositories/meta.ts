/* ============================================================
   app_meta - key/value store for blob-level state with no normalised
   home: currency, theme, autoBackup, lastBackup, the sidebar's collapsed
   state, and the active month key.
   ============================================================ */
import type Database from 'better-sqlite3';

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
