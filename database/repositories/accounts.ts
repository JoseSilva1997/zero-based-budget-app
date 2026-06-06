/* ============================================================
   bank_accounts repository (the frontend's "funding accounts").
   The blob `type` maps directly onto the schema `kind` (same value set).
   ============================================================ */
import type Database from 'better-sqlite3';
import type { BankAccount, BankAccountKind } from '../../shared/types';

export interface NewAccount {
  name: string;
  kind: BankAccountKind;
  owner_member_id: number | null;
  sort_order: number;
  color: string | null;
}

export function insertAccount(db: Database.Database, a: NewAccount): number {
  const info = db
    .prepare(
      `INSERT INTO bank_accounts (name, kind, owner_member_id, sort_order, color)
       VALUES (@name, @kind, @owner_member_id, @sort_order, @color)`
    )
    .run(a);
  return Number(info.lastInsertRowid);
}

export function listAccounts(db: Database.Database): BankAccount[] {
  return db
    .prepare(`SELECT * FROM bank_accounts ORDER BY sort_order, id`)
    .all() as BankAccount[];
}

export function deleteAllAccounts(db: Database.Database): void {
  db.prepare(`DELETE FROM bank_accounts`).run();
}
