/* ============================================================
   Shared UI: icons, MoneyInput, StatTile, helpers
   ============================================================ */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { fmt } from './lib/index.js';

/* ---- icons (stroke, 1.6) ------------------------------------------------ */
function Ic({ d, size = 18, fill, ...p }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      {Array.isArray(d) ? d.map((x, i) => <path key={i} d={x} />) : <path d={d} />}
    </svg>
  );
}
const Icons = {
  budget: (p) => <Ic {...p} d={["M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z","M3 7l2-3h14l2 3","M16 12h2"]} />,
  history: (p) => <Ic {...p} d={["M3 12a9 9 0 1 0 3-6.7L3 8","M3 4v4h4","M12 8v4l3 2"]} />,
  settings: (p) => <Ic {...p} d={["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z","M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 14H4.5a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 19.4 11h.1a2 2 0 1 1 0 4h-.1Z"]} />,
  left: (p) => <Ic {...p} d="M15 18l-6-6 6-6" />,
  right: (p) => <Ic {...p} d="M9 18l6-6-6-6" />,
  down: (p) => <Ic {...p} d="M6 9l6 6 6-6" />,
  up: (p) => <Ic {...p} d="M18 15l-6-6-6 6" />,
  plus: (p) => <Ic {...p} d={["M12 5v14","M5 12h14"]} />,
  trash: (p) => <Ic {...p} d={["M3 6h18","M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2","M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14"]} />,
  x: (p) => <Ic {...p} d={["M18 6 6 18","M6 6l12 12"]} />,
  check: (p) => <Ic {...p} d="M20 6 9 17l-5-5" />,
  drag: (p) => <Ic {...p} d={["M9 6h.01","M15 6h.01","M9 12h.01","M15 12h.01","M9 18h.01","M15 18h.01"]} />,
  download: (p) => <Ic {...p} d={["M12 3v12","M7 10l5 5 5-5","M5 21h14"]} />,
  upload: (p) => <Ic {...p} d={["M12 21V9","M7 14l5-5 5 5","M5 3h14"]} />,
  folder: (p) => <Ic {...p} d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />,
  sun: (p) => <Ic {...p} d={["M12 4V2","M12 22v-2","M4 12H2","M22 12h-2","M5.6 5.6 4.2 4.2","M19.8 19.8l-1.4-1.4","M18.4 5.6l1.4-1.4","M4.2 19.8l1.4-1.4","M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"]} />,
  moon: (p) => <Ic {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  monitor: (p) => <Ic {...p} d={["M3 5h18v11H3z","M8 21h8","M12 16v5"]} />,
  alert: (p) => <Ic {...p} d={["M12 9v4","M12 17h.01","M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"]} />,
  coins: (p) => <Ic {...p} d={["M8 8a5 3 0 1 0 0-6 5 3 0 0 0 0 6Z","M3 5v6c0 1.7 2.2 3 5 3s5-1.3 5-3V5","M3 11c0 1.7 2.2 3 5 3","M16 10c2.8 0 5 1.3 5 3v6c0 1.7-2.2 3-5 3s-5-1.3-5-3v-3"]} />,
  user: (p) => <Ic {...p} d={["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z","M5 21a7 7 0 0 1 14 0"]} />,
  plant: (p) => <Ic {...p} d={["M12 22V11","M12 11c0-3 2-6 6-6 0 3-2 6-6 6Z","M12 14c0-2.6-1.7-5-5-5 0 2.6 1.7 5 5 5Z"]} />,
  edit: (p) => <Ic {...p} d={["M12 20h9","M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"]} />,
  copy: (p) => <Ic {...p} d={["M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z","M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"]} />,
  bell: (p) => <Ic {...p} d={["M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z","M10.5 19a1.8 1.8 0 0 0 3 0"]} />,
  wallet: (p) => <Ic {...p} d={["M21 12V7H5a2 2 0 0 1 0-4h14v4","M3 5v14a2 2 0 0 0 2 2h16v-5","M18 12a2 2 0 0 0 0 4h4v-4h-4Z"]} />,
};

/* ---- safe arithmetic evaluation for money fields ------------------------ */
function evalMoney(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === "") return 0;
  // keep only digits, operators, decimal points, parens
  s = s.replace(/[^0-9+\-*/.()]/g, "");
  if (s === "") return null;
  // no operators → plain number
  if (!/[+\-*/]/.test(s.replace(/^-/, ""))) { const n = parseFloat(s); return isNaN(n) ? null : Math.round(n * 100) / 100; }
  if (!/^[-+*/.()0-9]+$/.test(s)) return null;
  try {
    const val = Function('"use strict"; return (' + s + ')')();
    if (typeof val === "number" && isFinite(val)) return Math.round(val * 100) / 100;
  } catch (e) {}
  return null;
}
function isExpr(s) { return /[+\-*/]/.test(String(s).replace(/^\s*-/, "")); }

/* ---- column-wise keyboard navigation ------------------------------------
   Budgeting is a column of numbers, so Enter should behave the way it does in
   a spreadsheet: commit and drop to the same field one row down (Shift+Enter
   goes back up). Fields opt in with a `col` name; document order is row order.
   Returns false at the ends of a column so the caller can just blur. */
