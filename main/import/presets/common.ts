/* ============================================================
   Helpers the presets share: header matching, amounts read straight from
   the text into integer pence (never through a float), and the bank date
   formats turned into YYYY-MM-DD.
   ============================================================ */

/** True when two headers hold the same names, ignoring order, case and
 *  surrounding space. */
export function sameHeader(a: string[], b: string[]): boolean {
  const norm = (h: string[]) => h.map((n) => n.trim().toLowerCase()).sort().join('\u0000');
  return norm(a) === norm(b);
}

/** '-8.74' -> -874, '92' -> 9200. Null when the text is not an amount. */
export function parseSignedCents(text: string): number | null {
  const m = /^([+-])?(\d+)(?:\.(\d{1,2}))?$/.exec(String(text).trim());
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'));
  return m[1] === '-' ? -cents : cents;
}

/** '05/01/2026' (DD/MM/YYYY) -> '2026-01-05'. Null when it isn't one. */
export function dmyToIso(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text).trim());
  if (!m) return null;
  return validIso(`${m[3]}-${m[2]}-${m[1]}`);
}

/** The date if it exists on the calendar, else null. */
export function validIso(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Collects what is wrong with one row, so a preset reads every field and
 *  reports them all instead of stopping at the first. */
export class RowErrors {
  private list: string[] = [];

  add(message: string): void {
    this.list.push(message);
  }

  /** The record's 'column' as signed pence, or null (noted) when unreadable. */
  amount(raw: Record<string, string>, column: string): number | null {
    const cents = parseSignedCents(raw[column] ?? '');
    if (cents === null) this.add(`${column} "${raw[column] ?? ''}" is not an amount`);
    return cents;
  }

  /** The record's 'column' read with 'toIso', or null (noted) when it isn't
   *  a date in 'format'. */
  date(
    raw: Record<string, string>,
    column: string,
    toIso: (text: string) => string | null,
    format: string
  ): string | null {
    const iso = toIso(raw[column] ?? '');
    if (iso === null) this.add(`${column} "${raw[column] ?? ''}" is not a ${format} date`);
    return iso;
  }

  /** { parseError } when anything was noted, else nothing to spread. */
  result(): { parseError?: string } {
    return this.list.length ? { parseError: this.list.join('; ') } : {};
  }
}

/** Signed pence as the positive amount and direction a row stores. */
export function splitSigned(signed: number | null): {
  amountCents: number | null;
  direction: 'debit' | 'credit' | null;
} {
  if (signed === null) return { amountCents: null, direction: null };
  return { amountCents: Math.abs(signed), direction: signed < 0 ? 'debit' : 'credit' };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Day, month abbreviation and year as YYYY-MM-DD; a two-digit year is
 *  this century. Null when it isn't a real date. */
export function dayMonYear(day: string, mon: string, year: string): string | null {
  const month = MONTHS.indexOf(mon.toUpperCase()) + 1;
  if (month === 0) return null;
  const yyyy = year.length === 2 ? `20${year}` : year;
  return validIso(`${yyyy}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`);
}
