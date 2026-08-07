/* ============================================================
   Groups & Items - collapsible groups, inline edit, quick-add,
   reorder, delete-this-month-only, and the New Month flow.
   ============================================================ */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

/* ---- moving an item to another group ------------------------------------
   Both ways in, the row's Move menu and a cross-group drag, come through here
   so they cannot report differently or lose the way back. Undo needs the item
   that FOLLOWED the moved one, because that is what restores its old slot
   rather than merely its old group. */
function useMoveItem(month, dispatch) {
  const { state, toast } = useStore();
  const groups = (state && state.months[month] && state.months[month].groups) || [];
  // Keyboard focus after a menu-driven move (opts.restoreFocus): 'dispatch' is
  // fire-and-forget, and the row that held focus unmounts here and remounts
  // under the destination card, so there is no node to hand focus back to
  // until the refetch actually lands it there. This mirrors IncomeSection's
  // pending-ref-plus-effect (MonthBudget.jsx:120-130): wait for the item to
  // show up under its new group in the refreshed tree, then send focus in,
  // rather than guessing at a timeout. Drag drops never set this, so a mouse
  // drag never yanks focus somewhere the pointer didn't ask it to go.
  const pendingFocus = useRef(null);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const landed = groups.some((g) => g.id === pending.toGroupId && g.items.some((it) => it.id === pending.itemId));
    if (!landed) return;
    pendingFocus.current = null;
    focusAllocated(pending.itemId, pending.toGroupId);
  }, [groups]);
  return (itemId, toGroupId, targetId = null, opts = {}) => {
    const from = groups.find((g) => g.items.some((it) => it.id === itemId));
    const to = groups.find((g) => g.id === toGroupId);
    if (!from || !to || from.id === toGroupId) return;
    const idx = from.items.findIndex((it) => it.id === itemId);
    const name = from.items[idx].name;
    const backTo = from.id;
    const backBefore = idx + 1 < from.items.length ? from.items[idx + 1].id : null;
    if (opts.restoreFocus) pendingFocus.current = { itemId, toGroupId };
    dispatch({ type: "moveItem", month, itemId, toGroupId, targetId });
    toast(`Moved "${name}" to ${to.name}.`, "success", {
      label: "Undo",
      onAct: () => dispatch({ type: "moveItem", month, itemId, toGroupId: backTo, targetId: backBefore }),
    });
  };
}

/* The group list the Move button opens. Portalled and fixed: the group card
   clips its children, so a popover drawn inside the row would be cut off at the
   card's edge. It starts off-screen and is placed after measuring, so it never
   flashes in the wrong spot. */
