/* ============================================================
   Banks test: the banks you hold accounts with, each reading its
   statements through a built-in preset, and what an account remembers
   about its bank for uploads (the bank, the Revolut product, and the
   account identifier from the first statement). Builds an in-memory DB from
   the committed schema + triggers, runs migrations to mirror a real DB, and
   drives the repository.

   Requires a prior `npm run build` (loads build/database/**).
   Run with (ELECTRON_RUN_AS_NODE must be unset so require('electron').app works):
     npx electron tests/banks-electron.cjs
   ============================================================ */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

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
    return;
  }
  throw new Error(`${msg}: expected a refusal, got none`);
}

const root = path.join(__dirname, '..');
const b = (...p) => require(path.join(root, 'build', 'database', ...p));

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

app.whenReady().then(() => {
  let code = 0;
  try {
    const banks = b('repositories', 'banks.js');

    /* ---- creating and listing banks ---- */
    {
      const db = freshDb();
      const nat = banks.createBank(db, { name: '  Joint   NatWest ', preset: 'natwest' });
      banks.createBank(db, { name: 'Lloyds', preset: 'lloyds' });
      eq(
        banks.listBanks(db).map((k) => [k.name, k.preset]),
        [['Joint NatWest', 'natwest'], ['Lloyds', 'lloyds']],
        'banks list by name, stored trimmed and collapsed'
      );
      eq(banks.getBank(db, nat).name, 'Joint NatWest', 'a bank reads back by id');

      throws(
        () => banks.createBank(db, { name: 'joint natwest', preset: 'natwest' }),
        'There\'s already a bank called "Joint NatWest". Give this one another name.',
        'a name in use is refused, ignoring case and spacing'
      );
      throws(() => banks.createBank(db, { name: '   ', preset: 'monzo' }), 'A bank needs a name.', 'a blank name is refused');
      throws(() => banks.createBank(db, { name: 'HSBC', preset: 'hsbc' }), "House Budget can't read statements from that bank yet.", 'an unknown preset is refused');
      eq(banks.listBanks(db).length, 2, 'refusals add nothing');
      db.close();
    }

    /* ---- renaming ---- */
    {
      const db = freshDb();
      const nat = banks.createBank(db, { name: 'NatWest', preset: 'natwest' });
      banks.createBank(db, { name: 'Lloyds', preset: 'lloyds' });
      banks.renameBank(db, nat, ' Joint  NatWest');
      eq(banks.getBank(db, nat).name, 'Joint NatWest', 'a rename is stored cleaned');
      banks.renameBank(db, nat, 'JOINT NATWEST');
      eq(banks.getBank(db, nat).name, 'JOINT NATWEST', 'a bank may change the case of its own name');
      throws(() => banks.renameBank(db, nat, 'lloyds'), 'There\'s already a bank called "Lloyds".', 'another bank\'s name is refused');
      throws(() => banks.renameBank(db, nat, ''), 'A bank needs a name.', 'a blank name is refused');
      eq(banks.getBank(db, nat).name, 'JOINT NATWEST', 'a refused rename changes nothing');
      db.close();
    }

    /* ---- an account's bank and Revolut product ---- */
    {
      const db = freshDb();
      const accounts = b('repositories', 'accounts.js');
      const main = accounts.insertAccount(db, { name: 'Main', kind: 'main', owner_member_id: null, sort_order: 0, color: null });
      const rev = banks.createBank(db, { name: 'Revolut', preset: 'revolut' });
      const fields = () => {
        const a = accounts.getAccountById(db, main);
        return [a.bank_id, a.bank_product, a.account_identifier];
      };
      eq(fields(), [null, null, null], 'a new account has no bank');

      banks.setAccountBank(db, main, rev, 'Current');
      eq(fields(), [rev, 'Current', null], 'an account takes a bank and the product it is');
      banks.setAccountBank(db, main, rev, null);
      eq(fields(), [rev, null, null], 'the product can be cleared');
      throws(() => banks.setAccountBank(db, main, rev + 99, null), 'That bank is no longer in your list', 'a missing bank is refused');
      eq(fields(), [rev, null, null], 'a refused change changes nothing');
      banks.setAccountBank(db, main, null, null);
      eq(fields(), [null, null, null], 'an account can be left without a bank');
      db.close();
    }

    console.log('BANKS_OK');
  } catch (err) {
    console.error('BANKS_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(code);
  }
});
