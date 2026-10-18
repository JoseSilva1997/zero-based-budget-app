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
import type { Bank, BankAccount } from '../../shared/types';
import { readStatement, hashText } from '../../main/import/pipeline';
import { getAccountById } from './accounts';
import { getBank, setAccountIdentifier } from './banks';

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