function MoveMenu({ anchorRef, groups, itemName, onPick, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    const btn = anchorRef.current, menu = ref.current;
    if (!btn || !menu) return;
    const a = btn.getBoundingClientRect(), m = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.right - m.width, window.innerWidth - m.width - 8));
    const below = a.bottom + 6;
    const top = below + m.height > window.innerHeight - 8 ? Math.max(8, a.top - 6 - m.height) : below;
    setPos({ top, left });
  }, [anchorRef]);
  // Closing just unmounts the portal, and the DOM node that currently holds
  // focus (an autoFocused or arrowed-to menu item) goes with it, dropping the
  // keyboard/screen-reader user on <body> with no reachable position. Focus
  // only comes back to the anchor when it was still inside the menu at the
  // moment of closing: an outside click has, by then, usually already moved
  // focus to whatever the user just clicked, and reclaiming it here would
  // yank it back away from that control.
  const closeRestoringFocus = useCallback(() => {
    if (anchorRef.current && ref.current && ref.current.contains(document.activeElement)) {
      anchorRef.current.focus();
    }
    onClose();
  }, [anchorRef, onClose]);
  useEffect(() => {
    // The anchor is excluded so its own click toggles the menu shut once,
    // rather than closing here and reopening on the button's handler.
    const onPointerDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      closeRestoringFocus();
    };
    // Fixed position cannot follow a scroll or a resize, so either dismisses
    // it, EXCEPT a scroll that originates inside the menu's own list
    // (.move-menu is 'overflow-y: auto' past nine or so groups): 'e.target' is
    // the scrolled element for that case and 'document' for a page scroll, so
    // a contains() check tells the two apart. Without it, a long group list
    // could never be scrolled to reach the groups past the fold.
    const onScroll = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      closeRestoringFocus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeRestoringFocus);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeRestoringFocus);
    };
  }, [anchorRef, closeRestoringFocus]);
  return createPortal(
    // A plain labelled group of buttons, not role="menu": the list is walked
    // with Tab like any other button group, and none of the arrow-key/Home/End
    // roving-tabindex contract a real menu role promises is implemented here.
    // Claiming the role without the behaviour is worse than not claiming it.
    <div ref={ref} className="move-menu" role="group" aria-label={`Move ${itemName} to another group`}
      style={{ top: pos.top, left: pos.left }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeRestoringFocus(); } }}>
      <div className="move-menu-label">Move to</div>
      {groups.map((g, i) => (
        <button key={g.id} type="button" className="move-menu-item" autoFocus={i === 0}
          onClick={() => { onPick(g.id); closeRestoringFocus(); }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
          {g.isSavings && <Icons.plant size={13} style={{ flex: "none", color: "var(--pos)" }} />}
        </button>
      ))}
    </div>,
    document.body
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
    <div className="fade-in" style={{ padding: "16px", background: "var(--surface-2)", borderTop: "1px solid var(--hairline)" }}>
      {item.actuals.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {item.actuals.map(a => (
            <div key={a.id} style={{ display: "grid", gridTemplateColumns: "var(--budget-cols)", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--hairline)" }}>
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
            <span className="mono" style={{ position: "absolute", right: 4, bottom: "100%", marginBottom: 3, background: "var(--ink)", color: "var(--surface)", fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 4 }}>= {fmt(currency, amtPreview)}</span>
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

function ItemRow({ item, group, currency, dispatch, month, accounts, open, onToggle, onMove, index, count, groups, onMoveToGroup, onDragStart, onDragOverItem, onDrop, onDragEnd, isDragging, isDropTarget, itemDragActive }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [grabbed, setGrabbed] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  // Stable identity, not a fresh arrow every render: MoveMenu's own dismiss
  // effect depends on this, and an unstable onClose tore its listeners down
  // and rebuilt them on every keystroke elsewhere on the page.
  const closeMoveMenu = useCallback(() => setMoveOpen(false), []);
  const moveBtnRef = useRef(null);
  const otherGroups = (groups || []).filter((g) => g.id !== group.id);
  const actual = itemActual(item);
  const diff = round2(item.allocated - actual);
  const over = diff < -0.005;
  return (
    <div
      draggable={grabbed}
      onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnter={(e) => { e.preventDefault(); onDragOverItem(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      /* Only claim the drop when an item is actually being dragged: otherwise
         this is a group drop landing on a row, and it must bubble up to the
         card's own onDrop, which performs the group reorder. */
      onDrop={(e) => {
        if (!itemDragActive) return;
        e.preventDefault();
        e.stopPropagation();
        onDrop();
      }}
      onDragEnd={() => { setGrabbed(false); onDragEnd(); }}
      style={{ borderTop: isDropTarget ? "2px solid var(--accent)" : "1px solid var(--border)", opacity: isDragging ? .4 : 1, background: isDropTarget ? "var(--accent-soft)" : undefined, transition: "background .12s" }}>
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
          style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, background: open ? "var(--surface-sunken)" : "transparent", border: "1px solid transparent", borderRadius: 7, padding: "5px 9px", color: "var(--ink)", transition: ".12s" }}>
          <span className="mono" style={{ fontSize: 14 }}>{fmt(currency, actual)}</span>
          <span style={{ fontSize: 10.5, color: "var(--faint)", background: "var(--surface-sunken)", borderRadius: 5, padding: "1px 5px", minWidth: 16, textAlign: "center" }}>{item.actuals.length}</span>
        </button>
        <div className="col-diff" style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
          <DiffPill diff={diff} currency={currency} />
          <MiniBar actual={actual} allocated={item.allocated} />
        </div>
        {/* Stacked, not side by side: the actions column is 78px wide and drops
            to 68px on narrow windows. The two buttons here are .compact (26px,
            no gap) rather than the app's usual 30px .icon-btn: at 30px the
            stack (62px) out-measures the name+account column (57px) and grows
            every item row by 5px, which adds up over a long month. Do not
            "fix" this back to plain .icon-btn. */}
        <div className="row-actions" style={{ flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: 0, ...(moveOpen ? { opacity: 1, pointerEvents: "auto" } : null) }}>
          <button className="icon-btn compact" aria-label={`Delete item ${item.name} from this month`} title="Delete item (this month only)" onClick={() => setConfirmDelete(true)}><Icons.trash size={15} /></button>
          <button ref={moveBtnRef} className="icon-btn compact" disabled={otherGroups.length === 0}
            aria-haspopup="true" aria-expanded={moveOpen}
            aria-label={otherGroups.length === 0
              ? `Move ${item.name} to another group. Unavailable: no other group in this month.`
              : `Move ${item.name} to another group`}
            title={otherGroups.length === 0 ? "No other group to move this item to" : "Move to another group"}
            onClick={() => setMoveOpen((o) => !o)}><Icons.move size={15} /></button>
          {moveOpen && (
            <MoveMenu anchorRef={moveBtnRef} groups={otherGroups} itemName={item.name}
              onPick={(toGroupId) => onMoveToGroup(toGroupId)}
              onClose={closeMoveMenu} />
          )}
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
    <div ref={rootRef} style={{ padding: "10px 16px", borderTop: "1px solid var(--hairline)", background: "var(--surface-2)" }}>
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
      <div style={{ marginTop: 8, border: "1px solid var(--hairline)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
        {shown.length > 0 ? shown.map((candidate, idx) => (
          <button key={`${candidate.month}:${candidate.name}`} type="button" disabled={saving}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectCandidate(candidate)}
            style={{ width: "100%", minHeight: 40, display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", textAlign: "left", padding: "7px 10px", border: 0, borderTop: idx ? "1px solid var(--hairline)" : "none", background: "transparent", color: "var(--ink)", cursor: "pointer", font: "inherit" }}>
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

function GroupCard({ group, currency, dispatch, month, accounts, state, dragItem, overItem, onItemDragStart, onItemDragOver, onItemDragEnd, onDragStart, onDragOverGroup, onDrop, onDragEnd, isDragging }) {
  const alloc = groupAllocated(group), actual = groupActual(group);
  const diff = round2(alloc - actual);
  const [addingItem, setAddingItem] = useState(false);
  const [grabbed, setGrabbed] = useState(false);
  const [openItems, setOpenItems] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cardRef = useRef(null);
  const moveItemToGroup = useMoveItem(month, dispatch);
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
  /* A drop on a row: within this group it is the reorder it always was, and
     from another group it is a move that lands exactly where the drop-line
     was drawn. */
  const dropOnItem = (targetId) => {
    if (dragItem) {
      if (dragItem.groupId === group.id) {
        if (dragItem.id !== targetId) dispatch({ type: "reorderItem", month, groupId: group.id, itemId: dragItem.id, targetId });
      } else {
        moveItemToGroup(dragItem.id, group.id, targetId);
      }
    }
    onItemDragEnd();
  };
  /* A drop on the header or the footer appends. The header is what makes a
     COLLAPSED group droppable, since it is all such a group renders. */
  const dropOnGroup = () => {
    if (dragItem && dragItem.groupId !== group.id) moveItemToGroup(dragItem.id, group.id, null);
    onItemDragEnd();
  };
  const appendHere = !!(dragItem && dragItem.groupId !== group.id && overItem
    && overItem.groupId === group.id && overItem.targetId === null);
  /* Attached to the header and footer specifically, never to the whole card: a
     card-level dragover fires on every mouse move over a row and would wipe out
     the targetId that row's own dragenter has just set. */
  const appendTargetProps = {
    onDragOver: (e) => {
      if (!dragItem) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      onItemDragOver(group.id, null);
    },
    onDrop: (e) => {
      if (!dragItem) return;
      e.preventDefault();
      e.stopPropagation();
      dropOnGroup();
    },
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
    <div ref={cardRef} id={groupCardId(group.id)} className="card fade-in" draggable={grabbed}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = e.currentTarget.getBoundingClientRect(); onDragOverGroup(e.clientY > r.top + r.height / 2); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={() => { setGrabbed(false); onDragEnd(); }}
      style={{ marginBottom: 14, overflow: "hidden", opacity: isDragging ? .4 : 1, transition: "opacity .12s" }}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
      <DragHandle label={`Reorder group ${group.name}, ${groupIndex + 1} of ${groups.length}`}
        onGrab={() => setGrabbed(true)} onRelease={() => setGrabbed(false)} onMove={moveGroup}
        style={{ background: "var(--surface-2)", borderBottom: group.collapsed ? "none" : "1px solid var(--border-strong)" }} />
      <div {...appendTargetProps} style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "var(--budget-cols)", alignItems: "center", gap: 10, padding: "16px 8px", background: appendHere ? "var(--accent-soft)" : "var(--surface-2)", borderBottom: group.collapsed ? "none" : "1px solid var(--border-strong)", transition: "background .12s" }} className="budget-row">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button className="icon-btn" aria-expanded={!group.collapsed} aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`} onClick={() => dispatch({ type: "toggleCollapse", month, groupId: group.id })} style={{ flex: "none", transform: group.collapsed ? "rotate(-90deg)" : "none", transition: "transform .18s" }}><Icons.down size={16} /></button>
          <span title={group.name} style={{ display: "flex", flex: "1 1 auto", minWidth: 0 }}>
            <TextInline value={group.name} col="groupName" label="Group name" onCommit={(v) => dispatch({ type: "renameGroup", month, groupId: group.id, name: v })} style={{ fontWeight: 600, fontSize: 15, minWidth: 0 }} />
          </span>
          {group.isSavings && <span className="pill pill-pos" style={{ flex: "none" }}><Icons.plant size={12} /> Savings</span>}
        </div>
        <div className="mono" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600, paddingRight: 8 }}>{fmt(currency, alloc, { cents: false })}</div>
        <div className="mono" style={{ textAlign: "right", fontSize: 13.5, color: "var(--ink-2)", paddingRight: 9 }}>{fmt(currency, actual, { cents: false })}</div>
        <div className="col-diff" style={{ textAlign: "right" }}><DiffPill diff={diff} currency={currency} /></div>
        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
          <button className="icon-btn" aria-label={group.isSavings ? `Unmark ${group.name} as a savings group` : `Mark ${group.name} as a savings group`} title={group.isSavings ? "Unmark as savings" : "Mark as savings group"} onClick={() => dispatch({ type: "setSavings", month, groupId: group.id, value: !group.isSavings })} style={{ color: group.isSavings ? "var(--pos)" : undefined }}><Icons.plant size={15} /></button>
          <button className="icon-btn" aria-label={`Delete group ${group.name} from this month`} title="Delete group (this month only)" onClick={() => setConfirmDelete(true)}><Icons.trash size={15} /></button>
        </div>
      </div>
      </div>
      {!group.collapsed && (
        <div>
          {group.items.length === 0 && !addingItem && (
            <div {...appendTargetProps} style={{ padding: "16px", textAlign: "center", color: appendHere ? "var(--ink-2)" : "var(--faint)", fontSize: 13, borderTop: "1px solid var(--hairline)", background: appendHere ? "var(--accent-soft)" : undefined, transition: "background .12s" }}>No items yet.</div>
          )}
          {group.items.map((it, itemIndex) => (
            <ItemRow key={it.id} item={it} group={group} currency={currency} dispatch={dispatch} month={month} accounts={accounts}
              open={openItems.has(it.id)}
              onToggle={() => toggleItem(it.id)}
              index={itemIndex}
              count={group.items.length}
              onMove={(dir) => moveItem(it.id, dir)}
              groups={groups}
              // 'restoreFocus' only fires for this, the keyboard/Move-menu path;
              // drag drops (dropOnItem/dropOnGroup below) never set it, so a
              // mouse drag never yanks focus somewhere the pointer didn't ask
              // it to go.
              onMoveToGroup={(toGroupId) => moveItemToGroup(it.id, toGroupId, null, { restoreFocus: true })}
              isDragging={!!dragItem && dragItem.id === it.id}
              isDropTarget={!!overItem && overItem.groupId === group.id && overItem.targetId === it.id && !(dragItem && dragItem.id === it.id)}
              itemDragActive={!!dragItem}
              onDragStart={() => onItemDragStart(group.id, it.id)}
              onDragOverItem={() => { if (dragItem) onItemDragOver(group.id, it.id); }}
              onDrop={() => dropOnItem(it.id)}
              onDragEnd={onItemDragEnd} />
          ))}
          {addingItem ? (
            <AddItemSearch month={month} groupId={group.id} currency={currency} dispatch={dispatch} itemCount={itemCount} onClose={() => setAddingItem(false)} />
          ) : (
            <div {...appendTargetProps} style={{ background: appendHere ? "var(--accent-soft)" : "var(--surface-2)", borderTop: "1px solid var(--hairline)", padding: "4px 0", transition: "background .12s" }}>
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
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent-soft)" : "var(--surface)", cursor: "pointer", transition: ".14s",
  };
}
/* The tick sits on --accent, so it has to use the ink that theme picked for it:
   plain white measures 1.46:1 on lime and 1.67:1 on cyan, i.e. invisible. */
function radioStyle(active) { return { width: 20, height: 20, borderRadius: 99, flex: "none", marginTop: 1, display: "grid", placeItems: "center", color: "var(--on-accent)", background: active ? "var(--accent)" : "transparent", border: `1.5px solid ${active ? "var(--accent)" : "var(--border-strong)"}` }; }
/* Focusable but not seen: the drawn radio above is the visible one. Not
   display:none or visibility:hidden, which would take it out of the tab order
   (and out of Modal's focus trap) all over again. */
const offscreenInput = { position: "absolute", width: 1, height: 1, opacity: 0, margin: 0 };

export { GroupCard, NewMonthModal, allocFieldId, focusAllocated };
