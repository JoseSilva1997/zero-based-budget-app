/* ============================================================
   IPC: data:revealFolder - opens the userData folder in the OS explorer.
   ============================================================ */
import { ipcMain, shell } from 'electron';
import { userDataDir } from '../paths';
import { guardAsync } from './envelope';

export function registerDataIpc(): void {
  ipcMain.handle('data:revealFolder', () =>
    guardAsync(async () => {
      const dir = userDataDir();
      await shell.openPath(dir);
      return { path: dir };
    })
  );
}
