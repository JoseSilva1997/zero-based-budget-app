/* ============================================================
   Groups & Items - collapsible groups, inline edit, quick-add,
   reorder, delete-this-month-only, and the New Month flow.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog, DayField, DiffPill, Icons, MiniBar, Modal, MoneyInput, TextInline, evalMoney, isExpr } from './components.jsx';
import { actualDay, fmt, groupActual, groupAllocated, itemActual, makeActualDate, monthLabel, nextMonthId, normalizeItemName, round2 } from './lib/index.js';
import { useStore } from './store.jsx';
import { AccountSelect } from './Accounts.jsx';

/* The day a new entry starts on: the one most recently added to this item (so a
   run of receipts from the same day needs no re-typing), or the 1st when the
   item has no entries yet. Entries read back in date order, so "most recent"
   is the highest id, not the last row. */
function nextEntryDay(item, month) {
  if (!item.actuals.length) return 1;
  return actualDay(item.actuals.reduce((a, b) => (b.id > a.id ? b : a)), month);
}

/* ---- routing to an item's allocated field -------------------------------
   The over-budget strip on the summary names offending items; naming them is
   only half an answer, so it needs a way to send the user to the field that
   fixes them. The id lives here, next to the markup that carries it. */
const allocFieldId = (itemId) => `alloc-field-${itemId}`;
const groupCardId = (groupId) => `group-card-${groupId}`;

/* Returns false when the row is not on screen at all (its group is collapsed),
   in which case the group's own toggle is the next best place to land. */
function focusAllocated(itemId, groupId) {
  const holder = document.getElementById(allocFieldId(itemId));
  const field = holder && holder.querySelector("input");
  if (field) {
    field.scrollIntoView({ block: "center", behavior: "smooth" });
    field.focus();
    return true;
  }
  const card = groupId != null && document.getElementById(groupCardId(groupId));
  const toggle = card && card.querySelector("button[aria-expanded]");
  if (toggle) {
    toggle.scrollIntoView({ block: "center", behavior: "smooth" });
    toggle.focus();
  }
  return false;
}

/* ---- reorder announcements ---------------------------------------------
   A keyboard move changes nothing a sighted user cannot see, and nothing at
   all for anyone else. One shared region does the telling: a region per row
   would move through the DOM with the row it announces, which is exactly the
   case screen readers do not reliably pick up. */
function announce(message) {
  let el = document.getElementById("reorder-live");
  if (!el) {
    el = document.createElement("div");
    el.id = "reorder-live";
    el.setAttribute("aria-live", "polite");
    el.setAttribute("role", "status");
    el.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap";
    document.body.appendChild(el);
  }
  el.textContent = message;
}

/* The handle reorders by mouse (HTML5 drag on the row) or by keyboard. Both
   live here so the two paths cannot drift apart. */
function DragHandle({ label, onGrab, onRelease, onMove, style }) {
  return (
    <button type="button" className="drag-handle" aria-label={label}
      title="Drag to reorder, or focus this and press the up and down arrow keys"
      onMouseDown={onGrab} onMouseUp={onRelease} onBlur={onRelease}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault(); // otherwise the page scrolls out from under the row
        onMove(e.key === "ArrowUp" ? -1 : 1);
      }}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, flex: "none", cursor: "grab", color: "var(--faint)", border: 0, padding: 0, ...style }}>
      <Icons.drag size={25} />
    </button>
  );
}

