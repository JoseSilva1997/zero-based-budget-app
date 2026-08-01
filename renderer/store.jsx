/* ============================================================
   Renderer store.

   The SQLite database in the main process is the single source of truth. This
   store holds a lightweight read cache (settings, the active month's tree, and
   the month-key list) rebuilt from SQL; it is never written back as a blob.
   Mutations are granular IPC calls, and after each one we refetch the affected
   month tree (or settings) from SQL.

   'dispatch' maps the action objects the components emit to the matching
   granular IPC call, so screens issue, e.g., { type: "addItem", ... } and the
   store performs the corresponding 'item:add' write plus a refetch.
   ============================================================ */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { api, hasApi, spentOn, dayFromMonthDay } from "./lib/api.js";
import { THEME_IDS, buildEmpty, monthLabel } from "./lib/index.js";

const DEFAULT_COLOR = "#7a7a7a";
const StoreContext = createContext(null);

/* ---------- shape adapters (SQL read models -> blob the UI expects) ------- */

function treeToBlobMonth(tree) {
  // The SQL tree already uses the UI field names; key the month by its string.
  return { id: tree.month, incomes: tree.incomes, groups: tree.groups };
}

function settingsFromBootstrap(bs) {
  const theme = THEME_IDS.includes(bs.settings.theme) ? bs.settings.theme : "indigo";
  return {
    currency: bs.settings.currency || "$",
    theme,
    autoBackup: bs.settings.autoBackup || "onclose",
    lastBackup: bs.settings.lastBackup || null,
    members: (bs.settings.members || []).map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color || DEFAULT_COLOR,
    })),
    accounts: (bs.settings.accounts || []).map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color || DEFAULT_COLOR,
      owner: a.owner_member_id,
      type: a.kind,
    })),
  };
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ---------- patch normalisers (action payloads -> IPC fields) ------------- */

function normIncomePatch(p) {
  const out = {};
  if ("label" in p) out.label = p.label;
  if ("amount" in p) out.amount = p.amount;
  if ("memberId" in p) out.memberId = Number(p.memberId);
  return out;
}

function normActualPatch(monthKey, p) {
  const out = {};
  if ("amount" in p) out.amount = p.amount;
  if ("name" in p) out.name = p.name;
  if ("note" in p) out.note = p.note;
  if ("date" in p) out.spent_on = spentOn(monthKey, dayFromMonthDay(p.date));
  return out;
}

function normAccountPatch(p) {
  const out = {};
  if ("name" in p) out.name = p.name;
  if ("color" in p) out.color = p.color;
  if ("type" in p) out.kind = p.type;
  if ("owner" in p) out.owner = p.owner != null && p.owner !== "" ? Number(p.owner) : null;
  return out;
}

const idify = (v) => (v != null && v !== "" ? Number(v) : null);

/* ---------- error copy ---------------------------------------------------
   SQLite speaks in constraint names. Users need to know what failed and what
   to do about it, so translate the signatures we actually produce and pass
   anything else through unchanged rather than inventing a cause. */
function humanError(raw, actionType) {
  const m = String(raw || "");
  if (/FOREIGN KEY constraint failed/i.test(m)) {
    if (actionType === "removeMember") {
      return "That person still has income recorded in at least one month, so they can't be removed. Delete their income rows first if you really want them gone.";
    }
    if (actionType === "removeAccount") {
      return "That account is still in use and couldn't be removed.";
    }
    return "That can't be removed while something else still refers to it.";
  }
  if (/SQLITE_BUSY|database is locked/i.test(m)) {
    return "Your budget file is busy. If House Budget is open in another window, close it and try again.";
  }
  if (/readonly|SQLITE_READONLY/i.test(m)) {
    return "Your budget file is read-only, so the change couldn't be saved. Check the file's permissions in the data folder.";
  }
  if (/disk I\/O|SQLITE_IOERR|ENOSPC|no space/i.test(m)) {
    return "The change couldn't be written to disk. Check that this device isn't out of space.";
  }
  return m;
}

/* ---------- provider ----------------------------------------------------- */

