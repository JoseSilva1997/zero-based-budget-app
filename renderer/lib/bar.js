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
  /* Guard against NaN: if any input is not finite, treat as empty. */
  if (!Number.isFinite(income) || !Number.isFinite(allocated) || !Number.isFinite(actual)) {
    return { empty: true, scale: 0, incomeX: 0, allocX: 0, spentX: 0, overAllocated: false, overspent: false };
  }

  /* Clamp inputs to zero at the top so flags derive from clamped values, not raw inputs. */
  const inc = Math.max(income, 0);
  const alloc = Math.max(allocated, 0);
  const spent = Math.max(actual, 0);

  const scale = Math.max(inc, alloc, spent);
  if (scale <= 0) {
    return { empty: true, scale: 0, incomeX: 0, allocX: 0, spentX: 0, overAllocated: false, overspent: false };
  }

  const incomeX = inc / scale;
  const allocX = alloc / scale;
  const spentX = spent / scale;

  /* Flags must match the regions that will be emitted, so they depend on the
     fractions, not the original comparison. */
  const lim = Math.min(allocX, incomeX);
  const spentCap = Math.min(spentX, incomeX);

  return {
    empty: false,
    scale,
    incomeX,
    allocX,
    spentX,
    overAllocated: Math.max(allocX, spentX) > incomeX,
    overspent: spentCap > lim,
  };
}

/* Left-to-right spans for the renderer, and they must be a partition: no gaps,
   no overlaps, in that order. Two rules make it one. The allocation is capped
   at the income mark, so the stretch beyond the mark belongs to the breach
   region rather than being claimed twice. And the gap starts wherever money
   actually ran out, which is past the overspend when there is one, because
   overspending eats into money that had no job yet. Zero-width spans are
   dropped so the component never paints a region it cannot see. */
export function barRegions(g) {
  if (g.empty) return [];
  const out = [];
  const push = (key, from, to) => { if (to - from > 1e-9) out.push({ key, from, to }); };

  const lim = Math.min(g.allocX, g.incomeX);        /* allocation, capped at the mark */
  const solidTo = Math.min(g.spentX, lim);          /* spending inside the plan */
  const spentCap = Math.min(g.spentX, g.incomeX);   /* spending, capped at the mark */

  push("spent", 0, solidTo);
  push("allocated", solidTo, lim);
  push("overspent", lim, spentCap);
  push("gap", Math.max(lim, spentCap), g.incomeX);
  push("overAllocated", g.incomeX, Math.max(g.allocX, g.spentX));

  return out;

  return out;
}
