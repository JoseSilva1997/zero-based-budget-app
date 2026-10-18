/* ============================================================
   budget_months and everything nested under them: incomes, plan lines
   (budget_items) and actual entries, plus the month-independent groups and
   the categories plan lines point at (see ./categories.ts). A month shows a
   group when it has a plan line in it; an item's id is its plan line's, and
   its name is its category's.

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
  Category,
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
import { getMeta, setMeta } from './meta';
import { patchById, nextSortOrder } from './_sql';
import { listAccounts } from './accounts';
import {
  normalizeName,
  cleanName,
  insertCategory,
  nextCategorySort,
  getCategory,
  findCategoryByName,
  renameCategory,
  assertNameFree,
  pruneCategory,
  pruneGroup,
} from './categories';

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
  name: string;
  kind: GroupKind;
  sort_order: number;
  collapsed: number;
}

/** Groups are month-independent: a new one shows in every month until it has
 *  a plan line somewhere. */
export function insertGroup(db: Database.Database, g: NewGroup): number {
  const info = db
    .prepare(
      `INSERT INTO budget_groups (name, kind, sort_order, collapsed)
       VALUES (@name, @kind, @sort_order, @collapsed)`
    )
    .run(g);
  return Number(info.lastInsertRowid);
}

export interface NewItem {
  budget_month_id: number;
  category_id: number;
  planned_cents: number;
  bank_account_id: number | null;
  sort_order: number;
}

/** Inserts a plan line as given. Most callers want addItemByName, which finds
 *  or creates the category and refuses a second line for it in one month. */
