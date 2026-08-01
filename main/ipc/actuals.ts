/* ============================================================
   IPC: actual-entry mutations. 'actual:add' returns the new row; update/remove
   are optimistic. 'spent_on' arrives pre-formatted as "YYYY-MM-DD".
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { guardAsync } from './envelope';
import { dollarsToCents } from '../../database/conversions';
import {
  insertActualEntry,
  updateActual,
  removeActual,
  getActualById,
} from '../../database/repositories/months';

interface ActualPatch {
  amount?: number; // dollars
  name?: string;
  note?: string;
  spent_on?: string; // "YYYY-MM-DD"
}

export function registerActualIpc(): void {
  ipcMain.handle(
    'actual:add',
    (_e, p: { itemId: number; amount: number; name?: string; note?: string; spent_on: string }) =>
      guardAsync(async () => {
        const db = getDb();
        const id = insertActualEntry(db, {
          budget_item_id: p.itemId,
          spent_on: p.spent_on,
          amount_cents: dollarsToCents(p.amount),
          name: p.name ? p.name : null,
          note: p.note ? p.note : null,
        });
        return getActualById(db, id);
      })
  );

  ipcMain.handle('actual:update', (_e, p: { id: number; patch: ActualPatch }) =>
    guardAsync(async () => {
      const f: Record<string, unknown> = {};
      if (p.patch.amount !== undefined) f.amount_cents = dollarsToCents(p.patch.amount);
      if (p.patch.name !== undefined) f.name = p.patch.name ? p.patch.name : null;
      if (p.patch.note !== undefined) f.note = p.patch.note ? p.patch.note : null;
      if (p.patch.spent_on !== undefined) f.spent_on = p.patch.spent_on;
      updateActual(getDb(), p.id, f);
      return { ok: true };
    })
  );

  ipcMain.handle('actual:remove', (_e, p: { id: number }) =>
    guardAsync(async () => {
      removeActual(getDb(), p.id);
      return { ok: true };
    })
  );
}
