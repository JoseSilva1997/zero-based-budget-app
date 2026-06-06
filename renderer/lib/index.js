/* ============================================================
   Domain logic barrel. Pure, React-free modules that the UI imports from.
   Split by concern: format (currency/rounding), dates (month-id + entry-date
   helpers), theme (palettes), selectors (read model), reducer (write model).
   ============================================================ */
export { fmt, round2 } from "./format.js";
export { MONTH_NAMES, monthLabel, prevMonthId, nextMonthId, daysInMonth, actualDay, makeActualDate } from "./dates.js";
export { BUDGET_THEMES, THEME_IDS, GROUP_PALETTE } from "./theme.js";
export {
  itemActual, monthIncome, monthAllocated, monthActual, monthSavings,
  groupAllocated, groupActual, monthUnallocated, overBudgetItems,
  accountTotals, walletSummary, normalizeItemName, reusableItemCandidates, buildSeries,
} from "./selectors.js";
export { buildEmpty, reducer } from "./reducer.js";
