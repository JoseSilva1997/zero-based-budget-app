/* ============================================================
   App metadata for the renderer. The version comes from Electron rather
   than a literal, so Settings and the Help menu cannot disagree about
   which build this is.
   ============================================================ */
import { app, ipcMain } from 'electron';
import { guard } from './envelope';

export function registerAppIpc(): void {
  ipcMain.handle('app:version', () => guard(() => app.getVersion()));
}
