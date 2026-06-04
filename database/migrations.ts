/* ============================================================
   Migration system — integer versioning via PRAGMA user_version.

   - The committed `schema` + `triggers` are the baseline = version 1.
   - Each migration is a numbered, idempotent `up(db)`.
   - The runner applies any migration whose `version` > the DB's current
     user_version, each in its own transaction, then bumps user_version.
   - Append-only: never edit a shipped migration; add a new one.
   ============================================================ */
import type Database from 'better-sqlite3';

export const BASELINE_VERSION = 1;

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/** Returns true if a column already exists (keeps ALTERs safe to re-run). */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

const MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: 'add household_members.color',
    up: (db) => {
      if (!hasColumn(db, 'household_members', 'color')) {
        db.exec(`ALTER TABLE household_members ADD COLUMN color TEXT;`);
      }
    },
  },
  {
    version: 3,
    name: 'add bank_accounts.color',
    up: (db) => {
      if (!hasColumn(db, 'bank_accounts', 'color')) {
        db.exec(`ALTER TABLE bank_accounts ADD COLUMN color TEXT;`);
      }
    },
  },
  {
    version: 4,
    name: 'add budget_groups.collapsed',
    up: (db) => {
      if (!hasColumn(db, 'budget_groups', 'collapsed')) {
        db.exec(`ALTER TABLE budget_groups ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;`);
      }
    },
  },
  {
    version: 5,
    name: 'create app_meta key/value store',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key   TEXT PRIMARY KEY,
          value TEXT
        );
      `);
    },
  },
];

/** Highest version this build knows about. */
export const LATEST_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  BASELINE_VERSION
);

export function getUserVersion(db: Database.Database): number {
  const row = db.pragma('user_version', { simple: true });
  return Number(row) || 0;
}

function setUserVersion(db: Database.Database, version: number): void {
  // PRAGMA user_version doesn't accept bound params; version is an integer we control.
  db.pragma(`user_version = ${version}`);
}

/**
 * Apply every pending migration. Assumes the baseline schema already exists
 * (db.ts execs `schema`/`triggers` and sets user_version = BASELINE_VERSION on
 * a fresh DB before calling this).
 */
export function runMigrations(db: Database.Database): void {
  let current = getUserVersion(db);
  for (const migration of MIGRATIONS.filter((m) => m.version > current)) {
    const apply = db.transaction(() => {
      migration.up(db);
      setUserVersion(db, migration.version);
    });
    apply();
    current = migration.version;
  }
}
