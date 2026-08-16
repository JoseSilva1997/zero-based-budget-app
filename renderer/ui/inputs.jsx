/* ============================================================
   The editable primitives: an amount, a day of the month, and a name.

   All three are borderless and look like plain text until they are engaged,
   all three commit on blur and on Enter, and all three abandon on Escape.
   That agreement is the whole point of them being one file: a household
   learns the behaviour once and it holds in every cell of the budget.
   ============================================================ */
import { useState, useEffect, useRef } from 'react';
import { cx, daysInMonth, evalMoney, fmt, isExpr, parseMoney } from '../lib/index.js';

/* ---- column-wise keyboard navigation ------------------------------------
   Budgeting is a column of numbers, so Enter should behave the way it does in
   a spreadsheet: commit and drop to the same field one row down (Shift+Enter
   goes back up). Fields opt in with a `col` name; document order is row order.
   Returns false at the ends of a column so the caller can just blur. */
function focusInColumn(el, dir) {
  const col = el && el.getAttribute("data-col");
  if (!col) return false;
  // Every column lives inside the scrolling main pane, so search that rather
  // than the whole document on each keystroke. Same elements, same order.
  const root = el.closest("main") || document;
  const all = Array.from(root.querySelectorAll(`[data-col="${CSS.escape(col)}"]`))
    .filter((n) => !n.disabled && n.offsetParent !== null);
  const i = all.indexOf(el);
  if (i === -1) return false;
  const next = all[i + dir];
  if (!next) return false;
  next.focus();
  if (typeof next.select === "function") next.select();
  return true;
}

/* ---- money input -------------------------------------------------------- */
/* `placeholder` defaults to null rather than "0.00" so it can pick up the
   household's currency: an unset row now reads "$0.00" and lines up with the
   filled rows above it instead of sitting a symbol's width to their right. */
function MoneyInput({ value, onCommit, currency = "$", className = "", placeholder = null, autoFocus, col, label }) {
  const [txt, setTxt] = useState("");
  const [editing, setEditing] = useState(false);
  // The reason the last commit was refused, or null. Held in state rather than
  // recomputed on every keystroke so a half-typed sum isn't scolded as you type.
  const [invalid, setInvalid] = useState(null);
  const ref = useRef(null);
  const noteId = useRef(`minput-note-${Math.random().toString(36).slice(2, 9)}`).current;
  // Enter commits and then moves focus, which fires blur on the way out. The
  // latch keeps that from writing the same value twice.
  const done = useRef(false);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  /* The currency symbol is part of the value at rest, not a span pinned to the
     left edge: in a 150px right-aligned column that would strand "$" ninety
     pixels from its own amount. While the field is being edited it drops away,
     because what is typed there is a number (or a sum, "40+12.50") and not a
     price. */
  const display = editing ? txt : (value === 0 || value == null ? "" : `${currency}${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const preview = editing && !invalid && isExpr(txt) ? evalMoney(txt) : null;
  // Returns whether the value went in: a refused commit keeps the field open,
  // holding what was typed, so the fix is one keystroke away rather than a retype.
  const commit = () => {
    if (done.current) return true;
    const r = parseMoney(txt);
    if (!r.ok) { setInvalid(r.reason); return false; }
    done.current = true;
    setInvalid(null);
    setEditing(false);
    onCommit(r.value);
    return true;
  };
  return (
    <div className="field-wrap">
      <input ref={ref} className={cx("minput", className, invalid && "is-invalid")} inputMode="text"
        data-col={col} aria-label={label}
        aria-invalid={invalid ? true : undefined} aria-describedby={invalid ? noteId : undefined}
        value={display} placeholder={placeholder ?? `${currency}0.00`}
        // Coming back to a refused value must not wipe it, so only a clean field reloads from store.
        onFocus={(e) => { done.current = false; setEditing(true); if (!invalid) setTxt(value ? String(value) : ""); requestAnimationFrame(() => { const el = e.target; const end = el.value.length; el.setSelectionRange(end, end); }); }}
        onChange={(e) => { const v = e.target.value; setTxt(v); if (invalid && parseMoney(v).ok) setInvalid(null); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            // Nothing was stored, so don't march the user down the column away from it.
            if (!commit()) return;
            if (!focusInColumn(e.target, e.shiftKey ? -1 : 1)) e.target.blur();
          }
          if (e.key === "Escape") { done.current = true; setInvalid(null); setEditing(false); e.target.blur(); }
        }} />
      {/* One chip above the field, carrying either the arithmetic preview or the
          reason the value was refused. */}
      {invalid ? (
        <span id={noteId} role="alert" className="field-chip is-error">{invalid}</span>
      ) : preview !== null && (
        <span className="num field-chip">= {fmt(currency, preview)}</span>
      )}
    </div>
  );
}

/* ---- day-of-month editor (1..last day of the month) ---------------------
   'onEnter' makes Enter submit rather than just blur, and receives the clamped
   day directly: the commit that goes with it only lands in state after this
   keystroke. */
function DayField({ day, monthId, onCommit, onEnter, inputRef, autoFocus = false, title = "Day of month", tray = false }) {
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
    <input ref={inputRef} autoFocus={autoFocus} className={cx("minput num day", tray && "tray")} value={txt} inputMode="numeric" title={title} aria-label={title}
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
      }} />
  );
}

/* ---- text input (inline rename) ---------------------------------------- */
/* 'allowEmpty' is for genuinely optional text (an entry's note): without it a
   cleared field snaps back to its old value, so the field can never be emptied. */
/* No `style` prop on any of the three fields in this file: static rules belong
   in a class. Inline styling is reserved for values only known at runtime,
   which is what Avatar's own style is (its size prop and its member's colour). */
function TextInline({ value, onCommit, className = "", placeholder = "", col, label, allowEmpty = false }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => { setTxt(value); }, [value]);
  return (
    <input className={`tinput ${className}`} value={txt} placeholder={placeholder}
      data-col={col} aria-label={label}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => onCommit(allowEmpty ? txt.trim() : txt.trim() || value)}
      onKeyDown={(e) => {
        // Blur commits, so moving focus is enough - no explicit commit here.
        if (e.key === "Enter") {
          e.preventDefault();
          if (!focusInColumn(e.target, e.shiftKey ? -1 : 1)) e.target.blur();
        }
        if (e.key === "Escape") { setTxt(value); e.target.blur(); }
      }} />
  );
}

export { MoneyInput, DayField, TextInline };
