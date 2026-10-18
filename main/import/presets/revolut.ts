/* ============================================================
   Revolut. Amount is signed, and Fee (positive) is charged on top: what a
   row cost is Amount - Fee, so a -8.74 withdrawal with a 0.09 fee is 8.83
   out, matching the Balance column. Spent on the Started date, posted on
   the Completed one (a pending row has none yet, and falls back to
   Started). One export holds every product (Current, Savings...); an
   account takes one, and the others' rows are dropped. A row whose State
   is not COMPLETED is marked notCompleted. The export names no account.
   ============================================================ */
import { cleanDescriptor } from '../clean';
import { RowErrors, sameHeader, splitSigned, validIso } from './common';
import type { ParsedRow, Preset } from './types';

const HEADER = [
  'Type', 'Product', 'Started Date', 'Completed Date', 'Description', 'Amount', 'Fee',
  'Currency', 'State', 'Balance',
];

/** '2026-01-02 11:23:59' -> '2026-01-02'. */
function datePart(text: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(String(text).trim());
  return m ? validIso(m[1]) : null;
}

export const revolut: Preset = {
  key: 'revolut',
  label: 'Revolut',
  header: HEADER,
  detect: (header) => sameHeader(header, HEADER),
  parse(records, ctx) {
    const rows: ParsedRow[] = [];
    records.forEach((raw, rowIndex) => {
      if (ctx.bankProduct !== null && raw['Product'] !== ctx.bankProduct) return;
      const errors = new RowErrors();
      const spentOn = errors.date(raw, 'Started Date', datePart, 'YYYY-MM-DD');
      const postedOn = (raw['Completed Date'] ?? '').trim()
        ? errors.date(raw, 'Completed Date', datePart, 'YYYY-MM-DD')
        : spentOn;
      const amount = errors.amount(raw, 'Amount');
      const fee = (raw['Fee'] ?? '').trim() ? errors.amount(raw, 'Fee') : 0;
      const net = amount === null || fee === null ? null : amount - fee;
      const descriptor = raw['Description'] ?? '';
      rows.push({
        rowIndex,
        postedOn,
        spentOn,
        ...splitSigned(net),
        descriptorRaw: descriptor,
        descriptorClean: cleanDescriptor(descriptor),
        features: { type: raw['Type'] ?? '' },
        ...(raw['State'] !== 'COMPLETED' ? { notCompleted: true } : {}),
        ...errors.result(),
        raw,
      });
    });
    return rows;
  },
  fileAccountIdentifier: () => null,
  productsIn(records) {
    const seen: string[] = [];
    for (const raw of records) {
      const product = raw['Product'] ?? '';
      if (product && !seen.includes(product)) seen.push(product);
    }
    return seen;
  },
};
