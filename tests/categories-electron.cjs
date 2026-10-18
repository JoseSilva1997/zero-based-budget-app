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
const { app, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Before anything reads it: the IPC block opens a real database under
// userData, and this run must not touch the real one.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-categories-test-'));
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

app.whenReady().then(async () => {
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
      // Bills is left with no category at all, so it is deleted rather than
      // showing empty in every month.
      eq(shape(months, db, oct), [['Home', ['Cleaning', 'Power']]], 'moved in this month; the emptied group is gone');
      eq(shape(months, db, sep), [['Home', ['Cleaning', 'Power']]], 'and in the past month');
      eq(db.prepare(`SELECT COUNT(*) n FROM budget_groups WHERE id = ?`).get(bills).n, 0, 'the emptied group is deleted');

      // The destination already has an item by that name: refused, as a rename would be.
      const bills2 = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      months.addItemByName(db, { monthId: oct, groupId: bills2, name: 'Water' });
      const homeWater = months.addItemByName(db, { monthId: sep, groupId: home, name: 'water' });
      throws(() => months.moveItem(db, homeWater, bills2, null), 'merge the categories in Settings', 'move onto a same-named item refused');
      eq(shape(months, db, sep), [['Bills', []], ['Home', ['Cleaning', 'Power', 'water']]], 'refused move changed nothing');
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
      eq(shape(months, db, oct), [['Bills', []]], 'gone from this month; the group still shows, empty');
      eq(db.prepare(`SELECT COUNT(*) n FROM budget_item_actual_entries`).get().n, 0, 'its entries went with it');
      eq(shape(months, db, sep), [['Bills', ['Gym']]], 'the other month keeps its line');
      eq(months.getItemById(db, sepGym).category_id, gymCat, 'so the category stays');

      months.deleteItem(db, sepGym);
      eq(catCount(), 0, 'its last line gone, the category is deleted');
      eq(shape(months, db, sep), [], 'and its group, left with no category, too');
      db.close();
    }

    /* ---- visibility: every active group in every month ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
      const fun = months.insertGroup(db, { name: 'Fun', kind: 'spend', sort_order: 1, collapsed: 0 });
      months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Rent' });
      months.addItemByName(db, { monthId: sep, groupId: fun, name: 'Cinema' });

      // A month started empty still offers every group, so nothing is re-made.
      const oct = months.insertMonth(db, '2026-10');
      eq(shape(months, db, oct), [['Bills', []], ['Fun', []]], 'an empty month shows every active group');

      // An archived group shows only where it still has a line.
      db.prepare(`UPDATE budget_groups SET archived = 1 WHERE id = ?`).run(fun);
      eq(shape(months, db, oct), [['Bills', []]], 'an archived group is left out of a month without its lines');
      eq(shape(months, db, sep), [['Bills', ['Rent']], ['Fun', ['Cinema']]], 'and kept where it has them');
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

      // An active group shows in every month, so it can be filled anywhere.
      eq(shape(months, db, oct), [['Bills', ['Rent']], ['New', []]], 'a new group shows in October');
      eq(shape(months, db, sep), [['Bills', ['Rent', 'Power']], ['New', []]], 'and in September');
      months.addItemByName(db, { monthId: oct, groupId: fresh, name: 'Thing' });
      eq(shape(months, db, sep), [['Bills', ['Rent', 'Power']], ['New', []]], 'a filled group still shows, empty, elsewhere');

      // Rename, kind and collapse are the group's, so every month sees them.
      months.updateGroup(db, bills, { name: 'House', kind: 'debt', collapsed: 1 });
      const sepGroup = months.getMonthTree(db, sep).groups[0];
      eq([sepGroup.name, sepGroup.kind, sepGroup.collapsed], ['House', 'debt', true], 'group edits are global');

      // Deleting from October takes October's lines; September keeps its own.
      months.deleteGroup(db, bills, oct);
      // Still used in September, so the group is archived: it leaves every
      // month where it has no line, and stays where it has one.
      eq(shape(months, db, oct), [['New', ['Thing']]], 'gone from October');
      eq(shape(months, db, sep), [['House', ['Rent', 'Power']], ['New', []]], 'September untouched');
      eq(db.prepare(`SELECT archived FROM budget_groups WHERE id = ?`).get(bills), { archived: 1 }, 'still used, so the group is archived');
      const nov = months.insertMonth(db, '2026-11');
      eq(shape(months, db, nov), [['New', []]], 'and a new month leaves it out');

      // Deleted from the last month that used it, nothing refers to it: gone.
      months.deleteGroup(db, bills, sep);
      eq(db.prepare(`SELECT COUNT(*) n FROM budget_groups WHERE id = ?`).get(bills).n, 0, 'unused group deleted');
      eq(db.prepare(`SELECT COUNT(*) n FROM categories`).get().n, 1, 'and its categories with it');
      eq(shape(months, db, sep), [['New', []]], 'September has only the other group');

      // An empty group deleted from any month is simply gone.
      const empty = months.insertGroup(db, { name: 'Empty', kind: 'spend', sort_order: 2, collapsed: 0 });
      months.deleteGroup(db, empty, sep);
      eq(db.prepare(`SELECT COUNT(*) n FROM budget_groups WHERE id = ?`).get(empty).n, 0, 'empty group deleted');
      eq(db.pragma('foreign_key_check'), [], 'no dangling references');
      db.close();
    }

    /* ---- adding a group by name reuses the one already there ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const oct = months.insertMonth(db, '2026-10');
      const bills = months.addGroupByName(db, 'Bills');
      eq(shape(months, db, sep), [['Bills', []]], 'a new name makes a new group');
      eq(months.addGroupByName(db, '  bills '), bills, 'the same name, however typed, is the same group');
      eq(db.prepare(`SELECT COUNT(*) n FROM budget_groups`).get().n, 1, 'so no second one is made');

      // Deleted from October while September still uses it: archived. Adding
      // it again by name brings it back rather than starting a namesake.
      months.addItemByName(db, { monthId: sep, groupId: bills, name: 'Rent' });
      months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Rent' });
      months.deleteGroup(db, bills, oct);
      eq(shape(months, db, oct), [], 'gone from October');
      eq(months.addGroupByName(db, 'BILLS'), bills, 're-adding finds the archived group');
      eq(shape(months, db, oct), [['Bills', []]], 'and un-archives it');
      const fun = months.addGroupByName(db, 'Fun');
      eq(fun !== bills, true, 'another name is another group');

      // Renaming onto a name another group has would make two of one group.
      throws(() => months.updateGroup(db, fun, { name: ' bills ' }), 'already a group called "Bills"', 'group rename clash refused');
      eq(months.getGroupById(db, fun).name, 'Fun', 'the refused rename changed nothing');
      months.updateGroup(db, fun, { name: 'FUN', collapsed: 1 });
      eq(months.getGroupById(db, fun).name, 'FUN', 'recasing its own name is allowed');
      months.updateGroup(db, bills, { collapsed: 1 });
      eq(months.getGroupById(db, bills).collapsed, true, 'an edit without a name is not checked');
      db.close();
    }

    /* ---- adding a line for a category in an archived group un-archives the group ---- */
    {
      const db = freshDb();
      const sep = months.insertMonth(db, '2026-09');
      const oct = months.insertMonth(db, '2026-10');
      const car = months.addGroupByName(db, 'Car');
      const sepIns = months.addItemByName(db, { monthId: sep, groupId: car, name: 'Insurance' });
      months.addItemByName(db, { monthId: sep, groupId: car, name: 'Fuel' });
      months.addItemByName(db, { monthId: oct, groupId: car, name: 'Insurance' });
      const archived = () => db.prepare(`SELECT archived FROM budget_groups WHERE id = ?`).get(car).archived;

      // A pick from the reusable list brings the group back, as it does its category.
      months.deleteGroup(db, car, oct);
      eq(archived(), 1, 'deleted from October, Car is archived');
      months.addItemForCategory(db, { monthId: oct, categoryId: months.getItemById(db, sepIns).category_id });
      eq(archived(), 0, 'picking one of its categories un-archives the group');
      const nov = months.insertMonth(db, '2026-11');
      eq(shape(months, db, nov), [['Car', []]], 'so new months offer it again');

      // So does adding by name into it.
      months.deleteGroup(db, car, oct);
      eq(archived(), 1, 'archived again');
      months.addItemByName(db, { monthId: oct, groupId: car, name: 'fuel' });
      eq(archived(), 0, 'adding by name into it un-archives the group');
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

      // Home is left with no category, so it is deleted, as after deleting its last item.
      eq(shape(months, db, sep), [['Bills', ['Groceries']]], 'September\'s line now reads Groceries, in its group');
      eq(db.prepare(`SELECT COUNT(*) n FROM budget_groups WHERE id = ?`).get(home).n, 0, 'the emptied group is deleted');
      eq(months.getItemById(db, sepFood).allocated, 100, 'a month only A had keeps its line and amount');
      eq(months.getItemById(db, sepFood).actuals.length, 2, 'and its entries');
      eq(shape(months, db, oct), [['Bills', ['Rent', 'Groceries']]], 'October has one Groceries line');
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
      eq(shape(months, db, oct), [['Bills', ['Rent']], ['Car', ['Insurance']], ['Home', []]], 'the pick lands in its own group');
      eq(months.reusableItemCandidates(db, oct, 'insurance').map((c) => c.groupName), ['Home'], 'and leaves the list');

      // An entry logged under a renamed category still finds its line.
      months.updateItem(db, picked, { name: 'Car insurance' });
      const sugg = months.actualEntrySuggestions(db, oct, 'aviva');
      eq(sugg.map((x) => [x.itemId, x.itemName, x.groupName]), [[picked, 'Car insurance', 'Car']], 'resolved by category, not by name');
      db.close();
    }

    await ipcChecks();

    console.log('CATEGORIES_OK');
  } catch (err) {
    console.error('CATEGORIES_FAIL', err && err.stack ? err.stack : err);
    code = 1;
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
    // app.exit, not process.exitCode + app.quit: quitting resets the code to 0,
    // which would let a failure here pass silently in the npm test chain.
    app.exit(code);
  }
});

