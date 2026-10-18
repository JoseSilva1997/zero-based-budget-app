/* ============================================================
   Migration system - integer versioning via PRAGMA user_version.

   - The committed `schema` + `triggers` are the baseline = version 1.
   - Each migration is a numbered, idempotent `up(db)`.
   - The runner applies any migration whose `version` > the DB's current
     user_version, each in its own transaction, then bumps user_version.
   - Before the first pending migration it calls `beforeMigrating`, which
     main/db.ts uses to back the database up (never on a fresh install).
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
  {
    version: 7,
    name: 'split actual entries into name + note',
    // The single 'description' column was only ever filled with a short label
    // of what the spend was, so it becomes 'name'; 'note' is new and empty.
    up: (db) => {
      if (hasColumn(db, 'budget_item_actual_entries', 'description')) {
        db.exec(`ALTER TABLE budget_item_actual_entries RENAME COLUMN description TO name;`);
      }
      if (!hasColumn(db, 'budget_item_actual_entries', 'note')) {
        db.exec(`ALTER TABLE budget_item_actual_entries ADD COLUMN note TEXT;`);
      }
    },
  },
  {
    version: 8,
    name: 'month-independent groups and categories; items become plan lines',
    // Not atomic: rebuilding budget_groups and budget_items needs
    // PRAGMA foreign_keys=OFF, which only takes effect outside a transaction.
    // Everything else runs in one transaction of its own. Idempotent: a DB
    // whose groups no longer belong to a month is left alone. The caller
    // (main/db.ts) has taken a backup before any migration runs.
    atomic: false,
    up: (db) => {
      if (!hasColumn(db, 'budget_groups', 'budget_month_id')) return;
      const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
      db.pragma('foreign_keys = OFF');
      try {
        db.transaction(() => mergeMonthsIntoCategories(db))();
      } finally {
        db.pragma(`foreign_keys = ${fkWasOn ? 'ON' : 'OFF'}`);
      }
    },
  },
];

/** Trimmed, inner whitespace collapsed, case-folded: the form names are
 *  merged on. A copy of normalizeName in repositories/categories.ts, kept
 *  here so a shipped migration never changes when the repository does. */
