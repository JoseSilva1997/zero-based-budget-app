/* ============================================================
   Quick entry - one central place to log spending for the whole month.

   Type what the bank statement says: names logged before are offered back, and
   a chosen one already knows which budget item it belongs to, so a statement
   can be worked top to bottom without opening each item's drawer in turn. A
   name with no history needs its item picked once, and is suggested from then
   on. Everything written here lands in the normal item drawers below.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DayField, EmptyState, FieldChip, Icons, Section } from './ui/index.js';
import { actualDay, cx, evalMoney, flatItems, fmt, isExpr, recentEntries } from './lib/index.js';
import { useStore } from './store.jsx';

/* One suggestion row. Unresolved ones (their item is not in this month) say so
   rather than looking identical to the ones that file themselves. */
function SuggestionRow({ s, active, currency, onPick, id }) {
  return (
    <button type="button" id={id} role="option" aria-selected={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(s)}
      className={cx("picker-option qe-sugg", active && "is-active")}>
      <span className="picker-option-text">
        <span className="picker-option-name truncate">{s.name}</span>
        <span className={cx("qe-sugg-sub", s.itemId == null && "is-unresolved")}>
          {s.itemId == null ? <Icons.alert size={12} /> : <Icons.right size={12} />}
          {s.itemId == null ? `"${s.itemName}" is not in this month - pick an item` : `${s.groupName} · ${s.itemName}`}
        </span>
      </span>
      <span className="qe-sugg-meta">
        <span className="num qe-sugg-amt">{fmt(currency, s.amount)}</span>
        <span className="qe-sugg-when">
          {s.monthLabel}{s.uses > 1 ? ` · ${s.uses}×` : ""}
        </span>
      </span>
    </button>
  );
}

