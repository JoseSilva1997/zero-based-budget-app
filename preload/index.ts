/* ============================================================
   Preload - exposes 'window.api' via contextBridge.

   contextIsolation stays ON, nodeIntegration OFF. Every channel is async
   (via ipcRenderer.invoke); the "{ data } | { error }" envelope is unwrapped
   here (throw on an error envelope, else return the inner data). The surface is
   SQL-computed reads plus granular mutations: add mutations resolve to the
   newly-inserted row, while edit/delete/reorder resolve to "{ ok: true }".
   ============================================================ */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  IpcResult,
  BootstrapData,
  MonthTree,
  MonthTotals,
  FundingPlanRow,
  OverBudgetRow,
  TrendPoint,
  ReusableCandidate,
  IncomeRead,
  GroupRead,
  ItemRead,
  ActualRead,
  HouseholdMember,
  BankAccount,
  GroupKind,
  AutoBackupMode,
} from '../shared/types';

type Ok = { ok: true };

function unwrap<T>(res: IpcResult<T>): T {
  if (res && typeof res === 'object' && 'error' in res) {
    throw new Error((res as { error: string }).error);
  }
  return (res as { data: T }).data;
}

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, payload)) as IpcResult<T>;
  return unwrap(res);
}

const api = {
  /* ---------- reads (SQL-computed) ---------- */
  bootstrap: () => invoke<BootstrapData>('bootstrap:load'),
  getMonth: (monthId: number) => invoke<MonthTree | null>('month:get', { monthId }),
  monthTotals: (monthId: number) => invoke<MonthTotals>('month:totals', { monthId }),
  fundingPlan: (monthId: number) => invoke<FundingPlanRow[]>('month:fundingPlan', { monthId }),
  overBudget: (monthId: number) => invoke<OverBudgetRow[]>('month:overBudget', { monthId }),
  trends: () => invoke<TrendPoint[]>('trends:series'),
  reusableItems: (monthId: number, query: string) =>
    invoke<ReusableCandidate[]>('items:reusable', { monthId, query }),

  /* ---------- income ---------- */
  incomeAdd: (monthId: number, memberId: number) =>
    invoke<IncomeRead>('income:add', { monthId, memberId }),
  incomeUpdate: (id: number, patch: { label?: string; amount?: number; memberId?: number }) =>
    invoke<Ok>('income:update', { id, patch }),
  incomeRemove: (id: number) => invoke<Ok>('income:remove', { id }),

  /* ---------- groups ---------- */
  groupAdd: (monthId: number, name?: string) => invoke<GroupRead>('group:add', { monthId, name }),
  groupUpdate: (
    id: number,
    patch: { name?: string; collapsed?: boolean; isSavings?: boolean; kind?: GroupKind }
  ) => invoke<Ok>('group:update', { id, patch }),
  groupDelete: (id: number) => invoke<Ok>('group:delete', { id }),
  groupReorder: (monthId: number, id: number, targetId: number, after: boolean) =>
    invoke<Ok>('group:reorder', { monthId, id, targetId, after }),

  /* ---------- items ---------- */
  itemAdd: (groupId: number, fields: { name?: string; allocated?: number; account?: number | null }) =>
    invoke<ItemRead>('item:add', { groupId, ...fields }),
  itemUpdate: (
    id: number,
    patch: { name?: string; allocated?: number; account?: number | null }
  ) => invoke<Ok>('item:update', { id, patch }),
  itemDelete: (id: number) => invoke<Ok>('item:delete', { id }),
  itemReorder: (groupId: number, id: number, targetId: number) =>
    invoke<Ok>('item:reorder', { groupId, id, targetId }),

  /* ---------- actuals ---------- */
  actualAdd: (itemId: number, fields: { amount: number; note?: string; spent_on: string }) =>
    invoke<ActualRead>('actual:add', { itemId, ...fields }),
  actualUpdate: (
    id: number,
    patch: { amount?: number; note?: string; spent_on?: string }
  ) => invoke<Ok>('actual:update', { id, patch }),
  actualRemove: (id: number) => invoke<Ok>('actual:remove', { id }),

  /* ---------- months ---------- */
  monthCreate: (opts: { month: string; copyFrom?: number; copyIncome?: boolean }) =>
    invoke<{ id: number; month: string }>('month:create', opts),
  monthSetActive: (month: string) => invoke<Ok>('month:setActive', { month }),

  /* ---------- members ---------- */
  memberAdd: (fields: { name?: string; color?: string }) =>
    invoke<HouseholdMember>('member:add', fields),
  memberUpdate: (id: number, patch: { name?: string; color?: string }) =>
    invoke<Ok>('member:update', { id, patch }),
  memberRemove: (id: number) => invoke<Ok>('member:remove', { id }),

  /* ---------- accounts ---------- */
  accountAdd: (fields: { name?: string; kind?: string; owner?: number | null; color?: string }) =>
    invoke<BankAccount>('account:add', fields),
  accountUpdate: (
    id: number,
    patch: { name?: string; kind?: string; owner?: number | null; color?: string }
  ) => invoke<Ok>('account:update', { id, patch }),
  accountRemove: (id: number) => invoke<Ok>('account:remove', { id }),

  /* ---------- settings ---------- */
  settingsUpdate: (patch: { currency?: string; theme?: string; autoBackup?: AutoBackupMode }) =>
    invoke<Ok>('settings:update', { patch }),

  /* ---------- backup / data ---------- */
  createBackup: () => invoke<{ path: string; savedAt: string }>('backup:create'),
  restoreBackup: (filePath: string) => invoke<Ok>('backup:restore', filePath),
  revealDataFolder: () => invoke<{ path: string }>('data:revealFolder'),

  // Not an IPC channel - resolves a picked File's absolute path (replaces the
  // removed File.path), used by the restore flow.
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
};

export type HouseBudgetApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
