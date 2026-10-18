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
  ImportDuplicate,
  ImportPlanLine,
  ImportReview,
  ImportRowRead,
} from '../../shared/types';
import { readStatement, hashText } from '../../main/import/pipeline';
import { assessRow, type RowAssessment, type RowDecisions } from '../../main/import/labels';
import type { Prediction } from '../../main/import/classifier';
import { getAccountById, listAccounts } from './accounts';
import { getBank, listBanks, setAccountIdentifier } from './banks';

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
  return batchRows(db, batch.id).map((row) => {
    const prediction: Prediction | null = null;
    const duplicates: ImportDuplicate[] = [];
    const assessment = assessRow({
      monthKey: month.month,
      spentOn: row.spent_on,
      direction: row.direction,
      descriptorClean: row.descriptor_clean,
      parseError: row.parse_error,
      notCompleted: !!row.not_completed,
      alreadyImported: false,
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
