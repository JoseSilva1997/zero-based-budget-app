/* ============================================================
   Migration test: builds in-memory DBs shaped like real older databases,
   runs the compiled migration runner, and asserts the result.

   1. A pre-cleanup database (schema version 5 - dead tables/columns present,
      populated with data): migration 6 removes the dead schema while
      preserving all data and referential integrity.
   2. A per-month database (schema version 7 - groups and items cloned into
      every month): migration 8 merges them into month-independent groups and
      categories, keeps every plan line's id so its entries still point at it,
      and folds two same-named items in one month into one plan line.
   3. Migration 9 adds the upload-transactions tables (banks and the import
      staging data): a migrated database ends up shaped exactly like a fresh
      install, and on both the constraints and cascades hold.

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

/* Version 7: groups belong to a month, and items to a group. */
const V7_SCHEMA = `
  CREATE TABLE household_members (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE budget_months (
    id INTEGER PRIMARY KEY, month TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE bank_accounts (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('main','joint','wallet','savings','other')),
    owner_member_id INTEGER, color TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_member_id) REFERENCES household_members(id) ON DELETE SET NULL);
  CREATE TABLE budget_incomes (
    id INTEGER PRIMARY KEY, budget_month_id INTEGER NOT NULL, household_member_id INTEGER NOT NULL,
    label TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0), sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE,
    FOREIGN KEY (household_member_id) REFERENCES household_members(id) ON DELETE RESTRICT);
  CREATE TABLE budget_groups (
    id INTEGER PRIMARY KEY, budget_month_id INTEGER NOT NULL, name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'spend' CHECK (kind IN ('spend','savings','debt')),
    collapsed INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_month_id) REFERENCES budget_months(id) ON DELETE CASCADE);
  CREATE TABLE budget_items (
    id INTEGER PRIMARY KEY, budget_group_id INTEGER NOT NULL, name TEXT NOT NULL,
    planned_cents INTEGER NOT NULL DEFAULT 0 CHECK (planned_cents >= 0),
    bank_account_id INTEGER REFERENCES bank_accounts(id), sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_group_id) REFERENCES budget_groups(id) ON DELETE CASCADE);
  CREATE TABLE budget_item_actual_entries (
    id INTEGER PRIMARY KEY, budget_item_id INTEGER NOT NULL, spent_on TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0), name TEXT, note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_item_id) REFERENCES budget_items(id) ON DELETE CASCADE);
  CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE INDEX idx_budget_incomes_month ON budget_incomes(budget_month_id);
  CREATE INDEX idx_budget_groups_month ON budget_groups(budget_month_id);
  CREATE INDEX idx_budget_items_group ON budget_items(budget_group_id);
  CREATE INDEX idx_actual_entries_item ON budget_item_actual_entries(budget_item_id);
  CREATE INDEX idx_actual_entries_spent_on ON budget_item_actual_entries(spent_on);
  CREATE TRIGGER budget_groups_set_updated_at AFTER UPDATE ON budget_groups FOR EACH ROW
  BEGIN UPDATE budget_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
  CREATE TRIGGER budget_items_set_updated_at AFTER UPDATE ON budget_items FOR EACH ROW
  BEGIN UPDATE budget_items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
`;

/* Three months the way copyMonth used to leave them: every group and item
   cloned with new ids. Along the way the household renamed things, so the
   merge has every case to handle:
   - 'bills' and 'Bills ', 'rent ' and 'Rent': one group, one category.
   - 'Fun' became 'Holidays' in October: two groups, since only the names
     are known. Likewise 'Emergency' and 'Emergency fund'.
   - Bills is 'debt' in October: the newest month decides kind and order.
   - September has 'Groceries' AND 'groceries' in Bills, both with entries:
     one category, so one plan line holding both amounts and all entries.
   - 'Old stuff' was an empty group only in August, and 'New ideas' is an
     empty group in October. An active group shows in every month, so every
     group the newest month no longer has ('Fun', 'Old stuff') is archived:
     it stays in the months where it has lines, and nowhere else. */