function focusInColumn(el, dir) {
  const col = el && el.getAttribute("data-col");
  if (!col) return false;
  const all = Array.from(document.querySelectorAll(`[data-col="${CSS.escape(col)}"]`))
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
function MoneyInput({ value, onCommit, currency = "$", className = "", placeholder = "0.00", autoFocus, col, label }) {
  const [txt, setTxt] = useState("");
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  // Enter commits and then moves focus, which fires blur on the way out. The
  // latch keeps that from writing the same value twice.
  const done = useRef(false);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  const display = editing ? txt : (value === 0 || value == null ? "" : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const preview = editing && isExpr(txt) ? evalMoney(txt) : null;
  const commit = () => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const n = evalMoney(txt);
    if (n !== null) onCommit(n); else if (String(txt).trim() === "") onCommit(0);
  };
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 9, color: "var(--faint)", fontSize: 13, pointerEvents: "none", fontFamily: "var(--font-mono)" }}>{currency}</span>
      <input ref={ref} className={`minput ${className}`} style={{ paddingLeft: 20 }} inputMode="text"
        data-col={col} aria-label={label}
        value={display} placeholder={placeholder}
        onFocus={(e) => { done.current = false; setEditing(true); setTxt(value ? String(value) : ""); requestAnimationFrame(() => { const el = e.target; const end = el.value.length; el.setSelectionRange(end, end); }); }}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            if (!focusInColumn(e.target, e.shiftKey ? -1 : 1)) e.target.blur();
          }
          if (e.key === "Escape") { done.current = true; setEditing(false); e.target.blur(); }
        }} />
      {preview !== null && (
        <span className="mono" style={{ position: "absolute", right: 6, bottom: "100%", marginBottom: 3, background: "var(--ink)", color: "var(--surface)", fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap", boxShadow: "var(--shadow-sm)", zIndex: 4 }}>= {fmt(currency, preview)}</span>
      )}
    </div>
  );
}

/* ---- text input (inline rename) ---------------------------------------- */
/* 'allowEmpty' is for genuinely optional text (an entry's note): without it a
   cleared field snaps back to its old value, so the field can never be emptied. */
function TextInline({ value, onCommit, className = "", placeholder = "", style, col, label, allowEmpty = false }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => { setTxt(value); }, [value]);
  return (
    <input className={`tinput ${className}`} value={txt} placeholder={placeholder} style={style}
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

/* ---- member avatar ------------------------------------------------------ */
function Avatar({ member, size = 26 }) {
  const initials = (member?.name || "?").trim().slice(0, 1).toUpperCase();
  return <span className="avatar" style={{ width: size, height: size, background: member?.color || "var(--muted)", fontSize: size * 0.42 }}>{initials}</span>;
}

/* ---- difference pill ---------------------------------------------------- */
function DiffPill({ diff, currency }) {
  if (Math.abs(diff) < 0.005) return <span className="pill pill-pos">on track</span>;
  if (diff > 0) return <span className="pill pill-pos">{fmt(currency, diff, { cents: false })} left</span>;
  return <span className="pill pill-neg">{fmt(currency, Math.abs(diff), { cents: false })} over</span>;
}

/* ---- mini progress bar -------------------------------------------------- */
function MiniBar({ actual, allocated }) {
  const pct = allocated > 0 ? Math.min(actual / allocated, 1) : (actual > 0 ? 1 : 0);
  const over = actual > allocated + 0.001;
  // scaleX rather than width: animating width relayouts every row on each commit.
  return (
    <div style={{ height: 5, borderRadius: 99, background: "var(--surface-sunken)", overflow: "hidden", width: "100%" }}>
      <div style={{ height: "100%", width: "100%", transformOrigin: "left", transform: `scaleX(${pct})`, background: over ? "var(--neg)" : "var(--pos)", transition: "transform .3s ease" }} />
    </div>
  );
}

/* ---- modal -------------------------------------------------------------- */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function Modal({ children, onClose, width, label }) {
  const boxRef = useRef(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`).current;

  // Escape closes; Tab is trapped inside the dialog so focus can never land on
  // the page behind the veil.
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !boxRef.current) return;
      const items = Array.from(boxRef.current.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Move focus in on open, put it back where it came from on close.
  useEffect(() => {
    const returnTo = document.activeElement;
    const box = boxRef.current;
    const target = box && (box.querySelector("[data-autofocus]") || box.querySelector(FOCUSABLE));
    if (target) target.focus();
    return () => { if (returnTo && typeof returnTo.focus === "function") returnTo.focus(); };
  }, []);

  return (
    <div className="modal-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={boxRef} className="modal" role="dialog" aria-modal="true"
        aria-label={label} aria-labelledby={label ? undefined : titleId}
        style={width ? { width } : undefined}>
        <div id={titleId} style={{ display: "contents" }}>{children}</div>
      </div>
    </div>
  );
}

/* ---- confirmation ------------------------------------------------------- */
/* One shape for every destructive action, so the guarantee a user learns from
   deleting an item holds when they delete a group, an account, or a member. */
function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose, busy, icon, width = 460 }) {
  return (
    <Modal onClose={busy ? () => {} : onClose} width={width}>
      <h3>{title}</h3>
      <p>{children}</p>
      {/* Cancel takes focus, never the destructive button: a stray Enter on an
          unexpected dialog must not be the thing that deletes the data. */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button className="btn btn-ghost" data-autofocus onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
          {icon}{busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ---- chart card wrapper (shared by History + Dashboard) ----------------- */
function ChartCard({ title, sub, children, wide }) {
  return (
    <div className="card fade-in" style={{ padding: "18px 20px 16px", gridColumn: wide ? "span 2" : "auto" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export { Icons, MoneyInput, TextInline, Avatar, DiffPill, MiniBar, Modal, ConfirmDialog, ChartCard, evalMoney, isExpr };
