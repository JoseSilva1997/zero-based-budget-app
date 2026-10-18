/* ============================================================
   Upload transactions: the few things the review sheet works out for itself.
   Pure, no React. Money is integer PENCE here, as the import channels send
   it, and dates are "YYYY-MM-DD".

   Everything else about a row (its labels, its default tick, its category)
   is the server's, recomputed on every read. These are only what has to
   follow a tick the moment it is made.
   ============================================================ */
import { MONTH_NAMES } from "./dates.js";

/** A row that cannot be imported: any label of block severity. */
export const isBlocked = (row) => row.labels.some((l) => l.severity === "block");

/** "2026-10-03" -> "3 Oct"; null (a row that could not be read) -> "". */
export function shortDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

/** A section's rows with the blocked ones sunk to the bottom, each half in
 *  the statement's own order. */
export function sinkBlocked(rows) {
  return [...rows.filter((r) => !isBlocked(r)), ...rows.filter(isBlocked)];
}
