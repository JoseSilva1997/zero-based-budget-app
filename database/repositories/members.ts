/* ============================================================
   household_members repository.
   ============================================================ */
import type Database from 'better-sqlite3';
import type { HouseholdMember } from '../../shared/types';

export interface NewMember {
  name: string;
  sort_order: number;
  color: string | null;
}

export function insertMember(db: Database.Database, m: NewMember): number {
  const info = db
    .prepare(
      `INSERT INTO household_members (name, sort_order, is_active, color)
       VALUES (@name, @sort_order, 1, @color)`
    )
    .run(m);
  return Number(info.lastInsertRowid);
}

export function listMembers(db: Database.Database): HouseholdMember[] {
  return db
    .prepare(`SELECT * FROM household_members ORDER BY sort_order, id`)
    .all() as HouseholdMember[];
}

export function deleteAllMembers(db: Database.Database): void {
  db.prepare(`DELETE FROM household_members`).run();
}
