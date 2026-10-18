/* ============================================================
   imports: "Upload transactions". Statements are staged in a month's
   pending batch (import_batches -> import_files -> import_rows) until you
   confirm, which writes the ticked rows as ordinary entries in one
   transaction. Only the parsed rows and your decisions are stored;
   predictions and labels are recomputed on every read of the review,
   because they depend on everything else in the database.

   A month has at most one pending batch, and any number of imported ones,
   each of which can be undone back to pending.
   ============================================================ */
import type Database from 'better-sqlite3';
import type {
  Bank,
  BankAccount,
  BudgetMonth,
  ImportCategoryOption,
  ImportConfirmResult,
  ImportDuplicate,
  ImportHistoryRow,
  ImportPlanLine,
  ImportReview,
  ImportRowPatch,
  ImportRowRead,
} from '../../shared/types';
import { readStatement, hashText } from '../../main/import/pipeline';
import { assessRow, type RowAssessment, type RowDecisions } from '../../main/import/labels';
import { train, type Classifier, type Prediction, type TrainingExample } from '../../main/import/classifier';
import { getAccountById, listAccounts } from './accounts';
import { getBank, listBanks, setAccountIdentifier } from './banks';
import { cleanName } from './categories';
import { patchById } from './_sql';
import { addItemForCategory } from './months';

export interface ImportBatch {
  id: number;
  budget_month_id: number;
  status: 'pending' | 'imported' | 'discarded';
  created_at: string;
  imported_at: string | null;
}

export interface AddedFile {
  id: number;
  batchId: number;
  accountId: number;
  filename: string;
  rowCount: number;
}

export interface NewFile {
  monthId: number;
  accountId: number;
  filename: string;
  text: string;
}

function pendingBatch(db: Database.Database, monthId: number): ImportBatch | undefined {
  return db
    .prepare(`SELECT * FROM import_batches WHERE budget_month_id = ? AND status = 'pending'`)
    .get(monthId) as ImportBatch | undefined;
}

function ensurePendingBatch(db: Database.Database, monthId: number): ImportBatch {
  const existing = pendingBatch(db, monthId);
  if (existing) return existing;
  const info = db.prepare(`INSERT INTO import_batches (budget_month_id) VALUES (?)`).run(monthId);
  return db.prepare(`SELECT * FROM import_batches WHERE id = ?`).get(info.lastInsertRowid) as ImportBatch;
}

/**
 * Adds a statement file for one account to the month's pending batch
 * (starting one if needed), parsed, fingerprinted and stored row by row.
 * Refused, leaving nothing behind, when the file is already in the batch,
 * the account has no bank yet (NeedsBankError), or the file is another
 * bank's or another account's. The first statement that names its account
 * number records it on the account.
 */
export function addFile(db: Database.Database, f: NewFile): AddedFile {
  const tx = db.transaction((): AddedFile => {
    if (!db.prepare(`SELECT 1 FROM budget_months WHERE id = ?`).get(f.monthId)) {
      throw new Error('That month is no longer in your budget, so the file was not added.');
    }
    const account = getAccountById(db, f.accountId) as BankAccount | undefined;
    if (!account) {
      throw new Error('That account is no longer in your list, so the file was not added.');
    }
    const batch = ensurePendingBatch(db, f.monthId);
    const hash = hashText(f.text);
    const dup = db
      .prepare(`SELECT 1 FROM import_files WHERE batch_id = ? AND file_hash = ?`)
      .get(batch.id, hash);
    if (dup) throw new Error('That file is already in this upload.');

    const bank = account.bank_id === null ? null : (getBank(db, account.bank_id) as Bank | undefined) ?? null;
    const read = readStatement(f.text, account, bank);
    if (read.accountIdentifier && !account.account_identifier) {
      setAccountIdentifier(db, account.id, read.accountIdentifier);
    }

    const info = db
      .prepare(
        `INSERT INTO import_files (batch_id, bank_account_id, filename, file_hash) VALUES (?, ?, ?, ?)`
      )
      .run(batch.id, account.id, f.filename, hash);
    const fileId = Number(info.lastInsertRowid);
    const insertRow = db.prepare(
      `INSERT INTO import_rows
         (file_id, row_index, raw, posted_on, spent_on, amount_cents, direction,
          descriptor_raw, descriptor_clean, features, parse_error, not_completed, fingerprint)
       VALUES (@fileId, @rowIndex, @raw, @postedOn, @spentOn, @amountCents, @direction,
               @descriptorRaw, @descriptorClean, @features, @parseError, @notCompleted, @fingerprint)`
    );
    for (const r of read.rows) {
      insertRow.run({
        fileId,
        rowIndex: r.rowIndex,
        raw: JSON.stringify(r.raw),
        postedOn: r.postedOn,
        spentOn: r.spentOn,
        amountCents: r.amountCents,
        direction: r.direction,
        descriptorRaw: r.descriptorRaw ?? '',
        descriptorClean: r.descriptorClean ?? '',
        features: JSON.stringify(r.features ?? {}),
        parseError: r.parseError ?? null,
        notCompleted: r.notCompleted ? 1 : 0,
        fingerprint: r.fingerprint,
      });
    }
    return { id: fileId, batchId: batch.id, accountId: account.id, filename: f.filename, rowCount: read.rows.length };
  });
  return tx();
}

