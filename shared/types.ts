/* ============================================================
   Shared domain types.

   Two layers live here:

   1. DB-layer entity types - one per table in `schema`. All money is
      `number` (integer cents); all dates are `string`.
   2. The renderer `AppState` "blob" types - the exact shape the existing
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
  name: string | null; // short label: what the spend was
  note: string | null; // optional longer detail
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
  name: string;
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

/* ---------- 3. SQL-computed read models ---------------------------------- */
/* Returned over IPC to the renderer. Money is DOLLARS (float), ids are the
   DB-owned INTEGER PKs, and actual-entry dates carry both the raw "YYYY-MM-DD"
   ('spent_on') and the UI's "M/DD" ('date'). */

export interface ActualRead {
  id: number;
  amount: number; // dollars
  name: string;
  note: string;
  date: string; // "M/DD"
  spent_on: string; // "YYYY-MM-DD"
}

export interface ItemRead {
  id: number;
  name: string;
  allocated: number; // dollars
  account: number | null; // bank_account id
  actuals: ActualRead[];
}

export interface GroupRead {
  id: number;
  name: string;
  isSavings: boolean;
  collapsed: boolean;
  kind: GroupKind;
  items: ItemRead[];
}

export interface IncomeRead {
  id: number;
  memberId: number;
  amount: number; // dollars
  label: string;
}

export interface MonthTree {
  id: number; // budget_months.id
  month: string; // "YYYY-MM"
  incomes: IncomeRead[];
  groups: GroupRead[];
}

export interface MonthTotals {
  income: number;
  allocated: number;
  actual: number;
  savings: number;
  unallocated: number;
}

export interface FundingPlanRow {
  account: BankAccount | null; // null = unassigned bucket
  allocated: number;
  actual: number;
  count: number;
}

export interface OverBudgetRow {
  group: string;
  item: string;
  over: number;
  allocated: number;
  actual: number;
}

export interface TrendPoint {
  id: number;
  month: string; // "YYYY-MM"
  income: number;
  alloc: number;
  actual: number;
  savings: number;
  byGroup: Record<string, number>; // group name -> actual (dollars)
  savingsByCat: Record<string, number>; // item name -> allocated (dollars)
  overCount: number;
  over: OverBudgetRow[]; // the over-budget items themselves (for chronic-offender charts)
  byDay: number[]; // length 32, index 1..31 -> dollars spent on that day-of-month
}

export interface ReusableCandidate {
  name: string;
  allocated: number; // dollars
  account: number | null;
  groupName: string;
  isSavings: boolean;
  month: string; // "YYYY-MM"
}

/** A spending-entry name logged before, offered back for central logging.
 *  'itemId' is the item in the TARGET month it should land under, or null when
 *  that month has no item by the same name and the user must choose one. */
export interface EntrySuggestion {
  name: string; // the entry name as last written
  amount: number; // dollars, the most recent amount logged under this name
  itemId: number | null; // destination in the target month, null = unresolved
  itemName: string; // the item it was last logged under
  groupName: string; // that item's group
  month: string; // "YYYY-MM" it was last logged in
  uses: number; // how many times this name+item pair has been logged
}

export interface BootstrapSettings {
  currency: string;
  theme: string;
  autoBackup: AutoBackupMode;
  lastBackup: string | null;
  members: HouseholdMember[];
  accounts: BankAccount[];
}

/** The one-shot read the renderer issues on startup (and after a restore). */
export interface BootstrapData {
  settings: BootstrapSettings;
  monthList: BudgetMonth[];
  activeMonth: string | null; // "YYYY-MM", null on a fresh/empty DB
}

/* ---------- 4. IPC envelope + payloads ----------------------------------- */

export type IpcResult<T> = { data: T } | { error: string };

export interface BackupInfo {
  path: string;
  fileName: string;
  savedAt: string; // ISO-ish display string
  size: number;
}

/** What a database holds, used to tell the user what a restore would replace. */
export interface DbSummary {
  months: number;
  entries: number;
}

/** A validated restore candidate: file metadata plus its contents. */
export interface BackupSummary extends BackupInfo, DbSummary {}

/** Both sides of a pending restore, so the confirm can name what is at risk. */
export interface RestorePreview {
  live: DbSummary;
  incoming: BackupSummary;
}


/* ---------- 5. CI  ---------------------------------------------- */

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }