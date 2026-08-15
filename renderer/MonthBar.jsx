/* ============================================================
   The month bar. One object for the whole month's money.

   The track starts hollow and allocating fills it. Every fill starts at the
   track's left edge and they sit one inside another: solid accent is money
   that actually moved, the half-strength pill it sits inside is money that
   has a job on paper but has not gone yet, and bare track past the end of
   that pill is money with no job. One hue at two weights, and no fill carries
   an edge: the only line is the track's own outline, running unbroken around
   the whole bar so the stretch with nothing behind it reads hollow. Solid
   inside the plan, plan inside the
   track, so both failure states are the same visual event at two scales:
   something sticking out past what should contain it. That is why nothing
   here is green - finishing is marked by the track filling up, not by a
   colour arriving.

   Nor is anything here amber any more. The unallocated remainder used to be
   painted --unsettled on the reasoning that money without a job is a nag,
   which meant a month opened on the 1st as a bar that was almost entirely
   warning about a budget nobody had had the chance to write yet. Absence is
   the better signal: an empty vessel already reads as one that wants
   filling, and it costs the page its loudest colour, which now belongs to
   the breach alone.
   ============================================================ */
import { Icons } from './components.jsx';
import { barGeometry, barRegions, fmt, monthActual, monthAllocated, monthIncome, monthUnallocated, overBudgetItems, round2 } from './lib/index.js';
import { focusAllocated } from './MonthGroups.jsx';

/* overBudgetItems reports names; routing to the row that fixes one needs its
   id, so the reported rows are paired back to the tree by group and item name.
   Two items with the same name in one group route to the first of them, which
   is the right kind of wrong. Moved here verbatim from SummaryHero. */
function withRowIds(mo, over) {
  const byName = new Map();
  mo.groups.forEach((g) => g.items.forEach((it) => {
    const key = `${g.name}::${it.name}`;
    if (!byName.has(key)) byName.set(key, { id: it.id, groupId: g.id });
  }));
  return over.map((o) => ({ ...o, ...(byName.get(`${o.group}::${o.item}`) || {}) }));
}
function sumOver(over) { return round2(over.reduce((a, o) => a + o.over, 0)); }

/* Hatch rather than a flat fill for both breaches, so colour is never the
   only signal. Same reasoning as MiniBar. */
const hatch = (c) => `repeating-linear-gradient(-45deg, var(${c}) 0 3px, color-mix(in srgb, var(${c}) 45%, var(--well)) 3px 6px)`;
/* Flat paints are gradients too, so every entry in the table below arrives
   as a background-image and leaves .bar-region's own --well backing intact
   underneath. That is what lets the fills stack: --bar-plan is a 20% wash,
   and a stack of translucent pills would show the breach hatch through the
   plan. See .bar-region in app.css. */
const flat = (c) => `linear-gradient(var(${c}), var(${c}))`;

/* barRegions emits 'spent', 'allocated', 'overspent', 'gap' and 'beyond'.
   There is no 'overAllocated' region: over-allocation is a plan fact (see
   below), not a region key, and paints through 'beyond' like an overspend
   does.

   'gap' is deliberately absent from this table. It is still real geometry -
   barRegions computes and returns it, and the tests still hold it to
   tiling - but it is the money with no job yet, and that is now said by
   leaving the track bare rather than by painting anything at all. A key
   with no entry here renders nothing; see the filter in the map below. */
const PAINT = {
  spent: flat("--accent"),
  allocated: flat("--bar-plan"),
  overspent: hatch("--breach"),
  beyond: hatch("--breach"),
};

/* Paint order, longest pill first, so the shorter one lands on top: the
   breach behind everything with only its overhang showing, then the plan,
   then the solid spend nested inside it.

   barRegions still returns tiled left-to-right spans, and it should - tiling
   is what makes the geometry provable, and the tests hold it to that. But
   tiled spans are the wrong thing to *draw*. Rendered as pills they gave
   every pair of neighbours two facing semicircular caps with a crescent of
   bare track between them, so the bar read as something that had been
   interrupted rather than as one thing sitting inside another. Only the `to`
   of each span is used here, as that pill's extent from zero, which is why a
   fill ending short of the one behind it means money still contained and a
   fill whose end pokes out from behind means the failure. */
const STACK = ["beyond", "overspent", "allocated", "spent"];

/* The bullets beside the figures echo the bar's own paint: a solid dot for
   spent (PAINT.spent), a plain washed dot for allocated (PAINT.allocated),
   and a hollow ring for left to allocate since the bar marks that money by
   leaving the track bare and outlined in --rule-strong, not by filling it. */
const dotBase = { display: "inline-block", width: 6, height: 6, borderRadius: "50%", marginRight: 6, verticalAlign: "middle" };
const spentDot = { ...dotBase, background: PAINT.spent };
const allocatedDot = { ...dotBase, background: PAINT.allocated };
const leftDot = (overAllocated) => (overAllocated
  ? { ...dotBase, background: "var(--breach)" }
  : { ...dotBase, background: "transparent", boxShadow: "inset 0 0 0 1px var(--rule-strong)" });

