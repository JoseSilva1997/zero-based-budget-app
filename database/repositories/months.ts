/* ============================================================
   budget_months and everything nested under them: incomes, groups,
   items, and actual entries.

   All money is integer cents. All functions are synchronous and use
   prepared statements. Granular writes map one-to-one to renderer mutations,
   and every aggregate ("actual" totals, funding plan, over-budget, trends) is
   computed here in SQL by SUMming the 'budget_item_actual_entries' rows.
   ============================================================ */
import type Database from 'better-sqlite3';
import type {
  BudgetMonth,
  BudgetIncome,
  BudgetGroup,
  BudgetItem,
  BudgetItemActualEntry,
  GroupKind,
  MonthTree,
  IncomeRead,
  GroupRead,
  ItemRead,
  ActualRead,
  MonthTotals,
  FundingPlanRow,
  OverBudgetRow,
  TrendPoint,
  ReusableCandidate,
  EntrySuggestion,
} from '../../shared/types';
import { centsToDollars, toMonthDay } from '../conversions';
import { setMeta } from './meta';
import { patchById, nextSortOrder } from './_sql';
import { listAccounts } from './accounts';

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
  name: string | null;
  note: string | null;
}

export function insertActualEntry(db: Database.Database, e: NewActualEntry): number {
  const info = db
    .prepare(
      `INSERT INTO budget_item_actual_entries
         (budget_item_id, spent_on, amount_cents, name, note)
       VALUES (@budget_item_id, @spent_on, @amount_cents, @name, @note)`
    )
    .run(e);
  return Number(info.lastInsertRowid);
}

/* ---------- next-sort-order convenience ---------------------------------- */

export const nextIncomeSort = (db: Database.Database, monthId: number) =>
  nextSortOrder(db, 'budget_incomes', 'budget_month_id', monthId);
export const nextGroupSort = (db: Database.Database, monthId: number) =>
  nextSortOrder(db, 'budget_groups', 'budget_month_id', monthId);
export const nextItemSort = (db: Database.Database, groupId: number) =>
  nextSortOrder(db, 'budget_items', 'budget_group_id', groupId);

/* ---------- granular updates / deletes ----------------------------------- */

export function updateIncome(
  db: Database.Database,
  id: number,
  fields: Partial<Pick<BudgetIncome, 'label' | 'amount_cents' | 'household_member_id' | 'sort_order'>>
): void {
  patchById(db, 'budget_incomes', id, fields);
}

export function removeIncome(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM budget_incomes WHERE id = ?`).run(id);
}

export function updateGroup(
  db: Database.Database,
  id: number,
  fields: Partial<Pick<BudgetGroup, 'name' | 'kind' | 'collapsed' | 'sort_order'>>
): void {
  patchById(db, 'budget_groups', id, fields);
}

/** Deletes a group; cascades to its items and their actual entries. */
export function deleteGroup(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM budget_groups WHERE id = ?`).run(id);
}

export function updateItem(
  db: Database.Database,
  id: number,
  fields: Partial<Pick<BudgetItem, 'name' | 'planned_cents' | 'bank_account_id' | 'sort_order'>>
): void {
  patchById(db, 'budget_items', id, fields);
}

/** Deletes an item; cascades to its actual entries. */
export function deleteItem(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM budget_items WHERE id = ?`).run(id);
}

export function updateActual(
  db: Database.Database,
  id: number,
  fields: Partial<Pick<BudgetItemActualEntry, 'spent_on' | 'amount_cents' | 'name' | 'note'>>
): void {
  patchById(db, 'budget_item_actual_entries', id, fields);
}

export function removeActual(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM budget_item_actual_entries WHERE id = ?`).run(id);
}

/** Persists the active month key ("YYYY-MM") to app_meta. */
export function setActiveMonth(db: Database.Database, month: string): void {
  setMeta(db, 'activeMonth', month);
}

/* ---------- reorder (rewrite sort_order) --------------------------------- */

/** Apply the reducer's array splice and persist sort_order = index. */
function writeOrder(db: Database.Database, table: string, orderedIds: number[]): void {
  const stmt = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, idx) => stmt.run(idx, id));
  });
  tx(orderedIds);
}

/**
 * Move 'id' relative to 'targetId' within a month's groups: both ids must
 * exist and differ, and 'after' inserts past the target.
 */
