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

   It resolves to { ok, value } once the write AND its refetch have landed, so
   a screen that has to know the outcome can await it instead of watching the
   month tree for its own edit to appear. It never rejects: a failed write is
   already reported as an error toast here, and a rejection would make every
   fire-and-forget call site an unhandled one. Following the preload's own
   contract, 'value' carries the newly-inserted row for the add actions and is
   undefined for the rest.
   ============================================================ */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api, can, hasApi, spentOn, dayFromMonthDay, uploadStatement } from "./lib/api.js";
import { THEME_IDS, DEFAULT_THEME_ID, buildEmpty, monthLabel } from "./lib/index.js";

const DEFAULT_COLOR = "#7a7a7a";
const StoreContext = createContext(null);

/* What a write that never reached SQL resolves to. Frozen and shared: every
   refusal is the same answer, and nothing downstream may write into it. */
const REFUSED = Object.freeze({ ok: false, value: undefined });

/* ---------- shape adapters (SQL read models -> blob the UI expects) ------- */

function treeToBlobMonth(tree) {
  // The SQL tree already uses the UI field names; key the month by its string.
  return { id: tree.month, incomes: tree.incomes, groups: tree.groups };
}

function settingsFromBootstrap(bs) {
  // A persisted id the app does not ship falls back rather than failing.
  const theme = THEME_IDS.includes(bs.settings.theme) ? bs.settings.theme : DEFAULT_THEME_ID;
  return {
    currency: bs.settings.currency || "$",
    theme,
    autoBackup: bs.settings.autoBackup || "onclose",
    lastBackup: bs.settings.lastBackup || null,
    sidebarCollapsed: bs.settings.sidebarCollapsed === true,
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
  if (/UNIQUE constraint failed/i.test(m)) {
    return "That month is already in your budget. Step to it with the month arrows, or open it from History, rather than creating it again.";
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
  const [fatal, setFatal] = useState(null); // Error - the app never came up
  const [toastMsg, setToastMsg] = useState(null); // { message, tone, action } - the one live toast

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

  /* ---- toast ----
     The store owns it because the store is where failures are found: 'raise'
     can then report one without a round trip through the app shell. Errors
     never expire, since a message you can miss is a message that lets a failed
     write read as a success. An offered action gets longer than a bare
     confirmation, because it has to be read and then acted on. */
  const toastTimer = useRef(null);
  // 'seq' exists so the view can key on it. Two identical messages in a row
  // produce two equal strings, React keeps the same DOM node, and the entrance
  // and the draining edge never restart: the second confirmation arrives
  // already half expired. A counter makes every toast a distinct object.
  const toastSeq = useRef(0);
  const toast = useCallback((message, tone = "success", action) => {
    // The lifetime is decided here and carried ON the message, because the
    // toast draws it: its bottom edge empties over exactly this long. A second
    // copy of these numbers in the view would drift, and the drift would show
    // as an edge that runs out before the toast does. 0 means "never", which is
    // what an error gets - a message you can miss is a message that lets a
    // failed write read as a success.
    const duration = tone === "error" ? 0 : action ? 6000 : 2600;
    setToastMsg({ id: (toastSeq.current += 1), message, tone, action, duration });
    clearTimeout(toastTimer.current);
    if (duration) toastTimer.current = setTimeout(() => setToastMsg(null), duration);
  }, []);
  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current);
    setToastMsg(null);
  }, []);

  const raise = useCallback((err, actionType) => {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[store]", actionType || "", raw);
    toast(humanError(raw, actionType), "error");
  }, [toast]);

  /* ---- full (re)hydrate from SQL ----
     The renderer is a view layer: it holds only the ACTIVE month's tree (plus
     settings + the month-key list). Other months are fetched on demand. */
  const reload = useCallback(async () => {
    // 'finally', not a trailing call: a throw here would otherwise leave
    // 'loading' true forever, showing as a loading screen that never resolves.
    try {
      if (!hasApi()) {
        const empty = buildEmpty();
        monthListRef.current = empty.order.map((k) => ({ id: k, month: k }));
        setState(empty);
        return;
      }
      let bs = await api.bootstrap();
      // A newer version saved this database. The preload hands the refusal
      // back as a value (an Error's fields don't cross the bridge); thrown
      // again here, it reaches the startup screen with its code and versions.
      if (bs.status === "db_too_new") {
        throw Object.assign(new Error(bs.message), { code: bs.status, found: bs.found, supported: bs.supported });
      }
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

  /* ---- targeted refreshes ----
     Groups and categories are shared by every month, so a write made in one
     month (a rename, a collapse, a move, a group reorder) can change how any
     other month reads. Every other cached tree is therefore dropped, and
     'setActive' fetches it again on the next visit; the active month, when it
     is not the one written, is refetched alongside. */
  const refreshMonth = useCallback(async (key) => {
    const id = idForKey(key);
    if (id == null || !hasApi()) return;
    const tree = await api.getMonth(id);
    const active = stateRef.current ? stateRef.current.activeMonth : null;
    const activeId = active && active !== key ? idForKey(active) : null;
    const activeTree = activeId != null ? await api.getMonth(activeId) : null;
    setState((s) => {
      if (!s) return s;
      const months = {};
      if (tree) months[key] = treeToBlobMonth(tree);
      if (activeTree) months[active] = treeToBlobMonth(activeTree);
      return { ...s, months };
    });
  }, [idForKey]);

  const refreshSettings = useCallback(async () => {
    if (!hasApi()) return;
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
      if (!hasApi()) {
        raise(new Error("This action needs the desktop app."));
        return Promise.resolve(REFUSED);
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

          case "addIncome": {
            const row = await api.incomeAdd(idForKey(mk), Number(A.memberId));
            await refreshMonth(mk);
            return row;
          }
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

          case "addActual": {
            const row = await api.actualAdd(Number(A.itemId), {
              amount: A.amount,
              name: A.name || "",
              note: A.note || "",
              spent_on: spentOn(mk, A.day),
            });
            await refreshMonth(mk);
            return row;
          }
          case "updateActual":
            await api.actualUpdate(Number(A.id), normActualPatch(mk, A.patch));
            return refreshMonth(mk);
          case "removeActual":
            await api.actualRemove(Number(A.id));
            return refreshMonth(mk);

          case "addGroup": {
            const row = await api.groupAdd(idForKey(mk), A.name);
            await refreshMonth(mk);
            return row;
          }
          case "deleteGroup":
            // Groups are shared by every month: this takes it out of this one.
            await api.groupDelete(Number(A.groupId), idForKey(mk));
            return refreshMonth(mk);
          case "addItem": {
            // A pick from another month carries its category, and lands in that
            // category's group. An account left out takes the category's default.
            const fields = { name: A.name, allocated: A.allocated };
            if (A.categoryId != null) fields.categoryId = Number(A.categoryId);
            if (A.account !== undefined) fields.account = idify(A.account);
            const row = await api.itemAdd(idForKey(mk), Number(A.groupId), fields);
            await refreshMonth(mk);
            return row;
          }
          case "deleteItem":
            await api.itemDelete(Number(A.itemId));
            return refreshMonth(mk);

          case "setCategoryArchived":
            // The month tree does not change, but the reusable picks it offers
            // do, so the month is refetched like any other item edit.
            await api.categorySetArchived(Number(A.id), !!A.archived);
            return refreshMonth(mk);
          case "mergeCategories": {
            // Folds lines across every month and takes a backup first, so the
            // cached months and 'lastBackup' are all stale: rehydrate.
            const res = await api.categoryMerge(Number(A.fromId), Number(A.intoId));
            await reload();
            return res;
          }

          case "reorderGroup":
            await api.groupReorder(idForKey(mk), Number(A.groupId), Number(A.targetId), !!A.after);
            return refreshMonth(mk);
          case "reorderItem":
            await api.itemReorder(Number(A.groupId), Number(A.itemId), Number(A.targetId));
            return refreshMonth(mk);
          case "moveItem":
            await api.itemMove(
              Number(A.itemId),
              Number(A.toGroupId),
              A.targetId == null ? null : Number(A.targetId)
            );
            return refreshMonth(mk);

          case "createMonth":
            await api.monthCreate({
              month: A.id,
              copyFrom: A.copyFrom ? idForKey(A.copyFrom) : undefined,
              copyIncome: !!A.copyIncome,
            });
            return reload();

          case "deleteMonth": {
            const monthId = idForKey(A.id);
            if (monthId == null || typeof api.monthDelete !== "function") return;
            await api.monthDelete(monthId);
            // Land on the neighbour before rehydrating, so the user is returned
            // to a month that still exists rather than whichever one is last.
            if (A.next) await api.monthSetActive(A.next);
            await reload();
            toast(`${monthLabel(A.id).short} deleted.`);
            return;
          }

          case "updateSettings":
            setState((s) => (s ? { ...s, settings: { ...s.settings, ...A.patch } } : s));
            await api.settingsUpdate(A.patch);
            return;

          case "addMember": {
            const row = await api.memberAdd({ name: A.name, color: A.color });
            await refreshSettings();
            return row;
          }
          case "updateMember":
            await api.memberUpdate(Number(A.id), A.patch);
            return refreshSettings();
          case "removeMember":
            await api.memberRemove(Number(A.id));
            return refreshSettings();

          case "addAccount": {
            const row = await api.accountAdd({ name: A.name, color: A.color, kind: A.accType, owner: null });
            await refreshSettings();
            return row;
          }
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
      return run().then(
        (value) => ({ ok: true, value }),
        (err) => { raise(err, A.type); return REFUSED; }
      );
    },
    [idForKey, refreshMonth, refreshSettings, reload, raise, toast]
  );

  /* Backups are offered from two places, the Settings screen and the
     application menu, so the sequence - write the snapshot, pick up the
     'lastBackup' it set, say so - lives here rather than being spelled out at
     both and drifting. */
  const backupNow = useCallback(async () => {
    // channel: "backup:create" - no input (the DB is already current), returns
    // { path, savedAt, cloud }.
    if (!can("createBackup")) {
      toast("Backups need the desktop app", "error");
      return false;
    }
    try {
      // The local snapshot is the backup; 'cloud' only says whether the copy
      // to the cloud folder also went through. A failed copy is not a failed
      // backup, so it is a plain toast with the reason, not an error.
      const { cloud } = await api.createBackup();
      await refreshSettings();
      if (cloud && cloud.state === "copied") toast("Backup saved and copied to your cloud folder");
      else if (cloud && cloud.state === "failed") toast(`Backup saved on this device. ${cloud.error}`);
      else toast("Backup saved to your data folder");
      return true;
    } catch (err) {
      console.error("backup:create failed", err);
      toast(`Backup failed. ${err.message}`, "error");
      return false;
    }
  }, [refreshSettings, toast]);

  /* ---- on-demand SQL reads for cross-month views ---- */
  const trends = useCallback(async () => {
    if (!hasApi()) return [];
    const points = await api.trends();
    // Key each point by its month string and attach a display label, matching
    // what the Dashboard/History components and charts expect.
    return points.map((p) => ({ ...p, id: p.month, label: monthLabel(p.month).short }));
  }, []);

  const reusableItems = useCallback(async (query) => {
    if (!hasApi() || !stateRef.current) return [];
    const id = idForKey(stateRef.current.activeMonth);
    if (id == null) return [];
    const list = await api.reusableItems(id, query || "");
    return list.map((c) => ({ ...c, monthLabel: monthLabel(c.month).short }));
  }, [idForKey]);

  /* Past spending-entry names for the central quick-entry field. The month is
     the ACTIVE one, because that is where a chosen suggestion has to land. */
  const entrySuggestions = useCallback(async (query) => {
    if (!hasApi() || !stateRef.current) return [];
    const id = idForKey(stateRef.current.activeMonth);
    if (id == null) return [];
    const list = await api.entrySuggestions(id, query || "");
    return list.map((s) => ({ ...s, monthLabel: monthLabel(s.month).short }));
  }, [idForKey]);

  /* Categories, as Settings lists them, and what a merge would move. Both
     write nothing; the writes are the two category actions on dispatch. */
  const categories = useCallback(async () => (hasApi() ? api.categories() : []), []);
  const previewMerge = useCallback(
    (fromId, intoId) => api.categoryPreviewMerge(Number(fromId), Number(intoId)),
    []
  );

  const getMonth = useCallback(async (key) => {
    if (!hasApi()) return null;
    const id = idForKey(key);
    if (id == null) return null;
    const tree = await api.getMonth(id);
    return tree ? treeToBlobMonth(tree) : null;
  }, [idForKey]);

  /* Upload transactions (main/ipc/imports.ts). Months are named by their
     "YYYY-MM" key here like everywhere else in the store, and resolved to the
     id the channels want. The review is recomputed on every read, so the sheet
     reads it again after each of these rather than patching its copy. Only
     the two calls that write or delete entries refresh the month, since the
     rest touch nothing but the pending upload. They throw rather than toast:
     a refusal belongs next to the file or the button that caused it. */
  const imports = useMemo(() => ({
    review: (key) => api.importReview(idForKey(key)),
    history: (key) => api.importHistory(idForKey(key)),
    upload: (key, accountId, file) => uploadStatement(idForKey(key), Number(accountId), file),
    removeFile: (fileId) => api.importRemoveFile(Number(fileId)),
    updateRow: (rowId, patch) => api.importUpdateRow(Number(rowId), patch),
    discard: (batchId) => api.importDiscard(Number(batchId)),
    confirm: async (key, batchId) => {
      const res = await api.importConfirm(Number(batchId));
      await refreshMonth(key);
      return res;
    },
    undo: async (key, batchId) => {
      await api.importUndo(Number(batchId));
      await refreshMonth(key);
    },
    banks: () => api.banks(),
    /* An account's bank, chosen or named inline in its drop zone. A new bank
       is created first, so the account can point at it. */
    setUpBank: async ({ accountId, bankId, newBank, product }) => {
      let id = bankId;
      if (id == null) id = (await api.bankCreate(newBank.name, newBank.preset)).id;
      await api.accountSetBank(Number(accountId), Number(id), product || null);
    },
  }), [idForKey, refreshMonth]);

  const value = {
    state,
    loading,
    fatal,
    retry,
    toast,
    toastMsg,
    dismissToast,
    dispatch,
    reload,
    refreshSettings,
    backupNow,
    trends,
    reusableItems,
    entrySuggestions,
    categories,
    previewMerge,
    getMonth,
    imports,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
