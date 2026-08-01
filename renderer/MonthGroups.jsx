/* ============================================================
   Groups & Items - collapsible groups, inline edit, quick-add,
   reorder, delete-this-month-only, and the New Month flow.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog, DiffPill, Icons, MiniBar, Modal, MoneyInput, TextInline, evalMoney, isExpr } from './components.jsx';
import { actualDay, daysInMonth, fmt, groupActual, groupAllocated, itemActual, makeActualDate, monthLabel, nextMonthId, normalizeItemName, round2 } from './lib/index.js';
import { useStore } from './store.jsx';
import { AccountSelect } from './Accounts.jsx';

/* Small day-of-month editor (1..last day of the month). 'onEnter' makes Enter
   submit rather than just blur, and receives the clamped day directly: the
   commit that goes with it only lands in state after this keystroke. */
function DayField({ day, monthId, onCommit, onEnter, inputRef, autoFocus = false, title = "Day of month" }) {
  const [txt, setTxt] = useState(String(day));
  useEffect(() => { setTxt(String(day)); }, [day]);
  const clampTo = (n) => Math.max(1, Math.min(daysInMonth(monthId), n));
  const parsed = () => {
    const n = parseInt(txt, 10);
    return Number.isInteger(n) ? n : day;
  };
  const clamp = () => {
    const n = clampTo(parsed());
    setTxt(String(n));
    return n;
  };
  // Arrows nudge the shown value only; like typing, it commits on blur/Enter -
  // so holding an arrow on an existing entry is not one database write per step.
  const step = (delta) => setTxt(String(clampTo(parsed() + delta)));
  return (
    <input ref={inputRef} autoFocus={autoFocus} className="minput mono" value={txt} inputMode="numeric" title={title} aria-label={title}
      onChange={(e) => setTxt(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
      onFocus={(e) => e.target.select()}
      onBlur={() => onCommit(clamp())}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const n = clamp();
          onCommit(n);
          if (onEnter) onEnter(n); else e.target.blur();
        }
        if (e.key === "Escape") { setTxt(String(day)); e.target.blur(); }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault(); // otherwise the caret jumps to one end of the field
          step(e.key === "ArrowUp" ? 1 : -1);
        }
      }}
      style={{ width: 44, height: 26, textAlign: "center", fontSize: 12, padding: "0 4px", flex: "none", color: "var(--ink-2)" }} />
  );
}

/* The day a new entry starts on: the one most recently added to this item (so a
   run of receipts from the same day needs no re-typing), or the 1st when the
   item has no entries yet. Entries read back in date order, so "most recent"
   is the highest id, not the last row. */
function nextEntryDay(item, month) {
  if (!item.actuals.length) return 1;
  return actualDay(item.actuals.reduce((a, b) => (b.id > a.id ? b : a)), month);
}

function EntriesDrawer({ item, group, currency, dispatch, month }) {
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
  const amtPreview = isExpr(amt) ? evalMoney(amt) : null;
  return (
    <div className="fade-in" style={{ padding: "16px", background: "var(--surface-2)", borderTop: "1px solid var(--hairline)" }}>
      {item.actuals.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {item.actuals.map(a => (
            <div key={a.id} style={{ display: "grid", gridTemplateColumns: "1fr 150px 158px 150px 78px", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--hairline)" }}>
              <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: 10, paddingLeft: 30, minWidth: 0 }}>
                <DayField day={actualDay(a, month)} monthId={month} title="Day of month (when it was spent)"
                  onCommit={(d) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { date: makeActualDate(month, d) } })} />
                <TextInline value={a.name} placeholder="What was it?" col="entryName" label="What this spending entry was for" onCommit={(v) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { name: v } })} style={{ flex: "1 1 0", minWidth: 0, fontSize: 13 }} />
                <TextInline value={a.note} placeholder="Note" col="entryNote" label="Note for this spending entry" allowEmpty onCommit={(v) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { note: v } })} style={{ flex: "1 1 0", minWidth: 0, fontSize: 13, color: "var(--ink-2)" }} />
              </div>
              <MoneyInput value={a.amount} currency={currency} col="entryAmount" label="Amount spent" onCommit={(v) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { amount: v } })} />
              <div />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="icon-btn subtle" title="Remove entry" onClick={() => dispatch({ type: "removeActual", month, groupId: group.id, itemId: item.id, id: a.id })}><Icons.x size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 150px 158px 150px 78px", alignItems: "center", gap: 10, height: 32 }}>
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
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-sm btn-primary" style={{ height: 32 }} onClick={() => add()}><Icons.plus size={14} /> Add</button>
        </div>
        <div />
      </div>
    </div>
  );
}

