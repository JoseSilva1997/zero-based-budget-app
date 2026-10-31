/* ============================================================
   The Dashboard's cards: the stats a household can put on them, and the
   arithmetic behind each one.

   The Dashboard is where a household sees its habits over time, so every
   stat here is a pattern across months, never a reading of one month.

   WHICH MONTHS COUNT
   ------------------
   - "All time" and "this year" stats add up every month up to and including
     the current one, and never a month planned ahead.
   - Every other stat reads the WINDOW: the last 12 finished months, meaning
     months before the current calendar month. The month in progress is left
     out because it is half a month: it would always look like a light month
     that stayed within the plan.
   - Within the window a stat only counts the months that have what it
     measures: months with spending for the spending stats, months with
     income for the income ones, months with a plan and spending for the
     plan ones. A month nobody tracked is not a month of no spending.

   WHAT "SPENDING" MEANS
   ---------------------
   Money out of spend and debt groups. What went into a savings group is put
   aside, not spent, so it is left out everywhere except the one stat that
   says "with savings". The plan stats compare the whole plan with
   everything entered, savings included, because that is what the plan is.

   A stat with too little to go on shows a dash and says what it is waiting
   for, rather than a zero that reads as a fact.
   ============================================================ */
import { fmt } from "./format.js";
import { monthLabel, nextMonthId } from "./dates.js";
import { GRID_COLS, GRID_ROWS, fits } from "./cardGrid.js";

/* The shares of income the saving streak can be set to. A short list rather
   than a typed number: it is chosen from the card's own menu. */
export const PERCENT_CHOICES = [5, 10, 15, 20, 25, 30];
const DEFAULT_PERCENT = 10;

const DASH = "—";
const empty = (note) => ({ figure: DASH, note });
const sum = (list, f) => list.reduce((a, m) => a + f(m), 0);
const avg = (list, f) => (list.length ? sum(list, f) / list.length : 0);
/* The middle value; with an even count, halfway between the middle two. */
const median = (list, f) => {
  const v = list.map(f).sort((a, b) => a - b);
  const n = v.length;
  if (!n) return 0;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
};

/* An average stat and its median twin, side by side in the menu. One
   computation, two ways of summing it up: `make(typical, def)` returns the
   compute, where `typical` is avg or median and `def.note` is that twin's
   wording (a string, or a function of whatever the note has to name).
   The median is there because one odd month (a holiday, a boiler) pulls an
   average a long way; the median is what a usual month looks like. */
const twins = (mean, mid, make) => [
  { ...mean, compute: make(avg, mean) },
  { ...mid, compute: make(median, mid) },
];
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const spent = (m) => m.actual - (m.savingsActual || 0);
const overPlan = (m) => m.actual > m.alloc + 0.005;

/* Months with spending, with income, and with a plan to measure against. */
const withSpend = (ctx) => ctx.window.filter((m) => m.actual > 0);
const withIncome = (ctx) => ctx.window.filter((m) => m.income > 0);
const withPlan = (ctx) => ctx.window.filter((m) => m.alloc > 0 && m.actual > 0);

const NO_SPEND = "needs a finished month with spending";
const NO_INCOME = "needs a finished month with income";
const NO_PLAN = "needs a finished month with a plan and spending";

/* The longest run of calendar-consecutive months in `list` that pass `ok`.
   A month missing from the list breaks the run, as a failing one does. */
function longestRun(list, ok) {
  let best = 0, run = 0, prev = null;
  for (const m of list) {
    const follows = prev != null && nextMonthId(prev) === m.month;
    run = ok(m) ? (follows ? run + 1 : 1) : 0;
    best = Math.max(best, run);
    prev = m.month;
  }
  return best;
}

/* The group or category a card looks at, as { name, value(m) }, or null when
   the card has none or it no longer exists. */
function target(ctx, of) {
  if (!of) return null;
  if (of.kind === "group") {
    const g = ctx.groups.get(of.id);
    return g ? { name: g.name, value: (m) => (m.byGroupId && m.byGroupId[of.id]) || 0 } : null;
  }
  const c = ctx.categories.get(of.id);
  return c ? { name: c.name, value: (m) => (m.byCategoryId && m.byCategoryId[of.id]) || 0 } : null;
}
const NO_TARGET = "choose a group or category from this card's menu";

