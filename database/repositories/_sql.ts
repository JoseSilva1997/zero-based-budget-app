/* ============================================================
   Low-level SQL helpers shared by the repositories: a generic partial-row
   updater and a next-sort-order resolver. Table/column names are internal
   string constants (never user input), so interpolating them is safe.
   ============================================================ */
import type Database from 'better-sqlite3';

/**
 * UPDATE 'table' SET <provided fields> WHERE id = ?. Keys whose value is
 * 'undefined' are skipped (so callers pass a partial patch); 'null' is written
 * through (e.g. clearing a bank_account_id). A no-op when nothing is provided.
 */
export function patchById(
  db: Database.Database,
  table: string,
  id: number,
  fields: Record<string, unknown>
): void {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (keys.length === 0) return;
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params: Record<string, unknown> = { id };
  for (const k of keys) params[k] = fields[k];
  db.prepare(`UPDATE ${table} SET ${setSql} WHERE id = @id`).run(params);
}

/** MAX(sort_order)+1 among rows where 'parentCol' = 'parentId' (0 when empty). */
export function nextSortOrder(
  db: Database.Database,
  table: string,
  parentCol: string,
  parentId: number
): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM ${table} WHERE ${parentCol} = ?`)
    .get(parentId) as { m: number };
  return row.m + 1;
}
