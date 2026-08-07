/* ============================================================
   History screen - month list, comparison, trends (charts).
   The per-month series comes from the store's 'trends' read (SQL-computed);
   ChartCard lives in components.jsx.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Icons, Modal } from './components.jsx';
import { useStore } from './store.jsx';
import { fmt, groupActual, groupAllocated, itemActual, monthLabel, round2 } from './lib/index.js';

function HistoryScreen({ currency, onOpenMonth }) {
  const { state, trends, getMonth } = useStore();
  const activeMonth = state.activeMonth;
  const [series, setSeries] = useState([]);
  // A failed read must not look like a household with no history, so the
  // error is kept and shown rather than left as a convincing empty screen.
  const [loadError, setLoadError] = useState(null);
  useEffect(() => {
    let live = true;
    trends()
      .then((s) => { if (live) { setSeries(s); setLoadError(null); } })
      .catch((err) => { console.error("trends:series failed", err); if (live) setLoadError(err.message || String(err)); });
    return () => { live = false; };
  }, [trends]);
  const groupNames = useMemo(() => {
    const set = []; series.forEach(s => Object.keys(s.byGroup).forEach(n => { if (!set.includes(n)) set.push(n); })); return set;
  }, [series]);
  const [detail, setDetail] = useState(null);
  const [cmpA, setCmpA] = useState(null);
  const [cmpB, setCmpB] = useState(null);
  // Default the comparison selectors to the two most recent months once
  // loaded. With a single month there is no pair to default to, and a month
  // set against itself is four rows of "no change", so nothing is chosen.
  useEffect(() => {
    if (series.length < 2) return;
    setCmpA((v) => v ?? series[series.length - 2].id);
    setCmpB((v) => v ?? series[series.length - 1].id);
  }, [series]);

  return (
    <div className="fade-in">
      <div className="topbar">
        <div>
          <div className="page-title">History</div>
          <div className="page-sub">{series.length} month{series.length !== 1 ? "s" : ""} tracked · {fmt(currency, series.reduce((a, s) => a + s.savings, 0), { cents: false })} saved in total</div>
        </div>
      </div>

      {loadError && (
        <div role="alert" style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "var(--neg-soft)", color: "var(--neg-ink)", padding: "11px 14px", borderRadius: 10, fontSize: 13, lineHeight: 1.45, marginBottom: 16 }}>
          <Icons.alert size={16} style={{ flex: "none", marginTop: 1 }} />
          <span>Your month history couldn't be read, so this screen may be empty or out of date. {loadError}</span>
        </div>
      )}

      {/* month list */}
      <div className="section-head"><h2>All months</h2></div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {/* Not a table: every row is one button that opens a month, and a row
            cannot be both a control and a set of cells. The strip below is a
            visual key for the columns; the reading of it lives on each row. */}
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr 90px", gap: 10, padding: "10px 18px", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--faint)", fontWeight: 600, background: "var(--board)" }}>
          <span>Month</span><span style={{ textAlign: "right" }}>Income</span><span style={{ textAlign: "right" }}>Allocated</span><span style={{ textAlign: "right" }}>Actual</span><span style={{ textAlign: "right" }}>Saved</span><span style={{ textAlign: "right" }}>Status</span>
        </div>
        {[...series].reverse().map((s, i) => {
          const left = round2(s.income - s.alloc);
          // The column strip above is a visual key; each row is one control,
          // so the row carries its own reading of those columns rather than
          // leaving five bare numbers to be matched up by position.
          const rowLabel = `${s.label}${s.id === activeMonth ? ", current month" : ""}. `
            + `Income ${fmt(currency, s.income, { cents: false })}, `
            + `allocated ${fmt(currency, s.alloc, { cents: false })}, `
            + `actual ${fmt(currency, s.actual, { cents: false })}, `
            + `saved ${fmt(currency, s.savings, { cents: false })}. `
            + (s.overCount > 0 ? `${s.overCount} item${s.overCount !== 1 ? "s" : ""} over budget.` : "Nothing over budget.");
          return (
            <button key={s.id} onClick={() => setDetail(s.id)} className="budget-row" aria-label={rowLabel} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr 90px", gap: 10, padding: "13px 18px", alignItems: "center", borderTop: "1px solid var(--rule-faint)", background: "transparent", border: "none", borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: "var(--rule-faint)", width: "100%", textAlign: "left", cursor: "pointer", color: "var(--ink)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{s.label}</span>
                {s.id === activeMonth && <span className="pill pill-neutral" style={{ fontSize: 10 }}>current</span>}
              </span>
              <span className="mono" style={{ textAlign: "right", fontSize: 13.5 }}>{fmt(currency, s.income, { cents: false })}</span>
              <span className="mono" style={{ textAlign: "right", fontSize: 13.5 }}>{fmt(currency, s.alloc, { cents: false })}</span>
              <span className="mono" style={{ textAlign: "right", fontSize: 13.5, color: "var(--ink-2)" }}>{fmt(currency, s.actual, { cents: false })}</span>
              <span className="mono" style={{ textAlign: "right", fontSize: 13.5, color: "var(--pos-ink)", fontWeight: 600 }}>{fmt(currency, s.savings, { cents: false })}</span>
              <span style={{ textAlign: "right" }}>{s.overCount > 0 ? <span className="pill pill-neg">{s.overCount} over</span> : <span className="pill pill-pos">clean</span>}</span>
            </button>
          );
        })}
      </div>

      {/* comparison - the heading only earns its place once there is a month
          to put under it, otherwise it is a title over empty space */}
      {series.length > 0 && (
        <>
          <div className="section-head"><h2>Compare months</h2></div>
          <Comparison series={series} cmpA={cmpA} cmpB={cmpB} setCmpA={setCmpA} setCmpB={setCmpB} currency={currency} groupNames={groupNames} />
        </>
      )}

      {detail && <MonthDetail series={series.find(s => s.id === detail)} getMonth={getMonth} currency={currency} onClose={() => setDetail(null)} onOpen={() => { onOpenMonth(detail); setDetail(null); }} isCurrent={detail === activeMonth} />}
    </div>
  );
}