export function reorderGroups(
  db: Database.Database,
  monthId: number,
  id: number,
  targetId: number,
  after: boolean
): void {
  const ids = (
    db
      .prepare(`SELECT id FROM budget_groups WHERE budget_month_id = ? ORDER BY sort_order, id`)
      .all(monthId) as Array<{ id: number }>
  ).map((r) => r.id);

  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return;

  ids.splice(from, 1);
  const dest = ids.indexOf(targetId);
  ids.splice(dest + (after ? 1 : 0), 0, id);
  writeOrder(db, 'budget_groups', ids);
}

/**
 * Move 'id' relative to 'targetId' within a group's items. Drop-after is
 * inferred from the original direction ('from' index less than 'to' index).
 */
export function reorderItems(
  db: Database.Database,
  groupId: number,
  id: number,
  targetId: number
): void {
  const ids = (
    db
      .prepare(`SELECT id FROM budget_items WHERE budget_group_id = ? ORDER BY sort_order, id`)
      .all(groupId) as Array<{ id: number }>
  ).map((r) => r.id);

  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return;

  ids.splice(from, 1);
  const dest = ids.indexOf(targetId);
  ids.splice(dest + (from < to ? 1 : 0), 0, id);
  writeOrder(db, 'budget_items', ids);
}

/* ---------- month copy --------------------------------------------------- */

/**
 * Deep-copy a month's plan into a new month: groups and items are cloned
 * (collapsed reset, account preserved) but NOT their actual entries. Incomes
 * are copied only when 'copyIncome' is set. Returns the new month's id.
 */
export function copyMonth(
  db: Database.Database,
  fromMonthId: number,
  newMonth: string,
  opts: { copyIncome: boolean }
): number {
  const tx = db.transaction(() => {
    const newId = insertMonth(db, newMonth);

    const groups = listGroups(db, fromMonthId);
    groups.forEach((g, gIdx) => {
      const newGroupId = insertGroup(db, {
        budget_month_id: newId,
        name: g.name,
        kind: g.kind,
        sort_order: gIdx,
        collapsed: 0,
      });
      listItems(db, g.id).forEach((it, iIdx) => {
        insertItem(db, {
          budget_group_id: newGroupId,
          name: it.name,
          planned_cents: it.planned_cents,
          bank_account_id: it.bank_account_id,
          sort_order: iIdx,
        });
      });
    });

    if (opts.copyIncome) {
      listIncomes(db, fromMonthId).forEach((inc, idx) => {
        insertIncome(db, {
          budget_month_id: newId,
          household_member_id: inc.household_member_id,
          label: inc.label,
          amount_cents: inc.amount_cents,
          sort_order: idx,
        });
      });
    }

    return newId;
  });
  return tx();
}

/* ---------- reads (rows) ------------------------------------------------- */

export function listMonths(db: Database.Database): BudgetMonth[] {
  return db.prepare(`SELECT * FROM budget_months ORDER BY month`).all() as BudgetMonth[];
}

