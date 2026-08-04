/* ============================================================
   Quick entry - one central place to log spending for the whole month.

   Type what the bank statement says: names logged before are offered back, and
   a chosen one already knows which budget item it belongs to, so a statement
   can be worked top to bottom without opening each item's drawer in turn. A
   name with no history needs its item picked once, and is suggested from then
   on. Everything written here lands in the normal item drawers below.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DayField, Icons, evalMoney, isExpr } from './components.jsx';
import { actualDay, fmt } from './lib/index.js';
import { useStore } from './store.jsx';

/* Every item in the month, flattened with its group, in screen order. */
function flatItems(mo) {
  const out = [];
  mo.groups.forEach((g) =>
    g.items.forEach((it) => out.push({ id: it.id, name: it.name, groupId: g.id, groupName: g.name }))
  );
  return out;
}

/* The month's entries, newest first. Entries read back in date order, so
   "newest" is the highest id, not the last row. */
function recentEntries(mo, limit) {
  const out = [];
  mo.groups.forEach((g) => g.items.forEach((it) => it.actuals.forEach((a) => out.push({ a, it, g }))));
  out.sort((x, y) => y.a.id - x.a.id);
  return limit ? out.slice(0, limit) : out;
}

/* One suggestion row. Unresolved ones (their item is not in this month) say so
   rather than looking identical to the ones that file themselves. */
function SuggestionRow({ s, active, currency, onPick, id }) {
  return (
    <button type="button" id={id} role="option" aria-selected={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(s)}
      style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", textAlign: "left", padding: "7px 10px", border: 0, background: active ? "var(--surface-sunken)" : "transparent", color: "var(--ink)", cursor: "pointer", font: "inherit" }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, marginTop: 2, color: s.itemId == null ? "var(--neg-ink)" : "var(--muted)", overflow: "hidden", whiteSpace: "nowrap" }}>
          {s.itemId == null ? <Icons.alert size={12} /> : <Icons.right size={12} />}
          {s.itemId == null ? `"${s.itemName}" is not in this month - pick an item` : `${s.groupName} · ${s.itemName}`}
        </span>
      </span>
      <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <span className="mono" style={{ display: "block", fontSize: 12.5, color: "var(--ink-2)" }}>{fmt(currency, s.amount)}</span>
        <span style={{ display: "block", fontSize: 11, color: "var(--faint)", marginTop: 2 }}>
          {s.monthLabel}{s.uses > 1 ? ` · ${s.uses}×` : ""}
        </span>
      </span>
    </button>
  );
}

