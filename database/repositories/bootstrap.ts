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
 * Themes and accent colours used to be one combined value (e.g. "sunset" was
 * a background + an accent, baked together). Pre-existing installs only ever
 * wrote 'theme'; this maps each old id to its nearest (theme, accentColor)
 * pair under the new 4-background x 6-accent split, so a legacy DB with no
 * 'accentColor' meta row still resolves to a sensible look on first load.
 */
const LEGACY_THEME_MAP: Record<string, [string, string]> = {
  indigo: ['slate', 'indigo'],
  violet: ['slate', 'indigo'],
  cyan: ['slate', 'cyan'],
  emerald: ['slate', 'emerald'],
  mono: ['obsidian', 'indigo'],
  lime: ['obsidian', 'lime'],
  amber: ['obsidian', 'amber'],
  rose: ['charcoal', 'rose'],
  sky: ['charcoal', 'indigo'],
  ocean: ['navy', 'indigo'],
  teal: ['navy', 'cyan'],
  sunset: ['slate', 'amber'],
};

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

  const storedTheme = getMeta(db, 'theme');
  const storedAccent = getMeta(db, 'accentColor');
  const legacyPair = !storedAccent && storedTheme ? LEGACY_THEME_MAP[storedTheme] : undefined;
  const theme = legacyPair ? legacyPair[0] : storedTheme || 'slate';
  const accentColor = storedAccent || (legacyPair ? legacyPair[1] : 'indigo');

  return {
    settings: {
      currency: getMeta(db, 'currency') || '$',
      theme,
      accentColor,
      autoBackup: (getMeta(db, 'autoBackup') as AutoBackupMode) || 'onclose',
      lastBackup: getMeta(db, 'lastBackup'),
      members: listMembers(db),
      accounts: listAccounts(db),
    },
    monthList,
    activeMonth,
  };
}
