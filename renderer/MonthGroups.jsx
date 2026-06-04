/* ============================================================
   Groups & Items — collapsible groups, inline edit, quick-add,
   reorder, delete-this-month-only, and the New Month flow.
   ============================================================ */

function EntriesDrawer({ item, group, currency, dispatch, month }) {
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  const addRef = useRef(null);
  const add = () => {
    const n = evalMoney(amt);
    if (n === null || n <= 0) { addRef.current && addRef.current.focus(); return; }
    dispatch({ type: "addActual", month, groupId: group.id, itemId: item.id, amount: n, note: note.trim() });
    setAmt(""); setNote(""); requestAnimationFrame(() => addRef.current && addRef.current.focus());
  };
  const amtPreview = isExpr(amt) ? evalMoney(amt) : null;
  return (
    <div className="fade-in" style={{ padding: "4px 18px 14px 46px", background: "var(--surface-2)", borderTop: "1px solid var(--hairline)" }}>
      {item.actuals.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {item.actuals.map(a => (
            <div key={a.id} style={{ display: "grid", gridTemplateColumns: "54px 1fr 110px 30px", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--hairline)" }}>
              <span className="mono" style={{ fontSize: 12, color: "var(--faint)" }}>{a.date}</span>
              <TextInline value={a.note} placeholder="Note" onCommit={(v) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { note: v } })} style={{ fontSize: 13, color: "var(--ink-2)" }} />
              <MoneyInput value={a.amount} currency={currency} onCommit={(v) => dispatch({ type: "updateActual", month, groupId: group.id, itemId: item.id, id: a.id, patch: { amount: v } })} />
              <button className="icon-btn subtle" title="Remove entry" onClick={() => dispatch({ type: "removeActual", month, groupId: group.id, itemId: item.id, id: a.id })}><Icons.x size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500, marginRight: 2 }}>Add spend</span>
        <input ref={addRef} className="tinput" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was it?" style={{ maxWidth: 200, fontSize: 13 }} onKeyDown={(e) => e.key === "Enter" && add()} />
        <div style={{ width: 130, position: "relative" }}>
          <input className="minput" style={{ paddingLeft: 8 }} inputMode="text" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={`${currency}0.00`} onKeyDown={(e) => e.key === "Enter" && add()} />
          {amtPreview !== null && (
            <span className="mono" style={{ position: "absolute", right: 4, bottom: "100%", marginBottom: 3, background: "var(--ink)", color: "var(--surface)", fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 4 }}>= {fmt(currency, amtPreview)}</span>
          )}
        </div>
        <button className="btn btn-sm btn-primary" onClick={add}><Icons.plus size={14} /> Add</button>
      </div>
    </div>
  );
}

function ItemRow({ item, group, currency, dispatch, month, accounts, isFirst, isLast }) {
  const [open, setOpen] = useState(false);
  const actual = itemActual(item);
  const diff = round2(item.allocated - actual);
  const over = diff < -0.005;
  return (
    <div style={{ borderTop: "1px solid var(--hairline)" }}>
      <div className="budget-row" style={{ display: "grid", gridTemplateColumns: "1fr 150px 158px 150px 78px", alignItems: "center", gap: 10, padding: "7px 16px", minHeight: "var(--row-h)" }}>
        <div style={{ minWidth: 0, paddingRight: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          <TextInline value={item.name} onCommit={(v) => dispatch({ type: "renameItem", month, groupId: group.id, itemId: item.id, name: v })} />
          <div style={{ paddingLeft: 8 }}>
            <AccountSelect value={item.account} accounts={accounts} onChange={(a) => dispatch({ type: "setItemAccount", month, groupId: group.id, itemId: item.id, account: a })} />
          </div>
        </div>
        <MoneyInput value={item.allocated} currency={currency} onCommit={(v) => dispatch({ type: "updateAllocated", month, groupId: group.id, itemId: item.id, value: v })} />
        <button onClick={() => setOpen(o => !o)} title="View / add spending entries"
          style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, background: open ? "var(--surface-sunken)" : "transparent", border: "1px solid transparent", borderRadius: 7, padding: "5px 9px", color: "var(--ink)", transition: ".12s" }}>
          <span className="mono" style={{ fontSize: 14 }}>{fmt(currency, actual)}</span>
          <span style={{ fontSize: 10.5, color: "var(--faint)", background: "var(--surface-sunken)", borderRadius: 5, padding: "1px 5px", minWidth: 16, textAlign: "center" }}>{item.actuals.length}</span>
        </button>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
          <DiffPill diff={diff} currency={currency} />
          <MiniBar actual={actual} allocated={item.allocated} />
        </div>
        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
          <button className="icon-btn" title="Move up" disabled={isFirst} style={{ opacity: isFirst ? .25 : 1 }} onClick={() => dispatch({ type: "moveItem", month, groupId: group.id, itemId: item.id, dir: -1 })}><Icons.up size={15} /></button>
          <button className="icon-btn" title="Move down" disabled={isLast} style={{ opacity: isLast ? .25 : 1 }} onClick={() => dispatch({ type: "moveItem", month, groupId: group.id, itemId: item.id, dir: 1 })}><Icons.down size={15} /></button>
          <button className="icon-btn" title="Delete item (this month only)" onClick={() => dispatch({ type: "deleteItem", month, groupId: group.id, itemId: item.id })}><Icons.trash size={15} /></button>
        </div>
      </div>
      {open && <EntriesDrawer item={item} group={group} currency={currency} dispatch={dispatch} month={month} />}
    </div>
  );
}

function GroupCard({ group, currency, dispatch, month, accounts, isFirst, isLast }) {
  const alloc = groupAllocated(group), actual = groupActual(group);
  const diff = round2(alloc - actual);
  const [addingItem, setAddingItem] = useState(false);
  const [newItem, setNewItem] = useState("");
  const commitItem = () => { if (newItem.trim()) { dispatch({ type: "addItem", month, groupId: group.id, name: newItem.trim() }); setNewItem(""); } setAddingItem(false); };
  return (
    <div className="card fade-in" style={{ marginBottom: 14, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 150px 158px 150px 78px", alignItems: "center", gap: 10, padding: "12px 16px", background: "var(--surface-2)" }} className="budget-row">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button className="icon-btn" onClick={() => dispatch({ type: "toggleCollapse", month, groupId: group.id })} style={{ transform: group.collapsed ? "rotate(-90deg)" : "none", transition: "transform .18s" }}><Icons.down size={16} /></button>
          <TextInline value={group.name} onCommit={(v) => dispatch({ type: "renameGroup", month, groupId: group.id, name: v })} style={{ fontWeight: 600, fontSize: 15 }} />
          {group.isSavings && <span className="pill pill-pos" style={{ background: "var(--accent-soft)" }}><Icons.plant size={12} /> Savings</span>}
        </div>
        <div className="mono" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600, paddingRight: 8 }}>{fmt(currency, alloc, { cents: false })}</div>
        <div className="mono" style={{ textAlign: "right", fontSize: 13.5, color: "var(--ink-2)", paddingRight: 9 }}>{fmt(currency, actual, { cents: false })}</div>
        <div style={{ textAlign: "right" }}><DiffPill diff={diff} currency={currency} /></div>
        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
          <button className="icon-btn" title="Move group up" disabled={isFirst} style={{ opacity: isFirst ? .25 : 1 }} onClick={() => dispatch({ type: "moveGroup", month, groupId: group.id, dir: -1 })}><Icons.up size={15} /></button>
          <button className="icon-btn" title="Move group down" disabled={isLast} style={{ opacity: isLast ? .25 : 1 }} onClick={() => dispatch({ type: "moveGroup", month, groupId: group.id, dir: 1 })}><Icons.down size={15} /></button>
          <button className="icon-btn" title={group.isSavings ? "Unmark as savings" : "Mark as savings group"} onClick={() => dispatch({ type: "setSavings", month, groupId: group.id, value: !group.isSavings })} style={{ color: group.isSavings ? "var(--accent)" : undefined }}><Icons.plant size={15} /></button>
          <button className="icon-btn" title="Delete group (this month only)" onClick={() => dispatch({ type: "deleteGroup", month, groupId: group.id })}><Icons.trash size={15} /></button>
        </div>
      </div>
      {!group.collapsed && (
        <div>
          {group.items.length === 0 && !addingItem && (
            <div style={{ padding: "16px", textAlign: "center", color: "var(--faint)", fontSize: 13, borderTop: "1px solid var(--hairline)" }}>No items yet.</div>
          )}
          {group.items.map((it, i) => (
            <ItemRow key={it.id} item={it} group={group} currency={currency} dispatch={dispatch} month={month} accounts={accounts} isFirst={i === 0} isLast={i === group.items.length - 1} />
          ))}
          {addingItem ? (
            <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--hairline)" }}>
              <input autoFocus className="tinput" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Item name…" style={{ maxWidth: 280 }}
                onKeyDown={(e) => { if (e.key === "Enter") commitItem(); if (e.key === "Escape") { setAddingItem(false); setNewItem(""); } }} onBlur={commitItem} />
              <button className="btn btn-sm btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={commitItem}>Add item</button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" style={{ margin: "8px 10px", color: "var(--muted)" }} onClick={() => setAddingItem(true)}><Icons.plus size={14} /> Add item</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- new month modal ---------------------------------------------------- */
function NewMonthModal({ state, onClose, dispatch }) {
  const lastId = state.order[state.order.length - 1];
  const targetId = nextMonthId(lastId);
  const lbl = monthLabel(targetId);
  const prevLbl = monthLabel(lastId);
  const hasPrev = !!state.months[lastId];
  const [copy, setCopy] = useState(true);
  const [copyIncome, setCopyIncome] = useState(true);
  const prevGroups = hasPrev ? state.months[lastId].groups.length : 0;
  const prevItems = hasPrev ? state.months[lastId].groups.reduce((a, g) => a + g.items.length, 0) : 0;
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
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>A blank month — add groups and items from scratch.</div>
            </div>
          </label>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={create}><Icons.plus size={15} /> Create {lbl.mo}</button>
      </div>
      <div style={{ marginTop: 14, fontSize: 11.5, color: "var(--faint)", display: "flex", alignItems: "center", gap: 6 }}>
        <Icons.check size={13} /> The new month is fully independent — edits here never change past months.
      </div>
    </Modal>
  );
}
function optStyle(active) { return { display: "flex", gap: 12, padding: "13px 14px", borderRadius: 11, border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, background: active ? "var(--accent-soft)" : "var(--surface)", cursor: "pointer", transition: ".14s" }; }
function radioStyle(active) { return { width: 20, height: 20, borderRadius: 99, flex: "none", marginTop: 1, display: "grid", placeItems: "center", color: "#fff", background: active ? "var(--accent)" : "transparent", border: `1.5px solid ${active ? "var(--accent)" : "var(--border-strong)"}` }; }

Object.assign(window, { GroupCard, NewMonthModal });
