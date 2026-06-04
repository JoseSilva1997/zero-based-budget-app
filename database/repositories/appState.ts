/* ============================================================
   AppState <-> normalised schema.

   The renderer speaks a single nested blob (dollars, string ids, "M/DD"
   dates). This module decomposes that blob into normalised rows on save,
   and reconstructs it on load. Save is a full-replace inside one
   transaction (the frontend always sends the whole authoritative state).
   ============================================================ */
import type Database from 'better-sqlite3';
import type {
  AppState,
  BlobMember,
  BlobAccount,
  BlobMonth,
  BankAccountKind,
  AutoBackupMode,
} from '../../shared/types';
import { getMeta, setMeta } from './meta';
import { insertMember, listMembers, deleteAllMembers } from './members';
import { insertAccount, listAccounts, deleteAllAccounts } from './accounts';
import {
  insertMonth,
  insertIncome,
  insertGroup,
  insertItem,
  insertActualEntry,
  listMonths,
  listIncomes,
  listGroups,
  listItems,
  listActuals,
  deleteAllMonths,
} from './months';

/* ---------- conversions -------------------------------------------------- */

const DEFAULT_COLOR = '#7a7a7a';
const VALID_KINDS: BankAccountKind[] = ['main', 'joint', 'wallet', 'savings', 'other'];

function dollarsToCents(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100);
}

function centsToDollars(c: number): number {
  return Math.round(c) / 100;
}

function toKind(type: string): BankAccountKind {
  return (VALID_KINDS as string[]).includes(type) ? (type as BankAccountKind) : 'other';
}

