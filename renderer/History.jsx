/* ============================================================
   History screen — month list, comparison, trends (charts)
   buildSeries + ChartCard now live in store.jsx / components.jsx.
   ============================================================ */

function HistoryScreen({ state, dispatch, currency, onOpenMonth }) {
  const series = useMemo(() => buildSeries(state), [state]);
  const groupNames = useMemo(() => {
    const set = []; series.forEach(s => Object.keys(s.byGroup).forEach(n => { if (!set.includes(n)) set.push(n); })); return set;
  }, [series]);
  const [detail, setDetail] = useState(null);
  const [cmpA, setCmpA] = useState(series[Math.max(0, series.length - 2)]?.id);
  const [cmpB, setCmpB] = useState(series[series.length - 1]?.id);

  return (
    <div className="fade-in">
      <div className="topbar">
        <div>
          <div className="page-title">History</div>
          <div className="page-sub">{series.length} month{series.length !== 1 ? "s" : ""} tracked · {fmt(currency, series.reduce((a, s) => a + s.savings, 0), { cents: false })} saved in total</div>
        </div>
      </div>

      {/* month list */}
      <div className="section-head"><h2>All months</h2></div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr 90px", gap: 10, padding: "10px 18px", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--faint)", fontWeight: 600, background: "var(--surface-2)" }}>
          <span>Month</span><span style={{ textAlign: "right" }}>Income</span><span style={{ textAlign: "right" }}>Allocated</span><span style={{ textAlign: "right" }}>Actual</span><span style={{ textAlign: "right" }}>Saved</span><span style={{ textAlign: "right" }}>Status</span>
        </div>
        {[...series].reverse().map((s, i) => {
          const left = round2(s.income - s.alloc);
          return (
            <button key={s.id} onClick={() => setDetail(s.id)} className="budget-row" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1fr 90px", gap: 10, padding: "13px 18px", alignItems: "center", borderTop: "1px solid var(--hairline)", background: "transparent", border: "none", borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: "var(--hairline)", width: "100%", textAlign: "left", cursor: "pointer", color: "var(--ink)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{s.label}</span>
                {s.id === state.activeMonth && <span className="pill pill-neutral" style={{ fontSize: 10 }}>current</span>}
              </span>
              <span className="mono" style={{ textAlign: "right", fontSize: 13.5 }}>{fmt(currency, s.income, { cents: false })}</span>
              <span className="mono" style={{ textAlign: "right", fontSize: 13.5 }}>{fmt(currency, s.alloc, { cents: false })}</span>
              <span className="mono" style={{ textAlign: "right", fontSize: 13.5, color: "var(--ink-2)" }}>{fmt(currency, s.actual, { cents: false })}</span>
              <span className="mono" style={{ textAlign: "right", fontSize: 13.5, color: "var(--accent-ink)", fontWeight: 600 }}>{fmt(currency, s.savings, { cents: false })}</span>
              <span style={{ textAlign: "right" }}>{s.overCount > 0 ? <span className="pill pill-neg">{s.overCount} over</span> : <span className="pill pill-pos">clean</span>}</span>
            </button>
          );
        })}
      </div>

      {/* comparison */}
      <div className="section-head"><h2>Compare months</h2></div>
      <Comparison series={series} cmpA={cmpA} cmpB={cmpB} setCmpA={setCmpA} setCmpB={setCmpB} currency={currency} groupNames={groupNames} />

      {detail && <MonthDetail series={series.find(s => s.id === detail)} currency={currency} onClose={() => setDetail(null)} onOpen={() => { onOpenMonth(detail); setDetail(null); }} isCurrent={detail === state.activeMonth} />}
    </div>
  );
}

/* comparison panel */
function Comparison({ series, cmpA, cmpB, setCmpA, setCmpB, currency, groupNames }) {
  const a = series.find(s => s.id === cmpA), b = series.find(s => s.id === cmpB);
  if (!a || !b) return null;
  const Sel = ({ value, onChange }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="btn btn-sm" style={{ paddingRight: 8 }}>
      {series.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
  const rows = [
    { label: "Income", a: a.income, b: b.income, good: "up" },
    { label: "Allocated", a: a.alloc, b: b.alloc, good: "flat" },
    { label: "Actual spent", a: a.actual, b: b.actual, good: "down" },
    { label: "Saved", a: a.savings, b: b.savings, good: "up" },
  ];
  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <Sel value={cmpA} onChange={setCmpA} />
        <Icons.right size={16} style={{ color: "var(--faint)" }} />
        <Sel value={cmpB} onChange={setCmpB} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {rows.map(r => {
          const delta = round2(r.b - r.a);
          const pct = r.a !== 0 ? Math.round((delta / r.a) * 100) : null;
          const positive = delta > 0;
          const goodDir = r.good === "up" ? positive : r.good === "down" ? !positive : Math.abs(delta) < 0.005;
          const neutral = Math.abs(delta) < 0.005;
          return (
            <div key={r.label} style={{ padding: "14px 16px", borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--hairline)" }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{r.label}</div>
              <div className="mono" style={{ fontSize: 19, fontWeight: 500, marginBottom: 6 }}>{fmt(currency, r.b, { cents: false })}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: neutral ? "var(--faint)" : goodDir ? "var(--accent-ink)" : "var(--neg-ink)" }}>
                {!neutral && (positive ? <Icons.up size={13} /> : <Icons.down size={13} />)}
                <span className="mono" style={{ fontWeight: 600 }}>{neutral ? "no change" : `${fmt(currency, Math.abs(delta), { cents: false })}${pct !== null ? ` · ${Math.abs(pct)}%` : ""}`}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* read-only month detail */
function MonthDetail({ series, currency, onClose, onOpen, isCurrent }) {
  const mo = series.mo;
  return (
    <Modal onClose={onClose} width={620}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h3 style={{ marginBottom: 2 }}>{monthLabel(series.id).mo} {monthLabel(series.id).yr}</h3>
          <p style={{ margin: 0 }}>Read-only summary · {series.overCount} item{series.overCount !== 1 ? "s" : ""} over budget</p>
        </div>
        <button className="icon-btn" onClick={onClose}><Icons.x size={18} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 18 }}>
        {[["Income", series.income], ["Allocated", series.alloc], ["Actual", series.actual], ["Saved", series.savings]].map(([l, v]) => (
          <div key={l} style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--hairline)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{l}</div>
            <div className="mono" style={{ fontSize: 15, fontWeight: 600, marginTop: 3 }}>{fmt(currency, v, { cents: false })}</div>
          </div>
        ))}
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto", margin: "0 -4px", paddingRight: 4 }}>
        {mo.groups.map(g => (
          <div key={g.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 13.5, padding: "6px 8px", background: "var(--surface-2)", borderRadius: 7 }}>
              <span>{g.name}{g.isSavings ? " · savings" : ""}</span>
              <span className="mono">{fmt(currency, groupActual(g), { cents: false })} / {fmt(currency, groupAllocated(g), { cents: false })}</span>
            </div>
            {g.items.map(it => { const act = itemActual(it); const over = act > it.allocated + 0.005; return (
              <div key={it.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px", gap: 8, padding: "5px 8px", fontSize: 13, borderBottom: "1px solid var(--hairline)" }}>
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

Object.assign(window, { HistoryScreen });
