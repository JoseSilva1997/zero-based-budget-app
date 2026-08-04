/* ============================================================
   Serves the app's accelerators to the Shortcuts section in Settings.
   The list comes straight from the menu definition, so what Settings
   documents is what the menu actually binds.
   ============================================================ */
import { ipcMain } from 'electron';
import { guard } from './envelope';
import { shortcutDocs } from '../menu';

export function registerShortcutIpc(): void {
  ipcMain.handle('shortcuts:list', () => guard(() => shortcutDocs()));
}
