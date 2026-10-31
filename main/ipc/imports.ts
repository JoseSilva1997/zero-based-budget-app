/* ============================================================
   IPC: "Upload transactions", and the banks it needs. Every channel answers
   with the usual envelope ({ data } | { error }; see envelope.ts); the
   preload unwraps it. Money is integer PENCE and dates "YYYY-MM-DD" here,
   unlike the budget blob. Types are in shared/types.ts.

   The review is recomputed on every read (classifier, labels, duplicates),
   so after any mutation the renderer reads 'import:review' again rather
   than patching its copy.

   UPLOAD
   'import:review'      { monthId }
                        -> ImportReview: the month's pending batch (or
                           null), every account in display order with its
                           bank, files and rows, the month's plan lines
                           with spending so far, and the picker's
                           categories (this month's first).
   'import:addFile'     { monthId, accountId, filename, text }
                        -> ImportAddedFile { id, batchId, accountId,
                           filename, rowCount }. 'text' is the dropped
                           file's File.text(). Starts the month's pending
                           batch if there is none. Refusals, as copy:
                           "That file is already in this upload.",
                           "This doesn't look like a {bank} statement.",
                           "This is the statement for ••1234, not {account}.",
                           "That file has no transactions in it."
                           An account with no bank yet (or a Revolut one
                           whose product isn't chosen, for a file with
                           several) is refused with
                             { error, code: 'needs_bank',
                               detail: { preset: BankPreset | null,
                                         products: string[] | null } }
                           preset: the bank the file looks like (null: none
                           we read); products: Revolut's, to pick the
                           account's. Set the bank up with the bank channels
                           below, then send the same payload again. (The
                           preload turns this into a resolved
                           { status: 'needs_bank', ... }; see
                           ImportAddOutcome.)
   'import:removeFile'  { fileId } -> { ok: true }. Its rows go with it.
   'import:updateRow'   { rowId, patch: ImportRowPatch }
                        -> { ok: true }. patch: any of categoryId, name,
                           kind ('spend' | 'transfer'), included (boolean),
                           linkedEntryId ("Same as existing entry"),
                           note (written on the entry), refundOf (money
                           in only: { entryId } | { rowId } | 'none'); null
                           clears one back to the default, a key left out
                           is unchanged. Pending batches only. An entry
                           already matched to another row, or imported, is
                           refused.

   CONFIRM AND AFTER
   'import:confirm'     { batchId } -> ImportConfirmResult { entries,
                           totalCents, linked, linesCreated, learnt,
                           refunds, refundCents, moneyBack, moneyBackCents }.
                           Writes every effectively ticked spend as an entry
                           in one transaction, creating a missing plan line
                           at £0; then ticked money in, as a refund (a
                           negative entry on its purchase's line, this
                           month) or money back (an income line).
                           Refused when nothing is ticked or matched.
   'import:discard'     { batchId } -> { ok: true }. Deletes a pending batch
                           with its files, rows and decisions.
   'import:history'     { monthId } -> ImportHistoryRow[] { id, importedAt,
                           filenames, entries }: the month's imported
                           batches, newest first ("Previous imports").
   'import:undo'        { batchId } -> { ok: true }. Deletes the entries and
                           money-back lines the import wrote (edited or not), releases matched
                           entries, and returns the batch to pending with
                           its decisions. Refused while the month has
                           another upload in progress: "Finish or discard
                           the upload in progress first."

   BANKS
   'bank:list'          -> Bank[], by name.
   'bank:create'        { name, preset } -> Bank. A name in use, a blank
                           one or an unknown preset is refused.
   'bank:rename'        { id, name } -> { ok: true }.
   'account:setBank'    { accountId, bankId: number | null,
                          product: string | null } -> { ok: true }. product
                           is the Revolut product ('Current'), else null.
                           Changing bank forgets the account's identifier.
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { guardAsync } from './envelope';
import {
  addFile,
  confirmBatch,
  discardBatch,
  getReview,
  listImports,
  removeFile,
  undoImport,
  updateRow,
  type NewFile,
} from '../../database/repositories/imports';
import {
  createBank,
  getBank,
  listBanks,
  renameBank,
  setAccountBank,
} from '../../database/repositories/banks';
import type {
  Bank,
  BankPreset,
  ImportAddedFile,
  ImportConfirmResult,
  ImportHistoryRow,
  ImportReview,
  ImportRowPatch,
} from '../../shared/types';

const OK = { ok: true } as const;

export function registerImportIpc(): void {
  /* ---------- upload ---------- */
  ipcMain.handle('import:review', (_e, p: { monthId: number }) =>
    guardAsync(async (): Promise<ImportReview> => getReview(getDb(), p.monthId))
  );

  ipcMain.handle('import:addFile', (_e, p: NewFile) =>
    guardAsync(async (): Promise<ImportAddedFile> =>
      addFile(getDb(), {
        monthId: p.monthId,
        accountId: p.accountId,
        filename: String(p.filename ?? ''),
        text: String(p.text ?? ''),
      })
    )
  );

  ipcMain.handle('import:removeFile', (_e, p: { fileId: number }) =>
    guardAsync(async () => {
      removeFile(getDb(), p.fileId);
      return OK;
    })
  );

  ipcMain.handle('import:updateRow', (_e, p: { rowId: number; patch: ImportRowPatch }) =>
    guardAsync(async () => {
      updateRow(getDb(), p.rowId, p.patch ?? {});
      return OK;
    })
  );

  /* ---------- confirm and after ---------- */
  ipcMain.handle('import:confirm', (_e, p: { batchId: number }) =>
    guardAsync(async (): Promise<ImportConfirmResult> => confirmBatch(getDb(), p.batchId))
  );

  ipcMain.handle('import:discard', (_e, p: { batchId: number }) =>
    guardAsync(async () => {
      discardBatch(getDb(), p.batchId);
      return OK;
    })
  );

  ipcMain.handle('import:history', (_e, p: { monthId: number }) =>
    guardAsync(async (): Promise<ImportHistoryRow[]> => listImports(getDb(), p.monthId))
  );

  ipcMain.handle('import:undo', (_e, p: { batchId: number }) =>
    guardAsync(async () => {
      undoImport(getDb(), p.batchId);
      return OK;
    })
  );

  /* ---------- banks ---------- */
  ipcMain.handle('bank:list', () => guardAsync(async (): Promise<Bank[]> => listBanks(getDb())));

  ipcMain.handle('bank:create', (_e, p: { name: string; preset: BankPreset }) =>
    guardAsync(async (): Promise<Bank> => {
      const db = getDb();
      return getBank(db, createBank(db, { name: p.name, preset: p.preset })) as Bank;
    })
  );

  ipcMain.handle('bank:rename', (_e, p: { id: number; name: string }) =>
    guardAsync(async () => {
      renameBank(getDb(), p.id, p.name);
      return OK;
    })
  );

  ipcMain.handle(
    'account:setBank',
    (_e, p: { accountId: number; bankId: number | null; product: string | null }) =>
      guardAsync(async () => {
        setAccountBank(getDb(), p.accountId, p.bankId ?? null, p.product ?? null);
        return OK;
      })
  );
}
