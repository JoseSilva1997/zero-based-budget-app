/* ============================================================
   Refunds: which purchase a credit on a statement gives money back for.
   Pure; the database half (database/repositories/imports.ts) gathers the
   purchases a credit could be, and decides where the refund is written.

   A purchase is a candidate when it is on the same account, made up to
   REFUND_WINDOW_DAYS before the credit (or the same day), from a merchant
   whose name shares a word with the credit's, and has at least the credit's
   amount still unrefunded. Several partial refunds may each take a share of
   one purchase; what is left is what a later one can take.

   The best candidate is the one whose name is most alike, then the most
   recent: an order returned is usually the latest one from that shop.
   ============================================================ */

/** How far back, in days, a refund looks for its purchase. */
export const REFUND_WINDOW_DAYS = 90;

/** Words that say nothing about which shop it was. Two-letter noise from
 *  descriptors (card codes, country codes) is here too, since a shop like
 *  "H&M" is two letters once its '&' goes. */
const STOP = new Set([
  'cd', 'gb', 'uk', 'co', 'www', 'com', 'net', 'org', 'the', 'and', 'plc', 'ltd', 'limited', 'inc',
  'refund', 'refunds', 'return', 'returns', 'returned', 'credit', 'payment', 'card', 'pos', 'online',
  'store', 'stores', 'shop', 'retail', 'purchase', 'order', 'from', 'to', 'for', 'via', 'gbp',
]);

/** A name as the words that identify the merchant: lower case, letters
 *  only, "H & M" and "H&M" both "hm", tokens holding digits (references,
 *  postcodes) dropped. */
export function merchantWords(text: string | null | undefined): Set<string> {
  const joined = String(text || '')
    .toLowerCase()
    .replace(/\b([a-z])\s*&\s*([a-z])\b/g, '$1$2');
  const words = joined
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !/\d/.test(w) && !STOP.has(w));
  return new Set(words);
}

/** How alike two merchant names are, 0..1: the shared words over the
 *  shorter name's. 0 when they share none. */
export function merchantLikeness(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

/** A purchase a refund may be of: an existing entry, or a row of the same
 *  upload that is being imported. */
export type PurchaseRef = { kind: 'entry'; id: number } | { kind: 'row'; id: number };

export interface Purchase {
  ref: PurchaseRef;
  spentOn: string;
  amountCents: number;
  /** amountCents less what is already refunded. */
  remainingCents: number;
  /** Every name it goes by (the bank's descriptor, the entry's name). */
  names: string[];
}

export interface RefundFacts {
  spentOn: string;
  amountCents: number;
  descriptor: string;
}

const dayNumber = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

export const sameRef = (a: PurchaseRef | null, b: PurchaseRef | null) =>
  !!a && !!b && a.kind === b.kind && a.id === b.id;

/** The purchases the refund could be of, best first. */
export function rankPurchases<P extends Purchase>(refund: RefundFacts, purchases: P[]): P[] {
  const words = merchantWords(refund.descriptor);
  const day = dayNumber(refund.spentOn);
  return purchases
    .map((p) => {
      const ago = day - dayNumber(p.spentOn);
      const likeness = Math.max(0, ...p.names.map((n) => merchantLikeness(words, merchantWords(n))));
      return { p, ago, likeness };
    })
    .filter((c) => c.ago >= 0 && c.ago <= REFUND_WINDOW_DAYS && c.likeness > 0 && c.p.remainingCents >= refund.amountCents)
    .sort((a, b) => b.likeness - a.likeness || a.ago - b.ago)
    .map((c) => c.p);
}