/** "YYYY-MM" + blob "M/DD" -> "YYYY-MM-DD". Falls back to the 1st of the month. */
function deriveSpentOn(monthId: string, date: string): string {
  const year = monthId.slice(0, 4);
  const parts = String(date || '').split('/');
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const d = Number(parts[1]);
    if (Number.isInteger(m) && Number.isInteger(d) && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return `${monthId}-01`;
}

/** "YYYY-MM-DD" -> blob "M/DD" (unpadded month, padded day, matching the UI). */
function toMonthDay(spentOn: string): string {
  const parts = String(spentOn).split('-');
  if (parts.length === 3) {
    return `${Number(parts[1])}/${parts[2]}`;
  }
  return spentOn;
}

/* ---------- save (decompose) --------------------------------------------- */

export function saveAppState(db: Database.Database, state: AppState): void {
  const tx = db.transaction((s: AppState) => {
    // Full replace. Order matters: months cascade-delete incomes/groups/items/
    // entries; then accounts; then members (now unreferenced).
    deleteAllMonths(db);
    deleteAllAccounts(db);
    deleteAllMembers(db);

    // Members -> id map.
    const memberIdMap = new Map<string, number>();
    (s.settings.members || []).forEach((m: BlobMember, idx) => {
      const id = insertMember(db, {
        name: m.name,
        sort_order: idx,
        color: m.color || DEFAULT_COLOR,
      });
      memberIdMap.set(m.id, id);
    });

    // Accounts -> id map.
    const accountIdMap = new Map<string, number>();
    (s.settings.accounts || []).forEach((a: BlobAccount, idx) => {
      const id = insertAccount(db, {
        name: a.name,
        kind: toKind(a.type),
        owner_member_id: a.owner ? memberIdMap.get(a.owner) ?? null : null,
        sort_order: idx,
        color: a.color || DEFAULT_COLOR,
      });
      accountIdMap.set(a.id, id);
    });

    // Months: iterate `order` first, then any stray month keys not in order.
    const orderedIds = [...(s.order || [])];
    for (const key of Object.keys(s.months || {})) {
      if (!orderedIds.includes(key)) orderedIds.push(key);
    }

    for (const monthId of orderedIds) {
      const mo: BlobMonth | undefined = s.months[monthId];
      if (!mo) continue;
      const dbMonthId = insertMonth(db, monthId);

      (mo.incomes || []).forEach((inc, idx) => {
        const memberId = memberIdMap.get(inc.memberId);
        if (memberId == null) return; // income with no known member is dropped
        insertIncome(db, {
          budget_month_id: dbMonthId,
          household_member_id: memberId,
          label: inc.label || 'Income',
          amount_cents: dollarsToCents(inc.amount),
          sort_order: idx,
        });
      });

      (mo.groups || []).forEach((g, gIdx) => {
        const dbGroupId = insertGroup(db, {
          budget_month_id: dbMonthId,
          name: g.name,
          kind: g.isSavings ? 'savings' : 'spend',
          sort_order: gIdx,
          collapsed: g.collapsed ? 1 : 0,
        });

        (g.items || []).forEach((it, iIdx) => {
          const dbItemId = insertItem(db, {
            budget_group_id: dbGroupId,
            name: it.name,
            planned_cents: dollarsToCents(it.allocated),
            bank_account_id: it.account ? accountIdMap.get(it.account) ?? null : null,
            sort_order: iIdx,
          });

          (it.actuals || []).forEach((a) => {
            insertActualEntry(db, {
              budget_item_id: dbItemId,
              spent_on: deriveSpentOn(monthId, a.date),
              amount_cents: dollarsToCents(a.amount),
              description: a.note ? a.note : null,
            });
          });
        });
      });
    }

    // Blob-level scalars.
    setMeta(db, 'currency', s.settings.currency ?? '$');
    setMeta(db, 'theme', s.settings.theme ?? 'indigo');
    setMeta(db, 'autoBackup', s.settings.autoBackup ?? 'onclose');
    setMeta(db, 'lastBackup', s.settings.lastBackup ?? null);
    setMeta(db, 'activeMonth', s.activeMonth ?? '');
    setMeta(db, 'saved', '1');
  });

  tx(state);
}

/* ---------- load (reconstruct) ------------------------------------------- */

export function loadAppState(db: Database.Database): AppState | null {
  // A truly fresh DB (never saved) -> null, so the renderer seeds itself.
  if (getMeta(db, 'saved') !== '1') return null;

  const members: BlobMember[] = listMembers(db).map((m) => ({
    id: String(m.id),
    name: m.name,
    color: m.color || DEFAULT_COLOR,
  }));

  const accounts: BlobAccount[] = listAccounts(db).map((a) => ({
    id: String(a.id),
    name: a.name,
    color: a.color || DEFAULT_COLOR,
    owner: a.owner_member_id != null ? String(a.owner_member_id) : null,
    type: a.kind,
  }));

  const months: Record<string, BlobMonth> = {};
  const order: string[] = [];

  for (const month of listMonths(db)) {
    order.push(month.month);
    months[month.month] = {
      id: month.month,
      incomes: listIncomes(db, month.id).map((inc) => ({
        id: String(inc.id),
        memberId: String(inc.household_member_id),
        amount: centsToDollars(inc.amount_cents),
        label: inc.label,
      })),
      groups: listGroups(db, month.id).map((g) => ({
        id: String(g.id),
        name: g.name,
        isSavings: g.kind === 'savings',
        collapsed: !!g.collapsed,
        items: listItems(db, g.id).map((it) => ({
          id: String(it.id),
          name: it.name,
          allocated: centsToDollars(it.planned_cents),
          account: it.bank_account_id != null ? String(it.bank_account_id) : null,
          actuals: listActuals(db, it.id).map((a) => ({
            id: String(a.id),
            amount: centsToDollars(a.amount_cents),
            note: a.description || '',
            date: toMonthDay(a.spent_on),
          })),
        })),
      })),
    };
  }

  const activeMeta = getMeta(db, 'activeMonth');
  const activeMonth = activeMeta && months[activeMeta] ? activeMeta : order[order.length - 1] || '';

  return {
    settings: {
      currency: getMeta(db, 'currency') || '$',
      theme: getMeta(db, 'theme') || 'indigo',
      members,
      accounts,
      autoBackup: (getMeta(db, 'autoBackup') as AutoBackupMode) || 'onclose',
      lastBackup: getMeta(db, 'lastBackup'),
    },
    months,
    order,
    activeMonth,
  };
}
