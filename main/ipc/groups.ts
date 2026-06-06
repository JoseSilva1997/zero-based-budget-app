/* ============================================================
   IPC: group mutations. 'group:add' returns the new row; the rest are
   optimistic. 'group:update' folds rename, toggle-collapse, and set-savings.
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { guardAsync } from './envelope';
import {
  insertGroup,
  updateGroup,
  deleteGroup,
  reorderGroups,
  getGroupById,
  nextGroupSort,
} from '../../database/repositories/months';
import type { GroupKind } from '../../shared/types';

interface GroupPatch {
  name?: string;
  collapsed?: boolean;
  isSavings?: boolean;
  kind?: GroupKind;
}

export function registerGroupIpc(): void {
  ipcMain.handle('group:add', (_e, p: { monthId: number; name?: string }) =>
    guardAsync(async () => {
      const db = getDb();
      const id = insertGroup(db, {
        budget_month_id: p.monthId,
        name: p.name || 'New group',
        kind: 'spend',
        collapsed: 0,
        sort_order: nextGroupSort(db, p.monthId),
      });
      return getGroupById(db, id);
    })
  );

  ipcMain.handle('group:update', (_e, p: { id: number; patch: GroupPatch }) =>
    guardAsync(async () => {
      const f: Record<string, unknown> = {};
      if (p.patch.name !== undefined) f.name = p.patch.name;
      if (p.patch.collapsed !== undefined) f.collapsed = p.patch.collapsed ? 1 : 0;
      if (p.patch.kind !== undefined) f.kind = p.patch.kind;
      else if (p.patch.isSavings !== undefined) f.kind = p.patch.isSavings ? 'savings' : 'spend';
      updateGroup(getDb(), p.id, f);
      return { ok: true };
    })
  );

  ipcMain.handle('group:delete', (_e, p: { id: number }) =>
    guardAsync(async () => {
      deleteGroup(getDb(), p.id);
      return { ok: true };
    })
  );

  ipcMain.handle(
    'group:reorder',
    (_e, p: { monthId: number; id: number; targetId: number; after: boolean }) =>
      guardAsync(async () => {
        reorderGroups(getDb(), p.monthId, p.id, p.targetId, p.after);
        return { ok: true };
      })
  );
}
