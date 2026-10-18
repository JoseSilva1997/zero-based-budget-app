/* ============================================================
   Import repository test: "Upload transactions" against a database. A
   statement is added to the month's pending batch (or refused, saying
   why), read back as the review with its predictions and labels, decided
   on row by row, then confirmed into entries, and undone.

   Builds an in-memory DB from the committed schema + triggers, runs
   migrations to mirror a real DB, and drives the repository with the
   anonymised fixture statements in tests/fixtures/import/.

   Requires a prior `npm run build` (loads build/database/**).
   Run with (ELECTRON_RUN_AS_NODE must be unset so require('electron').app works):
     npx electron tests/import-repo-electron.cjs
   ============================================================ */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg}: got ${ja}, want ${jb}`);
}
// A refusal is only useful if it says the right thing, so assert on the copy.
function throws(fn, needle, msg) {
  try {
    fn();
  } catch (err) {
    const text = String((err && err.message) || err);
    if (!text.includes(needle)) throw new Error(`${msg}: refused with "${text}"`);
    return err;
  }
  throw new Error(`${msg}: expected a refusal, got none`);
}

const root = path.join(__dirname, '..');
const b = (...p) => require(path.join(root, 'build', 'database', ...p));
const fixture = (bank) => fs.readFileSync(path.join(__dirname, 'fixtures', 'import', `${bank}.csv`), 'utf8');

function freshDb() {
  const Database = require('better-sqlite3');
  const { runMigrations } = b('migrations.js');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(root, 'database', 'triggers.sql'), 'utf8'));
  db.pragma('user_version = 1');
  runMigrations(db);
  return db;
}

const months = b('repositories', 'months.js');
const accounts = b('repositories', 'accounts.js');
const banks = b('repositories', 'banks.js');

/** September 2026 with a Joint account on a NatWest bank, and a Revolut
 *  account with no bank yet. */
function setup() {
  const db = freshDb();
  const sep = months.insertMonth(db, '2026-09');
  const joint = accounts.insertAccount(db, { name: 'Joint', kind: 'joint', owner_member_id: null, sort_order: 0, color: null });
  const travel = accounts.insertAccount(db, { name: 'Travel', kind: 'main', owner_member_id: null, sort_order: 1, color: null });
  const natwest = banks.createBank(db, { name: 'NatWest', preset: 'natwest' });
  banks.setAccountBank(db, joint, natwest, null);
  return { db, sep, joint, travel, natwest };
}

app.whenReady().then(() => {
  let code = 0;
  try {
    const imports = b('repositories', 'imports.js');

    /* ---- adding a statement ---- */
    {
      const { db, sep, joint } = setup();
      const file = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') });
      eq([file.filename, file.accountId, file.rowCount], ['sep.csv', joint, 3], 'the file is added with its rows');
      eq(accounts.getAccountById(db, joint).account_identifier, '600000-11112222', 'the first statement names the account');

      throws(
        () => imports.addFile(db, { monthId: sep, accountId: joint, filename: 'copy.csv', text: fixture('natwest') }),
        'That file is already in this upload.',
        'the same file twice is refused'
      );
      throws(
        () => imports.addFile(db, { monthId: sep, accountId: joint, filename: 'lloyds.csv', text: fixture('lloyds') }),
        "This doesn't look like a NatWest statement.",
        "another bank's statement is refused"
      );
      const other = fixture('natwest').replace(/600000-11112222/g, '600000-33338338');
      throws(
        () => imports.addFile(db, { monthId: sep, accountId: joint, filename: 'other.csv', text: other }),
        'This is the statement for ••8338, not Joint.',
        "another account's statement is refused"
      );
      db.close();
    }

    /* ---- an account with no bank yet ---- */
    {
      const { db, sep, travel } = setup();
      const err = throws(
        () => imports.addFile(db, { monthId: sep, accountId: travel, filename: 'rev.csv', text: fixture('revolut') }),
        'Travel',
        'an account with no bank is refused'
      );
      eq([err.code, err.detail], ['needs_bank', { preset: 'revolut', products: ['Current', 'Savings'] }], 'saying which bank the file looks like, and its products');
      const unknown = throws(
        () => imports.addFile(db, { monthId: sep, accountId: travel, filename: 'x.csv', text: 'a,b\n1,2\n' }),
        'Travel',
        'an unrecognised file too'
      );
      eq([unknown.code, unknown.detail], ['needs_bank', { preset: null, products: null }], 'with no preset');
      eq(imports.getReview(db, sep).batch, null, 'a refused file leaves no batch behind');

      // Set up as the UI would, then retry.
      const rev = banks.createBank(db, { name: 'Revolut', preset: 'revolut' });
      banks.setAccountBank(db, travel, rev, 'Current');
      const file = imports.addFile(db, { monthId: sep, accountId: travel, filename: 'rev.csv', text: fixture('revolut') });
      eq(file.rowCount, 5, "only the account's own product is kept");
      db.close();
    }

    /* ---- the review ---- */
    {
      const { db, sep, joint } = setup();
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const home = months.insertGroup(db, { name: 'Home', kind: 'spend', sort_order: 1, collapsed: 0 });
      const food = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Food', planned_cents: 30000 });
      months.insertActualEntry(db, { budget_item_id: food, spent_on: '2026-09-01', amount_cents: 1000, name: 'Corner shop', note: null });
      const oct = months.insertMonth(db, '2026-10');
      months.addItemByName(db, { monthId: oct, groupId: home, name: 'Garden', planned_cents: 500 });
      const foodCat = months.getItemById(db, food).category_id;

      const empty = imports.getReview(db, sep);
      eq(empty.batch, null, 'no upload yet, no batch');
      eq(empty.accounts.map((a) => [a.account.name, a.bank && a.bank.name, a.files.length, a.rows.length]), [['Joint', 'NatWest', 0, 0], ['Travel', null, 0, 0]], 'every account, in order, with its bank');

      const file = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') });
      const review = imports.getReview(db, sep);
      eq([review.batch.id, review.batch.status], [file.batchId, 'pending'], 'the pending batch');
      const [jointSec] = review.accounts;
      eq(jointSec.files.map((f) => [f.id, f.filename, f.rowCount]), [[file.id, 'sep.csv', 3]], "the account's files");
      const r = jointSec.rows[1];
      eq(
        [r.fileId, r.rowIndex, r.spentOn, r.postedOn, r.amountCents, r.direction, r.descriptorClean, r.features],
        [file.id, 1, '2026-09-26', '2026-09-28', 1699, 'debit', 'SUPERDRUG STORES PLC', { type: 'POS' }],
        'a row carries its parsed fields'
      );
      eq([r.categoryId, r.name, r.kind, r.included, r.prediction], [null, 'SUPERDRUG STORES PLC', 'spend', false, null], 'with nothing learned, no category and unticked');
      eq(r.labels, [{ key: 'uncategorised', severity: 'block', text: 'No category' }], 'labelled uncategorised');
      eq(r.decisions, { categoryId: null, name: null, kind: null, included: null, linkedEntryId: null }, 'and no decisions yet');
      eq(review.accounts[1].rows, [], "another account's section is empty");

      eq(review.plan, [{ itemId: food, categoryId: foodCat, name: 'Food', plannedCents: 30000, actualCents: 1000 }], "the month's plan with spending so far");
      eq(review.categories.map((c) => [c.name, c.groupName, c.inMonth]), [['Food', 'Bills', true], ['Garden', 'Home', false]], "the picker: this month's first");

      // Removing a file takes its rows.
      imports.removeFile(db, file.id);
      const after = imports.getReview(db, sep);
      eq([after.accounts[0].files.length, after.accounts[0].rows.length], [0, 0], 'a removed file takes its rows');
      db.close();
    }

    /* ---- possible duplicates ---- */
    {
      const { db, sep, joint, travel } = setup();
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const onJoint = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Toiletries', bank_account_id: joint });
      const anyAcct = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Shops', bank_account_id: null });
      const onTravel = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Holiday', bank_account_id: travel });
      const entry = (item, spent_on, amount_cents, name) => months.insertActualEntry(db, { budget_item_id: item, spent_on, amount_cents, name, note: null });
      // SUPERDRUG: £16.99 spent 2026-09-26.
      const near = entry(onJoint, '2026-09-24', 1699, 'Superdrug');
      const noAcct = entry(anyAcct, '2026-09-29', 1699, null);
      entry(onTravel, '2026-09-26', 1699, 'Other account');
      entry(onJoint, '2026-09-30', 1699, 'Four days later');
      entry(onJoint, '2026-09-26', 1700, 'Another amount');

      imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') });
      const rows = imports.getReview(db, sep).accounts[0].rows;
      const superdrug = rows[1];
      eq(
        superdrug.duplicates,
        [
          { id: near, spentOn: '2026-09-24', amountCents: 1699, name: 'Superdrug', categoryName: 'Toiletries' },
          { id: noAcct, spentOn: '2026-09-29', amountCents: 1699, name: null, categoryName: 'Shops' },
        ],
        'same amount within three days, on this account or none, nearest first'
      );
      assert(superdrug.labels.some((l) => l.key === 'possible_duplicate'), 'and the row says so');
      eq(rows[0].duplicates, [], 'a row with no match has none');
      db.close();
    }

    console.log('IMPORT_REPO_OK');
  } catch (err) {
    console.error('IMPORT_REPO_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    app.exit(code);
  }
});