function batchById(db: Database.Database, id: number): ImportBatch | undefined {
  return db.prepare(`SELECT * FROM import_batches WHERE id = ?`).get(id) as ImportBatch | undefined;
}

/** Refuses a change to a batch that has been imported. */
function assertPending(batch: ImportBatch | undefined): asserts batch is ImportBatch {
  if (!batch) throw new Error('That upload is no longer there. Close it and start again.');
  if (batch.status !== 'pending') {
    throw new Error('That upload has already been imported. Undo it first to change it.');
  }
}

/** Removes a file, and its rows, from a pending batch. */
export function removeFile(db: Database.Database, fileId: number): void {
  const file = db.prepare(`SELECT batch_id FROM import_files WHERE id = ?`).get(fileId) as
    | { batch_id: number }
    | undefined;
  if (!file) return;
  assertPending(batchById(db, file.batch_id));
  db.prepare(`DELETE FROM import_files WHERE id = ?`).run(fileId);
}

/* ---------- the review ---------------------------------------------------- */

/** An import_rows row with its file's account. */
interface StoredRow {
  id: number;
  file_id: number;
  row_index: number;
  posted_on: string | null;
  spent_on: string | null;
  amount_cents: number | null;
  direction: 'debit' | 'credit' | null;
  descriptor_raw: string;
  descriptor_clean: string;
  features: string;
  parse_error: string | null;
  not_completed: number;
  fingerprint: string | null;
  category_id: number | null;
  name: string | null;
  kind: 'spend' | 'transfer' | null;
  included: 0 | 1 | null;
  linked_entry_id: number | null;
  bank_account_id: number;
}

/** A batch's rows, file by file in the order added, each in statement order. */
function batchRows(db: Database.Database, batchId: number): StoredRow[] {
  return db
    .prepare(
      `SELECT r.*, f.bank_account_id FROM import_rows r JOIN import_files f ON f.id = r.file_id
        WHERE f.batch_id = ? ORDER BY f.id, r.row_index`
    )
    .all(batchId) as StoredRow[];
}

const decisionsOf = (r: StoredRow): RowDecisions => ({
  categoryId: r.category_id,
  name: r.name,
  kind: r.kind,
  included: r.included,
  linkedEntryId: r.linked_entry_id,
});

/** How far apart, in days, an entry and a row may be and still be one spend. */
const DUPLICATE_DAYS = 3;

/**
 * Existing entries a debit row may be the same spend as: the same amount,
 * spent within DUPLICATE_DAYS, on a plan line on the row's account or on no
 * account. Entries already accounted for are left out: imported from a row,
 * or matched to another row ("Same as existing") in an upload in progress.
 */
function duplicatesOf(db: Database.Database, row: StoredRow): ImportDuplicate[] {
  if (row.direction !== 'debit' || row.parse_error || row.spent_on === null) return [];
  return db
    .prepare(
      `SELECT e.id, e.spent_on AS spentOn, e.amount_cents AS amountCents, e.name, c.name AS categoryName
         FROM budget_item_actual_entries e
         JOIN budget_items it ON it.id = e.budget_item_id
         JOIN categories c ON c.id = it.category_id
        WHERE e.amount_cents = @amount
          AND ABS(julianday(e.spent_on) - julianday(@spentOn)) <= ${DUPLICATE_DAYS}
          AND (it.bank_account_id = @account OR it.bank_account_id IS NULL)
          AND e.import_row_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM import_rows o JOIN import_files f ON f.id = o.file_id
                            JOIN import_batches b ON b.id = f.batch_id
                           WHERE o.linked_entry_id = e.id AND o.id <> @rowId AND b.status <> 'discarded')
        ORDER BY ABS(julianday(e.spent_on) - julianday(@spentOn)), e.spent_on, e.id`
    )
    .all({ amount: row.amount_cents, spentOn: row.spent_on, account: row.bank_account_id, rowId: row.id }) as ImportDuplicate[];
}

