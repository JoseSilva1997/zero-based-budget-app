/* ============================================================
   Import repository test: "Upload transactions" against a database. A
   statement is added to the month's pending batch (or refused, saying
   why), read back as the review with its predictions and labels, decided
   on row by row, then confirmed into entries, and undone.

   Builds an in-memory DB from the committed schema + triggers, runs
   migrations to mirror a real DB, and drives the repository with the
   anonymised fixture statements in tests/fixtures/import/. Then the
   import:* and bank channels, against a real database under a sandbox.

   Requires a prior `npm run build` (loads build/database/**).
   Run with (ELECTRON_RUN_AS_NODE must be unset so require('electron').app works):
     npx electron tests/import-repo-electron.cjs
   ============================================================ */
const { app, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Before anything reads it: the IPC block opens a real database under
// userData, and this run must not touch the real one.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-import-test-'));
app.setPath('userData', path.join(sandbox, 'userData'));

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

app.whenReady().then(async () => {
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

    /* ---- a file with nothing in it for the account ---- */
    {
      const { db, sep, joint, travel } = setup();
      const header = fixture('natwest').split('\n')[0] + '\n';
      throws(() => imports.addFile(db, { monthId: sep, accountId: joint, filename: 'empty.csv', text: header }),
        'That file has no transactions in it.', 'a statement with no rows is refused');
      const rev = banks.createBank(db, { name: 'Revolut', preset: 'revolut' });
      banks.setAccountBank(db, travel, rev, 'Savings');
      const currentOnly = fixture('revolut').split('\n').filter((l) => !l.includes(',Savings,')).join('\n');
      throws(() => imports.addFile(db, { monthId: sep, accountId: travel, filename: 'current.csv', text: currentOnly }),
        'no transactions', "a Revolut export with none of the account's product is refused too");
      eq(imports.getReview(db, sep).batch, null, 'leaving nothing behind');
      db.close();
    }

    /* ---- a wrong first statement, taken back, isn't remembered ---- */
    {
      const { db, sep, joint } = setup();
      const other = fixture('natwest').replace(/600000-11112222/g, '600000-33338338');
      const wrong = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'other.csv', text: other });
      imports.removeFile(db, wrong.id);
      eq(accounts.getAccountById(db, joint).account_identifier, null, 'removing the only statement that named the account forgets it');
      const right = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') });
      eq(accounts.getAccountById(db, joint).account_identifier, '600000-11112222', 'so the right statement can still go in');

      // Discarding the upload is the same.
      imports.discardBatch(db, right.batchId);
      eq(accounts.getAccountById(db, joint).account_identifier, null, 'a discarded upload leaves no identifier behind');

      // While another statement still names it, it stays.
      const first = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') });
      imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep2.csv', text: fixture('natwest') + '\n' });
      imports.removeFile(db, first.id);
      eq(accounts.getAccountById(db, joint).account_identifier, '600000-11112222', 'another statement for the account keeps it');
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
      eq(r.labels, [{ key: 'uncategorised', severity: 'warn', text: 'No category' }], 'labelled uncategorised');
      eq(r.decisions, { categoryId: null, name: null, kind: null, included: null, linkedEntryId: null, note: null, refundOf: null }, 'and no decisions yet');
      eq(review.accounts[1].rows, [], "another account's section is empty");

      eq(review.plan, [{ itemId: food, categoryId: foodCat, name: 'Food', plannedCents: 30000, actualCents: 1000 }], "the month's plan with spending so far");
      eq(review.categories.map((c) => [c.name, c.groupName, c.inMonth]), [['Food', 'Bills', true], ['Garden', 'Home', false]], "the picker: this month's first");

      // Removing a file takes its rows.
      imports.removeFile(db, file.id);
      const after = imports.getReview(db, sep);
      eq([after.accounts[0].files.length, after.accounts[0].rows.length], [0, 0], 'a removed file takes its rows');
      db.close();
    }

    /* ---- overlapping statements in one upload ---- */
    {
      const { db, sep, joint } = setup();
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const food = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Food', bank_account_id: joint });
      const foodCat = months.getItemById(db, food).category_id;
      // The September statement, and a longer one that also holds it.
      const longer = fixture('natwest').trimEnd() +
        '\n01 Sep 2026,POS,"4321 31AUG26 CD , EARLIER SHOP , SPRINGFIELD GB",-1.00,1.00,Joint Example,600000-11112222\n';
      const a = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') });
      imports.addFile(db, { monthId: sep, accountId: joint, filename: 'aug-sep.csv', text: longer });
      const rows = imports.getReview(db, sep).accounts[0].rows;
      eq(rows.length, 7, 'both files are in');
      const debits = rows.filter((r) => r.direction === 'debit');
      for (const r of debits) imports.updateRow(db, r.id, { categoryId: foodCat, included: true });
      const again = imports.getReview(db, sep).accounts[0].rows;
      eq(again.slice(3, 6).map((r) => r.labels.map((l) => l.key)), [['already_imported'], ['already_imported'], ['already_imported']],
        'a row the upload already holds from an earlier file is already in');
      eq(again.slice(0, 3).map((r) => r.labels.some((l) => l.key === 'already_imported')), [false, false, false], 'the first copy is not');
      const res = imports.confirmBatch(db, a.batchId);
      eq(res.entries, 4, 'each spend is written once: the three, and the one only the longer file has');
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

    /* ---- decisions ---- */
    {
      const { db, sep, joint } = setup();
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const food = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Food', bank_account_id: joint });
      const foodCat = months.getItemById(db, food).category_id;
      const typed = months.insertActualEntry(db, { budget_item_id: food, spent_on: '2026-09-05', amount_cents: 500, name: 'Bakery', note: null });
      // Two £5 rows a day apart, both near the hand-typed £5.
      const csv = [
        'Date,Type,Description,Value,Balance,Account Name,Account Number',
        '05 Sep 2026,POS,"4321 04SEP26 CD , BAKERY ONE , SPRINGFIELD GB",-5.00,100.00,Joint Example,600000-11112222',
        '06 Sep 2026,POS,"4321 05SEP26 CD , BAKERY TWO , SPRINGFIELD GB",-5.00,95.00,Joint Example,600000-11112222',
      ].join('\n');
      imports.addFile(db, { monthId: sep, accountId: joint, filename: 'bakery.csv', text: csv });
      const rows = () => imports.getReview(db, sep).accounts[0].rows;
      const [one, two] = rows();
      eq([one.duplicates.map((d) => d.id), two.duplicates.map((d) => d.id)], [[typed], [typed]], 'both rows could be the typed entry');

      imports.updateRow(db, one.id, { categoryId: foodCat, name: '  Morning   bread ' });
      let r = rows()[0];
      eq([r.categoryId, r.name, r.decisions.categoryId, r.decisions.name], [foodCat, 'Morning bread', foodCat, 'Morning bread'], 'a category and a name, the name tidied');
      eq(r.included, false, 'still unticked: it may be a duplicate');
      imports.updateRow(db, one.id, { included: true });
      eq([rows()[0].included, rows()[0].decisions.included], [true, true], 'ticked by hand');
      imports.updateRow(db, one.id, { kind: 'transfer' });
      eq([rows()[0].kind, rows()[0].included], ['transfer', false], 'a transfer is never ticked');
      imports.updateRow(db, one.id, { kind: null, included: null, name: '' });
      r = rows()[0];
      eq([r.decisions.kind, r.decisions.included, r.decisions.name, r.name], [null, null, null, 'BAKERY ONE'], 'each decision clears back to the default');

      // Same as existing: the entry is this row's, and no longer the other's.
      imports.updateRow(db, one.id, { linkedEntryId: typed, included: true });
      [r] = rows();
      eq([r.decisions.linkedEntryId, r.included], [typed, false], 'a linked row is never ticked');
      eq(rows()[1].duplicates, [], 'and its entry is no longer offered to the other row');
      eq(rows()[1].labels.some((l) => l.key === 'possible_duplicate'), false, 'which stops being a possible duplicate');
      throws(() => imports.updateRow(db, two.id, { linkedEntryId: typed }), 'That entry is already matched to another transaction.', 'one entry, one row');
      imports.updateRow(db, one.id, { linkedEntryId: null });
      eq(rows()[1].duplicates.map((d) => d.id), [typed], 'unlinking offers it again');

      throws(() => imports.updateRow(db, one.id, { categoryId: 9999 }), 'That category is no longer in your budget.', 'an unknown category');
      throws(() => imports.updateRow(db, one.id, { linkedEntryId: 9999 }), 'That entry is no longer in your budget.', 'an unknown entry');
      throws(() => imports.updateRow(db, one.id, { kind: 'refund' }), 'spend or a transfer', 'an unknown kind');
      throws(() => imports.updateRow(db, 9999, { included: true }), 'no longer', 'an unknown row');
      db.close();
    }

    /* ---- confirming ---- */
    {
      const { db, sep, joint } = setup();
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const food = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Food', planned_cents: 5000 });
      const foodCat = months.getItemById(db, food).category_id;
      const oct = months.insertMonth(db, '2026-10');
      const octToil = months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Toiletries', bank_account_id: joint });
      const toilCat = months.getItemById(db, octToil).category_id;
      const typed = months.insertActualEntry(db, { budget_item_id: food, spent_on: '2026-09-26', amount_cents: 2900, name: 'Big shop', note: 'typed' });

      const file = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') });
      throws(() => imports.confirmBatch(db, file.batchId), 'Tick at least one transaction', 'nothing ticked, nothing to confirm');
      const [deli, superdrug, sainsburys] = imports.getReview(db, sep).accounts[0].rows;
      imports.updateRow(db, deli.id, { categoryId: foodCat, note: '  coffee with Sam  ' });
      imports.updateRow(db, superdrug.id, { categoryId: toilCat, name: 'Shampoo', note: 'gone wrong' });
      imports.updateRow(db, superdrug.id, { note: '   ' });
      eq(imports.getReview(db, sep).accounts[0].rows.slice(0, 2).map((r) => r.decisions.note), ['coffee with Sam', null], 'a note is trimmed, and a blank one clears it');
      eq(imports.getReview(db, sep).accounts[0].rows[1].labels.map((l) => l.key), ['not_in_month'], 'a category the month lacks says so');
      imports.updateRow(db, superdrug.id, { included: true });
      imports.updateRow(db, sainsburys.id, { linkedEntryId: typed });

      const result = imports.confirmBatch(db, file.batchId);
      eq(result, { entries: 2, totalCents: 1949, linked: 1, linesCreated: 1, learnt: 0, refunds: 0, refundCents: 0, moneyBack: 0, moneyBackCents: 0 }, 'writes the ticked rows and reports it');

      const tree = months.getMonthTree(db, sep);
      const lines = tree.groups[0].items.map((i) => [i.name, i.allocated, i.account, i.actuals.map((a) => [a.spent_on, a.amount, a.name, a.note])]);
      eq(
        lines,
        [
          ['Food', 50, null, [['2026-09-26', 29, 'Big shop', 'typed'], ['2026-09-28', 2.5, 'DELI AB1', 'coffee with Sam']]],
          ['Toiletries', 0, joint, [['2026-09-26', 16.99, 'Shampoo', '']]],
        ],
        'entries land on their lines with their notes; the missing line is created at £0 on the category\'s account'
      );

      eq(imports.getReview(db, sep).batch, null, 'the month has no upload in progress after confirming');
      const history = imports.listImports(db, sep);
      eq(history.map((h) => [h.id, h.filenames, h.entries]), [[file.batchId, ['sep.csv'], 2]], 'the import is listed with its files and entries');
      assert(/^\d{4}-\d{2}-\d{2}/.test(history[0].importedAt), 'with when it was imported');

      throws(() => imports.confirmBatch(db, file.batchId), 'already been imported', 'confirming twice is refused');
      throws(() => imports.updateRow(db, deli.id, { included: false }), 'already been imported', 'an imported row can no longer be changed');
      throws(() => imports.removeFile(db, file.id), 'already been imported', 'nor its file removed');
      db.close();
    }

    /* ---- discarding and undoing ---- */
    {
      const { db, sep, joint } = setup();
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const food = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Food' });
      const foodCat = months.getItemById(db, food).category_id;
      const typed = months.insertActualEntry(db, { budget_item_id: food, spent_on: '2026-09-26', amount_cents: 2900, name: 'Big shop', note: null });

      // Discarding a pending upload throws it away.
      const dropped = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') });
      imports.discardBatch(db, dropped.batchId);
      eq(imports.getReview(db, sep).batch, null, 'a discarded upload is gone');
      eq(imports.listImports(db, sep), [], 'and was never imported');

      const file = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') });
      const [deli, superdrug, sainsburys] = imports.getReview(db, sep).accounts[0].rows;
      imports.updateRow(db, deli.id, { categoryId: foodCat });
      imports.updateRow(db, superdrug.id, { categoryId: foodCat, included: true });
      imports.updateRow(db, sainsburys.id, { linkedEntryId: typed });
      throws(() => imports.undoImport(db, file.batchId), "hasn't been imported", 'a pending upload has nothing to undo');
      imports.confirmBatch(db, file.batchId);
      throws(() => imports.discardBatch(db, file.batchId), 'already been imported', 'an imported upload is undone, not discarded');

      // An imported entry edited since is still the import's.
      const shampoo = months.getItemById(db, food).actuals.find((a) => a.amount === 16.99);
      months.updateActual(db, shampoo.id, { name: 'Edited', amount_cents: 1800 });
      months.insertActualEntry(db, { budget_item_id: food, spent_on: '2026-09-27', amount_cents: 100, name: 'Typed after', note: null });

      // Another upload in progress blocks the undo.
      const other = fixture('natwest').replace('-2.50', '-2.51');
      const pending = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'other.csv', text: other });
      throws(() => imports.undoImport(db, file.batchId), 'Finish or discard the upload in progress first.', 'one upload in progress at a time');
      imports.discardBatch(db, pending.batchId);

      imports.undoImport(db, file.batchId);
      eq(
        months.getItemById(db, food).actuals.map((a) => a.name),
        ['Big shop', 'Typed after'],
        'undo deletes exactly the entries the import wrote, edited or not'
      );
      const review = imports.getReview(db, sep);
      eq(review.batch.id, file.batchId, 'the batch is back in progress');
      const rows = review.accounts[0].rows;
      eq(rows.map((r) => r.decisions.categoryId), [foodCat, foodCat, null], 'with every decision kept');
      eq([rows[2].decisions.linkedEntryId, rows[2].duplicates.map((d) => d.id)], [typed, [typed]], 'and the matched entry released, still matched');
      eq(imports.listImports(db, sep), [], 'no longer listed as imported');

      // And it can be confirmed again.
      eq(imports.confirmBatch(db, file.batchId).entries, 2, 'an undone upload confirms again');
      db.close();
    }

    /* ---- teaching without importing: unticked rows you categorised ---- */
    {
      const categories = b('repositories', 'categories.js');
      const { db, sep, joint } = setup();
      const oct = months.insertMonth(db, '2026-10');
      const home = months.insertGroup(db, { name: 'Home', kind: 'spend', sort_order: 0, collapsed: 0 });
      const out = months.addItemByName(db, { monthId: sep, groupId: home, name: 'Eating out', bank_account_id: joint });
      const toil = months.addItemByName(db, { monthId: sep, groupId: home, name: 'Toiletries', bank_account_id: joint });
      const groc = months.addItemByName(db, { monthId: sep, groupId: home, name: 'Groceries', bank_account_id: joint });
      const cat = (item) => months.getItemById(db, item).category_id;
      months.insertActualEntry(db, { budget_item_id: groc, spent_on: '2026-09-27', amount_cents: 2900, name: 'Big shop', note: null });
      const refund = [
        'Date,Type,Description,Value,Balance,Account Name,Account Number',
        '25 Sep 2026,POS,"4321 24SEP26 CD , PIZZA PLACE , SPRINGFIELD GB",12.00,880.00,Joint Example,600000-11112222',
      ].join('\n');

      const file = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') });
      imports.addFile(db, { monthId: sep, accountId: joint, filename: 'refund.csv', text: refund });
      const [deli, superdrug, sainsburys, pizza] = imports.getReview(db, sep).accounts[0].rows;
      imports.updateRow(db, deli.id, { categoryId: cat(out), included: false });
      imports.updateRow(db, superdrug.id, { categoryId: cat(toil), included: false });
      // A possible duplicate, left unticked rather than matched.
      imports.updateRow(db, sainsburys.id, { categoryId: cat(groc) });
      // Money in can't be ticked, so its category teaches nothing.
      imports.updateRow(db, pizza.id, { categoryId: cat(out) });
      const rows = imports.getReview(db, sep).accounts[0].rows;
      eq(rows.map((r) => [r.included, r.teaches]), [[false, true], [false, true], [false, true], [false, false]], 'the review says which rows will teach');

      eq(imports.confirmBatch(db, file.batchId), { entries: 0, totalCents: 0, linked: 0, linesCreated: 0, learnt: 3, refunds: 0, refundCents: 0, moneyBack: 0, moneyBackCents: 0 }, 'a confirm that only teaches goes through');
      eq(months.getMonthTree(db, sep).groups[0].items.map((i) => [i.name, i.actuals.length]), [['Eating out', 0], ['Toiletries', 0], ['Groceries', 1]], 'and writes no entry');
      eq(imports.listImports(db, sep).map((h) => [h.id, h.entries]), [[file.batchId, 0]], 'it is listed as an import of nothing');

      const octCsv = [
        'Date,Type,Description,Value,Balance,Account Name,Account Number',
        '16 Oct 2026,POS,"4321 15OCT26 CD , DELI AB1 , SPRINGFIELD GB",-3.10,90.00,Joint Example,600000-11112222',
        '15 Oct 2026,POS,"8765 14OCT26 CD , SUPERDRUG STORES , PLC , LITTLE TOWN GB",-8.49,93.10,Joint Example,600000-11112222',
        '13 Oct 2026,POS,"4321 12OCT26 CD , SAINSBURYS S/MKTS , LITTLE TOWN GB",-41.00,101.59,Joint Example,600000-11112222',
        '12 Oct 2026,POS,"4321 11OCT26 CD , PIZZA PLACE , SPRINGFIELD GB",-14.00,142.59,Joint Example,600000-11112222',
      ].join('\n');
      imports.addFile(db, { monthId: oct, accountId: joint, filename: 'oct.csv', text: octCsv });
      const predicted = () => imports.getReview(db, oct).accounts[0].rows.map((r) => r.prediction && r.prediction.label);
      eq(predicted(), [cat(out), cat(toil), cat(groc), null], 'the classifier learned the taught rows, and nothing from money in');

      categories.setCategoryArchived(db, cat(toil), true);
      eq(predicted()[1], null, 'a taught row in a retired category is not predicted');
      categories.setCategoryArchived(db, cat(toil), false);

      imports.discardBatch(db, imports.getReview(db, oct).batch.id);
      imports.undoImport(db, file.batchId);
      imports.addFile(db, { monthId: oct, accountId: joint, filename: 'oct.csv', text: octCsv });
      eq(predicted(), [null, null, null, null], 'an undone import takes its lessons back');
      eq(db.pragma('foreign_key_check'), [], 'no dangling references');
      db.close();
    }

    /* ---- end to end: upload, match, confirm, re-upload, learn, undo ---- */
    {
      const { HIGH_CONFIDENCE } = require(path.join(root, 'build', 'main', 'import', 'classifier.js'));
      const categories = b('repositories', 'categories.js');
      const { db, sep, joint } = setup();
      const oct = months.insertMonth(db, '2026-10');
      const home = months.insertGroup(db, { name: 'Home', kind: 'spend', sort_order: 0, collapsed: 0 });
      const out = months.addItemByName(db, { monthId: sep, groupId: home, name: 'Eating out', bank_account_id: joint });
      const toil = months.addItemByName(db, { monthId: sep, groupId: home, name: 'Toiletries', bank_account_id: joint });
      const groc = months.addItemByName(db, { monthId: sep, groupId: home, name: 'Groceries', bank_account_id: joint });
      const cat = (item) => months.getItemById(db, item).category_id;
      // Hand-typed before any upload.
      const typedShop = months.insertActualEntry(db, { budget_item_id: groc, spent_on: '2026-09-27', amount_cents: 2900, name: 'Sainsburys', note: null });
      months.insertActualEntry(db, { budget_item_id: out, spent_on: '2026-09-10', amount_cents: 4000, name: 'Birthday dinner', note: null });
      const transfers = (date, value) => [
        'Date,Type,Description,Value,Balance,Account Name,Account Number',
        `${date},OTR,"ALEX EXAMPLE , FP ${date.slice(0, 2)}/09/26 1000 , 400000000000000000",${value},10.00,Joint Example,600000-11112222`,
      ].join('\n');

      // 1-2. Upload September, match the shop to its typed entry, mark the transfer.
      const sepFile = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') });
      imports.addFile(db, { monthId: sep, accountId: joint, filename: 'transfers.csv', text: transfers('20 Sep 2026', '-50.00') });
      const [deli, superdrug, sainsburys, alex] = imports.getReview(db, sep).accounts[0].rows;
      eq(sainsburys.duplicates.map((d) => d.id), [typedShop], 'the typed shop is offered as the same spend');
      imports.updateRow(db, deli.id, { categoryId: cat(out) });
      imports.updateRow(db, superdrug.id, { categoryId: cat(toil) });
      imports.updateRow(db, sainsburys.id, { linkedEntryId: typedShop });
      imports.updateRow(db, alex.id, { kind: 'transfer' });

      // 3. Confirm.
      eq(imports.confirmBatch(db, sepFile.batchId), { entries: 2, totalCents: 1949, linked: 1, linesCreated: 0, learnt: 0, refunds: 0, refundCents: 0, moneyBack: 0, moneyBackCents: 0 }, 'September confirmed');

      // 4. The same statement uploaded into October is already in.
      imports.addFile(db, { monthId: oct, accountId: joint, filename: 'sep-again.csv', text: fixture('natwest') });
      let octRows = imports.getReview(db, oct).accounts[0].rows;
      eq(octRows.map((r) => [r.labels.map((l) => l.key), r.included]), [
        [['already_imported'], false], [['already_imported'], false], [['already_imported'], false],
      ], 'imported rows and the matched one are already imported');

      // 6. A new statement: the classifier learned from September.
      const octCsv = [
        'Date,Type,Description,Value,Balance,Account Name,Account Number',
        '16 Oct 2026,POS,"4321 15OCT26 CD , DELI AB1 , SPRINGFIELD GB",-3.10,90.00,Joint Example,600000-11112222',
        '13 Oct 2026,POS,"4321 12OCT26 CD , SAINSBURYS S/MKTS , LITTLE TOWN GB",-41.00,93.10,Joint Example,600000-11112222',
      ].join('\n');
      imports.addFile(db, { monthId: oct, accountId: joint, filename: 'oct.csv', text: octCsv });
      imports.addFile(db, { monthId: oct, accountId: joint, filename: 'oct-transfers.csv', text: transfers('21 Oct 2026', '-60.00') });
      octRows = imports.getReview(db, oct).accounts[0].rows;
      const [newArta, newShop, newAlex] = octRows.slice(3);
      eq(newArta.prediction.label, cat(out), 'a merchant imported before is predicted as its category');
      assert(newArta.prediction.confidence >= HIGH_CONFIDENCE, 'confidently');
      eq([newArta.categoryId, newArta.labels.map((l) => l.key)], [cat(out), ['not_in_month']], "and pre-filled, though October has no line for it yet");
      eq(newShop.prediction.label, cat(groc), "a matched entry teaches its category too");
      eq([newAlex.kind, newAlex.labels.map((l) => l.key)], ['transfer', ['transfer']], 'a marked transfer teaches transfers');

      // Merging categories is followed, since labels are read through the entry.
      categories.mergeCategories(db, cat(out), cat(groc));
      eq(imports.getReview(db, oct).accounts[0].rows[3].prediction.label, cat(groc), 'a merged category is predicted as its target');

      // An archived category is retired: the picker no longer offers it, so
      // nothing is predicted into it (it would show as "No category" while
      // ticked, and confirming would bring it back).
      categories.setCategoryArchived(db, cat(groc), true);
      const retired = imports.getReview(db, oct).accounts[0].rows[3];
      eq([retired.prediction, retired.categoryId], [null, null], 'a retired category is not predicted');
      categories.setCategoryArchived(db, cat(groc), false);

      // 5. Undo September: exactly its entries go, and what it taught goes with them.
      imports.undoImport(db, sepFile.batchId);
      eq(
        months.getMonthTree(db, sep).groups[0].items.map((i) => [i.name, i.actuals.map((a) => a.name)]),
        [['Toiletries', []], ['Groceries', ['Birthday dinner', 'Sainsburys']]],
        'only the hand-typed entries remain'
      );
      octRows = imports.getReview(db, oct).accounts[0].rows;
      eq(octRows.slice(0, 3).map((r) => r.labels.some((l) => l.key === 'already_imported')), [false, false, false], 'nothing is already imported any more');
      eq([octRows[3].prediction, octRows[5].kind], [null, 'spend'], 'and nothing is learned from an undone import');
      eq(db.pragma('foreign_key_check'), [], 'no dangling references');
      db.close();
    }

    /* ---- refunds and money back ---- */
    {
      const members = b('repositories', 'members.js');
      const { db, sep, joint } = setup();
      const sam = members.insertMember(db, { name: 'Sam', sort_order: 0, color: null });
      members.insertMember(db, { name: 'Robin', sort_order: 1, color: null });
      const style = months.insertGroup(db, { name: 'Style', kind: 'spend', sort_order: 0, collapsed: 0 });
      const clothing = months.addItemByName(db, { monthId: sep, groupId: style, name: 'Clothing', bank_account_id: joint });
      const clothingCat = months.getItemById(db, clothing).category_id;
      months.insertIncome(db, { budget_month_id: sep, household_member_id: sam, label: 'Salary', amount_cents: 200000, sort_order: 0 });
      const head = 'Date,Type,Description,Value,Balance,Account Name,Account Number';
      const line = (date, desc, value) => `${date},POS,"${desc}",${value},500.00,Joint Example,600000-11112222`;
      const sepCsv = [
        head,
        line('06 Sep 2026', '4321 05SEP26 CD , H&M , SPRINGFIELD GB', '-100.00'),
        line('12 Sep 2026', '4321 11SEP26 CD , H&M , REFUND , SPRINGFIELD GB', '50.00'),
        line('14 Sep 2026', '4321 13SEP26 CD , ACME OUTFITTERS , LITTLE TOWN GB', '-40.00'),
        line('20 Sep 2026', '4321 19SEP26 CD , ACME OUTFITTERS , REFUND , LITTLE TOWN GB', '40.00'),
        line('22 Sep 2026', '4321 21SEP26 CD , PARCEL PALACE , LITTLE TOWN GB', '-30.00'),
        line('23 Sep 2026', '4321 22SEP26 CD , PARCEL PALACE , REFUND , LITTLE TOWN GB', '30.00'),
        line('25 Sep 2026', 'CASHBACK REWARD', '3.00'),
      ].join('\n');
      const file = imports.addFile(db, { monthId: sep, accountId: joint, filename: 'sep.csv', text: sepCsv });
      let rows = imports.getReview(db, sep).accounts[0].rows;
      const [hm, hmBack, acme, acmeBack, parcel, parcelBack, cashback] = rows;
      eq([hm.descriptorClean, hmBack.descriptorClean], ['H&M', 'H&M'], 'the refund names the same shop');
      for (const r of [hm, acme, parcel]) imports.updateRow(db, r.id, { categoryId: clothingCat });
      // The parcel purchase is left out: not ours.
      imports.updateRow(db, parcel.id, { included: false });

      rows = imports.getReview(db, sep).accounts[0].rows;
      const read = (r) => [r.labels.map((l) => l.key), r.included, r.writesAs, r.refund && r.refund.purchase.ref, r.refund && r.refund.suggested, r.categoryId];
      eq(read(rows[1]), [['refund'], true, 'refund', { kind: 'row', id: hm.id }, true, clothingCat], "a refund of a purchase in this upload is suggested, ticked, in the purchase's category");
      eq([rows[1].refund.purchase.name, rows[1].refund.purchase.remainingCents, rows[1].refund.purchase.sameMonth], ['H&M', 10000, true], 'with what it refunds');
      eq(read(rows[3]), [['refund'], true, 'refund', { kind: 'row', id: acme.id }, true, clothingCat], 'each refund finds its own shop');
      eq(read(rows[5]), [['credit'], false, 'money_back', null, null, null], "a purchase that isn't imported isn't suggested");
      eq(read(rows[6]), [['credit'], false, 'money_back', null, null, null], 'money in with no purchase starts unticked');
      eq(rows[6].refundCandidates, [], 'and has none to offer');

      // Choosing the skipped purchase says it can't be ticked.
      imports.updateRow(db, parcelBack.id, { refundOf: { rowId: parcel.id } });
      rows = imports.getReview(db, sep).accounts[0].rows;
      eq([rows[5].labels.map((l) => l.key), rows[5].included, rows[5].decisions.refundOf], [['purchase_skipped'], false, { rowId: parcel.id }], "a refund of a purchase that isn't imported can't be ticked");
      imports.updateRow(db, parcelBack.id, { refundOf: null });
      throws(() => imports.updateRow(db, hm.id, { refundOf: 'none' }), 'Only money in', 'a purchase is not a refund');
      throws(() => imports.updateRow(db, hmBack.id, { refundOf: { rowId: acmeBack.id } }), 'not of other money in', 'nor is money in a purchase');

      imports.updateRow(db, cashback.id, { included: true });
      const res = imports.confirmBatch(db, file.batchId);
      eq(res, { entries: 2, totalCents: 14000, linked: 0, linesCreated: 0, learnt: 1, refunds: 2, refundCents: 9000, moneyBack: 1, moneyBackCents: 300 }, 'Confirm writes spends, refunds and money back');

      let tree = months.getMonthTree(db, sep);
      const actuals = tree.groups[0].items[0].actuals;
      eq(actuals.map((a) => [a.name, a.amount, a.kind]), [['H&M', 100, 'spend'], ['H&M', -50, 'refund'], ['ACME OUTFITTERS', 40, 'spend'], ['ACME OUTFITTERS', -40, 'refund']], 'refunds are negative entries on the line');
      eq(actuals[0].returns, [{ amount: 50, spent_on: '2026-09-11', month: '2026-09' }], 'the purchase says what came back');
      eq(actuals[1].refundOf, { name: 'H&M', spent_on: '2026-09-05', amount: 100, month: '2026-09' }, 'the refund says what it is of');
      eq(months.monthTotals(db, sep).actual, 50, "the month's actual nets them: a full return is nothing, a partial one the rest");
      eq(tree.incomes.map((i) => [i.label, i.amount, i.kind, i.memberId, i.receivedOn, i.refundOf]), [['Salary', 2000, 'earned', sam, null, null], ['CASHBACK REWARD', 3, 'money_back', sam, '2026-09-25', null]], 'money in with no purchase is money back, for the first member of a joint account');
      throws(() => months.updateActual(db, actuals[1].id, { amount_cents: -100 }), "can't be changed", "a refund's amount is the bank's");
      eq(imports.listImports(db, sep)[0].entries, 5, 'the import counts what it wrote');

      // October: the rest of the H&M order comes back after September closed.
      const oct = months.copyMonth(db, sep, '2026-10', { copyIncome: true });
      eq(months.getMonthTree(db, oct).incomes.map((i) => i.label), ['Salary'], 'a new month copies income, but not money back');
      const octCsv = [head, line('03 Oct 2026', '4321 02OCT26 CD , H&M , REFUND , SPRINGFIELD GB', '30.00'), line('04 Oct 2026', '4321 03OCT26 CD , H&M , REFUND , SPRINGFIELD GB', '30.00')].join('\n');
      const octFile = imports.addFile(db, { monthId: oct, accountId: joint, filename: 'oct.csv', text: octCsv });
      rows = imports.getReview(db, oct).accounts[0].rows;
      const hmEntry = actuals[0].id;
      eq(read(rows[0]), [['money_back'], true, 'money_back', { kind: 'entry', id: hmEntry }, true, null], "a refund of an earlier month's purchase is money back");
      eq([rows[0].refund.purchase.month, rows[0].refund.purchase.sameMonth, rows[0].refund.purchase.remainingCents], ['2026-09', false, 5000], 'with what is left of the purchase');
      eq([rows[1].refund, rows[1].labels.map((l) => l.key)], [null, ['credit']], 'a second refund the purchase has no room left for finds none');
      eq(imports.confirmBatch(db, octFile.batchId).moneyBackCents, 3000, 'October confirmed');
      tree = months.getMonthTree(db, oct);
      eq(tree.incomes.slice(1).map((i) => [i.label, i.amount, i.kind, i.refundOf && i.refundOf.month]), [['H&M', 30, 'money_back', '2026-09']], 'money back in October, naming the September purchase');
      eq(months.getMonthTree(db, sep).groups[0].items[0].actuals[0].returns, [
        { amount: 50, spent_on: '2026-09-11', month: '2026-09' },
        { amount: 30, spent_on: '2026-10-02', month: '2026-10' },
      ], 'and September\'s purchase says it came back in October');
      eq(months.monthTotals(db, sep).actual, 50, 'September stays as it was');

      // A re-upload knows what is in.
      const again = imports.addFile(db, { monthId: oct, accountId: joint, filename: 'oct-again.csv', text: octCsv });
      rows = imports.getReview(db, oct).accounts[0].rows;
      eq(rows[0].labels.map((l) => l.key), ['already_imported'], 'money back already written is already imported');
      imports.discardBatch(db, again.batchId);

      // Undo October, then September.
      imports.undoImport(db, octFile.batchId);
      eq(months.getMonthTree(db, oct).incomes.map((i) => i.label), ['Salary'], "undo takes October's money back out");
      imports.discardBatch(db, octFile.batchId);
      imports.undoImport(db, file.batchId);
      tree = months.getMonthTree(db, sep);
      eq([tree.groups[0].items[0].actuals, tree.incomes.map((i) => i.label)], [[], ['Salary']], "and September's refunds and money back");
      rows = imports.getReview(db, sep).accounts[0].rows;
      eq(rows.map((r) => r.included), [true, true, true, true, false, false, true], 'the upload is back with its choices');
      eq(db.pragma('foreign_key_check'), [], 'no dangling references');

      // Choosing a purchase by hand, and choosing none.
      imports.updateRow(db, hmBack.id, { refundOf: 'none' });
      rows = imports.getReview(db, sep).accounts[0].rows;
      eq([rows[1].refund, rows[1].writesAs, rows[1].included], [null, 'money_back', false], "'no purchase' makes it plain money in");
      imports.updateRow(db, hmBack.id, { refundOf: { rowId: acme.id } });
      rows = imports.getReview(db, sep).accounts[0].rows;
      eq([rows[1].refund.purchase.ref, rows[1].refund.suggested, rows[3].refund && rows[3].refund.purchase.ref], [{ kind: 'row', id: acme.id }, false, null], 'a purchase you choose takes its share before any suggestion');

      // Any purchase can be chosen, not only those from the same shop.
      const refs = (list) => list.map((o) => o.ref);
      imports.updateRow(db, hmBack.id, { refundOf: null });
      imports.updateRow(db, acmeBack.id, { refundOf: 'none' });
      eq(imports.refundOptions(db, cashback.id, '').map((o) => o.remainingCents), [4000, 5000], 'what is left of each counts the refunds in this upload');
      imports.updateRow(db, acmeBack.id, { refundOf: null });
      eq(imports.refundOptions(db, cashback.id, '').some((o) => o.ref.id === acme.id), false, 'a purchase refunded in full is not offered');
      imports.updateRow(db, acmeBack.id, { refundOf: 'none' });
      eq(refs(imports.refundOptions(db, cashback.id, '')), [{ kind: 'row', id: acme.id }, { kind: 'row', id: hm.id }], 'money in lists every purchase it could refund, newest first, whatever the shop');
      eq(refs(imports.refundOptions(db, cashback.id, 'acme')), [{ kind: 'row', id: acme.id }], 'filtered by name');
      eq(refs(imports.refundOptions(db, cashback.id, 'CLOTH')).length, 2, 'or by category, ignoring case');
      eq(imports.refundOptions(db, cashback.id, 'nothing like it'), [], 'and nothing when nothing matches');
      eq(imports.refundOptions(db, hmBack.id, '').some((o) => o.ref.id === parcel.id), false, "a purchase that isn't imported isn't offered");
      throws(() => imports.refundOptions(db, hm.id, ''), 'Only money in', 'a purchase has no refund options');
      imports.updateRow(db, cashback.id, { refundOf: { rowId: hm.id } });
      rows = imports.getReview(db, sep).accounts[0].rows;
      eq([rows[6].refund.purchase.ref, rows[6].writesAs, rows[6].categoryId], [{ kind: 'row', id: hm.id }, 'refund', clothingCat], 'and the one chosen is what it refunds');
      db.close();
    }

    await ipcChecks();

    console.log('IMPORT_REPO_OK');
  } catch (err) {
    console.error('IMPORT_REPO_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(code);
  }
});

