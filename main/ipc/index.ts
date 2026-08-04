/* ============================================================
   Registers every IPC handler. Called once from main/index.ts BEFORE the
   BrowserWindow is created.
   ============================================================ */
import { registerReadIpc } from './reads';
import { registerIncomeIpc } from './income';
import { registerGroupIpc } from './groups';
import { registerItemIpc } from './items';
import { registerActualIpc } from './actuals';
import { registerMonthIpc } from './months';
import { registerMemberIpc } from './members';
import { registerAccountIpc } from './accounts';
import { registerSettingsIpc } from './settings';
import { registerBackupIpc } from './backup';
import { registerDataIpc } from './data';
import { registerUpdaterIpc } from './updater';

export function registerIpcHandlers(): void {
  registerReadIpc();
  registerIncomeIpc();
  registerGroupIpc();
  registerItemIpc();
  registerActualIpc();
  registerMonthIpc();
  registerMemberIpc();
  registerAccountIpc();
  registerSettingsIpc();
  registerBackupIpc();
  registerDataIpc();
  registerUpdaterIpc();
}
