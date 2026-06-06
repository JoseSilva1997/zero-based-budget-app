/* ============================================================
   SQLite connection lifecycle.

   - Opens (or creates) the DB at userData/data/budget.sqlite.
   - On a fresh DB: execs `schema` then `triggers`, sets user_version to the
     baseline, then runs migrations.
   - On an existing DB: runs any pending migrations.
   - Enables WAL, foreign keys, synchronous=FULL, and a busy timeout.
   - Exports a typed `getDb()` singleton and a `closeDb()` for clean shutdown.
   ============================================================ */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import { dbPath, sqlFilePath } from './paths';
import { BASELINE_VERSION, getUserVersion, runMigrations, LATEST_VERSION } from '../database/migrations';

let db: Database.Database | null = null;

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
  applyConnectionPragmas(conn);

  if (isFreshDatabase(conn)) {
    initialiseBaseline(conn);
  }
  runMigrations(conn);

  const version = getUserVersion(conn);
  if (version !== LATEST_VERSION) {
    // Surfaced rather than thrown: a higher version means a newer build wrote
    // this DB; a lower one means a migration silently failed to bump.
    console.warn(`[db] user_version is ${version}, expected ${LATEST_VERSION}`);
  }

  db = conn;
  return db;
}

export function getDb(): Database.Database {
  if (!db) return initDb();
  return db;
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
