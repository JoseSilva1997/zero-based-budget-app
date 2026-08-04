/* ============================================================
   IPC: updater:* - lets the renderer observe and drive the auto-updater.

   Status changes arrive unprompted on the 'updater:status' push channel.
   These three handlers cover what the renderer has to pull instead: the
   status it missed while mounting, a user-initiated check, and the
   restart-and-install action.
   ============================================================ */
import { ipcMain } from 'electron';
import { guard, guardAsync } from './envelope';
import { getUpdateStatus, checkForUpdates, installUpdate } from '../updater';

export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:status:get', () => guard(() => getUpdateStatus()));

  ipcMain.handle('updater:check', () => guardAsync(() => checkForUpdates()));

  // Resolves before the app has actually quit: the renderer only needs to
  // know the request was accepted, and installUpdate() is a no-op unless an
  // update is genuinely downloaded.
  ipcMain.handle('updater:install', () =>
    guard(() => {
      installUpdate();
      return { ok: true as const };
    })
  );
}