function MonthBar({ mo, currency }) {
  const income = monthIncome(mo), alloc = monthAllocated(mo), actual = monthActual(mo);
  const unalloc = monthUnallocated(mo);
  const over = withRowIds(mo, overBudgetItems(mo));
  const g = barGeometry(income, alloc, actual);

  if (g.empty) {
    return (
      <div style={{ margin: "4px 0 38px" }}>
        <div className="bar-track" />
        <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
          Add this month's income to start allocating.
        </div>
      </div>
    );
  }

  const regions = barRegions(g);
  /* g.overAllocated is a plan fact (the allocation exceeds income): it drives
     the label and the figure's colour. The 'beyond' region is a rendering
     fact (something extends past the income mark, from allocation or
     spending or both): it drives the mark. A month can still have money to
     allocate while having overspent past its income, so these two must never
     be conflated: that month shows the mark and still says "left to
     allocate". */
  const hasBeyond = regions.some((r) => r.key === "beyond");
  const figureColor = g.overAllocated ? "var(--breach-ink)" : "var(--ink)";
  /* Concentric pills, all anchored at the track's left edge; see STACK. A
     key with no PAINT entry (that is 'gap') drops out here. */
  const byKey = new Map(regions.map((r) => [r.key, r]));
  const rendered = STACK.filter((key) => PAINT[key] && byKey.has(key));

  /* The figures beside the bar say everything the bar says, so announcing
     the bar as well would just duplicate. MiniBar is role="img" because it
     stands alone; this one does not. */
  return (
    <div style={{ margin: "4px 0 38px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16, fontSize: 12, color: "var(--muted)" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          <span style={spentDot} /><span className="num" style={{ fontSize: 16, fontWeight: 700, color: figureColor }}>{fmt(currency, actual)}</span> spent</span>
        <span>income:<span className="num" style={{ marginLeft: 8, fontSize: 18, fontWeight: 700, color: figureColor }}>{fmt(currency, income)}</span></span>
      </div>

      {/* Spec calls for transform: scaleX() so the fill transition never
          triggers layout. Every fill now shares the track's left edge, which
          is exactly the fixed origin scaleX wanted and could not have while
          the spans tiled - but scaleX would stretch each pill's semicircular
          caps into ellipses, and those caps are what carry the nesting. So
          width is animated instead, inside a track that is contain: layout
          paint. Deliberate deviation, not an oversight. */}
      <div className="bar-wrap" aria-hidden="true">
        <div className="bar-track">
          {rendered.map((key) => (
            <div key={key} className="bar-region"
              style={{
                width: `${byKey.get(key).to * 100}%`,
                backgroundImage: PAINT[key],
                transition: "width .35s ease",
              }} />
          ))}
          {/* The rule: crosses the track at 1px, carries precision (exactly
              where income falls against the fills), clipped by the track
              like the fills are. Low contrast against some fills is
              deliberate here; see .bar-mark-tick below for the part that
              has to be seen. */}
          {hasBeyond && <div className="bar-mark-rule" style={{ left: `${g.incomeX * 100}%` }} />}
        </div>
        {/* The tick: a sibling of the track, so its overhang is not clipped
            by .bar-track's overflow: hidden. It sits on --board, where
            --rule-strong actually has contrast, and is what makes the mark
            legible; see the 'mark on board' check in tests/tokens-electron.cjs. */}
        {hasBeyond && <div className="bar-mark-tick" style={{ left: `${g.incomeX * 100}%` }} />}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "baseline", gap: 20, marginTop: 16 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          <span style={allocatedDot} /><span className="num" style={{ fontSize: 16, fontWeight: 700, color: figureColor }}>{fmt(currency, alloc)}</span> allocated
        </span>
        <span>
          <span style={leftDot(g.overAllocated)} /><span className="num" style={{ fontSize: 16, fontWeight: 700, color: figureColor }}>
            {fmt(currency, Math.abs(unalloc))}
          </span>{" "}
          <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>
            {g.overAllocated ? "over-allocated" : "remaining"}
          </span>
        </span>
      </div>

      {over.length > 0 && (
        /* The named items are links, not a read-out: being told which three
           items are over and then having to go hunting for them is what makes
           this the worst moment on the screen. Once the gap closes this strip
           is the only coloured thing left, which is the point: for the 29 days
           after payday it is the only part that wants action. */
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, padding: "11px 14px", borderRadius: 8, background: "var(--breach-soft)", color: "var(--breach-ink)", fontSize: 13 }}>
          <Icons.alert size={16} style={{ flex: "none" }} />
          <strong style={{ fontWeight: 600, flex: "none" }}>{over.length} item{over.length > 1 ? "s" : ""} over budget</strong>
          <span style={{ opacity: 0.9, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            ·{" "}
            {over.slice(0, 3).map((o, i) => (
              <span key={`${o.id != null ? o.id : o.item}-${i}`}>
                {i > 0 ? ", " : ""}
                <button type="button" onClick={() => focusAllocated(o.id, o.groupId)}
                  title={`Go to ${o.item} in ${o.group}`}
                  aria-label={`Go to ${o.item} in ${o.group}, ${fmt(currency, o.over)} over`}
                  style={{ background: "transparent", border: 0, padding: 0, font: "inherit", color: "inherit", textDecoration: "underline", textUnderlineOffset: 2, cursor: "pointer" }}>
                  {o.item}
                </button>
              </span>
            ))}
            {over.length > 3 ? "…" : ""}
          </span>
          <span className="num" style={{ marginLeft: "auto", fontWeight: 600, flex: "none" }}>{fmt(currency, sumOver(over))} over total</span>
        </div>
      )}
    </div>
  );
}

export { MonthBar };
