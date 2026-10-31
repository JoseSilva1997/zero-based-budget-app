/* ============================================================
   Upload transactions: the few things the review sheet works out for itself.
   Pure, no React. Money is integer PENCE here, as the import channels send
   it, and dates are "YYYY-MM-DD".

   Everything else about a row (its labels, its default tick, its category)
   is the server's, recomputed on every read. These are only what has to
   follow a tick the moment it is made.
   ============================================================ */
import { MONTH_NAMES } from "./dates.js";

/** A row waiting on a category. Its chip is only a warning (on a first
 *  import nearly every row is one), but it cannot be ticked until a category
 *  is picked, so it stays live, in place, with its picker open to that choice. */
export const needsCategory = (row) => row.labels.some((l) => l.key === "uncategorised");

/** A row that cannot be ticked as it stands: any label of block severity, or
 *  no category yet. */
export const isBlocked = (row) => row.labels.some((l) => l.severity === "block") || needsCategory(row);

/** A row nothing can be done about: a label of block severity (already
 *  imported, unreadable, not completed). */
export const isInert = (row) => row.labels.some((l) => l.severity === "block");

/** "2026-10-03" -> "3 Oct"; null (a row that could not be read) -> "". */
export function shortDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

/** A section's rows with the inert ones sunk to the bottom, each half in
 *  the statement's own order. */
