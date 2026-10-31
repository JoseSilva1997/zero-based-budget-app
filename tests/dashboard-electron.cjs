/* ============================================================
   Dashboard cards test.

   The cards at the top of the Dashboard sit on a 4-column, 3-row grid the
   household arranges, and each shows a stat it picks. Three things have to
   hold, and they live in three places:

     1. trendSeries - the per-month figures the stats are built from,
        including the ones only the cards read (spending with savings left
        out, spending per group and category by id, purchases, weekend
        spending, spending by day without savings).
     2. the 'dashboardCards' setting - written only when it has the right
        shape (on the grid, not overlapping, at most twelve), read back as
        null when it is absent or unreadable.
     3. renderer/lib/dashboardStats.js and lib/cardGrid.js - every stat's
        arithmetic over a made-up 15 months, and the grid's rules; then the
        cards as they mount: placed on the grid, sized by their area, a
        choice in a card's menu reaching onChange, and editing - adding in an
        empty cell, moving and resizing with the keyboard, removing.

   Requires a prior `npm run build` (loads build/database/**).
   Run with:  npx electron tests/dashboard-electron.cjs
   ============================================================ */
const { app, BrowserWindow } = require('electron');
const esbuild = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.disableHardwareAcceleration();
const root = path.join(__dirname, '..');
const outDir = path.join(os.tmpdir(), 'house-budget-dashboard-test');

