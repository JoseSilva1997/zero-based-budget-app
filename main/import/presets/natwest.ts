/* ============================================================
   NatWest. Value is signed. Date is when the bank booked it ("29 Sep
   2026"). A card payment's Description carries the card's last four, the
   date it was spent and the merchant, comma-separated:
     "4321 28SEP26 CD , SUPERDRUG STORES , PLC , LITTLE TOWN GB"
   so it is spent on 2026-09-28, and the descriptor is the segments between
   CD and the final town-and-country one, joined: "SUPERDRUG STORES PLC".
   The marker may also be C or D, or missing on an online payment.
   Rows without that shape (direct debits, transfers...) are spent on Date;
   their comma segments are joined without the bank's boilerplate (channel,
   Faster Payment date, source account), and the generic cleaning drops the
   trace number. Every row names its account.
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
  // The marker after the date is CD, C, D, or absent (online payments).
  const m = /^\s*\d{4} (\d{2})([A-Z]{3})(\d{2})(?: [A-Z]{1,2})?\s*,(.*)$/.exec(description);
  if (!m) return null;
  const segments = m[4]
    .split(',')
    .map((s) => s.trim())
    // A payment abroad ends with "EUR 6.00, VRATE 1.1627", and a refund
    // with "REFUND" or "CREDIT": none of them is the merchant or the town.
    .filter(
      (s) => s && !/^[A-Z]{3} \d+\.\d+$/.test(s) && !/^VRATE \d/.test(s) && !/^(REFUND|CREDIT)$/.test(s)
    );
  const merchant = (segments.length > 1 ? segments.slice(0, -1) : segments).join(' ');
  return { spentOn: dayMonYear(m[1], m[2], m[3]), merchant };
}

/** Segments of a payment or transfer that are the bank's, not the payee's:
 *  the channel, the Faster Payment date and time code, and the account a
 *  transfer came from. */
const BOILERPLATE = [/^VIA MOBILE\b/i, /^FP \d{2}\/\d{2}\/\d{2}\b/, /^(FROM|TO) A\/C \d+$/i];

/** Any other row's comma segments, without the boilerplate, joined. The
 *  monthly charge says only "25AUG A/C 12345678" (the period and the
 *  account), so it is named for what it is. */
function otherDescriptor(description: string): string {
  if (/^\s*\d{2}[A-Z]{3} A\/C \d+\s*$/.test(description)) return 'Account charges';
  return description
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !BOILERPLATE.some((re) => re.test(s)))
    .join(' ');
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
        descriptorClean: cleanDescriptor(card ? card.merchant : otherDescriptor(descriptor)),
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