/**
 * A row in another batch with the same fingerprint that is in the budget:
 * an entry was written from it, or (in an imported batch) it was matched to
 * an entry you had typed.
 */
const ALREADY_IMPORTED_SQL = `
  SELECT 1 FROM import_rows o
    JOIN import_files f ON f.id = o.file_id
    JOIN import_batches b ON b.id = f.batch_id
   WHERE o.fingerprint = ? AND f.batch_id <> ?
     AND (EXISTS (SELECT 1 FROM budget_item_actual_entries e WHERE e.import_row_id = o.id)
          OR (b.status = 'imported' AND o.linked_entry_id IS NOT NULL))
   LIMIT 1`;

/**
 * The classifier, trained now on every row outside this batch whose answer
 * is known: (a) a row an entry points back at (written from it, or matched
 * to it at confirm), labelled with that entry's category as it is today, so
 * a merge or a move is followed; (b) a row you marked a transfer, in an
 * imported batch.
 */
function trainFor(db: Database.Database, batchId: number): Classifier {
  const rows = db
    .prepare(
      `SELECT r.descriptor_clean, r.features, f.bank_account_id, r.amount_cents, it.category_id AS label
         FROM import_rows r
         JOIN import_files f ON f.id = r.file_id
         JOIN budget_item_actual_entries e ON e.import_row_id = r.id
         JOIN budget_items it ON it.id = e.budget_item_id
        WHERE f.batch_id <> @batchId
       UNION ALL
       SELECT r.descriptor_clean, r.features, f.bank_account_id, r.amount_cents, 'transfer' AS label
         FROM import_rows r
         JOIN import_files f ON f.id = r.file_id
         JOIN import_batches b ON b.id = f.batch_id
        WHERE f.batch_id <> @batchId AND b.status = 'imported' AND r.kind = 'transfer'`
    )
    .all({ batchId }) as Array<{
    descriptor_clean: string;
    features: string;
    bank_account_id: number;
    amount_cents: number | null;
    label: number | 'transfer';
  }>;
  const examples: TrainingExample[] = rows.map((r) => ({
    descriptorClean: r.descriptor_clean,
    features: JSON.parse(r.features || '{}'),
    accountId: r.bank_account_id,
    amountCents: r.amount_cents,
    label: r.label,
  }));
  return train(examples);
}

interface AssessedRow {
  row: StoredRow;
  prediction: Prediction | null;
  duplicates: ImportDuplicate[];
  assessment: RowAssessment;
}

/** Every row of a batch with its prediction, duplicates, labels and
 *  effective values: what the review shows and what confirming writes. */
function assessBatch(db: Database.Database, batch: ImportBatch, month: BudgetMonth): AssessedRow[] {
  const planned = new Set(
    (
      db.prepare(`SELECT category_id FROM budget_items WHERE budget_month_id = ?`).all(month.id) as Array<{
        category_id: number;
      }>
    ).map((x) => x.category_id)
  );
  const classifier = trainFor(db, batch.id);
  const imported = db.prepare(ALREADY_IMPORTED_SQL);
  return batchRows(db, batch.id).map((row) => {
    const prediction = classifier.predict({
      descriptorClean: row.descriptor_clean,
      features: JSON.parse(row.features || '{}'),
      accountId: row.bank_account_id,
      amountCents: row.amount_cents,
    });
    const duplicates = duplicatesOf(db, row);
    const assessment = assessRow({
      monthKey: month.month,
      spentOn: row.spent_on,
      direction: row.direction,
      descriptorClean: row.descriptor_clean,
      parseError: row.parse_error,
      notCompleted: !!row.not_completed,
      alreadyImported: row.fingerprint !== null && !!imported.get(row.fingerprint, batch.id),
      duplicates: duplicates.length,
      prediction,
      inMonth: (id) => planned.has(id),
      stored: decisionsOf(row),
    });
    return { row, prediction, duplicates, assessment };
  });
}

