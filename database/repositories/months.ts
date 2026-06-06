/* ============================================================
   budget_months and everything nested under them: incomes, groups,
   items, and actual entries.

   All money is integer cents. All functions are synchronous and use
   prepared statements; reads return typed domain objects.
   ============================================================ */
import type Database from 'better-sqlite3';
import type {
  BudgetMonth,
  BudgetIncome,
  BudgetGroup,
  BudgetItem,
  BudgetItemActualEntry,
  GroupKind,
} from '../../shared/types';

/* ---------- inserts ------------------------------------------------------ */

export function insertMonth(db: Database.Database, month: string): number {
  const info = db
    .prepare(`INSERT INTO budget_months (month) VALUES (?)`)
    .run(month);
  return Number(info.lastInsertRowid);
}

export interface NewIncome {
  budget_month_id: number;
  household_member_id: number;
  label: string;
  amount_cents: number;
  sort_order: number;
}

export function insertIncome(db: Database.Database, i: NewIncome): number {
  const info = db
    .prepare(
      `INSERT INTO budget_incomes
         (budget_month_id, household_member_id, label, amount_cents, sort_order)
       VALUES (@budget_month_id, @household_member_id, @label, @amount_cents, @sort_order)`
    )
    .run(i);
  return Number(info.lastInsertRowid);
}

export interface NewGroup {
  budget_month_id: number;
  name: string;
  kind: GroupKind;
  sort_order: number;
  collapsed: number;
}

export function insertGroup(db: Database.Database, g: NewGroup): number {
  const info = db
    .prepare(
      `INSERT INTO budget_groups (budget_month_id, name, kind, sort_order, collapsed)
       VALUES (@budget_month_id, @name, @kind, @sort_order, @collapsed)`
    )
    .run(g);
  return Number(info.lastInsertRowid);
}

export interface NewItem {
  budget_group_id: number;
  name: string;
  planned_cents: number;
  bank_account_id: number | null;
  sort_order: number;
}

export function insertItem(db: Database.Database, it: NewItem): number {
  const info = db
    .prepare(
      `INSERT INTO budget_items (budget_group_id, name, planned_cents, bank_account_id, sort_order)
       VALUES (@budget_group_id, @name, @planned_cents, @bank_account_id, @sort_order)`
    )
    .run(it);
  return Number(info.lastInsertRowid);
}

export interface NewActualEntry {
  budget_item_id: number;
  spent_on: string; // YYYY-MM-DD
  amount_cents: number;
  description: string | null;
}

export function insertActualEntry(db: Database.Database, e: NewActualEntry): number {
  const info = db
    .prepare(
      `INSERT INTO budget_item_actual_entries
         (budget_item_id, spent_on, amount_cents, description)
       VALUES (@budget_item_id, @spent_on, @amount_cents, @description)`
    )
    .run(e);
  return Number(info.lastInsertRowid);
}

/* ---------- reads -------------------------------------------------------- */

export function listMonths(db: Database.Database): BudgetMonth[] {
  return db.prepare(`SELECT * FROM budget_months ORDER BY month`).all() as BudgetMonth[];
}

export function listIncomes(db: Database.Database, monthId: number): BudgetIncome[] {
  return db
    .prepare(`SELECT * FROM budget_incomes WHERE budget_month_id = ? ORDER BY sort_order, id`)
    .all(monthId) as BudgetIncome[];
}

export function listGroups(db: Database.Database, monthId: number): BudgetGroup[] {
  return db
    .prepare(`SELECT * FROM budget_groups WHERE budget_month_id = ? ORDER BY sort_order, id`)
    .all(monthId) as BudgetGroup[];
}

export function listItems(db: Database.Database, groupId: number): BudgetItem[] {
  return db
    .prepare(`SELECT * FROM budget_items WHERE budget_group_id = ? ORDER BY sort_order, id`)
    .all(groupId) as BudgetItem[];
}

export function listActuals(db: Database.Database, itemId: number): BudgetItemActualEntry[] {
  return db
    .prepare(
      `SELECT * FROM budget_item_actual_entries
       WHERE budget_item_id = ? ORDER BY spent_on, id`
    )
    .all(itemId) as BudgetItemActualEntry[];
}

/* ---------- destructive helpers ------------------------------------------ */

/** Deletes all months (cascades to incomes, groups, items, actual entries). */
export function deleteAllMonths(db: Database.Database): void {
  db.prepare(`DELETE FROM budget_months`).run();
}