const results = [];
function check(name, cond, msg) { results.push({ name, ok: !!cond, msg: cond ? '' : (msg || '') }); }
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(name, ok, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function throws(name, fn, needle) {
  try { fn(); } catch (err) {
    const text = String((err && err.message) || err);
    check(name, !needle || text.includes(needle), `refused with "${text}"`);
    return;
  }
  check(name, false, 'expected a refusal, got none');
}

/* ---- 1 and 2: the database side ----------------------------------------- */
function databaseSuite() {
  const Database = require('better-sqlite3');
  const b = (...p) => require(path.join(root, 'build', 'database', ...p));
  const { runMigrations } = b('migrations.js');
  const months = b('repositories', 'months.js');
  const { loadBootstrap } = b('repositories', 'bootstrap.js');
  const { setMeta } = b('repositories', 'meta.js');
  const cards = b('repositories', 'dashboardCards.js');

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(root, 'database', 'triggers.sql'), 'utf8'));
  db.pragma('user_version = 1');
  runMigrations(db);

  // June 2026: the 6th is a Saturday, the 7th a Sunday, the 8th a Monday.
  const mid = months.insertMonth(db, '2026-06');
  const gHome = months.insertGroup(db, { name: 'Home', kind: 'spend', sort_order: 0, collapsed: 0 });
  const gFood = months.insertGroup(db, { name: 'Food', kind: 'spend', sort_order: 1, collapsed: 0 });
  const gSave = months.insertGroup(db, { name: 'Savings', kind: 'savings', sort_order: 2, collapsed: 0 });
  const rent = months.addItemByName(db, { monthId: mid, groupId: gHome, name: 'Rent', planned_cents: 100000, bank_account_id: null });
  const groc = months.addItemByName(db, { monthId: mid, groupId: gFood, name: 'Groceries', planned_cents: 20000, bank_account_id: null });
  const hol = months.addItemByName(db, { monthId: mid, groupId: gSave, name: 'Holiday', planned_cents: 30000, bank_account_id: null });
  const entry = (item, on, cents) => months.insertActualEntry(db, { budget_item_id: item, spent_on: on, amount_cents: cents, name: null, note: null });
  entry(rent, '2026-06-08', 100000);
  const bought = entry(groc, '2026-06-06', 6000);
  entry(groc, '2026-06-07', 4000);
  db.prepare(`INSERT INTO budget_item_actual_entries (budget_item_id, spent_on, amount_cents, kind, refund_of_entry_id)
              VALUES (?, '2026-06-08', -1000, 'refund', ?)`).run(groc, bought);
  entry(hol, '2026-06-01', 20000);

  const catId = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;
  const p = months.trendSeries(db).find((s) => s.month === '2026-06');
  eq('actual still counts everything, savings and refunds included', p.actual, 1290);
  eq('savingsActual is what went into savings groups', p.savingsActual, 200);
  eq('byGroupId keys spending by group id', [p.byGroupId[gHome], p.byGroupId[gFood]], [1000, 90]);
  eq('byCategoryId keys spending by category id, net of refunds', p.byCategoryId[catId('Groceries')], 90);
  eq('savingsByCatId keys the planned savings by category id', p.savingsByCatId[catId('Holiday')], 300);
  eq('purchases counts spends outside savings, not refunds', p.purchases, 3);
  eq('purchaseTotal sums those purchases', p.purchaseTotal, 1100);
  eq('purchaseAmounts lists each purchase', [...p.purchaseAmounts].sort((a, b) => a - b), [40, 60, 1000]);
  eq('weekendSpend is Saturday and Sunday spending without savings', p.weekendSpend, 100);
  eq('spendByDay leaves savings out', [p.spendByDay.length, p.spendByDay[1], p.spendByDay[6], p.spendByDay[8]], [32, 0, 60, 990]);

  /* ---- the setting ---- */
  eq('no cards chosen reads as null', cards.readDashboardCards(db), null);
  eq('and bootstrap hands that null on', loadBootstrap(db).settings.dashboardCards, null);
  const chosen = [
    { stat: 'savedAllTime', x: 1, y: 1, w: 3, h: 2 },
    { stat: 'avgSpendOn', of: { kind: 'group', id: gFood }, x: 4, y: 1, w: 1, h: 3 },
    { stat: 'saveStreak', percent: 15, x: 1, y: 3, w: 1, h: 1 },
    { stat: 'goalTotal', goal: catId('Holiday'), x: 2, y: 3, w: 2, h: 1 },
  ];
  cards.writeDashboardCards(db, chosen);
  eq('chosen cards read back as written', cards.readDashboardCards(db), chosen);
  eq('and reach bootstrap', loadBootstrap(db).settings.dashboardCards, chosen);
  cards.writeDashboardCards(db, []);
  eq('no cards at all is a choice too', cards.readDashboardCards(db), []);
  cards.writeDashboardCards(db, chosen);
  const one = (extra) => ({ stat: 'avgIncome', x: 1, y: 1, w: 1, h: 1, ...extra });
  throws('refuses something that is not a list', () => cards.writeDashboardCards(db, { stat: 'x' }), 'twelve');
  throws('refuses more than twelve cards', () => cards.writeDashboardCards(db,
    Array.from({ length: 13 }, (_, i) => one({ x: (i % 4) + 1, y: Math.floor(i / 4) + 1 }))), 'twelve');
  throws('refuses a card with no stat', () => cards.writeDashboardCards(db, [{ x: 1, y: 1, w: 1, h: 1 }]), 'stat');
  throws('refuses a card with no place', () => cards.writeDashboardCards(db, [{ stat: 'avgIncome' }]), 'grid');
  throws('refuses a card off the right of the grid', () => cards.writeDashboardCards(db, [one({ x: 3, w: 3 })]), 'grid');
  throws('refuses a card below the third row', () => cards.writeDashboardCards(db, [one({ y: 3, h: 2 })]), 'grid');
  throws('refuses cards that overlap', () => cards.writeDashboardCards(db, [one({ w: 2 }), one({ x: 2 })]), 'overlap');
  throws('refuses a choice that is neither a group nor a category', () =>
    cards.writeDashboardCards(db, [one({ stat: 'avgSpendOn', of: { kind: 'account', id: 1 } })]), 'group or a category');
  eq('a refused write leaves the saved cards alone', cards.readDashboardCards(db), chosen);
  setMeta(db, 'dashboardCards', JSON.stringify([{ stat: 'savedAllTime' }]));
  eq('cards saved with no places read as null', cards.readDashboardCards(db), null);
  setMeta(db, 'dashboardCards', '{not json');
  eq('an unreadable value reads as null rather than failing startup', cards.readDashboardCards(db), null);
  db.close();
}