function toRowRead(a: AssessedRow): ImportRowRead {
  const r = a.row;
  return {
    id: r.id,
    fileId: r.file_id,
    rowIndex: r.row_index,
    postedOn: r.posted_on,
    spentOn: r.spent_on,
    amountCents: r.amount_cents,
    direction: r.direction,
    descriptorRaw: r.descriptor_raw,
    descriptorClean: r.descriptor_clean,
    features: JSON.parse(r.features || '{}'),
    parseError: r.parse_error,
    notCompleted: !!r.not_completed,
    categoryId: a.assessment.categoryId,
    name: a.assessment.name,
    kind: a.assessment.kind,
    included: a.assessment.included,
    prediction: a.prediction,
    labels: a.assessment.labels,
    duplicates: a.duplicates,
    decisions: {
      categoryId: r.category_id,
      name: r.name,
      kind: r.kind,
      included: r.included === null ? null : r.included === 1,
      linkedEntryId: r.linked_entry_id,
    },
  };
}

/** The month's plan lines with what is spent so far, in budget order. */
function planOf(db: Database.Database, monthId: number): ImportPlanLine[] {
  return db
    .prepare(
      `SELECT it.id AS itemId, it.category_id AS categoryId, c.name AS name,
              it.planned_cents AS plannedCents,
              COALESCE((SELECT SUM(e.amount_cents) FROM budget_item_actual_entries e
                         WHERE e.budget_item_id = it.id), 0) AS actualCents
         FROM budget_items it
         JOIN categories c ON c.id = it.category_id
         JOIN budget_groups g ON g.id = c.group_id
        WHERE it.budget_month_id = ?
        ORDER BY g.sort_order, g.id, it.sort_order, it.id`
    )
    .all(monthId) as ImportPlanLine[];
}