function EntriesDrawer({ item, group, currency, dispatch, month }) {
  const { toast } = useStore();
  const [amt, setAmt] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const startDay = nextEntryDay(item, month);
  const [day, setDay] = useState(startDay);
  const dayRef = useRef(null);
  const amtRef = useRef(null);
  useEffect(() => { setDay(startDay); }, [startDay]);
  const focusDay = () => requestAnimationFrame(() => {
    if (dayRef.current) { dayRef.current.focus(); dayRef.current.select(); }
  });
  // 'dayOverride' is for Enter pressed in the day field itself, whose new value
  // is not in 'day' yet.
  const add = (dayOverride) => {
    const n = evalMoney(amt);
    if (n === null || n <= 0) { amtRef.current && amtRef.current.focus(); return; }
    dispatch({ type: "addActual", month, groupId: group.id, itemId: item.id, amount: n, name: name.trim(), note: note.trim(), day: dayOverride === undefined ? day : dayOverride });
    setAmt(""); setName(""); setNote(""); focusDay();
  };
  /* Reconciling a statement is the fastest thing anyone does in this app, and a
     fifth confirmation dialog in the middle of it would cost more than the
     occasional slip. The entry is captured before it goes so the toast can put
     it back instead. */
  const remove = (a) => {
    const restore = { amount: a.amount, name: a.name || "", note: a.note || "", day: actualDay(a, month) };
    dispatch({ type: "removeActual", month, groupId: group.id, itemId: item.id, id: a.id });
    toast(`Removed ${a.name ? `"${a.name}"` : "entry"} from ${item.name}.`, "success", {
      label: "Undo",
      onAct: () => dispatch({ type: "addActual", month, groupId: group.id, itemId: item.id, ...restore }),
    });
  };
  const amtPreview = isExpr(amt) ? evalMoney(amt) : null;
  return (
    <div className="fade-in" style={{ padding: "16px", background: "var(--board)", borderTop: "1px solid var(--rule-faint)" }}>
      {item.actuals.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {item.actuals.map(a => (
            <div key={a.id} style={{ display: "grid", gridTemplateColumns: "var(--budget-cols)", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--rule-faint)" }}>
              <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: 10, paddingLeft: 30, minWidth: 0 }}>
                <DayField day={actualDay(a, month)} monthId={month} title="Day of month (when it was spent)"
                  onCommit={(d) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { date: makeActualDate(month, d) } })} />
                <TextInline value={a.name} placeholder="What was it?" col="entryName" label="What this spending entry was for" onCommit={(v) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { name: v } })} style={{ flex: "1 1 0", minWidth: 0, fontSize: 13 }} />
                <TextInline value={a.note} placeholder="Note" col="entryNote" label="Note for this spending entry" allowEmpty onCommit={(v) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { note: v } })} style={{ flex: "1 1 0", minWidth: 0, fontSize: 13, color: "var(--ink-2)" }} />
              </div>
              <MoneyInput value={a.amount} currency={currency} col="entryAmount" label="Amount spent" onCommit={(v) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { amount: v } })} />
              <div className="col-diff" />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="icon-btn subtle" aria-label={`Remove ${a.name ? `"${a.name}"` : "unnamed"} entry of ${fmt(currency, a.amount)} from ${item.name}`} title="Remove entry" onClick={() => remove(a)}><Icons.x size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "var(--budget-cols)", alignItems: "center", gap: 10, height: 32 }}>
        <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: 10, paddingLeft: 30 }}>
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500, marginRight: 2, whiteSpace: "nowrap" }}>Add spend</span>
          <DayField day={day} monthId={month} title="Day of month for this entry" onCommit={setDay} onEnter={add} inputRef={dayRef} autoFocus />
          <input className="tinput" value={name} aria-label="What the spending was for" onChange={(e) => setName(e.target.value)} placeholder="What was it?" style={{ flex: "1 1 0", minWidth: 0, fontSize: 13, height: 32 }} onKeyDown={(e) => e.key === "Enter" && add()} />
          <input className="tinput" value={note} aria-label="Note for this spending entry (optional)" onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={{ flex: "1 1 0", minWidth: 0, fontSize: 13, height: 32, color: "var(--ink-2)" }} onKeyDown={(e) => e.key === "Enter" && add()} />
        </div>
        <div style={{ position: "relative", height: 32 }}>
          <input ref={amtRef} className="minput" aria-label="Amount spent" style={{ paddingLeft: 8, height: 32, fontSize: 13 }} inputMode="text" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={`${currency}0.00`} onKeyDown={(e) => e.key === "Enter" && add()} />
          {amtPreview !== null && (
            <span className="mono" style={{ position: "absolute", right: 4, bottom: "100%", marginBottom: 3, background: "var(--ink)", color: "var(--on-ink)", fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 4 }}>= {fmt(currency, amtPreview)}</span>
          )}
        </div>
        {/* Add sits in the actions column, under the entries' remove buttons:
            the Difference column is the one that disappears on narrow windows,
            and a button that vanishes with it is a button you cannot press. */}
        <div className="col-diff" />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-sm btn-primary" style={{ height: 32, whiteSpace: "nowrap" }} onClick={() => add()}><Icons.plus size={14} /> Add</button>
        </div>
      </div>
    </div>
  );
}