/* ---- 3: the stats, and the cards as they mount -------------------------- */
const PAGE_SUITE = /* js */ `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { createElement as h, useState } from 'react';
import { buildContext, computeStat, normaliseCards, DEFAULT_CARDS, STATS } from './renderer/lib/dashboardStats.js';
import { fits, moveCard, resizeCard, rectBetween, usedRows, sizeOf, freeCells, swapCards, cardAt } from './renderer/lib/cardGrid.js';
import { DashboardCards } from './renderer/DashboardCards.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const out = [];
const check = (name, cond, msg) => out.push({ name, ok: !!cond, msg: cond ? '' : (msg || '') });
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));

/* Today is October 2026. The finished months are Aug 2025 to Sep 2026, so the
   window is Oct 2025 to Sep 2026 and Aug and Sep 2025 are the months before
   it. October is in progress and November is planned ahead. */
const HOME = 1, FOOD = 2, OTHER = 3, SAVE = 9;
const RENT = 11, GROC = 21, EAT = 22, MISC = 31, HOLIDAY = 91;
const point = (month, f = {}) => {
  const spend = f.spend ?? 0;
  const day = new Array(32).fill(0);
  if (spend) { day[1] = 1000; day[12] = 200; day[20] = spend - 1200; }
  return {
    month, income: f.income ?? 0, alloc: f.alloc ?? 0, savings: f.savings ?? 0,
    actual: spend + (f.savingsActual ?? 0), savingsActual: f.savingsActual ?? 0,
    byGroupId: spend ? { [HOME]: 1000, [FOOD]: 600, [OTHER]: spend - 1600, [SAVE]: f.savingsActual ?? 0 } : {},
    byCategoryId: spend ? { [RENT]: 1000, [GROC]: 400, [EAT]: 200, [MISC]: spend - 1600, [HOLIDAY]: f.savingsActual ?? 0 } : {},
    savingsByCatId: f.savings ? { [HOLIDAY]: f.savings } : {},
    // 49 small purchases and one large one: 2100 in all, a median of 20.
    purchases: spend ? 50 : 0, purchaseTotal: spend ? 2100 : 0, weekendSpend: spend ? 500 : 0, spendByDay: day,
    purchaseAmounts: spend ? [...new Array(49).fill(20), 1120] : [],
  };
};
const windowMonths = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
                      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const special = {
  '2025-11': { alloc: 2100 },
  '2025-12': { spend: 1800 },
  '2026-01': { spend: 2600 },
  '2026-03': { savings: 720 },
  '2026-07': { savings: 600 }, '2026-08': { savings: 600 }, '2026-09': { savings: 600 },
};
const series = [
  point('2025-08', { income: 2500, savings: 100, spend: 2000, alloc: 2300, savingsActual: 200 }),
  point('2025-09', { income: 2500, savings: 100, spend: 2000, alloc: 2300, savingsActual: 200 }),
  ...windowMonths.map((m) => point(m, { income: 3000, savings: 300, spend: 2000, alloc: 2300, savingsActual: 200, ...special[m] })),
  point('2026-10', { income: 3000, savings: 1000, spend: 300, alloc: 2300 }),
  point('2026-11', { savings: 500, alloc: 2300 }),
];
const categories = [
  { id: RENT, name: 'Rent', groupId: HOME, groupName: 'Home', groupKind: 'spend', archived: false },
  { id: GROC, name: 'Groceries', groupId: FOOD, groupName: 'Food', groupKind: 'spend', archived: false },
  { id: EAT, name: 'Eating out', groupId: FOOD, groupName: 'Food', groupKind: 'spend', archived: false },
  { id: MISC, name: 'Misc', groupId: OTHER, groupName: 'Other', groupKind: 'spend', archived: false },
  { id: HOLIDAY, name: 'Holiday', groupId: SAVE, groupName: 'Savings', groupKind: 'savings', archived: false },
];
const ctx = buildContext({ allSeries: series, now: '2026-10', categories });
const stat = (card) => computeStat(card, ctx, '£');

window.__runTests = async () => {
  eq('the window is the 12 finished months', ctx.window.map((m) => m.month), windowMonths);

  // Saving
  eq('saved all time stops at this month', stat({ stat: 'savedAllTime' }), { figure: '£6,120', note: 'set aside, all time' });
  eq('saved this year', stat({ stat: 'savedThisYear' }), { figure: '£5,020', note: 'set aside in 2026' });
  eq('average share of income saved', stat({ stat: 'saveRate' }), { figure: '14%', note: 'of income saved, on average' });
  eq('best month for saving', stat({ stat: 'bestSaveMonth' }), { figure: '£720', note: 'saved in Mar 2026, the most in a month' });
  eq('longest run saving at least 15%', stat({ stat: 'saveStreak', percent: 15 }), { figure: '3 months', note: 'in a row saving 15% or more of income' });
  eq('a run can be the whole window', stat({ stat: 'saveStreak', percent: 10 }).figure, '12 months');
  eq('saving lately against before', stat({ stat: 'saveDirection' }), { figure: '20%', note: 'of income saved in the last 3 months, up from 12%' });
  eq('total toward a goal', stat({ stat: 'goalTotal', goal: HOLIDAY }), { figure: '£6,120', note: 'saved toward Holiday, all time' });

  // Spending
  eq('average spend with savings', stat({ stat: 'avgSpendWithSavings' }), { figure: '£2,233', note: 'spent a month on average, savings included' });
  eq('average spend without savings', stat({ stat: 'avgSpendWithoutSavings' }), { figure: '£2,033', note: 'spent a month on average, savings left out' });
  eq('average spend on a group', stat({ stat: 'avgSpendOn', of: { kind: 'group', id: FOOD } }), { figure: '£600', note: 'a month on Food, on average' });
  eq('average spend on a category', stat({ stat: 'avgSpendOn', of: { kind: 'category', id: EAT } }), { figure: '£200', note: 'a month on Eating out, on average' });
  eq('total spent on a group over the window', stat({ stat: 'totalSpendOn', of: { kind: 'group', id: FOOD } }), { figure: '£7,200', note: 'spent on Food in the last 12 months' });
  eq('total spent on a category over the window', stat({ stat: 'totalSpendOn', of: { kind: 'category', id: EAT } }), { figure: '£2,400', note: 'spent on Eating out in the last 12 months' });
  eq('a shorter history says how many months it covers',
     computeStat({ stat: 'totalSpendOn', of: { kind: 'group', id: FOOD } }, buildContext({ allSeries: series.slice(-6), now: '2026-10', categories }), '£'),
     { figure: '£2,400', note: 'spent on Food in the last 4 months' });
  eq('and one month says so plainly',
     computeStat({ stat: 'totalSpendOn', of: { kind: 'group', id: FOOD } }, buildContext({ allSeries: series.slice(-3), now: '2026-10', categories }), '£').note,
     'spent on Food in the last month');
  eq('total spent on a group that no longer exists shows a dash', stat({ stat: 'totalSpendOn', of: { kind: 'group', id: 404 } }).figure, '—');
  eq('share of spending on a group', stat({ stat: 'shareOn', of: { kind: 'group', id: FOOD } }), { figure: '30%', note: 'of spending goes on Food' });
  eq('share of spending on a category', stat({ stat: 'shareOn', of: { kind: 'category', id: GROC } }), { figure: '20%', note: 'of spending goes on Groceries' });
  eq('where most of the money goes', stat({ stat: 'topGroup' }), { figure: 'Home', note: 'takes the most: 49% of spending' });
  eq('share of income spent', stat({ stat: 'spendRate' }), { figure: '68%', note: 'of income spent, on average' });
  eq('how much spending swings', stat({ stat: 'spendSwing' }), { figure: '£1,800 – £2,600', note: 'spent in the lightest month and the heaviest' });
  eq('halfway day', stat({ stat: 'halfwayDay' }), { figure: 'Day 12', note: "half a month's spending has gone by then" });
  eq('purchases a month', stat({ stat: 'purchasesPerMonth' }), { figure: '50', note: 'purchases a month, on average' });
  eq('average purchase', stat({ stat: 'avgPurchase' }), { figure: '£42', note: 'the average purchase' });
  eq('weekend share', stat({ stat: 'weekendShare' }), { figure: '25%', note: 'of spending happens at weekends' });

  // The plan
  eq('months within the plan', stat({ stat: 'withinPlan' }), { figure: '10 of 12', note: 'months stayed within the plan' });
  eq('longest run within the plan', stat({ stat: 'withinPlanStreak' }), { figure: '8 months', note: 'in a row within the plan' });
  eq('how close spending lands to the plan', stat({ stat: 'planGap' }), { figure: '7%', note: 'typical gap between the plan and what went out' });
  eq('average overspend', stat({ stat: 'avgOverspend' }), { figure: '£300', note: 'over the plan, on average, in the 2 months that went over' });

  // Income
  eq('average income', stat({ stat: 'avgIncome' }), { figure: '£3,000', note: 'income a month, on average' });
  eq('income change', stat({ stat: 'incomeChange' }), { figure: '+20%', note: 'income against the 12 months before' });

  // Medians, beside the averages they mirror
  check('there is no median share of income saved', !STATS.some((s) => s.id === 'medianSaveRate'));
  eq('median spend with savings', stat({ stat: 'medianSpendWithSavings' }), { figure: '£2,200', note: 'spent in the median month, savings included' });
  eq('median spend without savings', stat({ stat: 'medianSpendWithoutSavings' }), { figure: '£2,000', note: 'spent in the median month, savings left out' });
  eq('median spend on a category', stat({ stat: 'medianSpendOn', of: { kind: 'category', id: EAT } }), { figure: '£200', note: 'on Eating out in the median month' });
  eq('median share of income spent', stat({ stat: 'medianSpendRate' }), { figure: '67%', note: 'of income spent in the median month' });
  eq('median purchases a month', stat({ stat: 'medianPurchasesPerMonth' }), { figure: '50', note: 'purchases in the median month' });
  eq('median purchase', stat({ stat: 'medianPurchase' }), { figure: '£20', note: 'the median purchase' });
  eq('median gap to the plan', stat({ stat: 'medianPlanGap' }), { figure: '4%', note: 'median gap between the plan and what went out' });
  eq('median overspend', stat({ stat: 'medianOverspend' }), { figure: '£300', note: 'over the plan in the median of the 2 months that went over' });
  eq('median income', stat({ stat: 'medianIncome' }), { figure: '£3,000', note: 'income in the median month' });
  eq('every average but the share of income saved has its median next to it in the menu',
     STATS.map((s) => s.id).filter((id) => /median/i.test(id) || ['saveRate', 'avgSpendWithSavings', 'avgSpendWithoutSavings', 'avgSpendOn', 'spendRate', 'purchasesPerMonth', 'avgPurchase', 'planGap', 'avgOverspend', 'avgIncome'].includes(id)),
     ['saveRate', 'avgSpendWithSavings', 'medianSpendWithSavings', 'avgSpendWithoutSavings', 'medianSpendWithoutSavings',
      'avgSpendOn', 'medianSpendOn', 'spendRate', 'medianSpendRate', 'purchasesPerMonth', 'medianPurchasesPerMonth', 'avgPurchase', 'medianPurchase',
      'planGap', 'medianPlanGap', 'avgOverspend', 'medianOverspend', 'avgIncome', 'medianIncome']);
  eq('a median stat that needs a choice asks for one', STATS.find((s) => s.id === 'medianSpendOn').needs, 'of');
  eq('the median of an even count is halfway between the middle two',
     computeStat({ stat: 'medianIncome' }, buildContext({ allSeries: [point('2026-08', { income: 2000 }), point('2026-09', { income: 3000 })], now: '2026-10', categories }), '£').figure,
     '£2,500');

  // Every stat in the list can be computed, and says something.
  const sample = { of: { kind: 'group', id: FOOD }, goal: HOLIDAY, percent: 10 };
  STATS.forEach((s) => {
    const r = stat({ stat: s.id, ...sample });
    check('stat ' + s.id + ' has a figure and a note', r && r.figure && r.note, JSON.stringify(r));
  });

  // Too little to go on
  const bare = buildContext({ allSeries: [point('2026-10', { income: 3000, spend: 300 })], now: '2026-10', categories });
  const none = computeStat({ stat: 'avgSpendWithSavings' }, bare, '£');
  eq('no finished month shows a dash', none.figure, '—');
  check('and says why', /finished/.test(none.note), none.note);
  eq('a group that no longer exists shows a dash', stat({ stat: 'avgSpendOn', of: { kind: 'group', id: 404 } }).figure, '—');
  eq('no month went over', computeStat({ stat: 'avgOverspend' }, buildContext({ allSeries: [point('2026-09', { spend: 2000, alloc: 2500 })], now: '2026-10', categories }), '£'),
     { figure: '£0', note: 'no month went over the plan' });

  // The saved cards, made safe
  const at = (x, y, w = 1, h = 1) => ({ x, y, w, h });
  eq('nothing saved gives the defaults', normaliseCards(null), DEFAULT_CARDS);
  eq('the defaults', DEFAULT_CARDS, [
    { stat: 'savedAllTime', ...at(1, 1, 2, 2) },
    { stat: 'saveRate', ...at(3, 1) },
    { stat: 'avgSpendWithSavings', ...at(4, 1) },
    { stat: 'withinPlan', ...at(3, 2, 2, 1) },
  ]);
  eq('no cards stays no cards', normaliseCards([]), []);
  eq('an unknown stat keeps its place, and asks for a stat', normaliseCards([{ stat: 'gone', ...at(2, 2) }]), [{ stat: 'gone', ...at(2, 2) }]);
  check('which shows a dash', stat({ stat: 'gone' }).figure === '—');
  eq('a card off the grid is dropped', normaliseCards([{ stat: 'avgIncome', ...at(4, 1, 2, 1) }]), []);
  eq('a card overlapping an earlier one is dropped', normaliseCards([{ stat: 'avgIncome', ...at(1, 1, 2, 1) }, { stat: 'saveRate', ...at(2, 1) }]),
     [{ stat: 'avgIncome', ...at(1, 1, 2, 1) }]);
  eq('a percent outside the choices falls back to 10', normaliseCards([{ stat: 'saveStreak', percent: 7, ...at(1, 1) }])[0], { stat: 'saveStreak', percent: 10, ...at(1, 1) });
  eq('a stat that needs a choice keeps it', normaliseCards([{ stat: 'avgSpendOn', of: { kind: 'category', id: 22 }, ...at(1, 1) }])[0],
     { stat: 'avgSpendOn', of: { kind: 'category', id: 22 }, ...at(1, 1) });

  // The grid's rules
  const grid = [{ stat: 'a', ...at(1, 1, 3, 2) }, { stat: 'b', ...at(4, 1, 1, 3) }];
  check('a free cell fits', fits(grid, at(1, 3)));
  check('a rectangle over a card does not', !fits(grid, at(3, 2, 1, 2)));
  check('nor one off the grid', !fits(grid, at(1, 3, 1, 2)) && !fits(grid, at(0, 1)));
  check('a card fits where it already is, when it is the one skipped', fits(grid, at(1, 1, 3, 2), 0));
  eq('moving into free cells', moveCard(grid, 0, 0, 1)[0], { stat: 'a', ...at(1, 2, 3, 2) });
  const row = [{ stat: 'a', ...at(1, 1) }, { stat: 'b', ...at(2, 1) }, { stat: 'c', ...at(3, 1) }, { stat: 'e', ...at(4, 1) }, { stat: 'd', ...at(1, 2, 2, 2) }];
  eq('two cards the same size swap places', swapCards(row, 0, 1).slice(0, 2), [{ stat: 'a', ...at(2, 1) }, { stat: 'b', ...at(1, 1) }]);
  eq('cards of different sizes swap top-left cells and keep their sizes',
     swapCards([{ stat: 'p', ...at(1, 3) }, { stat: 'q', ...at(3, 3, 2, 1) }], 0, 1),
     [{ stat: 'p', ...at(3, 3) }, { stat: 'q', ...at(1, 3, 2, 1) }]);
  check('a swap that would push a card off the grid changes nothing', swapCards(row, 3, 4) === row);
  check('a swap that would land on a third card changes nothing', swapCards(row, 0, 4) === row);
  eq('moving onto another card swaps the two', moveCard(row, 0, 1, 0).slice(0, 2), [{ stat: 'a', ...at(2, 1) }, { stat: 'b', ...at(1, 1) }]);
  check('moving onto a card it cannot swap with changes nothing', moveCard(grid, 0, 1, 0) === grid);
  eq('the card under a cell', [cardAt(row, { x: 4, y: 1 }), cardAt(row, { x: 2, y: 3 }), cardAt(row, { x: 3, y: 3 }), cardAt(row, { x: 1, y: 1 }, 0)], [3, 4, -1, -1]);
  eq('growing into free cells', resizeCard([{ stat: 'c', ...at(1, 1) }], 0, 1, 2)[0], { stat: 'c', ...at(1, 1, 2, 3) });
  check('shrinking below one cell changes nothing', resizeCard(grid, 1, -1, 0) === grid);
  eq('a dragged rectangle, either way round', [rectBetween({ x: 3, y: 2 }, { x: 1, y: 1 }), rectBetween({ x: 2, y: 1 }, { x: 2, y: 3 })],
     [at(1, 1, 3, 2), at(2, 1, 1, 3)]);
  eq('rows in use', [usedRows([]), usedRows(grid), usedRows([{ ...at(2, 2) }])], [0, 3, 2]);
  eq('free cells, row by row', freeCells(grid), [at(1, 3), at(2, 3), at(3, 3)]);
  eq('a card\\'s size follows its area', [sizeOf(at(1, 1)), sizeOf(at(1, 1, 2, 1)), sizeOf(at(1, 1, 1, 3)), sizeOf(at(1, 1, 2, 2)), sizeOf(at(1, 1, 3, 1))],
     ['sm', 'md', 'lg', 'lg', 'lg']);

  /* ---- mounted ---- */
  const host = document.createElement('div');
  document.body.appendChild(host);
  let saved = null;
  function Harness({ start, editing }) {
    const [cards, setCards] = useState(start);
    return h(DashboardCards, { cards, ctx, currency: '£', editing, onChange: (c) => { saved = c; setCards(c); } });
  }
  const root = createRoot(host);
  const render = (start, editing = false) => act(() => { root.render(h(Harness, { key: String(Math.random()), start, editing })); });
  const cardEls = () => [...host.querySelectorAll('[data-dash-card]')];
  const key = (el, k, shift = false) => act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));
  });

  await render(DEFAULT_CARDS);
  eq('four cards', cardEls().length, 4);
  eq('each placed on the grid', cardEls().map((c) => [c.style.gridColumn, c.style.gridRow]),
     [['1 / span 2', '1 / span 2'], ['3 / span 1', '1 / span 1'], ['4 / span 1', '1 / span 1'], ['3 / span 2', '2 / span 1']]);
  check('the large card is drawn large', cardEls()[0].classList.contains('is-lg') && cardEls()[1].classList.contains('is-sm') && cardEls()[3].classList.contains('is-md'),
     cardEls().map((c) => c.className).join(' | '));
  check('the large card shows its figure', cardEls()[0].textContent.includes('£6,120'), cardEls()[0].textContent);
  check('each card can be changed', cardEls().every((c) => c.querySelector('button[data-dash-card-menu]')));
  check('no empty cells outside editing', !host.querySelector('[data-dash-cell]'));
  check('no remove button outside editing', !host.querySelector('[data-dash-card-remove]'));

  await act(async () => { cardEls()[1].querySelector('button[data-dash-card-menu]').click(); });
  const income = [...document.querySelectorAll('.move-menu button')].find((b) => b.textContent.includes('Average monthly income'));
  check('the menu lists the stats', !!income);
  await act(async () => { income.click(); });
  eq('picking one saves it on that card, in its place', saved && saved[1], { stat: 'avgIncome', ...at(3, 1) });

  await act(async () => { cardEls()[2].querySelector('button[data-dash-card-menu]').click(); });
  const on = [...document.querySelectorAll('.move-menu button')].find((b) => b.textContent.includes('Average monthly spend on'));
  await act(async () => { on.click(); });
  const options = [...document.querySelectorAll('.move-menu button')].map((b) => b.textContent);
  check('a stat that needs a choice asks for it next', options.some((t) => t.includes('Food')) && options.some((t) => t.includes('Eating out')), options.join(' | '));
  check('savings are not offered as spending', !options.some((t) => t.includes('Holiday')), options.join(' | '));
  const food = [...document.querySelectorAll('.move-menu button')].find((b) => b.textContent.trim().startsWith('Food'));
  await act(async () => { food.click(); });
  eq('the choice is saved with the stat', saved && saved[2], { stat: 'avgSpendOn', of: { kind: 'group', id: FOOD }, ...at(4, 1) });

  /* ---- editing ---- */
  saved = null;
  await render(DEFAULT_CARDS, true);
  const cells = () => [...host.querySelectorAll('[data-dash-cell]')];
  eq('every free cell is offered', cells().map((c) => c.getAttribute('aria-label')),
     ['Add a card at column 1, row 3', 'Add a card at column 2, row 3', 'Add a card at column 3, row 3', 'Add a card at column 4, row 3']);
  await act(async () => { cells()[1].click(); });
  eq('a cell adds a one-cell card there', saved && saved[4], { stat: 'savedAllTime', ...at(2, 3) });
  check('and opens its menu to choose the stat', !!document.querySelector('.move-menu'));
  await act(async () => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });

  const added = cardEls()[4];
  check('a card being edited can take focus', added.tabIndex === 0);
  await key(added, 'ArrowRight');
  eq('an arrow moves it', saved[4], { stat: 'savedAllTime', ...at(3, 3) });
  await key(cardEls()[4], 'ArrowRight', true);
  eq('shift and an arrow resizes it', saved[4], { stat: 'savedAllTime', ...at(3, 3, 2, 1) });
  await key(cardEls()[4], 'ArrowUp');
  eq('an arrow onto another card swaps them', [saved[3], saved[4]],
     [{ stat: 'withinPlan', ...at(3, 3, 2, 1) }, { stat: 'savedAllTime', ...at(3, 2, 2, 1) }]);
  await key(cardEls()[4], 'ArrowLeft');
  eq('an arrow onto a card it cannot swap with is ignored', saved[4], { stat: 'savedAllTime', ...at(3, 2, 2, 1) });
  await act(async () => { cardEls()[0].querySelector('[data-dash-card-remove]').click(); });
  eq('the remove button removes it', saved.map((c) => c.stat), ['saveRate', 'avgSpendWithSavings', 'withinPlan', 'savedAllTime']);
  await key(cardEls()[0], 'Delete');
  eq('so does Delete', saved.map((c) => c.stat), ['avgSpendWithSavings', 'withinPlan', 'savedAllTime']);

  return out;
};
`;

