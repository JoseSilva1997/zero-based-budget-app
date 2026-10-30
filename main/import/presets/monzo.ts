/* ============================================================
   Monzo. Amount is signed (negative is money out). Name is the
   descriptor; Description is often blank. A "Pot transfer" moves money
   inside the account, so it is not spending and is dropped. The export
   names no account.

   Monzo also exports a shorter statement: ID, Created ("28/10/26, 09:08"),
   Title, Subtitle, Amount, Currency, Categories. It has no Type, so a pot
   move shows only as two rows with the same Title, opposite amounts and the
   same Created minute (money into a pot and straight back out, or the
   reverse); each such pair is dropped. Everything else is kept.
   ============================================================ */
import { cleanDescriptor } from '../clean';
import { RowErrors, dmyShortToIso, dmyToIso, hasColumns, parseSignedCents, sameHeader, splitSigned } from './common';
import type { CsvRecord, ParsedRow, Preset } from './types';

const HEADER = [
  'Transaction ID', 'Date', 'Time', 'Type', 'Name', 'Emoji', 'Category', 'Amount', 'Currency',
  'Local amount', 'Local currency', 'Notes and #tags', 'Address', 'Receipt', 'Description',
  'Category split', 'Money Out', 'Money In',
];

const SHORT_REQUIRED = ['ID', 'Created', 'Title', 'Amount'];
const SHORT_OPTIONAL = ['Subtitle', 'Currency', 'Categories'];

/** Indexes of the short export's pot moves: rows paired with another of the
 *  same Title and Created minute and the opposite amount, each row once. */
function potMoves(records: CsvRecord[]): Set<number> {
  const open = new Map<string, number[]>();
  const paired = new Set<number>();
  records.forEach((raw, i) => {
    const cents = parseSignedCents(raw['Amount'] ?? '');
    if (cents === null || cents === 0) return;
    const at = `${(raw['Title'] ?? '').trim()}\u0000${(raw['Created'] ?? '').trim()}`;
    const partners = open.get(`${at}\u0000${-cents}`);
    if (partners && partners.length > 0) {
      paired.add(partners.shift() as number);
      paired.add(i);
      return;
    }
    const mine = `${at}\u0000${cents}`;
    open.set(mine, [...(open.get(mine) ?? []), i]);
  });
  return paired;
}

function parseShort(records: CsvRecord[]): ParsedRow[] {
  const pots = potMoves(records);
  const rows: ParsedRow[] = [];
  records.forEach((raw, rowIndex) => {
    if (pots.has(rowIndex)) return;
    const errors = new RowErrors();
    const date = errors.date(raw, 'Created', dmyShortToIso, 'DD/MM/YY');
    const title = raw['Title'] ?? '';
    rows.push({
      rowIndex,
      postedOn: date,
      spentOn: date,
      ...splitSigned(errors.amount(raw, 'Amount')),
      descriptorRaw: title,
      descriptorClean: cleanDescriptor(title),
      features: { category: raw['Categories'] ?? '' },
      ...errors.result(),
      raw,
    });
  });
  return rows;
}

export const monzo: Preset = {
  key: 'monzo',
  label: 'Monzo',
  header: HEADER,
  detect: (header) => sameHeader(header, HEADER) || hasColumns(header, SHORT_REQUIRED, SHORT_OPTIONAL),
  parse(records) {
    if (records.length > 0 && 'Created' in records[0]) return parseShort(records);
    const rows: ParsedRow[] = [];
    records.forEach((raw, rowIndex) => {
      if (raw['Type'] === 'Pot transfer') return;
      const errors = new RowErrors();
      const date = errors.date(raw, 'Date', dmyToIso, 'DD/MM/YYYY');
      rows.push({
        rowIndex,
        postedOn: date,
        spentOn: date,
        ...splitSigned(errors.amount(raw, 'Amount')),
        descriptorRaw: raw['Name'],
        descriptorClean: cleanDescriptor(raw['Name']),
        features: { category: raw['Category'], type: raw['Type'] },
        ...errors.result(),
        raw,
      });
    });
    return rows;
  },
  fileAccountIdentifier: () => null,
};