export function insertItem(db: Database.Database, it: NewItem): number {
  const info = db
    .prepare(
      `INSERT INTO budget_items (budget_month_id, category_id, planned_cents, bank_account_id, sort_order)
       VALUES (@budget_month_id, @category_id, @planned_cents, @bank_account_id, @sort_order)`
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

export function nextGroupSort(db: Database.Database): number {
  const row = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM budget_groups`).get() as {
    m: number;
  };
  return row.m + 1;
}

/** Next sort_order for a plan line in 'groupId' within 'monthId'. */
export function nextItemSort(db: Database.Database, monthId: number, groupId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(it.sort_order), -1) AS m
         FROM budget_items it JOIN categories c ON c.id = it.category_id
        WHERE it.budget_month_id = ? AND c.group_id = ?`
    )
    .get(monthId, groupId) as { m: number };
  return row.m + 1;
}

/* ---------- adding a group ----------------------------------------------- */

/** The group whose name normalises to the same as 'name' (archived ones
 *  included), skipping 'exceptId'. */
export function findGroupByName(
  db: Database.Database,
  name: string,
  exceptId: number | null = null
): BudgetGroup | undefined {
  const key = normalizeName(name);
  const rows = db.prepare(`SELECT * FROM budget_groups ORDER BY id`).all() as BudgetGroup[];
  return rows.find((g) => g.id !== exceptId && normalizeName(g.name) === key);
}

/**
 * Adds a group by name: a group with that normalised name is reused (and
 * un-archived, so it shows in every month again), or a new one is created at
 * the end. Returns the group's id.
 */
export function addGroupByName(db: Database.Database, name: string): number {
  const tx = db.transaction(() => {
    const existing = findGroupByName(db, name);
    if (existing) {
      if (existing.archived) {
        db.prepare(`UPDATE budget_groups SET archived = 0 WHERE id = ?`).run(existing.id);
      }
      return existing.id;
    }
    return insertGroup(db, {
      name: cleanName(name),
      kind: 'spend',
      collapsed: 0,
      sort_order: nextGroupSort(db),
    });
  });
  return tx();
}

/* ---------- adding a plan line ------------------------------------------- */

export interface AddItem {
  monthId: number;
  groupId: number;
  name: string;
  planned_cents?: number;
  /** Omitted: the category's default account. */
  bank_account_id?: number | null;
}

/**
 * Adds a plan line to a month by name inside a group: the group's category with
 * that normalised name is reused (and un-archived), or a new one is created.
 * Returns the new plan line's id.
 */
export function addItemByName(db: Database.Database, a: AddItem): number {
  const tx = db.transaction(() => {
    const group = db.prepare(`SELECT id FROM budget_groups WHERE id = ?`).get(a.groupId);
    if (!group) {
      throw new Error('That group is no longer in your budget, so the item could not be added.');
    }
    const name = cleanName(a.name);
    let category = findCategoryByName(db, a.groupId, name);
    if (!category) {
      const id = insertCategory(db, {
        group_id: a.groupId,
        name,
        bank_account_id: a.bank_account_id ?? null,
        sort_order: nextCategorySort(db, a.groupId),
      });
      category = getCategory(db, id) as Category;
    }
    return addLineForCategory(db, a.monthId, category, a.planned_cents ?? 0, a.bank_account_id);
  });
  return tx();
}

/**
 * Adds a plan line for an existing category (a pick from the reusable list),
 * in the category's own group. Returns the new plan line's id.
 */
export function addItemForCategory(
  db: Database.Database,
  a: { monthId: number; categoryId: number; planned_cents?: number; bank_account_id?: number | null }
): number {
  const tx = db.transaction(() => {
    const category = getCategory(db, a.categoryId);
    if (!category) {
      throw new Error('That item is no longer in your budget, so it could not be added.');
    }
    return addLineForCategory(db, a.monthId, category, a.planned_cents ?? 0, a.bank_account_id);
  });
  return tx();
}

function addLineForCategory(
  db: Database.Database,
  monthId: number,
  category: Category,
  plannedCents: number,
  accountId: number | null | undefined
): number {
  const existing = db
    .prepare(`SELECT 1 FROM budget_items WHERE budget_month_id = ? AND category_id = ?`)
    .get(monthId, category.id);
  if (existing) {
    throw new Error(
      `"${category.name}" is already in this month's budget. Change its planned amount there instead of adding it again.`
    );
  }
  if (category.archived) {
    db.prepare(`UPDATE categories SET archived = 0 WHERE id = ?`).run(category.id);
  }
  // Its group comes back too, as the category does: it is in use again.
  db.prepare(`UPDATE budget_groups SET archived = 0 WHERE id = ? AND archived = 1`).run(category.group_id);
  return insertItem(db, {
    budget_month_id: monthId,
    category_id: category.id,
    planned_cents: plannedCents,
    bank_account_id: accountId !== undefined ? accountId : category.bank_account_id,
    sort_order: nextItemSort(db, monthId, category.group_id),
  });
}

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

/**
 * Groups are shared by every month, so a rename, kind or collapse applies to
 * all. A name another group already has (normalised) is refused, since that
 * would make two of one group.
 */
export function updateGroup(
  db: Database.Database,
  id: number,
  fields: Partial<Pick<BudgetGroup, 'name' | 'kind' | 'collapsed' | 'sort_order'>>
): void {
  if (fields.name !== undefined) {
    const clash = findGroupByName(db, fields.name, id);
    if (clash) {
      throw new Error(
        `There's already a group called "${clash.name}". Pick another name, or move its items into that group instead.`
      );
    }
  }
  patchById(db, 'budget_groups', id, fields);
}

/**
 * Takes a group out of one month: its plan lines there are deleted (their
 * entries cascade), and categories left with no line anywhere are deleted. A
 * group left with no category is deleted; one other months still use is
 * archived, so it shows only in the months where it has lines (adding it again
 * by name brings it back).
 */
export function deleteGroup(db: Database.Database, id: number, monthId: number): void {
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM budget_items
        WHERE budget_month_id = ?
          AND category_id IN (SELECT id FROM categories WHERE group_id = ?)`
    ).run(monthId, id);
    const cats = db.prepare(`SELECT id FROM categories WHERE group_id = ?`).all(id) as Array<{
      id: number;
    }>;
    for (const c of cats) pruneCategory(db, c.id);
    pruneGroup(db, id);
    db.prepare(`UPDATE budget_groups SET archived = 1 WHERE id = ?`).run(id);
  });
  tx();
}

/**
 * Patches a plan line. 'name' renames its category, so it applies to every
 * month, past ones included. 'bank_account_id' is this month's, and also
 * becomes the category's default, so the next new line starts on it.
 */
export function updateItem(
  db: Database.Database,
  id: number,
  fields: Partial<Pick<BudgetItem, 'planned_cents' | 'bank_account_id' | 'sort_order'>> & {
    name?: string;
  }
): void {
  const { name, ...line } = fields;
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT category_id FROM budget_items WHERE id = ?`).get(id) as
      | { category_id: number }
      | undefined;
    if (row && name !== undefined) renameCategory(db, row.category_id, name);
    if (row && line.bank_account_id !== undefined) {
      db.prepare(`UPDATE categories SET bank_account_id = ? WHERE id = ?`).run(
        line.bank_account_id,
        row.category_id
      );
    }
    patchById(db, 'budget_items', id, line);
  });
  tx();
}

