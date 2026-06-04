/* ============================================================
   IPC: budget:load (sync) and budget:save (async).
   ============================================================ */
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { loadAppState, saveAppState } from '../../database/repositories/appState';
import { ok, fail, guard } from './envelope';
import type { AppState } from '../../shared/types';

export function registerBudgetIpc(): void {
  // Synchronous: the renderer reads this in its useReducer initialiser.
  ipcMain.on('budget:load', (event) => {
    try {
      event.returnValue = ok(loadAppState(getDb()));
    } catch (err) {
      event.returnValue = fail(err);
    }
  });

  ipcMain.handle('budget:save', (_event, state: AppState) =>
    guard(() => {
      saveAppState(getDb(), state);
      return { ok: true };
    })
  );
}
