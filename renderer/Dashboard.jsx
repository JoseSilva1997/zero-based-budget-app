/* ============================================================
   Dashboard screen - at-a-glance overview of spending & saving
   Trailing 12-month window; degrades gracefully with less data.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Alert, ChartCard, EmptyState, Icons, PageHeader } from './ui/index.js';
import { useStore } from './store.jsx';
import { BudgetAccuracyChart, CumulativeSavingsChart, GroupSpendChart, SavingsChart, SpendingTiming } from './DashboardCharts.jsx';
import { DashboardCards } from './DashboardCards.jsx';
import { buildContext, normaliseCards } from './lib/dashboardStats.js';
import { cx } from './lib/index.js';

/* The current calendar month, "YYYY-MM": the cards count the months before
   it as finished. */
function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function DashboardScreen({ currency, onOpenMonth }) {
  const { state, dispatch, trends, categories } = useStore();
  const [allSeries, setAllSeries] = useState([]);
  const [editing, setEditing] = useState(false);
  // Names the groups and categories a card can look at. A failure here only
  // costs those names (such a card shows a dash), so it is logged, not shown.
  const [catList, setCatList] = useState([]);
  useEffect(() => {
    let live = true;
    categories()
      .then((list) => { if (live) setCatList(list); })
      .catch((err) => console.error("category:list failed", err));
    return () => { live = false; };
  }, [categories]);
  // An empty dashboard and a failed read look identical, so the failure is
  // kept and said out loud rather than passed off as "no data yet".
  const [loadError, setLoadError] = useState(null);
  // SQL-computed per-month series; refetched whenever this screen mounts.
  useEffect(() => {
    let live = true;
    trends()
      .then((s) => { if (live) { setAllSeries(s); setLoadError(null); } })
      .catch((err) => { console.error("trends:series failed", err); if (live) setLoadError(err.message || String(err)); });
    return () => { live = false; };
  }, [trends]);
  const series = useMemo(() => allSeries.slice(-12), [allSeries]);
  const ctx = useMemo(() => buildContext({ allSeries, now: thisMonth(), categories: catList }), [allSeries, catList]);
  const cards = normaliseCards(state && state.settings.dashboardCards);
  const hasAnyData = allSeries.some(s => s.actual > 0 || s.savings > 0);
  const windowLabel = series.length >= 2
    ? `${series[0].label} – ${series[series.length - 1].label}`
    : (series[0] ? series[0].label : "");

  return (
    <div className="fade-in">
      {/* The window is the only thing in the sub-line the figures below don't
          already say. */}
      <PageHeader title="Dashboard" sub={windowLabel || "No months tracked yet"}
        actions={(
          <button type="button" data-edit-cards aria-pressed={editing}
            className={cx("btn btn-sm", editing && "btn-primary")} onClick={() => setEditing((on) => !on)}>
            {editing ? "Done" : <><Icons.edit size={14} /> Edit cards</>}
          </button>
        )} />

      {loadError && (
        <Alert banner>Your months couldn't be read, so this overview is empty rather than complete. {loadError}</Alert>
      )}

      {/* 1. the cards the household picks and arranges */}
      <DashboardCards cards={cards} ctx={ctx} currency={currency} editing={editing}
        onChange={(next) => dispatch({ type: "updateSettings", patch: { dashboardCards: next } })} />

      {!hasAnyData ? (
        <EmptyState icon={Icons.monitor} title="Your overview will appear here" className="dash-empty">
          Enter a month's actual spending and savings, and the dashboard will start charting your trends and habits over time.
        </EmptyState>
      ) : (
        <div className="dash-grid">
          {/* Each card's title carries the whole of what the card is, so `sub`
              is only spent on the two conventions a title cannot state: what
              the second series is, and what the row of months underneath
              does. */}

          {/* 2. savings over time, beside where the spending went. The bars
              need the width more than the pie, so the pair is split 3:2. */}
          <div className="dash-pair">
            <ChartCard title="Saved each month" sub="Month labels open that month.">
              <SavingsChart series={series} currency={currency} onOpenMonth={onOpenMonth} />
            </ChartCard>
            <ChartCard title="Spending by group" sub="Savings are not counted as spending.">
              <GroupSpendChart series={series} ctx={ctx} currency={currency} now={thisMonth()} />
            </ChartCard>
          </div>

          {/* 3. cumulative savings by goal */}
          <ChartCard title="Savings by goal, adding up" wide>
            <CumulativeSavingsChart series={series} currency={currency} onOpenMonth={onOpenMonth} />
          </ChartCard>

          {/* 4. budget accuracy */}
          <ChartCard title="Planned against spent" sub="Outlined bar is the plan, solid is what went out." wide>
            <BudgetAccuracyChart series={series} currency={currency} onOpenMonth={onOpenMonth} />
          </ChartCard>

          {/* 5. spending timing (de-emphasised) */}
          <ChartCard title="When money leaves in the month" wide>
            <SpendingTiming series={series} currency={currency} />
          </ChartCard>
        </div>
      )}
    </div>
  );
}

export { DashboardScreen };
