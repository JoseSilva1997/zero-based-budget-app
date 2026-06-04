/* ============================================================
   Registers every IPC handler. Called once from main/index.ts BEFORE the
   BrowserWindow is created.
   ============================================================ */
import { registerBudgetIpc } from './budget';
import { registerBackupIpc } from './backup';
import { registerDataIpc } from './data';

export function registerIpcHandlers(): void {
  registerBudgetIpc();
  registerBackupIpc();
  registerDataIpc();
}