function ItemRow({ item, group, currency, dispatch, month, accounts, open, onToggle, onMove, index, count, onDragStart, onDragOverItem, onDrop, onDragEnd, isDragging, isDropTarget }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [grabbed, setGrabbed] = useState(false);
  const actual = itemActual(item);
  const diff = round2(item.allocated - actual);
  const over = diff < -0.005;
  return (
    <div
      draggable={grabbed}
      onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnter={(e) => { e.preventDefault(); onDragOverItem(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={() => { setGrabbed(false); onDragEnd(); }}
      style={{ borderTop: isDropTarget ? "2px solid var(--accent)" : "1px solid var(--rule)", opacity: isDragging ? .4 : 1, background: isDropTarget ? "var(--accent-soft)" : undefined, transition: "background .12s" }}>
      <div style={{ display: "flex", alignItems: "stretch", minHeight: "var(--row-h)" }}>
      <DragHandle label={`Reorder ${item.name}, item ${index + 1} of ${count} in ${group.name}`}
        onGrab={() => setGrabbed(true)} onRelease={() => setGrabbed(false)} onMove={onMove} />
      <div className="budget-row" style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "var(--budget-cols)", alignItems: "center", gap: 10, padding: "7px 8px", minHeight: "var(--row-h)" }}>
        <div style={{ minWidth: 0, paddingRight: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          {/* The title is on the wrapper because the field itself is an input:
              it cannot ellipsis, so the full name has to be reachable some
              other way (hover here, or scroll inside the field). */}
          <span title={item.name} style={{ display: "flex", minWidth: 0 }}>
            <TextInline value={item.name} col="itemName" label="Item name" style={{ minWidth: 0 }}
              onCommit={(v) => dispatch({ type: "renameItem", month, groupId: group.id, itemId: item.id, name: v })} />
          </span>
          <div style={{ paddingLeft: 8, minWidth: 0 }}>
            <AccountSelect value={item.account} accounts={accounts} label={`Funding account for ${item.name}`} onChange={(a) => dispatch({ type: "setItemAccount", month, groupId: group.id, itemId: item.id, account: a })} />
          </div>
        </div>
        <div id={allocFieldId(item.id)}>
          <MoneyInput value={item.allocated} currency={currency} col="allocated" label={`Allocated for ${item.name}`}
            onCommit={(v) => dispatch({ type: "updateAllocated", month, groupId: group.id, itemId: item.id, value: v })} />
        </div>
        {/* Named explicitly: read from its contents this button announced as
            "$120.00 3, button", which says nothing about which item it opens. */}
        <button onClick={onToggle} title="View / add spending entries" aria-expanded={open}
          aria-label={`${fmt(currency, actual)} spent on ${item.name} in ${item.actuals.length} ${item.actuals.length === 1 ? "entry" : "entries"}`}
          style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, background: open ? "var(--well)" : "transparent", border: "1px solid transparent", borderRadius: 7, padding: "5px 9px", color: "var(--ink)", transition: ".12s" }}>
          <span className="mono" style={{ fontSize: 14 }}>{fmt(currency, actual)}</span>
          <span style={{ fontSize: 10.5, color: "var(--faint)", background: "var(--well)", borderRadius: 5, padding: "1px 5px", minWidth: 16, textAlign: "center" }}>{item.actuals.length}</span>
        </button>
        <div className="col-diff" style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
          <DiffPill diff={diff} currency={currency} />
          <MiniBar actual={actual} allocated={item.allocated} />
        </div>
        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
          <button className="icon-btn" aria-label={`Delete item ${item.name} from this month`} title="Delete item (this month only)" onClick={() => setConfirmDelete(true)}><Icons.trash size={15} /></button>
        </div>
      </div>
      </div>
      {open && <EntriesDrawer item={item} group={group} currency={currency} dispatch={dispatch} month={month} />}
      {confirmDelete && (
        <ConfirmDialog title={`Delete "${item.name}"?`} width={440}
          confirmLabel="Delete item" icon={<Icons.trash size={15} />}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => { dispatch({ type: "deleteItem", month, groupId: group.id, itemId: item.id }); setConfirmDelete(false); }}>
          This removes the item from this month only. {item.actuals.length > 0 ? `Its ${item.actuals.length} spending ${item.actuals.length === 1 ? "entry" : "entries"} will be deleted too.` : ""} Past months are not affected.
        </ConfirmDialog>
      )}
    </div>
  );
}

