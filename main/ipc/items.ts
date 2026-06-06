/* ============================================================
   IPC: item mutations. 'item:add' returns the new row; the rest are
   optimistic. 'item:update' folds rename, set-allocated, and set-account.
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { guardAsync } from './envelope';
import { dollarsToCents } from '../../database/conversions';
import {
  insertItem,
  updateItem,
  deleteItem,
  reorderItems,
  getItemById,
  nextItemSort,
} from '../../database/repositories/months';

interface ItemPatch {
  name?: string;
  allocated?: number; // dollars
  account?: number | null; // bank_account id
}

export function registerItemIpc(): void {
  ipcMain.handle(
    'item:add',
    (_e, p: { groupId: number; name?: string; allocated?: number; account?: number | null }) =>
      guardAsync(async () => {
        const db = getDb();
        const id = insertItem(db, {
          budget_group_id: p.groupId,
          name: p.name || 'New item',
          planned_cents: dollarsToCents(p.allocated || 0),
          bank_account_id: p.account ?? null,
          sort_order: nextItemSort(db, p.groupId),
        });
        return getItemById(db, id);
      })
  );

  ipcMain.handle('item:update', (_e, p: { id: number; patch: ItemPatch }) =>
    guardAsync(async () => {
      const f: Record<string, unknown> = {};
      if (p.patch.name !== undefined) f.name = p.patch.name;
      if (p.patch.allocated !== undefined) f.planned_cents = dollarsToCents(p.patch.allocated);
      if (p.patch.account !== undefined) f.bank_account_id = p.patch.account ?? null;
      updateItem(getDb(), p.id, f);
      return { ok: true };
    })
  );

  ipcMain.handle('item:delete', (_e, p: { id: number }) =>
    guardAsync(async () => {
      deleteItem(getDb(), p.id);
      return { ok: true };
    })
  );

  ipcMain.handle('item:reorder', (_e, p: { groupId: number; id: number; targetId: number }) =>
    guardAsync(async () => {
      reorderItems(getDb(), p.groupId, p.id, p.targetId);
      return { ok: true };
    })
  );
}
