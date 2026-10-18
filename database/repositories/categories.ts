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

/**
 * Renames a category, in every month. A name another category in the same
 * group already has is refused: the two are really one, and merging them is a
 * separate, deliberate step.
 */
export function renameCategory(db: Database.Database, id: number, name: string): void {
  const category = getCategory(db, id);
  if (!category) return;
  assertNameFree(db, category.group_id, name, id);
  db.prepare(`UPDATE categories SET name = ? WHERE id = ?`).run(cleanName(name), id);
}

/** Refuses when another category in 'groupId' has 'name' (normalised), so a
 *  rename or a move never quietly makes two of one thing. */
export function assertNameFree(
  db: Database.Database,
  groupId: number,
  name: string,
  exceptId: number
): void {
  const clash = findCategoryByName(db, groupId, name, exceptId);
  if (clash) {
    throw new Error(
      `There's already an item called "${clash.name}" in that group. To combine the two, merge the categories in Settings.`
    );
  }
}

/** Deletes the category when no plan line refers to it any more. */
export function pruneCategory(db: Database.Database, id: number): void {
  db.prepare(
    `DELETE FROM categories
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM budget_items WHERE category_id = ?)`
  ).run(id, id);
}

/**
 * Archives or restores a category. An archived category keeps its plan lines
 * and entries (history is untouched) but is left out of copied months and the
 * reusable-items list; adding it again by name restores it.
 */
export function setCategoryArchived(db: Database.Database, id: number, archived: boolean): void {
  db.prepare(`UPDATE categories SET archived = ? WHERE id = ?`).run(archived ? 1 : 0, id);
}
