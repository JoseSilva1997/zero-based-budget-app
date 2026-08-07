/* ============================================================
   Month bar geometry. Pure: no React, no DOM, no formatting.

   The bar's scale is max(income, allocated, actual), not income. Normally
   that IS income and the income point is the right end; when the month
   overshoots, the scale grows and the income point becomes an interior
   rule. That way the right end always means "the most money in play" and
   the income mark always means the same thing.
   ============================================================ */

/* Money is float dollars here, so equality needs a tolerance. 0.005 matches
   the half-penny epsilon used for the unallocated check on the month screen. */
const EPS = 0.005;

export function barGeometry(income, allocated, actual) {
  /* Not finite means there is nothing meaningful to draw. Checked before the
     clamp, because Math.max propagates NaN and NaN <= 0 is false, so a NaN
     would otherwise walk straight past the empty guard below. */
  if (!Number.isFinite(income) || !Number.isFinite(allocated) || !Number.isFinite(actual)) {
    return { empty: true, scale: 0, incomeX: 0, allocX: 0, spentX: 0, epsX: 0, overAllocated: false, overspent: false };
  }

  /* Clamp once, at the top. A negative can reach here: the money input's
     expression parser accepts one and the selectors pass it through. Deriving
     everything below from the clamped values is what stops a flag and a span
     disagreeing about the same month. */
  const inc = Math.max(income, 0);
  const alloc = Math.max(allocated, 0);
  const spent = Math.max(actual, 0);

  const scale = Math.max(inc, alloc, spent);
  if (scale <= 0) {
    return { empty: true, scale: 0, incomeX: 0, allocX: 0, spentX: 0, epsX: 0, overAllocated: false, overspent: false };
  }

  /* The money epsilon, carried into fraction space, so one tolerance governs
     both the flags below and the span-drop threshold in barRegions. */
  const epsX = EPS / scale;

  const incomeX = inc / scale;
  const allocX = alloc / scale;
  const spentX = spent / scale;

  /* These are plan questions, so they compare the plan's own quantities and
     never the capped values barRegions uses for painting. overAllocated is
     "the plan exceeds the income"; overspent is "the spending exceeds the
     plan". Either can be true while its span is absent, because past the
     income mark both are subsumed into the beyond region. */
  return {
    empty: false,
    scale,
    incomeX,
    allocX,
    spentX,
    epsX,
    overAllocated: allocX > incomeX + epsX,
    overspent: spentX > allocX + epsX,
  };
}

/* Left-to-right spans for the renderer, and they must tile: no overlaps, and
   no gap wider than the tolerance. Two rules make it so. The allocation and
   the spending are both capped at the income mark, so the stretch past the
   mark belongs to `beyond` rather than being claimed twice. And the gap starts
   wherever money actually ran out, which is past the overspend when there is
   one, because overspending eats into money that had no job yet. */
export function barRegions(g) {
  if (g.empty) return [];
  const out = [];
  /* One threshold, shared with the flags, so a sliver too thin to flip a flag
     is also too thin to paint. */
  const push = (key, from, to) => { if (to - from > g.epsX) out.push({ key, from, to }); };

  const lim = Math.min(g.allocX, g.incomeX);        /* allocation, capped at the mark */
  const solidTo = Math.min(g.spentX, lim);          /* spending inside the plan */
  const spentCap = Math.min(g.spentX, g.incomeX);   /* spending, capped at the mark */

  push("spent", 0, solidTo);
  push("allocated", solidTo, lim);
  push("overspent", lim, spentCap);
  push("gap", Math.max(lim, spentCap), g.incomeX);
  push("beyond", g.incomeX, Math.max(g.allocX, g.spentX));

  return out;
}
