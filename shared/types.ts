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
export type BudgetMonthStatus = 'open' | 'closed' | 'archived';

export interface HouseholdMember {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
  color: string | null; // migration 2
  created_at: string;
  updated_at: string;
}

export interface BankAccount {
  id: number;
  name: string;
  kind: BankAccountKind;
  owner_member_id: number | null;
  sort_order: number;
  is_active: number;
  color: string | null; // migration 3
  created_at: string;
  updated_at: string;
}

export interface BudgetMonth {
  id: number;
  month: string; // YYYY-MM
  notes: string | null;
  status: BudgetMonthStatus;
  created_at: string;
  updated_at: string;
}

export interface BudgetIncome {
  id: number;
  budget_month_id: number;
  household_member_id: number;
  label: string;
  amount_cents: number;
  is_expected: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BudgetGroup {
  id: number;
  budget_month_id: number;
  template_id: number | null;
  name: string;
  kind: GroupKind;
  sort_order: number;
  collapsed: number; // migration 4
  created_at: string;
  updated_at: string;
}

export interface BudgetItem {
  id: number;
  budget_group_id: number;
  template_id: number | null;
  name: string;
  planned_cents: number;
  actual_cents: number; // kept in sync by triggers
  carryover_cents: number;
  notes: string | null;
  is_recurring: number;
  is_fixed: number;
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
  entered_by_member_id: number | null;
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

/* ---------- 3. Computed / nested types (per the brief) ------------------- */
/* Aggregates the repository layer can compute in SQL. Not all are consumed by
   the current renderer (it recomputes from the blob), but they back the
   funding-plan / month-detail logic the brief's Phase 2 requires. */

export interface FundingAccountTotal {
  bank_account_id: number | null;
  allocated_cents: number;
  actual_cents: number;
  item_count: number;
}

export interface MonthTotals {
  income_cents: number;
  allocated_cents: number;
  actual_cents: number;
  savings_cents: number;
  unallocated_cents: number;
}

export interface BudgetMonthDetail {
  month: BudgetMonth;
  totals: MonthTotals;
  fundingPlan: FundingAccountTotal[];
  incomes: BudgetIncome[];
  groups: Array<
    BudgetGroup & {
      items: Array<BudgetItem & { actuals: BudgetItemActualEntry[] }>;
    }
  >;
}

/* ---------- 4. IPC envelope + payloads ----------------------------------- */

export type IpcResult<T> = { data: T } | { error: string };

export interface BackupInfo {
  path: string;
  fileName: string;
  savedAt: string; // ISO-ish display string
  size: number;
}
