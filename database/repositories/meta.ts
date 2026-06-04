/* ============================================================
   app_meta — key/value store for blob-level state with no normalised
   home: currency, theme, autoBackup, lastBackup, activeMonth, and a
   `saved` flag (so budget:load can return null on a truly fresh DB).
   ============================================================ */
import type Database from 'better-sqlite3';

export type MetaKey =
  | 'currency'
  | 'theme'
  | 'autoBackup'
  | 'lastBackup'
  | 'activeMonth'
  | 'saved';

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
