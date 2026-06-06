/* ============================================================
   Migration test: builds an in-memory DB shaped like a real pre-cleanup
   database (schema version 5 — dead tables/columns present, populated with
   data), runs the compiled migration runner, and asserts that migration 6
   removes the dead schema while preserving all data and referential integrity.

   Requires a prior `npm run build` (it loads build/database/migrations.js).
   Run with:  npx electron tests/migration-electron.cjs
   ============================================================ */
const { app } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();

/* The pre-cleanup schema (baseline v1 + migrations 2-5 already applied): the
   four dead tables, the constrained dead columns, and the actual_cents
   triggers. This is exactly what migration 6 must transform. */
const OLD_SCHEMA = `
  CREATE TABLE household_members (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1, color TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

  CREATE TABLE budget_months (
    id INTEGER PRIMARY KEY, month TEXT NOT NULL UNIQUE, notes TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','archived')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

  CREATE TABLE bank_accounts (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('main','joint','wallet','savings','other')),
    owner_member_id INTEGER, sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, color TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_member_id) REFERENCES household_members(id) ON DELETE SET NULL);

  CREATE TABLE budget_incomes (
    id INTEGER PRIMARY KEY, budget_month_id INTEGER NOT NULL, household_member_id INTEGER NOT NULL,
    label TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    is_expected INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE,
    FOREIGN KEY (household_member_id) REFERENCES household_members(id) ON DELETE RESTRICT);

  CREATE TABLE budget_group_templates (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'spend',
    sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

  CREATE TABLE budget_item_templates (
    id INTEGER PRIMARY KEY, budget_group_template_id INTEGER NOT NULL, name TEXT NOT NULL,
    default_planned_cents INTEGER NOT NULL DEFAULT 0, is_recurring INTEGER NOT NULL DEFAULT 1, is_fixed INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_group_template_id) REFERENCES budget_group_templates(id) ON DELETE CASCADE);

  CREATE TABLE budget_groups (
    id INTEGER PRIMARY KEY, budget_month_id INTEGER NOT NULL, template_id INTEGER, name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'spend' CHECK (kind IN ('spend','savings','debt')),
    sort_order INTEGER NOT NULL DEFAULT 0, collapsed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES budget_group_templates(id) ON DELETE SET NULL);

  CREATE TABLE budget_items (
    id INTEGER PRIMARY KEY, budget_group_id INTEGER NOT NULL, template_id INTEGER, name TEXT NOT NULL,
    planned_cents INTEGER NOT NULL DEFAULT 0 CHECK (planned_cents >= 0),
    actual_cents INTEGER NOT NULL DEFAULT 0 CHECK (actual_cents >= 0), carryover_cents INTEGER NOT NULL DEFAULT 0,
    notes TEXT, is_recurring INTEGER NOT NULL DEFAULT 0, is_fixed INTEGER NOT NULL DEFAULT 0,
    bank_account_id INTEGER REFERENCES bank_accounts(id), sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_group_id) REFERENCES budget_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES budget_item_templates(id) ON DELETE SET NULL);

  CREATE TABLE budget_item_actual_entries (
    id INTEGER PRIMARY KEY, budget_item_id INTEGER NOT NULL, spent_on TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0), description TEXT, entered_by_member_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_item_id) REFERENCES budget_items(id) ON DELETE CASCADE,
    FOREIGN KEY (entered_by_member_id) REFERENCES household_members(id) ON DELETE SET NULL);

  CREATE TABLE budget_adjustments (
    id INTEGER PRIMARY KEY, budget_month_id INTEGER NOT NULL, from_budget_item_id INTEGER, to_budget_item_id INTEGER,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), note TEXT, adjusted_on TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE);

  CREATE TABLE savings_transfers (
    id INTEGER PRIMARY KEY, budget_month_id INTEGER NOT NULL, budget_item_id INTEGER NOT NULL,
    transferred_on TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0), note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE,
    FOREIGN KEY (budget_item_id) REFERENCES budget_items(id) ON DELETE CASCADE);

  CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);

  CREATE INDEX idx_budget_incomes_month ON budget_incomes(budget_month_id);
  CREATE INDEX idx_budget_groups_month ON budget_groups(budget_month_id);
  CREATE INDEX idx_budget_items_group ON budget_items(budget_group_id);
  CREATE INDEX idx_actual_entries_item ON budget_item_actual_entries(budget_item_id);
  CREATE INDEX idx_actual_entries_spent_on ON budget_item_actual_entries(spent_on);
  CREATE INDEX idx_adjustments_month ON budget_adjustments(budget_month_id);
  CREATE INDEX idx_savings_transfers_month ON savings_transfers(budget_month_id);

  CREATE TRIGGER actual_entries_after_insert AFTER INSERT ON budget_item_actual_entries FOR EACH ROW
  BEGIN UPDATE budget_items SET actual_cents = (SELECT COALESCE(SUM(amount_cents),0) FROM budget_item_actual_entries WHERE budget_item_id = NEW.budget_item_id) WHERE id = NEW.budget_item_id; END;
  CREATE TRIGGER budget_group_templates_set_updated_at AFTER UPDATE ON budget_group_templates FOR EACH ROW
  BEGIN UPDATE budget_group_templates SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
`;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3');
    const { runMigrations, getUserVersion, LATEST_VERSION } = require(
      path.join(__dirname, '..', 'build', 'database', 'migrations.js')
    );

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(OLD_SCHEMA);
    db.pragma('user_version = 5');

    // Seed one row per surviving table, plus a row in a dead table.
    db.exec(`
      INSERT INTO household_members (id, name, color) VALUES (1, 'Alex', '#abc');
      INSERT INTO bank_accounts (id, name, kind, owner_member_id, color) VALUES (1, 'Main', 'main', 1, '#def');
      INSERT INTO budget_months (id, month, status) VALUES (1, '2026-06', 'open');
      INSERT INTO budget_incomes (id, budget_month_id, household_member_id, label, amount_cents, is_expected) VALUES (1, 1, 1, 'Salary', 250000, 1);
      INSERT INTO budget_groups (id, budget_month_id, name, kind, collapsed) VALUES (1, 1, 'Savings', 'savings', 1);
      INSERT INTO budget_items (id, budget_group_id, name, planned_cents, actual_cents, bank_account_id) VALUES (1, 1, 'Emergency', 50000, 1200, 1);
      INSERT INTO budget_item_actual_entries (id, budget_item_id, spent_on, amount_cents, description, entered_by_member_id) VALUES (1, 1, '2026-06-10', 1200, 'top up', 1);
      INSERT INTO budget_adjustments (id, budget_month_id, amount_cents, adjusted_on) VALUES (1, 1, 500, '2026-06-11');
    `);

    runMigrations(db);

    // Version bumped.
    assert(getUserVersion(db) === LATEST_VERSION, `user_version ${getUserVersion(db)} != ${LATEST_VERSION}`);

    // Dead tables gone.
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
    for (const t of ['budget_group_templates', 'budget_item_templates', 'budget_adjustments', 'savings_transfers']) {
      assert(!tables.includes(t), `dead table ${t} survived`);
    }

    // Dead columns gone.
    const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
    assert(!cols('budget_items').includes('actual_cents'), 'budget_items.actual_cents survived');
    assert(!cols('budget_items').includes('template_id'), 'budget_items.template_id survived');
    assert(!cols('budget_groups').includes('template_id'), 'budget_groups.template_id survived');
    assert(!cols('budget_months').includes('status'), 'budget_months.status survived');
    assert(!cols('budget_incomes').includes('is_expected'), 'budget_incomes.is_expected survived');
    assert(!cols('household_members').includes('is_active'), 'household_members.is_active survived');
    assert(!cols('budget_item_actual_entries').includes('entered_by_member_id'), 'entered_by_member_id survived');

    // Data preserved through the rebuilds.
    assert(db.prepare(`SELECT COUNT(*) n FROM household_members`).get().n === 1, 'member lost');
    assert(db.prepare(`SELECT month FROM budget_months WHERE id=1`).get().month === '2026-06', 'month value lost');
    assert(db.prepare(`SELECT planned_cents FROM budget_items WHERE id=1`).get().planned_cents === 50000, 'item planned lost');
    assert(db.prepare(`SELECT bank_account_id FROM budget_items WHERE id=1`).get().bank_account_id === 1, 'item account fk lost');
    assert(db.prepare(`SELECT amount_cents FROM budget_item_actual_entries WHERE id=1`).get().amount_cents === 1200, 'actual lost');

    // Referential integrity intact.
    const violations = db.pragma('foreign_key_check');
    assert(violations.length === 0, `foreign-key violations: ${JSON.stringify(violations)}`);

    // Idempotent: a second run is a clean no-op.
    runMigrations(db);

    console.log(`MIGRATION_OK version=${getUserVersion(db)} tables=${tables.length}`);
    db.close();
    process.exitCode = 0;
  } catch (err) {
    console.error('MIGRATION_FAIL', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