/* comparison panel */
function Comparison({ series, cmpA, cmpB, setCmpA, setCmpB, currency, groupNames }) {
  // One month is not a comparison. Say so, rather than showing that month
  // against itself with an arrow between two identical labels.
  if (series.length < 2) {
    return (
      <div className="panel" style={{ padding: "18px 20px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5 }}>
        Comparing needs a second month. Once you've tracked another one, {series[0] ? series[0].label : "this month"} can be set against it here.
      </div>
    );
  }
  const a = series.find(s => s.id === cmpA), b = series.find(s => s.id === cmpB);
  if (!a || !b) return null;
  const Sel = ({ value, onChange, label }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="btn btn-sm" style={{ paddingRight: 8 }}>
      {series.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
  const same = a.id === b.id;
  const rows = [
    { label: "Income", a: a.income, b: b.income, good: "up" },
    { label: "Allocated", a: a.alloc, b: b.alloc, good: "flat" },
    { label: "Actual spent", a: a.actual, b: b.actual, good: "down" },
    { label: "Saved", a: a.savings, b: b.savings, good: "up" },
  ];
  return (
    <div className="panel" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <Sel value={cmpA} onChange={setCmpA} label="Compare from" />
        <Icons.right size={16} style={{ color: "var(--faint)" }} />
        <Sel value={cmpB} onChange={setCmpB} label="Compare to" />
      </div>
      {same ? (
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5 }}>
          Both sides are {a.label}. Pick two different months to see what changed.
        </div>
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {rows.map(r => {
          const delta = round2(r.b - r.a);
          const pct = r.a !== 0 ? Math.round((delta / r.a) * 100) : null;
          const positive = delta > 0;
          const goodDir = r.good === "up" ? positive : r.good === "down" ? !positive : Math.abs(delta) < 0.005;
          const neutral = Math.abs(delta) < 0.005;
          return (
            <div key={r.label} style={{ padding: "14px 16px", borderRadius: 12, background: "var(--board)", border: "1px solid var(--rule-faint)" }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{r.label}</div>
              <div className="mono" style={{ fontSize: 19, fontWeight: 500, marginBottom: 6 }}>{fmt(currency, r.b, { cents: false })}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: neutral ? "var(--faint)" : goodDir ? "var(--pos-ink)" : "var(--neg-ink)" }}>
                {!neutral && (positive ? <Icons.up size={13} /> : <Icons.down size={13} />)}
                <span className="mono" style={{ fontWeight: 600 }}>{neutral ? "no change" : `${fmt(currency, Math.abs(delta), { cents: false })}${pct !== null ? ` · ${Math.abs(pct)}%` : ""}`}</span>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

/* read-only month detail */
function MonthDetail({ series, getMonth, currency, onClose, onOpen, isCurrent }) {
  const [mo, setMo] = useState(null);
  // Without this catch a failed read leaves "Loading…" on screen for good.
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    setMo(null); setErr(null);
    getMonth(series.id)
      .then((m) => { if (live) setMo(m); })
      .catch((e) => { console.error("month:get failed", e); if (live) setErr(e.message || String(e)); });
    return () => { live = false; };
  }, [series.id, getMonth]);
  return (
    <Modal onClose={onClose} width={620}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h3 style={{ marginBottom: 2 }}>{monthLabel(series.id).mo} {monthLabel(series.id).yr}</h3>
          <p style={{ margin: 0 }}>Read-only summary · {series.overCount} item{series.overCount !== 1 ? "s" : ""} over budget</p>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close" aria-label={`Close ${monthLabel(series.id).mo} ${monthLabel(series.id).yr}`}><Icons.x size={18} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 18 }}>
        {[["Income", series.income], ["Allocated", series.alloc], ["Actual", series.actual], ["Saved", series.savings]].map(([l, v]) => (
          <div key={l} style={{ padding: "10px 12px", borderRadius: 10, background: "var(--board)", border: "1px solid var(--rule-faint)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{l}</div>
            <div className="mono" style={{ fontSize: 15, fontWeight: 600, marginTop: 3 }}>{fmt(currency, v, { cents: false })}</div>
          </div>
        ))}
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto", margin: "0 -4px", paddingRight: 4 }}>
        {!mo && !err && <div style={{ padding: "12px 8px", color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
        {err && (
          <div role="alert" style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "12px 8px", color: "var(--neg-ink)", fontSize: 13, lineHeight: 1.45 }}>
            <Icons.alert size={16} style={{ flex: "none", marginTop: 1 }} />
            <span>This month's breakdown couldn't be read. {err}</span>
          </div>
        )}
        {mo && mo.groups.map(g => (
          <div key={g.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13.5, padding: "6px 8px", background: "var(--board)", borderRadius: 7 }}>
              <span>{g.name}{g.isSavings ? " · savings" : ""}</span>
              <span className="mono">{fmt(currency, groupActual(g), { cents: false })} / {fmt(currency, groupAllocated(g), { cents: false })}</span>
            </div>
            {g.items.map(it => { const act = itemActual(it); const over = act > it.allocated + 0.005; return (
              <div key={it.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px", gap: 8, padding: "5px 8px", fontSize: 13, borderBottom: "1px solid var(--rule-faint)" }}>
                <span style={{ color: "var(--ink-2)" }}>{it.name}</span>
                <span className="mono" style={{ textAlign: "right", color: "var(--faint)" }}>{fmt(currency, it.allocated, { cents: false })}</span>
                <span className="mono" style={{ textAlign: "right", color: over ? "var(--neg-ink)" : "var(--ink)", fontWeight: over ? 600 : 400 }}>{fmt(currency, act, { cents: false })}</span>
              </div>
            ); })}
          </div>
        ))}
      </div>
      {!isCurrent && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><button className="btn btn-ghost" onClick={onOpen}>Open in Month Budget <Icons.right size={15} /></button></div>}
    </Modal>
  );
}

export { HistoryScreen };