/* ---- the stats ---------------------------------------------------------
   `needs` is the choice a stat asks for after it is picked: 'of' (a spend
   group or category), 'goal' (a savings category) or 'percent'. */
export const SECTIONS = ["Saving", "Spending", "The plan", "Income"];

export const STATS = [
  /* ---- saving ---- */
  {
    id: "savedAllTime", section: "Saving", label: "Saved, all time",
    compute: (ctx, card, money) => ({ figure: money(sum(ctx.toDate, (m) => m.savings)), note: "set aside, all time" }),
  },
  {
    id: "savedThisYear", section: "Saving", label: "Saved this year",
    compute: (ctx, card, money) => ({
      figure: money(sum(ctx.toDate.filter((m) => m.month.startsWith(ctx.year)), (m) => m.savings)),
      note: `set aside in ${ctx.year}`,
    }),
  },
  ...twins(
    { id: "saveRate", section: "Saving", label: "Average share of income saved", note: "of income saved, on average" },
    { id: "medianSaveRate", section: "Saving", label: "Median share of income saved", note: "of income saved in the median month" },
    (typical, d) => (ctx) => {
      const months = withIncome(ctx);
      if (!months.length) return empty(NO_INCOME);
      return { figure: pct(typical(months, (m) => m.savings / m.income)), note: d.note };
    },
  ),
  {
    id: "bestSaveMonth", section: "Saving", label: "Best month for saving",
    compute: (ctx, card, money) => {
      if (!ctx.window.length) return empty("needs a finished month");
      const best = ctx.window.reduce((a, m) => (m.savings > a.savings ? m : a), ctx.window[0]);
      if (!(best.savings > 0)) return empty("needs a finished month with savings");
      return { figure: money(best.savings), note: `saved in ${monthLabel(best.month).short}, the most in a month` };
    },
  },
  {
    id: "saveStreak", section: "Saving", label: "Longest run saving a share of income", needs: "percent",
    compute: (ctx, card) => {
      const months = withIncome(ctx);
      if (!months.length) return empty(NO_INCOME);
      const p = card.percent || DEFAULT_PERCENT;
      const n = longestRun(months, (m) => m.savings / m.income >= p / 100 - 1e-9);
      return { figure: plural(n, "month"), note: `in a row saving ${p}% or more of income` };
    },
  },
  {
    id: "saveDirection", section: "Saving", label: "Saving lately, against before",
    compute: (ctx) => {
      const months = withIncome(ctx);
      if (months.length < 4) return empty("needs four finished months with income");
      const rate = (list) => Math.round(avg(list, (m) => m.savings / m.income) * 100);
      const now = rate(months.slice(-3)), before = rate(months.slice(0, -3));
      const how = now > before ? `up from ${before}%` : now < before ? `down from ${before}%` : "the same as before";
      return { figure: `${now}%`, note: `of income saved in the last 3 months, ${how}` };
    },
  },
  {
    id: "goalTotal", section: "Saving", label: "Saved toward a goal", needs: "goal",
    compute: (ctx, card, money) => {
      const goal = card.goal != null && ctx.categories.get(card.goal);
      if (!goal) return empty("choose a savings goal from this card's menu");
      return { figure: money(sum(ctx.toDate, (m) => (m.savingsByCatId && m.savingsByCatId[card.goal]) || 0)), note: `saved toward ${goal.name}, all time` };
    },
  },

  /* ---- spending ---- */
  ...twins(
    { id: "avgSpendWithSavings", section: "Spending", label: "Average monthly spend, with savings", note: "spent a month on average, savings included" },
    { id: "medianSpendWithSavings", section: "Spending", label: "Median monthly spend, with savings", note: "spent in the median month, savings included" },
    (typical, d) => (ctx, card, money) => {
      const months = withSpend(ctx);
      if (!months.length) return empty(NO_SPEND);
      return { figure: money(typical(months, (m) => m.actual)), note: d.note };
    },
  ),
  ...twins(
    { id: "avgSpendWithoutSavings", section: "Spending", label: "Average monthly spend, without savings", note: "spent a month on average, savings left out" },
    { id: "medianSpendWithoutSavings", section: "Spending", label: "Median monthly spend, without savings", note: "spent in the median month, savings left out" },
    (typical, d) => (ctx, card, money) => {
      const months = withSpend(ctx);
      if (!months.length) return empty(NO_SPEND);
      return { figure: money(typical(months, spent)), note: d.note };
    },
  ),
  ...twins(
    { id: "avgSpendOn", section: "Spending", label: "Average monthly spend on…", needs: "of", note: (name) => `a month on ${name}, on average` },
    { id: "medianSpendOn", section: "Spending", label: "Median monthly spend on…", needs: "of", note: (name) => `on ${name} in the median month` },
    (typical, d) => (ctx, card, money) => {
      const t = target(ctx, card.of);
      if (!t) return empty(NO_TARGET);
      const months = withSpend(ctx);
      if (!months.length) return empty(NO_SPEND);
      return { figure: money(typical(months, t.value)), note: d.note(t.name) };
    },
  ),
  {
    id: "totalSpendOn", section: "Spending", label: "Total spent in the last 12 months on…", needs: "of",
    compute: (ctx, card, money) => {
      const t = target(ctx, card.of);
      if (!t) return empty(NO_TARGET);
      const n = ctx.window.length;
      if (!n) return empty("needs a finished month");
      // Says how many months it covers when the history is shorter than 12.
      const span = n === 1 ? "the last month" : `the last ${n} months`;
      return { figure: money(sum(ctx.window, t.value)), note: `spent on ${t.name} in ${span}` };
    },
  },
  {
    id: "shareOn", section: "Spending", label: "Share of spending on…", needs: "of",
    compute: (ctx, card) => {
      const t = target(ctx, card.of);
      if (!t) return empty(NO_TARGET);
      const months = withSpend(ctx);
      const total = sum(months, spent);
      if (!(total > 0)) return empty(NO_SPEND);
      return { figure: pct(sum(months, t.value) / total), note: `of spending goes on ${t.name}` };
    },
  },
  {
    id: "topGroup", section: "Spending", label: "Where most of the money goes",
    compute: (ctx) => {
      const months = withSpend(ctx);
      const total = sum(months, spent);
      if (!(total > 0)) return empty(NO_SPEND);
      let best = null;
      for (const [id, g] of ctx.groups) {
        if (g.kind === "savings") continue;
        const v = sum(months, (m) => (m.byGroupId && m.byGroupId[id]) || 0);
        if (!best || v > best.v) best = { name: g.name, v };
      }
      if (!best || !(best.v > 0)) return empty(NO_SPEND);
      return { figure: best.name, note: `takes the most: ${pct(best.v / total)} of spending` };
    },
  },
  ...twins(
    { id: "spendRate", section: "Spending", label: "Average share of income spent", note: "of income spent, on average" },
    { id: "medianSpendRate", section: "Spending", label: "Median share of income spent", note: "of income spent in the median month" },
    (typical, d) => (ctx) => {
      const months = ctx.window.filter((m) => m.income > 0 && m.actual > 0);
      if (!months.length) return empty("needs a finished month with income and spending");
      return { figure: pct(typical(months, (m) => spent(m) / m.income)), note: d.note };
    },
  ),
  {
    id: "spendSwing", section: "Spending", label: "How much monthly spending swings",
    compute: (ctx, card, money) => {
      const months = withSpend(ctx);
      if (months.length < 2) return empty("needs two finished months with spending");
      const values = months.map(spent);
      return { figure: `${money(Math.min(...values))} – ${money(Math.max(...values))}`, note: "spent in the lightest month and the heaviest" };
    },
  },
  {
    id: "halfwayDay", section: "Spending", label: "Day half the month's spending has gone",
    compute: (ctx) => {
      const months = withSpend(ctx);
      const days = new Array(32).fill(0);
      months.forEach((m) => (m.spendByDay || []).forEach((v, d) => { if (d >= 1 && d <= 31) days[d] += v; }));
      const total = days.reduce((a, v) => a + v, 0);
      if (!(total > 0)) return empty("needs a finished month with dated spending");
      let run = 0;
      for (let d = 1; d <= 31; d++) {
        run += days[d];
        if (run >= total / 2 - 1e-9) return { figure: `Day ${d}`, note: "half a month's spending has gone by then" };
      }
      return { figure: "Day 31", note: "half a month's spending has gone by then" };
    },
  },
  ...twins(
    { id: "purchasesPerMonth", section: "Spending", label: "Purchases a month", note: "purchases a month, on average" },
    { id: "medianPurchasesPerMonth", section: "Spending", label: "Median purchases a month", note: "purchases in the median month" },
    (typical, d) => (ctx) => {
      const months = withSpend(ctx);
      if (!months.length) return empty(NO_SPEND);
      return { figure: String(Math.round(typical(months, (m) => m.purchases || 0))), note: d.note };
    },
  ),
  {
    id: "avgPurchase", section: "Spending", label: "Average purchase size",
    compute: (ctx, card, money) => {
      const months = withSpend(ctx);
      const n = sum(months, (m) => m.purchases || 0);
      if (!n) return empty(NO_SPEND);
      return { figure: money(sum(months, (m) => m.purchaseTotal || 0) / n), note: "the average purchase" };
    },
  },
  {
    // The middle of every purchase in the window, not of each month's
    // average: a month of many small purchases counts for more.
    id: "medianPurchase", section: "Spending", label: "Median purchase size",
    compute: (ctx, card, money) => {
      const amounts = withSpend(ctx).flatMap((m) => m.purchaseAmounts || []);
      if (!amounts.length) return empty(NO_SPEND);
      return { figure: money(median(amounts, (v) => v)), note: "the median purchase" };
    },
  },
  {
    id: "weekendShare", section: "Spending", label: "Share of spending at weekends",
    compute: (ctx) => {
      const months = withSpend(ctx);
      const total = sum(months, spent);
      if (!(total > 0)) return empty(NO_SPEND);
      return { figure: pct(sum(months, (m) => m.weekendSpend || 0) / total), note: "of spending happens at weekends" };
    },
  },

  /* ---- the plan ---- */
  {
    id: "withinPlan", section: "The plan", label: "Months within the plan",
    compute: (ctx) => {
      const months = withPlan(ctx);
      if (!months.length) return empty(NO_PLAN);
      return { figure: `${months.filter((m) => !overPlan(m)).length} of ${months.length}`, note: "months stayed within the plan" };
    },
  },
  {
    id: "withinPlanStreak", section: "The plan", label: "Longest run within the plan",
    compute: (ctx) => {
      const months = withPlan(ctx);
      if (!months.length) return empty(NO_PLAN);
      return { figure: plural(longestRun(months, (m) => !overPlan(m)), "month"), note: "in a row within the plan" };
    },
  },
  ...twins(
    { id: "planGap", section: "The plan", label: "How close spending lands to the plan", note: "typical gap between the plan and what went out" },
    { id: "medianPlanGap", section: "The plan", label: "How close spending lands to the plan, median", note: "median gap between the plan and what went out" },
    (typical, d) => (ctx) => {
      const months = withPlan(ctx);
      if (!months.length) return empty(NO_PLAN);
      return { figure: pct(typical(months, (m) => Math.abs(m.actual - m.alloc) / m.alloc)), note: d.note };
    },
  ),
  ...twins(
    { id: "avgOverspend", section: "The plan", label: "Average overspend",
      note: (n) => `over the plan, on average, in the ${plural(n, "month")} that went over` },
    { id: "medianOverspend", section: "The plan", label: "Median overspend",
      note: (n) => `over the plan in the median of the ${plural(n, "month")} that went over` },
    (typical, d) => (ctx, card, money) => {
      const months = withPlan(ctx);
      if (!months.length) return empty(NO_PLAN);
      const over = months.filter(overPlan);
      if (!over.length) return { figure: money(0), note: "no month went over the plan" };
      return { figure: money(typical(over, (m) => m.actual - m.alloc)), note: d.note(over.length) };
    },
  ),

  /* ---- income ---- */
  ...twins(
    { id: "avgIncome", section: "Income", label: "Average monthly income", note: "income a month, on average" },
    { id: "medianIncome", section: "Income", label: "Median monthly income", note: "income in the median month" },
    (typical, d) => (ctx, card, money) => {
      const months = withIncome(ctx);
      if (!months.length) return empty(NO_INCOME);
      return { figure: money(typical(months, (m) => m.income)), note: d.note };
    },
  ),
  {
    id: "incomeChange", section: "Income", label: "Income against the year before",
    compute: (ctx) => {
      const now = withIncome(ctx);
      const before = ctx.before.filter((m) => m.income > 0);
      if (!now.length || !before.length) return empty("needs income in the 12 months before these");
      const was = avg(before, (m) => m.income);
      const change = Math.round(((avg(now, (m) => m.income) - was) / was) * 100);
      const figure = change > 0 ? `+${change}%` : change < 0 ? `−${Math.abs(change)}%` : "0%";
      return { figure, note: "income against the 12 months before" };
    },
  },
];