function QuickEntrySection({ mo, month, currency, dispatch }) {
  const { entrySuggestions, toast } = useStore();
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
  // in the month it was resolved against. Debounced, so typing a name is one
  // query and not one per character.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      entrySuggestions(name)
        .then((list) => { if (live) { setSuggestions(list); setHi(-1); } })
        .catch((err) => { if (live) { setSuggestions([]); setHi(-1); console.error("[entrySuggestions]", err); } });
    }, 140);
    return () => { live = false; clearTimeout(timer); };
  }, [entrySuggestions, name, month, entryCount]);

  /* The live field values. 'add' clears all six the moment it fires, so by the
     time its write answers, its own closure can no longer say whether the next
     statement line is already being typed. */
  const fieldsRef = useRef({ name, note, amt, itemId });
  useEffect(() => { fieldsRef.current = { name, note, amt, itemId }; });

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
  /* A logged entry clears six fields at once so the next statement line can be
     typed straight away, which means a refused write would take all six with
     it. They are cleared optimistically and handed back if the store reports
     the write did not land. */
  const add = async (dayOverride) => {
    if (!trimmedName) { nameRef.current && nameRef.current.focus(); return; }
    if (!target) { itemRef.current && itemRef.current.focus(); return; }
    if (amtValue === null || amtValue <= 0) { amtRef.current && amtRef.current.focus(); return; }
    const entryDay = dayOverride === undefined ? day : dayOverride;
    const typed = { name, note, amt, itemId, picked, day: entryDay };
    setName(""); setNote(""); setAmt(""); setItemId(null); setPicked(null); setOpen(false); setHi(-1);
    // Back to the day, selected: the next statement line is usually the same
    // date (just press Enter through) or the next one (type over it).
    requestAnimationFrame(() => {
      if (dayRef.current) { dayRef.current.focus(); dayRef.current.select(); }
    });
    const { ok } = await dispatch({
      type: "addActual", month, groupId: target.groupId, itemId: target.id,
      amount: amtValue, name: trimmedName, note: note.trim(),
      day: entryDay,
    });
    if (ok) return;
    // Unless the next statement line is already being typed: putting the old
    // one back on top of that would be a loss of its own.
    const live = fieldsRef.current;
    if (live.name || live.note || live.amt || live.itemId != null) return;
    setName(typed.name); setNote(typed.note); setAmt(typed.amt);
    setItemId(typed.itemId); setPicked(typed.picked); setDay(typed.day);
    setOpen(false); setHi(-1);
    requestAnimationFrame(() => { if (amtRef.current) amtRef.current.focus(); });
  };

  /* Same trade as the item drawers: a single click on a hover-revealed icon,
     in the middle of the fastest task in the app, gets an undo rather than a
     fifth confirmation dialog. The entry comes back as a new row, so its id
     changes, but its day, name, note and amount do not. */
  const removeEntry = (a, it, g) => {
    const restore = { amount: a.amount, name: a.name || "", note: a.note || "", day: actualDay(a, month) };
    dispatch({ type: "removeActual", month, groupId: g.id, itemId: it.id, id: a.id });
    toast(`Removed ${a.name ? `"${a.name}"` : "entry"} from ${it.name}.`, "success", {
      label: "Undo",
      onAct: () => dispatch({ type: "addActual", month, groupId: g.id, itemId: it.id, ...restore }),
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
        <Section title="Quick entry" className="qe-head" />
        <EmptyState icon={Icons.coins} inline>Add a group and some items below, then log your spending from here.</EmptyState>
      </>
    );
  }

  return (
    <>
      <Section title="Quick entry" className="qe-head">
        <div className="qe-count">
          <span className="num qe-count-num">{entryCount}</span>
          <span>{entryCount === 1 ? "entry" : "entries"} logged this month</span>
        </div>
      </Section>

      <div ref={rootRef} className="panel is-unclipped qe-card">
        <div className="qe-fields">
        <div className="qe-half qe-half-what">
          <DayField day={day} monthId={month} title="Day of month for this entry" onCommit={setDay} onEnter={add} inputRef={dayRef} tray />

          {/* Name + past-entry suggestions. Focusing an EMPTY field does not
              reopen the list: it would cover the "just logged" recap the moment
              an entry lands. Typing or ArrowDown opens it. */}
          <div className="qe-name-wrap">
            <input ref={nameRef} className="tinput tray qe-field" value={name} role="combobox"
              aria-label="What the spending was, as it appears on your statement"
              aria-expanded={open && shown.length > 0} aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={open && hi >= 0 ? `${listId}-${hi}` : undefined}
              placeholder="What was it?" autoComplete="off"
              onChange={(e) => typeName(e.target.value)}
              onFocus={() => { if (name.trim()) setOpen(true); }}
              onKeyDown={onNameKeyDown} />
            {open && shown.length > 0 && (
              <div id={listId} role="listbox" aria-label="Previously logged entries" className="qe-sugg-list">
                {shown.map((s, idx) => (
                  <div key={`${s.name}|${s.itemName}`} className="qe-sugg-row">
                    <SuggestionRow s={s} id={`${listId}-${idx}`} active={idx === hi} currency={currency} onPick={pick} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* destination item */}
          <select ref={itemRef} value={itemId == null ? "" : String(itemId)}
            className={cx("tinput tray qe-field qe-item-select", itemId == null && "is-empty", orphaned && "is-orphaned")}
            aria-label="Which budget item this spending goes under"
            onChange={(e) => { setItemId(e.target.value === "" ? null : Number(e.target.value)); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); amtRef.current && amtRef.current.focus(); } }}>
            <option value="">Goes under…</option>
            {mo.groups.filter((g) => g.items.length > 0).map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="qe-half qe-half-amount">
          <input className="tinput tray qe-field qe-note" value={note} aria-label="Note for this spending entry (optional)"
            onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
            onKeyDown={(e) => e.key === "Enter" && add()} />

          <div className="qe-amt-cell">
            <input ref={amtRef} className="minput tray qe-field qe-amt-input" aria-label="Amount spent" inputMode="text"
              value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={`${currency}0.00`}
              onKeyDown={(e) => e.key === "Enter" && add()} />
            {amtPreview !== null && <FieldChip tight>= {fmt(currency, amtPreview)}</FieldChip>}
          </div>

          <button className="btn btn-sm btn-primary qe-log-btn"
            title={ready ? "Log this spend" : "Enter a name, an item and an amount"}
            onClick={() => add()}><Icons.plus size={14} /> Log</button>
        </div>
        </div>

        {/* Where the chosen name is going, or why it cannot go anywhere yet. */}
        {(target || orphaned) && (
          <div className={cx("qe-target", orphaned && "is-orphaned")}>
            {orphaned ? <Icons.alert size={14} /> : <Icons.check size={14} className="qe-target-ok" />}
            {orphaned
              ? <span>"{picked.name}" used to go under "{picked.itemName}", which this month does not have. Choose the item it belongs to now.</span>
              : <span>Goes under <strong className="qe-target-name">{target.groupName} · {target.name}</strong>{picked && picked.itemId != null ? ", matched from a past entry" : ""}.</span>}
          </div>
        )}

        {recent.length > 0 && (
          <div className="qe-recent">
            <div className="eyebrow qe-recent-head">Just logged</div>
            {recent.map(({ a, it, g }) => (
              <div key={a.id} className="income-row qe-recent-row">
                <span className="num qe-recent-day">{actualDay(a, month)}</span>
                <span className="qe-recent-name truncate">
                  {a.name || <span className="qe-recent-unnamed">Unnamed</span>}
                  {a.note && <span className="qe-recent-note"> · {a.note}</span>}
                </span>
                <span className="qe-recent-dest truncate">{g.name} · {it.name}</span>
                <span className="num qe-recent-amt">{fmt(currency, a.amount)}</span>
                <div className="row-actions">
                  <button className="icon-btn subtle" title="Remove entry"
                    aria-label={`Remove ${a.name ? `"${a.name}"` : "unnamed"} entry of ${fmt(currency, a.amount)} from ${it.name}`}
                    onClick={() => removeEntry(a, it, g)}><Icons.x size={14} /></button>
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
