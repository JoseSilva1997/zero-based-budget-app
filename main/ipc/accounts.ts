/* ============================================================
   IPC: bank-account ("funding account") mutations. 'account:add' returns the
   new row. 'account:remove' nulls referencing items first, then deletes, all
   inside one transaction in the repository (budget_items.bank_account_id has
   no ON DELETE action, so the delete would otherwise fail).
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { guardAsync } from './envelope';
import { DEFAULT_COLOR, toKind } from '../../database/conversions';
import {
  insertAccount,
  updateAccount,
  deleteAccount,
  getAccountById,
  nextAccountSort,
} from '../../database/repositories/accounts';
import type { BankAccountKind } from '../../shared/types';

interface AccountPatch {
  name?: string;
  kind?: string;
  owner?: number | null; // owner member id, null = shared
  color?: string;
}

export function registerAccountIpc(): void {
  ipcMain.handle(
    'account:add',
    (_e, p: { name?: string; kind?: string; owner?: number | null; color?: string }) =>
      guardAsync(async () => {
        const db = getDb();
        const id = insertAccount(db, {
          name: p.name || 'New account',
          kind: toKind(p.kind || 'main'),
          owner_member_id: p.owner ?? null,
          color: p.color || DEFAULT_COLOR,
          sort_order: nextAccountSort(db),
        });
        return getAccountById(db, id);
      })
  );

  ipcMain.handle('account:update', (_e, p: { id: number; patch: AccountPatch }) =>
    guardAsync(async () => {
      const f: Partial<{
        name: string;
        kind: BankAccountKind;
        owner_member_id: number | null;
        color: string;
      }> = {};
      if (p.patch.name !== undefined) f.name = p.patch.name;
      if (p.patch.kind !== undefined) f.kind = toKind(p.patch.kind);
      if (p.patch.owner !== undefined) f.owner_member_id = p.patch.owner ?? null;
      if (p.patch.color !== undefined) f.color = p.patch.color;
      updateAccount(getDb(), p.id, f);
      return { ok: true };
    })
  );

  ipcMain.handle('account:remove', (_e, p: { id: number }) =>
    guardAsync(async () => {
      deleteAccount(getDb(), p.id);
      return { ok: true };
    })
  );
}
