/* ============================================================
   Write model: the AppState reducer and the empty-state factory. Pure — every
   action returns a new state via structuredClone; no React, no I/O.
   ============================================================ */
import { round2 } from "./format.js";
import { makeActualDate } from "./dates.js";

const uid = (() => {
  let n = 1;
  return (p = "id") => `${p}_${(n++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
})();

/* A valid minimal AppState: the current month with nothing in it, no sample
   members or accounts. Used when the database is empty so a deleted data file
   gives a real clean slate. */
export function buildEmpty() {
  const d = new Date();
  const mid = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return {
    settings: { currency: "$", theme: "indigo", members: [], accounts: [], autoBackup: "onclose", lastBackup: null },
    months: { [mid]: { id: mid, incomes: [], groups: [] } },
    order: [mid],
    activeMonth: mid,
  };
}

export function reducer(state, action) {
  const s = structuredClone(state);
  const mo = s.months[action.month] || s.months[s.activeMonth];
  const A = action;
  const findGroup = (gid) => mo.groups.find((g) => g.id === gid);
  const findItem = (gid, iid) => { const g = findGroup(gid); return g && g.items.find((i) => i.id === iid); };
  switch (A.type) {
    case "setActive": s.activeMonth = A.id; break;

    case "addIncome": mo.incomes.push({ id: uid("inc"), memberId: A.memberId, amount: 0, label: "Income" }); break;
    case "updateIncome": { const inc = mo.incomes.find((i) => i.id === A.id); if (inc) Object.assign(inc, A.patch); break; }
    case "removeIncome": mo.incomes = mo.incomes.filter((i) => i.id !== A.id); break;

    case "updateAllocated": { const it = findItem(A.groupId, A.itemId); if (it) it.allocated = Math.max(0, round2(A.value)); break; }
    case "setItemAccount": { const it = findItem(A.groupId, A.itemId); if (it) it.account = A.account || null; break; }
    case "renameItem": { const it = findItem(A.groupId, A.itemId); if (it) it.name = A.name; break; }
    case "renameGroup": { const g = findGroup(A.groupId); if (g) g.name = A.name; break; }
    case "toggleCollapse": { const g = findGroup(A.groupId); if (g) g.collapsed = !g.collapsed; break; }
    case "setSavings": { const g = findGroup(A.groupId); if (g) g.isSavings = A.value; break; }

    case "addActual": { const it = findItem(A.groupId, A.itemId); if (it) it.actuals.push({ id: uid("a"), amount: Math.max(0, round2(A.amount)), note: A.note || "", date: A.date || makeActualDate(A.month, A.day) }); break; }
    case "updateActual": { const it = findItem(A.groupId, A.itemId); if (it) { const a = it.actuals.find((x) => x.id === A.id); if (a) Object.assign(a, A.patch); } break; }
    case "removeActual": { const it = findItem(A.groupId, A.itemId); if (it) it.actuals = it.actuals.filter((x) => x.id !== A.id); break; }

    case "addGroup": mo.groups.push({ id: uid("g"), name: A.name || "New group", isSavings: false, collapsed: false, items: [] }); break;
    case "deleteGroup": mo.groups = mo.groups.filter((g) => g.id !== A.groupId); break;
    case "addItem": { const g = findGroup(A.groupId); if (g) g.items.push({ id: uid("it"), name: A.name || "New item", allocated: A.allocated || 0, account: A.account || null, actuals: [] }); break; }
    case "deleteItem": { const g = findGroup(A.groupId); if (g) g.items = g.items.filter((i) => i.id !== A.itemId); break; }

    case "reorderGroup": { const from = mo.groups.findIndex((g) => g.id === A.groupId); const to = mo.groups.findIndex((g) => g.id === A.targetId); if (from !== -1 && to !== -1 && from !== to) { const [g] = mo.groups.splice(from, 1); const dest = mo.groups.findIndex((x) => x.id === A.targetId); mo.groups.splice(dest + (A.after ? 1 : 0), 0, g); } break; }
    case "reorderItem": { const g = findGroup(A.groupId); if (g) { const from = g.items.findIndex((x) => x.id === A.itemId); const to = g.items.findIndex((x) => x.id === A.targetId); if (from !== -1 && to !== -1 && from !== to) { const [it] = g.items.splice(from, 1); const dest = g.items.findIndex((x) => x.id === A.targetId); g.items.splice(dest + (from < to ? 1 : 0), 0, it); } } break; }

    case "createMonth": {
      const nid = A.id;
      let groups = [];
      if (A.copyFrom && s.months[A.copyFrom]) {
        groups = s.months[A.copyFrom].groups.map((g) => ({ id: uid("g"), name: g.name, isSavings: g.isSavings, collapsed: false, items: g.items.map((it) => ({ id: uid("it"), name: it.name, allocated: it.allocated, account: it.account || null, actuals: [] })) }));
      }
      let incomes = [];
      if (A.copyIncome && A.copyFrom && s.months[A.copyFrom]) {
        incomes = s.months[A.copyFrom].incomes.map((i) => ({ id: uid("inc"), memberId: i.memberId, amount: i.amount, label: i.label }));
      }
      s.months[nid] = { id: nid, incomes, groups };
      if (!s.order.includes(nid)) s.order.push(nid);
      s.order.sort();
      s.activeMonth = nid;
      break;
    }

    case "updateSettings": Object.assign(s.settings, A.patch); break;
    case "addMember": s.settings.members.push({ id: uid("m"), name: A.name || "New member", color: A.color || "#7a7a7a" }); break;
    case "updateMember": { const m = s.settings.members.find((x) => x.id === A.id); if (m) Object.assign(m, A.patch); break; }
    case "removeMember": s.settings.members = s.settings.members.filter((m) => m.id !== A.id); break;

    case "addAccount": s.settings.accounts.push({ id: uid("acc"), name: A.name || "New account", color: A.color || "#7a7a7a", owner: A.owner || null, type: A.accType || "main" }); break;
    case "updateAccount": { const ac = s.settings.accounts.find((x) => x.id === A.id); if (ac) Object.assign(ac, A.patch); break; }
    case "removeAccount": {
      s.settings.accounts = s.settings.accounts.filter((a) => a.id !== A.id);
      Object.values(s.months).forEach((m) => m.groups.forEach((g) => g.items.forEach((it) => { if (it.account === A.id) it.account = null; })));
      break;
    }

    case "restore": return A.data;
    default: break;
  }
  return s;
}