function migrationKey(name: string): string {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Migration 8's body. Groups were cloned into every month, and items into
 * every group, so nothing linked September's "Groceries" to October's. Here:
 * - groups merge on their normalised name into one month-independent group,
 *   taking kind, collapsed and position from the newest month that has it;
 * - items merge on normalised (group name, item name) into one category,
 *   taking its name, position and default account from the newest month;
 * - every item becomes a plan line for its category, keeping its id (so its
 *   entries keep pointing at it), planned amount, account and position;
 * - two items that merge into one category in the SAME month become one plan
 *   line: planned amounts summed, entries moved to the surviving line;
 * - a group with no items that is not in the newest month is archived, since
 *   an empty group otherwise shows in every month.
 */
function mergeMonthsIntoCategories(db: Database.Database): void {
  const oldGroups = db
    .prepare(
      `SELECT g.*, m.month AS month FROM budget_groups g
         JOIN budget_months m ON m.id = g.budget_month_id
        ORDER BY m.month DESC, g.sort_order, g.id`
    )
    .all() as Array<{
    id: number;
    budget_month_id: number;
    name: string;
    kind: string;
    collapsed: number;
    month: string;
  }>;
  const oldItems = db
    .prepare(
      `SELECT it.*, g.budget_month_id AS month_id FROM budget_items it
         JOIN budget_groups g ON g.id = it.budget_group_id
         JOIN budget_months m ON m.id = g.budget_month_id
        ORDER BY m.month DESC, it.sort_order, it.id`
    )
    .all() as Array<{
    id: number;
    budget_group_id: number;
    name: string;
    planned_cents: number;
    bank_account_id: number | null;
    sort_order: number;
    created_at: string;
    updated_at: string;
    month_id: number;
  }>;

  // Groups: the first row seen per key is the newest month's, and the order
  // seen is (newest month, position), which is also the new global order.
  // A group with no items shows in every month from now on, so one that was
  // only ever empty in older months is archived rather than resurfacing.
  const newestMonth = oldGroups.length ? oldGroups[0].month : null;
  const groupFor = new Map<number, number>(); // old group id -> new group id
  const groupByKey = new Map<string, number>();
  const newGroups: Array<{
    id: number;
    name: string;
    kind: string;
    collapsed: number;
    inNewest: boolean;
  }> = [];
  for (const g of oldGroups) {
    const key = migrationKey(g.name);
    let id = groupByKey.get(key);
    if (id === undefined) {
      id = g.id;
      groupByKey.set(key, id);
      newGroups.push({
        id,
        name: g.name.trim(),
        kind: g.kind,
        collapsed: g.collapsed,
        inNewest: g.month === newestMonth,
      });
    }
    groupFor.set(g.id, id);
  }

  // Categories, the same way, keyed within their new group.
  const catByKey = new Map<string, number>();
  const newCats: Array<{ id: number; group_id: number; name: string; account: number | null }> = [];
  const lineByMonthCat = new Map<string, number>(); // "month|category" -> surviving item id
  const lines: Array<{ item: (typeof oldItems)[number]; category_id: number }> = [];
  const merged: Array<{ from: number; into: number; planned: number }> = [];
  // Within a month, the earlier position survives a duplicate; the ORDER BY
  // above already puts it first.
  for (const it of oldItems) {
    const groupId = groupFor.get(it.budget_group_id) as number;
    const key = `${groupId}|${migrationKey(it.name)}`;
    let catId = catByKey.get(key);
    if (catId === undefined) {
      catId = newCats.length + 1;
      catByKey.set(key, catId);
      newCats.push({
        id: catId,
        group_id: groupId,
        name: it.name.trim().replace(/\s+/g, ' '),
        account: it.bank_account_id,
      });
    }
    const slot = `${it.month_id}|${catId}`;
    const survivor = lineByMonthCat.get(slot);
    if (survivor === undefined) {
      lineByMonthCat.set(slot, it.id);
      lines.push({ item: it, category_id: catId });
    } else {
      merged.push({ from: it.id, into: survivor, planned: it.planned_cents });
    }
  }
  for (const m of merged) {
    const into = lines.find((l) => l.item.id === m.into);
    if (into) into.item.planned_cents += m.planned;
  }

  db.exec(`
    CREATE TABLE budget_groups_new (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'spend' CHECK (kind IN ('spend','savings','debt')),
      collapsed INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY,
      group_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      bank_account_id INTEGER REFERENCES bank_accounts(id),
      archived INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES budget_groups(id) ON DELETE RESTRICT
    );
    CREATE TABLE budget_items_new (
      id INTEGER PRIMARY KEY,
      budget_month_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      planned_cents INTEGER NOT NULL DEFAULT 0 CHECK (planned_cents >= 0),
      bank_account_id INTEGER REFERENCES bank_accounts(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (budget_month_id, category_id),
      FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
    );
  `);

  const insGroup = db.prepare(
    `INSERT INTO budget_groups_new (id, name, kind, collapsed, archived, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const usedGroups = new Set(newCats.map((c) => c.group_id));
  newGroups.forEach((g, idx) => {
    const stale = !usedGroups.has(g.id) && !g.inNewest;
    insGroup.run(g.id, g.name, g.kind, g.collapsed, stale ? 1 : 0, idx);
  });

  const insCat = db.prepare(
    `INSERT INTO categories (id, group_id, name, bank_account_id, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  const catSort = new Map<number, number>(); // group id -> next position
  for (const c of newCats) {
    const at = catSort.get(c.group_id) ?? 0;
    catSort.set(c.group_id, at + 1);
    insCat.run(c.id, c.group_id, c.name, c.account, at);
  }

  const insLine = db.prepare(
    `INSERT INTO budget_items_new
       (id, budget_month_id, category_id, planned_cents, bank_account_id, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const { item: it, category_id } of lines) {
    insLine.run(
      it.id, it.month_id, category_id, it.planned_cents, it.bank_account_id,
      it.sort_order, it.created_at, it.updated_at
    );
  }
  const repoint = db.prepare(
    `UPDATE budget_item_actual_entries SET budget_item_id = ? WHERE budget_item_id = ?`
  );
  for (const m of merged) repoint.run(m.into, m.from);

  db.exec(`
    DROP TABLE budget_items;
    DROP TABLE budget_groups;
    ALTER TABLE budget_groups_new RENAME TO budget_groups;
    ALTER TABLE budget_items_new RENAME TO budget_items;
    CREATE UNIQUE INDEX idx_categories_group_name ON categories(group_id, name COLLATE NOCASE);
    CREATE INDEX idx_budget_items_category ON budget_items(category_id);
    CREATE TRIGGER budget_groups_set_updated_at
    AFTER UPDATE ON budget_groups FOR EACH ROW
    BEGIN UPDATE budget_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
    CREATE TRIGGER categories_set_updated_at
    AFTER UPDATE ON categories FOR EACH ROW
    BEGIN UPDATE categories SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
    CREATE TRIGGER budget_items_set_updated_at
    AFTER UPDATE ON budget_items FOR EACH ROW
    BEGIN UPDATE budget_items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
  `);

  // Verify integrity before committing (rolls back on any violation).
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`migration 8 left ${violations.length} foreign-key violation(s)`);
  }
}

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

export interface RunOptions {
  /**
   * Called once, before the first pending migration touches anything, with the
   * version the DB is at and the one it is going to. Not called when nothing
   * is pending. main/db.ts takes a backup here; a throw aborts the run.
   */
  beforeMigrating?: (fromVersion: number, toVersion: number) => void;
}

/**
 * Apply every pending migration. Assumes the baseline schema already exists
 * (db.ts execs `schema.sql`/`triggers.sql` and sets user_version = BASELINE_VERSION on
 * a fresh DB before calling this).
 */
export function runMigrations(db: Database.Database, opts: RunOptions = {}): void {
  let current = getUserVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > current);
  if (pending.length > 0 && opts.beforeMigrating) {
    opts.beforeMigrating(current, LATEST_VERSION);
  }
  for (const migration of pending) {
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
