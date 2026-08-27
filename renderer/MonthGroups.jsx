/* ============================================================
   Groups & Items - collapsible groups, inline edit, quick-add,
   reorder, delete-this-month-only, and the New Month flow.
   ============================================================ */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog, DayField, DiffPill, FieldChip, Icons, MiniBar, Modal, MoneyInput, TextInline } from './ui/index.js';
import { actualDay, cx, evalMoney, fmt, groupActual, groupAllocated, isExpr, itemActual, makeActualDate, monthLabel, nextEntryDay, nextMonthId, normalizeItemName, round2 } from './lib/index.js';
import { useStore } from './store.jsx';
import { AccountSelect } from './Accounts.jsx';

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
    el.className = "sr-only";
    document.body.appendChild(el);
  }
  el.textContent = message;
}

/* The handle reorders by mouse (HTML5 drag on the row) or by keyboard. Both
   live here so the two paths cannot drift apart. */
function DragHandle({ label, onGrab, onRelease, onMove, className = "" }) {
  return (
    <button type="button" className={cx("drag-handle", className)} aria-label={label}
      title="Drag to reorder, or focus this and press the up and down arrow keys"
      onMouseDown={onGrab} onMouseUp={onRelease} onBlur={onRelease}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault(); // otherwise the page scrolls out from under the row
        onMove(e.key === "ArrowUp" ? -1 : 1);
      }}>
      <Icons.drag size={25} />
    </button>
  );
}

/* ---- the drag protocol --------------------------------------------------
   Groups reorder among themselves; items reorder inside a group and move
   between groups. Both kinds live in one hook above the group cards, because
   an item whose drag state belongs to the card it started in is an item that
   can never leave its group.

   One hook rather than five pieces of state threaded down as ten props: the
   card and the rows inside it then read the same drag from the same place, and
   every handler takes the id it acts on, so each caller binds itself instead
   of being handed a pre-bound arrow per row.

   'group' is the id being dragged; 'overGroup' is { id, after } for the card
   the pointer is over and which half of it. 'item' is { id, groupId };
   'overItem' is { groupId, targetId }, where a null targetId means append. */
function useBudgetDrag(month, dispatch) {
  const [group, setGroup] = useState(null);
  const [overGroup, setOverGroup] = useState(null);
  const [item, setItem] = useState(null);
  const [overItem, setOverItem] = useState(null);

  const endGroup = useCallback(() => { setGroup(null); setOverGroup(null); }, []);
  const endItem = useCallback(() => { setItem(null); setOverItem(null); }, []);

  return {
    group, overGroup, item, overItem, endGroup, endItem,
    /* Starting one kind clears the other. A row that unmounts mid-drag (rare,
       but the drag ends outside any listener that could clear it) never fires
       its own dragend, which would otherwise leave the other kind stuck set
       and a later drop misread as the wrong one. */
    startGroup: (id) => { setItem(null); setGroup(id); },
    startItem: (groupId, id) => { setGroup(null); setItem({ id, groupId }); },
    overGroupAt: (id, after) => { if (group) setOverGroup({ id, after }); },
    overItemAt: (groupId, targetId) => { if (item) setOverItem({ groupId, targetId }); },
    dropGroup: (targetId) => {
      if (group && targetId && group !== targetId) {
        dispatch({ type: "reorderGroup", month, groupId: group, targetId, after: !!(overGroup && overGroup.after) });
      }
      endGroup();
    },
  };
}

/* ---- moving an item to another group ------------------------------------
   Both ways in, the row's Move menu and a cross-group drag, come through here
   so they cannot report differently or lose the way back. Undo needs the item
   that FOLLOWED the moved one, because that is what restores its old slot
   rather than merely its old group. */
