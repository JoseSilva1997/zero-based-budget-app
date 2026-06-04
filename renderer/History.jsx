/* ============================================================
   History screen — month list, comparison, trends (charts)
   ============================================================ */

function buildSeries(state) {
  return state.order.map(id => {
    const mo = state.months[id];
    const byGroup = {};
    mo.groups.forEach(g => { byGroup[g.name] = round2((byGroup[g.name] || 0) + groupActual(g)); });
    // savings allocated per category (item name) for this month
    const savingsByCat = {};
    mo.groups.filter(g => g.isSavings).forEach(g => g.items.forEach(it => {
      savingsByCat[it.name] = round2((savingsByCat[it.name] || 0) + it.allocated);
    }));
    const over = overBudgetItems(mo);
    return {
      id, label: monthLabel(id).short, mo,
      income: monthIncome(mo), alloc: monthAllocated(mo), actual: monthActual(mo),
      savings: monthSavings(mo), byGroup, savingsByCat, overCount: over.length, over,
    };
  });
}

function HistoryScreen({ state, dispatch, currency, onOpenMonth }) {
  const series = useMemo(() => buildSeries(state), [state]);
  const enough = series.length >= 2;
  const groupNames = useMemo(() => {
    const set = []; series.forEach(s => Object.keys(s.byGroup).forEach(n => { if (!set.includes(n)) set.push(n); })); return set;
  }, [series]);
  // cumulative savings (total + per category, for stacked area)
  const savingsCats = useMemo(() => {
    const set = []; series.forEach(s => Object.keys(s.savingsByCat).forEach(n => { if (!set.includes(n)) set.push(n); })); return set;
  }, [series]);
  const cum = useMemo(() => {
    const running = {}; let runTotal = 0;
    return series.map(s => {
      const cumByCat = {};
      savingsCats.forEach(c => { running[c] = round2((running[c] || 0) + (s.savingsByCat[c] || 0)); cumByCat[c] = running[c]; });
      runTotal = round2(runTotal + s.savings);
      return { ...s, cumSavings: runTotal, cumByCat };
    });
  }, [series, savingsCats]);
  const [detail, setDetail] = useState(null);
  const [cmpA, setCmpA] = useState(series[Math.max(0, series.length - 2)]?.id);
  const [cmpB, setCmpB] = useState(series[series.length - 1]?.id);

  return (
    <div className="fade-in">
      <div className="topbar">
        <div>
          <div className="page-title">History &amp; trends</div>
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

      {/* trends */}
      <div className="section-head" style={{ marginTop: 36 }}><h2>Trends</h2></div>
      {!enough ? (
        <div className="card empty">
          <div className="empty-icon"><Icons.history size={22} /></div>
          <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>Charts unlock with two months</div>
          <div style={{ fontSize: 13, maxWidth: 320 }}>Once you've completed a second month, trends for income, spending, and savings will appear here and grow over time.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <ChartCard title="Spending by group" sub="Where the money actually goes, month over month." wide>
            <StackedBars months={series} groupNames={groupNames} currency={currency} />
          </ChartCard>
          <ChartCard title="Savings allocated per month" sub="How much you set aside each month.">
            <LineChart months={series} accessor={(m) => m.savings} label="Saved" color="var(--accent)" currency={currency} />
          </ChartCard>
          <ChartCard title="Cumulative savings by goal" sub="Your nest egg growing over time, split by what you're saving toward." wide>
            <StackedArea months={cum} cats={savingsCats} accessor={(m) => m.cumByCat} currency={currency} />
          </ChartCard>
          <ChartCard title="Over-budget items per month" sub="How often spending broke through the allocation." wide>
            <OverBudgetChart series={series} currency={currency} />
          </ChartCard>
        </div>
      )}

      {detail && <MonthDetail series={series.find(s => s.id === detail)} currency={currency} onClose={() => setDetail(null)} onOpen={() => { onOpenMonth(detail); setDetail(null); }} isCurrent={detail === state.activeMonth} />}
    </div>
  );
}

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

/* over-budget frequency: bars of count + offender list */
function OverBudgetChart({ series, currency }) {
  const freq = {};
  series.forEach(s => s.over.forEach(o => { const k = `${o.group} · ${o.item}`; freq[k] = (freq[k] || 0) + 1; }));
  const offenders = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCount = Math.max(...series.map(s => s.overCount), 1);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150, paddingTop: 10 }}>
        {series.map(s => (
          <div key={s.id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, height: "100%", justifyContent: "flex-end" }}>
            <span className="mono" style={{ fontSize: 12, color: s.overCount ? "var(--neg-ink)" : "var(--faint)", fontWeight: 600 }}>{s.overCount || "0"}</span>
            <div title={`${s.overCount} over budget`} style={{ width: "100%", maxWidth: 38, height: `${(s.overCount / maxCount) * 100}%`, minHeight: s.overCount ? 6 : 2, borderRadius: 5, background: s.overCount ? "var(--neg)" : "var(--surface-sunken)", transition: "height .3s" }} />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{s.label.split(" ")[0]}</span>
          </div>
        ))}
      </div>
      <div>
        <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--faint)", fontWeight: 600, marginBottom: 8 }}>Most frequent offenders</div>
        {offenders.length === 0 ? <div style={{ fontSize: 13, color: "var(--muted)" }}>No items have gone over budget. 🎉</div> : offenders.map(([k, n]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--hairline)" }}>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
            <span className="pill pill-neg" style={{ flex: "none" }}>{n}×</span>
          </div>
        ))}
      </div>
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
