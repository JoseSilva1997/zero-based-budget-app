/* ============================================================
   Central filesystem paths, all rooted at Electron's userData dir.
   ============================================================ */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/** userData/data - holds the live SQLite database. */
export function dataDir(): string {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** userData/backups - holds dated database snapshots. */
export function backupsDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute path of the live database file. */
export function dbPath(): string {
  return path.join(dataDir(), 'budget.sqlite');
}

/** The userData root (what "Open data folder" reveals). */
export function userDataDir(): string {
  return app.getPath('userData');
}

/**
 * <repo root>/screenshots - where the dev-only debug menu drops its captures.
 *
 * Deliberately NOT under userData, unlike data/ and backups/. This folder only
 * exists in an unpackaged run (the debug IPC is never registered otherwise),
 * and there app.getAppPath() is the repo checkout, so the PNGs land somewhere
 * you can actually reach from a terminal rather than inside AppData. Gitignored.
 */
export function screenshotsDir(): string {
  const dir = path.join(app.getAppPath(), 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Location of the bundled `schema.sql` / `triggers.sql` files under database/.
 * In dev this resolves under the repo root (app path); when packaged they sit
 * alongside the app resources.
 */
export function sqlFilePath(name: 'schema' | 'triggers'): string {
  return path.join(app.getAppPath(), 'database', `${name}.sql`);
}