/* ---- the import:* and bank channels, against a real database under the sandbox ----
   Handlers are captured rather than registered, as in categories-electron.cjs. */
async function ipcChecks() {
  // Run as a script, the app path is tests/; the schema lives at the repo root.
  app.getAppPath = () => root;
  const mainDb = require(path.join(root, 'build', 'main', 'db.js'));
  const handlers = new Map();
  ipcMain.handle = (channel, fn) => handlers.set(channel, fn);
  require(path.join(root, 'build', 'main', 'ipc', 'imports.js')).registerImportIpc();
  const call = async (channel, payload) => {
    const fn = handlers.get(channel);
    if (!fn) throw new Error(`no handler for ${channel}`);
    return fn({}, payload);
  };
  const data = async (channel, payload) => {
    const res = await call(channel, payload);
    if ('error' in res) throw new Error(`${channel}: ${res.error}`);
    return res.data;
  };

  const db = mainDb.initDb();
  const sep = months.insertMonth(db, '2026-09');
  const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
  const food = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Food' });
  const foodCat = months.getItemById(db, food).category_id;
  const joint = accounts.insertAccount(db, { name: 'Joint', kind: 'joint', owner_member_id: null, sort_order: 0, color: null });
  const upload = { monthId: sep, accountId: joint, filename: 'sep.csv', text: fixture('natwest') };

  // No bank yet: a coded refusal the UI can act on.
  const refused = await call('import:addFile', upload);
  eq([refused.code, refused.detail], ['needs_bank', { preset: 'natwest', products: null }], 'import:addFile says the account needs its bank');
  assert(refused.error.includes('Joint'), 'with copy naming the account');

  // Set the bank up, as the inline setup would, and retry.
  const bank = await data('bank:create', { name: 'NatWest', preset: 'natwest' });
  eq([bank.name, bank.preset], ['NatWest', 'natwest'], 'bank:create returns the bank');
  await data('bank:rename', { id: bank.id, name: 'Joint NatWest' });
  eq((await data('bank:list')).map((k) => k.name), ['Joint NatWest'], 'bank:list and bank:rename');
  await data('account:setBank', { accountId: joint, bankId: bank.id, product: null });
  const file = await data('import:addFile', upload);
  eq([file.filename, file.rowCount], ['sep.csv', 3], 'import:addFile adds the file');
  const dup = await call('import:addFile', upload);
  eq([dup.error, dup.code], ['That file is already in this upload.', undefined], 'an ordinary refusal has no code');

  let review = await data('import:review', { monthId: sep });
  eq([review.batch.id, review.accounts[0].bank.name, review.accounts[0].rows.length], [file.batchId, 'Joint NatWest', 3], 'import:review');
  const [deli] = review.accounts[0].rows;
  await data('import:updateRow', { rowId: deli.id, patch: { categoryId: foodCat } });
  review = await data('import:review', { monthId: sep });
  eq(review.accounts[0].rows[0].included, true, 'import:updateRow records a decision');
  const notCredit = await call('import:refundOptions', { rowId: deli.id, query: '' });
  eq(notCredit.error, 'Only money in can be a refund.', 'import:refundOptions answers in the envelope');

  const confirmed = await data('import:confirm', { batchId: file.batchId });
  eq([confirmed.entries, confirmed.totalCents], [1, 250], 'import:confirm');
  eq((await data('import:history', { monthId: sep })).map((h) => h.entries), [1], 'import:history');
  await data('import:undo', { batchId: file.batchId });
  eq((await data('import:history', { monthId: sep })), [], 'import:undo');
  await data('import:removeFile', { fileId: file.id });
  eq((await data('import:review', { monthId: sep })).accounts[0].files, [], 'import:removeFile');
  await data('import:discard', { batchId: file.batchId });
  eq((await data('import:review', { monthId: sep })).batch, null, 'import:discard');
  mainDb.closeDb();
}
