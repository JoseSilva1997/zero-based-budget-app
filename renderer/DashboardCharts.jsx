/* ============================================================
   Dashboard chart toolkit - Recharts widgets + shared tooltip
   ============================================================ */
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
         AreaChart, Area, ComposedChart, Line, LabelList } from 'recharts';
import { Icons } from './components.jsx';
import { GROUP_PALETTE, cx, fmt, round2 } from './lib/index.js';

/* short "Jan" style x-axis label from a "Jan 2025" series label */
const shortMo = (label) => String(label).split(" ")[0];

/* compact money tick: $1.2k / $480 */
function abbrMoney(v, c = "$") {
  if (Math.abs(v) >= 1000) return `${c}${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return `${c}${Math.round(v)}`;
}

/* shared axis styling so every chart matches the dark theme. No axis spines
   at all - the plot hangs in space and ChartCard's own rules frame it - and
   the gridlines are cut to a wash of the faintest rule so they sit behind
   the data instead of beside it. */
const axisProps = { axisLine: false, tick: { fill: "var(--faint)", fontSize: 11 }, tickLine: false };
const gridProps = { stroke: "color-mix(in srgb, var(--rule-faint) 30%, transparent)", strokeDasharray: "0", vertical: false };

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
    <div className="dash-tip">
      <div className={cx("dash-tip-title", !list.length && "is-alone")}>{title}</div>
      {list.map((r, i) => (
        <div key={i} className="dash-tip-row">
          {r.color && <span className="dash-tip-dot" style={{ background: r.color }} />}
          <span className="dash-tip-label">{r.label}</span>
          <span className="dash-tip-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/* Placeholder for a card whose data is too thin to draw. Left-aligned and
   short, not centred in a 120px well: a sentence floating in the middle of an
   empty box reads as a chart that failed to load, and next to a card that IS
   drawing something it left a large hole on the screen. It sits where the
   chart's first row of ink would have been instead. */
function ChartEmpty({ note }) {
  return <div className="chart-empty">{note}</div>;
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

/* The hover used to be React state driving two inline ternaries; it is
   .month-tick:hover in charts.css now. fontSize stays here because it is the
   same 11 axisProps hands recharts for its own ticks - one number with one
   home - and it is a presentation attribute on that side, so it cannot be a
   var(). */
function MonthTick({ month, onOpenMonth, style }) {
  return (
    <button type="button" className="month-tick" onClick={() => onOpenMonth(month.id)}
      title={`Open ${month.label} in Month Budget`}
      aria-label={`Open ${month.label} in Month Budget`}
      style={{ fontSize: 11, ...style }}>
      {shortMo(month.label)}
    </button>
  );
}

function MonthAxis({ series, onOpenMonth, spread }) {
  if (!series.length || typeof onOpenMonth !== "function") return null;
  /* Geometry, not decoration: these three lengths are how the row is squared
     up with the chart's own plot area, and each is read by a recharts prop as
     well (YAxis width, chart margin.right). Duplicating them into CSS would
     make the alignment two numbers that have to be kept equal by hand, so the
     arithmetic stays here and only the flex layout is a class. */
  const box = { paddingLeft: PLOT_LEFT, paddingRight: PLOT_RIGHT };
  const style = spread
    ? { ...box, marginLeft: -TICK_W / 2, marginRight: -TICK_W / 2 }
    : box;
  return (
    <div className={cx("month-axis", spread && "is-spread")} style={style}>
      {series.map((m) => (
        <MonthTick key={m.id} month={m} onOpenMonth={onOpenMonth}
          style={spread ? { width: TICK_W } : undefined} />
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

/* ---- 1. headline figures -----------------------------------------------
   Not four equal tiles in a row. That layout says every number here matters
   the same amount, which is never true, and it is the one arrangement every
   generated dashboard reaches for first. There is a single number a household
   actually opens this screen to see - what it has put aside - so that one is
   set large and unboxed, and the figures that qualify it run beneath it in a
   line, separated by rules rather than each sealed in its own card.

   "Months tracked" is gone entirely. It counted the app's own rows rather
   than the household's money, and the window it describes is already spelled
   out in the page subtitle. */
function HeadlineStats({ allSeries, series, currency }) {
  const totalSaved = round2(allSeries.reduce((a, s) => a + s.savings, 0));
  const withIncome = allSeries.filter(s => s.income > 0);
  const avgRate = withIncome.length ? Math.round(withIncome.reduce((a, s) => a + s.savings / s.income, 0) / withIncome.length * 100) : null;
  const avgSpend = series.length ? round2(series.reduce((a, s) => a + s.actual, 0) / series.length) : 0;
  const hasActuals = allSeries.some(s => s.actual > 0);

  const secondary = [
    { label: "Kept back", value: avgRate == null ? "—" : `${avgRate}%`, note: "of income, on average" },
    { label: "Spent", value: fmt(currency, avgSpend, { cents: false }), note: "in a typical month" },
  ];

  return (
    <div className="headline">
      {!hasActuals && (
        <div className="headline-note">Track a month to see your overview build up here.</div>
      )}
      {/* The arrangement's reasoning - one line rather than a stack, the
          hairline divider, the accent on the one figure that matters - moved
          with the rules into styles/charts.css. */}
      <div className="headline-row">
        <div className="headline-lead">
          <span className="num headline-figure">
            {fmt(currency, totalSaved, { cents: false })}
          </span>
          <span className="headline-caption">set aside, all time</span>
        </div>
        <div className="headline-secondary">
          {secondary.map((s) => (
            <div key={s.label}>
              <div className="num headline-stat-value">{s.value}</div>
              <div className="headline-stat-note">{s.label} {s.note}</div>
            </div>
          ))}
        </div>
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
                  { label: "Saved", color: "var(--accent)", value: fmt(currency, d.saved, { cents: false }) },
                  { label: "Rate", value: d.rateLabel },
                ];
              }} />
            } />
            {/* The accent, not a fixed green from the categorical palette. This
                is one series with no categories in it, so borrowing a slot from
                an eight-hue palette meant for group names only introduced a
                colour the household never chose. */}
            <Bar dataKey="saved" name="Saved" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={56}>
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
  /* An area needs two points to be an area. With one month recharts drew an
     empty 280px grid with a single dot floating in it, which reads as a chart
     that failed rather than one that has nothing to draw yet. */
  if (series.length < 2) return <ChartEmpty note="A second tracked month will start the line." />;
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
    <div className="accuracy-split">
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
                  {/* One hue, two weights, rather than two unrelated hues. This
                      used to be the accent against GROUP_PALETTE[1], a fixed
                      orange, so the pair read as two arbitrary colours from two
                      different systems sitting next to each other - the accent
                      the household had chosen, and an orange nothing else on the
                      screen used. Allocated is the plan and is drawn as an
                      outline; actual is the money that moved and is drawn solid.
                      That is the same "plan vs actual" encoding the item rows
                      already use, and it costs no second hue. */}
                  <Bar dataKey="alloc" name="Allocated" fill="var(--bar-plan)" stroke="var(--accent)" strokeWidth={1} radius={[3, 3, 0, 0]} maxBarSize={44} />
                  <Bar dataKey="actual" name="Actual" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </ChartBody>
            <MonthAxis series={series} onOpenMonth={onOpenMonth} />
          </>
        ) : <ChartEmpty note="No months tracked yet." />}
      </div>
      <div>
        {/* "Chronically over budget" was a diagnosis, and the thing being
            diagnosed is the household reading it. This says the same thing
            about the same rows without the verdict attached. */}
        <div className="eyebrow offender-head">Runs over most often</div>
        {offenders.length === 0 ? (
          <div className="offender-none">
            <Icons.check size={14} className="offender-none-icon" /> Nothing has run over budget.
          </div>
        ) : offenders.map(o => (
          <div key={o.k} className="offender-row">
            <div className="offender-text">
              <div className="offender-name truncate">{o.k}</div>
              <div className="offender-sub">over in {o.count} of {n} {n === 1 ? "month" : "months"} · avg {fmt(currency, o.avgOver, { cents: false })}</div>
            </div>
            <span className="pill pill-breach offender-count">{o.count}×</span>
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
        // Why a moved trend is not painted as a verdict, and why a flat 0%
        // stays faint, moved with the colours onto .trend-delta in
        // styles/charts.css.
        return (
          <div key={row.g} className="trend-row">
            <div className="trend-left">
              <span className="trend-name">{row.g}</span>
              {row.isNew && <span className="pill pill-neutral trend-new">new</span>}
            </div>
            <div className="trend-right">
              <span className="num trend-amount">{fmt(currency, row.r, { cents: false })}/mo</span>
              <span className={cx("trend-delta", flat && "is-flat")}>
                {row.isNew ? "new" : (
                  <>
                    {!flat && (up ? <Icons.up size={14} /> : <Icons.down size={14} />)}
                    <span className="num">{flat ? "0%" : `${Math.abs(row.pct)}%`}</span>
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
                { label: "Cumulative", color: "var(--accent)", value: fmt(currency, d.cum, { cents: false }) },
              ];
            }} />
          } />
          <Bar dataKey="avg" name="Avg spend" fill="var(--muted)" radius={[2, 2, 0, 0]} />
          <Line type="monotone" dataKey="cum" name="Cumulative" stroke="var(--accent)" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartBody>
  );
}

export {
  DashTooltip, ChartEmpty, HeadlineStats, SavingsChart,
  CumulativeSavingsChart, BudgetAccuracyChart, CategoryTrends, SpendingTiming,
};