export function StoreProvider({ children }) {
  const [state, setState] = useState(null); // { settings, months, order, activeMonth }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { message, id } - recoverable, shown as a toast
  const [fatal, setFatal] = useState(null); // Error - the app never came up

  const stateRef = useRef(state);
  const monthListRef = useRef([]); // [{ id, month }]
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const idForKey = useCallback(
    (key) => {
      const row = monthListRef.current.find((m) => m.month === key);
      return row ? row.id : null;
    },
    []
  );

  const raise = useCallback((err, actionType) => {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[store]", actionType || "", raw);
    setError({ message: humanError(raw, actionType), id: Date.now() + Math.random() });
  }, []);

  /* ---- full (re)hydrate from SQL ----
     The renderer is a view layer: it holds only the ACTIVE month's tree (plus
     settings + the month-key list). Other months are fetched on demand. */
  const reload = useCallback(async () => {
    // 'finally', not a trailing call: a throw here used to leave 'loading' true
    // forever, which showed as a loading screen that never resolved.
    try {
      if (!hasApi) {
        const empty = buildEmpty();
        monthListRef.current = empty.order.map((k) => ({ id: k, month: k }));
        setState(empty);
        return;
      }
      let bs = await api.bootstrap();
      if (!bs.monthList || bs.monthList.length === 0) {
        // Fresh/empty DB: seed the current month so the budget screen has a month.
        await api.monthCreate({ month: currentMonthKey() });
        bs = await api.bootstrap();
      }
      monthListRef.current = bs.monthList;
      const order = bs.monthList.map((m) => m.month);
      const activeMonth =
        bs.activeMonth && order.includes(bs.activeMonth)
          ? bs.activeMonth
          : order[order.length - 1] || "";
      const activeRow = bs.monthList.find((m) => m.month === activeMonth);
      const months = {};
      if (activeRow) {
        const tree = await api.getMonth(activeRow.id);
        if (tree) months[tree.month] = treeToBlobMonth(tree);
      }
      setState({ settings: settingsFromBootstrap(bs), months, order, activeMonth });
    } finally {
      setLoading(false);
    }
  }, []);

  /* ---- targeted refreshes ---- */
  const refreshMonth = useCallback(async (key) => {
    const id = idForKey(key);
    if (id == null || !hasApi) return;
    const tree = await api.getMonth(id);
    setState((s) => {
      if (!s) return s;
      const months = { ...s.months };
      if (tree) months[key] = treeToBlobMonth(tree);
      else delete months[key];
      return { ...s, months };
    });
  }, [idForKey]);

  const refreshSettings = useCallback(async () => {
    if (!hasApi) return;
    const bs = await api.bootstrap();
    setState((s) => (s ? { ...s, settings: settingsFromBootstrap(bs) } : s));
  }, []);

  /* A failure during the FIRST load is different in kind from a failed edit:
     there is no UI to fall back to, so it gets its own screen rather than a
     toast that nothing is mounted to show. */
  useEffect(() => {
    reload().catch((err) => {
      console.error("[store] bootstrap failed", err);
      setFatal(err instanceof Error ? err : new Error(String(err)));
    });
  }, [reload]);

  const retry = useCallback(() => {
    setFatal(null);
    setLoading(true);
    reload().catch((err) => setFatal(err instanceof Error ? err : new Error(String(err))));
  }, [reload]);

  /* ---- action dispatch: map each action to its granular IPC call ---- */
  const dispatch = useCallback(
    (action) => {
      if (!hasApi) {
        raise(new Error("This action needs the desktop app."));
        return;
      }
      const A = action;
      const mk = A.month || (stateRef.current ? stateRef.current.activeMonth : "");
      const run = async () => {
        switch (A.type) {
          case "setActive": {
            await api.monthSetActive(A.id);
            // Load the target month's tree if we haven't cached it yet.
            const have = stateRef.current && stateRef.current.months[A.id];
            const id = have ? null : idForKey(A.id);
            const tree = id != null ? await api.getMonth(id) : null;
            setState((s) => {
              if (!s) return s;
              const months = tree ? { ...s.months, [A.id]: treeToBlobMonth(tree) } : s.months;
              return { ...s, activeMonth: A.id, months };
            });
            return;
          }

          case "addIncome":
            await api.incomeAdd(idForKey(mk), Number(A.memberId));
            return refreshMonth(mk);
          case "updateIncome":
            await api.incomeUpdate(Number(A.id), normIncomePatch(A.patch));
            return refreshMonth(mk);
          case "removeIncome":
            await api.incomeRemove(Number(A.id));
            return refreshMonth(mk);

          case "updateAllocated":
            await api.itemUpdate(Number(A.itemId), { allocated: A.value });
            return refreshMonth(mk);
          case "setItemAccount":
            await api.itemUpdate(Number(A.itemId), { account: idify(A.account) });
            return refreshMonth(mk);
          case "renameItem":
            await api.itemUpdate(Number(A.itemId), { name: A.name });
            return refreshMonth(mk);

          case "renameGroup":
            await api.groupUpdate(Number(A.groupId), { name: A.name });
            return refreshMonth(mk);
          case "toggleCollapse": {
            const mo = stateRef.current && stateRef.current.months[mk];
            const g = mo && mo.groups.find((x) => x.id === A.groupId);
            await api.groupUpdate(Number(A.groupId), { collapsed: !(g && g.collapsed) });
            return refreshMonth(mk);
          }
          case "setSavings":
            await api.groupUpdate(Number(A.groupId), { isSavings: !!A.value });
            return refreshMonth(mk);

          case "addActual":
            await api.actualAdd(Number(A.itemId), {
              amount: A.amount,
              name: A.name || "",
              note: A.note || "",
              spent_on: spentOn(mk, A.day),
            });
            return refreshMonth(mk);
          case "updateActual":
            await api.actualUpdate(Number(A.id), normActualPatch(mk, A.patch));
            return refreshMonth(mk);
          case "removeActual":
            await api.actualRemove(Number(A.id));
            return refreshMonth(mk);

          case "addGroup":
            await api.groupAdd(idForKey(mk), A.name);
            return refreshMonth(mk);
          case "deleteGroup":
            await api.groupDelete(Number(A.groupId));
            return refreshMonth(mk);
          case "addItem":
            await api.itemAdd(Number(A.groupId), {
              name: A.name,
              allocated: A.allocated,
              account: idify(A.account),
            });
            return refreshMonth(mk);
          case "deleteItem":
            await api.itemDelete(Number(A.itemId));
            return refreshMonth(mk);

          case "reorderGroup":
            await api.groupReorder(idForKey(mk), Number(A.groupId), Number(A.targetId), !!A.after);
            return refreshMonth(mk);
          case "reorderItem":
            await api.itemReorder(Number(A.groupId), Number(A.itemId), Number(A.targetId));
            return refreshMonth(mk);

          case "createMonth":
            await api.monthCreate({
              month: A.id,
              copyFrom: A.copyFrom ? idForKey(A.copyFrom) : undefined,
              copyIncome: !!A.copyIncome,
            });
            return reload();

          case "updateSettings":
            setState((s) => (s ? { ...s, settings: { ...s.settings, ...A.patch } } : s));
            await api.settingsUpdate(A.patch);
            return;

          case "addMember":
            await api.memberAdd({ name: A.name, color: A.color });
            return refreshSettings();
          case "updateMember":
            await api.memberUpdate(Number(A.id), A.patch);
            return refreshSettings();
          case "removeMember":
            await api.memberRemove(Number(A.id));
            return refreshSettings();

          case "addAccount":
            await api.accountAdd({ name: A.name, color: A.color, kind: A.accType, owner: null });
            return refreshSettings();
          case "updateAccount":
            await api.accountUpdate(Number(A.id), normAccountPatch(A.patch));
            return refreshSettings();
          case "removeAccount":
            await api.accountRemove(Number(A.id));
            return reload(); // item refs nulled across months

          case "restore":
          case "reload":
            return reload();
          case "refreshSettings":
            return refreshSettings();

          default:
            return;
        }
      };
      run().catch((err) => raise(err, A.type));
    },
    [idForKey, refreshMonth, refreshSettings, reload, raise]
  );

  /* ---- on-demand SQL reads for cross-month views ---- */
  const trends = useCallback(async () => {
    if (!hasApi) return [];
    const points = await api.trends();
    // Key each point by its month string and attach a display label, matching
    // what the Dashboard/History components and charts expect.
    return points.map((p) => ({ ...p, id: p.month, label: monthLabel(p.month).short }));
  }, []);

  const reusableItems = useCallback(async (query) => {
    if (!hasApi || !stateRef.current) return [];
    const id = idForKey(stateRef.current.activeMonth);
    if (id == null) return [];
    const list = await api.reusableItems(id, query || "");
    return list.map((c) => ({ ...c, monthLabel: monthLabel(c.month).short }));
  }, [idForKey]);

  const getMonth = useCallback(async (key) => {
    if (!hasApi) return null;
    const id = idForKey(key);
    if (id == null) return null;
    const tree = await api.getMonth(id);
    return tree ? treeToBlobMonth(tree) : null;
  }, [idForKey]);

  const value = {
    state,
    loading,
    error,
    fatal,
    retry,
    dispatch,
    reload,
    refreshSettings,
    trends,
    reusableItems,
    getMonth,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
