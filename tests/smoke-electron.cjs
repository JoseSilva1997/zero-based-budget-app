/* ============================================================
   Electron main-process smoke test: loads the freshly-rebuilt
   better-sqlite3 under Electron's ABI, opens an in-memory DB, runs the
   bundled schema + triggers, and asserts the lean baseline shape. No window
   is shown. A non-zero exit (or a NODE_MODULE_VERSION error) means the native
   rebuild did not match Electron's ABI, or the schema drifted.

   Run with:  npx electron tests/smoke-electron.cjs
   ============================================================ */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const EXPECTED_TABLES = [
  'app_meta',
  'bank_accounts',
  'budget_groups',
  'budget_incomes',
  'budget_item_actual_entries',
  'budget_items',
  'budget_months',
  'household_members',
];
const REMOVED_TABLES = [
  'budget_group_templates',
  'budget_item_templates',
  'budget_adjustments',
  'savings_transfers',
];

function columnNames(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8'));
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'database', 'triggers.sql'), 'utf8'));

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all()
      .map((r) => r.name);

    assert(
      JSON.stringify(tables) === JSON.stringify(EXPECTED_TABLES),
      `unexpected tables: got [${tables}], want [${EXPECTED_TABLES}]`
    );
    for (const t of REMOVED_TABLES) {
      assert(!tables.includes(t), `table ${t} should have been removed`);
    }

    // Columns that must be gone from the lean schema.
    assert(!columnNames(db, 'budget_items').includes('actual_cents'), 'budget_items.actual_cents should be gone');
    assert(!columnNames(db, 'budget_items').includes('template_id'), 'budget_items.template_id should be gone');
    assert(!columnNames(db, 'budget_months').includes('status'), 'budget_months.status should be gone');
    assert(!columnNames(db, 'budget_incomes').includes('is_expected'), 'budget_incomes.is_expected should be gone');
    assert(!columnNames(db, 'household_members').includes('is_active'), 'household_members.is_active should be gone');

    // An actual entry carries a short label and a separate optional note.
    const entryCols = columnNames(db, 'budget_item_actual_entries');
    assert(!entryCols.includes('description'), 'budget_item_actual_entries.description should be gone');
    assert(entryCols.includes('name'), 'budget_item_actual_entries.name is missing');
    assert(entryCols.includes('note'), 'budget_item_actual_entries.note is missing');

    const v = db.prepare('SELECT sqlite_version() AS v').get().v;
    console.log(
      `SMOKE_OK sqlite=${v} tables=${tables.length} electron=${process.versions.electron} abi=${process.versions.modules}`
    );
    db.close();
    process.exitCode = 0;
  } catch (err) {
    console.error('SMOKE_FAIL', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
