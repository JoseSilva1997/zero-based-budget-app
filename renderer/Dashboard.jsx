/* ============================================================
   Dashboard screen - at-a-glance overview of spending & saving
   Trailing 12-month window; degrades gracefully with less data.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { ChartCard, Icons } from './components.jsx';
import { useStore } from './store.jsx';
import { BudgetAccuracyChart, CategoryTrends, CumulativeSavingsChart, HeadlineStats, SavingsChart, SpendingTiming } from './DashboardCharts.jsx';

function DashboardScreen({ currency, onOpenMonth }) {
  const { trends } = useStore();
  const [allSeries, setAllSeries] = useState([]);
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
  const hasAnyData = allSeries.some(s => s.actual > 0 || s.savings > 0);
  const windowLabel = series.length >= 2
    ? `${series[0].label} – ${series[series.length - 1].label}`
    : (series[0] ? series[0].label : "");

  return (
    <div className="fade-in">
      <div className="topbar">
        <div>
          <div className="page-title">Dashboard</div>
          {/* The window is the only thing here the figures below don't already
              say. "Overview of your spending & saving habits" described the
              screen to someone already looking at it. */}
          <div className="page-sub">{windowLabel || "No months tracked yet"}</div>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="dash-error">
          <Icons.alert size={16} className="dash-error-icon" />
          <span>Your months couldn't be read, so this overview is empty rather than complete. {loadError}</span>
        </div>
      )}

      {/* 1. headline stats */}
      <HeadlineStats allSeries={allSeries} series={series} currency={currency} />

      {!hasAnyData ? (
        <div className="panel empty dash-empty">
          <div className="empty-icon"><Icons.monitor size={22} /></div>
          <div className="dash-empty-title">Your overview will appear here</div>
          <div className="dash-empty-note">Enter a month's actual spending and savings, and the dashboard will start charting your trends and habits over time.</div>
        </div>
      ) : (
        /* Why the row is `align-items: start` and why the gaps are wider than
           the old card grid needed moved with the rules onto .dash-grid in
           styles/charts.css. */
        <div className="dash-grid">
          {/* Each card's title now carries the whole of what the card is. The
              explainer line under every one of them ("What you set aside each
              month, and how much of your income that was", "Your nest egg
              growing over time…") was six sentences of narration on one
              screen, describing charts that are already labelled and already
              legible. `sub` survives on the two cards where a real convention
              needs stating: what the second series is, and what the row of
              months underneath does. */}

          {/* 2. savings over time. The month labels under these charts are
              buttons: seeing a bad month and being able to open it are the
              same gesture, so that one is worth saying once. */}
          <ChartCard title="Saved each month" sub="Month labels open that month.">
            <SavingsChart series={series} currency={currency} onOpenMonth={onOpenMonth} />
          </ChartCard>

          {/* 6. category trends. Stretched to the savings chart's row height
              so the two cards' bottom rules land on the same line. */}
          <ChartCard title="Category trends" stretch>
            <CategoryTrends series={series} currency={currency} />
          </ChartCard>

          {/* 4. cumulative savings by goal */}
          <ChartCard title="Savings by goal, adding up" wide>
            <CumulativeSavingsChart series={series} currency={currency} onOpenMonth={onOpenMonth} />
          </ChartCard>

          {/* 5. budget accuracy */}
          <ChartCard title="Planned against spent" sub="Outlined bar is the plan, solid is what went out." wide>
            <BudgetAccuracyChart series={series} currency={currency} onOpenMonth={onOpenMonth} />
          </ChartCard>

          {/* 7. spending timing (de-emphasised) */}
          <ChartCard title="When money leaves in the month" wide>
            <SpendingTiming series={series} currency={currency} />
          </ChartCard>
        </div>
      )}
    </div>
  );
}

export { DashboardScreen };
