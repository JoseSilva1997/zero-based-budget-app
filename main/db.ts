/* ============================================================
   SQLite connection lifecycle.

   - Opens (or creates) the DB at userData/data/budget.sqlite.
   - Refuses a DB a newer build wrote (user_version above LATEST_VERSION)
     before running anything on it: DatabaseTooNewError, which the startup
     screen explains.
   - On a fresh DB: execs `schema` then `triggers`, sets user_version to the
     baseline, then runs migrations.
   - On an existing DB: takes a backup if any migration is pending, then runs
     them. A failed backup aborts the start rather than migrate unprotected.
   - Enables WAL, foreign keys, synchronous=FULL, and a busy timeout.
   - Exports a typed `getDb()` singleton and a `closeDb()` for clean shutdown.
   ============================================================ */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import { dbPath, sqlFilePath, backupsDir } from './paths';
import { createDbBackupSync } from '../database/repositories/backups';
import { BASELINE_VERSION, getUserVersion, runMigrations, LATEST_VERSION } from '../database/migrations';

let db: Database.Database | null = null;

/**
 * The file was written by a newer House Budget. Its schema has tables and
 * columns this build has never heard of, so the first query would fail on one
 * of them; refusing up front is what lets the startup screen say "update"
 * instead of guessing at a lock or a sync program. `code` and `detail` ride the
 * IPC envelope to the renderer.
 */
export class DatabaseTooNewError extends Error {
  readonly code = 'db_too_new';
  readonly detail: { found: number; supported: number };
  constructor(found: number, supported: number) {
    super(`This budget was saved by a newer version of House Budget (database version ${found}; this version reads up to ${supported}).`);
    this.name = 'DatabaseTooNewError';
    this.detail = { found, supported };
  }
}

function isFreshDatabase(conn: Database.Database): boolean {
  const row = conn
    .prepare(
      `SELECT COUNT(*) AS n FROM sqlite_master
       WHERE type = 'table' AND name = 'budget_months'`
    )
    .get() as { n: number };
  return row.n === 0;
}

function applyConnectionPragmas(conn: Database.Database): void {
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('synchronous = FULL');
  conn.pragma('busy_timeout = 5000');
}

function initialiseBaseline(conn: Database.Database): void {
  const schemaSql = fs.readFileSync(sqlFilePath('schema'), 'utf8');
  const triggersSql = fs.readFileSync(sqlFilePath('triggers'), 'utf8');
  const create = conn.transaction(() => {
    conn.exec(schemaSql);
    conn.exec(triggersSql);
    conn.pragma(`user_version = ${BASELINE_VERSION}`);
  });
  create();
}

/** Opens the database (idempotent) and brings the schema up to date. */
export function initDb(): Database.Database {
  if (db) return db;

  const conn = new Database(dbPath());
  // First, before any pragma: journal_mode = WAL alone rewrites the file
  // header, and a newer build's file should be left exactly as it was found.
  const found = getUserVersion(conn);
  if (found > LATEST_VERSION) {
    conn.close();
    throw new DatabaseTooNewError(found, LATEST_VERSION);
  }
  applyConnectionPragmas(conn);

  const fresh = isFreshDatabase(conn);
  if (fresh) {
    initialiseBaseline(conn);
  }
  runMigrations(conn, {
    // A fresh install has nothing to lose; anything else is snapshotted as it
    // was, so a migration that goes wrong can be undone from Settings.
    beforeMigrating: fresh
      ? undefined
      : (_from, to) => {
          createDbBackupSync(conn, backupsDir(), `before-v${to}`);
        },
  });

  const version = getUserVersion(conn);
  if (version !== LATEST_VERSION) {
    // Surfaced rather than thrown: a migration silently failed to bump. (A
    // higher version was refused above.)
    console.warn(`[db] user_version is ${version}, expected ${LATEST_VERSION}`);
  }

  db = conn;
  return db;
}

export function getDb(): Database.Database {
  if (!db) return initDb();
  return db;
}

/** Whether a connection is open. False when startup refused the file. */
export function isDbOpen(): boolean {
  return db !== null;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Closes and reopens the connection - used after a restore overwrites the
 * live DB file on disk.
 */
export function reopenDb(): Database.Database {
  closeDb();
  return initDb();
}