/* ---- the category:* channels, against a real database under the sandbox ----
   Handlers are captured rather than registered, as in backup-electron.cjs. */
async function ipcChecks() {
  const months = b('repositories', 'months.js');
  const backups = b('repositories', 'backups.js');
  // Run as a script, the app path is tests/; the schema lives at the repo root.
  app.getAppPath = () => root;
  const mainDb = require(path.join(root, 'build', 'main', 'db.js'));
  const { backupsDir } = require(path.join(root, 'build', 'main', 'paths.js'));
  const handlers = new Map();
  ipcMain.handle = (channel, fn) => handlers.set(channel, fn);
  require(path.join(root, 'build', 'main', 'ipc', 'categories.js')).registerCategoryIpc();
  const call = (channel, payload) => {
    const fn = handlers.get(channel);
    if (!fn) throw new Error(`no handler for ${channel}`);
    return fn({}, payload);
  };

  const db = mainDb.initDb();
  const sep = months.insertMonth(db, '2026-09');
  const oct = months.insertMonth(db, '2026-10');
  const bills = months.insertGroup(db, { name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
  const fun = months.insertGroup(db, { name: 'Fun', kind: 'spend', sort_order: 1, collapsed: 0 });
  const sepOut = months.addItemByName(db, { monthId: sep, groupId: fun, name: 'Going out' });
  months.addItemByName(db, { monthId: oct, groupId: fun, name: 'Going out' });
  const octGroc = months.addItemByName(db, { monthId: oct, groupId: bills, name: 'Groceries' });
  months.insertActualEntry(db, { budget_item_id: sepOut, spent_on: '2026-09-05', amount_cents: 900, name: null, note: null });
  const out = months.getItemById(db, sepOut).category_id;
  const groc = months.getItemById(db, octGroc).category_id;

  const list = await call('category:list');
  eq(list.data.map((c) => [c.groupName, c.name, c.lines, c.entries]), [['Bills', 'Groceries', 1, 0], ['Fun', 'Going out', 2, 1]], 'category:list');

  await call('category:setArchived', { id: groc, archived: true });
  eq((await call('category:list')).data[0].archived, true, 'category:setArchived archives');
  await call('category:setArchived', { id: groc, archived: false });
  eq((await call('category:list')).data[0].archived, false, 'and restores');

  eq((await call('category:previewMerge', { fromId: out, intoId: groc })).data, { entries: 1, months: 2 }, 'category:previewMerge');
  const self = await call('category:previewMerge', { fromId: out, intoId: out });
  assert(String(self.error).includes('into itself'), 'a refused preview comes back as an error envelope');

  // The merge backs up first, so the backup still holds A.
  const before = backups.listBackups(backupsDir()).length;
  const merged = await call('category:merge', { fromId: out, intoId: groc });
  eq([merged.data.entries, merged.data.months], [1, 2], 'category:merge reports what it moved');
  const taken = backups.listBackups(backupsDir());
  eq(taken.length, before + 1, 'the merge took a backup');
  eq(merged.data.backup, taken[0].fileName, 'and names it');
  const Database = require('better-sqlite3');
  const snap = new Database(taken[0].path, { readonly: true });
  eq(snap.prepare(`SELECT COUNT(*) AS n FROM categories WHERE id = ?`).get(out).n, 1, 'the backup is from before the merge');
  snap.close();
  eq((await call('category:list')).data.map((c) => c.name), ['Groceries'], 'A is gone after the merge');
  mainDb.closeDb();
}
