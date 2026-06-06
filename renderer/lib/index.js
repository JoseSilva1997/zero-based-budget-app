/* ============================================================
   Domain logic barrel. Pure, React-free modules that the UI imports from.
   Split by concern: format (currency/rounding), dates (month-id + entry-date
   helpers), theme (palettes), selectors (active-month derivations over the
   SQL-sourced tree), reducer (empty-state fallback only).
   ============================================================ */
export { fmt, round2 } from "./format.js";
export { MONTH_NAMES, monthLabel, prevMonthId, nextMonthId, daysInMonth, actualDay, makeActualDate } from "./dates.js";
export { BUDGET_THEMES, THEME_IDS, GROUP_PALETTE } from "./theme.js";
export {
  itemActual, monthIncome, monthAllocated, monthActual, monthSavings,
  groupAllocated, groupActual, monthUnallocated, overBudgetItems,
  accountTotals, walletSummary, normalizeItemName,
} from "./selectors.js";
export { buildEmpty } from "./reducer.js";
