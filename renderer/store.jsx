/* ============================================================
   Store: data model, mock data, reducer, selectors
   Pure logic, no React. Exported as an ES module; bundled by esbuild.
   ============================================================ */
const uid = (() => { let n = 1; return (p = "id") => `${p}_${(n++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`; })();

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function monthLabel(id) { const [y, m] = id.split("-").map(Number); return { mo: MONTH_NAMES[m - 1], yr: String(y), short: `${MONTH_NAMES[m - 1].slice(0,3)} ${y}` }; }
function prevMonthId(id) { let [y, m] = id.split("-").map(Number); m -= 1; if (m < 1) { m = 12; y -= 1; } return `${y}-${String(m).padStart(2,"0")}`; }
function nextMonthId(id) { let [y, m] = id.split("-").map(Number); m += 1; if (m > 12) { m = 1; y += 1; } return `${y}-${String(m).padStart(2,"0")}`; }

function fmt(currency, n, opts = {}) {
  const neg = n < 0; const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: opts.cents === false ? 0 : 2, maximumFractionDigits: opts.cents === false ? 0 : 2 });
  return `${neg ? "−" : opts.sign ? "+" : ""}${currency}${s}`;
}

/* ---- empty state (fresh / cleared database) ----------------------------- */
// A valid minimal AppState: the current month with nothing in it, no sample
// members or accounts. Used when the database is empty so a deleted data file
// gives a real clean slate instead of regenerating the demo data.
function buildEmpty() {
  const d = new Date();
  const mid = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return {
    settings: { currency: "$", theme: "indigo", members: [], accounts: [], autoBackup: "onclose", lastBackup: null },
    months: { [mid]: { id: mid, incomes: [], groups: [] } },
    order: [mid],
    activeMonth: mid,
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

/* ---- selectors ---------------------------------------------------------- */
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
function itemActual(it) { return round2(sum(it.actuals, a => a.amount)); }
function monthIncome(mo) { return round2(sum(mo.incomes, i => i.amount)); }
function monthAllocated(mo) { return round2(sum(mo.groups, g => sum(g.items, it => it.allocated))); }
function monthActual(mo) { return round2(sum(mo.groups, g => sum(g.items, itemActual))); }
function monthSavings(mo) { return round2(sum(mo.groups.filter(g => g.isSavings), g => sum(g.items, it => it.allocated))); }
function groupAllocated(g) { return round2(sum(g.items, it => it.allocated)); }
function groupActual(g) { return round2(sum(g.items, itemActual)); }
function monthUnallocated(mo) { return round2(monthIncome(mo) - monthAllocated(mo)); }
function overBudgetItems(mo) {
  const out = [];
  mo.groups.forEach(g => g.items.forEach(it => { const a = itemActual(it); if (a > it.allocated + 0.001) out.push({ group: g.name, item: it.name, over: round2(a - it.allocated), allocated: it.allocated, actual: a }); }));
  return out;
}
function accountTotals(mo, accounts) {
  const map = {};
  accounts.forEach(a => { map[a.id] = { account: a, allocated: 0, actual: 0, count: 0 }; });
  const unassigned = { account: null, allocated: 0, actual: 0, count: 0 };
  mo.groups.forEach(g => g.items.forEach(it => {
    const bucket = it.account && map[it.account] ? map[it.account] : unassigned;
    bucket.allocated = round2(bucket.allocated + it.allocated);
    bucket.actual = round2(bucket.actual + itemActual(it));
    bucket.count += 1;
  }));
  const list = accounts.map(a => map[a.id]).filter(b => b.count > 0 || b.allocated > 0);
  if (unassigned.count > 0) list.push(unassigned);
  return list;
}

function normalizeItemName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function reusableItemCandidates(state, monthId, query = "") {
  const current = state.months[monthId];
  if (!current) return [];

  const currentNames = new Set();
  current.groups.forEach(g => g.items.forEach(it => currentNames.add(normalizeItemName(it.name))));

  const terms = normalizeItemName(query).split(" ").filter(Boolean);
  const seen = new Set();
  const out = [];
  const monthIds = [...state.order].filter(id => id !== monthId && state.months[id]).sort().reverse();

  monthIds.forEach(mid => {
    const mo = state.months[mid];
    mo.groups.forEach(g => g.items.forEach(it => {
      const key = normalizeItemName(it.name);
      if (!key || currentNames.has(key) || seen.has(key)) return;

      const haystack = normalizeItemName(`${it.name} ${g.name}`);
      if (terms.length && !terms.every(t => haystack.includes(t))) return;

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

/* ---- reducer ------------------------------------------------------------ */
function reducer(state, action) {
  const s = structuredClone(state);
  const mo = s.months[action.month] || s.months[s.activeMonth];
  const A = action;
  const findGroup = (gid) => mo.groups.find(g => g.id === gid);
  const findItem = (gid, iid) => { const g = findGroup(gid); return g && g.items.find(i => i.id === iid); };
  switch (A.type) {
    case "setActive": s.activeMonth = A.id; break;

    case "addIncome": mo.incomes.push({ id: uid("inc"), memberId: A.memberId, amount: 0, label: "Income" }); break;
    case "updateIncome": { const inc = mo.incomes.find(i => i.id === A.id); if (inc) Object.assign(inc, A.patch); break; }
    case "removeIncome": mo.incomes = mo.incomes.filter(i => i.id !== A.id); break;

    case "updateAllocated": { const it = findItem(A.groupId, A.itemId); if (it) it.allocated = Math.max(0, round2(A.value)); break; }
    case "setItemAccount": { const it = findItem(A.groupId, A.itemId); if (it) it.account = A.account || null; break; }
    case "renameItem": { const it = findItem(A.groupId, A.itemId); if (it) it.name = A.name; break; }
    case "renameGroup": { const g = findGroup(A.groupId); if (g) g.name = A.name; break; }
    case "toggleCollapse": { const g = findGroup(A.groupId); if (g) g.collapsed = !g.collapsed; break; }
    case "setSavings": { const g = findGroup(A.groupId); if (g) g.isSavings = A.value; break; }

    case "addActual": { const it = findItem(A.groupId, A.itemId); if (it) it.actuals.push({ id: uid("a"), amount: Math.max(0, round2(A.amount)), note: A.note || "", date: A.date || makeActualDate(A.month, A.day) }); break; }
    case "updateActual": { const it = findItem(A.groupId, A.itemId); if (it) { const a = it.actuals.find(x => x.id === A.id); if (a) Object.assign(a, A.patch); } break; }
    case "removeActual": { const it = findItem(A.groupId, A.itemId); if (it) it.actuals = it.actuals.filter(x => x.id !== A.id); break; }

    case "addGroup": mo.groups.push({ id: uid("g"), name: A.name || "New group", isSavings: false, collapsed: false, items: [] }); break;
    case "deleteGroup": mo.groups = mo.groups.filter(g => g.id !== A.groupId); break;
    case "addItem": { const g = findGroup(A.groupId); if (g) g.items.push({ id: uid("it"), name: A.name || "New item", allocated: A.allocated || 0, account: A.account || null, actuals: [] }); break; }
    case "deleteItem": { const g = findGroup(A.groupId); if (g) g.items = g.items.filter(i => i.id !== A.itemId); break; }

    case "reorderGroup": { const from = mo.groups.findIndex(g => g.id === A.groupId); const to = mo.groups.findIndex(g => g.id === A.targetId); if (from !== -1 && to !== -1 && from !== to) { const [g] = mo.groups.splice(from, 1); const dest = mo.groups.findIndex(x => x.id === A.targetId); mo.groups.splice(dest + (A.after ? 1 : 0), 0, g); } break; }
    case "reorderItem": { const g = findGroup(A.groupId); if (g) { const from = g.items.findIndex(x => x.id === A.itemId); const to = g.items.findIndex(x => x.id === A.targetId); if (from !== -1 && to !== -1 && from !== to) { const [it] = g.items.splice(from, 1); const dest = g.items.findIndex(x => x.id === A.targetId); g.items.splice(dest + (from < to ? 1 : 0), 0, it); } } break; }

    case "createMonth": {
      const nid = A.id;
      let groups = [];
      if (A.copyFrom && s.months[A.copyFrom]) {
        groups = s.months[A.copyFrom].groups.map(g => ({ id: uid("g"), name: g.name, isSavings: g.isSavings, collapsed: false, items: g.items.map(it => ({ id: uid("it"), name: it.name, allocated: it.allocated, account: it.account || null, actuals: [] })) }));
      }
      let incomes = [];
      if (A.copyIncome && A.copyFrom && s.months[A.copyFrom]) {
        incomes = s.months[A.copyFrom].incomes.map(i => ({ id: uid("inc"), memberId: i.memberId, amount: i.amount, label: i.label }));
      }
      s.months[nid] = { id: nid, incomes, groups };
      if (!s.order.includes(nid)) s.order.push(nid);
      s.order.sort();
      s.activeMonth = nid;
      break;
    }

    case "updateSettings": Object.assign(s.settings, A.patch); break;
    case "addMember": s.settings.members.push({ id: uid("m"), name: A.name || "New member", color: A.color || "#7a7a7a" }); break;
    case "updateMember": { const m = s.settings.members.find(x => x.id === A.id); if (m) Object.assign(m, A.patch); break; }
    case "removeMember": s.settings.members = s.settings.members.filter(m => m.id !== A.id); break;

    case "addAccount": s.settings.accounts.push({ id: uid("acc"), name: A.name || "New account", color: A.color || "#7a7a7a", owner: A.owner || null, type: A.accType || "main" }); break;
    case "updateAccount": { const ac = s.settings.accounts.find(x => x.id === A.id); if (ac) Object.assign(ac, A.patch); break; }
    case "removeAccount": {
      s.settings.accounts = s.settings.accounts.filter(a => a.id !== A.id);
      Object.values(s.months).forEach(m => m.groups.forEach(g => g.items.forEach(it => { if (it.account === A.id) it.account = null; })));
      break;
    }

    case "restore": return A.data;
    default: break;
  }
  return s;
}
function todayMD() { const d = new Date(); return `${d.getMonth()+1}/${String(d.getDate()).padStart(2,"0")}`; }

/* ---- entry dates -------------------------------------------------------- */
/* Number of days in a "YYYY-MM" month (day 0 of the next month). */
function daysInMonth(monthId) {
  const [y, m] = String(monthId).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 28;
  return new Date(y, m, 0).getDate();
}
/* Day-of-month for an actual entry. Empty or invalid dates fall back to the
   last day of the month, so legacy entries read as month-end. */
function actualDay(entry, monthId) {
  const last = daysInMonth(monthId);
  const parts = String((entry && entry.date) || "").split("/");
  const d = Number(parts[parts.length - 1]);
  if (Number.isInteger(d) && d >= 1 && d <= last) return d;
  return last;
}
/* Build a stored "M/DD" date from a month id and a chosen day, clamped to a
   valid day for that month (blank/invalid -> last day of the month). */
function makeActualDate(monthId, day) {
  const last = daysInMonth(monthId);
  const m = Number(String(monthId).split("-")[1]);
  let d = Math.round(Number(day));
  if (!Number.isInteger(d) || d < 1) d = last;
  if (d > last) d = last;
  return `${m}/${String(d).padStart(2, "0")}`;
}

/* ---- theme registry (shared by Tweaks panel + Settings) ----------------- */
const BUDGET_THEMES = [
  { id: "indigo",  label: "Indigo",  bg: "#0d1016", accent: "#6d6ef6" },
  { id: "violet",  label: "Violet",  bg: "#0d1016", accent: "#b06bf2" },
  { id: "cyan",    label: "Cyan",    bg: "#0d1016", accent: "#3fd6ee" },
  { id: "emerald", label: "Emerald", bg: "#0d1016", accent: "#3ddc97" },
  { id: "mono",    label: "Mono",    bg: "#000000", accent: "#c4c8d4" },
  { id: "lime",    label: "Lime",    bg: "#000000", accent: "#c6f24f" },
  { id: "amber",   label: "Amber",   bg: "#000000", accent: "#facc4a" },
  { id: "rose",    label: "Rose",    bg: "#131316", accent: "#fb5e7e" },
  { id: "sky",     label: "Sky",     bg: "#131316", accent: "#5aa0ff" },
  { id: "ocean",   label: "Ocean",   bg: "#0a0f1e", accent: "#4a8df5" },
  { id: "teal",    label: "Teal",    bg: "#0a0f1e", accent: "#33dcc4" },
  { id: "sunset",  label: "Sunset",  bg: "#15110f", accent: "#fb7a45" },
];
const THEME_IDS = BUDGET_THEMES.map(t => t.id);

/* ---- chart palette (shared by History + Dashboard charts) --------------- */
const GROUP_PALETTE = [
  "oklch(0.72 0.14 158)", "oklch(0.75 0.15 45)", "oklch(0.70 0.14 245)",
  "oklch(0.72 0.15 300)", "oklch(0.80 0.14 75)", "oklch(0.70 0.16 20)",
  "oklch(0.76 0.12 195)", "oklch(0.74 0.15 120)",
];

/* ---- per-month time series (shared by History + Dashboard) -------------- */
// One element per month in state.order. Categories are keyed by name (ids are
// regenerated when a month is copied), matching the rest of the trend code.
function buildSeries(state) {
  return state.order.map(id => {
    const mo = state.months[id];
    const byGroup = {};
    mo.groups.forEach(g => { byGroup[g.name] = round2((byGroup[g.name] || 0) + groupActual(g)); });
    // savings allocated per category (item name) for this month
    const savingsByCat = {};
    mo.groups.filter(g => g.isSavings).forEach(g => g.items.forEach(it => {
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

export {
  uid, MONTH_NAMES, monthLabel, prevMonthId, nextMonthId, fmt, buildEmpty, reducer,
  BUDGET_THEMES, THEME_IDS, GROUP_PALETTE, buildSeries,
  itemActual, monthIncome, monthAllocated, monthActual, monthSavings, monthUnallocated,
  groupAllocated, groupActual, overBudgetItems, accountTotals, reusableItemCandidates, normalizeItemName, round2,
  daysInMonth, actualDay, makeActualDate,
};
