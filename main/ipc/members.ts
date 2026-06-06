/* ============================================================
   IPC: household-member mutations. 'member:add' returns the new row.
   'member:remove' throws (FK RESTRICT) if the member still has incomes; the
   envelope surfaces that to the renderer as an error.
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { guardAsync } from './envelope';
import { DEFAULT_COLOR } from '../../database/conversions';
import {
  insertMember,
  updateMember,
  deleteMember,
  getMemberById,
  nextMemberSort,
} from '../../database/repositories/members';

interface MemberPatch {
  name?: string;
  color?: string;
}

export function registerMemberIpc(): void {
  ipcMain.handle('member:add', (_e, p: { name?: string; color?: string }) =>
    guardAsync(async () => {
      const db = getDb();
      const id = insertMember(db, {
        name: p.name || 'New member',
        color: p.color || DEFAULT_COLOR,
        sort_order: nextMemberSort(db),
      });
      return getMemberById(db, id);
    })
  );

  ipcMain.handle('member:update', (_e, p: { id: number; patch: MemberPatch }) =>
    guardAsync(async () => {
      updateMember(getDb(), p.id, {
        name: p.patch.name,
        color: p.patch.color,
      });
      return { ok: true };
    })
  );

  ipcMain.handle('member:remove', (_e, p: { id: number }) =>
    guardAsync(async () => {
      deleteMember(getDb(), p.id);
      return { ok: true };
    })
  );
}
