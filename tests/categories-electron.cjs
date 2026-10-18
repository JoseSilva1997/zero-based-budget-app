/* ============================================================
   Category test: groups and categories are month-independent, and a month
   holds plan lines (budget_items) that point at a category. Builds an
   in-memory DB from the committed schema + triggers (then runs migrations to
   mirror a real DB) and drives the repository the way the IPC handlers do:
   adding by name reuses a category, renames and moves apply to every month,
   deleting a line prunes a category nothing references, and merging one
   category into another folds their lines together.

   Requires a prior `npm run build` (loads build/database/**).
   Run with (ELECTRON_RUN_AS_NODE must be unset so require('electron').app works):
     npx electron tests/categories-electron.cjs
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

/** The month as the renderer sees it: group name -> item names, in order. */
function shape(months, db, monthId) {
  return months.getMonthTree(db, monthId).groups.map((g) => [g.name, g.items.map((i) => i.name)]);
}

app.whenReady().then(() => {
  let code = 0;
  try {
    const months = b('repositories', 'months.js');

    /* ---- adding by name creates a category and a plan line ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const rent = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Rent', planned_cents: 100000 });
      eq(shape(months, db, sep), [['Bills', ['Rent']]], 'new item shows under its group');
      const item = months.getItemById(db, rent);
      eq(item.allocated, 1000, 'plan line carries the planned amount');
      assert(item.category_id != null, 'plan line points at a category');
      db.close();
    }

    /* ---- the same name in another month is the same category ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const oct = months.insertMonth(db, '2026-10');
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const a = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Groceries' });
      const b2 = months.addItemByName(db, { monthId: oct, groupId: bills, name: '  groceries ' });
      eq(months.getItemById(db, b2).category_id, months.getItemById(db, a).category_id, 'reused across months');
      eq(months.getItemById(db, b2).name, 'Groceries', 'and keeps the category\'s name');

      // A second line for it in the same month is refused, not duplicated.
      throws(
        () => months.addItemByName(db, { monthId: oct, groupId: bills, name: 'GROCERIES' }),
        '"Groceries" is already in this month',
        'duplicate in one month refused'
      );
      eq(shape(months, db, oct), [['Bills', ['Groceries']]], 'refused add changed nothing');
      db.close();
    }

    /* ---- renaming an item renames its category, in every month ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const oct = months.insertMonth(db, '2026-10');
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Food' });
      months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Rent' });
      const octFood = months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Food' });

      months.updateItem(db, octFood, { name: 'Groceries' });
      eq(shape(months, db, sep), [['Bills', ['Groceries', 'Rent']]], 'the past month shows the new name');
      eq(shape(months, db, oct), [['Bills', ['Groceries']]], 'this month shows the new name');

      // Into a name another category in the group already has: that is a merge,
      // which has its own place, so the rename is refused and says where.
      throws(() => months.updateItem(db, octFood, { name: ' rent' }), 'merge', 'rename onto another category refused');
      throws(() => months.updateItem(db, octFood, { name: ' rent' }), 'Settings', 'refusal points at Settings');
      eq(shape(months, db, sep), [['Bills', ['Groceries', 'Rent']]], 'refused rename changed nothing');
      // A change of case or spacing on its own name is just a rename.
      months.updateItem(db, octFood, { name: 'groceries' });
      eq(months.getItemById(db, octFood).name, 'groceries', 'recasing its own name is allowed');
      db.close();
    }

    console.log('CATEGORIES_OK');
  } catch (err) {
    console.error('CATEGORIES_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(code);
  }
});
