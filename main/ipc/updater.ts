/* ============================================================
   IPC: updater:* - lets the renderer observe and drive the auto-updater.

   Status changes arrive unprompted on the 'updater:status' push channel.
   These four handlers cover what the renderer has to pull instead: the
   status it missed while mounting, a user-initiated check, the download the
   user has to opt into, and the restart-and-install action.
   ============================================================ */
import { ipcMain } from 'electron';
import { guard, guardAsync } from './envelope';
import { getUpdateStatus, checkForUpdates, downloadUpdate, installUpdate } from '../updater';

export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:status:get', () => guard(() => getUpdateStatus()));

  ipcMain.handle('updater:check', () => guardAsync(() => checkForUpdates()));

  // Resolves once the download settles, which can be a while; the banner
  // follows the pushed progress events rather than waiting on this.
  ipcMain.handle('updater:download', () => guardAsync(() => downloadUpdate()));

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