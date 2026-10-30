/* ============================================================
   Monzo. Amount is signed (negative is money out). Name is the
   descriptor; Description is often blank. A "Pot transfer" moves money
   inside the account, so it is not spending and is dropped. The export
   names no account.
   ============================================================ */
import { cleanDescriptor } from '../clean';
import { RowErrors, dmyToIso, sameHeader, splitSigned } from './common';
import type { ParsedRow, Preset } from './types';

const HEADER = [
  'Transaction ID', 'Date', 'Time', 'Type', 'Name', 'Emoji', 'Category', 'Amount', 'Currency',
  'Local amount', 'Local currency', 'Notes and #tags', 'Address', 'Receipt', 'Description',
  'Category split', 'Money Out', 'Money In',
];

export const monzo: Preset = {
  key: 'monzo',
  label: 'Monzo',
  header: HEADER,
  detect: (header) => sameHeader(header, HEADER),
  parse(records) {
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
