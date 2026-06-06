/* ============================================================
   Shared domain types.

   Two layers live here:

   1. DB-layer entity types — one per table in `schema`. All money is
      `number` (integer cents); all dates are `string`.
   2. The renderer `AppState` "blob" types — the exact shape the existing
      frontend loads/saves through `window.api`. NOTE: in the blob, money is
      expressed in DOLLARS (float), ids are STRINGS, and actual-entry dates
      are "M/DD" (no year). The repository layer converts between the two.
   ============================================================ */

/* ---------- 1. DB-layer entities (mirror `schema`) ----------------------- */

export type GroupKind = 'spend' | 'savings' | 'debt';
export type BankAccountKind = 'main' | 'joint' | 'wallet' | 'savings' | 'other';

export interface HouseholdMember {
  id: number;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BankAccount {
  id: number;
  name: string;
  kind: BankAccountKind;
  owner_member_id: number | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BudgetMonth {
  id: number;
  month: string; // YYYY-MM
  created_at: string;
  updated_at: string;
}

export interface BudgetIncome {
  id: number;
  budget_month_id: number;
  household_member_id: number;
  label: string;
  amount_cents: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BudgetGroup {
  id: number;
  budget_month_id: number;
  name: string;
  kind: GroupKind;
  collapsed: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BudgetItem {
  id: number;
  budget_group_id: number;
  name: string;
  planned_cents: number;
  bank_account_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BudgetItemActualEntry {
  id: number;
  budget_item_id: number;
  spent_on: string; // YYYY-MM-DD
  amount_cents: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/* ---------- 2. Renderer "blob" (AppState) -------------------------------- */
/* These match `renderer/store.jsx` exactly. Money is DOLLARS (float). */

export interface BlobMember {
  id: string;
  name: string;
  color: string;
}

export type BlobAccountType = 'joint' | 'main' | 'wallet' | 'savings' | 'other';

export interface BlobAccount {
  id: string;
  name: string;
  color: string;
  owner: string | null; // member id, or null = shared
  type: BlobAccountType;
}

export type AutoBackupMode = 'off' | 'onclose' | 'daily';

export interface BlobSettings {
  currency: string;
  theme: string;
  members: BlobMember[];
  accounts: BlobAccount[];
  autoBackup: AutoBackupMode;
  lastBackup: string | null;
}

export interface BlobActual {
  id: string;
  amount: number; // dollars
  note: string;
  date: string; // "M/DD"
}

export interface BlobItem {
  id: string;
  name: string;
  allocated: number; // dollars
  account: string | null; // account id
  actuals: BlobActual[];
}

export interface BlobGroup {
  id: string;
  name: string;
  isSavings: boolean;
  collapsed: boolean;
  items: BlobItem[];
}

export interface BlobIncome {
  id: string;
  memberId: string;
  amount: number; // dollars
  label: string;
}

export interface BlobMonth {
  id: string; // == month key "YYYY-MM"
  incomes: BlobIncome[];
  groups: BlobGroup[];
}

export interface AppState {
  settings: BlobSettings;
  months: Record<string, BlobMonth>;
  order: string[];
  activeMonth: string;
}

/* ---------- 3. IPC envelope + payloads ----------------------------------- */

export type IpcResult<T> = { data: T } | { error: string };

export interface BackupInfo {
  path: string;
  fileName: string;
  savedAt: string; // ISO-ish display string
  size: number;
}