function useMoveItem(month, dispatch, groups) {
  const { toast } = useStore();
  return async (itemId, toGroupId, targetId = null, opts = {}) => {
    const from = groups.find((g) => g.items.some((it) => it.id === itemId));
    const to = groups.find((g) => g.id === toGroupId);
    if (!from || !to || from.id === toGroupId) return;
    const idx = from.items.findIndex((it) => it.id === itemId);
    const name = from.items[idx].name;
    const backTo = from.id;
    const backBefore = idx + 1 < from.items.length ? from.items[idx + 1].id : null;
    const { ok } = await dispatch({ type: "moveItem", month, itemId, toGroupId, targetId });
    if (!ok) return; // the failure has already been reported as an error toast
    toast(`Moved "${name}" to ${to.name}.`, "success", {
      label: "Undo",
      onAct: () => dispatch({ type: "moveItem", month, itemId, toGroupId: backTo, targetId: backBefore }),
    });
    // Keyboard focus after a menu-driven move: the row holding focus unmounts
    // here and remounts under the destination card, so there is nothing to hand
    // focus back to until the refetch has landed the item and React has
    // committed it - hence the frame. Drag drops never ask for this, so a mouse
    // drag never yanks focus somewhere the pointer didn't put it.
    if (opts.restoreFocus) requestAnimationFrame(() => focusAllocated(itemId, toGroupId));
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
      <div className="eyebrow move-menu-label">Move to</div>
      {groups.map((g, i) => (
        <button key={g.id} type="button" className="move-menu-item" autoFocus={i === 0}
          onClick={() => { onPick(g.id); closeRestoringFocus(); }}>
          <span className="truncate">{g.name}</span>
          {/* Savings is not a success state, so the marker is quiet rather than
              green. Matches the neutral Savings badge on the group row. */}
          {g.isSavings && <Icons.plant size={13} className="move-menu-savings" />}
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
    /* .entry-tray, not a bare --board strip: the tray and the item row above
       it share one accent wash so an opened item reads as a single object
       two levels deep, rather than as a row with an unrelated black band
       stuck under it. */
    <div className="fade-in entry-tray">
      {item.actuals.length > 0 && (
        <div className="entry-list">
          {item.actuals.map(a => (
            <div key={a.id} className="entry-row">
              <div className="entry-fields">
                <DayField day={actualDay(a, month)} monthId={month} title="Day of month (when it was spent)"
                  onCommit={(d) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { date: makeActualDate(month, d) } })} />
                <TextInline value={a.name} placeholder="What was it?" col="entryName" label="What this spending entry was for" onCommit={(v) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { name: v } })} className="entry-name" />
                <TextInline value={a.note} placeholder="Note" col="entryNote" label="Note for this spending entry" allowEmpty onCommit={(v) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { note: v } })} className="entry-note" />
              </div>
              <MoneyInput value={a.amount} currency={currency} col="entryAmount" label="Amount spent" onCommit={(v) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { amount: v } })} />
              <div className="col-diff" />
              <div className="entry-action-cell">
                <button className="icon-btn subtle" aria-label={`Remove ${a.name ? `"${a.name}"` : "unnamed"} entry of ${fmt(currency, a.amount)} from ${item.name}`} title="Remove entry" onClick={() => remove(a)}><Icons.x size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="entry-add-row">
        <div className="entry-add-fields">
          <span className="entry-add-label">Add spend</span>
          <DayField day={day} monthId={month} title="Day of month for this entry" onCommit={setDay} onEnter={add} inputRef={dayRef} autoFocus />
          <input className="tinput entry-add-name" value={name} aria-label="What the spending was for" onChange={(e) => setName(e.target.value)} placeholder="What was it?" onKeyDown={(e) => e.key === "Enter" && add()} />
          <input className="tinput entry-add-note" value={note} aria-label="Note for this spending entry (optional)" onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" onKeyDown={(e) => e.key === "Enter" && add()} />
        </div>
        <div className="entry-amount-cell">
          <input ref={amtRef} className="minput entry-amount-input" aria-label="Amount spent" inputMode="text" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={`${currency}0.00`} onKeyDown={(e) => e.key === "Enter" && add()} />
          {amtPreview !== null && <FieldChip tight>= {fmt(currency, amtPreview)}</FieldChip>}
        </div>
        {/* Add sits in the actions column, under the entries' remove buttons:
            the Difference column is the one that disappears on narrow windows,
            and a button that vanishes with it is a button you cannot press. */}
        <div className="col-diff" />
        <div className="entry-action-cell">
          <button className="btn btn-sm btn-primary entry-add-btn" onClick={() => add()}><Icons.plus size={14} /> Add</button>
        </div>
      </div>
    </div>
  );
}

