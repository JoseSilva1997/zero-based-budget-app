/* ============================================================
   bank_accounts repository (the frontend's "funding accounts").
   The blob `type` maps directly onto the schema `kind` (same value set).
   ============================================================ */
import type Database from 'better-sqlite3';
import type { BankAccount, BankAccountKind } from '../../shared/types';
import { patchById } from './_sql';

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

export function getAccountById(db: Database.Database, id: number): BankAccount | undefined {
  return db.prepare(`SELECT * FROM bank_accounts WHERE id = ?`).get(id) as BankAccount | undefined;
}

export function listAccounts(db: Database.Database): BankAccount[] {
  return db
    .prepare(`SELECT * FROM bank_accounts ORDER BY sort_order, id`)
    .all() as BankAccount[];
}

export function updateAccount(
  db: Database.Database,
  id: number,
  fields: Partial<Pick<BankAccount, 'name' | 'kind' | 'owner_member_id' | 'color' | 'sort_order'>>
): void {
  patchById(db, 'bank_accounts', id, fields);
}

/**
 * Deletes an account. budget_items.bank_account_id has NO ON DELETE action, so
 * the delete would fail while items still reference it - null those references
 * first, both inside one transaction (gotcha #2).
 */
export function deleteAccount(db: Database.Database, id: number): void {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE budget_items SET bank_account_id = NULL WHERE bank_account_id = ?`).run(id);
    db.prepare(`DELETE FROM bank_accounts WHERE id = ?`).run(id);
  });
  tx();
}

export function nextAccountSort(db: Database.Database): number {
  const row = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM bank_accounts`).get() as {
    m: number;
  };
  return row.m + 1;
}

export function deleteAllAccounts(db: Database.Database): void {
  db.prepare(`DELETE FROM bank_accounts`).run();
}
