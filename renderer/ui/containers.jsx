/* ============================================================
   Containers: the boxes a screen puts its content inside.
   ============================================================ */
import { cx } from '../lib/index.js';

/* ---- chart card (Dashboard) ---------------------------------------------
   No .panel, no box: a chart is ink on the board, not furniture in a frame.
   What frames it instead is a pair of horizontal rules: a top hairline that
   is strongest at the centre and dissolves toward both edges, and a flat
   faint rule under the chart's own labels, standing in for the axis spines the
   charts themselves do not draw. */
/* `stretch` opts a card out of the grid's alignItems: start so it fills its
   row's full height, with the bordered content area absorbing the slack -
   used when a short list sits beside a fixed-height chart and their bottom
   rules should land on the same line. */
function ChartCard({ title, sub, children, wide, stretch }) {
  return (
    <div className={cx("fade-in chart-card", wide && "is-wide", stretch && "is-stretch")}>
      <div aria-hidden="true" className="chart-rule" />
      <div className="chart-head">
        <div className="chart-title">{title}</div>
        {sub && <div className="chart-sub">{sub}</div>}
      </div>
      <div className="chart-body">
        {children}
      </div>
    </div>
  );
}

export { ChartCard };
