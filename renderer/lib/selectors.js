/* ============================================================
   Selectors: pure derivations over AppState / a month / a group. No React,
   no mutation. These are the read model that the UI renders from.
   ============================================================ */
import { round2 } from "./format.js";

const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

export function itemActual(it) { return round2(sum(it.actuals, (a) => a.amount)); }
export function monthIncome(mo) { return round2(sum(mo.incomes, (i) => i.amount)); }
export function monthAllocated(mo) { return round2(sum(mo.groups, (g) => sum(g.items, (it) => it.allocated))); }
export function monthActual(mo) { return round2(sum(mo.groups, (g) => sum(g.items, itemActual))); }
export function monthSavings(mo) { return round2(sum(mo.groups.filter((g) => g.isSavings), (g) => sum(g.items, (it) => it.allocated))); }
export function groupAllocated(g) { return round2(sum(g.items, (it) => it.allocated)); }
export function groupActual(g) { return round2(sum(g.items, itemActual)); }
export function monthUnallocated(mo) { return round2(monthIncome(mo) - monthAllocated(mo)); }

export function overBudgetItems(mo) {
  const out = [];
  mo.groups.forEach((g) => g.items.forEach((it) => {
    const a = itemActual(it);
    if (a > it.allocated + 0.001) out.push({ group: g.name, item: it.name, over: round2(a - it.allocated), allocated: it.allocated, actual: a });
  }));
  return out;
}

export function accountTotals(mo, accounts) {
  const map = {};
  accounts.forEach((a) => { map[a.id] = { account: a, allocated: 0, actual: 0, count: 0 }; });
  const unassigned = { account: null, allocated: 0, actual: 0, count: 0 };
  mo.groups.forEach((g) => g.items.forEach((it) => {
    const bucket = it.account && map[it.account] ? map[it.account] : unassigned;
    bucket.allocated = round2(bucket.allocated + it.allocated);
    bucket.actual = round2(bucket.actual + itemActual(it));
    bucket.count += 1;
  }));
  const list = accounts.map((a) => map[a.id]).filter((b) => b.count > 0 || b.allocated > 0);
  if (unassigned.count > 0) list.push(unassigned);
  return list;
}

/** Lightweight summary for the Wallet trigger button. */
export function walletSummary(mo, accounts) {
  const totals = accountTotals(mo, accounts);
  const toFund = round2(totals.filter((t) => t.account).reduce((a, t) => a + t.allocated, 0));
  const unassigned = totals.find((t) => !t.account);
  return { toFund, hasUnassigned: !!unassigned, unassignedAmt: unassigned ? unassigned.allocated : 0 };
}

export function normalizeItemName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}
