/* ============================================================
   Central filesystem paths, all rooted at Electron's userData dir.
   ============================================================ */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/** userData/data — holds the live SQLite database. */
export function dataDir(): string {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** userData/backups — holds dated database snapshots. */
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
 * Location of the bundled `schema` / `triggers` SQL files. In dev this is the
 * repo root (app path); when packaged they sit alongside the app resources.
 */
export function sqlFilePath(name: 'schema' | 'triggers'): string {
  return path.join(app.getAppPath(), name);
}