async function pageSuite() {
  fs.mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    stdin: { contents: PAGE_SUITE, resolveDir: root, loader: 'jsx', sourcefile: 'suite.jsx' },
    bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    outfile: path.join(outDir, 'suite.js'),
  });
  fs.writeFileSync(path.join(outDir, 'index.html'),
    '<!DOCTYPE html><html><body><div id="root"></div><script src="suite.js"></script></body></html>', 'utf8');
  let win = null;
  try {
    win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, sandbox: false } });
    const pageErrors = [];
    win.webContents.on('console-message', (...args) => {
      const e = args[0];
      const level = typeof e === 'object' && e ? e.level : args[1];
      const message = typeof e === 'object' && e ? e.message : args[2];
      if (level === 'error' || level === 3) pageErrors.push(message);
    });
    await win.loadFile(path.join(outDir, 'index.html'));
    const got = await win.webContents.executeJavaScript('window.__runTests()');
    if (pageErrors.length) got.push({ name: 'no console errors in the renderer', ok: false, msg: pageErrors.join(' | ') });
    return got;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    databaseSuite();
    results.push(...(await pageSuite()));
  } catch (err) {
    results.push({ name: 'suite ran to the end', ok: false, msg: String((err && err.stack) || err) });
  }
  for (const r of results) {
    if (!r.ok) { code = 1; console.error(`FAIL  ${r.name}${r.msg ? ` - ${r.msg}` : ''}`); }
  }
  console.log(`${results.filter((r) => r.ok).length}/${results.length} dashboard checks passed`);
  app.exit(code);
});
