/* ============================================================
   Selectors: pure derivations over AppState / a month / a group. No React,
   no mutation. These are the read model that the UI renders from.
   ============================================================ */
import { round2 } from "./format.js";
import { monthLabel } from "./dates.js";

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

/** Items from earlier months not already present in the target month, ranked
 *  most-recent-first and filtered by an optional fuzzy query. */
export function reusableItemCandidates(state, monthId, query = "") {
  const current = state.months[monthId];
  if (!current) return [];

  const currentNames = new Set();
  current.groups.forEach((g) => g.items.forEach((it) => currentNames.add(normalizeItemName(it.name))));

  const terms = normalizeItemName(query).split(" ").filter(Boolean);
  const seen = new Set();
  const out = [];
  const monthIds = [...state.order].filter((id) => id !== monthId && state.months[id]).sort().reverse();

  monthIds.forEach((mid) => {
    const mo = state.months[mid];
    mo.groups.forEach((g) => g.items.forEach((it) => {
      const key = normalizeItemName(it.name);
      if (!key || currentNames.has(key) || seen.has(key)) return;

      const haystack = normalizeItemName(`${it.name} ${g.name}`);
      if (terms.length && !terms.every((t) => haystack.includes(t))) return;

      seen.add(key);
      out.push({
        name: it.name,
        allocated: it.allocated || 0,
        account: it.account || null,
        groupName: g.name,
        isSavings: !!g.isSavings,
        month: mid,
        monthLabel: monthLabel(mid).short,
      });
    }));
  });

  return out.slice(0, 30);
}

/* Per-month time series, one element per month in state.order. Categories are
   keyed by name (ids are regenerated when a month is copied), matching the rest
   of the trend code. Shared by History + Dashboard. */
export function buildSeries(state) {
  return state.order.map((id) => {
    const mo = state.months[id];
    const byGroup = {};
    mo.groups.forEach((g) => { byGroup[g.name] = round2((byGroup[g.name] || 0) + groupActual(g)); });
    // savings allocated per category (item name) for this month
    const savingsByCat = {};
    mo.groups.filter((g) => g.isSavings).forEach((g) => g.items.forEach((it) => {
      savingsByCat[it.name] = round2((savingsByCat[it.name] || 0) + it.allocated);
    }));
    const over = overBudgetItems(mo);
    return {
      id, label: monthLabel(id).short, mo,
      income: monthIncome(mo), alloc: monthAllocated(mo), actual: monthActual(mo),
      savings: monthSavings(mo), byGroup, savingsByCat, overCount: over.length, over,
    };
  });
}
