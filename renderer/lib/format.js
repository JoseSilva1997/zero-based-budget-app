/* ============================================================
   Formatting helpers. Pure, no React.
   ============================================================ */

/** Round to 2 decimals, avoiding binary-float drift on sums. */
export function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Format a number as currency. `opts.cents === false` drops the decimals;
 *  `opts.sign` forces a leading "+" on positives. Negatives use a true minus. */
export function fmt(currency, n, opts = {}) {
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  });
  return `${neg ? "−" : opts.sign ? "+" : ""}${currency}${s}`;
}