export function getMonthByKey(db: Database.Database, month: string): BudgetMonth | undefined {
  return db.prepare(`SELECT * FROM budget_months WHERE month = ?`).get(month) as
    | BudgetMonth
    | undefined;
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

/* ---------- reads (blob-shaped, for the renderer) ------------------------ */

function toActualRead(a: BudgetItemActualEntry): ActualRead {
  return {
    id: a.id,
    amount: centsToDollars(a.amount_cents),
    name: a.name || '',
    note: a.note || '',
    date: toMonthDay(a.spent_on),
    spent_on: a.spent_on,
  };
}

function toItemRead(db: Database.Database, it: BudgetItem): ItemRead {
  return {
    id: it.id,
    name: it.name,
    allocated: centsToDollars(it.planned_cents),
    account: it.bank_account_id,
    actuals: listActuals(db, it.id).map(toActualRead),
  };
}

function toGroupRead(db: Database.Database, g: BudgetGroup): GroupRead {
  return {
    id: g.id,
    name: g.name,
    isSavings: g.kind === 'savings',
    collapsed: !!g.collapsed,
    kind: g.kind,
    items: listItems(db, g.id).map((it) => toItemRead(db, it)),
  };
}

function toIncomeRead(inc: BudgetIncome): IncomeRead {
  return {
    id: inc.id,
    memberId: inc.household_member_id,
    amount: centsToDollars(inc.amount_cents),
    label: inc.label,
  };
}

export function getIncomeById(db: Database.Database, id: number): IncomeRead | undefined {
  const row = db.prepare(`SELECT * FROM budget_incomes WHERE id = ?`).get(id) as
    | BudgetIncome
    | undefined;
  return row ? toIncomeRead(row) : undefined;
}

export function getGroupById(db: Database.Database, id: number): GroupRead | undefined {
  const row = db.prepare(`SELECT * FROM budget_groups WHERE id = ?`).get(id) as
    | BudgetGroup
    | undefined;
  return row ? toGroupRead(db, row) : undefined;
}

export function getItemById(db: Database.Database, id: number): ItemRead | undefined {
  const row = db.prepare(`SELECT * FROM budget_items WHERE id = ?`).get(id) as
    | BudgetItem
    | undefined;
  return row ? toItemRead(db, row) : undefined;
}

export function getActualById(db: Database.Database, id: number): ActualRead | undefined {
  const row = db.prepare(`SELECT * FROM budget_item_actual_entries WHERE id = ?`).get(id) as
    | BudgetItemActualEntry
    | undefined;
  return row ? toActualRead(row) : undefined;
}

/** The nested month tree (incomes + groups -> items -> actuals) for 'month:get'. */
export function getMonthTree(db: Database.Database, monthId: number): MonthTree | null {
  const month = db.prepare(`SELECT * FROM budget_months WHERE id = ?`).get(monthId) as
    | BudgetMonth
    | undefined;
  if (!month) return null;
  return {
    id: month.id,
    month: month.month,
    incomes: listIncomes(db, monthId).map(toIncomeRead),
    groups: listGroups(db, monthId).map((g) => toGroupRead(db, g)),
  };
}

/* ---------- aggregates (SQL-computed; actual = SUM of entries) ------------ */

function scalarCents(db: Database.Database, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { c: number };
  return row.c;
}

/** income / allocated / actual / savings / unallocated, in dollars. */
export function monthTotals(db: Database.Database, monthId: number): MonthTotals {
  const income = scalarCents(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS c FROM budget_incomes WHERE budget_month_id = ?`,
    monthId
  );
  const allocated = scalarCents(
    db,
    `SELECT COALESCE(SUM(it.planned_cents), 0) AS c
       FROM budget_items it
       JOIN budget_groups g ON it.budget_group_id = g.id
      WHERE g.budget_month_id = ?`,
    monthId
  );
  const savings = scalarCents(
    db,
    `SELECT COALESCE(SUM(it.planned_cents), 0) AS c
       FROM budget_items it
       JOIN budget_groups g ON it.budget_group_id = g.id
      WHERE g.budget_month_id = ? AND g.kind = 'savings'`,
    monthId
  );
  const actual = scalarCents(
    db,
    `SELECT COALESCE(SUM(e.amount_cents), 0) AS c
       FROM budget_item_actual_entries e
       JOIN budget_items it ON e.budget_item_id = it.id
       JOIN budget_groups g ON it.budget_group_id = g.id
      WHERE g.budget_month_id = ?`,
    monthId
  );
  return {
    income: centsToDollars(income),
    allocated: centsToDollars(allocated),
    actual: centsToDollars(actual),
    savings: centsToDollars(savings),
    unallocated: centsToDollars(income - allocated),
  };
}

/** Per-account allocated/actual/count plus a trailing "unassigned" bucket. */
export function fundingPlan(db: Database.Database, monthId: number): FundingPlanRow[] {
  const rows = db
    .prepare(
      `SELECT it.bank_account_id AS account_id,
              COALESCE(SUM(it.planned_cents), 0) AS allocated_cents,
              COUNT(it.id) AS cnt,
              COALESCE(SUM(e.s), 0) AS actual_cents
         FROM budget_items it
         JOIN budget_groups g ON it.budget_group_id = g.id
         LEFT JOIN (
           SELECT budget_item_id, SUM(amount_cents) AS s
             FROM budget_item_actual_entries
            GROUP BY budget_item_id
         ) e ON e.budget_item_id = it.id
        WHERE g.budget_month_id = ?
        GROUP BY it.bank_account_id`
    )
    .all(monthId) as Array<{
    account_id: number | null;
    allocated_cents: number;
    cnt: number;
    actual_cents: number;
  }>;

  const byId = new Map<number | null, (typeof rows)[number]>();
  rows.forEach((r) => byId.set(r.account_id, r));

  const out: FundingPlanRow[] = [];
  // Real accounts in their sort order, keeping only those with items/allocation.
  for (const acc of listAccounts(db)) {
    const r = byId.get(acc.id);
    if (r && (r.cnt > 0 || r.allocated_cents > 0)) {
      out.push({
        account: acc,
        allocated: centsToDollars(r.allocated_cents),
        actual: centsToDollars(r.actual_cents),
        count: r.cnt,
      });
    }
  }
  // Trailing unassigned bucket.
  const un = byId.get(null);
  if (un && un.cnt > 0) {
    out.push({
      account: null,
      allocated: centsToDollars(un.allocated_cents),
      actual: centsToDollars(un.actual_cents),
      count: un.cnt,
    });
  }
  return out;
}

/** Items whose summed actual exceeds their planned amount. */
export function overBudgetItems(db: Database.Database, monthId: number): OverBudgetRow[] {
  const rows = db
    .prepare(
      `SELECT g.name AS group_name, it.name AS item_name, it.planned_cents AS planned,
              COALESCE(e.s, 0) AS actual
         FROM budget_items it
         JOIN budget_groups g ON it.budget_group_id = g.id
         LEFT JOIN (
           SELECT budget_item_id, SUM(amount_cents) AS s
             FROM budget_item_actual_entries
            GROUP BY budget_item_id
         ) e ON e.budget_item_id = it.id
        WHERE g.budget_month_id = ? AND COALESCE(e.s, 0) > it.planned_cents
        ORDER BY g.sort_order, it.sort_order`
    )
    .all(monthId) as Array<{
    group_name: string;
    item_name: string;
    planned: number;
    actual: number;
  }>;

  return rows.map((r) => ({
    group: r.group_name,
    item: r.item_name,
    over: centsToDollars(r.actual - r.planned),
    allocated: centsToDollars(r.planned),
    actual: centsToDollars(r.actual),
  }));
}

/* ---------- trends (per-month series for Dashboard + History) ------------ */

/** One TrendPoint per month, oldest first. */
export function trendSeries(db: Database.Database): TrendPoint[] {
  const months = listMonths(db); // ordered by month asc

  const sumByMonth = (sql: string): Map<number, number> => {
    const m = new Map<number, number>();
    for (const r of db.prepare(sql).all() as Array<{ mid: number; c: number }>) m.set(r.mid, r.c);
    return m;
  };

  const incomeMap = sumByMonth(
    `SELECT budget_month_id AS mid, COALESCE(SUM(amount_cents), 0) AS c
       FROM budget_incomes GROUP BY budget_month_id`
  );
  const allocMap = sumByMonth(
    `SELECT g.budget_month_id AS mid, COALESCE(SUM(it.planned_cents), 0) AS c
       FROM budget_items it JOIN budget_groups g ON it.budget_group_id = g.id
      GROUP BY g.budget_month_id`
  );
  const savingsMap = sumByMonth(
    `SELECT g.budget_month_id AS mid, COALESCE(SUM(it.planned_cents), 0) AS c
       FROM budget_items it JOIN budget_groups g ON it.budget_group_id = g.id
      WHERE g.kind = 'savings' GROUP BY g.budget_month_id`
  );
  const actualMap = sumByMonth(
    `SELECT g.budget_month_id AS mid, COALESCE(SUM(e.amount_cents), 0) AS c
       FROM budget_item_actual_entries e
       JOIN budget_items it ON e.budget_item_id = it.id
       JOIN budget_groups g ON it.budget_group_id = g.id
      GROUP BY g.budget_month_id`
  );

  // actual per (month, group name); LEFT JOIN so empty groups contribute 0.
  const byGroupRows = db
    .prepare(
      `SELECT g.budget_month_id AS mid, g.name AS name, COALESCE(SUM(e.s), 0) AS c
         FROM budget_groups g
         LEFT JOIN budget_items it ON it.budget_group_id = g.id
         LEFT JOIN (
           SELECT budget_item_id, SUM(amount_cents) AS s
             FROM budget_item_actual_entries GROUP BY budget_item_id
         ) e ON e.budget_item_id = it.id
        GROUP BY g.budget_month_id, g.name`
    )
    .all() as Array<{ mid: number; name: string; c: number }>;

  // savings allocated per (month, item name).
  const savingsCatRows = db
    .prepare(
      `SELECT g.budget_month_id AS mid, it.name AS name, COALESCE(SUM(it.planned_cents), 0) AS c
         FROM budget_groups g JOIN budget_items it ON it.budget_group_id = g.id
        WHERE g.kind = 'savings'
        GROUP BY g.budget_month_id, it.name`
    )
    .all() as Array<{ mid: number; name: string; c: number }>;

  // actual spend per (month, day-of-month from spent_on) for the timing chart.
  const byDayRows = db
    .prepare(
      `SELECT g.budget_month_id AS mid,
              CAST(substr(e.spent_on, 9, 2) AS INTEGER) AS day,
              COALESCE(SUM(e.amount_cents), 0) AS c
         FROM budget_item_actual_entries e
         JOIN budget_items it ON e.budget_item_id = it.id
         JOIN budget_groups g ON it.budget_group_id = g.id
        GROUP BY g.budget_month_id, day`
    )
    .all() as Array<{ mid: number; day: number; c: number }>;

  const byGroup = new Map<number, Record<string, number>>();
  for (const r of byGroupRows) {
    const rec = byGroup.get(r.mid) || {};
    rec[r.name] = centsToDollars(r.c);
    byGroup.set(r.mid, rec);
  }
  const savingsByCat = new Map<number, Record<string, number>>();
  for (const r of savingsCatRows) {
    const rec = savingsByCat.get(r.mid) || {};
    rec[r.name] = centsToDollars(r.c);
    savingsByCat.set(r.mid, rec);
  }

  const byDay = new Map<number, number[]>();
  for (const r of byDayRows) {
    const arr = byDay.get(r.mid) || new Array(32).fill(0);
    if (r.day >= 1 && r.day <= 31) arr[r.day] = centsToDollars(r.c);
    byDay.set(r.mid, arr);
  }

  return months.map((m) => {
    const over = overBudgetItems(db, m.id);
    return {
      id: m.id,
      month: m.month,
      income: centsToDollars(incomeMap.get(m.id) || 0),
      alloc: centsToDollars(allocMap.get(m.id) || 0),
      actual: centsToDollars(actualMap.get(m.id) || 0),
      savings: centsToDollars(savingsMap.get(m.id) || 0),
      byGroup: byGroup.get(m.id) || {},
      savingsByCat: savingsByCat.get(m.id) || {},
      overCount: over.length,
      over,
      byDay: byDay.get(m.id) || new Array(32).fill(0),
    };
  });
}

/* ---------- reusable item suggestions ------------------------------------ */

function normalizeItemName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Items from other months not already present in 'monthId', deduped by
 * normalised name, newest months first, filtered by a fuzzy 'query' (all
 * whitespace-separated terms must appear in "name groupName"). Capped at 30.
 */
export function reusableItemCandidates(
  db: Database.Database,
  monthId: number,
  query = ''
): ReusableCandidate[] {
  const currentNames = new Set(
    (
      db
        .prepare(
          `SELECT it.name FROM budget_items it
             JOIN budget_groups g ON it.budget_group_id = g.id
            WHERE g.budget_month_id = ?`
        )
        .all(monthId) as Array<{ name: string }>
    ).map((r) => normalizeItemName(r.name))
  );

  // Other-month items, newest months first then by position.
  const rows = db
    .prepare(
      `SELECT it.name AS name, it.planned_cents AS planned, it.bank_account_id AS account,
              g.name AS group_name, g.kind AS kind, m.month AS month
         FROM budget_items it
         JOIN budget_groups g ON it.budget_group_id = g.id
         JOIN budget_months m ON g.budget_month_id = m.id
        WHERE m.id <> ?
        ORDER BY m.month DESC, g.sort_order, it.sort_order, it.id`
    )
    .all(monthId) as Array<{
    name: string;
    planned: number;
    account: number | null;
    group_name: string;
    kind: GroupKind;
    month: string;
  }>;

  const terms = normalizeItemName(query).split(' ').filter(Boolean);
  const seen = new Set<string>();
  const out: ReusableCandidate[] = [];

  for (const r of rows) {
    const key = normalizeItemName(r.name);
    if (!key || currentNames.has(key) || seen.has(key)) continue;

    const haystack = normalizeItemName(`${r.name} ${r.group_name}`);
    if (terms.length && !terms.every((t) => haystack.includes(t))) continue;

    seen.add(key);
    out.push({
      name: r.name,
      allocated: centsToDollars(r.planned),
      account: r.account,
      groupName: r.group_name,
      isSavings: r.kind === 'savings',
      month: r.month,
    });
    if (out.length >= 30) break;
  }
  return out;
}

/* ---------- spending-entry suggestions ------------------------------------ */

/** Rank a suggestion for a typed query: a name that STARTS with what was typed
 *  is what the typist meant, so it comes before a mere substring match. */
function entryRank(s: EntrySuggestion, q: string): number {
  return normalizeItemName(s.name).startsWith(q) ? 0 : 1;
}

/**
 * Spending-entry names logged before, for the central "log a spend" input.
 * Deduped by (entry name, item name) so a name used under two different items
 * offers both, most recently spent first, each resolved to the item in
 * 'monthId' that carries the same name - or null when this month has no such
 * item and the caller must pick the destination. Filtered by a fuzzy 'query'
 * (all terms must appear in "name itemName groupName"). Capped at 30.
 */
export function actualEntrySuggestions(
  db: Database.Database,
  monthId: number,
  query = ''
): EntrySuggestion[] {
  // Items available in the target month, keyed by normalised name: an entry
  // whose old item still exists here already knows where it belongs.
  const targetItems = new Map<string, number>();
  const itemRows = db
    .prepare(
      `SELECT it.id AS id, it.name AS name
         FROM budget_items it
         JOIN budget_groups g ON it.budget_group_id = g.id
        WHERE g.budget_month_id = ?
        ORDER BY g.sort_order, it.sort_order, it.id`
    )
    .all(monthId) as Array<{ id: number; name: string }>;
  for (const r of itemRows) {
    const key = normalizeItemName(r.name);
    if (key && !targetItems.has(key)) targetItems.set(key, r.id);
  }

  // Every named entry across every month, most recent spend first, so the first
  // row seen for a pair is the one whose amount and month get shown.
  const rows = db
    .prepare(
      `SELECT e.name AS name, e.amount_cents AS amount_cents,
              it.name AS item_name, g.name AS group_name, m.month AS month
         FROM budget_item_actual_entries e
         JOIN budget_items it ON e.budget_item_id = it.id
         JOIN budget_groups g ON it.budget_group_id = g.id
         JOIN budget_months m ON g.budget_month_id = m.id
        WHERE e.name IS NOT NULL AND trim(e.name) <> ''
        ORDER BY e.spent_on DESC, e.id DESC`
    )
    .all() as Array<{
    name: string;
    amount_cents: number;
    item_name: string;
    group_name: string;
    month: string;
  }>;

  const byKey = new Map<string, EntrySuggestion>();
  for (const r of rows) {
    const itemKey = normalizeItemName(r.item_name);
    const key = `${normalizeItemName(r.name)}|${itemKey}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.uses += 1;
      continue;
    }
    byKey.set(key, {
      name: r.name,
      amount: centsToDollars(r.amount_cents),
      itemId: targetItems.has(itemKey) ? (targetItems.get(itemKey) as number) : null,
      itemName: r.item_name,
      groupName: r.group_name,
      month: r.month,
      uses: 1,
    });
  }

  const q = normalizeItemName(query);
  const terms = q.split(' ').filter(Boolean);
  const haystack = (s: EntrySuggestion) =>
    normalizeItemName(`${s.name} ${s.itemName} ${s.groupName}`);
  const out = [...byKey.values()].filter((s) => terms.every((t) => haystack(s).includes(t)));
  // Array.prototype.sort is stable, so recency (the map's insertion order)
  // still decides between two names that both start with the query.
  if (q) out.sort((a, b) => entryRank(a, q) - entryRank(b, q));
  return out.slice(0, 30);
}

/* ---------- destructive helpers ------------------------------------------ */

/** Deletes all months (cascades to incomes, groups, items, actual entries). */
export function deleteAllMonths(db: Database.Database): void {
  db.prepare(`DELETE FROM budget_months`).run();
}
