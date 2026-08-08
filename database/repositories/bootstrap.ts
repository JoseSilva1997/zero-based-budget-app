/* ============================================================
   Startup hydrate.

   The SQLite database is the single source of truth. On launch the renderer
   issues 'bootstrap:load', which returns blob-level settings plus members,
   accounts (as rows with integer ids), the month-key list, and the resolved
   active month. Each month's tree is fetched separately via 'getMonthTree'.
   ============================================================ */
import type Database from 'better-sqlite3';
import type { AutoBackupMode, BootstrapData } from '../../shared/types';
import { getMeta } from './meta';
import { listMembers } from './members';
import { listAccounts } from './accounts';
import { listMonths } from './months';

/**
 * Lightweight startup read. A DB with no months is simply an empty app, so the
 * active month resolves to null and the renderer shows its empty state.
 */
export function loadBootstrap(db: Database.Database): BootstrapData {
  const monthList = listMonths(db);
  const monthKeys = monthList.map((m) => m.month);
  const activeMeta = getMeta(db, 'activeMonth');
  const activeMonth =
    activeMeta && monthKeys.includes(activeMeta)
      ? activeMeta
      : monthKeys[monthKeys.length - 1] || null;

  return {
    settings: {
      currency: getMeta(db, 'currency') || '$',
      // Passed through raw. Every id this app has ever persisted is a theme
      // that no longer ships (the pre-reset backgrounds, and the combined
      // background+accent ids before those), so validating here would mean
      // teaching the main process the theme registry for no gain: the renderer
      // already falls back to DEFAULT_THEME_ID for anything it does not know.
      theme: getMeta(db, 'theme') || '',
      autoBackup: (getMeta(db, 'autoBackup') as AutoBackupMode) || 'onclose',
      lastBackup: getMeta(db, 'lastBackup'),
      members: listMembers(db),
      accounts: listAccounts(db),
    },
    monthList,
    activeMonth,
  };
}
