/* ============================================================
   Global augmentation: the typed `window.api` surface exposed by
   `preload/index.ts`. Every method maps 1:1 to an IPC channel the
   renderer actually calls (see AUDIT.md §2). The preload layer unwraps
   the `{ data } | { error }` envelope, so these signatures return the
   inner shapes directly (and throw on `{ error }`).
   ============================================================ */

import type { AppState } from './types';

export interface HouseBudgetApi {
  /** channel: "budget:load" (synchronous). Returns null on a fresh DB. */
  loadBudget(): AppState | null;

  /** channel: "budget:save". Persists the whole blob. */
  saveBudget(state: AppState): Promise<{ ok: boolean }>;

  /** channel: "backup:create". Writes a dated backup file. */
  createBackup(state: AppState): Promise<{ path: string; savedAt: string }>;

  /** channel: "backup:restore". Restores from a backup file, returns the state. */
  restoreBackup(filePath: string): Promise<{ state: AppState }>;

  /** channel: "data:revealFolder". Opens the userData folder in the OS explorer. */
  revealDataFolder(): Promise<{ path: string }>;

  /** Preload utility (not IPC): resolves a picked File's absolute path. */
  pathForFile(file: File): string;
}

declare global {
  interface Window {
    api: HouseBudgetApi;
  }
}

export {};