const BY_ID = new Map(STATS.map((s) => [s.id, s]));
export const statById = (id) => BY_ID.get(id) || null;

/* What a household starts with: the total put aside as the large card, and
   three smaller ones beside it. */
export const DEFAULT_CARDS = [
  { stat: "savedAllTime", x: 1, y: 1, w: 2, h: 2 },
  { stat: "saveRate", x: 3, y: 1, w: 1, h: 1 },
  { stat: "avgSpendWithSavings", x: 4, y: 1, w: 1, h: 1 },
  { stat: "withinPlan", x: 3, y: 2, w: 2, h: 1 },
];

/* Whatever was saved, made into cards the screen can draw. Nothing saved
   means the defaults; an empty list is a choice and stays empty. A card off
   the grid, or overlapping one before it, is dropped. A stat this version
   does not know keeps its card, which then asks for a stat. Each card keeps
   only the choice its stat asks for. */
export function normaliseCards(raw) {
  if (!Array.isArray(raw)) return DEFAULT_CARDS;
  const out = [];
  for (const c of raw.slice(0, GRID_COLS * GRID_ROWS)) {
    if (!c || typeof c.stat !== "string") continue;
    const place = { x: c.x, y: c.y, w: c.w, h: c.h };
    if (!fits(out, place)) continue;
    const s = statById(c.stat);
    const card = { stat: c.stat };
    if (s && s.needs === "of" && c.of) card.of = { kind: c.of.kind, id: c.of.id };
    if (s && s.needs === "goal" && c.goal != null) card.goal = c.goal;
    if (s && s.needs === "percent") card.percent = PERCENT_CHOICES.includes(c.percent) ? c.percent : DEFAULT_PERCENT;
    out.push({ ...card, ...place });
  }
  return out;
}

