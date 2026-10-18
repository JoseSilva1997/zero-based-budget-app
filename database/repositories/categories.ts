/* ============================================================
   categories: what a plan line and its spending are FOR ("Groceries"),
   the same in every month. A category belongs to one budget_group and is
   unique within it on its normalised name; a month refers to it through a
   plan line (budget_items), and the plan line's entries are the spending.

   Renaming or moving a category applies to every month, past ones included,
   so a name that is really a different thing gets a new category and the old
   one is archived. A category nothing refers to any more is deleted outright.
   ============================================================ */
import type Database from 'better-sqlite3';
import type { Category } from '../../shared/types';
import { nextSortOrder } from './_sql';

/** The form two names are compared in: trimmed, inner whitespace collapsed,
 *  case-folded. "Food  Shop" and "food shop" are one category. */
export function normalizeName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** The form a name is stored in: trimmed, inner whitespace collapsed, case kept. */
export function cleanName(name: string): string {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface NewCategory {
  group_id: number;
  name: string;
  bank_account_id: number | null;
  sort_order: number;
}

export function insertCategory(db: Database.Database, c: NewCategory): number {
  const info = db
    .prepare(
      `INSERT INTO categories (group_id, name, bank_account_id, sort_order)
       VALUES (@group_id, @name, @bank_account_id, @sort_order)`
    )
    .run({ ...c, name: cleanName(c.name) });
  return Number(info.lastInsertRowid);
}

export const nextCategorySort = (db: Database.Database, groupId: number) =>
  nextSortOrder(db, 'categories', 'group_id', groupId);

export function getCategory(db: Database.Database, id: number): Category | undefined {
  return db.prepare(`SELECT * FROM categories WHERE id = ?`).get(id) as Category | undefined;
}

/** The category in 'groupId' whose name normalises to the same as 'name'
 *  (archived ones included), skipping 'exceptId'. */
export function findCategoryByName(
  db: Database.Database,
  groupId: number,
  name: string,
  exceptId: number | null = null
): Category | undefined {
  const key = normalizeName(name);
  const rows = db
    .prepare(`SELECT * FROM categories WHERE group_id = ? ORDER BY id`)
    .all(groupId) as Category[];
  return rows.find((c) => c.id !== exceptId && normalizeName(c.name) === key);
}
