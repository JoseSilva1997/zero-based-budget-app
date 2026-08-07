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
  const scale = Math.max(income, allocated, actual, 0);
  if (scale <= 0) {
    return { empty: true, scale: 0, incomeX: 0, allocX: 0, spentX: 0, overAllocated: false, overspent: false };
  }
  return {
    empty: false,
    scale,
    incomeX: Math.max(income, 0) / scale,
    allocX: Math.max(allocated, 0) / scale,
    spentX: Math.max(actual, 0) / scale,
    overAllocated: allocated > income + EPS,
    overspent: actual > allocated + EPS,
  };
}

/* Left-to-right spans for the renderer. Zero-width spans are dropped so the
   component never paints a region it cannot see. */
export function barRegions(g) {
  if (g.empty) return [];
  const out = [];
  const push = (key, from, to) => { if (to - from > 1e-9) out.push({ key, from, to }); };

  const solidTo = Math.min(g.spentX, g.allocX);
  push("spent", 0, solidTo);
  push("allocated", solidTo, g.allocX);
  if (g.overspent) push("overspent", g.allocX, g.spentX);
  if (g.allocX < g.incomeX) push("gap", g.allocX, g.incomeX);
  if (g.overAllocated) push("overAllocated", g.incomeX, g.allocX);

  return out.sort((a, b) => a.from - b.from);
}