/**
 * Deletes a plan line from its month; cascades to its actual entries. Its
 * category goes too once no month has a line for it (entries hang off lines,
 * so no line means nothing at all refers to it), and then its group if that
 * was the group's last category.
 */
export function deleteItem(db: Database.Database, id: number): void {
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT category_id FROM budget_items WHERE id = ?`).get(id) as
      | { category_id: number }
      | undefined;
    db.prepare(`DELETE FROM budget_items WHERE id = ?`).run(id);
    if (row) pruneCategory(db, row.category_id);
  });
  tx();
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
 * Move group 'id' relative to 'targetId': both ids must exist and differ, and
 * 'after' inserts past the target. Groups are shared by every month, so the
 * order is too.
 */
export function reorderGroups(
  db: Database.Database,
  id: number,
  targetId: number,
  after: boolean
): void {
  const ids = (
    db.prepare(`SELECT id FROM budget_groups ORDER BY sort_order, id`).all() as Array<{ id: number }>
  ).map((r) => r.id);

  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return;

  ids.splice(from, 1);
  const dest = ids.indexOf(targetId);
  ids.splice(dest + (after ? 1 : 0), 0, id);
  writeOrder(db, 'budget_groups', ids);
}

/** The month a plan line belongs to, or undefined when it is gone. */
function lineMonth(db: Database.Database, id: number): number | undefined {
  const row = db.prepare(`SELECT budget_month_id FROM budget_items WHERE id = ?`).get(id) as
    | { budget_month_id: number }
    | undefined;
  return row ? row.budget_month_id : undefined;
}

/**
 * Move plan line 'id' relative to 'targetId' within its group, in its month.
 * Drop-after is inferred from the original direction ('from' index less than
 * 'to' index).
 */
export function reorderItems(
  db: Database.Database,
  groupId: number,
  id: number,
  targetId: number
): void {
  const monthId = lineMonth(db, id);
  if (monthId === undefined) return;
  const ids = listItems(db, monthId, groupId).map((r) => r.id);

  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return;

  ids.splice(from, 1);
  const dest = ids.indexOf(targetId);
  ids.splice(dest + (from < to ? 1 : 0), 0, id);
  writeOrder(db, 'budget_items', ids);
}

/**
 * Move an item into another group. That moves its CATEGORY, so it changes
 * group in every month. 'targetId' is the plan line in the destination to land
 * BEFORE in this month; null appends. Both groups have this month's
 * sort_order rewritten: the destination so the item lands where the drop-line
 * promised, the source so it stays dense and a later insert cannot land in the
 * gap the move left behind. In other months the line goes to the end.
 */
export function moveItem(
  db: Database.Database,
  id: number,
  toGroupId: number,
  targetId: number | null
): void {
  const tx = db.transaction(() => {
    const item = db
      .prepare(
        `SELECT it.budget_month_id AS month_id, it.category_id AS category_id, c.group_id AS group_id
           FROM budget_items it JOIN categories c ON c.id = it.category_id
          WHERE it.id = ?`
      )
      .get(id) as { month_id: number; category_id: number; group_id: number } | undefined;
    // A drop can land after its own row was deleted elsewhere. Nothing to move
    // is not a failure worth reporting.
    if (!item) return;
    const fromGroupId = item.group_id;

    // Staying put is a reorder, and reorder already owns the rules for which
    // side of the target the row lands on. Delegating keeps one copy of them.
    if (fromGroupId === toGroupId) {
      if (targetId != null) reorderItems(db, toGroupId, id, targetId);
      return;
    }

    const dest = db.prepare(`SELECT id FROM budget_groups WHERE id = ?`).get(toGroupId);
    if (!dest) {
      throw new Error('That group is no longer in your budget, so the item could not be moved.');
    }
    const category = getCategory(db, item.category_id) as Category;
    assertNameFree(db, toGroupId, category.name, category.id);

    // In every other month the line joins the end of the destination group.
    const others = db
      .prepare(`SELECT id, budget_month_id FROM budget_items WHERE category_id = ? AND id <> ?`)
      .all(item.category_id, id) as Array<{ id: number; budget_month_id: number }>;
    const tail = others.map((o) => ({ id: o.id, at: nextItemSort(db, o.budget_month_id, toGroupId) }));

    db.prepare(`UPDATE categories SET group_id = ?, sort_order = ? WHERE id = ?`).run(
      toGroupId,
      nextCategorySort(db, toGroupId),
      item.category_id
    );
    const setSort = db.prepare(`UPDATE budget_items SET sort_order = ? WHERE id = ?`);
    for (const t of tail) setSort.run(t.at, t.id);
    // The source group may now have no category at all: then it goes.
    pruneGroup(db, fromGroupId);

    const destIds = listItems(db, item.month_id, toGroupId)
      .map((r) => r.id)
      .filter((x) => x !== id);
    // An unknown target (deleted mid-drag) falls back to the end rather than
    // dropping the item at the front by accident.
    const at = targetId == null ? -1 : destIds.indexOf(targetId);
    destIds.splice(at < 0 ? destIds.length : at, 0, id);
    writeOrder(db, 'budget_items', destIds);

    writeOrder(
      db,
      'budget_items',
      listItems(db, item.month_id, fromGroupId).map((r) => r.id)
    );
  });
  tx();
}

/* ---------- month copy --------------------------------------------------- */

/**
 * Copy a month's plan into a new month: every plan line whose category is not
 * archived is copied (category, planned amount, account, position) but NOT its
 * actual entries. Incomes are
 * copied only when 'copyIncome' is set. Returns the new month's id.
 */
export function copyMonth(
  db: Database.Database,
  fromMonthId: number,
  newMonth: string,
  opts: { copyIncome: boolean }
): number {
  const tx = db.transaction(() => {
    const newId = insertMonth(db, newMonth);

    const lines = db
      .prepare(
        `SELECT it.* FROM budget_items it JOIN categories c ON c.id = it.category_id
          WHERE it.budget_month_id = ? AND c.archived = 0
          ORDER BY it.sort_order, it.id`
      )
      .all(fromMonthId) as BudgetItem[];
    for (const it of lines) {
      insertItem(db, {
        budget_month_id: newId,
        category_id: it.category_id,
        planned_cents: it.planned_cents,
        bank_account_id: it.bank_account_id,
        sort_order: it.sort_order,
      });
    }

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

/**
 * The groups a month shows: every group that is not archived (so a month
 * started empty still offers them all), plus an archived group in a month
 * where it still has a plan line.
 */
export function listGroups(db: Database.Database, monthId: number): BudgetGroup[] {
  return db
    .prepare(
      `SELECT g.* FROM budget_groups g
        WHERE g.archived = 0
           OR EXISTS (SELECT 1 FROM budget_items it JOIN categories c ON c.id = it.category_id
                       WHERE c.group_id = g.id AND it.budget_month_id = ?)
        ORDER BY g.sort_order, g.id`
    )
    .all(monthId) as BudgetGroup[];
}

/** A plan line with what it borrows from its category. */
export type PlanLine = BudgetItem & { name: string; group_id: number };

const PLAN_LINE_SQL = `SELECT it.*, c.name AS name, c.group_id AS group_id
                         FROM budget_items it JOIN categories c ON c.id = it.category_id`;

/** A month's plan lines in one group, in order. */
export function listItems(db: Database.Database, monthId: number, groupId: number): PlanLine[] {
  return db
    .prepare(
      `${PLAN_LINE_SQL} WHERE it.budget_month_id = ? AND c.group_id = ? ORDER BY it.sort_order, it.id`
    )
    .all(monthId, groupId) as PlanLine[];
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

function toItemRead(db: Database.Database, it: PlanLine): ItemRead {
  return {
    id: it.id,
    category_id: it.category_id,
    name: it.name,
    allocated: centsToDollars(it.planned_cents),
    account: it.bank_account_id,
    actuals: listActuals(db, it.id).map(toActualRead),
  };
}

function toGroupRead(db: Database.Database, g: BudgetGroup, monthId: number | null): GroupRead {
  return {
    id: g.id,
    name: g.name,
    isSavings: g.kind === 'savings',
    collapsed: !!g.collapsed,
    kind: g.kind,
    items: monthId == null ? [] : listItems(db, monthId, g.id).map((it) => toItemRead(db, it)),
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

/** A group with its plan lines in 'monthId' (none when no month is given). */
export function getGroupById(
  db: Database.Database,
  id: number,
  monthId: number | null = null
): GroupRead | undefined {
  const row = db.prepare(`SELECT * FROM budget_groups WHERE id = ?`).get(id) as
    | BudgetGroup
    | undefined;
  return row ? toGroupRead(db, row, monthId) : undefined;
}

export function getItemById(db: Database.Database, id: number): ItemRead | undefined {
  const row = db.prepare(`${PLAN_LINE_SQL} WHERE it.id = ?`).get(id) as PlanLine | undefined;
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
    groups: listGroups(db, monthId).map((g) => toGroupRead(db, g, monthId)),
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
      WHERE it.budget_month_id = ?`,
    monthId
  );
  const savings = scalarCents(
    db,
    `SELECT COALESCE(SUM(it.planned_cents), 0) AS c
       FROM budget_items it
       JOIN categories c ON c.id = it.category_id
       JOIN budget_groups g ON g.id = c.group_id
      WHERE it.budget_month_id = ? AND g.kind = 'savings'`,
    monthId
  );
  const actual = scalarCents(
    db,
    `SELECT COALESCE(SUM(e.amount_cents), 0) AS c
       FROM budget_item_actual_entries e
       JOIN budget_items it ON e.budget_item_id = it.id
      WHERE it.budget_month_id = ?`,
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
         LEFT JOIN (
           SELECT budget_item_id, SUM(amount_cents) AS s
             FROM budget_item_actual_entries
            GROUP BY budget_item_id
         ) e ON e.budget_item_id = it.id
        WHERE it.budget_month_id = ?
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
      `SELECT g.name AS group_name, c.name AS item_name, it.planned_cents AS planned,
              COALESCE(e.s, 0) AS actual
         FROM budget_items it
         JOIN categories c ON c.id = it.category_id
         JOIN budget_groups g ON g.id = c.group_id
         LEFT JOIN (
           SELECT budget_item_id, SUM(amount_cents) AS s
             FROM budget_item_actual_entries
            GROUP BY budget_item_id
         ) e ON e.budget_item_id = it.id
        WHERE it.budget_month_id = ? AND COALESCE(e.s, 0) > it.planned_cents
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
    `SELECT budget_month_id AS mid, COALESCE(SUM(planned_cents), 0) AS c
       FROM budget_items GROUP BY budget_month_id`
  );
  const savingsMap = sumByMonth(
    `SELECT it.budget_month_id AS mid, COALESCE(SUM(it.planned_cents), 0) AS c
       FROM budget_items it
       JOIN categories c ON c.id = it.category_id
       JOIN budget_groups g ON g.id = c.group_id
      WHERE g.kind = 'savings' GROUP BY it.budget_month_id`
  );
  const actualMap = sumByMonth(
    `SELECT it.budget_month_id AS mid, COALESCE(SUM(e.amount_cents), 0) AS c
       FROM budget_item_actual_entries e
       JOIN budget_items it ON e.budget_item_id = it.id
      GROUP BY it.budget_month_id`
  );

  // actual per (month, group name) over the month's plan lines; LEFT JOIN so a
  // group whose lines have no entries contributes 0.
  const byGroupRows = db
    .prepare(
      `SELECT it.budget_month_id AS mid, g.name AS name, COALESCE(SUM(e.s), 0) AS c
         FROM budget_items it
         JOIN categories c ON c.id = it.category_id
         JOIN budget_groups g ON g.id = c.group_id
         LEFT JOIN (
           SELECT budget_item_id, SUM(amount_cents) AS s
             FROM budget_item_actual_entries GROUP BY budget_item_id
         ) e ON e.budget_item_id = it.id
        GROUP BY it.budget_month_id, g.name`
    )
    .all() as Array<{ mid: number; name: string; c: number }>;

  // savings allocated per (month, category name).
  const savingsCatRows = db
    .prepare(
      `SELECT it.budget_month_id AS mid, c.name AS name, COALESCE(SUM(it.planned_cents), 0) AS c
         FROM budget_items it
         JOIN categories c ON c.id = it.category_id
         JOIN budget_groups g ON g.id = c.group_id
        WHERE g.kind = 'savings'
        GROUP BY it.budget_month_id, c.name`
    )
    .all() as Array<{ mid: number; name: string; c: number }>;

  // actual spend per (month, day-of-month from spent_on) for the timing chart.
  const byDayRows = db
    .prepare(
      `SELECT it.budget_month_id AS mid,
              CAST(substr(e.spent_on, 9, 2) AS INTEGER) AS day,
              COALESCE(SUM(e.amount_cents), 0) AS c
         FROM budget_item_actual_entries e
         JOIN budget_items it ON e.budget_item_id = it.id
        GROUP BY it.budget_month_id, day`
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

/**
 * Categories with a plan line in another month but none in 'monthId', newest
 * months first (each shown with its most recent plan line's amount and
 * account), archived ones left out, filtered by a fuzzy 'query' (all
 * whitespace-separated terms must appear in "name groupName"). Capped at 30.
 */
export function reusableItemCandidates(
  db: Database.Database,
  monthId: number,
  query = ''
): ReusableCandidate[] {
  const rows = db
    .prepare(
      `SELECT c.id AS category_id, c.name AS name, it.planned_cents AS planned,
              it.bank_account_id AS account, g.name AS group_name, g.kind AS kind, m.month AS month
         FROM budget_items it
         JOIN categories c ON c.id = it.category_id
         JOIN budget_groups g ON g.id = c.group_id
         JOIN budget_months m ON m.id = it.budget_month_id
        WHERE it.budget_month_id <> ? AND c.archived = 0
          AND NOT EXISTS (SELECT 1 FROM budget_items x
                           WHERE x.category_id = c.id AND x.budget_month_id = ?)
        ORDER BY m.month DESC, g.sort_order, it.sort_order, it.id`
    )
    .all(monthId, monthId) as Array<{
    category_id: number;
    name: string;
    planned: number;
    account: number | null;
    group_name: string;
    kind: GroupKind;
    month: string;
  }>;

  const terms = normalizeName(query).split(' ').filter(Boolean);
  const seen = new Set<number>();
  const out: ReusableCandidate[] = [];

  for (const r of rows) {
    if (seen.has(r.category_id)) continue;

    const haystack = normalizeName(`${r.name} ${r.group_name}`);
    if (terms.length && !terms.every((t) => haystack.includes(t))) continue;

    seen.add(r.category_id);
    out.push({
      categoryId: r.category_id,
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
  return normalizeName(s.name).startsWith(q) ? 0 : 1;
}

/**
 * Spending-entry names logged before, for the central "log a spend" input.
 * Deduped by (entry name, category) so a name used under two different items
 * offers both, most recently spent first, each resolved to the plan line in
 * 'monthId' for the same category - or null when this month has no line for
 * it and the caller must pick the destination. Filtered by a fuzzy 'query'
 * (all terms must appear in "name itemName groupName"). Capped at 30.
 */
export function actualEntrySuggestions(
  db: Database.Database,
  monthId: number,
  query = ''
): EntrySuggestion[] {
  // The target month's plan lines, keyed by category: an entry whose category
  // has a line here already knows where it belongs.
  const targetItems = new Map<number, number>();
  const itemRows = db
    .prepare(`SELECT id, category_id FROM budget_items WHERE budget_month_id = ?`)
    .all(monthId) as Array<{ id: number; category_id: number }>;
  for (const r of itemRows) targetItems.set(r.category_id, r.id);

  // Every named entry across every month, most recent spend first, so the first
  // row seen for a pair is the one whose amount and month get shown.
  const rows = db
    .prepare(
      `SELECT e.name AS name, e.amount_cents AS amount_cents, c.id AS category_id,
              c.name AS item_name, g.name AS group_name, m.month AS month
         FROM budget_item_actual_entries e
         JOIN budget_items it ON e.budget_item_id = it.id
         JOIN categories c ON c.id = it.category_id
         JOIN budget_groups g ON g.id = c.group_id
         JOIN budget_months m ON m.id = it.budget_month_id
        WHERE e.name IS NOT NULL AND trim(e.name) <> ''
        ORDER BY e.spent_on DESC, e.id DESC`
    )
    .all() as Array<{
    name: string;
    amount_cents: number;
    category_id: number;
    item_name: string;
    group_name: string;
    month: string;
  }>;

  const byKey = new Map<string, EntrySuggestion>();
  for (const r of rows) {
    const key = `${normalizeName(r.name)}|${r.category_id}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.uses += 1;
      continue;
    }
    byKey.set(key, {
      name: r.name,
      amount: centsToDollars(r.amount_cents),
      itemId: targetItems.get(r.category_id) ?? null,
      itemName: r.item_name,
      groupName: r.group_name,
      month: r.month,
      uses: 1,
    });
  }

  const q = normalizeName(query);
  const terms = q.split(' ').filter(Boolean);
  const haystack = (s: EntrySuggestion) =>
    normalizeName(`${s.name} ${s.itemName} ${s.groupName}`);
  const out = [...byKey.values()].filter((s) => terms.every((t) => haystack(s).includes(t)));
  // Array.prototype.sort is stable, so recency (the map's insertion order)
  // still decides between two names that both start with the query.
  if (q) out.sort((a, b) => entryRank(a, q) - entryRank(b, q));
  return out.slice(0, 30);
}