function AddItemSearch({ month, groupId, currency, dispatch, onClose, itemCount }) {
  const { reusableItems, toastMsg } = useStore();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const countAtSubmit = useRef(itemCount);
  const seenToast = useRef(null);
  // Candidates come from SQL (items in other months not present in this one).
  // Debounced: 'live' already keeps results in order, but a query per keystroke
  // is still N queries for an N-character term.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      reusableItems(query)
        .then((c) => { if (live) setCandidates(c); })
        .catch((err) => { if (live) { setCandidates([]); console.error("[reusableItems]", err); } });
    }, 140);
    return () => { live = false; clearTimeout(timer); };
  }, [reusableItems, query]);
  const exact = candidates.find(c => normalizeItemName(c.name) === normalizeItemName(query));
  const trimmed = query.trim();
  useEffect(() => {
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);
  /* 'dispatch' is fire-and-forget, so this panel cannot await its own write.
     Closing on the click would unmount the typed name before the write is
     known to have landed. It waits for the group to actually gain an item
     instead, and a failure (an error toast this panel has not seen before)
     hands the text back rather than losing it behind that toast. */
  useEffect(() => {
    if (!saving) return;
    if (itemCount !== countAtSubmit.current) { setQuery(""); setSaving(false); onClose(); return; }
    if (toastMsg && toastMsg !== seenToast.current && toastMsg.tone === "error") {
      setSaving(false);
      if (inputRef.current) inputRef.current.focus();
    }
  }, [saving, itemCount, toastMsg, onClose]);
  const submit = (action) => {
    countAtSubmit.current = itemCount;
    seenToast.current = toastMsg;
    setSaving(true);
    dispatch(action);
  };
  const selectCandidate = (candidate) => {
    submit({ type: "addItem", month, groupId, name: candidate.name, allocated: candidate.allocated, account: candidate.account });
  };
  const createItem = () => {
    if (!trimmed) { onClose(); return; }
    if (exact) { selectCandidate(exact); return; }
    submit({ type: "addItem", month, groupId, name: trimmed });
  };
  const shown = candidates.slice(0, 7);
  return (
    <div ref={rootRef} style={{ padding: "10px 16px", borderTop: "1px solid var(--rule-faint)", background: "var(--board)" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input autoFocus ref={inputRef} className="tinput" value={query} aria-label="Search previous items, or type a new item name" onChange={(e) => setQuery(e.target.value)} placeholder="Search previous items or type new..." style={{ maxWidth: 340 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !saving) createItem();
            if (e.key === "Escape") { setQuery(""); onClose(); }
          }} />
        <button className="btn btn-sm btn-primary" disabled={saving} onMouseDown={(e) => e.preventDefault()} onClick={createItem}>
          {saving ? "Adding…" : exact ? "Add existing" : "Create item"}
        </button>
      </div>
      <div style={{ marginTop: 8, border: "1px solid var(--rule-faint)", borderRadius: 8, overflow: "hidden", background: "var(--well)" }}>
        {shown.length > 0 ? shown.map((candidate, idx) => (
          <button key={`${candidate.month}:${candidate.name}`} type="button" disabled={saving}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectCandidate(candidate)}
            style={{ width: "100%", minHeight: 40, display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", textAlign: "left", padding: "7px 10px", border: 0, borderTop: idx ? "1px solid var(--rule-faint)" : "none", background: "transparent", color: "var(--ink)", cursor: "pointer", font: "inherit" }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{candidate.name}</span>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{candidate.groupName} - {candidate.monthLabel}</span>
            </span>
            <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-2)", whiteSpace: "nowrap" }}>{fmt(currency, candidate.allocated, { cents: false })}</span>
          </button>
        )) : (
          <div style={{ padding: "9px 10px", color: "var(--muted)", fontSize: 12.5 }}>
            {trimmed ? "No previous item matches this search." : "Search items from previous months that are not in this month."}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupCard({ group, currency, dispatch, month, accounts, state, onDragStart, onDragOverGroup, onDrop, onDragEnd, isDragging }) {
  const alloc = groupAllocated(group), actual = groupActual(group);
  const diff = round2(alloc - actual);
  const [addingItem, setAddingItem] = useState(false);
  const [grabbed, setGrabbed] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [openItems, setOpenItems] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cardRef = useRef(null);
  // A group takes its items and their spending with it - count both so the
  // confirm can say exactly what is about to go.
  const itemCount = group.items.length;
  const entryCount = group.items.reduce((n, it) => n + it.actuals.length, 0);
  const toggleItem = (itemId) => setOpenItems(prev => {
    const next = new Set(prev);
    next.has(itemId) ? next.delete(itemId) : next.add(itemId);
    return next;
  });
  useEffect(() => {
    if (openItems.size === 0) return;
    const handlePointerDown = (event) => {
      if (cardRef.current && !cardRef.current.contains(event.target)) setOpenItems(new Set());
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openItems]);
  const endDrag = () => { setDragId(null); setOverId(null); };
  const dropItem = (targetId) => {
    if (dragId && targetId && dragId !== targetId) dispatch({ type: "reorderItem", month, groupId: group.id, itemId: dragId, targetId });
    endDrag();
  };
  /* Keyboard reordering. The row keeps its React key, so the browser moves the
     same node and the handle keeps focus across the write. */
  const moveItem = (itemId, dir) => {
    const from = group.items.findIndex(it => it.id === itemId);
    if (from < 0) return;
    const target = group.items[from + dir];
    const name = group.items[from].name;
    if (!target) { announce(`${name} is already ${dir < 0 ? "first" : "last"} in ${group.name}.`); return; }
    dispatch({ type: "reorderItem", month, groupId: group.id, itemId, targetId: target.id });
    announce(`${name} moved to position ${from + dir + 1} of ${group.items.length} in ${group.name}.`);
  };
  // The sibling groups are only knowable from the month tree, which is what the
  // 'state' prop is for.
  const groups = (state && state.months[month] ? state.months[month].groups : []);
  const groupIndex = groups.findIndex(g => g.id === group.id);
  const moveGroup = (dir) => {
    const target = groupIndex < 0 ? null : groups[groupIndex + dir];
    if (!target) { announce(`${group.name} is already the ${dir < 0 ? "first" : "last"} group.`); return; }
    dispatch({ type: "reorderGroup", month, groupId: group.id, targetId: target.id, after: dir > 0 });
    announce(`${group.name} moved to position ${groupIndex + dir + 1} of ${groups.length}.`);
  };
  return (
    <div ref={cardRef} id={groupCardId(group.id)} className="raised fade-in" draggable={grabbed}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = e.currentTarget.getBoundingClientRect(); onDragOverGroup(e.clientY > r.top + r.height / 2); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={() => { setGrabbed(false); onDragEnd(); }}
      style={{ marginBottom: 14, overflow: "hidden", opacity: isDragging ? .4 : 1, transition: "opacity .12s" }}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
      <DragHandle label={`Reorder group ${group.name}, ${groupIndex + 1} of ${groups.length}`}
        onGrab={() => setGrabbed(true)} onRelease={() => setGrabbed(false)} onMove={moveGroup}
        style={{ background: "var(--board)", borderBottom: group.collapsed ? "none" : "1px solid var(--rule-strong)" }} />
      <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "var(--budget-cols)", alignItems: "center", gap: 10, padding: "16px 8px", background: "var(--board)", borderBottom: group.collapsed ? "none" : "1px solid var(--rule-strong)" }} className="budget-row">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button className="icon-btn" aria-expanded={!group.collapsed} aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`} onClick={() => dispatch({ type: "toggleCollapse", month, groupId: group.id })} style={{ flex: "none", transform: group.collapsed ? "rotate(-90deg)" : "none", transition: "transform .18s" }}><Icons.down size={16} /></button>
          <span title={group.name} style={{ display: "flex", flex: "1 1 auto", minWidth: 0 }}>
            <TextInline value={group.name} col="groupName" label="Group name" onCommit={(v) => dispatch({ type: "renameGroup", month, groupId: group.id, name: v })} style={{ fontWeight: 600, fontSize: 15, minWidth: 0 }} />
          </span>
          {group.isSavings && <span className="pill pill-neutral" style={{ flex: "none" }}><Icons.plant size={12} /> Savings</span>}
        </div>
        <div className="mono" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600, paddingRight: 8 }}>{fmt(currency, alloc, { cents: false })}</div>
        <div className="mono" style={{ textAlign: "right", fontSize: 13.5, color: "var(--ink-2)", paddingRight: 9 }}>{fmt(currency, actual, { cents: false })}</div>
        <div className="col-diff" style={{ textAlign: "right" }}><DiffPill diff={diff} currency={currency} /></div>
        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
          <button className="icon-btn" aria-label={group.isSavings ? `Unmark ${group.name} as a savings group` : `Mark ${group.name} as a savings group`} title={group.isSavings ? "Unmark as savings" : "Mark as savings group"} onClick={() => dispatch({ type: "setSavings", month, groupId: group.id, value: !group.isSavings })}><Icons.plant size={15} /></button>
          <button className="icon-btn" aria-label={`Delete group ${group.name} from this month`} title="Delete group (this month only)" onClick={() => setConfirmDelete(true)}><Icons.trash size={15} /></button>
        </div>
      </div>
      </div>
      {!group.collapsed && (
        <div>
          {group.items.length === 0 && !addingItem && (
            <div style={{ padding: "16px", textAlign: "center", color: "var(--faint)", fontSize: 13, borderTop: "1px solid var(--rule-faint)" }}>No items yet.</div>
          )}
          {group.items.map((it, itemIndex) => (
            <ItemRow key={it.id} item={it} group={group} currency={currency} dispatch={dispatch} month={month} accounts={accounts}
              open={openItems.has(it.id)}
              onToggle={() => toggleItem(it.id)}
              index={itemIndex}
              count={group.items.length}
              onMove={(dir) => moveItem(it.id, dir)}
              isDragging={dragId === it.id}
              isDropTarget={overId === it.id && dragId !== it.id}
              onDragStart={() => setDragId(it.id)}
              onDragOverItem={() => { if (dragId) setOverId(it.id); }}
              onDrop={() => dropItem(it.id)}
              onDragEnd={endDrag} />
          ))}
          {addingItem ? (
            <AddItemSearch month={month} groupId={group.id} currency={currency} dispatch={dispatch} itemCount={itemCount} onClose={() => setAddingItem(false)} />
          ) : (
            <div style={{ background: "var(--board)", borderTop: "1px solid var(--rule-faint)", padding: "4px 0" }}>
              <button className="btn btn-ghost btn-sm" style={{ margin: "8px 10px", color: "var(--muted)" }} onClick={() => setAddingItem(true)}><Icons.plus size={14} /> Add item</button>
            </div>
          )}
        </div>
      )}
      {confirmDelete && (
        <ConfirmDialog title={`Delete "${group.name}"?`}
          confirmLabel="Delete group" icon={<Icons.trash size={15} />}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => { dispatch({ type: "deleteGroup", month, groupId: group.id }); setConfirmDelete(false); }}>
          {itemCount === 0
            ? "This group is empty, so nothing else goes with it. It is removed from this month only, and past months are not affected."
            : <>This removes the group and its {itemCount} {itemCount === 1 ? "item" : "items"}
              {entryCount > 0 ? <> and their {entryCount} spending {entryCount === 1 ? "entry" : "entries"}</> : null} from this month only. Past months are not affected.</>}
        </ConfirmDialog>
      )}
    </div>
  );
}

/* ---- new month modal ---------------------------------------------------- */
function NewMonthModal({ onClose, dispatch }) {
  const { state, getMonth } = useStore();
  const lastId = state.order[state.order.length - 1];
  const targetId = nextMonthId(lastId);
  const lbl = monthLabel(targetId);
  const prevLbl = monthLabel(lastId);
  const hasPrev = !!lastId;
  const [copy, setCopy] = useState(true);
  const [copyIncome, setCopyIncome] = useState(true);
  // The source (latest) month may not be the cached active one - fetch it for counts.
  const [prev, setPrev] = useState(null);
  useEffect(() => {
    let live = true;
    if (lastId) {
      getMonth(lastId)
        .then((m) => { if (live) setPrev(m); })
        // The counts are a nicety; failing to read them must not take the
        // dialog down with them.
        .catch((err) => { if (live) { setPrev(null); console.error("[getMonth]", err); } });
    }
    return () => { live = false; };
  }, [lastId, getMonth]);
  const prevGroups = prev ? prev.groups.length : 0;
  const prevItems = prev ? prev.groups.reduce((a, g) => a + g.items.length, 0) : 0;
  const create = () => { dispatch({ type: "createMonth", id: targetId, copyFrom: copy ? lastId : null, copyIncome: copy && copyIncome }); onClose(); };
  return (
    <Modal onClose={onClose} width={500}>
      <h3>Start {lbl.mo} {lbl.yr}</h3>
      <p>Create the next month's budget{hasPrev ? ` by carrying over your structure from ${prevLbl.short}.` : "."}</p>
      {hasPrev && (
        /* Real radios, because this is the only decision the dialog exists to
           make: the styled divs it used to draw were not focusable, so Tab went
           straight from Cancel to Create and Ctrl+N opened a dialog that could
           not be answered from the keyboard. The card is no longer a <label>
           either - the "also copy income" checkbox nests inside it, and a label
           inside a label belongs to nothing in particular. */
        <div role="radiogroup" aria-label="What to put in the new month" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          <div className="copy-opt" style={optStyle(copy)} onClick={() => setCopy(true)}>
            <input type="radio" id="new-month-copy" name="new-month-source" checked={copy} style={offscreenInput}
              onChange={() => setCopy(true)} />
            <div aria-hidden="true" style={radioStyle(copy)}>{copy && <Icons.check size={13} />}</div>
            <div>
              <label htmlFor="new-month-copy" style={{ display: "block", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>Copy structure from {prevLbl.short}</label>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{prevGroups} groups · {prevItems} items · allocated amounts. Spending starts fresh at zero.</div>
              {copy && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, color: "var(--ink-2)" }}>
                  <input type="checkbox" checked={copyIncome} onChange={(e) => setCopyIncome(e.target.checked)} /> Also copy income amounts
                </label>
              )}
            </div>
          </div>
          <div className="copy-opt" style={optStyle(!copy)} onClick={() => setCopy(false)}>
            <input type="radio" id="new-month-empty" name="new-month-source" checked={!copy} style={offscreenInput}
              onChange={() => setCopy(false)} />
            <div aria-hidden="true" style={radioStyle(!copy)}>{!copy && <Icons.check size={13} />}</div>
            <div>
              <label htmlFor="new-month-empty" style={{ display: "block", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>Start empty</label>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>A blank month - add groups and items from scratch.</div>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={create}><Icons.plus size={15} /> Create {lbl.mo}</button>
      </div>
      <div style={{ marginTop: 14, fontSize: 11.5, color: "var(--faint)", display: "flex", alignItems: "center", gap: 6 }}>
        <Icons.check size={13} /> The new month is fully independent - edits here never change past months.
      </div>
    </Modal>
  );
}
/* No focus ring here: `.copy-opt:focus-within` in the stylesheet draws it from
   the off-screen radio inside, so the two cannot disagree. */
function optStyle(active) {
  return {
    position: "relative", display: "flex", gap: 12, padding: "13px 14px", borderRadius: 11,
    border: `1px solid ${active ? "var(--accent)" : "var(--rule)"}`,
    background: active ? "var(--accent-soft)" : "var(--raised)", cursor: "pointer", transition: ".14s",
  };
}
/* The tick sits on --accent, so it has to use the ink that theme picked for it:
   plain white measures 1.46:1 on lime and 1.67:1 on cyan, i.e. invisible. */
function radioStyle(active) { return { width: 20, height: 20, borderRadius: 99, flex: "none", marginTop: 1, display: "grid", placeItems: "center", color: "var(--on-accent)", background: active ? "var(--accent)" : "transparent", border: `1.5px solid ${active ? "var(--accent)" : "var(--rule-strong)"}` }; }
/* Focusable but not seen: the drawn radio above is the visible one. Not
   display:none or visibility:hidden, which would take it out of the tab order
   (and out of Modal's focus trap) all over again. */
const offscreenInput = { position: "absolute", width: 1, height: 1, opacity: 0, margin: 0 };

export { GroupCard, NewMonthModal, allocFieldId, focusAllocated };
