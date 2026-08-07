/* ============================================================
   Dashboard chart toolkit - Recharts widgets + shared tooltip
   ============================================================ */
import { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
         AreaChart, Area, ComposedChart, Line, LabelList } from 'recharts';
import { Icons } from './components.jsx';
import { GROUP_PALETTE, fmt, round2 } from './lib/index.js';

/* short "Jan" style x-axis label from a "Jan 2025" series label */
const shortMo = (label) => String(label).split(" ")[0];

/* compact money tick: $1.2k / $480 */
function abbrMoney(v, c = "$") {
  if (Math.abs(v) >= 1000) return `${c}${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `${c}${Math.round(v)}`;
}

/* shared axis styling so every chart matches the dark theme */
const axisProps = { stroke: "var(--rule-faint)", tick: { fill: "var(--faint)", fontSize: 11 }, tickLine: false };
const gridProps = { stroke: "var(--rule-faint)", strokeDasharray: "0", vertical: false };

/* themed tooltip - mirrors the dark var(--ink) box from Charts.jsx.
   Recharts injects { active, payload, label }; extra props are passed by us. */
function DashTooltip(props) {
  const { active, payload, label, currency = "$", heading, rows, hideZero } = props;
  if (!active || !payload || !payload.length) return null;
  const title = heading ? heading(label, payload) : label;
  let list = rows
    ? rows(payload, label)
    : payload.map(p => ({ label: p.name, color: p.color || p.fill, value: fmt(currency, p.value || 0, { cents: false }) }));
  if (hideZero) list = list.filter(r => r.raw == null ? true : r.raw > 0);
  return (
    <div style={{ background: "var(--ink)", color: "var(--on-ink)", padding: "7px 10px", borderRadius: 8, fontSize: 12, boxShadow: "var(--shadow-md)", whiteSpace: "nowrap", pointerEvents: "none" }}>
      <div style={{ fontWeight: 600, marginBottom: list.length ? 4 : 0 }}>{title}</div>
      {list.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, opacity: 0.95, fontVariantNumeric: "tabular-nums" }}>
          {r.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color }} />}
          <span style={{ opacity: 0.75 }}>{r.label}</span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)" }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/* small muted placeholder used inside a ChartCard when data is too thin */
function ChartEmpty({ note }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "0 20px" }}>{note}</div>;
}

const colorOf = (names, name) => GROUP_PALETTE[Math.max(0, names.indexOf(name)) % GROUP_PALETTE.length];

/* A shape carries no name, so each chart body is labelled with what it says.
   role="img" because the SVG below it is one picture, not a set of nodes to
   walk; the month buttons underneath sit outside it and stay reachable. */
function ChartBody({ summary, children }) {
  return <div role="img" aria-label={summary}>{children}</div>;
}

/* ---- month axis ---------------------------------------------------------
   A month that looks wrong on a chart is exactly the month you then want to
   open, and until now there was no way through: the marks were paint. The x
   labels are therefore real buttons, focusable and operable from the keyboard,
   and they take the app's focus ring for free.

   The row is padded to the chart's own plot area (the y-axis width on the
   left, the chart margin on the right) so each label still sits under its
   mark. `spread` follows how the chart places its points: bars are centred in
   a band, an area's points sit on the plot edges. */
const PLOT_LEFT = 48;  // YAxis width
const PLOT_RIGHT = 8;  // chart margin.right
const TICK_W = 40;     // fixed label width, so the edge labels can be centred

function MonthTick({ month, onOpenMonth, style }) {
  const [hot, setHot] = useState(false);
  return (
    <button type="button" onClick={() => onOpenMonth(month.id)}
      onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)}
      title={`Open ${month.label} in Month Budget`}
      aria-label={`Open ${month.label} in Month Budget`}
      style={{
        minWidth: 0, padding: "3px 0", border: 0, borderRadius: 6, background: "transparent",
        font: "inherit", fontSize: 11, lineHeight: 1.4, cursor: "pointer",
        color: hot ? "var(--ink)" : "var(--faint)",
        textDecoration: hot ? "underline" : "none",
        ...style,
      }}>
      {shortMo(month.label)}
    </button>
  );
}

function MonthAxis({ series, onOpenMonth, spread }) {
  if (!series.length || typeof onOpenMonth !== "function") return null;
  const box = { display: "flex", paddingLeft: PLOT_LEFT, paddingRight: PLOT_RIGHT, marginTop: 2 };
  const style = spread
    ? { ...box, justifyContent: "space-between", marginLeft: -TICK_W / 2, marginRight: -TICK_W / 2 }
    : box;
  return (
    <div style={style}>
      {series.map((m) => (
        <MonthTick key={m.id} month={m} onOpenMonth={onOpenMonth}
          style={spread ? { width: TICK_W, flex: "none" } : { flex: "1 1 0" }} />
      ))}
    </div>
  );
}

/* Where the buttons are drawn, recharts is told not to paint its own labels;
   with no handler to wire them to, its labels stay. */
const mutedAxis = { ...axisProps, tick: false, height: 8 };
const axisFor = (onOpenMonth) => (typeof onOpenMonth === "function" ? mutedAxis : axisProps);

const span = (series) => (series.length > 1
  ? `${series[0].label} to ${series[series.length - 1].label}`
  : series[0] ? series[0].label : "");

/* ---- 1. headline stats row --------------------------------------------- */
function HeadlineStats({ allSeries, series, currency }) {
  const totalSaved = round2(allSeries.reduce((a, s) => a + s.savings, 0));
  const withIncome = allSeries.filter(s => s.income > 0);
  const avgRate = withIncome.length ? Math.round(withIncome.reduce((a, s) => a + s.savings / s.income, 0) / withIncome.length * 100) : null;
  const avgSpend = series.length ? round2(series.reduce((a, s) => a + s.actual, 0) / series.length) : 0;
  const monthsTracked = allSeries.length;
  const hasActuals = allSeries.some(s => s.actual > 0);

  const cards = [
    { label: "Total saved", value: fmt(currency, totalSaved, { cents: false }), sub: "all time" },
    { label: "Avg savings rate", value: avgRate == null ? "n/a" : `${avgRate}%`, sub: "of income" },
    { label: "Avg monthly spend", value: fmt(currency, avgSpend, { cents: false }), sub: "last 12 mo" },
    { label: "Months tracked", value: String(monthsTracked), sub: monthsTracked === 1 ? "month" : "months" },
  ];

  return (
    <div>
      {!hasActuals && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>Track a month to see your overview build up here.</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {cards.map(c => (
          <div key={c.label} style={{ padding: "14px 16px", borderRadius: 12, background: "var(--board)", border: "1px solid var(--rule-faint)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{c.label}</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 500 }}>{c.value}</div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 4 }}>{c.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- 2. savings over time (amount + rate% label) ------------------------ */
function SavingsChart({ series, currency, onOpenMonth }) {
  if (!series.length) return <ChartEmpty note="No months tracked yet." />;
  const data = series.map(m => {
    const rate = m.income > 0 ? Math.round((m.savings / m.income) * 100) : null;
    return { name: shortMo(m.label), saved: m.savings, rate, rateLabel: rate == null ? "n/a%" : `${rate}%` };
  });
  const best = series.reduce((a, m) => (m.savings > a.savings ? m : a), series[0]);
  const worst = series.reduce((a, m) => (m.savings < a.savings ? m : a), series[0]);
  const total = round2(series.reduce((a, m) => a + m.savings, 0));
  const summary = `Bar chart of savings for ${series.length} month${series.length === 1 ? "" : "s"}, ${span(series)}. `
    + `Most saved in ${best.label} at ${fmt(currency, best.savings, { cents: false })}, least in ${worst.label} at ${fmt(currency, worst.savings, { cents: false })}. `
    + `${fmt(currency, total, { cents: false })} over the window.`;
  return (
    <>
      <ChartBody summary={summary}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 22, right: PLOT_RIGHT, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisFor(onOpenMonth)} />
            <YAxis {...axisProps} tickFormatter={(v) => abbrMoney(v, currency)} width={PLOT_LEFT} />
            <Tooltip cursor={{ fill: "var(--well)", opacity: 0.4 }} content={
              <DashTooltip currency={currency} rows={(p) => {
                const d = p[0] && p[0].payload;
                return [
                  { label: "Saved", color: GROUP_PALETTE[0], value: fmt(currency, d.saved, { cents: false }) },
                  { label: "Rate", value: d.rateLabel },
                ];
              }} />
            } />
            <Bar dataKey="saved" name="Saved" fill={GROUP_PALETTE[0]} radius={[4, 4, 0, 0]}>
              <LabelList dataKey="rateLabel" position="top" fill="var(--faint)" fontSize={10.5} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartBody>
      <MonthAxis series={series} onOpenMonth={onOpenMonth} />
    </>
  );
}

/* ---- 4. cumulative savings by goal (stacked area) ---------------------- */
function CumulativeSavingsChart({ series, currency, onOpenMonth }) {
  const cats = [];
  series.forEach(s => Object.keys(s.savingsByCat).forEach(n => { if (!cats.includes(n)) cats.push(n); }));
  if (!cats.length) return <ChartEmpty note="Mark a group as savings to track your goals here." />;
  const running = {};
  const data = series.map(m => {
    const row = { name: shortMo(m.label) };
    cats.forEach(c => { running[c] = round2((running[c] || 0) + (m.savingsByCat[c] || 0)); row[c] = running[c]; });
    return row;
  });
  const ranked = cats.map(c => ({ c, total: running[c] || 0 })).sort((a, b) => b.total - a.total);
  const grand = round2(ranked.reduce((a, r) => a + r.total, 0));
  const named = ranked.slice(0, 3).map(r => `${r.c} ${fmt(currency, r.total, { cents: false })}`).join(", ");
  const summary = `Stacked area chart of savings adding up over ${span(series)}, `
    + `reaching ${fmt(currency, grand, { cents: false })} across ${cats.length} goal${cats.length === 1 ? "" : "s"}. `
    + `Largest: ${named}.`;
  return (
    <>
      <ChartBody summary={summary}>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ top: 8, right: PLOT_RIGHT, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisFor(onOpenMonth)} />
            <YAxis {...axisProps} tickFormatter={(v) => abbrMoney(v, currency)} width={PLOT_LEFT} />
            <Tooltip content={
              <DashTooltip currency={currency} hideZero rows={(p) => p.map(r => ({ label: r.name, color: r.color || r.stroke, raw: r.value, value: fmt(currency, r.value || 0, { cents: false }) }))} />
            } />
            {cats.map(c => (
              <Area key={c} dataKey={c} name={c} stackId="s" stroke={colorOf(cats, c)} fill={colorOf(cats, c)} fillOpacity={0.82} strokeWidth={1} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </ChartBody>
      {/* an area's points sit on the plot edges, not in the middle of a band */}
      <MonthAxis series={series} onOpenMonth={onOpenMonth} spread />
    </>
  );
}

/* ---- 5. budget accuracy: alloc vs actual + chronic offenders ----------- */
function BudgetAccuracyChart({ series, currency, onOpenMonth }) {
  const data = series.map(m => ({ name: shortMo(m.label), alloc: m.alloc, actual: m.actual }));
  // chronic offenders: how many of the trailing months each group·item ran over
  const freq = {};
  series.forEach(s => s.over.forEach(o => {
    const k = `${o.group} · ${o.item}`;
    if (!freq[k]) freq[k] = { count: 0, totalOver: 0 };
    freq[k].count += 1; freq[k].totalOver = round2(freq[k].totalOver + o.over);
  }));
  const offenders = Object.entries(freq)
    .map(([k, v]) => ({ k, count: v.count, avgOver: round2(v.totalOver / v.count) }))
    .sort((a, b) => b.count - a.count || b.avgOver - a.avgOver)
    .slice(0, 6);
  const n = series.length;
  const overspent = series.filter(m => m.actual > m.alloc + 0.005).length;
  const summary = `Bar chart of allocated against actual for ${n} month${n === 1 ? "" : "s"}, ${span(series)}. `
    + (overspent === 0 ? "Actual stayed within the allocation every month." : `Actual came in over the allocation in ${overspent} of them.`);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 24, alignItems: "stretch" }}>
      <div>
        {series.length ? (
          <>
            <ChartBody summary={summary}>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data} margin={{ top: 8, right: PLOT_RIGHT, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="name" {...axisFor(onOpenMonth)} />
                  <YAxis {...axisProps} tickFormatter={(v) => abbrMoney(v, currency)} width={PLOT_LEFT} />
                  <Tooltip cursor={{ fill: "var(--well)", opacity: 0.4 }} content={<DashTooltip currency={currency} />} />
                  <Bar dataKey="alloc" name="Allocated" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="actual" name="Actual" fill={GROUP_PALETTE[2]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartBody>
            <MonthAxis series={series} onOpenMonth={onOpenMonth} />
          </>
        ) : <ChartEmpty note="No months tracked yet." />}
      </div>
      <div>
        <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--faint)", fontWeight: 600, marginBottom: 8 }}>Chronically over budget</div>
        {offenders.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
            <Icons.check size={14} style={{ color: "var(--accent)", flex: "none" }} /> Nothing has run over budget.
          </div>
        ) : offenders.map(o => (
          <div key={o.k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--rule-faint)" }}>
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.k}</div>
              <div style={{ fontSize: 11, color: "var(--faint)" }}>over in {o.count} of {n} {n === 1 ? "month" : "months"} · avg {fmt(currency, o.avgOver, { cents: false })}</div>
            </div>
            <span className="pill pill-breach" style={{ flex: "none" }}>{o.count}×</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- 6. category trends: recent vs earlier average --------------------- */
function CategoryTrends({ series, currency }) {
  const n = series.length;
  if (n < 2) return <ChartEmpty note="Trends appear once you've tracked a second month." />;
  const half = Math.floor(n / 2);
  const earlier = series.slice(0, half);
  const recent = series.slice(n - half);
  const names = [];
  series.forEach(s => Object.keys(s.byGroup).forEach(g => { if (!names.includes(g)) names.push(g); }));
  const avg = (slice, g) => slice.reduce((a, s) => a + (s.byGroup[g] || 0), 0) / slice.length;
  const rows = names.map(g => {
    const e = avg(earlier, g), r = avg(recent, g);
    const isNew = e <= 0.005;
    const pct = isNew ? null : Math.round(((r - e) / e) * 100);
    return { g, e, r, isNew, pct, abs: pct == null ? (r > 0 ? Infinity : 0) : Math.abs(pct) };
  }).filter(row => row.r > 0 || row.e > 0)
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 6);
  if (!rows.length) return <ChartEmpty note="No spending recorded yet." />;
  const rising = rows.filter(r => r.isNew || r.pct > 0).length;
  const falling = rows.filter(r => !r.isNew && r.pct < 0).length;
  const summary = `${rows.length} categor${rows.length === 1 ? "y" : "ies"} ranked by change, the last ${half} month${half === 1 ? "" : "s"} against the ${half} before: `
    + `${rising} spending more, ${falling} spending less.`;
  return (
    <div role="group" aria-label={summary}>
      {rows.map(row => {
        const up = row.isNew ? true : row.pct > 0;
        const flat = !row.isNew && row.pct === 0;
        // A trend that moved is not by itself good or bad in this domain: only a
        // genuine over-budget condition earns a hue, and this is just direction.
        const color = flat ? "var(--faint)" : "var(--ink-2)";
        return (
          <div key={row.g} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--rule-faint)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
              <span style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.g}</span>
              {row.isNew && <span className="pill pill-neutral" style={{ fontSize: 10, flex: "none" }}>new</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="mono" style={{ fontSize: 12, color: "var(--faint)" }}>{fmt(currency, row.r, { cents: false })}/mo</span>
              <span style={{ display: "flex", alignItems: "center", gap: 3, color, fontSize: 13, fontWeight: 600, minWidth: 58, justifyContent: "flex-end" }}>
                {row.isNew ? "new" : (
                  <>
                    {!flat && (up ? <Icons.up size={14} /> : <Icons.down size={14} />)}
                    <span className="mono">{flat ? "0%" : `${Math.abs(row.pct)}%`}</span>
                  </>
                )}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---- 7. spending timing: avg spend by day-of-month --------------------- */
function SpendingTiming({ series, currency }) {
  const months = series.length;
  if (!months) return <ChartEmpty note="No months tracked yet." />;
  const totals = new Array(32).fill(0); // index 1..31
  let anySpend = false;
  // byDay is the SQL-computed per-day spend for each month (dollars).
  series.forEach(m => {
    const bd = m.byDay || [];
    for (let d = 1; d <= 31; d++) {
      const v = bd[d] || 0;
      if (v > 0) { totals[d] = round2(totals[d] + v); anySpend = true; }
    }
  });
  if (!anySpend) return <ChartEmpty note="No dated spending yet. Add some actuals to see when money goes out." />;
  let cum = 0;
  const data = [];
  for (let d = 1; d <= 31; d++) {
    const avgDay = round2(totals[d] / months);
    cum = round2(cum + avgDay);
    data.push({ day: d, avg: avgDay, cum });
  }
  const busiest = data.reduce((a, r) => (r.avg > a.avg ? r : a), data[0]);
  const halfway = data.find(r => r.cum >= cum / 2);
  const summary = `Chart of average spend by day of the month across ${months} month${months === 1 ? "" : "s"}. `
    + `The heaviest day is the ${busiest.day}th at ${fmt(currency, busiest.avg, { cents: false })}. `
    + `Half of a typical month's spending has gone out by day ${halfway ? halfway.day : 31}.`;
  return (
    <ChartBody summary={summary}>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 8, right: PLOT_RIGHT, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="day" {...axisProps} interval={2} />
          <YAxis {...axisProps} tickFormatter={(v) => abbrMoney(v, currency)} width={PLOT_LEFT} />
          <Tooltip cursor={{ fill: "var(--well)", opacity: 0.4 }} content={
            <DashTooltip currency={currency} heading={(d) => `Day ${d}`} rows={(p) => {
              const d = p[0] && p[0].payload;
              return [
                { label: "Avg spend", color: "var(--muted)", value: fmt(currency, d.avg, { cents: false }) },
                { label: "Cumulative", color: GROUP_PALETTE[6], value: fmt(currency, d.cum, { cents: false }) },
              ];
            }} />
          } />
          <Bar dataKey="avg" name="Avg spend" fill="var(--muted)" radius={[2, 2, 0, 0]} />
          <Line type="monotone" dataKey="cum" name="Cumulative" stroke={GROUP_PALETTE[6]} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartBody>
  );
}

export {
  DashTooltip, ChartEmpty, HeadlineStats, SavingsChart,
  CumulativeSavingsChart, BudgetAccuracyChart, CategoryTrends, SpendingTiming,
};
