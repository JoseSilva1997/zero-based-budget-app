/* ============================================================
   Fingerprints: the identity a statement row keeps from one upload to the
   next, so the same transaction uploaded again (in an overlapping
   statement, or into another month) is recognised as already imported.

   It is a hash of (account, date spent, amount, direction, raw descriptor,
   occurrence number), where the occurrence number tells apart identical
   rows in one file: two £3.20 coffees at the same café on the same day are
   0 and 1. The cleaned descriptor is left out, so improving the cleaning
   never makes old rows look new. Every bank gets one, Monzo too, even
   though it has transaction IDs.
   ============================================================ */
import { createHash } from 'crypto';
import type { ParsedRow } from './presets/types';

type FingerprintFields = Pick<ParsedRow, 'spentOn' | 'amountCents' | 'direction' | 'descriptorRaw'>;

/** One fingerprint per row, in the same order, for rows read from one file
 *  of account 'accountId'. */
export function fingerprintRows(accountId: number, rows: FingerprintFields[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const tuple = JSON.stringify([accountId, r.spentOn, r.amountCents, r.direction, r.descriptorRaw]);
    const occurrence = seen.get(tuple) ?? 0;
    seen.set(tuple, occurrence + 1);
    return createHash('sha256').update(`${tuple}#${occurrence}`).digest('hex');
  });
}