const V7_DATA = `
  INSERT INTO household_members (id, name) VALUES (1, 'Alex');
  INSERT INTO bank_accounts (id, name, kind) VALUES (1, 'Main', 'main'), (2, 'Joint', 'joint');
  INSERT INTO budget_months (id, month) VALUES (1, '2026-08'), (2, '2026-09'), (3, '2026-10');
  INSERT INTO budget_incomes (budget_month_id, household_member_id, label, amount_cents)
    VALUES (1, 1, 'Salary', 300000), (2, 1, 'Salary', 300000), (3, 1, 'Salary', 310000);

  INSERT INTO budget_groups (id, budget_month_id, name, kind, collapsed, sort_order) VALUES
    (1, 1, 'Bills',    'spend',   0, 0),
    (2, 1, 'Savings ', 'savings', 0, 1),
    (3, 1, 'Fun',      'spend',   1, 2),
    (4, 2, 'bills',    'spend',   1, 1),
    (5, 2, 'Savings',  'savings', 0, 0),
    (6, 3, 'Bills ',   'debt',    0, 2),
    (7, 3, 'Savings',  'savings', 1, 0),
    (8, 3, 'Holidays', 'spend',   0, 1),
    (9, 1, 'Old stuff', 'spend',  0, 3),
    (10, 3, 'New ideas', 'spend', 0, 3);

  INSERT INTO budget_items (id, budget_group_id, name, planned_cents, bank_account_id, sort_order) VALUES
    (1,  1, 'Rent',           100000, 1,    0),
    (2,  1, 'Power',            5000, 1,    1),
    (3,  2, 'Emergency',       20000, NULL, 0),
    (4,  3, 'Cinema',           3000, NULL, 0),
    (5,  4, 'rent ',          100000, 2,    0),
    (6,  4, 'Groceries',       30000, 1,    1),
    (7,  4, 'groceries',        2000, 1,    2),
    (8,  5, 'Emergency',       25000, NULL, 0),
    (9,  6, 'Rent',           110000, 2,    1),
    (10, 6, 'Groceries',       31000, 2,    0),
    (11, 7, 'Emergency fund',  25000, NULL, 0),
    (12, 8, 'Cinema',           4000, NULL, 0);

  INSERT INTO budget_item_actual_entries (id, budget_item_id, spent_on, amount_cents, name) VALUES
    (1, 1,  '2026-08-01', 100000, 'Rent'),
    (2, 6,  '2026-09-04',   8000, 'Weekly shop'),
    (3, 7,  '2026-09-05',   1500, 'Bread'),
    (4, 7,  '2026-09-12',    700, NULL),
    (5, 10, '2026-10-03',   9000, 'Weekly shop'),
    (6, 12, '2026-10-20',   4000, 'Cinema');
`;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg}: got ${ja}, want ${jb}`);
}

/** Migration 8, on the V7 fixture above. */
function perMonthToCategories(Database, runner, months) {
  const { runMigrations, getUserVersion, LATEST_VERSION } = runner;
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(V7_SCHEMA);
  db.exec(V7_DATA);
  db.pragma('user_version = 7');

  // The caller is told before anything changes, so it can take a backup.
  const told = [];
  runMigrations(db, {
    beforeMigrating: (from, to) => told.push([from, to, getUserVersion(db), db.prepare(`SELECT COUNT(*) n FROM budget_items`).get().n]),
  });
  eq(told, [[7, LATEST_VERSION, 7, 12]], 'told once, before migrating, with the versions');
  eq(getUserVersion(db), LATEST_VERSION, 'v7 db reaches the latest version');

  /* groups: merged on normalised name, newest month's kind/collapsed/order */
  const groups = db.prepare(`SELECT name, kind, collapsed, archived FROM budget_groups ORDER BY sort_order`).all();
  eq(
    groups.map((g) => [g.name, g.kind, g.collapsed, g.archived]),
    [
      ['Savings', 'savings', 1, 0],
      ['Holidays', 'spend', 0, 0],
      ['Bills', 'debt', 0, 0],
      ['New ideas', 'spend', 0, 0],
      ['Fun', 'spend', 1, 1],
      ['Old stuff', 'spend', 0, 1],
    ],
    'groups merged across months, newest month deciding; a group the newest month no longer has is archived'
  );

  /* categories: merged on (group, name), newest month's name and account */
  const cats = db
    .prepare(
      `SELECT g.name AS grp, c.name AS name, c.bank_account_id AS account, c.archived AS archived
         FROM categories c JOIN budget_groups g ON g.id = c.group_id
        ORDER BY g.sort_order, c.sort_order`
    )
    .all();
  eq(
    cats.map((c) => [c.grp, c.name, c.account]),
    [
      ['Savings', 'Emergency fund', null],
      ['Savings', 'Emergency', null],
      ['Holidays', 'Cinema', null],
      ['Bills', 'Groceries', 2],
      ['Bills', 'Rent', 2],
      ['Bills', 'Power', 1],
      ['Fun', 'Cinema', null],
    ],
    'categories merged across months'
  );

  /* plan lines keep their ids, so entries still point at them */
  const line = (id) => db.prepare(`SELECT * FROM budget_items WHERE id = ?`).get(id);
  eq(line(5).bank_account_id, 2, 'a plan line keeps its own month\'s account');
  eq(line(1).bank_account_id, 1, 'an older plan line keeps its own account');
  eq(line(1).category_id, line(9).category_id, 'Rent in August and October is one category');
  eq(line(5).category_id, line(9).category_id, "'rent ' in September is the same category");
  assert(line(4).category_id !== line(12).category_id, 'Cinema under Fun and under Holidays stay two categories');

  /* the same-month duplicate: one line, both amounts, every entry */
  eq(line(7), undefined, 'the duplicate line is gone');
  eq(line(6).planned_cents, 32000, 'the surviving line holds both planned amounts');
  eq(
    db.prepare(`SELECT id FROM budget_item_actual_entries WHERE budget_item_id = 6 ORDER BY id`).all().map((r) => r.id),
    [2, 3, 4],
    'the duplicate line\'s entries moved to the surviving line'
  );
  eq(db.prepare(`SELECT COUNT(*) n FROM budget_item_actual_entries`).get().n, 6, 'no entry lost');
  eq(db.prepare(`SELECT COUNT(*) n FROM budget_items`).get().n, 11, 'one plan line per item, minus the duplicate');

  /* each month reads as it did, through the repository */
  const shape = (mid) => months.getMonthTree(db, mid).groups.map((g) => [g.name, g.items.map((i) => i.name)]);
  // Every active group shows everywhere (Holidays and New ideas, empty, in the
  // older months); the archived Fun only where it has lines.
  eq(shape(1), [['Savings', ['Emergency']], ['Holidays', []], ['Bills', ['Rent', 'Power']], ['New ideas', []], ['Fun', ['Cinema']]], 'August reads back');
  eq(shape(2), [['Savings', ['Emergency']], ['Holidays', []], ['Bills', ['Rent', 'Groceries']], ['New ideas', []]], 'September reads back');
  eq(shape(3), [['Savings', ['Emergency fund']], ['Holidays', ['Cinema']], ['Bills', ['Groceries', 'Rent']], ['New ideas', []]], 'October reads back');
  eq(months.monthTotals(db, 2).allocated, 1570, 'September allocated unchanged'); // 1000 + 300 + 20 + 250
  eq(months.monthTotals(db, 2).actual, 102, 'September actual unchanged'); // 80 + 15 + 7
  const jul = months.trendSeries(db).find((p) => p.month === '2026-10');
  eq(jul.byGroup['Bills'], 90, 'trends still group the spending');

  /* integrity, and a second run is a clean no-op */
  eq(db.pragma('foreign_key_check'), [], 'no foreign-key violations');
  eq(db.pragma('foreign_keys', { simple: true }), 1, 'foreign keys back on');
  runMigrations(db, { beforeMigrating: () => told.push('again') });
  eq(told.length, 1, 'an up-to-date database is not backed up again');
  eq(db.prepare(`SELECT COUNT(*) n FROM categories`).get().n, 7, 'idempotent');
  db.close();
}

/* ---- migration 9: the upload-transactions tables ---- */

// Tables migration 9 creates or alters.
const IMPORT_TABLES = ['banks', 'bank_accounts', 'import_batches', 'import_files', 'import_rows', 'budget_item_actual_entries'];

/** What a table is, in a form two databases can be compared on: its
 *  columns, foreign keys, indices and triggers, and for a table created
 *  whole, its CREATE statement (which carries the CHECKs) with comments and
 *  layout stripped. */
function describeTable(db, table, created) {
  const norm = (sql) =>
    String(sql || '')
      .replace(/--[^\n]*/g, '')
      .replace(/IF NOT EXISTS /gi, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([(),])\s*/g, '$1')
      .trim();
  const master = (type) =>
    db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = ? AND tbl_name = ? AND sql IS NOT NULL ORDER BY name`)
      .all(type, table)
      .map((r) => [r.name, norm(r.sql)]);
  return {
    columns: db.prepare(`PRAGMA table_info(${table})`).all(),
    // By what they link, not their ids: ALTER TABLE adds a key after the
    // table's own FOREIGN KEY clauses, which numbers them differently.
    foreignKeys: db
      .prepare(`PRAGMA foreign_key_list(${table})`)
      .all()
      .map((k) => `${k.from} -> ${k.table}(${k.to}) on delete ${k.on_delete} on update ${k.on_update}`)
      .sort(),
    indices: master('index'),
    // Only for the tables it creates: the V7 fixture leaves out older
    // triggers that a real database has.
    triggers: created ? master('trigger') : null,
    create: created ? master('table') : null,
  };
}

