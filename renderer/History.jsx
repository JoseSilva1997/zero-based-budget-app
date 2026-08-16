/* ============================================================
   History screen - month list, comparison, trends (charts).
   The per-month series comes from the store's 'trends' read (SQL-computed);
   ChartCard lives in ui/containers.jsx.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Icons, Modal } from './ui/index.js';
import { useStore } from './store.jsx';
import { cx, fmt, groupActual, groupAllocated, itemActual, monthLabel, round2 } from './lib/index.js';

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
        <div role="alert" className="alert alert-banner">
          <Icons.alert size={16} />
          <span>Your month history couldn't be read, so this screen may be empty or out of date. {loadError}</span>
        </div>
      )}

      {/* month list */}
      <div className="section-head"><h2>All months</h2></div>
      <div className="panel is-clipped">
        {/* Not a table: every row is one button that opens a month, and a row
            cannot be both a control and a set of cells. The strip below is a
            visual key for the columns; the reading of it lives on each row. */}
        <div className="eyebrow hist-colhead">
          <span>Month</span><span>Income</span><span>Allocated</span><span>Actual</span><span>Saved</span><span>Status</span>
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
          // No .budget-row here: this row has a six-column grid of its own, and
          // .budget-row means the Month Budget grid (var(--budget-cols), five
          // columns).
          return (
            <button key={s.id} onClick={() => setDetail(s.id)} aria-label={rowLabel} className="hist-row">
              <span className="hist-row-month">
                <span className="hist-row-label">{s.label}</span>
                {s.id === activeMonth && <span className="pill pill-neutral hist-row-current">current</span>}
              </span>
              <span className="num">{fmt(currency, s.income, { cents: false })}</span>
              <span className="num">{fmt(currency, s.alloc, { cents: false })}</span>
              <span className="num hist-row-actual">{fmt(currency, s.actual, { cents: false })}</span>
              <span className="num hist-row-saved">{fmt(currency, s.savings, { cents: false })}</span>
              <span className="hist-row-status">{s.overCount > 0 ? <span className="pill pill-breach">{s.overCount} over</span> : <span className="pill pill-neutral">clean</span>}</span>
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
      /* No panel around it: a full-width bordered box holding one sentence
         draws a frame the size of the comparison that isn't there yet. The
         sentence stands on its own under the section heading. */
      <div className="hist-cmp-none">
        Comparing needs a second month. Once you've tracked another one, {series[0] ? series[0].label : "this month"} can be set against it here.
      </div>
    );
  }
  const a = series.find(s => s.id === cmpA), b = series.find(s => s.id === cmpB);
  if (!a || !b) return null;
  const Sel = ({ value, onChange, label }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="btn btn-sm hist-cmp-sel">
      {series.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
  const same = a.id === b.id;
  const rows = [
    { label: "Income", a: a.income, b: b.income },
    { label: "Allocated", a: a.alloc, b: b.alloc },
    { label: "Actual spent", a: a.actual, b: b.actual },
    { label: "Saved", a: a.savings, b: b.savings },
  ];
  return (
    <div className="panel hist-cmp">
      <div className="hist-cmp-head">
        <Sel value={cmpA} onChange={setCmpA} label="Compare from" />
        <Icons.right size={16} />
        <Sel value={cmpB} onChange={setCmpB} label="Compare to" />
      </div>
      {same ? (
        <div className="hist-cmp-same">
          Both sides are {a.label}. Pick two different months to see what changed.
        </div>
      ) : (
      <div className="hist-cmp-grid">
        {rows.map(r => {
          const delta = round2(r.b - r.a);
          const pct = r.a !== 0 ? Math.round((delta / r.a) * 100) : null;
          const positive = delta > 0;
          const neutral = Math.abs(delta) < 0.005;
          return (
            <div key={r.label} className="hist-cmp-card">
              <div className="hist-cmp-label">{r.label}</div>
              <div className="num hist-cmp-value">{fmt(currency, r.b, { cents: false })}</div>
              <div className={cx("hist-cmp-delta", neutral && "is-neutral")}>
                {!neutral && (positive ? <Icons.up size={13} /> : <Icons.down size={13} />)}
                <span className="num">{neutral ? "no change" : `${fmt(currency, Math.abs(delta), { cents: false })}${pct !== null ? ` · ${Math.abs(pct)}%` : ""}`}</span>
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
      <div className="hist-detail-head">
        <div>
          <h3 className="hist-detail-title">{monthLabel(series.id).mo} {monthLabel(series.id).yr}</h3>
          <p className="hist-detail-sub">Read-only summary · {series.overCount} item{series.overCount !== 1 ? "s" : ""} over budget</p>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close" aria-label={`Close ${monthLabel(series.id).mo} ${monthLabel(series.id).yr}`}><Icons.x size={18} /></button>
      </div>
      <div className="hist-detail-stats">
        {[["Income", series.income], ["Allocated", series.alloc], ["Actual", series.actual], ["Saved", series.savings]].map(([l, v]) => (
          <div key={l} className="hist-detail-stat">
            <div className="hist-detail-stat-label">{l}</div>
            <div className="num hist-detail-stat-value">{fmt(currency, v, { cents: false })}</div>
          </div>
        ))}
      </div>
      <div className="hist-detail-body">
        {!mo && !err && <div className="hist-detail-loading">Loading…</div>}
        {err && (
          <div role="alert" className="alert hist-detail-error">
            <Icons.alert size={16} />
            <span>This month's breakdown couldn't be read. {err}</span>
          </div>
        )}
        {mo && mo.groups.map(g => (
          <div key={g.id} className="hist-detail-group">
            <div className="hist-detail-group-head">
              <span>{g.name}{g.isSavings ? " · savings" : ""}</span>
              <span className="num">{fmt(currency, groupActual(g), { cents: false })} / {fmt(currency, groupAllocated(g), { cents: false })}</span>
            </div>
            {g.items.map(it => { const act = itemActual(it); const over = act > it.allocated + 0.005; return (
              <div key={it.id} className="hist-detail-item">
                <span className="hist-detail-item-name">{it.name}</span>
                <span className="num hist-detail-item-alloc">{fmt(currency, it.allocated, { cents: false })}</span>
                <span className={cx("num", "hist-detail-item-actual", over && "is-over")}>{fmt(currency, act, { cents: false })}</span>
              </div>
            ); })}
          </div>
        ))}
      </div>
      {!isCurrent && <div className="hist-detail-foot"><button className="btn btn-ghost" onClick={onOpen}>Open in Month Budget <Icons.right size={15} /></button></div>}
    </Modal>
  );
}

export { HistoryScreen };
