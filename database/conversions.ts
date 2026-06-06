/* ============================================================
   Shared value conversions between the renderer's "blob" shapes (dollars,
   "M/DD" dates) and the normalised schema (integer cents, "YYYY-MM-DD").

   Every granular IPC handler and repository reuses one implementation here.
   ============================================================ */
import type { BankAccountKind } from '../shared/types';

export const DEFAULT_COLOR = '#7a7a7a';

export const VALID_KINDS: BankAccountKind[] = ['main', 'joint', 'wallet', 'savings', 'other'];

/** Dollars (float) -> integer cents. Non-finite/negative collapses to 0. */
export function dollarsToCents(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100);
}

/** Integer cents -> dollars (float, 2dp). */
export function centsToDollars(c: number): number {
  return Math.round(c) / 100;
}

/** Coerce an arbitrary string to a valid bank-account kind ('other' fallback). */
export function toKind(type: string): BankAccountKind {
  return (VALID_KINDS as string[]).includes(type) ? (type as BankAccountKind) : 'other';
}

/** "YYYY-MM" + blob "M/DD" -> "YYYY-MM-DD". Falls back to the 1st of the month. */
export function deriveSpentOn(monthId: string, date: string): string {
  const year = monthId.slice(0, 4);
  const parts = String(date || '').split('/');
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const d = Number(parts[1]);
    if (Number.isInteger(m) && Number.isInteger(d) && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return `${monthId}-01`;
}

/** "YYYY-MM-DD" -> blob "M/DD" (unpadded month, padded day, matching the UI). */
export function toMonthDay(spentOn: string): string {
  const parts = String(spentOn).split('-');
  if (parts.length === 3) {
    return `${Number(parts[1])}/${parts[2]}`;
  }
  return spentOn;
}