export function sinkBlocked(rows) {
  return [...rows.filter((r) => !isInert(r)), ...rows.filter(isInert)];
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

/** A row whose only warning is that it falls outside the month: a long
 *  statement brings hundreds of these, and they fold away by default. "No
 *  category" doesn't count as a warning here: it is on most rows of a first
 *  import, and is about the tick rather than something to look at. */
export function onlyOutOfMonth(row) {
  const warns = row.labels.filter((l) => l.severity === "warn" && l.key !== "uncategorised");
  return warns.length === 1 && warns[0].key === "out_of_month";
}

/** Whether Confirm would write this row as an entry: ticked, importable, a
 *  spend rather than a transfer, not matched to an entry already there, and
 *  with an amount and a category to write. */
export const willImport = (row) =>
  row.included && !isBlocked(row) && row.kind === "spend" && row.writesAs === "entry" &&
  row.decisions.linkedEntryId == null && row.amountCents != null && row.categoryId != null;

/** Money in Confirm would write: "refund" (a negative entry on its
 *  purchase's line) or "money_back" (an income line), or null. */
export const willReturn = (row) =>
  row.included && !isInert(row) && row.kind === "spend" && row.amountCents != null &&
  (row.writesAs === "refund" || row.writesAs === "money_back") ? row.writesAs : null;

/**
 * What Confirm would do, worked out from the review as it stands:
 * { count, totalCents, linked, learnt, over }. `learnt` is the unticked
 * rows that will teach the classifier without becoming entries; which rows
 * those are is the server's call (row.teaches), not worked out here.
 *
 * `over` is "Over plan after import": per category the ticked rows land in,
 * what the month has spent so far plus those rows, against what was planned.
 * A category with no plan line this month is planned at nothing, so all of it
 * is over (Confirm creates the line at £0). Only categories that go over are
 * listed, worst first, as { categoryId, name, overCents }.
 */
export function importOutcome(review) {
  let count = 0, totalCents = 0, linked = 0, learnt = 0;
  let refunds = 0, refundCents = 0, moneyBack = 0, moneyBackCents = 0;
  const added = new Map();
  for (const a of review.accounts) {
    for (const r of a.rows) {
      // A matched row needs no category of its own (the entry has one), so
      // only a hard block keeps it out.
      if (r.decisions.linkedEntryId != null && !isInert(r)) linked += 1;
      if (r.teaches) learnt += 1;
      const back = willReturn(r);
      if (back === "refund") {
        refunds += 1;
        refundCents += r.amountCents;
        // A refund nets against its purchase's line, so it takes off what
        // that line goes over by.
        if (r.categoryId != null) added.set(r.categoryId, (added.get(r.categoryId) || 0) - r.amountCents);
      } else if (back === "money_back") {
        moneyBack += 1;
        moneyBackCents += r.amountCents;
      }
      if (!willImport(r)) continue;
      count += 1;
      totalCents += r.amountCents;
      added.set(r.categoryId, (added.get(r.categoryId) || 0) + r.amountCents);
    }
  }
  const over = [];
  for (const [categoryId, cents] of added) {
    const line = review.plan.find((p) => p.categoryId === categoryId);
    const cat = review.categories.find((c) => c.id === categoryId);
    const overCents = (line ? line.actualCents : 0) + cents - (line ? line.plannedCents : 0);
    if (overCents > 0) over.push({ categoryId, name: line ? line.name : cat ? cat.name : "Uncategorised", overCents });
  }
  over.sort((a, b) => b.overCents - a.overCents);
  return { count, totalCents, linked, learnt, refunds, refundCents, moneyBack, moneyBackCents, over };
}

/** The toast after Confirm, from what it did: "Imported 3 entries · £75.10,
 *  1 refund · £50.00, £3.00 money back, 1 matched, 2 learnt." With nothing
 *  written but rows learnt from, only "Learnt 2 categories." `money`
 *  formats pence. */
export function confirmReceipt(res, money) {
  const learnt = res.learnt || 0;
  const refunds = res.refunds || 0, moneyBack = res.moneyBack || 0;
  if (res.entries === 0 && !res.linked && !refunds && !moneyBack && learnt > 0) return `Learnt ${learnt} ${learnt === 1 ? "category" : "categories"}.`;
  const parts = [];
  if (res.entries || (!refunds && !moneyBack)) parts.push(`Imported ${res.entries} ${res.entries === 1 ? "entry" : "entries"} · ${money(res.totalCents)}`);
  if (refunds) parts.push(`${refunds} ${refunds === 1 ? "refund" : "refunds"} · ${money(res.refundCents)}`);
  if (moneyBack) parts.push(`${money(res.moneyBackCents)} money back`);
  if (res.linked) parts.push(`${res.linked} matched`);
  if (res.linesCreated) parts.push(`${res.linesCreated} new plan ${res.linesCreated === 1 ? "line" : "lines"}`);
  if (learnt) parts.push(`${learnt} learnt`);
  return `${parts.join(", ")}.`;
}

/* ---- refund notes, for the month view ------------------------------------
   Money is DOLLARS here, as the month tree carries it. */

const monthName = (key) => MONTH_NAMES[Number(key.slice(5, 7)) - 1];

/** Under a purchase: what came back for it. "£50.00 returned 11 Sep", and
 *  for a refund that landed after its month, "£30.00 returned 2 Oct, as
 *  money back in October". '' when nothing has. `money` formats dollars. */
export function returnsNote(entry, monthKey, money) {
  if (!entry.returns || entry.returns.length === 0) return "";
  return entry.returns.map((r) => {
    const when = r.spent_on ? ` ${shortDate(r.spent_on)}` : "";
    const later = r.month !== monthKey ? `, as money back in ${monthName(r.month)}` : "";
    return `${money(r.amount)} returned${when}${later}`;
  }).join(" · ");
}

/** Under a refund: "Refund of H&M, 5 Sep". */
export function refundOfNote(entry) {
  return entry.refundOf ? `Refund of ${entry.refundOf.name || "a purchase"}, ${shortDate(entry.refundOf.spent_on)}` : "Refund";
}

/** Under a money-back income line: "Money back for H&M, 5 Sep (September's
 *  budget) · arrived 2 Oct", or for money in with no purchase, "Money back ·
 *  arrived 25 Sep". */
export function moneyBackNote(income) {
  const parts = [income.refundOf
    ? `Money back for ${income.refundOf.name || "a purchase"}, ${shortDate(income.refundOf.spent_on)} (${monthName(income.refundOf.month)}'s budget)`
    : "Money back"];
  if (income.receivedOn) parts.push(`arrived ${shortDate(income.receivedOn)}`);
  return parts.join(" · ");
}
