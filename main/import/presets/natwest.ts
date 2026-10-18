/* ============================================================
   NatWest. Value is signed. Date is when the bank booked it ("29 Sep
   2026"). A card payment's Description carries the card's last four, the
   date it was spent and the merchant, comma-separated:
     "4321 28SEP26 CD , SUPERDRUG STORES , PLC , LITTLE TOWN GB"
   so it is spent on 2026-09-28, and the descriptor is the segments between
   CD and the final town-and-country one, joined: "SUPERDRUG STORES PLC".
   Rows without that shape (direct debits, transfers...) are spent on Date
   and get the generic cleaning. Every row names its account.
   ============================================================ */
import { cleanDescriptor } from '../clean';
import { RowErrors, dayMonYear, sameHeader, splitSigned } from './common';
import type { ParsedRow, Preset } from './types';

const HEADER = ['Date', 'Type', 'Description', 'Value', 'Balance', 'Account Name', 'Account Number'];

/** "29 Sep 2026" -> "2026-09-29". */
function bookedDate(text: string): string | null {
  const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(String(text).trim());
  return m ? dayMonYear(m[1], m[2], m[3]) : null;
}

/** The card payment's parts, or null when the description isn't one. */
function cardPayment(description: string): { spentOn: string | null; merchant: string } | null {
  const m = /^\s*\d{4} (\d{2})([A-Z]{3})(\d{2}) CD\s*,(.*)$/.exec(description);
  if (!m) return null;
  const segments = m[4].split(',').map((s) => s.trim()).filter(Boolean);
  const merchant = (segments.length > 1 ? segments.slice(0, -1) : segments).join(' ');
  return { spentOn: dayMonYear(m[1], m[2], m[3]), merchant };
}

export const natwest: Preset = {
  key: 'natwest',
  label: 'NatWest',
  header: HEADER,
  detect: (header) => sameHeader(header, HEADER),
  parse(records) {
    return records.map((raw, rowIndex): ParsedRow => {
      const errors = new RowErrors();
      const postedOn = errors.date(raw, 'Date', bookedDate, 'DD Mon YYYY');
      const descriptor = raw['Description'] ?? '';
      const card = cardPayment(descriptor);
      const account = (raw['Account Number'] ?? '').trim();
      return {
        rowIndex,
        postedOn,
        spentOn: card?.spentOn ?? postedOn,
        ...splitSigned(errors.amount(raw, 'Value')),
        descriptorRaw: descriptor,
        descriptorClean: cleanDescriptor(card ? card.merchant : descriptor),
        ...(account ? { accountIdentifier: account } : {}),
        features: { type: raw['Type'] ?? '' },
        ...errors.result(),
        raw,
      };
    });
  },
  fileAccountIdentifier(records) {
    for (const raw of records) {
      const account = (raw['Account Number'] ?? '').trim();
      if (account) return account;
    }
    return null;
  },
};
