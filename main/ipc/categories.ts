/* ============================================================
   IPC: categories, as Settings manages them. 'category:list' is every
   category with its usage; 'category:setArchived' hides one from pickers and
   new months (history kept). Merging is staged like a restore:
   'category:previewMerge' reports what would move and writes nothing, then
   'category:merge' backs the database up and merges. That backup is the only
   undo, so its file name is returned for the renderer to name.
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { backupNow } from '../cloudBackup';
import { guardAsync } from './envelope';
import {
  listCategories,
  setCategoryArchived,
  previewMerge,
  mergeCategories,
} from '../../database/repositories/categories';
import type { CategoryRead, MergeResult } from '../../shared/types';

export function registerCategoryIpc(): void {
  ipcMain.handle('category:list', () =>
    guardAsync(async (): Promise<CategoryRead[]> => listCategories(getDb()))
  );

  ipcMain.handle('category:setArchived', (_e, p: { id: number; archived: boolean }) =>
    guardAsync(async () => {
      setCategoryArchived(getDb(), p.id, !!p.archived);
      return { ok: true };
    })
  );

  ipcMain.handle('category:previewMerge', (_e, p: { fromId: number; intoId: number }) =>
    guardAsync(async () => previewMerge(getDb(), p.fromId, p.intoId))
  );

  ipcMain.handle('category:merge', (_e, p: { fromId: number; intoId: number }) =>
    guardAsync(async (): Promise<MergeResult> => {
      const db = getDb();
      // Refuse before backing up, so a merge that cannot happen leaves no file.
      previewMerge(db, p.fromId, p.intoId);
      const { info } = await backupNow(db);
      return { ...mergeCategories(db, p.fromId, p.intoId), backup: info.fileName };
    })
  );
}
