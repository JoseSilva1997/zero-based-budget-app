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
import type { Category, CategoryRead } from '../../shared/types';
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

/** Every category, archived ones included, in group then category order, with
 *  how many months and entries refer to it. */
export function listCategories(db: Database.Database): CategoryRead[] {
  const rows = db
    .prepare(
      `SELECT c.id AS id, c.name AS name, g.id AS group_id, g.name AS group_name,
              c.archived AS archived,
              (SELECT COUNT(*) FROM budget_items it WHERE it.category_id = c.id) AS lines,
              (SELECT COUNT(*) FROM budget_item_actual_entries e
                 JOIN budget_items it ON it.id = e.budget_item_id
                WHERE it.category_id = c.id) AS entries
         FROM categories c JOIN budget_groups g ON g.id = c.group_id
        ORDER BY g.sort_order, g.id, c.sort_order, c.id`
    )
    .all() as Array<{
    id: number;
    name: string;
    group_id: number;
    group_name: string;
    archived: number;
    lines: number;
    entries: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    groupId: r.group_id,
    groupName: r.group_name,
    archived: !!r.archived,
    lines: r.lines,
    entries: r.entries,
  }));
}

/** What a merge moved, for the confirmation ("Moves 143 entries across 9
 *  months into Groceries") and the toast after it. */
export interface MergeImpact {
  entries: number;
  months: number;
}

/** Refuses a merge that cannot happen, and returns B. */
function assertMergeable(db: Database.Database, fromId: number, intoId: number): Category {
  if (fromId === intoId) {
    throw new Error("A category can't be merged into itself. Pick a different one to merge into.");
  }
  const from = getCategory(db, fromId);
  const into = getCategory(db, intoId);
  if (!from || !into) {
    throw new Error('One of those categories is no longer in your budget, so nothing was merged.');
  }
  return into;
}

/** What merging 'fromId' into 'intoId' would move, without moving anything:
 *  the counts the confirmation states before the user commits. */
export function previewMerge(db: Database.Database, fromId: number, intoId: number): MergeImpact {
  assertMergeable(db, fromId, intoId);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS months,
              (SELECT COUNT(*) FROM budget_item_actual_entries e
                 JOIN budget_items it ON it.id = e.budget_item_id
                WHERE it.category_id = @id) AS entries
         FROM budget_items WHERE category_id = @id`
    )
    .get({ id: fromId }) as { months: number; entries: number };
  return { entries: row.entries, months: row.months };
}

/**
 * Merges category 'fromId' into 'intoId': every plan line and entry of A
 * becomes B's. In a month where both have a line, the two become B's line,
 * with the planned amounts summed and A's entries moved onto it. A is then
 * deleted. B keeps its name, group, default account and archived state. There
 * is no undo beyond a backup, so the caller confirms with the returned impact
 * first (it is the same before and after: A's months and entries).
 */
export function mergeCategories(db: Database.Database, fromId: number, intoId: number): MergeImpact {
  const tx = db.transaction((): MergeImpact => {
    const into = assertMergeable(db, fromId, intoId);

    const lines = db
      .prepare(`SELECT id, budget_month_id, planned_cents FROM budget_items WHERE category_id = ?`)
      .all(fromId) as Array<{ id: number; budget_month_id: number; planned_cents: number }>;
    const impact: MergeImpact = { entries: 0, months: lines.length };

    const intoLine = db.prepare(
      `SELECT id FROM budget_items WHERE category_id = ? AND budget_month_id = ?`
    );
    const countEntries = db.prepare(
      `SELECT COUNT(*) AS n FROM budget_item_actual_entries WHERE budget_item_id = ?`
    );
    const moveEntries = db.prepare(
      `UPDATE budget_item_actual_entries SET budget_item_id = ? WHERE budget_item_id = ?`
    );
    const addPlanned = db.prepare(
      `UPDATE budget_items SET planned_cents = planned_cents + ? WHERE id = ?`
    );
    const deleteLine = db.prepare(`DELETE FROM budget_items WHERE id = ?`);
    const repoint = db.prepare(
      `UPDATE budget_items SET category_id = ?, sort_order = ? WHERE id = ?`
    );
    const nextSort = db.prepare(
      `SELECT COALESCE(MAX(it.sort_order), -1) + 1 AS n
         FROM budget_items it JOIN categories c ON c.id = it.category_id
        WHERE it.budget_month_id = ? AND c.group_id = ?`
    );

    for (const line of lines) {
      impact.entries += (countEntries.get(line.id) as { n: number }).n;
      const shared = intoLine.get(intoId, line.budget_month_id) as { id: number } | undefined;
      if (shared) {
        moveEntries.run(shared.id, line.id);
        addPlanned.run(line.planned_cents, shared.id);
        deleteLine.run(line.id);
      } else {
        // Joins the end of B's group in that month, which may be another group.
        const at = (nextSort.get(line.budget_month_id, into.group_id) as { n: number }).n;
        repoint.run(intoId, at, line.id);
      }
    }

    db.prepare(`DELETE FROM categories WHERE id = ?`).run(fromId);
    return impact;
  });
  return tx();
}
