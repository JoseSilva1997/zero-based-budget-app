/* ============================================================
   IPC: month-level mutations - create (optionally deep-copying another
   month's plan) and set-active. Creation makes the new month active.
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { guardAsync } from './envelope';
import { insertMonth, copyMonth, setActiveMonth } from '../../database/repositories/months';

export function registerMonthIpc(): void {
  ipcMain.handle(
    'month:create',
    (_e, p: { month: string; copyFrom?: number; copyIncome?: boolean }) =>
      guardAsync(async () => {
        const db = getDb();
        const id =
          p.copyFrom != null
            ? copyMonth(db, p.copyFrom, p.month, { copyIncome: !!p.copyIncome })
            : insertMonth(db, p.month);
        setActiveMonth(db, p.month);
        return { id, month: p.month };
      })
  );

  ipcMain.handle('month:setActive', (_e, p: { month: string }) =>
    guardAsync(async () => {
      setActiveMonth(getDb(), p.month);
      return { ok: true };
    })
  );
}