function ItemRow({ item, group, currency, dispatch, month, accounts, open, onToggle, onMove, index, count, groups, onMoveToGroup, drag, onDrop }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [grabbed, setGrabbed] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const isDragging = !!drag.item && drag.item.id === item.id;
  const isDropTarget = !!drag.overItem && drag.overItem.groupId === group.id
    && drag.overItem.targetId === item.id && !isDragging;
  // Stable identity, not a fresh arrow every render: MoveMenu's dismiss effect
  // depends on this, and an unstable onClose would tear its listeners down and
  // rebuild them on every keystroke elsewhere on the page.
  const closeMoveMenu = useCallback(() => setMoveOpen(false), []);
  const moveBtnRef = useRef(null);
  const otherGroups = (groups || []).filter((g) => g.id !== group.id);
  const actual = itemActual(item);
  const diff = round2(item.allocated - actual);
  const over = diff < -0.005;
  return (
    <div
      draggable={grabbed}
      onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; drag.startItem(group.id, item.id); }}
      onDragEnter={(e) => { e.preventDefault(); drag.overItemAt(group.id, item.id); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      /* Only claim the drop when an item is actually being dragged: otherwise
         this is a group drop landing on a row, and it must bubble up to the
         card's own onDrop, which performs the group reorder. */
      onDrop={(e) => {
        if (!drag.item) return;
        e.preventDefault();
        e.stopPropagation();
        onDrop();
      }}
      onDragEnd={() => { setGrabbed(false); drag.endItem(); }}
      className={cx("item-row", index === 0 && "is-first", isDragging && "is-dragging", isDropTarget && "is-drop-target")}>
      <div className="item-row-main">
      <DragHandle label={`Reorder ${item.name}, item ${index + 1} of ${count} in ${group.name}`}
        onGrab={() => setGrabbed(true)} onRelease={() => setGrabbed(false)} onMove={onMove} />
      <div className={cx("budget-row", "budget-row-item", open && "budget-row-open")}>
        <div className="item-name-cell">
          {/* The title is on the wrapper because the field itself is an input:
              it cannot ellipsis, so the full name has to be reachable some
              other way (hover here, or scroll inside the field). */}
          <span title={item.name} className="item-name-wrap">
            <TextInline value={item.name} col="itemName" label="Item name" className="item-name-input"
              onCommit={(v) => dispatch({ type: "renameItem", month, groupId: group.id, itemId: item.id, name: v })} />
          </span>
          <div className="item-acct-cell">
            <AccountSelect value={item.account} accounts={accounts} label={`Funding account for ${item.name}`} onChange={(a) => dispatch({ type: "setItemAccount", month, groupId: group.id, itemId: item.id, account: a })} />
          </div>
        </div>
        <div id={allocFieldId(item.id)}>
          <MoneyInput value={item.allocated} currency={currency} col="allocated" label={`Allocated for ${item.name}`}
            onCommit={(v) => dispatch({ type: "updateAllocated", month, groupId: group.id, itemId: item.id, value: v })} />
        </div>
        {/* Named explicitly: read from its contents it announces as
            "$120.00 3, button", which says nothing about which item it opens. */}
        <button onClick={onToggle} title="View / add spending entries" aria-expanded={open}
          aria-label={`${fmt(currency, actual)} spent on ${item.name} in ${item.actuals.length} ${item.actuals.length === 1 ? "entry" : "entries"}`}
          className={cx("item-spend-btn", open && "is-open")}>
          <span className="num item-spend-amt">{fmt(currency, actual)}</span>
          <span className="item-spend-count">{item.actuals.length}</span>
        </button>
        <div className="col-diff item-diff-cell">
          <DiffPill diff={diff} currency={currency} />
          <MiniBar actual={actual} allocated={item.allocated} />
        </div>
        {/* Stacked, not side by side: the actions column is 78px wide and drops
            to 68px on narrow windows. The two buttons are .compact (26px, no
            gap) rather than the app's usual 30px .icon-btn, because at 30px the
            stack (62px) out-measures the name+account column (57px) and grows
            every item row by 5px. */}
        <div className={cx("row-actions", "row-actions-stack", moveOpen && "is-open")}>
          <button className="icon-btn compact" aria-label={`Delete item ${item.name} from this month`} title="Delete item (this month only)" onClick={() => setConfirmDelete(true)}><Icons.trash size={15} /></button>
          {/* No aria-haspopup: its non-false values are all synonyms for menu,
              listbox, tree, grid or dialog (WAI-ARIA), and this disclosure
              reveals a labelled group of buttons, none of those. "true" is not
              the neutral option it looks like, it is the legacy synonym for
              "menu". The APG disclosure pattern is aria-expanded alone. */}
          <button ref={moveBtnRef} className="icon-btn compact" disabled={otherGroups.length === 0}
            aria-expanded={moveOpen}
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
  const { reusableItems } = useStore();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
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
  /* Closing on the click would unmount the typed name before the write is
     known to have landed, so the panel waits for the store's answer: the item
     is really in the group by the time this resolves, and a refusal hands the
     text back rather than losing it behind the error toast. */
  const submit = async (action) => {
    setSaving(true);
    const { ok } = await dispatch(action);
    setSaving(false);
    if (ok) { setQuery(""); onClose(); return; }
    if (inputRef.current) inputRef.current.focus();
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
    <div ref={rootRef} className={cx("add-item-panel", itemCount === 0 && "is-first")}>
      <div className="add-item-controls">
        <input autoFocus ref={inputRef} className="tinput add-item-input" value={query} aria-label="Search previous items, or type a new item name" onChange={(e) => setQuery(e.target.value)} placeholder="Search previous items or type new..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && !saving) createItem();
            if (e.key === "Escape") { setQuery(""); onClose(); }
          }} />
        <button className="btn btn-sm btn-primary" disabled={saving} onMouseDown={(e) => e.preventDefault()} onClick={createItem}>
          {saving ? "Adding…" : exact ? "Add existing" : "Create item"}
        </button>
      </div>
      <div className="add-item-results">
        {shown.length > 0 ? shown.map((candidate) => (
          <button key={`${candidate.month}:${candidate.name}`} type="button" disabled={saving}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => selectCandidate(candidate)}
            className="picker-option add-item-option">
            <span className="picker-option-text">
              <span className="picker-option-name truncate">{candidate.name}</span>
              <span className="add-item-sub truncate">{candidate.groupName} - {candidate.monthLabel}</span>
            </span>
            <span className="num add-item-amt">{fmt(currency, candidate.allocated, { cents: false })}</span>
          </button>
        )) : (
          <div className="add-item-empty">
            {trimmed ? "No previous item matches this search." : "Search items from previous months that are not in this month."}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupCard({ group, groups, currency, dispatch, month, accounts, drag }) {
  const alloc = groupAllocated(group), actual = groupActual(group);
  const diff = round2(alloc - actual);
  // Same half-penny tolerance the item rows use, so a group and the item
  // inside it can never disagree about whether they are over.
  const over = diff < -0.005;
  const [addingItem, setAddingItem] = useState(false);
  const [grabbed, setGrabbed] = useState(false);
  const [openItems, setOpenItems] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cardRef = useRef(null);
  const isDragging = drag.group === group.id;
  const moveItemToGroup = useMoveItem(month, dispatch, groups);
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
  /* A drop on a row is a reorder within this group, and from another group a
     move that lands exactly where the drop-line was drawn. */
  const dropOnItem = (targetId) => {
    const dragItem = drag.item;
    if (dragItem) {
      if (dragItem.groupId === group.id) {
        if (dragItem.id !== targetId) dispatch({ type: "reorderItem", month, groupId: group.id, itemId: dragItem.id, targetId });
      } else {
        moveItemToGroup(dragItem.id, group.id, targetId);
      }
    }
    drag.endItem();
  };
  /* A drop on the header or the footer appends. The header is what makes a
     COLLAPSED group droppable, since it is all such a group renders. */
  const dropOnGroup = () => {
    if (drag.item && drag.item.groupId !== group.id) moveItemToGroup(drag.item.id, group.id, null);
    drag.endItem();
  };
  const appendHere = !!(drag.item && drag.item.groupId !== group.id && drag.overItem
    && drag.overItem.groupId === group.id && drag.overItem.targetId === null);
  /* Attached to the header and footer specifically, never to the whole card: a
     card-level dragover fires on every mouse move over a row and would wipe out
     the targetId that row's own dragenter has just set. */
  const appendTargetProps = {
    onDragOver: (e) => {
      if (!drag.item) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      drag.overItemAt(group.id, null);
    },
    onDrop: (e) => {
      if (!drag.item) return;
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
  const groupIndex = groups.findIndex(g => g.id === group.id);
  const moveGroup = (dir) => {
    const target = groupIndex < 0 ? null : groups[groupIndex + dir];
    if (!target) { announce(`${group.name} is already the ${dir < 0 ? "first" : "last"} group.`); return; }
    dispatch({ type: "reorderGroup", month, groupId: group.id, targetId: target.id, after: dir > 0 });
    announce(`${group.name} moved to position ${groupIndex + dir + 1} of ${groups.length}.`);
  };
  return (
    <div ref={cardRef} id={groupCardId(group.id)} className={cx("panel is-raised fade-in group-card", isDragging && "is-dragging")} draggable={grabbed}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; drag.startGroup(group.id); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = e.currentTarget.getBoundingClientRect(); drag.overGroupAt(group.id, e.clientY > r.top + r.height / 2); }}
      onDrop={(e) => { e.preventDefault(); drag.dropGroup(group.id); }}
      onDragEnd={() => { setGrabbed(false); drag.endGroup(); }}>
      <div className="group-head-row">
      {/* 'is-collapsed' is what tells the stylesheet this handle is the card's
          bottom-left corner as well as its top-left one: a collapsed group
          renders nothing below its header. */}
      <DragHandle label={`Reorder group ${group.name}, ${groupIndex + 1} of ${groups.length}`}
        className={cx("drag-handle-group group-head-handle", over && "is-over", group.collapsed && "is-collapsed")}
        onGrab={() => setGrabbed(true)} onRelease={() => setGrabbed(false)} onMove={moveGroup} />
      {/* .group-head is the page's one washed band: it makes a group header
          read as a header rather than as the darkest, and so apparently
          deepest, strip in its own card. A drop target still overrides it -
          that is a live drag affordance and has to win over a resting
          surface. */}
      <div {...appendTargetProps} className={cx("budget-row group-head", over && "is-over", group.collapsed && "is-collapsed", appendHere && "is-append-target")}>
        <div className="group-name-cell">
          <button className={cx("icon-btn group-toggle", group.collapsed && "is-collapsed")} aria-expanded={!group.collapsed} aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`} onClick={() => dispatch({ type: "toggleCollapse", month, groupId: group.id })}><Icons.down size={16} /></button>
          <span title={group.name} className="group-name-wrap">
            <TextInline value={group.name} col="groupName" label="Group name" onCommit={(v) => dispatch({ type: "renameGroup", month, groupId: group.id, name: v })} className="group-name-input" />
          </span>
          {group.isSavings && <span className="pill pill-neutral group-savings-pill"><Icons.plant size={12} /> Savings</span>}
        </div>
        <div className="num group-alloc">{fmt(currency, alloc, { cents: false })}</div>
        <div className={cx("num group-actual", over && "is-over")}>{fmt(currency, actual, { cents: false })}</div>
        <div className="col-diff group-diff-cell"><DiffPill diff={diff} currency={currency} /></div>
        <div className="row-actions row-actions-end">
          <button className="icon-btn" aria-label={group.isSavings ? `Unmark ${group.name} as a savings group` : `Mark ${group.name} as a savings group`} title={group.isSavings ? "Unmark as savings" : "Mark as savings group"} onClick={() => dispatch({ type: "setSavings", month, groupId: group.id, value: !group.isSavings })}><Icons.plant size={15} /></button>
          <button className="icon-btn" aria-label={`Delete group ${group.name} from this month`} title="Delete group (this month only)" onClick={() => setConfirmDelete(true)}><Icons.trash size={15} /></button>
        </div>
      </div>
      </div>
      {!group.collapsed && (
        <div>
          {group.items.length === 0 && !addingItem && (
            <div {...appendTargetProps} className={cx("group-empty", appendHere && "is-append-target")}>No items yet.</div>
          )}
          {group.items.map((it, itemIndex) => (
            <ItemRow key={it.id} item={it} group={group} currency={currency} dispatch={dispatch} month={month} accounts={accounts}
              open={openItems.has(it.id)}
              onToggle={() => toggleItem(it.id)}
              index={itemIndex}
              count={group.items.length}
              onMove={(dir) => moveItem(it.id, dir)}
              groups={groups}
              onMoveToGroup={(toGroupId) => moveItemToGroup(it.id, toGroupId, null, { restoreFocus: true })}
              drag={drag}
              onDrop={() => dropOnItem(it.id)} />
          ))}
          {addingItem ? (
            <AddItemSearch month={month} groupId={group.id} currency={currency} dispatch={dispatch} itemCount={itemCount} onClose={() => setAddingItem(false)} />
          ) : (
            <div {...appendTargetProps} className={cx("group-foot", appendHere && "is-append-target")}>
              <button className="btn btn-ghost btn-sm group-add-btn" onClick={() => setAddingItem(true)}><Icons.plus size={14} /> Add item</button>
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
           make and it has to be answerable from the keyboard. The card is not
           a <label> - the "also copy income" checkbox nests inside it, and a
           label inside a label belongs to nothing in particular. */
        <div role="radiogroup" aria-label="What to put in the new month" className="copy-opts">
          <div className={cx("copy-opt", copy && "is-on")} onClick={() => setCopy(true)}>
            {/* Focusable but not seen: the drawn radio beside it is the visible
                one. .sr-only rather than display:none or visibility:hidden,
                which would take it out of the tab order and out of Modal's
                focus trap. Same for the second card below. */}
            <input type="radio" id="new-month-copy" name="new-month-source" checked={copy} className="sr-only"
              onChange={() => setCopy(true)} />
            <div aria-hidden="true" className={cx("copy-radio", copy && "is-on")}>{copy && <Icons.check size={13} />}</div>
            <div>
              <label htmlFor="new-month-copy" className="copy-opt-title">Copy structure from {prevLbl.short}</label>
              <div className="copy-opt-sub">{prevGroups} groups · {prevItems} items · allocated amounts. Spending starts fresh at zero.</div>
              {copy && (
                <label className="copy-opt-extra">
                  <input type="checkbox" checked={copyIncome} onChange={(e) => setCopyIncome(e.target.checked)} /> Also copy income amounts
                </label>
              )}
            </div>
          </div>
          <div className={cx("copy-opt", !copy && "is-on")} onClick={() => setCopy(false)}>
            <input type="radio" id="new-month-empty" name="new-month-source" checked={!copy} className="sr-only"
              onChange={() => setCopy(false)} />
            <div aria-hidden="true" className={cx("copy-radio", !copy && "is-on")}>{!copy && <Icons.check size={13} />}</div>
            <div>
              <label htmlFor="new-month-empty" className="copy-opt-title">Start empty</label>
              <div className="copy-opt-sub">A blank month - add groups and items from scratch.</div>
            </div>
          </div>
        </div>
      )}
      <div className="new-month-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={create}><Icons.plus size={15} /> Create {lbl.mo}</button>
      </div>
      <div className="new-month-note">
        <Icons.check size={13} /> The new month is fully independent - edits here never change past months.
      </div>
    </Modal>
  );
}

export { GroupCard, NewMonthModal, useBudgetDrag, allocFieldId, focusAllocated };