function ItemRow({ item, group, currency, dispatch, month, accounts, open, onToggle, onDragStart, onDragOverItem, onDrop, onDragEnd, isDragging, isDropTarget }) {
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
      style={{ borderTop: isDropTarget ? "2px solid var(--accent)" : "1px solid var(--border)", opacity: isDragging ? .4 : 1, background: isDropTarget ? "var(--accent-soft)" : undefined, transition: "background .12s" }}>
      <div style={{ display: "flex", alignItems: "stretch", minHeight: "var(--row-h)" }}>
      <div className="drag-handle" title="Drag to reorder" onMouseDown={() => setGrabbed(true)} onMouseUp={() => setGrabbed(false)}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, flex: "none", cursor: "grab", color: "var(--faint)"}}><Icons.drag size={25} /></div>
      <div className="budget-row" style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "1fr 150px 158px 150px 78px", alignItems: "center", gap: 10, padding: "7px 8px", minHeight: "var(--row-h)" }}>
        <div style={{ minWidth: 0, paddingRight: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          <TextInline value={item.name} col="itemName" label="Item name"
            onCommit={(v) => dispatch({ type: "renameItem", month, groupId: group.id, itemId: item.id, name: v })} />
          <div style={{ paddingLeft: 8 }}>
            <AccountSelect value={item.account} accounts={accounts} onChange={(a) => dispatch({ type: "setItemAccount", month, groupId: group.id, itemId: item.id, account: a })} />
          </div>
        </div>
        <MoneyInput value={item.allocated} currency={currency} col="allocated" label={`Allocated for ${item.name}`}
          onCommit={(v) => dispatch({ type: "updateAllocated", month, groupId: group.id, itemId: item.id, value: v })} />
        <button onClick={onToggle} title="View / add spending entries"
          style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, background: open ? "var(--surface-sunken)" : "transparent", border: "1px solid transparent", borderRadius: 7, padding: "5px 9px", color: "var(--ink)", transition: ".12s" }}>
          <span className="mono" style={{ fontSize: 14 }}>{fmt(currency, actual)}</span>
          <span style={{ fontSize: 10.5, color: "var(--faint)", background: "var(--surface-sunken)", borderRadius: 5, padding: "1px 5px", minWidth: 16, textAlign: "center" }}>{item.actuals.length}</span>
        </button>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
          <DiffPill diff={diff} currency={currency} />
          <MiniBar actual={actual} allocated={item.allocated} />
        </div>
        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
          <button className="icon-btn" title="Delete item (this month only)" onClick={() => setConfirmDelete(true)}><Icons.trash size={15} /></button>
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

