/* ============================================================
   The shape every bank preset shares. A preset recognises its bank's
   statement by the header, and turns the statement's records into
   normalised rows: ISO dates, a positive amount in pence plus a direction,
   and the descriptor raw and cleaned. Presets are pure: no database, no
   file system, and they never throw on a bad row (it comes back with
   parseError set instead).
   ============================================================ */

export type PresetKey = 'monzo' | 'lloyds' | 'revolut' | 'natwest';

export type CsvRecord = Record<string, string>;

export interface ParseContext {
  /** The Revolut Product the account is bound to ('Current'); null when not
   *  bound yet, which keeps every product and lets the caller ask. */
  bankProduct: string | null;
}

export interface ParsedRow {
  /** Position among the file's records (0-based, header excluded), counted
   *  before any row is dropped. */
  rowIndex: number;
  /** YYYY-MM-DD the bank booked it. Null only on a row with parseError. */
  postedOn: string | null;
  /** YYYY-MM-DD it was spent: the card date where the bank gives one. */
  spentOn: string | null;
  /** Always positive, in pence; direction says which way it went. */
  amountCents: number | null;
  direction: 'debit' | 'credit' | null;
  descriptorRaw: string;
  descriptorClean: string;
  accountIdentifier?: string;
  /** The bank's own signals for the classifier (category, type code...). */
  features: Record<string, string>;
  /** Why the row could not be read; the row is shown but can't be imported. */
  parseError?: string;
  /** The bank has not settled it yet (Revolut's State). */
  notCompleted?: boolean;
  /** The original record, as read. */
  raw: CsvRecord;
}

export interface Preset {
  key: PresetKey;
  label: string;
  /** The statement's header, exactly as the bank writes it. */
  header: string[];
  /** True when 'header' is this bank's (same names, any order or case). */
  detect(header: string[]): boolean;
  parse(records: CsvRecord[], ctx: ParseContext): ParsedRow[];
  /** The account the statement is for, or null for a bank whose export
   *  doesn't say. */
  fileAccountIdentifier(records: CsvRecord[]): string | null;
  /** Revolut only: the products (Current, Savings...) the file holds. */
  productsIn?(records: CsvRecord[]): string[];
}