/* ---------- destructive helpers ------------------------------------------ */

/**
 * Deletes a month, but only an empty one. Plan lines and budget_incomes
 * cascade from budget_months, so an unguarded delete would take a year of
 * entries with it; the only month worth removing is one nobody has used yet
 * (typically a mis-pressed Ctrl+N). The guards live here rather than in the IPC
 * handler so the invariant holds for every caller. Returns the active month key
 * as it stands afterwards.
 */
export function deleteMonth(db: Database.Database, id: number): string | null {
  const tx = db.transaction(() => {
    const month = db.prepare(`SELECT * FROM budget_months WHERE id = ?`).get(id) as
      | BudgetMonth
      | undefined;
    if (!month) {
      throw new Error('That month is no longer in your budget, so there is nothing to delete.');
    }

    const remaining = listMonths(db).filter((m) => m.id !== id); // month key ascending
    if (remaining.length === 0) {
      throw new Error(
        "That's the only month in your budget, so it can't be deleted. Create the month you want to keep first, then delete this one."
      );
    }

    const used = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM budget_items   WHERE budget_month_id = ?) AS groups,
                (SELECT COUNT(*) FROM budget_incomes WHERE budget_month_id = ?) AS incomes`
      )
      .get(id, id) as { groups: number; incomes: number };
    if (used.groups > 0 || used.incomes > 0) {
      throw new Error(
        "That month still has income or groups in it, so it can't be deleted. Only an empty month can be removed, so clear it out first if you really want it gone."
      );
    }

    db.prepare(`DELETE FROM budget_months WHERE id = ?`).run(id);

    // The active month is stored as a key, not an id, so deleting the month the
    // user is sitting on would leave app_meta pointing at nothing. Step to the
    // nearest surviving month (the one before it where there is one) instead of
    // leaving the next launch to guess.
    const active = getMeta(db, 'activeMonth');
    if (active !== month.month) return active;

    const earlier = remaining.filter((m) => m.month < month.month);
    const neighbour = earlier.length ? earlier[earlier.length - 1] : remaining[0];
    setActiveMonth(db, neighbour.month);
    return neighbour.month;
  });
  return tx();
}

/** Deletes all months (cascades to incomes, plan lines, actual entries), then
 *  the categories and groups that nothing refers to any more. */
export function deleteAllMonths(db: Database.Database): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM budget_months`).run();
    db.prepare(`DELETE FROM categories`).run();
    db.prepare(`DELETE FROM budget_groups`).run();
  });
  tx();
}