/* Everything the stats read, worked out once per render.
   `allSeries` is the store's trends read, oldest first; `now` is the current
   calendar month, "YYYY-MM"; `categories` is the category list
   (api.categories), which names the groups and categories cards point at
   and offers them in the card's menu. */
export function buildContext({ allSeries, now, categories }) {
  const finished = allSeries.filter((m) => m.month < now);
  const groups = new Map();
  const cats = new Map();
  for (const c of categories || []) {
    if (!groups.has(c.groupId)) groups.set(c.groupId, { name: c.groupName, kind: c.groupKind, categories: [] });
    cats.set(c.id, { name: c.name, groupId: c.groupId, groupKind: c.groupKind });
    if (!c.archived) groups.get(c.groupId).categories.push({ id: c.id, name: c.name });
  }
  return {
    now,
    year: now.slice(0, 4),
    toDate: allSeries.filter((m) => m.month <= now),
    window: finished.slice(-12),
    before: finished.slice(-24, -12),
    groups,
    categories: cats,
  };
}

/* A card's figure and the line under it. */
export function computeStat(card, ctx, currency) {
  const s = statById(card.stat);
  if (!s) return empty("choose a stat from this card's menu");
  const money = (v) => fmt(currency, v, { cents: false });
  return s.compute(ctx, card, money);
}

/* What a card's menu offers for a stat's choice: spend groups with their
   categories, or the savings categories. Groups whose categories are all
   archived are left out. */
export function choicesFor(ctx, needs) {
  const list = [...ctx.groups.entries()].map(([id, g]) => ({ id, ...g }));
  if (needs === "of") return list.filter((g) => g.kind !== "savings" && g.categories.length);
  if (needs === "goal") return list.filter((g) => g.kind === "savings").flatMap((g) => g.categories);
  return [];
}