/** The staging data behaves as the import needs it to, whichever way the
 *  database got its tables. */
function importStagingBehaves(db, label) {
  const refuses = (sql, msg) => {
    try {
      db.exec(sql);
    } catch (err) {
      return;
    }
    throw new Error(`${label}: ${msg}: expected the database to refuse it`);
  };
  db.exec(`
    INSERT INTO budget_months (id, month) VALUES (901, '2031-01'), (902, '2031-02');
    INSERT INTO bank_accounts (id, name, kind) VALUES (901, 'Joint test', 'joint');
    INSERT INTO budget_groups (id, name) VALUES (901, 'Import test');
    INSERT INTO categories (id, group_id, name) VALUES (901, 901, 'Food test'), (902, 901, 'Spare test');
    INSERT INTO budget_items (id, budget_month_id, category_id) VALUES (901, 901, 901);
  `);

  /* banks */
  db.exec(`INSERT INTO banks (id, name, preset) VALUES (901, 'My NatWest', 'natwest')`);
  refuses(`INSERT INTO banks (name, preset) VALUES ('MY natwest', 'natwest')`, 'a bank name is unique, ignoring case');
  refuses(`INSERT INTO banks (name, preset) VALUES ('Other', 'hsbc')`, 'a preset is one of the four built in');
  db.exec(`UPDATE bank_accounts SET bank_id = 901, account_identifier = '600000-11112222', bank_product = NULL WHERE id = 901`);

  /* batches: at most one pending per month */
  db.exec(`INSERT INTO import_batches (id, budget_month_id, status) VALUES (901, 901, 'pending')`);
  refuses(`INSERT INTO import_batches (budget_month_id, status) VALUES (901, 'pending')`, 'a second pending batch for a month');
  db.exec(`INSERT INTO import_batches (budget_month_id, status, imported_at) VALUES (901, 'imported', CURRENT_TIMESTAMP), (901, 'imported', CURRENT_TIMESTAMP), (902, 'pending', NULL)`);
  refuses(`INSERT INTO import_batches (budget_month_id, status) VALUES (902, 'done')`, 'a batch status is pending, imported or discarded');

  /* files: one file once per batch */
  db.exec(`INSERT INTO import_files (id, batch_id, bank_account_id, filename, file_hash) VALUES (901, 901, 901, 'sep.csv', 'abc')`);
  refuses(`INSERT INTO import_files (batch_id, bank_account_id, filename, file_hash) VALUES (901, 901, 'copy.csv', 'abc')`, 'the same file twice in a batch');

  /* rows: parsed fields, then decisions with their defaults */
  db.exec(`
    INSERT INTO import_rows (id, file_id, row_index, raw, posted_on, spent_on, amount_cents, direction,
                             descriptor_raw, descriptor_clean, features, fingerprint)
    VALUES (901, 901, 0, '{}', '2031-01-03', '2031-01-02', 1699, 'debit', 'X , SHOP , TOWN GB', 'SHOP', '{"type":"POS"}', 'fp1'),
           (902, 901, 1, '{}', NULL, NULL, NULL, NULL, 'bad', 'bad', '{}', NULL);
    UPDATE import_rows SET parse_error = 'Value "x" is not an amount' WHERE id = 902;
  `);
  const row = db.prepare(`SELECT kind, included, not_completed, category_id, linked_entry_id, name FROM import_rows WHERE id = 901`).get();
  eq(row, { kind: 'spend', included: null, not_completed: 0, category_id: null, linked_entry_id: null, name: null }, `${label}: a new row's decisions start empty`);
  refuses(`INSERT INTO import_rows (file_id, row_index, raw, amount_cents, direction, descriptor_raw, descriptor_clean) VALUES (901, 5, '{}', -1, 'debit', '', '')`, 'a negative amount');
  refuses(`INSERT INTO import_rows (file_id, row_index, raw, amount_cents, direction, descriptor_raw, descriptor_clean) VALUES (901, 5, '{}', 1, 'sideways', '', '')`, 'a direction other than debit or credit');
  refuses(`UPDATE import_rows SET kind = 'refund' WHERE id = 901`, 'a kind other than spend or transfer');
  refuses(`INSERT INTO import_rows (file_id, row_index, raw, descriptor_raw, descriptor_clean) VALUES (901, 0, '{}', '', '')`, 'the same row of a file twice');

  /* links both ways between a row and an entry */
  db.exec(`
    INSERT INTO budget_item_actual_entries (id, budget_item_id, spent_on, amount_cents, name, import_row_id)
    VALUES (901, 901, '2031-01-02', 1699, 'SHOP', 901), (902, 901, '2031-01-02', 500, 'By hand', NULL);
    UPDATE import_rows SET category_id = 902, linked_entry_id = 902 WHERE id = 901;
  `);
  db.exec(`DELETE FROM budget_item_actual_entries WHERE id = 902`);
  eq(db.prepare(`SELECT linked_entry_id FROM import_rows WHERE id = 901`).get().linked_entry_id, null, `${label}: deleting a linked entry unlinks the row`);
  db.exec(`DELETE FROM categories WHERE id = 902`);
  eq(db.prepare(`SELECT category_id FROM import_rows WHERE id = 901`).get().category_id, null, `${label}: deleting a category clears it from the row`);
  db.exec(`DELETE FROM import_rows WHERE id = 901`);
  eq(db.prepare(`SELECT import_row_id FROM budget_item_actual_entries WHERE id = 901`).get().import_row_id, null, `${label}: deleting a staging row keeps its entry, unlinked`);

  /* a bank deleted leaves its accounts without one */
  db.exec(`DELETE FROM banks WHERE id = 901`);
  eq(db.prepare(`SELECT bank_id, account_identifier FROM bank_accounts WHERE id = 901`).get(), { bank_id: null, account_identifier: '600000-11112222' }, `${label}: deleting a bank clears it from its accounts`);

  /* deleting a month takes its staging data with it */
  db.exec(`DELETE FROM budget_months WHERE id = 901`);
  eq(
    ['import_batches', 'import_files', 'import_rows'].map((t) => db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${t === 'import_batches' ? 'budget_month_id = 901' : '1'}`).get().n),
    [0, 0, 0],
    `${label}: a deleted month's batches, files and rows go with it`
  );
  eq(db.pragma('foreign_key_check'), [], `${label}: no foreign-key violations`);
}

function importStaging(Database, runner) {
  const { runMigrations, getUserVersion, LATEST_VERSION } = runner;
  const fs = require('fs');
  const root = path.join(__dirname, '..');

  const fresh = new Database(':memory:');
  fresh.pragma('foreign_keys = ON');
  fresh.exec(fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'));
  fresh.exec(fs.readFileSync(path.join(root, 'database', 'triggers.sql'), 'utf8'));
  fresh.pragma('user_version = 1');
  runMigrations(fresh);

  const migrated = new Database(':memory:');
  migrated.pragma('foreign_keys = ON');
  migrated.exec(V7_SCHEMA);
  migrated.exec(V7_DATA);
  migrated.pragma('user_version = 7');
  runMigrations(migrated);
  eq(getUserVersion(migrated), LATEST_VERSION, 'the migrated db reaches the latest version');

  const created = new Set(['banks', 'import_batches', 'import_files', 'import_rows']);
  for (const t of created) assert(describeTable(fresh, t, true).columns.length > 0, `a fresh install has ${t}`);
  for (const t of IMPORT_TABLES) {
    eq(describeTable(migrated, t, created.has(t)), describeTable(fresh, t, created.has(t)), `${t}: a migrated database matches a fresh install`);
  }
  eq(
    migrated.prepare(`SELECT COUNT(*) n FROM budget_item_actual_entries WHERE import_row_id IS NULL`).get().n,
    6,
    'existing entries are kept, none of them imported'
  );

  importStagingBehaves(fresh, 'fresh');
  importStagingBehaves(migrated, 'migrated');

  runMigrations(migrated);
  eq(describeTable(migrated, 'import_rows', true), describeTable(fresh, 'import_rows', true), 'a second run is a clean no-op');
  fresh.close();
  migrated.close();
}

app.whenReady().then(() => {
  let code = 0;
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

    // Migration 7: 'description' became 'name', and 'note' was added alongside.
    assert(!cols('budget_item_actual_entries').includes('description'), 'description survived');
    assert(cols('budget_item_actual_entries').includes('name'), 'actual entry name missing');
    assert(cols('budget_item_actual_entries').includes('note'), 'actual entry note missing');
    const entry = db.prepare(`SELECT name, note FROM budget_item_actual_entries WHERE id=1`).get();
    assert(entry.name === 'top up', `old description not carried into name (got ${entry.name})`);
    assert(entry.note === null, 'new note column should start empty');

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

    db.close();

    perMonthToCategories(
      Database,
      require(path.join(__dirname, '..', 'build', 'database', 'migrations.js')),
      require(path.join(__dirname, '..', 'build', 'database', 'repositories', 'months.js'))
    );

    importStaging(Database, require(path.join(__dirname, '..', 'build', 'database', 'migrations.js')));

    console.log(`MIGRATION_OK version=${LATEST_VERSION} tables=${tables.length}`);
  } catch (err) {
    console.error('MIGRATION_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(code);
  }
});
