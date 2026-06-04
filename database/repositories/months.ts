/* ============================================================
   budget_months and everything nested under them: incomes, groups,
   items, and actual entries. Plus the SQL aggregates the brief's Phase 2
   requires (funding plan via GROUP BY, month totals, deep copy-month).

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
  FundingAccountTotal,
  MonthTotals,
  GroupKind,
} from '../../shared/types';

/* ---------- inserts ------------------------------------------------------ */

export function insertMonth(db: Database.Database, month: string): number {
  const info = db
    .prepare(`INSERT INTO budget_months (month, status) VALUES (?, 'open')`)
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
         (budget_month_id, household_member_id, label, amount_cents, is_expected, sort_order)
       VALUES (@budget_month_id, @household_member_id, @label, @amount_cents, 1, @sort_order)`
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
  // The actual_entries_after_insert trigger keeps budget_items.actual_cents in sync.
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

/* ---------- SQL aggregates (Phase 2 requirements) ------------------------ */

/**
 * Funding plan for a month: allocated/actual totals grouped by funding
 * account, computed in SQL (GROUP BY bank_account_id) — not in JS.
 */
export function fundingPlan(db: Database.Database, monthId: number): FundingAccountTotal[] {
  return db
    .prepare(
      `SELECT bi.bank_account_id              AS bank_account_id,
              COALESCE(SUM(bi.planned_cents), 0) AS allocated_cents,
              COALESCE(SUM(bi.actual_cents), 0)  AS actual_cents,
              COUNT(*)                           AS item_count
         FROM budget_items bi
         JOIN budget_groups bg ON bg.id = bi.budget_group_id
        WHERE bg.budget_month_id = ?
        GROUP BY bi.bank_account_id
        ORDER BY bi.bank_account_id IS NULL, bi.bank_account_id`
    )
    .all(monthId) as FundingAccountTotal[];
}

/**
 * Month totals (income, allocated, actual, savings, unallocated) — all
 * derived in SQL so callers never recompute them in the renderer.
 */
export function monthTotals(db: Database.Database, monthId: number): MonthTotals {
  const income = (
    db
      .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM budget_incomes WHERE budget_month_id = ?`)
      .get(monthId) as { c: number }
  ).c;

  const alloc = (
    db
      .prepare(
        `SELECT COALESCE(SUM(bi.planned_cents), 0) AS c
           FROM budget_items bi
           JOIN budget_groups bg ON bg.id = bi.budget_group_id
          WHERE bg.budget_month_id = ?`
      )
      .get(monthId) as { c: number }
  ).c;

  const actual = (
    db
      .prepare(
        `SELECT COALESCE(SUM(bi.actual_cents), 0) AS c
           FROM budget_items bi
           JOIN budget_groups bg ON bg.id = bi.budget_group_id
          WHERE bg.budget_month_id = ?`
      )
      .get(monthId) as { c: number }
  ).c;

  const savings = (
    db
      .prepare(
        `SELECT COALESCE(SUM(bi.planned_cents), 0) AS c
           FROM budget_items bi
           JOIN budget_groups bg ON bg.id = bi.budget_group_id
          WHERE bg.budget_month_id = ? AND bg.kind = 'savings'`
      )
      .get(monthId) as { c: number }
  ).c;

  return {
    income_cents: income,
    allocated_cents: alloc,
    actual_cents: actual,
    savings_cents: savings,
    unallocated_cents: income - alloc,
  };
}

/**
 * Deep copy a month's structure into a new month. Every group and item is
 * cloned into brand-new rows scoped to the new month — no shared row
 * references. Spending (actual entries) starts fresh; income is optional.
 * Returns the new month's id.
 */
export function copyMonth(
  db: Database.Database,
  fromMonthId: number,
  newMonth: string,
  opts: { copyIncome: boolean }
): number {
  const run = db.transaction(() => {
    const newMonthId = insertMonth(db, newMonth);

    if (opts.copyIncome) {
      for (const inc of listIncomes(db, fromMonthId)) {
        insertIncome(db, {
          budget_month_id: newMonthId,
          household_member_id: inc.household_member_id,
          label: inc.label,
          amount_cents: inc.amount_cents,
          sort_order: inc.sort_order,
        });
      }
    }

    for (const group of listGroups(db, fromMonthId)) {
      const newGroupId = insertGroup(db, {
        budget_month_id: newMonthId,
        name: group.name,
        kind: group.kind,
        sort_order: group.sort_order,
        collapsed: group.collapsed,
      });
      for (const item of listItems(db, group.id)) {
        // Clone the plan, not the spend: planned + funding account carry over,
        // actual entries do not.
        insertItem(db, {
          budget_group_id: newGroupId,
          name: item.name,
          planned_cents: item.planned_cents,
          bank_account_id: item.bank_account_id,
          sort_order: item.sort_order,
        });
      }
    }
    return newMonthId;
  });
  return run();
}

/* ---------- destructive helpers ------------------------------------------ */

/** Deletes all months (cascades to incomes, groups, items, actual entries). */
export function deleteAllMonths(db: Database.Database): void {
  db.prepare(`DELETE FROM budget_months`).run();
}
