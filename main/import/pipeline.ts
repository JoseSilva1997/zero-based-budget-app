/* ============================================================
   Reading one statement file for one account: the pure half of adding a
   file to an upload. It checks the file belongs to the account (its bank,
   its account number), parses it with the bank's preset, and fingerprints
   every row. The database half (database/repositories/imports.ts) checks
   the batch, stores the result, and records the account number the first
   time.

   Refusals throw with copy the UI shows as is. An account with no bank yet
   throws NeedsBankError, which carries what the file looks like, so the UI
   can offer to set the bank up there and then, and retry.
   ============================================================ */
import { createHash } from 'crypto';
import { parseCsv } from './csv';
import { fingerprintRows } from './fingerprint';
import { detectPreset, getPreset } from './presets';
import type { ParsedRow, PresetKey } from './presets/types';

/** What a statement file looks like, for setting up its account's bank. */
export interface NeedsBankDetail {
  /** The preset whose header the file has, or null for none. */
  preset: PresetKey | null;
  /** Revolut only: the products the file holds, to pick the account's. */
  products: string[] | null;
}

/** The account needs its bank (or, on Revolut, its product) chosen before a
 *  statement can be read. 'code' and 'detail' travel through the IPC
 *  envelope. */
export class NeedsBankError extends Error {
  readonly code = 'needs_bank';
  constructor(message: string, readonly detail: NeedsBankDetail) {
    super(message);
  }
}

export interface StatementAccount {
  id: number;
  name: string;
  account_identifier: string | null;
  bank_product: string | null;
}

export interface StatementBank {
  name: string;
  preset: PresetKey;
}

export interface ReadStatement {
  rows: Array<ParsedRow & { fingerprint: string }>;
  /** The account the file names, or null for a bank whose export doesn't. */
  accountIdentifier: string | null;
}

/** The file's identity within a batch: the same text twice is the same file. */
export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** "600000-11112222" -> "2222". */
const lastFour = (identifier: string) => identifier.replace(/[^0-9A-Za-z]/g, '').slice(-4);

export function readStatement(
  text: string,
  account: StatementAccount,
  bank: StatementBank | null
): ReadStatement {
  const { header, records } = parseCsv(text);
  const detected = detectPreset(header);
  const products = (p: typeof detected) => (p?.productsIn ? p.productsIn(records) : null);
  if (!bank) {
    throw new NeedsBankError(`Choose the bank ${account.name} is with first.`, {
      preset: detected?.key ?? null,
      products: products(detected),
    });
  }
  const preset = getPreset(bank.preset);
  if (!preset || !preset.detect(header)) {
    throw new Error(`This doesn't look like a ${bank.name} statement.`);
  }
  // A Revolut export holds every product; with more than one in the file,
  // the account has to say which it is.
  const held = products(preset);
  if (held && held.length > 1 && account.bank_product === null) {
    throw new NeedsBankError(`Choose which ${bank.name} account ${account.name} is first.`, {
      preset: preset.key,
      products: held,
    });
  }
  if (records.length === 0) throw new Error('That file has no transactions in it.');

  const identifier = preset.fileAccountIdentifier(records);
  if (identifier && account.account_identifier && identifier !== account.account_identifier) {
    throw new Error(`This is the statement for ••${lastFour(identifier)}, not ${account.name}.`);
  }
  const parsed = preset.parse(records, { bankProduct: account.bank_product });
  const prints = fingerprintRows(account.id, parsed);
  return {
    rows: parsed.map((r, i) => ({ ...r, fingerprint: prints[i] })),
    accountIdentifier: identifier,
  };
}
