/* ============================================================
   banks: the banks you hold accounts with, by the name you give them, each
   reading its statements through one built-in preset (monzo, lloyds,
   revolut, natwest). A bank_account points at its bank, and remembers what
   uploads need: the Revolut product it is, and the account identifier from
   the first statement imported into it.
   ============================================================ */
import type Database from 'better-sqlite3';
import type { Bank, BankPreset } from '../../shared/types';
import { cleanName, normalizeName } from './categories';

/** The presets built in (main/import/presets has one module per key). */
export const BANK_PRESETS: BankPreset[] = ['monzo', 'lloyds', 'revolut', 'natwest'];

export interface NewBank {
  name: string;
  preset: BankPreset;
}

/** Refuses a blank name, or one another bank has (compared trimmed,
 *  collapsed and case-folded), skipping 'exceptId'. */
function assertBankName(db: Database.Database, name: string, exceptId: number | null): void {
  if (!cleanName(name)) throw new Error('A bank needs a name.');
  const key = normalizeName(name);
  const clash = listBanks(db).find((k) => k.id !== exceptId && normalizeName(k.name) === key);
  if (clash) {
    throw new Error(`There's already a bank called "${clash.name}". Give this one another name.`);
  }
}

export function createBank(db: Database.Database, bank: NewBank): number {
  assertBankName(db, bank.name, null);
  if (!BANK_PRESETS.includes(bank.preset)) {
    throw new Error("House Budget can't read statements from that bank yet.");
  }
  const info = db
    .prepare(`INSERT INTO banks (name, preset) VALUES (?, ?)`)
    .run(cleanName(bank.name), bank.preset);
  return Number(info.lastInsertRowid);
}

export function getBank(db: Database.Database, id: number): Bank | undefined {
  return db.prepare(`SELECT * FROM banks WHERE id = ?`).get(id) as Bank | undefined;
}

/** Every bank, by name. */
export function listBanks(db: Database.Database): Bank[] {
  return db.prepare(`SELECT * FROM banks ORDER BY name COLLATE NOCASE, id`).all() as Bank[];
}
