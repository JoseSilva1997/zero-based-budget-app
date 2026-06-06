/* ============================================================
   household_members repository.
   ============================================================ */
import type Database from 'better-sqlite3';
import type { HouseholdMember } from '../../shared/types';
import { patchById } from './_sql';

export interface NewMember {
  name: string;
  sort_order: number;
  color: string | null;
}

export function insertMember(db: Database.Database, m: NewMember): number {
  const info = db
    .prepare(
      `INSERT INTO household_members (name, sort_order, color)
       VALUES (@name, @sort_order, @color)`
    )
    .run(m);
  return Number(info.lastInsertRowid);
}

export function getMemberById(db: Database.Database, id: number): HouseholdMember | undefined {
  return db.prepare(`SELECT * FROM household_members WHERE id = ?`).get(id) as
    | HouseholdMember
    | undefined;
}

export function listMembers(db: Database.Database): HouseholdMember[] {
  return db
    .prepare(`SELECT * FROM household_members ORDER BY sort_order, id`)
    .all() as HouseholdMember[];
}

export function updateMember(
  db: Database.Database,
  id: number,
  fields: Partial<Pick<HouseholdMember, 'name' | 'color' | 'sort_order'>>
): void {
  patchById(db, 'household_members', id, fields);
}

/**
 * Deletes a member. The owner FK on bank_accounts is ON DELETE SET NULL, so
 * owned accounts simply become shared. Incomes reference members with ON
 * DELETE RESTRICT, so this throws if the member still has incomes anywhere -
 * the caller surfaces that as an error.
 */
export function deleteMember(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM household_members WHERE id = ?`).run(id);
}

export function nextMemberSort(db: Database.Database): number {
  const row = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM household_members`).get() as {
    m: number;
  };
  return row.m + 1;
}

export function deleteAllMembers(db: Database.Database): void {
  db.prepare(`DELETE FROM household_members`).run();
}
