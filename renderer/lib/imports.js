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

/* The order the filter chips are offered in: what wants a look first, then
   what cannot go in, then the notes. */
const SEVERITY_ORDER = { warn: 0, block: 1, info: 2 };

/** Every label present in the review, with how many rows carry it, for the
 *  filter chips: [{ key, text, severity, count }]. 'ok' is never one. */
export function labelCounts(accounts) {
  const byKey = new Map();
  for (const a of accounts) {
    for (const r of a.rows) {
      for (const l of r.labels) {
        if (!(l.severity in SEVERITY_ORDER)) continue;
        const hit = byKey.get(l.key) || { key: l.key, text: l.text, severity: l.severity, count: 0 };
        hit.count += 1;
        byKey.set(l.key, hit);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
