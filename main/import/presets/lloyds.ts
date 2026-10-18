/* ============================================================
   Lloyds. Money out is in Debit Amount and money in in Credit Amount,
   both positive, exactly one filled in per row. Every row names its
   account by Sort Code (written with a leading ' so a spreadsheet keeps it
   as text) and Account Number; the identifier is "112233-12345678", the
   same shape NatWest's export uses. Card descriptors often end in a
   "#<reference>", which is cleaned off.
   ============================================================ */
import { cleanDescriptor } from '../clean';
import { RowErrors, dmyToIso, sameHeader } from './common';
import type { CsvRecord, ParsedRow, Preset } from './types';

const HEADER = [
  'Transaction Date', 'Transaction Type', 'Sort Code', 'Account Number',
  'Transaction Description', 'Debit Amount', 'Credit Amount', 'Balance',
];

function accountOf(raw: CsvRecord): string {
  const sortCode = (raw['Sort Code'] ?? '').replace(/^'/, '').replace(/\D/g, '');
  const number = (raw['Account Number'] ?? '').trim();
  return sortCode && number ? `${sortCode}-${number}` : '';
}

function clean(descriptor: string): string {
  return cleanDescriptor(descriptor.replace(/#\d+\s*$/, ''));
}

export const lloyds: Preset = {
  key: 'lloyds',
  label: 'Lloyds',
  header: HEADER,
  detect: (header) => sameHeader(header, HEADER),
  parse(records) {
    return records.map((raw, rowIndex): ParsedRow => {
      const errors = new RowErrors();
      const date = errors.date(raw, 'Transaction Date', dmyToIso, 'DD/MM/YYYY');
      const hasDebit = (raw['Debit Amount'] ?? '').trim() !== '';
      const hasCredit = (raw['Credit Amount'] ?? '').trim() !== '';
      let amountCents: number | null = null;
      let direction: ParsedRow['direction'] = null;
      if (hasDebit && hasCredit) {
        errors.add('Both Debit Amount and Credit Amount are filled in');
      } else if (!hasDebit && !hasCredit) {
        errors.add('Neither Debit Amount nor Credit Amount is filled in');
      } else {
        const column = hasDebit ? 'Debit Amount' : 'Credit Amount';
        const cents = errors.amount(raw, column);
        if (cents !== null) {
          amountCents = Math.abs(cents);
          direction = hasDebit ? 'debit' : 'credit';
        }
      }
      const descriptor = raw['Transaction Description'] ?? '';
      const account = accountOf(raw);
      return {
        rowIndex,
        postedOn: date,
        spentOn: date,
        amountCents,
        direction,
        descriptorRaw: descriptor,
        descriptorClean: clean(descriptor),
        ...(account ? { accountIdentifier: account } : {}),
        features: { type: raw['Transaction Type'] ?? '' },
        ...errors.result(),
        raw,
      };
    });
  },
  fileAccountIdentifier(records) {
    for (const raw of records) {
      const account = accountOf(raw);
      if (account) return account;
    }
    return null;
  },
};
