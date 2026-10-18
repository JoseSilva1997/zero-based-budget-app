/* ============================================================
   banks: the banks you hold accounts with, by the name you give them, each
   reading its statements through one built-in preset (monzo, lloyds,
   revolut, natwest). A bank_account points at its bank, and remembers what
   uploads need: the Revolut product it is, and the account identifier from
   the first statement imported into it.
   ============================================================ */
import type Database from 'better-sqlite3';
import type { Bank, BankPreset } from '../../shared/types';
import { cleanName } from './categories';

export interface NewBank {
  name: string;
  preset: BankPreset;
}

export function createBank(db: Database.Database, bank: NewBank): number {
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