/** Every category not archived, the month's own first, for the picker. */
function pickerOf(db: Database.Database, monthId: number): ImportCategoryOption[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.group_id AS groupId, g.name AS groupName,
              EXISTS (SELECT 1 FROM budget_items it
                       WHERE it.category_id = c.id AND it.budget_month_id = ?) AS inMonth
         FROM categories c JOIN budget_groups g ON g.id = c.group_id
        WHERE c.archived = 0
        ORDER BY inMonth DESC, g.sort_order, g.id, c.sort_order, c.id`
    )
    .all(monthId) as Array<Omit<ImportCategoryOption, 'inMonth'> & { inMonth: number }>;
  return rows.map((c) => ({ ...c, inMonth: !!c.inMonth }));
}

function monthById(db: Database.Database, monthId: number): BudgetMonth {
  const month = db.prepare(`SELECT * FROM budget_months WHERE id = ?`).get(monthId) as BudgetMonth | undefined;
  if (!month) throw new Error('That month is no longer in your budget.');
  return month;
}

/**
 * The upload as the review shows it: the month's pending batch (or null),
 * then every account in display order with its bank, files and rows (each
 * with its labels and effective values, recomputed now), the month's plan
 * with spending so far, and the categories the picker offers.
 */
export function getReview(db: Database.Database, monthId: number): ImportReview {
  const month = monthById(db, monthId);
  const batch = pendingBatch(db, monthId) ?? null;
  const assessed = batch ? assessBatch(db, batch, month) : [];
  const files = batch
    ? (db
        .prepare(
          `SELECT f.id, f.bank_account_id, f.filename, f.created_at AS createdAt,
                  (SELECT COUNT(*) FROM import_rows r WHERE r.file_id = f.id) AS rowCount
             FROM import_files f WHERE f.batch_id = ? ORDER BY f.id`
        )
        .all(batch.id) as Array<{ id: number; bank_account_id: number; filename: string; createdAt: string; rowCount: number }>)
    : [];
  const banks = new Map(listBanks(db).map((k) => [k.id, k]));
  return {
    month: { id: month.id, month: month.month },
    batch: batch ? { id: batch.id, status: 'pending', createdAt: batch.created_at } : null,
    accounts: listAccounts(db).map((account) => ({
      account,
      bank: account.bank_id === null ? null : banks.get(account.bank_id) ?? null,
      files: files
        .filter((f) => f.bank_account_id === account.id)
        .map(({ id, filename, rowCount, createdAt }) => ({ id, filename, rowCount, createdAt })),
      rows: assessed.filter((a) => a.row.bank_account_id === account.id).map(toRowRead),
    })),
    plan: planOf(db, monthId),
    categories: pickerOf(db, monthId),
  };
}

/* ---------- decisions ----------------------------------------------------- */

/**
 * Records your decisions on a row: its category, name, kind (spend or
 * transfer), tick, and the existing entry it is the same as. Each can be
 * cleared back to the default with null; a field left out is left alone.
 * Only while its batch is pending. A linked entry must exist and not be
 * accounted for already (imported, or matched to another row).
 */
export function updateRow(db: Database.Database, rowId: number, patch: ImportRowPatch): void {
  const row = db
    .prepare(`SELECT r.id, f.batch_id FROM import_rows r JOIN import_files f ON f.id = r.file_id WHERE r.id = ?`)
    .get(rowId) as { id: number; batch_id: number } | undefined;
  if (!row) throw new Error('That transaction is no longer in this upload.');
  assertPending(batchById(db, row.batch_id));

  const fields: Record<string, unknown> = {};
  if (patch.categoryId !== undefined) {
    if (patch.categoryId !== null && !db.prepare(`SELECT 1 FROM categories WHERE id = ?`).get(patch.categoryId)) {
      throw new Error('That category is no longer in your budget. Choose another.');
    }
    fields.category_id = patch.categoryId;
  }
  if (patch.name !== undefined) fields.name = patch.name === null ? null : cleanName(patch.name) || null;
  if (patch.kind !== undefined) {
    if (patch.kind !== null && patch.kind !== 'spend' && patch.kind !== 'transfer') {
      throw new Error('A transaction is either a spend or a transfer.');
    }
    fields.kind = patch.kind;
  }
  if (patch.included !== undefined) fields.included = patch.included === null ? null : patch.included ? 1 : 0;
  if (patch.linkedEntryId !== undefined) {
    if (patch.linkedEntryId !== null) assertLinkable(db, patch.linkedEntryId, rowId);
    fields.linked_entry_id = patch.linkedEntryId;
  }
  patchById(db, 'import_rows', rowId, fields);
}

function assertLinkable(db: Database.Database, entryId: number, rowId: number): void {
  const entry = db.prepare(`SELECT import_row_id FROM budget_item_actual_entries WHERE id = ?`).get(entryId) as
    | { import_row_id: number | null }
    | undefined;
  if (!entry) throw new Error('That entry is no longer in your budget.');
  const taken =
    (entry.import_row_id !== null && entry.import_row_id !== rowId) ||
    db
      .prepare(
        `SELECT 1 FROM import_rows o JOIN import_files f ON f.id = o.file_id
           JOIN import_batches b ON b.id = f.batch_id
          WHERE o.linked_entry_id = ? AND o.id <> ? AND b.status <> 'discarded'`
      )
      .get(entryId, rowId);
  if (taken) throw new Error('That entry is already matched to another transaction.');
}

/* ---------- confirm, history ---------------------------------------------- */

/** Entries a batch created: from its rows, except a row matched to an
 *  existing entry (that entry was yours before the import). */
const CREATED_ENTRIES_SQL = `
  SELECT e.id FROM budget_item_actual_entries e
    JOIN import_rows r ON r.id = e.import_row_id
    JOIN import_files f ON f.id = r.file_id
   WHERE f.batch_id = ? AND r.linked_entry_id IS NULL`;

/**
 * Imports a pending batch, in one transaction: every ticked row becomes an
 * entry on its category's plan line in the batch's month (a line the month
 * lacks is created at £0, on the category's usual account), named as
 * decided and pointing back at its row. A row matched to an existing entry
 * writes nothing, but marks that entry as its own, so a re-upload knows it
 * is in and the classifier learns from it. Refused when nothing is ticked or
 * matched.
 */
export function confirmBatch(db: Database.Database, batchId: number): ImportConfirmResult {
  const tx = db.transaction((): ImportConfirmResult => {
    const batch = batchById(db, batchId);
    assertPending(batch);
    const month = monthById(db, batch.budget_month_id);
    const assessed = assessBatch(db, batch, month);
    const ticked = assessed.filter((a) => a.assessment.included);
    const linked = assessed.filter((a) => a.row.linked_entry_id !== null);
    if (ticked.length === 0 && linked.length === 0) {
      throw new Error('Tick at least one transaction, or match one to an entry, before importing.');
    }

    const lineFor = new Map(
      (
        db.prepare(`SELECT id, category_id FROM budget_items WHERE budget_month_id = ?`).all(month.id) as Array<{
          id: number;
          category_id: number;
        }>
      ).map((l) => [l.category_id, l.id])
    );
    let linesCreated = 0;
    let totalCents = 0;
    const insertEntry = db.prepare(
      `INSERT INTO budget_item_actual_entries (budget_item_id, spent_on, amount_cents, name, note, import_row_id)
       VALUES (?, ?, ?, ?, NULL, ?)`
    );
    for (const a of ticked) {
      const categoryId = a.assessment.categoryId as number;
      let itemId = lineFor.get(categoryId);
      if (itemId === undefined) {
        itemId = addItemForCategory(db, { monthId: month.id, categoryId, planned_cents: 0 });
        lineFor.set(categoryId, itemId);
        linesCreated++;
      }
      insertEntry.run(itemId, a.row.spent_on, a.row.amount_cents, a.assessment.name, a.row.id);
      totalCents += a.row.amount_cents as number;
    }
    const claim = db.prepare(
      `UPDATE budget_item_actual_entries SET import_row_id = ? WHERE id = ? AND import_row_id IS NULL`
    );
    for (const a of linked) claim.run(a.row.id, a.row.linked_entry_id);
    db.prepare(`UPDATE import_batches SET status = 'imported', imported_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      batch.id
    );
    return { entries: ticked.length, totalCents, linked: linked.length, linesCreated };
  });
  return tx();
}

