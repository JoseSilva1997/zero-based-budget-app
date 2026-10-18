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
    const categories = b('repositories', 'categories.js');

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

    /* ---- moving an item to another group moves its category, in every month ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const oct = months.insertMonth(db, '2026-10');
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const home = months.insertGroup(db, { name: 'Home', kind: 'spend', sort_order: 1, collapsed: 0 });
      months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Power' });
      months.addItemByName(db, { monthId: sep, groupId: home, name: 'Cleaning' });
      months.addItemByName(db, { monthId: oct, groupId: home, name: 'Cleaning' });
      const octPower = months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Power' });

      months.moveItem(db, octPower, home, null);
      // Bills is left with nothing in any month, so like a new group it shows
      // (empty) everywhere until something is added or it is deleted.
      eq(shape(months, db, oct), [['Bills', []], ['Home', ['Cleaning', 'Power']]], 'moved in this month');
      eq(shape(months, db, sep), [['Bills', []], ['Home', ['Cleaning', 'Power']]], 'and in the past month');

      // The destination already has an item by that name: refused, as a rename would be.
      months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Water' });
      const homeWater = months.addItemByName(db, { monthId: sep, groupId: home, name: 'water' });
      throws(() => months.moveItem(db, homeWater, bills, null), 'merge the categories in Settings', 'move onto a same-named item refused');
      eq(shape(months, db, sep), [['Home', ['Cleaning', 'Power', 'water']]], 'refused move changed nothing');
      db.close();
    }

    /* ---- deleting a line; the category goes once nothing refers to it ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const oct = months.insertMonth(db, '2026-10');
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const sepGym = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Gym' });
      const octGym = months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Gym' });
      months.insertActualEntry(db, { budget_item_id: octGym, spent_on: '2026-10-02', amount_cents: 3000, name: 'Fee', note: null });
      const gymCat = months.getItemById(db, octGym).category_id;
      const catCount = () => db.prepare(`SELECT COUNT(*) n FROM categories`).get().n;

      months.deleteItem(db, octGym);
      eq(shape(months, db, oct), [], 'gone from this month (Bills still has a line in September)');
      eq(db.prepare(`SELECT COUNT(*) n FROM budget_item_actual_entries`).get().n, 0, 'its entries went with it');
      eq(shape(months, db, sep), [['Bills', ['Gym']]], 'the other month keeps its line');
      eq(months.getItemById(db, sepGym).category_id, gymCat, 'so the category stays');

      months.deleteItem(db, sepGym);
      eq(catCount(), 0, 'its last line gone, the category is deleted');
      eq(shape(months, db, sep), [['Bills', []]], 'the group stays, empty');
      db.close();
    }

    /* ---- groups: shared by every month, deleted from one ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const oct = months.insertMonth(db, '2026-10');
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const fresh = months.insertGroup(db, { name: 'New', kind: 'spend', sort_order: 1, collapsed: 0 });
      months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Rent' });
      months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Power' });
      months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Rent' });

      // A group with no line anywhere shows in every month, so it can be filled.
      eq(shape(months, db, oct), [['Bills', ['Rent']], ['New', []]], 'a new group shows in October');
      eq(shape(months, db, sep), [['Bills', ['Rent', 'Power']], ['New', []]], 'and in September');
      // Once it has a line, it shows only where it has one.
      months.addItemByName(db, { monthId: oct, groupId: fresh, name: 'Thing' });
      eq(shape(months, db, sep), [['Bills', ['Rent', 'Power']]], 'a filled group leaves the months without it');

      // Rename, kind and collapse are the group's, so every month sees them.
      months.updateGroup(db, bills, { name: 'House', kind: 'debt', collapsed: 1 });
      const sepGroup = months.getMonthTree(db, sep).groups[0];
      eq([sepGroup.name, sepGroup.kind, sepGroup.collapsed], ['House', 'debt', true], 'group edits are global');

      // Deleting from October takes October's lines; September keeps its own.
      months.deleteGroup(db, bills, oct);
      eq(shape(months, db, oct), [['New', ['Thing']]], 'gone from October');
      eq(shape(months, db, sep), [['House', ['Rent', 'Power']]], 'September untouched');
      eq(db.prepare(`SELECT COUNT(*) n FROM budget_groups WHERE id = ?`).get(bills).n, 1, 'still used, so the group stays');

      // Deleted from the last month that used it, nothing refers to it: gone.
      months.deleteGroup(db, bills, sep);
      eq(db.prepare(`SELECT COUNT(*) n FROM budget_groups WHERE id = ?`).get(bills).n, 0, 'unused group deleted');
      eq(db.prepare(`SELECT COUNT(*) n FROM categories`).get().n, 1, 'and its categories with it');
      eq(shape(months, db, sep), [], 'September is empty');

      // An empty group deleted from any month is simply gone.
      const empty = months.insertGroup(db, { name: 'Empty', kind: 'spend', sort_order: 2, collapsed: 0 });
      months.deleteGroup(db, empty, sep);
      eq(db.prepare(`SELECT COUNT(*) n FROM budget_groups WHERE id = ?`).get(empty).n, 0, 'empty group deleted');
      eq(db.pragma('foreign_key_check'), [], 'no dangling references');
      db.close();
    }

    /* ---- archiving: hidden from new months, kept in history ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Rent', planned_cents: 100000 });
      const tv = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'TV licence', planned_cents: 1500 });
      const tvCat = months.getItemById(db, tv).category_id;

      categories.setCategoryArchived(db, tvCat, true);
      eq(shape(months, db, sep), [['Bills', ['Rent', 'TV licence']]], 'an archived category stays in its months');

      const oct = months.copyMonth(db, sep, '2026-10', { copyIncome: false });
      eq(shape(months, db, oct), [['Bills', ['Rent']]], 'a copied month leaves archived categories out');

      const nov = months.insertMonth(db, '2026-11');
      eq(months.reusableItemCandidates(db, nov, '').map((c) => c.name), ['Rent'], 'and so does the reusable list');

      // Adding it again by name brings it back rather than making a second one.
      const again = months.addItemByName(db, { monthId: oct, groupId: bills, name: 'tv licence' });
      eq(months.getItemById(db, again).category_id, tvCat, 'the archived category is reused');
      eq(categories.getCategory(db, tvCat).archived, 0, 'and un-archived');

      categories.setCategoryArchived(db, tvCat, false);
      eq(categories.getCategory(db, tvCat).archived, 0, 'un-archiving an active category is a no-op');
      db.close();
    }

    /* ---- listCategories: what Settings needs to archive and merge ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const oct = months.insertMonth(db, '2026-10');
      const save = months.insertGroup(db, { name: 'Savings', kind: 'savings', sort_order: 1, collapsed: 0 });
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const sepFood = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Food' });
      const octFood = months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Food' });
      const rainy = months.addItemByName(db, { monthId: sep, groupId: save, name: 'Rainy day' });
      months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Groceries' });
      for (const [line, day] of [[sepFood, '01'], [sepFood, '02'], [octFood, '03']]) {
        months.insertActualEntry(db, { budget_item_id: line, spent_on: `2026-09-${day}`, amount_cents: 100, name: null, note: null });
      }
      categories.setCategoryArchived(db, months.getItemById(db, rainy).category_id, true);

      eq(
        categories.listCategories(db).map((c) => [c.groupName, c.name, c.archived, c.lines, c.entries]),
        [
          ['Bills', 'Food', false, 2, 3],
          ['Bills', 'Groceries', false, 1, 0],
          ['Savings', 'Rainy day', true, 1, 0],
        ],
        'every category, by group order, with its archived flag and usage'
      );
      const food = categories.listCategories(db)[0];
      eq([food.groupId, food.id], [bills, months.getItemById(db, sepFood).category_id], 'ids to act on');
      db.close();
    }

    /* ---- mergeCategories: A's lines and entries fold into B ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const oct = months.insertMonth(db, '2026-10');
      const nov = months.insertMonth(db, '2026-11');
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const home = months.insertGroup(db, { name: 'Home', kind: 'spend', sort_order: 1, collapsed: 0 });
      const entry = (line, day) =>
        months.insertActualEntry(db, { budget_item_id: line, spent_on: day, amount_cents: 1000, name: null, note: null });

      // A = Food under Home, B = Groceries under Bills. Both have October.
      const sepFood = months.addItemByName(db, { monthId: sep, groupId: home, name: 'Food', planned_cents: 10000 });
      const octFood = months.addItemByName(db, { monthId: oct, groupId: home, name: 'Food', planned_cents: 10000 });
      months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Rent', planned_cents: 90000 });
      const octGroc = months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Groceries', planned_cents: 20000 });
      months.addItemByName(db, { monthId: nov, groupId: bills, name: 'Groceries', planned_cents: 20000 });
      entry(sepFood, '2026-09-01');
      entry(sepFood, '2026-09-02');
      entry(octFood, '2026-10-03');
      entry(octGroc, '2026-10-04');
      const food = months.getItemById(db, sepFood).category_id;
      const groceries = months.getItemById(db, octGroc).category_id;
      const octBefore = months.monthTotals(db, oct);

      throws(() => categories.mergeCategories(db, groceries, groceries), 'into itself', 'merge into itself refused');
      throws(() => categories.mergeCategories(db, food, groceries + 999), 'no longer', 'merge into a missing category refused');

      // The preview states the impact the confirmation names, and writes nothing.
      throws(() => categories.previewMerge(db, groceries, groceries), 'into itself', 'preview into itself refused');
      throws(() => categories.previewMerge(db, food, groceries + 999), 'no longer', 'preview of a missing category refused');
      eq(categories.previewMerge(db, food, groceries), { entries: 3, months: 2 }, 'preview counts A\'s entries and months');
      eq(shape(months, db, oct), [['Bills', ['Rent', 'Groceries']], ['Home', ['Food']]], 'the preview changed nothing');
      assert(categories.getCategory(db, food), 'A is still there after the preview');

      const impact = categories.mergeCategories(db, food, groceries);
      eq(impact, { entries: 3, months: 2 }, 'reports the entries and months it moved');

      // Home is left with nothing, so it shows empty, as after deleting its last item.
      eq(shape(months, db, sep), [['Bills', ['Groceries']], ['Home', []]], 'September\'s line now reads Groceries, in its group');
      eq(months.getItemById(db, sepFood).allocated, 100, 'a month only A had keeps its line and amount');
      eq(months.getItemById(db, sepFood).actuals.length, 2, 'and its entries');
      eq(shape(months, db, oct), [['Bills', ['Rent', 'Groceries']], ['Home', []]], 'October has one Groceries line');
      const octLine = months.getItemById(db, octGroc);
      eq(octLine.allocated, 300, 'the shared month sums the planned amounts');
      eq(octLine.actuals.length, 2, 'and holds both lines\' entries');
      eq(months.getItemById(db, octFood), undefined, 'A\'s line in the shared month is gone');
      eq(months.monthTotals(db, oct), octBefore, 'October\'s totals are unchanged');
      eq(categories.getCategory(db, food), undefined, 'A is deleted');
      eq(categories.listCategories(db).find((c) => c.id === groceries).entries, 4, 'B carries every entry');
      eq(db.pragma('foreign_key_check'), [], 'no dangling references');
      db.close();
    }

    /* ---- accounts: per line, with the category remembering the last choice ---- */
    {
      const db = freshDb();
      const accounts = b('repositories', 'accounts.js');
      const main = accounts.insertAccount(db, { name: 'Main', kind: 'main', owner_member_id: null, sort_order: 0, color: null });
      const joint = accounts.insertAccount(db, { name: 'Joint', kind: 'joint', owner_member_id: null, sort_order: 1, color: null });
      const sep = months.insertMonth(db, '2026-09');
      const oct = months.insertMonth(db, '2026-10');
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const sepRent = months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Rent', bank_account_id: main });

      months.updateItem(db, sepRent, { bank_account_id: joint });
      const octRent = months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Rent' });
      eq(months.getItemById(db, octRent).account, joint, 'a new line starts on the account last chosen');
      months.updateItem(db, octRent, { bank_account_id: main });
      eq(months.getItemById(db, sepRent).account, joint, 'another month\'s line keeps its own account');

      accounts.deleteAccount(db, main);
      eq(months.getItemById(db, octRent).account, null, 'a deleted account is cleared from lines');
      const rentCat = months.getItemById(db, octRent).category_id;
      eq(categories.getCategory(db, rentCat).bank_account_id, null, 'and from category defaults');
      db.close();
    }

    /* ---- reusable picks and entry suggestions follow the category ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const oct = months.insertMonth(db, '2026-10');
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const car = months.insertGroup(db, { name: 'Car', kind: 'spend', sort_order: 1, collapsed: 0 });
      const home = months.insertGroup(db, { name: 'Home', kind: 'spend', sort_order: 2, collapsed: 0 });
      const sepCarIns = months.addItemByName(db, { monthId: sep, groupId: car, name: 'Insurance', planned_cents: 4000 });
      months.addItemByName(db, { monthId: sep, groupId: home, name: 'Insurance', planned_cents: 2500 });
      months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Rent' });
      months.insertActualEntry(db, { budget_item_id: sepCarIns, spent_on: '2026-09-09', amount_cents: 4000, name: 'Aviva', note: null });

      // Two categories that share a name are two candidates, each with its id.
      const cands = months.reusableItemCandidates(db, oct, 'insurance');
      eq(cands.map((c) => [c.name, c.groupName, c.allocated]), [['Insurance', 'Car', 40], ['Insurance', 'Home', 25]], 'one candidate per category');

      // Picking one adds a line for THAT category, in its own group.
      const picked = months.addItemForCategory(db, { monthId: oct, categoryId: cands[0].categoryId, planned_cents: 4000 });
      eq(shape(months, db, oct), [['Bills', ['Rent']], ['Car', ['Insurance']]], 'the pick lands in its own group');
      eq(months.reusableItemCandidates(db, oct, 'insurance').map((c) => c.groupName), ['Home'], 'and leaves the list');

      // An entry logged under a renamed category still finds its line.
      months.updateItem(db, picked, { name: 'Car insurance' });
      const sugg = months.actualEntrySuggestions(db, oct, 'aviva');
      eq(sugg.map((x) => [x.itemId, x.itemName, x.groupName]), [[picked, 'Car insurance', 'Car']], 'resolved by category, not by name');
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
