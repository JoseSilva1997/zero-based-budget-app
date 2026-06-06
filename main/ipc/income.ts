/* ============================================================
   IPC: income mutations. 'income:add' awaits the insert and returns the new
   row; update/remove are fire-and-forget (the renderer is optimistic).
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { guardAsync } from './envelope';
import { dollarsToCents } from '../../database/conversions';
import {
  insertIncome,
  updateIncome,
  removeIncome,
  getIncomeById,
  nextIncomeSort,
} from '../../database/repositories/months';

interface IncomePatch {
  label?: string;
  amount?: number; // dollars
  memberId?: number;
}

export function registerIncomeIpc(): void {
  ipcMain.handle('income:add', (_e, p: { monthId: number; memberId: number }) =>
    guardAsync(async () => {
      const db = getDb();
      const id = insertIncome(db, {
        budget_month_id: p.monthId,
        household_member_id: p.memberId,
        label: 'Income',
        amount_cents: 0,
        sort_order: nextIncomeSort(db, p.monthId),
      });
      return getIncomeById(db, id);
    })
  );

  ipcMain.handle('income:update', (_e, p: { id: number; patch: IncomePatch }) =>
    guardAsync(async () => {
      const f: Record<string, unknown> = {};
      if (p.patch.label !== undefined) f.label = p.patch.label;
      if (p.patch.amount !== undefined) f.amount_cents = dollarsToCents(p.patch.amount);
      if (p.patch.memberId !== undefined) f.household_member_id = Number(p.patch.memberId);
      updateIncome(getDb(), p.id, f);
      return { ok: true };
    })
  );

  ipcMain.handle('income:remove', (_e, p: { id: number }) =>
    guardAsync(async () => {
      removeIncome(getDb(), p.id);
      return { ok: true };
    })
  );
}
