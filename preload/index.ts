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
  MonthDeleteResult,
  FundingPlanRow,
  OverBudgetRow,
  TrendPoint,
  ReusableCandidate,
  EntrySuggestion,
  IncomeRead,
  GroupRead,
  ItemRead,
  CategoryRead,
  MergeImpact,
  Bank,
  BankPreset,
  ImportAddOutcome,
  ImportAddedFile,
  ImportConfirmResult,
  ImportHistoryRow,
  ImportReview,
  ImportRowPatch,
  MergeResult,
  ActualRead,
  HouseholdMember,
  BankAccount,
  GroupKind,
  AutoBackupMode,
  CloudCopyResult,
  CloudStatus,
  ListedBackup,
  RestorePreview,
  UpdateStatus,
  ShortcutDoc,
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
  entrySuggestions: (monthId: number, query: string) =>
    invoke<EntrySuggestion[]>('actuals:suggestions', { monthId, query }),
  shortcuts: () => invoke<ShortcutDoc[]>('shortcuts:list'),
  appVersion: () => invoke<string>('app:version'),

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
  groupDelete: (id: number, monthId: number) => invoke<Ok>('group:delete', { id, monthId }),
  groupReorder: (monthId: number, id: number, targetId: number, after: boolean) =>
    invoke<Ok>('group:reorder', { monthId, id, targetId, after }),

  /* ---------- items ---------- */
  itemAdd: (
    monthId: number,
    groupId: number,
    fields: { categoryId?: number | null; name?: string; allocated?: number; account?: number | null }
  ) => invoke<ItemRead>('item:add', { monthId, groupId, ...fields }),
  itemUpdate: (
    id: number,
    patch: { name?: string; allocated?: number; account?: number | null }
  ) => invoke<Ok>('item:update', { id, patch }),
  itemDelete: (id: number) => invoke<Ok>('item:delete', { id }),
  itemReorder: (groupId: number, id: number, targetId: number) =>
    invoke<Ok>('item:reorder', { groupId, id, targetId }),
  itemMove: (id: number, toGroupId: number, targetId: number | null) =>
    invoke<Ok>('item:move', { id, toGroupId, targetId }),

  /* ---------- categories ----------
     What an item is FOR, the same in every month. Merging is previewed first
     (writes nothing), and the merge itself backs up before it writes. */
  categories: () => invoke<CategoryRead[]>('category:list'),
  categorySetArchived: (id: number, archived: boolean) =>
    invoke<Ok>('category:setArchived', { id, archived }),
  categoryPreviewMerge: (fromId: number, intoId: number) =>
    invoke<MergeImpact>('category:previewMerge', { fromId, intoId }),
  categoryMerge: (fromId: number, intoId: number) =>
    invoke<MergeResult>('category:merge', { fromId, intoId }),

  /* ---------- upload transactions ----------
     Channels documented in main/ipc/imports.ts. Money is pence, dates
     "YYYY-MM-DD". After any change, read importReview again: predictions and
     labels are recomputed on the main side. */
  importReview: (monthId: number) => invoke<ImportReview>('import:review', { monthId }),
  /** Resolves to { status: 'needs_bank', ... } rather than throwing when the
   *  account's bank must be set up first: an Error's extra fields don't
   *  survive the context bridge, so the refusal's code is read here. */
  importAddFile: async (p: {
    monthId: number;
    accountId: number;
    filename: string;
    text: string;
  }): Promise<ImportAddOutcome> => {
    const res = (await ipcRenderer.invoke('import:addFile', p)) as IpcResult<ImportAddedFile>;
    if ('error' in res && res.code === 'needs_bank') {
      const detail = res.detail as { preset: BankPreset | null; products: string[] | null };
      return { status: 'needs_bank', message: res.error, preset: detail.preset, products: detail.products };
    }
    return { status: 'added', file: unwrap(res) };
  },
  importRemoveFile: (fileId: number) => invoke<Ok>('import:removeFile', { fileId }),
  importUpdateRow: (rowId: number, patch: ImportRowPatch) =>
    invoke<Ok>('import:updateRow', { rowId, patch }),
  importConfirm: (batchId: number) => invoke<ImportConfirmResult>('import:confirm', { batchId }),
  importDiscard: (batchId: number) => invoke<Ok>('import:discard', { batchId }),
  importHistory: (monthId: number) => invoke<ImportHistoryRow[]>('import:history', { monthId }),
  importUndo: (batchId: number) => invoke<Ok>('import:undo', { batchId }),

  /* ---------- banks ---------- */
  banks: () => invoke<Bank[]>('bank:list'),
  bankCreate: (name: string, preset: BankPreset) => invoke<Bank>('bank:create', { name, preset }),
  bankRename: (id: number, name: string) => invoke<Ok>('bank:rename', { id, name }),
  accountSetBank: (accountId: number, bankId: number | null, product: string | null) =>
    invoke<Ok>('account:setBank', { accountId, bankId, product }),

  /* ---------- actuals ---------- */
  actualAdd: (
    itemId: number,
    fields: { amount: number; name?: string; note?: string; spent_on: string }
  ) => invoke<ActualRead>('actual:add', { itemId, ...fields }),
  actualUpdate: (
    id: number,
    patch: { amount?: number; name?: string; note?: string; spent_on?: string }
  ) => invoke<Ok>('actual:update', { id, patch }),
  actualRemove: (id: number) => invoke<Ok>('actual:remove', { id }),

  /* ---------- months ---------- */
  monthCreate: (opts: { month: string; copyFrom?: number; copyIncome?: boolean }) =>
    invoke<{ id: number; month: string }>('month:create', opts),
  monthDelete: (id: number) => invoke<MonthDeleteResult>('month:delete', { id }),
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
  settingsUpdate: (patch: {
    currency?: string;
    theme?: string;
    autoBackup?: AutoBackupMode;
    sidebarCollapsed?: boolean;
  }) =>
    invoke<Ok>('settings:update', { patch }),

  /* ---------- backup / data ---------- */
  createBackup: () =>
    invoke<{ path: string; savedAt: string; cloud: CloudCopyResult }>('backup:create'),
  listBackups: () => invoke<ListedBackup[]>('backup:list'),
  previewBackup: (filePath: string) => invoke<RestorePreview>('backup:preview', filePath),
  restoreBackup: (filePath: string) =>
    invoke<{ ok: true; safetyCopy: string; savedAt: string }>('backup:restore', filePath),
  revealDataFolder: () => invoke<{ path: string }>('data:revealFolder'),
  cloudStatus: () => invoke<CloudStatus>('cloud:status'),
  /** Opens the folder picker; resolves to null when it is cancelled. */
  cloudChoose: () => invoke<CloudStatus | null>('cloud:choose'),
  cloudDisconnect: () => invoke<CloudStatus>('cloud:disconnect'),

  /* ---------- application menu ----------
     Menu items post a command here rather than acting in the main process,
     because the renderer owns the state they change. Returns an unsubscribe. */
  onMenuCommand: (handler: (command: string) => void): (() => void) => {
    const listener = (_e: unknown, command: string) => handler(command);
    ipcRenderer.on('menu:command', listener);
    return () => { ipcRenderer.off('menu:command', listener); };
  },
  
  /* ---------- updates ----------
      Status is pushed from the main process as it changes. The renderer also
      pulls the current one on mount, because the first check can settle before
      React has subscribed. */
  updateStatus: () => invoke<UpdateStatus>('updater:status:get'),
  updateCheck: () => invoke<UpdateStatus>('updater:check'),
  updateDownload: () => invoke<UpdateStatus>('updater:download'),
  updateInstall: () => invoke<Ok>('updater:install'),
  onUpdateStatus: (handler: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: unknown, status: UpdateStatus) => handler(status);
    ipcRenderer.on('updater:status', listener);
    return () => { ipcRenderer.off('updater:status', listener); };
  },

  /* ---------- dev tools ----------
     Only registered in the main process when the app is unpackaged, so in a
     shipped build these two reject rather than doing anything. The renderer's
     only caller (renderer/DebugMenu.jsx) is compiled out of production
     bundles, so that never happens in practice. `extraW`/`extraH` are how much
     of .main is currently hidden by its own overflow; main grows the window by
     that much before capturing, then restores it. */
  debugScreenshot: (size: { extraW: number; extraH: number }) =>
    invoke<{ path: string }>('debug:screenshot', size),
  debugReveal: (filePath: string) => invoke<Ok>('debug:reveal', { path: filePath }),

  // Not an IPC channel - resolves a picked File's absolute path (replaces the
  // removed File.path), used by the restore flow.
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
};

export type HouseBudgetApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
