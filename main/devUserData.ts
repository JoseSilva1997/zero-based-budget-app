/* ============================================================
   Dev data folder: keeps unpackaged launches off the real database.

   `npm start` and `npm run dev` run the same app name as the installed
   release, so by default they open its userData folder. A branch with a newer
   schema then migrates the real database, and the installed release refuses
   to open it. Unpackaged launches therefore get their own folder,
   "House Budget Dev", beside the installed app's, the way staging builds get
   "House Budget Staging" from their productName (.github/workflows/staging.yml).

   Left alone:
   - packaged builds (release and staging), which already have their own folder;
   - an explicit --user-data-dir (the screenshot skill's sandbox);
   - HB_REAL_DATA=1, to open the real data on purpose.
   The test suite sets its own userData path and never loads index.ts.
   ============================================================ */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export const DEV_APP_NAME = 'House Budget Dev';

/** Where an unpackaged launch keeps its data, or null to keep Electron's
 *  default userData. Pure, so the decision can be tested without touching
 *  the real appData folder. */
export function devUserDataPath(opts: {
  isPackaged: boolean;
  hasUserDataDirSwitch: boolean;
  realData: string | undefined;
  appData: string;
}): string | null {
  if (opts.isPackaged || opts.hasUserDataDirSwitch) return null;
  if (opts.realData === '1') return null;
  return path.join(opts.appData, DEV_APP_NAME);
}

/** Points userData at the dev folder when devUserDataPath says so. Must run
 *  before anything reads userData (the DB, the session). */
export function isolateDevUserData(): void {
  const dir = devUserDataPath({
    isPackaged: app.isPackaged,
    hasUserDataDirSwitch: app.commandLine.hasSwitch('user-data-dir'),
    realData: process.env.HB_REAL_DATA,
    appData: app.getPath('appData'),
  });
  if (!dir) {
    if (!app.isPackaged && process.env.HB_REAL_DATA === '1') {
      console.warn('[house-budget] HB_REAL_DATA=1: opening the installed app\'s data folder');
    }
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
}
