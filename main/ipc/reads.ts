/* ============================================================
   IPC: all SQL-computed reads. 'bootstrap:load' is the startup hydrate;
   the rest are per-view fetches the renderer issues on demand.
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { guardAsync } from './envelope';
import { loadBootstrap } from '../../database/repositories/bootstrap';
import {
  getMonthTree,
  monthTotals,
  fundingPlan,
  overBudgetItems,
  trendSeries,
  reusableItemCandidates,
} from '../../database/repositories/months';

export function registerReadIpc(): void {
  ipcMain.handle('bootstrap:load', () => guardAsync(async () => loadBootstrap(getDb())));

  ipcMain.handle('month:get', (_e, p: { monthId: number }) =>
    guardAsync(async () => getMonthTree(getDb(), p.monthId))
  );

  ipcMain.handle('month:totals', (_e, p: { monthId: number }) =>
    guardAsync(async () => monthTotals(getDb(), p.monthId))
  );

  ipcMain.handle('month:fundingPlan', (_e, p: { monthId: number }) =>
    guardAsync(async () => fundingPlan(getDb(), p.monthId))
  );

  ipcMain.handle('month:overBudget', (_e, p: { monthId: number }) =>
    guardAsync(async () => overBudgetItems(getDb(), p.monthId))
  );

  ipcMain.handle('trends:series', () => guardAsync(async () => trendSeries(getDb())));

  ipcMain.handle('items:reusable', (_e, p: { monthId: number; query?: string }) =>
    guardAsync(async () => reusableItemCandidates(getDb(), p.monthId, p.query || ''))
  );
}
