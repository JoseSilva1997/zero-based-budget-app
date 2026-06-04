/* ============================================================
   Preload — exposes `window.api` via contextBridge.
   contextIsolation stays ON, nodeIntegration OFF. The renderer only ever
   sees these five methods. The `{ data } | { error }` envelope is unwrapped
   here: on `{ error }` we throw; otherwise we return the inner `data`.
   ============================================================ */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppState, IpcResult } from '../shared/types';

function unwrap<T>(res: IpcResult<T>): T {
  if (res && typeof res === 'object' && 'error' in res) {
    throw new Error((res as { error: string }).error);
  }
  return (res as { data: T }).data;
}

const api = {
  // Synchronous so the renderer's sync useReducer initialiser is unchanged.
  loadBudget(): AppState | null {
    const res = ipcRenderer.sendSync('budget:load') as IpcResult<AppState | null>;
    return unwrap(res);
  },

  async saveBudget(state: AppState): Promise<{ ok: boolean }> {
    const res = (await ipcRenderer.invoke('budget:save', state)) as IpcResult<{ ok: boolean }>;
    return unwrap(res);
  },

  async createBackup(state: AppState): Promise<{ path: string; savedAt: string }> {
    const res = (await ipcRenderer.invoke('backup:create', state)) as IpcResult<{
      path: string;
      savedAt: string;
    }>;
    return unwrap(res);
  },

  async restoreBackup(filePath: string): Promise<{ state: AppState }> {
    const res = (await ipcRenderer.invoke('backup:restore', filePath)) as IpcResult<{
      state: AppState;
    }>;
    return unwrap(res);
  },

  async revealDataFolder(): Promise<{ path: string }> {
    const res = (await ipcRenderer.invoke('data:revealFolder')) as IpcResult<{ path: string }>;
    return unwrap(res);
  },

  // Not an IPC channel — the supported way to resolve a picked File's absolute
  // path (replaces the removed File.path), used by the restore flow.
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
};

contextBridge.exposeInMainWorld('api', api);