function AddItemSearch({ month, groupId, currency, dispatch, onClose }) {
  const { reusableItems } = useStore();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const rootRef = useRef(null);
  // Candidates come from SQL (items in other months not present in this one).
  useEffect(() => {
    let live = true;
    reusableItems(query).then((c) => { if (live) setCandidates(c); });
    return () => { live = false; };
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
  const selectCandidate = (candidate) => {
    dispatch({ type: "addItem", month, groupId, name: candidate.name, allocated: candidate.allocated, account: candidate.account });
    setQuery("");
    onClose();
  };
  const createItem = () => {
    if (!trimmed) { onClose(); return; }
    if (exact) { selectCandidate(exact); return; }
    dispatch({ type: "addItem", month, groupId, name: trimmed });
    setQuery("");
    onClose();
  };
  const shown = candidates.slice(0, 7);
  return (
    <div ref={rootRef} style={{ padding: "10px 16px", borderTop: "1px solid var(--hairline)", background: "var(--surface-2)" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input autoFocus className="tinput" value={query} aria-label="Search previous items, or type a new item name" onChange={(e) => setQuery(e.target.value)} placeholder="Search previous items or type new..." style={{ maxWidth: 340 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") createItem();
            if (e.key === "Escape") { setQuery(""); onClose(); }
          }} />
        <button className="btn btn-sm btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={createItem}>
          {exact ? "Add existing" : "Create item"}
        </button>
      </div>
      <div style={{ marginTop: 8, border: "1px solid var(--hairline)", borderRadius: 8, overflow: "hidden", background: "var(--surface)" }}>
        {shown.length > 0 ? shown.map((candidate, idx) => (
          <button key={`${candidate.month}:${candidate.name}`} type="button"
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
  return (
    <div ref={cardRef} className="card fade-in" draggable={grabbed}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = e.currentTarget.getBoundingClientRect(); onDragOverGroup(e.clientY > r.top + r.height / 2); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={() => { setGrabbed(false); onDragEnd(); }}
      style={{ marginBottom: 14, overflow: "hidden", opacity: isDragging ? .4 : 1, transition: "opacity .12s" }}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
      <div className="drag-handle" title="Drag to reorder group" onMouseDown={() => setGrabbed(true)} onMouseUp={() => setGrabbed(false)}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, flex: "none", cursor: "grab", color: "var(--faint)", background: "var(--surface-2)", borderBottom: group.collapsed ? "none" : "1px solid var(--border-strong)" }}><Icons.drag size={25} /></div>
      <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: "1fr 150px 158px 150px 78px", alignItems: "center", gap: 10, padding: "16px 8px", background: "var(--surface-2)", borderBottom: group.collapsed ? "none" : "1px solid var(--border-strong)" }} className="budget-row">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button className="icon-btn" aria-expanded={!group.collapsed} aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`} onClick={() => dispatch({ type: "toggleCollapse", month, groupId: group.id })} style={{ transform: group.collapsed ? "rotate(-90deg)" : "none", transition: "transform .18s" }}><Icons.down size={16} /></button>
          <TextInline value={group.name} col="groupName" label="Group name" onCommit={(v) => dispatch({ type: "renameGroup", month, groupId: group.id, name: v })} style={{ fontWeight: 600, fontSize: 15 }} />
          {group.isSavings && <span className="pill pill-pos"><Icons.plant size={12} /> Savings</span>}
        </div>
        <div className="mono" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600, paddingRight: 8 }}>{fmt(currency, alloc, { cents: false })}</div>
        <div className="mono" style={{ textAlign: "right", fontSize: 13.5, color: "var(--ink-2)", paddingRight: 9 }}>{fmt(currency, actual, { cents: false })}</div>
        <div style={{ textAlign: "right" }}><DiffPill diff={diff} currency={currency} /></div>
        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
          <button className="icon-btn" title={group.isSavings ? "Unmark as savings" : "Mark as savings group"} onClick={() => dispatch({ type: "setSavings", month, groupId: group.id, value: !group.isSavings })} style={{ color: group.isSavings ? "var(--pos)" : undefined }}><Icons.plant size={15} /></button>
          <button className="icon-btn" title="Delete group (this month only)" onClick={() => setConfirmDelete(true)}><Icons.trash size={15} /></button>
        </div>
      </div>
      </div>
      {!group.collapsed && (
        <div>
          {group.items.length === 0 && !addingItem && (
            <div style={{ padding: "16px", textAlign: "center", color: "var(--faint)", fontSize: 13, borderTop: "1px solid var(--hairline)" }}>No items yet.</div>
          )}
          {group.items.map((it) => (
            <ItemRow key={it.id} item={it} group={group} currency={currency} dispatch={dispatch} month={month} accounts={accounts}
              open={openItems.has(it.id)}
              onToggle={() => toggleItem(it.id)}
              isDragging={dragId === it.id}
              isDropTarget={overId === it.id && dragId !== it.id}
              onDragStart={() => setDragId(it.id)}
              onDragOverItem={() => { if (dragId) setOverId(it.id); }}
              onDrop={() => dropItem(it.id)}
              onDragEnd={endDrag} />
          ))}
          {addingItem ? (
            <AddItemSearch month={month} groupId={group.id} currency={currency} dispatch={dispatch} onClose={() => setAddingItem(false)} />
          ) : (
            <div style={{ background: "var(--surface-2)", borderTop: "1px solid var(--hairline)", padding: "4px 0" }}>
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
  useEffect(() => { let live = true; if (lastId) getMonth(lastId).then((m) => { if (live) setPrev(m); }); return () => { live = false; }; }, [lastId, getMonth]);
  const prevGroups = prev ? prev.groups.length : 0;
  const prevItems = prev ? prev.groups.reduce((a, g) => a + g.items.length, 0) : 0;
  const create = () => { dispatch({ type: "createMonth", id: targetId, copyFrom: copy ? lastId : null, copyIncome: copy && copyIncome }); onClose(); };
  return (
    <Modal onClose={onClose} width={500}>
      <h3>Start {lbl.mo} {lbl.yr}</h3>
      <p>Create the next month's budget{hasPrev ? ` by carrying over your structure from ${prevLbl.short}.` : "."}</p>
      {hasPrev && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          <label className="copy-opt" style={optStyle(copy)} onClick={() => setCopy(true)}>
            <div style={radioStyle(copy)}>{copy && <Icons.check size={13} />}</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Copy structure from {prevLbl.short}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{prevGroups} groups · {prevItems} items · allocated amounts. Spending starts fresh at zero.</div>
              {copy && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, color: "var(--ink-2)" }} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={copyIncome} onChange={(e) => setCopyIncome(e.target.checked)} /> Also copy income amounts
                </label>
              )}
            </div>
          </label>
          <label className="copy-opt" style={optStyle(!copy)} onClick={() => setCopy(false)}>
            <div style={radioStyle(!copy)}>{!copy && <Icons.check size={13} />}</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Start empty</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>A blank month - add groups and items from scratch.</div>
            </div>
          </label>
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
function optStyle(active) { return { display: "flex", gap: 12, padding: "13px 14px", borderRadius: 11, border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, background: active ? "var(--accent-soft)" : "var(--surface)", cursor: "pointer", transition: ".14s" }; }
function radioStyle(active) { return { width: 20, height: 20, borderRadius: 99, flex: "none", marginTop: 1, display: "grid", placeItems: "center", color: "#fff", background: active ? "var(--accent)" : "transparent", border: `1.5px solid ${active ? "var(--accent)" : "var(--border-strong)"}` }; }

export { GroupCard, NewMonthModal };
