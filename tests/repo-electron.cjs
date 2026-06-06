/* ============================================================
   Repository / SQL-aggregate test for Model B. Builds an in-memory DB from
   the committed schema + triggers (then runs migrations to mirror a real DB),
   exercises the granular write helpers, and asserts the SQL-computed
   aggregates - the highest-value target, since "actual" is now SUMmed from
   budget_item_actual_entries (there is no actual_cents).

   Requires a prior `npm run build` (loads build/database/**).
   Run with (ELECTRON_RUN_AS_NODE must be unset so require('electron').app works):
     Remove-Item Env:ELECTRON_RUN_AS_NODE; npx electron tests/repo-electron.cjs
   ============================================================ */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3');
    const b = (...p) => require(path.join(__dirname, '..', 'build', 'database', ...p));
    const { runMigrations } = b('migrations.js');
    const months = b('repositories', 'months.js');
    const accounts = b('repositories', 'accounts.js');
    const members = b('repositories', 'members.js');

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8'));
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'database', 'triggers.sql'), 'utf8'));
    db.pragma('user_version = 1');
    runMigrations(db);

    /* ---- seed members + accounts ---- */
    const alex = members.insertMember(db, { name: 'Alex', sort_order: 0, color: '#abc' });
    const main = accounts.insertAccount(db, {
      name: 'Main', kind: 'main', owner_member_id: alex, sort_order: 0, color: '#def',
    });
    const wallet = accounts.insertAccount(db, {
      name: 'Wallet', kind: 'wallet', owner_member_id: null, sort_order: 1, color: '#fed',
    });

    /* ---- seed a month with income, two groups, items, actual entries ---- */
    const mid = months.insertMonth(db, '2026-06');
    months.insertIncome(db, {
      budget_month_id: mid, household_member_id: alex, label: 'Salary', amount_cents: 300000, sort_order: 0,
    });

    const gSpend = months.insertGroup(db, { budget_month_id: mid, name: 'Bills', kind: 'spend', sort_order: 0, collapsed: 0 });
    const gSave = months.insertGroup(db, { budget_month_id: mid, name: 'Savings', kind: 'savings', sort_order: 1, collapsed: 0 });

    // Rent: planned 100000, actual 90000 (under) on Main.
    const rent = months.insertItem(db, { budget_group_id: gSpend, name: 'Rent', planned_cents: 100000, bank_account_id: main, sort_order: 0 });
    months.insertActualEntry(db, { budget_item_id: rent, spent_on: '2026-06-01', amount_cents: 50000, description: null });
    months.insertActualEntry(db, { budget_item_id: rent, spent_on: '2026-06-02', amount_cents: 40000, description: 'part 2' });

    // Food: planned 20000, actual 25000 (OVER) on Wallet.
    const food = months.insertItem(db, { budget_group_id: gSpend, name: 'Food', planned_cents: 20000, bank_account_id: wallet, sort_order: 1 });
    months.insertActualEntry(db, { budget_item_id: food, spent_on: '2026-06-05', amount_cents: 25000, description: null });

    // Emergency (savings): planned 50000, no actuals, unassigned account.
    const emerg = months.insertItem(db, { budget_group_id: gSave, name: 'Emergency', planned_cents: 50000, bank_account_id: null, sort_order: 0 });

    /* ---- monthTotals: actual == summed entries ---- */
    const totals = months.monthTotals(db, mid);
    eq(totals.income, 3000, 'totals.income');
    eq(totals.allocated, 1700, 'totals.allocated'); // 1000 + 200 + 500
    eq(totals.actual, 1150, 'totals.actual'); // 900 (rent) + 250 (food) summed from entries
    eq(totals.savings, 500, 'totals.savings');
    eq(totals.unallocated, 1300, 'totals.unallocated'); // 3000 - 1700

    /* ---- fundingPlan: per-account actual == summed entries + unassigned ---- */
    const plan = months.fundingPlan(db, mid);
    const byName = {};
    plan.forEach((r) => { byName[r.account ? r.account.name : '(unassigned)'] = r; });
    eq(byName['Main'].allocated, 1000, 'plan Main allocated');
    eq(byName['Main'].actual, 900, 'plan Main actual');
    eq(byName['Main'].count, 1, 'plan Main count');
    eq(byName['Wallet'].actual, 250, 'plan Wallet actual');
    eq(byName['(unassigned)'].allocated, 500, 'plan unassigned allocated');
    eq(byName['(unassigned)'].count, 1, 'plan unassigned count');
    assert(plan[plan.length - 1].account === null, 'unassigned bucket is last');

    /* ---- overBudgetItems: only Food (actual 250 > planned 200) ---- */
    const over = months.overBudgetItems(db, mid);
    eq(over.length, 1, 'overBudget count');
    eq(over[0].item, 'Food', 'overBudget item');
    eq(over[0].over, 50, 'overBudget over amount');

    /* ---- getMonthTree shape + dollars/date conversion ---- */
    const tree = months.getMonthTree(db, mid);
    eq(tree.month, '2026-06', 'tree month');
    eq(tree.groups.length, 2, 'tree groups');
    const rentRead = tree.groups[0].items[0];
    eq(rentRead.allocated, 1000, 'tree rent allocated');
    eq(rentRead.actuals.length, 2, 'tree rent actuals');
    eq(rentRead.actuals[0].date, '6/01', 'tree actual M/DD date');
    assert(tree.groups[1].isSavings === true, 'savings group flagged');

    /* ---- copyMonth: clones plan, NOT actuals; income only when asked ---- */
    const julId = months.copyMonth(db, mid, '2026-07', { copyIncome: false });
    const jul = months.getMonthTree(db, julId);
    eq(jul.incomes.length, 0, 'copy without income');
    eq(jul.groups.length, 2, 'copy groups');
    const julRent = jul.groups[0].items[0];
    eq(julRent.allocated, 1000, 'copy item plan preserved');
    eq(julRent.actuals.length, 0, 'copy drops actuals');
    eq(months.monthTotals(db, julId).actual, 0, 'copied month has zero actual');

    const augId = months.copyMonth(db, mid, '2026-08', { copyIncome: true });
    eq(months.getMonthTree(db, augId).incomes.length, 1, 'copy with income');

    /* ---- reorderItems rewrites sort_order ---- */
    months.reorderItems(db, gSpend, food, rent); // move Food before Rent
    const reordered = months.getMonthTree(db, mid).groups[0].items.map((i) => i.name);
    eq(JSON.stringify(reordered), JSON.stringify(['Food', 'Rent']), 'items reordered');

    /* ---- reorderGroups rewrites sort_order ---- */
    months.reorderGroups(db, mid, gSave, gSpend, false); // move Savings before Bills
    const groupOrder = months.getMonthTree(db, mid).groups.map((g) => g.name);
    eq(JSON.stringify(groupOrder), JSON.stringify(['Savings', 'Bills']), 'groups reordered');

    /* ---- granular updates ---- */
    months.updateItem(db, rent, { planned_cents: 110000 });
    eq(months.getItemById(db, rent).allocated, 1100, 'updateItem planned');
    months.updateActual(db, rent, {}); // no-op patch is safe

    /* ---- account delete nulls item refs, then succeeds ---- */
    accounts.deleteAccount(db, wallet);
    const foodRead = months.getItemById(db, food);
    eq(foodRead.account, null, 'deleted account ref nulled on item');
    const acctsLeft = accounts.listAccounts(db).map((a) => a.name);
    assert(!acctsLeft.includes('Wallet'), 'account deleted');
    // Item still works in aggregates after its account was removed.
    eq(months.fundingPlan(db, mid).find((r) => r.account === null) != null, true, 'unassigned bucket present after delete');

    /* ---- trendSeries: per-month points ---- */
    const series = months.trendSeries(db);
    eq(series.length, 3, 'trend months'); // 2026-06, 07, 08
    const jun = series.find((s) => s.month === '2026-06');
    eq(jun.income, 3000, 'trend jun income');
    eq(jun.actual, 1150, 'trend jun actual');
    eq(jun.byGroup['Bills'], 1150, 'trend byGroup Bills actual'); // 900 rent + 250 food
    eq(jun.byGroup['Savings'], 0, 'trend byGroup Savings actual (no entries)');
    eq(jun.savingsByCat['Emergency'], 500, 'trend savingsByCat');
    // over[] carries the offending item; overCount mirrors its length.
    eq(jun.overCount, jun.over.length, 'trend overCount matches over[]');
    eq(jun.over[0].item, 'Food', 'trend over[] item');
    // byDay: Food's 250 was spent on the 5th; Rent's 900 split across the 1st/2nd.
    eq(jun.byDay.length, 32, 'trend byDay length');
    eq(jun.byDay[5], 250, 'trend byDay day-5 (Food)');
    eq(jun.byDay[1], 500, 'trend byDay day-1 (Rent part 1)');
    eq(jun.byDay[2], 400, 'trend byDay day-2 (Rent part 2)');

    /* ---- reusableItemCandidates: items from other months not in target ---- */
    // August has Rent/Food/Emergency copied; June is the same names -> none new.
    const cands = months.reusableItemCandidates(db, mid, '');
    cands.forEach((c) => assert(['Rent', 'Food', 'Emergency'].includes(c.name), 'candidate name'));
    // Add a unique item to July, then it should surface for June.
    const julBills = months.getMonthTree(db, julId).groups[0].id;
    months.insertItem(db, { budget_group_id: julBills, name: 'Holiday Fund', planned_cents: 1000, bank_account_id: null, sort_order: 9 });
    const cands2 = months.reusableItemCandidates(db, mid, 'holiday');
    eq(cands2.length, 1, 'reusable filtered count');
    eq(cands2[0].name, 'Holiday Fund', 'reusable filtered name');

    /* ---- referential integrity clean throughout ---- */
    const violations = db.pragma('foreign_key_check');
    assert(violations.length === 0, `foreign-key violations: ${JSON.stringify(violations)}`);

    console.log('REPO_OK aggregates+writes verified, months=' + series.length);
    db.close();
    process.exitCode = 0;
  } catch (err) {
    console.error('REPO_FAIL', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
