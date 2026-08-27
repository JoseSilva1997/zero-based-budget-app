/* ============================================================
   Seeds a small, realistic fixture (two members, two accounts, one
   populated month with income/groups/items/actual entries) directly
   into <sandboxDir>/data/budget.sqlite, using the same schema,
   migrations, and repository helpers the real app uses. This mirrors
   the seeding pattern in tests/repo-electron.cjs, so it exercises the
   same code paths the app itself relies on rather than hand-rolled SQL.

   Run via:  npx electron seed-fixture.cjs <sandboxUserDataDir>
   Requires a prior `npm run build` (loads build/database/**), which
   screenshot.mjs already does before calling this.
   ============================================================ */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const sandboxDir = process.argv[2];
if (!sandboxDir) {
  console.error('usage: seed-fixture.cjs <sandboxUserDataDir>');
  process.exit(1);
}

app.whenReady().then(() => {
  try {
    const root = path.join(__dirname, '..', '..', '..');
    const Database = require('better-sqlite3');
    const b = (...p) => require(path.join(root, 'build', 'database', ...p));
    const { runMigrations, BASELINE_VERSION } = b('migrations.js');
    const months = b('repositories', 'months.js');
    const accounts = b('repositories', 'accounts.js');
    const members = b('repositories', 'members.js');

    const dataDir = path.join(sandboxDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const dbFile = path.join(dataDir, 'budget.sqlite');

    const db = new Database(dbFile);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'));
    db.exec(fs.readFileSync(path.join(root, 'database', 'triggers.sql'), 'utf8'));
    db.pragma(`user_version = ${BASELINE_VERSION}`);
    runMigrations(db);

    /* ---- members + accounts ---- */
    const ze = members.insertMember(db, { name: 'Alex', sort_order: 0, color: '#2fbf87' });
    const irina = members.insertMember(db, { name: 'Sam', sort_order: 1, color: '#fb5e7e' });
    const main = accounts.insertAccount(db, { name: 'Main', kind: 'main', owner_member_id: ze, sort_order: 0, color: '#5b8def' });
    const wallet = accounts.insertAccount(db, { name: 'Wallet', kind: 'wallet', owner_member_id: null, sort_order: 1, color: '#e0b84a' });

    /* ---- one populated month, current-looking, with an over-budget item
       and a savings group so the bar, the difference column, and the
       breach colour all have something real to render ---- */
    const now = new Date();
    const mid = months.insertMonth(db, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    months.insertIncome(db, { budget_month_id: mid, household_member_id: ze, label: 'Salary', amount_cents: 250000, sort_order: 0 });
    months.insertIncome(db, { budget_month_id: mid, household_member_id: irina, label: 'Salary', amount_cents: 220000, sort_order: 1 });

    const gHome = months.insertGroup(db, { budget_month_id: mid, name: 'Home', kind: 'spend', sort_order: 0, collapsed: 0 });
    const gSave = months.insertGroup(db, { budget_month_id: mid, name: 'Savings', kind: 'savings', sort_order: 1, collapsed: 0 });

    const rent = months.insertItem(db, { budget_group_id: gHome, name: 'Rent', planned_cents: 120000, bank_account_id: main, sort_order: 0 });
    months.insertActualEntry(db, { budget_item_id: rent, spent_on: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, amount_cents: 120000, name: null, note: null });

    const groceries = months.insertItem(db, { budget_group_id: gHome, name: 'Groceries', planned_cents: 30000, bank_account_id: wallet, sort_order: 1 });
    months.insertActualEntry(db, { budget_item_id: groceries, spent_on: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-04`, amount_cents: 27999, name: 'Weekly shop', note: null });
    months.insertActualEntry(db, { budget_item_id: groceries, spent_on: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-11`, amount_cents: 5500, name: null, note: null }); // pushes Groceries over budget

    months.insertItem(db, { budget_group_id: gSave, name: 'Emergency fund', planned_cents: 50000, bank_account_id: null, sort_order: 0 });

    db.close();
    console.log(`SEED_OK ${dbFile}`);
    app.exit(0);
  } catch (e) {
    console.error('SEED_FAILED', e.message);
    app.exit(1);
  }
});
