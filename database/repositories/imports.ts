/* ============================================================
   imports: "Upload transactions". Statements are staged in a month's
   pending batch (import_batches -> import_files -> import_rows) until you
   confirm, which writes the ticked rows as ordinary entries in one
   transaction. Only the parsed rows, your decisions and, once confirmed,
   which unticked rows taught the classifier are stored;
   predictions and labels are recomputed on every read of the review,
   because they depend on everything else in the database.

   A month has at most one pending batch, and any number of imported ones,
   each of which can be undone back to pending.

   Money in is matched to the purchase it refunds (main/import/refunds.ts):
   an entry already in the budget, or a debit row of the same upload. A
   refund of a purchase in the upload's month is written as a negative entry
   on that purchase's line, so the month's sums net it; of an earlier
   month's, or with no purchase at all, as a money-back income line in the
   upload's month, to be given a job like any money that arrives.
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
  ImportRefundOf,
  ImportRefundPurchase,
  ImportRowPatch,
  ImportRowRead,
} from '../../shared/types';
import { readStatement, hashText } from '../../main/import/pipeline';
import { getPreset } from '../../main/import/presets';
import { assessRow, type RowAssessment, type RowDecisions } from '../../main/import/labels';
import { train, type Classifier, type Prediction, type TrainingExample } from '../../main/import/classifier';
import { rankPurchases, REFUND_WINDOW_DAYS, type Purchase } from '../../main/import/refunds';
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

/**
 * Forgets an account's identifier when no statement still in the database
 * names it. addFile records it from the first statement, so if that one was
 * the wrong account's and is taken back (removed, or its upload discarded),
 * keeping it would refuse every right statement from then on.
 */
function forgetUnbackedIdentifier(db: Database.Database, accountId: number): void {
  const account = getAccountById(db, accountId) as BankAccount | undefined;
  if (!account || !account.account_identifier || account.bank_id === null) return;
  const bank = getBank(db, account.bank_id) as Bank | undefined;
  const preset = bank ? getPreset(bank.preset) : undefined;
  if (!preset) return;
  const files = db.prepare(`SELECT id FROM import_files WHERE bank_account_id = ?`).all(accountId) as Array<{ id: number }>;
  const rawOf = db.prepare(`SELECT raw FROM import_rows WHERE file_id = ? ORDER BY row_index`);
  const backed = files.some((f) => {
    const records = (rawOf.all(f.id) as Array<{ raw: string }>).map((r) => JSON.parse(r.raw));
    return preset.fileAccountIdentifier(records) === account.account_identifier;
  });
  if (!backed) setAccountIdentifier(db, accountId, null);
}