/** The month's imported batches, newest first: when, which files, and how
 *  many of the entries each created are still there. */
export function listImports(db: Database.Database, monthId: number): ImportHistoryRow[] {
  const batches = db
    .prepare(
      `SELECT id, imported_at FROM import_batches
        WHERE budget_month_id = ? AND status = 'imported' ORDER BY imported_at DESC, id DESC`
    )
    .all(monthId) as Array<{ id: number; imported_at: string }>;
  const filenames = db.prepare(`SELECT filename FROM import_files WHERE batch_id = ? ORDER BY id`);
  const entries = db.prepare(`SELECT COUNT(*) AS n FROM (${CREATED_ENTRIES_SQL})`);
  return batches.map((b) => ({
    id: b.id,
    importedAt: b.imported_at,
    filenames: (filenames.all(b.id) as Array<{ filename: string }>).map((f) => f.filename),
    entries: (entries.get(b.id) as { n: number }).n,
  }));
}

/* ---------- discard, undo ------------------------------------------------- */

/**
 * Throws a pending upload away: the batch is deleted with its files and
 * rows, rather than kept as 'discarded'. Nothing points at a pending
 * batch's rows (entries only do once it is imported), a discarded row is
 * neither training data nor evidence of an import, and keeping it would
 * only keep a copy of a bank statement nobody asked to keep.
 */
export function discardBatch(db: Database.Database, batchId: number): void {
  const batch = batchById(db, batchId);
  if (!batch) return;
  assertPending(batch);
  db.prepare(`DELETE FROM import_batches WHERE id = ?`).run(batchId);
}

/**
 * Undoes an import, in one transaction: deletes exactly the entries it
 * wrote (edited since or not), releases the entries its rows were matched
 * to, and returns the batch to pending with every decision kept. Plan lines
 * it created at £0 stay, like any line you added. Refused while the month
 * has another upload in progress, since a month has only one.
 */
export function undoImport(db: Database.Database, batchId: number): void {
  const tx = db.transaction(() => {
    const batch = batchById(db, batchId);
    if (!batch) throw new Error('That import is no longer there.');
    if (batch.status !== 'imported') throw new Error("That upload hasn't been imported, so there is nothing to undo.");
    if (pendingBatch(db, batch.budget_month_id)) {
      throw new Error('Finish or discard the upload in progress first.');
    }
    db.prepare(`DELETE FROM budget_item_actual_entries WHERE id IN (${CREATED_ENTRIES_SQL})`).run(batchId);
    db.prepare(
      `UPDATE budget_item_actual_entries SET import_row_id = NULL
        WHERE import_row_id IN (SELECT r.id FROM import_rows r JOIN import_files f ON f.id = r.file_id
                                 WHERE f.batch_id = ? AND r.linked_entry_id IS NOT NULL)`
    ).run(batchId);
    db.prepare(`UPDATE import_batches SET status = 'pending', imported_at = NULL WHERE id = ?`).run(batchId);
  });
  tx();
}
