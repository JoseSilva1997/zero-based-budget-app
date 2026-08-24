/* ============================================================
   Selectors: pure derivations over AppState / a month / a group. No React,
   no mutation. These are the read model that the UI renders from.
   ============================================================ */
import { round2 } from "./format.js";
import { actualDay } from "./dates.js";

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
  accounts.forEach((a) => { map[a.id] = { account: a, allocated: 0, actual: 0, count: 0, items: [] }; });
  const unassigned = { account: null, allocated: 0, actual: 0, count: 0, items: [] };
  mo.groups.forEach((g) => g.items.forEach((it) => {
    const bucket = it.account && map[it.account] ? map[it.account] : unassigned;
    const actual = itemActual(it);
    bucket.allocated = round2(bucket.allocated + it.allocated);
    bucket.actual = round2(bucket.actual + actual);
    bucket.count += 1;
    // budget order (group order, then item order) so rows match Month Budget
    bucket.items.push({ id: it.id, name: it.name, group: g.name, allocated: it.allocated, actual });
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

/* The Wallet's whole read model: who moves what, the per-account breakdown,
   the savings wallets, and what is still unassigned. One function rather than
   four, because they are four cuts of the same walk over the month and the
   totals have to agree with each other. */
export function walletPlan(mo, accounts, members) {
  const totals = accountTotals(mo, accounts);
  const assigned = totals.filter((t) => t.account);
  const unassigned = totals.find((t) => !t.account) || null;
  const totalToFund = round2(assigned.reduce((a, t) => a + t.allocated, 0));

  const ownedBy = (id) => assigned.filter((t) => t.account.owner === id);
  const perPerson = members
    .map((m) => ({
      member: m,
      accts: ownedBy(m.id),
      amount: round2(ownedBy(m.id).reduce((a, t) => a + t.allocated, 0)),
    }))
    .filter((p) => p.accts.length > 0);
  const shared = assigned.filter((t) => !t.account.owner);
  const sharedAmt = round2(shared.reduce((a, t) => a + t.allocated, 0));

  // Each item in a savings group is a "wallet" of the (single) savings account.
  const savingsAccount = accounts.find((a) => a.type === "savings") || null;
  const savingsItems = [];
  mo.groups.filter((g) => g.isSavings).forEach((g) => g.items.forEach((it) => {
    const actual = itemActual(it);
    if (it.allocated > 0 || actual > 0) {
      savingsItems.push({ id: it.id, name: it.name, allocated: it.allocated, actual });
    }
  }));
  const savingsTotal = round2(savingsItems.reduce((a, it) => a + it.allocated, 0));

  /* "By account" order: grouped by owner in member order, shared accounts
     last. Savings accounts are left out - they get the per-wallet breakdown
     above instead. Sorting a filtered copy, so the caller's array is untouched. */
  const ownerRank = (owner) => {
    const i = members.findIndex((m) => m.id === owner);
    return i < 0 ? members.length : i;
  };
  const byAccount = assigned.filter((t) => t.account.type !== "savings").sort((a, b) => {
    const ao = a.account.owner, bo = b.account.owner;
    if (!ao !== !bo) return ao ? -1 : 1;
    return ownerRank(ao) - ownerRank(bo);
  });

  return { totalToFund, perPerson, shared, sharedAmt, byAccount, savingsAccount, savingsItems, savingsTotal, unassigned };
}

/** Every item in the month, flattened with its group, in screen order. */
export function flatItems(mo) {
  const out = [];
  mo.groups.forEach((g) =>
    g.items.forEach((it) => out.push({ id: it.id, name: it.name, groupId: g.id, groupName: g.name }))
  );
  return out;
}

/* The month's spending entries, newest first. Entries read back in date order,
   so "newest" is the highest id, not the last row. */
export function recentEntries(mo, limit) {
  const out = [];
  mo.groups.forEach((g) => g.items.forEach((it) => it.actuals.forEach((a) => out.push({ a, it, g }))));
  out.sort((x, y) => y.a.id - x.a.id);
  return limit ? out.slice(0, limit) : out;
}

/* The day a new entry on this item starts on: the one most recently added to
   it (so a run of receipts from the same day needs no re-typing), or the 1st
   when the item has no entries yet. */
export function nextEntryDay(item, month) {
  if (!item.actuals.length) return 1;
  return actualDay(item.actuals.reduce((a, b) => (b.id > a.id ? b : a)), month);
}

export function normalizeItemName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}