function QuickEntrySection({ mo, month, currency, dispatch }) {
  const { entrySuggestions } = useStore();
  const items = useMemo(() => flatItems(mo), [mo]);
  const recent = useMemo(() => recentEntries(mo, 3), [mo]);
  const entryCount = useMemo(() => recentEntries(mo).length, [mo]);

  // Start on the day of the entry added most recently, so a run of receipts
  // from the same date needs no re-typing.
  const startDay = recent.length ? actualDay(recent[0].a, month) : 1;
  const [day, setDay] = useState(startDay);
  useEffect(() => { setDay(startDay); }, [startDay]);

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [amt, setAmt] = useState("");
  const [itemId, setItemId] = useState(null);
  const [picked, setPicked] = useState(null); // the suggestion that set itemId
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // highlighted suggestion, -1 = still typing

  const rootRef = useRef(null);
  const dayRef = useRef(null);
  const nameRef = useRef(null);
  const itemRef = useRef(null);
  const amtRef = useRef(null);
  const listId = useRef(`qe-list-${Math.random().toString(36).slice(2, 8)}`).current;

  // Candidates come from SQL (every named entry ever, resolved against this
  // month's items). An empty query returns the most recent ones. 'month' is a
  // dependency because a suggestion carries an item id that only means anything
  // in the month it was resolved against.
  useEffect(() => {
    let live = true;
    entrySuggestions(name).then((list) => { if (live) { setSuggestions(list); setHi(-1); } });
    return () => { live = false; };
  }, [entrySuggestions, name, month, entryCount]);

  // A half-typed entry belongs to the month it was started in.
  useEffect(() => {
    setName(""); setNote(""); setAmt(""); setItemId(null); setPicked(null); setOpen(false); setHi(-1);
  }, [month]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const shown = suggestions.slice(0, 7);
  const trimmedName = name.trim();
  const target = items.find((i) => i.id === itemId) || null;
  const amtPreview = isExpr(amt) ? evalMoney(amt) : null;
  const amtValue = evalMoney(amt);
  const ready = !!trimmedName && !!target && amtValue !== null && amtValue > 0;
  // A suggestion was chosen but its old item is gone from this month: say which
  // one, so picking a replacement is a decision and not a guess.
  const orphaned = picked && picked.itemId == null && !target;

  const typeName = (v) => {
    setName(v);
    setOpen(true);
    setPicked(null);
  };

  const pick = (s) => {
    setName(s.name);
    setPicked(s);
    setOpen(false);
    setHi(-1);
    if (s.itemId != null) {
      setItemId(s.itemId);
      requestAnimationFrame(() => amtRef.current && amtRef.current.focus());
    } else {
      setItemId(null);
      requestAnimationFrame(() => itemRef.current && itemRef.current.focus());
    }
  };

  // 'dayOverride' is for Enter pressed in the day field itself, whose new value
  // is not in 'day' yet. Missing pieces focus the field that is missing rather
  // than failing silently.
  const add = (dayOverride) => {
    if (!trimmedName) { nameRef.current && nameRef.current.focus(); return; }
    if (!target) { itemRef.current && itemRef.current.focus(); return; }
    if (amtValue === null || amtValue <= 0) { amtRef.current && amtRef.current.focus(); return; }
    dispatch({
      type: "addActual", month, groupId: target.groupId, itemId: target.id,
      amount: amtValue, name: trimmedName, note: note.trim(),
      day: dayOverride === undefined ? day : dayOverride,
    });
    setName(""); setNote(""); setAmt(""); setItemId(null); setPicked(null); setOpen(false); setHi(-1);
    // Back to the day, selected: the next statement line is usually the same
    // date (just press Enter through) or the next one (type over it).
    requestAnimationFrame(() => {
      if (dayRef.current) { dayRef.current.focus(); dayRef.current.select(); }
    });
  };

  const onNameKeyDown = (e) => {
    if (e.key === "ArrowDown" && shown.length) {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, shown.length - 1));
      return;
    }
    if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, -1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && hi >= 0 && shown[hi]) pick(shown[hi]);
      else add();
      return;
    }
    if (e.key === "Escape") {
      if (open) setOpen(false); else e.target.blur();
    }
  };

  if (items.length === 0) {
    return (
      <>
        <div className="section-head"><h2>Quick entry</h2></div>
        <div className="card empty" style={{ padding: "30px" }}>
          <div className="empty-icon"><Icons.coins size={20} /></div>
          <div style={{ fontSize: 14 }}>Add a group and some items below, then log your spending from here.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="section-head">
        <h2>Quick entry</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5, color: "var(--muted)" }}>
          <span>{entryCount} {entryCount === 1 ? "entry" : "entries"} logged this month</span>
        </div>
      </div>

      <div ref={rootRef} className="card" style={{ overflow: "visible" }}>
        {/* Six fields cannot hold their widths in a narrow window, and a Log
            button pushed outside the card is a button you cannot press. They
            wrap as two halves rather than one at a time, so a break always
            lands between "goes under" and the note - never mid-sequence. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1.1 1 360px", minWidth: 0 }}>
          <DayField day={day} monthId={month} title="Day of month for this entry" onCommit={setDay} onEnter={add} inputRef={dayRef} />

          {/* Name + past-entry suggestions. Focusing an EMPTY field does not
              reopen the list: it would cover the "just logged" recap the moment
              an entry lands. Typing or ArrowDown opens it. */}
          <div style={{ position: "relative", flex: "1.3 1 150px", minWidth: 0 }}>
            <input ref={nameRef} className="tinput" value={name} role="combobox"
              aria-label="What the spending was, as it appears on your statement"
              aria-expanded={open && shown.length > 0} aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={open && hi >= 0 ? `${listId}-${hi}` : undefined}
              placeholder="What was it?" autoComplete="off"
              style={{ height: 32, fontSize: 13 }}
              onChange={(e) => typeName(e.target.value)}
              onFocus={() => { if (name.trim()) setOpen(true); }}
              onKeyDown={onNameKeyDown} />
            {open && shown.length > 0 && (
              <div id={listId} role="listbox" aria-label="Previously logged entries"
                style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, minWidth: 280, zIndex: 30, border: "1px solid var(--border-strong)", borderRadius: 10, overflow: "hidden", background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}>
                {shown.map((s, idx) => (
                  <div key={`${s.name}|${s.itemName}`} style={{ borderTop: idx ? "1px solid var(--hairline)" : "none" }}>
                    <SuggestionRow s={s} id={`${listId}-${idx}`} active={idx === hi} currency={currency} onPick={pick} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* destination item */}
          <select ref={itemRef} className="tinput" value={itemId == null ? "" : String(itemId)}
            aria-label="Which budget item this spending goes under"
            onChange={(e) => { setItemId(e.target.value === "" ? null : Number(e.target.value)); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); amtRef.current && amtRef.current.focus(); } }}
            style={{ height: 32, fontSize: 13, cursor: "pointer", fontFamily: "inherit", flex: "1 1 140px", minWidth: 0, color: itemId == null ? "var(--muted)" : "var(--ink)", border: `1px solid ${orphaned ? "var(--neg)" : itemId == null ? "var(--border)" : "transparent"}`, background: itemId == null ? "var(--surface-2)" : "transparent" }}>
            <option value="">Goes under…</option>
            {mo.groups.filter((g) => g.items.length > 0).map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 340px", minWidth: 0 }}>
          <input className="tinput" value={note} aria-label="Note for this spending entry (optional)"
            onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
            style={{ height: 32, fontSize: 13, flex: "1 1 120px", minWidth: 0, color: "var(--ink-2)" }}
            onKeyDown={(e) => e.key === "Enter" && add()} />

          <div style={{ position: "relative", height: 32, flex: "0 0 140px" }}>
            <input ref={amtRef} className="minput" aria-label="Amount spent" inputMode="text"
              style={{ paddingLeft: 8, height: 32, fontSize: 13 }}
              value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={`${currency}0.00`}
              onKeyDown={(e) => e.key === "Enter" && add()} />
            {amtPreview !== null && (
              <span className="mono" style={{ position: "absolute", right: 4, bottom: "100%", marginBottom: 3, background: "var(--ink)", color: "var(--surface)", fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 4 }}>= {fmt(currency, amtPreview)}</span>
            )}
          </div>

          <button className="btn btn-sm btn-primary" style={{ height: 32, justifyContent: "center", flex: "0 0 auto" }}
            title={ready ? "Log this spend" : "Enter a name, an item and an amount"}
            onClick={() => add()}><Icons.plus size={14} /> Log</button>
        </div>
        </div>

        {/* Where the chosen name is going, or why it cannot go anywhere yet. */}
        {(target || orphaned) && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 16px", borderTop: "1px solid var(--hairline)", fontSize: 12.5, color: orphaned ? "var(--neg-ink)" : "var(--muted)", background: orphaned ? "var(--neg-soft)" : "var(--surface-2)" }}>
            {orphaned ? <Icons.alert size={14} /> : <Icons.check size={14} style={{ color: "var(--pos)" }} />}
            {orphaned
              ? <span>"{picked.name}" used to go under "{picked.itemName}", which this month does not have. Choose the item it belongs to now.</span>
              : <span>Goes under <strong style={{ fontWeight: 600, color: "var(--ink-2)" }}>{target.groupName} · {target.name}</strong>{picked && picked.itemId != null ? ", matched from a past entry" : ""}.</span>}
          </div>
        )}

        {recent.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border-strong)", background: "var(--surface-2)" }}>
            <div style={{ padding: "8px 16px 4px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--faint)", fontWeight: 600 }}>Just logged</div>
            {recent.map(({ a, it, g }) => (
              <div key={a.id} className="income-row" style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) minmax(0, auto) 120px 34px", alignItems: "center", gap: 10, padding: "5px 16px" }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--faint)", textAlign: "center" }}>{actualDay(a, month)}</span>
                <span style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.name || <span style={{ color: "var(--faint)" }}>Unnamed</span>}
                  {a.note && <span style={{ color: "var(--faint)", fontSize: 12 }}> · {a.note}</span>}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name} · {it.name}</span>
                <span className="mono" style={{ fontSize: 13, textAlign: "right" }}>{fmt(currency, a.amount)}</span>
                <div className="row-actions">
                  <button className="icon-btn subtle" title="Remove entry"
                    onClick={() => dispatch({ type: "removeActual", month, groupId: g.id, itemId: it.id, id: a.id })}><Icons.x size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export { QuickEntrySection };
