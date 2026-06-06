/* ============================================================
   Migration system - integer versioning via PRAGMA user_version.

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
  /**
   * When false, the runner does NOT wrap `up` in its own transaction. Use for
   * migrations that must control transactions/pragmas themselves (e.g. a table
   * rebuild that needs `PRAGMA foreign_keys=OFF`, which is a no-op inside a
   * transaction). Such migrations must be idempotent and manage their own
   * atomicity. Defaults to true.
   */
  atomic?: boolean;
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
  {
    version: 6,
    name: 'drop unused tables, columns, triggers and indices',
    // Not atomic: a table rebuild needs PRAGMA foreign_keys=OFF, which only
    // takes effect outside a transaction. Idempotent - a no-op on a DB that is
    // already lean (every drop is guarded), so it is safe to re-run.
    atomic: false,
    up: (db) => {
      const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
      db.pragma('foreign_keys = OFF');
      try {
        const work = db.transaction(() => {
          // 1. Tables that are never written or read.
          db.exec(`
            DROP TABLE IF EXISTS budget_adjustments;
            DROP TABLE IF EXISTS savings_transfers;
            DROP TABLE IF EXISTS budget_item_templates;
            DROP TABLE IF EXISTS budget_group_templates;
          `);

          // 2. Triggers tied to dropped tables or the dropped actual_cents column.
          db.exec(`
            DROP TRIGGER IF EXISTS budget_group_templates_set_updated_at;
            DROP TRIGGER IF EXISTS budget_item_templates_set_updated_at;
            DROP TRIGGER IF EXISTS actual_entries_after_insert;
            DROP TRIGGER IF EXISTS actual_entries_after_update;
            DROP TRIGGER IF EXISTS actual_entries_after_delete;
          `);

          // 3. Indices on dropped tables.
          db.exec(`
            DROP INDEX IF EXISTS idx_adjustments_month;
            DROP INDEX IF EXISTS idx_savings_transfers_month;
          `);

          // 4. Rebuild the tables whose unused columns are bound by a CHECK or
          //    FK constraint (plain DROP COLUMN is refused for those). Data and
          //    primary keys are preserved; indices/triggers are recreated.
          if (hasColumn(db, 'budget_months', 'status') || hasColumn(db, 'budget_months', 'notes')) {
            db.exec(`
              CREATE TABLE budget_months_new (
                id INTEGER PRIMARY KEY,
                month TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
              );
              INSERT INTO budget_months_new (id, month, created_at, updated_at)
                SELECT id, month, created_at, updated_at FROM budget_months;
              DROP TABLE budget_months;
              ALTER TABLE budget_months_new RENAME TO budget_months;
              CREATE TRIGGER budget_months_set_updated_at
              AFTER UPDATE ON budget_months FOR EACH ROW
              BEGIN UPDATE budget_months SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
            `);
          }

          if (hasColumn(db, 'budget_groups', 'template_id')) {
            db.exec(`
              CREATE TABLE budget_groups_new (
                id INTEGER PRIMARY KEY,
                budget_month_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'spend' CHECK (kind IN ('spend','savings','debt')),
                collapsed INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE
              );
              INSERT INTO budget_groups_new (id, budget_month_id, name, kind, collapsed, sort_order, created_at, updated_at)
                SELECT id, budget_month_id, name, kind, collapsed, sort_order, created_at, updated_at FROM budget_groups;
              DROP TABLE budget_groups;
              ALTER TABLE budget_groups_new RENAME TO budget_groups;
              CREATE INDEX idx_budget_groups_month ON budget_groups(budget_month_id);
              CREATE TRIGGER budget_groups_set_updated_at
              AFTER UPDATE ON budget_groups FOR EACH ROW
              BEGIN UPDATE budget_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
            `);
          }

          if (hasColumn(db, 'budget_items', 'actual_cents') || hasColumn(db, 'budget_items', 'template_id')) {
            db.exec(`
              CREATE TABLE budget_items_new (
                id INTEGER PRIMARY KEY,
                budget_group_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                planned_cents INTEGER NOT NULL DEFAULT 0 CHECK (planned_cents >= 0),
                bank_account_id INTEGER REFERENCES bank_accounts(id),
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (budget_group_id) REFERENCES budget_groups(id) ON DELETE CASCADE
              );
              INSERT INTO budget_items_new (id, budget_group_id, name, planned_cents, bank_account_id, sort_order, created_at, updated_at)
                SELECT id, budget_group_id, name, planned_cents, bank_account_id, sort_order, created_at, updated_at FROM budget_items;
              DROP TABLE budget_items;
              ALTER TABLE budget_items_new RENAME TO budget_items;
              CREATE INDEX idx_budget_items_group ON budget_items(budget_group_id);
              CREATE TRIGGER budget_items_set_updated_at
              AFTER UPDATE ON budget_items FOR EACH ROW
              BEGIN UPDATE budget_items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
            `);
          }

          if (hasColumn(db, 'budget_item_actual_entries', 'entered_by_member_id')) {
            // entered_by_member_id is a foreign-key column, so DROP COLUMN is
            // refused - rebuild the table without it.
            db.exec(`
              CREATE TABLE budget_item_actual_entries_new (
                id INTEGER PRIMARY KEY,
                budget_item_id INTEGER NOT NULL,
                spent_on TEXT NOT NULL,
                amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
                description TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (budget_item_id) REFERENCES budget_items(id) ON DELETE CASCADE
              );
              INSERT INTO budget_item_actual_entries_new (id, budget_item_id, spent_on, amount_cents, description, created_at, updated_at)
                SELECT id, budget_item_id, spent_on, amount_cents, description, created_at, updated_at FROM budget_item_actual_entries;
              DROP TABLE budget_item_actual_entries;
              ALTER TABLE budget_item_actual_entries_new RENAME TO budget_item_actual_entries;
              CREATE INDEX idx_actual_entries_item ON budget_item_actual_entries(budget_item_id);
              CREATE INDEX idx_actual_entries_spent_on ON budget_item_actual_entries(spent_on);
              CREATE TRIGGER actual_entries_set_updated_at
              AFTER UPDATE ON budget_item_actual_entries FOR EACH ROW
              BEGIN UPDATE budget_item_actual_entries SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
            `);
          }

          // 5. Plain column drops where no constraint blocks them.
          if (hasColumn(db, 'household_members', 'is_active')) db.exec(`ALTER TABLE household_members DROP COLUMN is_active;`);
          if (hasColumn(db, 'bank_accounts', 'is_active')) db.exec(`ALTER TABLE bank_accounts DROP COLUMN is_active;`);
          if (hasColumn(db, 'budget_incomes', 'is_expected')) db.exec(`ALTER TABLE budget_incomes DROP COLUMN is_expected;`);

          // 6. Verify integrity before committing (rolls back on any violation).
          const violations = db.pragma('foreign_key_check') as unknown[];
          if (violations.length > 0) {
            throw new Error(`migration 6 left ${violations.length} foreign-key violation(s)`);
          }
        });
        work();
      } finally {
        db.pragma(`foreign_keys = ${fkWasOn ? 'ON' : 'OFF'}`);
      }
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
 * (db.ts execs `schema.sql`/`triggers.sql` and sets user_version = BASELINE_VERSION on
 * a fresh DB before calling this).
 */
export function runMigrations(db: Database.Database): void {
  let current = getUserVersion(db);
  for (const migration of MIGRATIONS.filter((m) => m.version > current)) {
    if (migration.atomic === false) {
      // The migration owns its own transaction(s); we just bump the version
      // afterwards. Idempotent migrations re-run cleanly if this is interrupted.
      migration.up(db);
      setUserVersion(db, migration.version);
    } else {
      const apply = db.transaction(() => {
        migration.up(db);
        setUserVersion(db, migration.version);
      });
      apply();
    }
    current = migration.version;
  }
}
