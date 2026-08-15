/* ============================================================
   Domain logic barrel. Pure, React-free modules that the UI imports from.
   Split by concern: format (currency/rounding), dates (month-id + entry-date
   helpers), theme (palettes), selectors (active-month derivations over the
   SQL-sourced tree), reducer (empty-state fallback only).
   ============================================================ */
export { fmt, round2 } from "./format.js";
export { MONTH_NAMES, monthLabel, prevMonthId, nextMonthId, daysInMonth, actualDay, makeActualDate } from "./dates.js";
export { BUDGET_THEMES, THEME_IDS, DEFAULT_THEME_ID, GROUP_PALETTE } from "./theme.js";
export {
  itemActual, monthIncome, monthAllocated, monthActual, monthSavings,
  groupAllocated, groupActual, monthUnallocated, overBudgetItems,
  accountTotals, walletSummary, normalizeItemName,
} from "./selectors.js";
export { buildEmpty } from "./reducer.js";
export * from "./bar.js";

/* Declared here rather than given a module of its own, because a module would
   be this line plus a header twice its length. It is the one piece of the
   barrel that is not domain logic, and it earns the place: with state now
   carried by is-* classes instead of by inline style objects, nearly every
   component has to join a base class to a conditional one, and
   `cx("row", open && "is-open")` is that expression. filter(Boolean) is what
   lets the caller pass a bare `cond && "cls"`, whose false branch is `false`,
   and `cond ? "cls" : null`, whose false branch is null: both drop out. */
export const cx = (...parts) => parts.filter(Boolean).join(" ");