/** Removes a file, and its rows, from a pending batch. */
export function removeFile(db: Database.Database, fileId: number): void {
  const file = db.prepare(`SELECT batch_id, bank_account_id FROM import_files WHERE id = ?`).get(fileId) as
    | { batch_id: number; bank_account_id: number }
    | undefined;
  if (!file) return;
  assertPending(batchById(db, file.batch_id));
  db.transaction(() => {
    db.prepare(`DELETE FROM import_files WHERE id = ?`).run(fileId);
    forgetUnbackedIdentifier(db, file.bank_account_id);
  })();
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
  note: string | null;
  teaches: 0 | 1;
  refund_of_entry_id: number | null;
  refund_of_row_id: number | null;
  refund_none: 0 | 1;
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
        WHERE e.amount_cents = @amount AND e.kind = 'spend'
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
          OR EXISTS (SELECT 1 FROM budget_incomes i WHERE i.import_row_id = o.id)
          OR (b.status = 'imported' AND o.linked_entry_id IS NOT NULL))
   LIMIT 1`;

/**
 * The classifier, trained now on every row outside this batch whose answer
 * is known: (a) a row an entry points back at (written from it, or matched
 * to it at confirm), labelled with that entry's category as it is today, so
 * a merge or a move is followed, unless that category is archived (retired:
 * the picker doesn't offer it, so nothing should be predicted into it);
 * (b) a row you marked a transfer, in an imported batch; (c) a row that
 * taught without being imported (unticked, with a category you picked),
 * labelled with that category, unless it is archived.
 */
function trainFor(db: Database.Database, batchId: number): Classifier {
  const rows = db
    .prepare(
      `SELECT r.descriptor_clean, r.features, f.bank_account_id, r.amount_cents, it.category_id AS label
         FROM import_rows r
         JOIN import_files f ON f.id = r.file_id
         JOIN budget_item_actual_entries e ON e.import_row_id = r.id
         JOIN budget_items it ON it.id = e.budget_item_id
         JOIN categories c ON c.id = it.category_id
        WHERE f.batch_id <> @batchId AND c.archived = 0 AND e.kind = 'spend'
       UNION ALL
       SELECT r.descriptor_clean, r.features, f.bank_account_id, r.amount_cents, 'transfer' AS label
         FROM import_rows r
         JOIN import_files f ON f.id = r.file_id
         JOIN import_batches b ON b.id = f.batch_id
        WHERE f.batch_id <> @batchId AND b.status = 'imported' AND r.kind = 'transfer'
       UNION ALL
       SELECT r.descriptor_clean, r.features, f.bank_account_id, r.amount_cents, r.category_id AS label
         FROM import_rows r
         JOIN import_files f ON f.id = r.file_id
         JOIN import_batches b ON b.id = f.batch_id
         JOIN categories c ON c.id = r.category_id
        WHERE f.batch_id <> @batchId AND b.status = 'imported' AND r.teaches = 1 AND c.archived = 0`
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
  /** Money in: the purchase it refunds, and whether that was only suggested. */
  refund: { purchase: ImportRefundPurchase; suggested: boolean } | null;
  refundCandidates: ImportRefundPurchase[];
}

/** An entry as a purchase money in may refund, with what is left of it
 *  after the refunds already written against it. */
const PURCHASE_ENTRY_SQL = `
  SELECT e.id, e.spent_on AS spentOn, e.amount_cents AS amountCents, e.name, r.descriptor_clean AS descriptor,
         c.id AS categoryId, c.name AS categoryName, m.month AS month,
         e.amount_cents
           + COALESCE((SELECT SUM(x.amount_cents) FROM budget_item_actual_entries x WHERE x.refund_of_entry_id = e.id), 0)
           - COALESCE((SELECT SUM(i.amount_cents) FROM budget_incomes i WHERE i.refund_of_entry_id = e.id), 0)
           AS remainingCents
    FROM budget_item_actual_entries e
    JOIN budget_items it ON it.id = e.budget_item_id
    JOIN categories c ON c.id = it.category_id
    JOIN budget_months m ON m.id = it.budget_month_id
    LEFT JOIN import_rows r ON r.id = e.import_row_id
    LEFT JOIN import_files f ON f.id = r.file_id
   WHERE e.kind = 'spend'`;

interface PurchaseEntryRow {
  id: number;
  spentOn: string;
  amountCents: number;
  name: string | null;
  descriptor: string | null;
  categoryId: number;
  categoryName: string;
  month: string;
  remainingCents: number;
}

type RankedPurchase = Purchase & { read: ImportRefundPurchase };

function entryPurchase(e: PurchaseEntryRow, monthKey: string): RankedPurchase {
  const read: ImportRefundPurchase = {
    ref: { kind: 'entry', id: e.id },
    spentOn: e.spentOn,
    amountCents: e.amountCents,
    remainingCents: e.remainingCents,
    name: e.name || e.descriptor || 'Unnamed',
    categoryId: e.categoryId,
    categoryName: e.categoryName,
    month: e.month,
    sameMonth: e.month === monthKey,
  };
  return { ref: read.ref, spentOn: e.spentOn, amountCents: e.amountCents, remainingCents: e.remainingCents,
    names: [e.name || '', e.descriptor || ''].filter(Boolean), read };
}

/** How many candidates the review offers for a refund. */
const REFUND_CHOICES = 5;

/** Every row of a batch with its prediction, duplicates, labels and
 *  effective values: what the review shows and what confirming writes.
 *  Debit rows first, since money in may refund one of them: a refund of a
 *  row that isn't being imported can't be ticked. */
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
  // Two overlapping statements in one upload hold the same rows: the copy in
  // the later file is already in, through the earlier one.
  const earlier = new Set<string>();
  const facts = batchRows(db, batch.id).map((row) => {
    const inEarlierFile = row.fingerprint !== null && earlier.has(row.fingerprint);
    const alreadyImported = inEarlierFile || (row.fingerprint !== null && !!imported.get(row.fingerprint, batch.id));
    if (row.fingerprint !== null) earlier.add(row.fingerprint);
    const prediction = classifier.predict({
      descriptorClean: row.descriptor_clean,
      features: JSON.parse(row.features || '{}'),
      accountId: row.bank_account_id,
      amountCents: row.amount_cents,
    });
    return { row, prediction, alreadyImported, duplicates: duplicatesOf(db, row) };
  });
  const assess = (f: (typeof facts)[number], refundTarget?: 'same_month' | 'earlier_month' | 'skipped' | null) =>
    assessRow({
      monthKey: month.month,
      spentOn: f.row.spent_on,
      direction: f.row.direction,
      descriptorClean: f.row.descriptor_clean,
      parseError: f.row.parse_error,
      notCompleted: !!f.row.not_completed,
      alreadyImported: f.alreadyImported,
      duplicates: f.duplicates.length,
      prediction: f.prediction,
      inMonth: (id) => planned.has(id),
      stored: decisionsOf(f.row),
      refundTarget,
    });

  const out = new Map<number, AssessedRow>();
  for (const f of facts) {
    if (f.row.direction === 'credit') continue;
    out.set(f.row.id, { ...f, assessment: assess(f), refund: null, refundCandidates: [] });
  }

  // Rows of this upload that will be written as entries: purchases a refund
  // may be of.
  const categoryName = new Map(
    (db.prepare(`SELECT id, name FROM categories`).all() as Array<{ id: number; name: string }>).map((c) => [c.id, c.name])
  );
  const rowPurchase = (a: AssessedRow): RankedPurchase => {
    const read: ImportRefundPurchase = {
      ref: { kind: 'row', id: a.row.id },
      spentOn: a.row.spent_on as string,
      amountCents: a.row.amount_cents as number,
      remainingCents: a.row.amount_cents as number,
      name: a.assessment.name,
      categoryId: a.assessment.categoryId,
      categoryName: a.assessment.categoryId === null ? null : categoryName.get(a.assessment.categoryId) ?? null,
      month: month.month,
      sameMonth: true,
    };
    return { ref: read.ref, spentOn: read.spentOn, amountCents: read.amountCents, remainingCents: read.remainingCents,
      names: [a.assessment.name, a.row.descriptor_clean], read };
  };
  const writtenRows = [...out.values()].filter((a) => a.assessment.included && a.assessment.writesAs === 'entry');
  const entryById = db.prepare(`${PURCHASE_ENTRY_SQL} AND e.id = ?`);
  const entriesNear = db.prepare(
    `${PURCHASE_ENTRY_SQL}
       AND e.spent_on BETWEEN date(@on, '-${REFUND_WINDOW_DAYS} days') AND @on
       AND e.amount_cents >= @amount
       AND (f.bank_account_id = @account
            OR (e.import_row_id IS NULL AND (it.bank_account_id = @account OR it.bank_account_id IS NULL)))`
  );

  // What refunds in this upload have taken of each purchase so far. Choices
  // you made take their share first, so a suggestion never crowds one out.
  const taken = new Map<string, number>();
  const key = (p: ImportRefundPurchase) => `${p.ref.kind}:${p.ref.id}`;
  const withTaken = (p: RankedPurchase): RankedPurchase => {
    const remaining = p.remainingCents - (taken.get(key(p.read)) ?? 0);
    return { ...p, remainingCents: remaining, read: { ...p.read, remainingCents: remaining } };
  };

  const credits = facts.filter((f) => f.row.direction === 'credit');
  const chosen = (f: (typeof facts)[number]) =>
    f.row.refund_of_entry_id !== null || f.row.refund_of_row_id !== null || f.row.refund_none === 1;
  for (const f of [...credits.filter(chosen), ...credits.filter((c) => !chosen(c))]) {
    const r = f.row;
    let target: 'same_month' | 'earlier_month' | 'skipped' | null = null;
    let refund: AssessedRow['refund'] = null;
    let candidates: RankedPurchase[] = [];
    const readable = !r.parse_error && r.spent_on !== null && r.amount_cents !== null;
    if (readable) {
      const fromEntries = (
        entriesNear.all({ on: r.spent_on, amount: r.amount_cents, account: r.bank_account_id }) as PurchaseEntryRow[]
      ).map((e) => entryPurchase(e, month.month));
      const fromRows = writtenRows.filter((a) => a.row.bank_account_id === r.bank_account_id).map(rowPurchase);
      candidates = rankPurchases(
        { spentOn: r.spent_on as string, amountCents: r.amount_cents as number, descriptor: r.descriptor_clean },
        [...fromEntries, ...fromRows].map(withTaken)
      );
    }
    let purchase: RankedPurchase | null = null;
    if (r.refund_none === 1) {
      purchase = null;
    } else if (r.refund_of_entry_id !== null) {
      const e = entryById.get(r.refund_of_entry_id) as PurchaseEntryRow | undefined;
      purchase = e ? withTaken(entryPurchase(e, month.month)) : null;
    } else if (r.refund_of_row_id !== null) {
      const a = out.get(r.refund_of_row_id);
      if (a && a.row.linked_entry_id !== null) {
        // Matched to an entry you typed: the purchase is that entry.
        const e = entryById.get(a.row.linked_entry_id) as PurchaseEntryRow | undefined;
        purchase = e ? withTaken(entryPurchase(e, month.month)) : null;
      } else if (a && a.assessment.included && a.assessment.writesAs === 'entry') {
        purchase = withTaken(rowPurchase(a));
      } else if (a) {
        target = 'skipped';
        refund = { purchase: rowPurchase(a).read, suggested: false };
      }
    } else if (readable) {
      purchase = candidates[0] ?? null;
    }
    if (purchase) {
      target = purchase.read.sameMonth ? 'same_month' : 'earlier_month';
      refund = { purchase: purchase.read, suggested: !chosen(f) };
    }
    const assessment = assess(f, target);
    if (assessment.writesAs === 'refund' && refund) assessment.categoryId = refund.purchase.categoryId;
    if (assessment.included && purchase) taken.set(key(purchase.read), (taken.get(key(purchase.read)) ?? 0) + (r.amount_cents as number));
    const offered = candidates.slice(0, REFUND_CHOICES).map((c) => c.read);
    if (refund && !offered.some((c) => key(c) === key(refund!.purchase))) offered.unshift(refund.purchase);
    out.set(r.id, { ...f, assessment, refund, refundCandidates: offered });
  }
  return facts.map((f) => out.get(f.row.id) as AssessedRow);
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
    teaches: a.assessment.teaches,
    prediction: a.prediction,
    labels: a.assessment.labels,
    duplicates: a.duplicates,
    writesAs: a.assessment.writesAs,
    refund: a.refund,
    refundCandidates: a.refundCandidates,
    decisions: {
      categoryId: r.category_id,
      name: r.name,
      kind: r.kind,
      included: r.included === null ? null : r.included === 1,
      linkedEntryId: r.linked_entry_id,
      note: r.note,
      refundOf: refundOfDecision(r),
    },
  };
}

function refundOfDecision(r: StoredRow): ImportRefundOf {
  if (r.refund_none === 1) return 'none';
  if (r.refund_of_entry_id !== null) return { entryId: r.refund_of_entry_id };
  if (r.refund_of_row_id !== null) return { rowId: r.refund_of_row_id };
  return null;
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
 * transfer), tick, the existing entry it is the same as, and the note its
 * entry is written with (trimmed; blank is none). Each can be
 * cleared back to the default with null; a field left out is left alone.
 * Only while its batch is pending. A linked entry must exist and not be
 * accounted for already (imported, or matched to another row).
 */
/** How many purchases "Refund of…" lists when you search. */
const REFUND_OPTIONS = 30;

/** Every purchase money in could be chosen as a refund of, whatever the
 *  shop and whichever card: the review only suggests purchases from the same
 *  shop on the same card, but cashback or a friend paying you back can be of
 *  anything. A purchase is a spend in the budget, or a debit row of this
 *  upload being imported, made up to REFUND_WINDOW_DAYS before the money came
 *  in, with at least its amount not yet refunded (counting what other money
 *  in this upload takes of it). Newest first; `query` keeps those whose
 *  name, bank descriptor or category holds it, ignoring case. */
export function refundOptions(db: Database.Database, rowId: number, query: string): ImportRefundPurchase[] {
  const row = db
    .prepare(`SELECT r.*, f.batch_id, f.bank_account_id FROM import_rows r JOIN import_files f ON f.id = r.file_id WHERE r.id = ?`)
    .get(rowId) as (StoredRow & { batch_id: number }) | undefined;
  if (!row) throw new Error('That transaction is no longer in this upload.');
  const batch = batchById(db, row.batch_id);
  assertPending(batch);
  if (row.direction !== 'credit') throw new Error('Only money in can be a refund.');
  if (row.spent_on === null || row.amount_cents === null) return [];
  const month = monthById(db, batch.budget_month_id);
  const assessed = assessBatch(db, batch, month);

  const key = (p: ImportRefundPurchase) => `${p.ref.kind}:${p.ref.id}`;
  const taken = new Map<string, number>();
  for (const a of assessed) {
    if (a.row.id === rowId || !a.refund || !a.assessment.included) continue;
    if (a.assessment.writesAs !== 'refund' && a.assessment.writesAs !== 'money_back') continue;
    const k = key(a.refund.purchase);
    taken.set(k, (taken.get(k) ?? 0) + (a.row.amount_cents as number));
  }

  const entries = (
    db
      .prepare(
        `${PURCHASE_ENTRY_SQL}
           AND e.spent_on BETWEEN date(@on, '-${REFUND_WINDOW_DAYS} days') AND @on`
      )
      .all({ on: row.spent_on }) as PurchaseEntryRow[]
  ).map((e) => ({ read: entryPurchase(e, month.month).read, words: [e.name, e.descriptor, e.categoryName] }));
  const categoryName = new Map(
    (db.prepare(`SELECT id, name FROM categories`).all() as Array<{ id: number; name: string }>).map((c) => [c.id, c.name])
  );
  const fromRows = assessed
    .filter((a) => a.assessment.included && a.assessment.writesAs === 'entry' && a.row.spent_on !== null)
    .filter((a) => (a.row.spent_on as string) <= (row.spent_on as string))
    .map((a) => {
      const cat = a.assessment.categoryId === null ? null : categoryName.get(a.assessment.categoryId) ?? null;
      const read: ImportRefundPurchase = {
        ref: { kind: 'row', id: a.row.id },
        spentOn: a.row.spent_on as string,
        amountCents: a.row.amount_cents as number,
        remainingCents: a.row.amount_cents as number,
        name: a.assessment.name,
        categoryId: a.assessment.categoryId,
        categoryName: cat,
        month: month.month,
        sameMonth: true,
      };
      return { read, words: [a.assessment.name, a.row.descriptor_clean, cat] };
    });

  const needle = query.trim().toLowerCase();
  return [...entries, ...fromRows]
    .map((o) => {
      const remainingCents = o.read.remainingCents - (taken.get(key(o.read)) ?? 0);
      return { ...o, read: { ...o.read, remainingCents } };
    })
    .filter((o) => o.read.remainingCents >= (row.amount_cents as number))
    .filter((o) => !needle || o.words.some((w) => !!w && w.toLowerCase().includes(needle)))
    .sort((a, b) => b.read.spentOn.localeCompare(a.read.spentOn) || b.read.ref.id - a.read.ref.id)
    .slice(0, REFUND_OPTIONS)
    .map((o) => o.read);
}

export function updateRow(db: Database.Database, rowId: number, patch: ImportRowPatch): void {
  const row = db
    .prepare(
      `SELECT r.id, r.direction, f.batch_id FROM import_rows r JOIN import_files f ON f.id = r.file_id WHERE r.id = ?`
    )
    .get(rowId) as { id: number; direction: 'debit' | 'credit' | null; batch_id: number } | undefined;
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
  if (patch.note !== undefined) fields.note = patch.note === null ? null : patch.note.trim() || null;
  if (patch.included !== undefined) fields.included = patch.included === null ? null : patch.included ? 1 : 0;
  if (patch.linkedEntryId !== undefined) {
    if (patch.linkedEntryId !== null) assertLinkable(db, patch.linkedEntryId, rowId);
    fields.linked_entry_id = patch.linkedEntryId;
  }
  if (patch.refundOf !== undefined) {
    if (row.direction !== 'credit') throw new Error('Only money in can be a refund.');
    Object.assign(fields, refundFields(db, patch.refundOf, row.batch_id));
  }
  patchById(db, 'import_rows', rowId, fields);
}

/** The columns that record which purchase money in refunds. A purchase is
 *  a spend already in the budget, or a debit row of the same upload. */
function refundFields(db: Database.Database, refundOf: ImportRefundOf, batchId: number): Record<string, unknown> {
  const none = { refund_of_entry_id: null, refund_of_row_id: null, refund_none: 0 };
  if (refundOf === null) return none;
  if (refundOf === 'none') return { ...none, refund_none: 1 };
  if ('entryId' in refundOf) {
    const e = db.prepare(`SELECT kind FROM budget_item_actual_entries WHERE id = ?`).get(refundOf.entryId) as
      | { kind: string }
      | undefined;
    if (!e) throw new Error('That purchase is no longer in your budget.');
    if (e.kind !== 'spend') throw new Error('A refund is of a purchase, not of another refund.');
    return { ...none, refund_of_entry_id: refundOf.entryId };
  }
  const r = db
    .prepare(`SELECT r.direction, f.batch_id FROM import_rows r JOIN import_files f ON f.id = r.file_id WHERE r.id = ?`)
    .get(refundOf.rowId) as { direction: string | null; batch_id: number } | undefined;
  if (!r || r.batch_id !== batchId) throw new Error('That purchase is no longer in this upload.');
  if (r.direction !== 'debit') throw new Error('A refund is of a purchase, not of other money in.');
  return { ...none, refund_of_row_id: refundOf.rowId };
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

/** Money-back income lines a batch created. */
const CREATED_INCOMES_SQL = `
  SELECT i.id FROM budget_incomes i
    JOIN import_rows r ON r.id = i.import_row_id
    JOIN import_files f ON f.id = r.file_id
   WHERE f.batch_id = ?`;

/** Who money back belongs to: the account's owner, or (a joint account)
 *  the first member. You can change it on the income line afterwards. */
function moneyBackMember(db: Database.Database, accountId: number): number {
  const owner = db.prepare(`SELECT owner_member_id AS id FROM bank_accounts WHERE id = ?`).get(accountId) as
    | { id: number | null }
    | undefined;
  if (owner && owner.id !== null) return owner.id;
  const first = db.prepare(`SELECT id FROM household_members ORDER BY sort_order, id LIMIT 1`).get() as
    | { id: number }
    | undefined;
  if (!first) throw new Error('Add a household member in Settings first: money back is income, and income belongs to someone.');
  return first.id;
}

/**
 * Imports a pending batch, in one transaction: every ticked spend becomes an
 * entry on its category's plan line in the batch's month (a line the month
 * lacks is created at £0, on the category's usual account), named and
 * noted as decided and pointing back at its row. A row matched to an existing entry
 * writes nothing, but marks that entry as its own, so a re-upload knows it
 * is in and the classifier learns from it. An unticked row whose category
 * you picked writes nothing either, but is marked as teaching, so the
 * classifier learns its category.
 *
 * Ticked money in is written after the spends, since it may refund one: a
 * refund of a purchase in this month as a negative entry on the purchase's
 * line, anything else as a money-back income line in this month. Both
 * point at their row, and at the purchase if there is one.
 *
 * Refused when nothing is ticked, matched or teaching.
 */
export function confirmBatch(db: Database.Database, batchId: number): ImportConfirmResult {
  const tx = db.transaction((): ImportConfirmResult => {
    const batch = batchById(db, batchId);
    assertPending(batch);
    const month = monthById(db, batch.budget_month_id);
    const assessed = assessBatch(db, batch, month);
    const ticked = assessed.filter((a) => a.assessment.included);
    const spends = ticked.filter((a) => a.assessment.writesAs === 'entry');
    const moneyIn = ticked.filter((a) => a.assessment.writesAs === 'refund' || a.assessment.writesAs === 'money_back');
    const linked = assessed.filter((a) => a.row.linked_entry_id !== null);
    const teaching = assessed.filter((a) => a.assessment.teaches);
    if (ticked.length === 0 && linked.length === 0 && teaching.length === 0) {
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
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const entryOfRow = new Map<number, number>();
    for (const a of spends) {
      const categoryId = a.assessment.categoryId as number;
      let itemId = lineFor.get(categoryId);
      if (itemId === undefined) {
        itemId = addItemForCategory(db, { monthId: month.id, categoryId, planned_cents: 0 });
        lineFor.set(categoryId, itemId);
        linesCreated++;
      }
      const info = insertEntry.run(itemId, a.row.spent_on, a.row.amount_cents, a.assessment.name, a.row.note, a.row.id);
      entryOfRow.set(a.row.id, Number(info.lastInsertRowid));
      totalCents += a.row.amount_cents as number;
    }
    const claim = db.prepare(
      `UPDATE budget_item_actual_entries SET import_row_id = ? WHERE id = ? AND import_row_id IS NULL`
    );
    for (const a of linked) claim.run(a.row.id, a.row.linked_entry_id);

    const insertRefund = db.prepare(
      `INSERT INTO budget_item_actual_entries
         (budget_item_id, spent_on, amount_cents, name, note, import_row_id, kind, refund_of_entry_id)
       SELECT budget_item_id, ?, ?, ?, ?, ?, 'refund', id FROM budget_item_actual_entries WHERE id = ?`
    );
    const insertMoneyBack = db.prepare(
      `INSERT INTO budget_incomes
         (budget_month_id, household_member_id, label, amount_cents, sort_order, kind, import_row_id, refund_of_entry_id)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM budget_incomes WHERE budget_month_id = ?),
               'money_back', ?, ?)`
    );
    let refunds = 0, refundCents = 0, moneyBack = 0, moneyBackCents = 0;
    for (const a of moneyIn) {
      const amount = a.row.amount_cents as number;
      const ref = a.refund?.purchase.ref ?? null;
      const purchaseEntry = ref === null ? null : ref.kind === 'entry' ? ref.id : entryOfRow.get(ref.id) ?? null;
      if (a.assessment.writesAs === 'refund' && purchaseEntry !== null) {
        insertRefund.run(a.row.spent_on, -amount, a.assessment.name, a.row.note, a.row.id, purchaseEntry);
        refunds++;
        refundCents += amount;
      } else {
        const member = moneyBackMember(db, a.row.bank_account_id);
        insertMoneyBack.run(month.id, member, a.assessment.name, amount, month.id, a.row.id, purchaseEntry);
        moneyBack++;
        moneyBackCents += amount;
      }
    }

    const teach = db.prepare(`UPDATE import_rows SET teaches = 1 WHERE id = ?`);
    for (const a of teaching) teach.run(a.row.id);
    db.prepare(`UPDATE import_batches SET status = 'imported', imported_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      batch.id
    );
    return {
      entries: spends.length,
      totalCents,
      linked: linked.length,
      linesCreated,
      learnt: teaching.length,
      refunds,
      refundCents,
      moneyBack,
      moneyBackCents,
    };
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
  const entries = db.prepare(
    `SELECT (SELECT COUNT(*) FROM (${CREATED_ENTRIES_SQL}))
          + (SELECT COUNT(*) FROM (${CREATED_INCOMES_SQL})) AS n`
  );
  return batches.map((b) => ({
    id: b.id,
    importedAt: b.imported_at,
    filenames: (filenames.all(b.id) as Array<{ filename: string }>).map((f) => f.filename),
    entries: (entries.get(b.id, b.id) as { n: number }).n,
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
  db.transaction(() => {
    const accounts = db
      .prepare(`SELECT DISTINCT bank_account_id AS id FROM import_files WHERE batch_id = ?`)
      .all(batchId) as Array<{ id: number }>;
    db.prepare(`DELETE FROM import_batches WHERE id = ?`).run(batchId);
    for (const a of accounts) forgetUnbackedIdentifier(db, a.id);
  })();
}

/**
 * Undoes an import, in one transaction: deletes exactly the entries and
 * money-back lines it wrote (edited since or not), releases the entries its rows were matched
 * to, forgets what its unticked rows taught, and returns the batch to
 * pending with every decision kept. Plan lines
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
    db.prepare(`DELETE FROM budget_incomes WHERE id IN (${CREATED_INCOMES_SQL})`).run(batchId);
    db.prepare(`DELETE FROM budget_item_actual_entries WHERE id IN (${CREATED_ENTRIES_SQL})`).run(batchId);
    db.prepare(
      `UPDATE budget_item_actual_entries SET import_row_id = NULL
        WHERE import_row_id IN (SELECT r.id FROM import_rows r JOIN import_files f ON f.id = r.file_id
                                 WHERE f.batch_id = ? AND r.linked_entry_id IS NOT NULL)`
    ).run(batchId);
    db.prepare(
      `UPDATE import_rows SET teaches = 0 WHERE file_id IN (SELECT id FROM import_files WHERE batch_id = ?)`
    ).run(batchId);
    db.prepare(`UPDATE import_batches SET status = 'pending', imported_at = NULL WHERE id = ?`).run(batchId);
  });
  tx();
}
