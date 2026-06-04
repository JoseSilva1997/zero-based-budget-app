/* ============================================================
   Chart toolkit — hand-built responsive SVG charts
   ============================================================ */
const GROUP_PALETTE = [
  "oklch(0.72 0.14 158)", "oklch(0.75 0.15 45)", "oklch(0.70 0.14 245)",
  "oklch(0.72 0.15 300)", "oklch(0.80 0.14 75)", "oklch(0.70 0.16 20)",
  "oklch(0.76 0.12 195)", "oklch(0.74 0.15 120)",
];

function niceMax(v) {
  if (v <= 0) return 100;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function ChartFrame({ children, height = 250, pad = { t: 14, r: 14, b: 30, l: 48 }, vb = 760, max, ticks = 4, currency, fmtTick }) {
  const innerH = height - pad.t - pad.b;
  const lines = [];
  for (let i = 0; i <= ticks; i++) {
    const val = (max / ticks) * i;
    const y = pad.t + innerH - (innerH * i) / ticks;
    lines.push(
      <g key={i}>
        <line x1={pad.l} y1={y} x2={vb - pad.r} y2={y} stroke="var(--hairline)" strokeWidth="1" />
        <text x={pad.l - 8} y={y + 3.5} textAnchor="end" fontSize="10.5" fill="var(--faint)" fontFamily="var(--font-mono)">{fmtTick ? fmtTick(val) : abbr(val, currency)}</text>
      </g>
    );
  }
  return (
    <svg viewBox={`0 0 ${vb} ${height}`} width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
      {lines}
      {children({ pad, innerH, vb })}
    </svg>
  );
}
function abbr(v, c = "$") { if (v >= 1000) return `${c}${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`; return `${c}${Math.round(v)}`; }

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div style={{ position: "absolute", left: tip.x, top: tip.y, transform: "translate(-50%, -110%)", background: "var(--ink)", color: "var(--surface)", padding: "7px 10px", borderRadius: 8, fontSize: 12, pointerEvents: "none", whiteSpace: "nowrap", boxShadow: "var(--shadow-md)", zIndex: 5 }}>
      <div style={{ fontWeight: 600, marginBottom: tip.rows ? 4 : 0 }}>{tip.title}</div>
      {tip.rows && tip.rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, opacity: 0.95, fontVariantNumeric: "tabular-nums" }}>
          {r.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color }} />}
          <span style={{ opacity: 0.75 }}>{r.label}</span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)" }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function useTooltip() {
  const [tip, setTip] = useState(null);
  const ref = useRef(null);
  const show = (e, data) => { const r = ref.current.getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, ...data }); };
  return { tip, setTip, ref, show };
}

/* ---- grouped bars: income / allocated / actual -------------------------- */
function GroupedBars({ months, currency }) {
  const { tip, setTip, ref, show } = useTooltip();
  const keys = [
    { k: "income", label: "Income", color: "var(--info)" },
    { k: "alloc", label: "Allocated", color: "var(--accent)" },
    { k: "actual", label: "Actual", color: "var(--warn)" },
  ];
  const max = niceMax(Math.max(...months.flatMap(m => [m.income, m.alloc, m.actual]), 1));
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <ChartFrame max={max} currency={currency} height={250}>
        {({ pad, innerH, vb }) => {
          const slot = (vb - pad.l - pad.r) / months.length;
          const bw = Math.min(slot * 0.2, 26);
          const grp = bw * 3 + 8;
          return months.map((m, i) => {
            const cx = pad.l + slot * i + slot / 2;
            return (
              <g key={m.id}>
                {keys.map((kk, j) => {
                  const h = (m[kk.k] / max) * innerH;
                  const x = cx - grp / 2 + j * (bw + 4);
                  return <rect key={kk.k} x={x} y={pad.t + innerH - h} width={bw} height={Math.max(h, 0)} rx={3} fill={kk.color}
                    onMouseMove={(e) => show(e, { title: m.label, rows: keys.map(z => ({ label: z.label, color: z.color, value: fmt(currency, m[z.k], { cents: false }) })) })}
                    onMouseLeave={() => setTip(null)} style={{ cursor: "pointer" }} />;
                })}
                <text x={cx} y={pad.t + innerH + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{m.label.split(" ")[0]}</text>
              </g>
            );
          });
        }}
      </ChartFrame>
      <Legend keys={keys} />
      <Tooltip tip={tip} />
    </div>
  );
}

/* ---- stacked bars: spending by group ------------------------------------ */
function StackedBars({ months, groupNames, currency }) {
  const { tip, setTip, ref, show } = useTooltip();
  const colorOf = (name, i) => GROUP_PALETTE[groupNames.indexOf(name) % GROUP_PALETTE.length];
  const totals = months.map(m => groupNames.reduce((a, g) => a + (m.byGroup[g] || 0), 0));
  const max = niceMax(Math.max(...totals, 1));
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <ChartFrame max={max} currency={currency} height={250}>
        {({ pad, innerH, vb }) => {
          const slot = (vb - pad.l - pad.r) / months.length;
          const bw = Math.min(slot * 0.5, 44);
          return months.map((m, i) => {
            const cx = pad.l + slot * i + slot / 2;
            let acc = 0;
            return (
              <g key={m.id}>
                {groupNames.map((g) => {
                  const val = m.byGroup[g] || 0; if (val <= 0) return null;
                  const h = (val / max) * innerH;
                  const y = pad.t + innerH - acc - h; acc += h;
                  return <rect key={g} x={cx - bw / 2} y={y} width={bw} height={h} fill={colorOf(g)}
                    onMouseMove={(e) => show(e, { title: `${m.label} · ${g}`, rows: [{ label: "Spent", value: fmt(currency, val, { cents: false }) }] })}
                    onMouseLeave={() => setTip(null)} style={{ cursor: "pointer" }} />;
                })}
                <text x={cx} y={pad.t + innerH + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{m.label.split(" ")[0]}</text>
              </g>
            );
          });
        }}
      </ChartFrame>
      <Legend keys={groupNames.map((g) => ({ label: g, color: colorOf(g) }))} />
      <Tooltip tip={tip} />
    </div>
  );
}

/* ---- line / area chart -------------------------------------------------- */
function LineChart({ months, accessor, label, color = "var(--accent)", currency, area = true }) {
  const { tip, setTip, ref, show } = useTooltip();
  const vals = months.map(accessor);
  const max = niceMax(Math.max(...vals, 1));
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <ChartFrame max={max} currency={currency} height={230}>
        {({ pad, innerH, vb }) => {
          const innerW = vb - pad.l - pad.r;
          const x = (i) => months.length === 1 ? pad.l + innerW / 2 : pad.l + (innerW * i) / (months.length - 1);
          const y = (v) => pad.t + innerH - (v / max) * innerH;
          const pts = months.map((m, i) => [x(i), y(vals[i])]);
          const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
          const areaPath = `${path} L${pts[pts.length - 1][0]},${pad.t + innerH} L${pts[0][0]},${pad.t + innerH} Z`;
          return (
            <g>
              {area && <path d={areaPath} fill={color} opacity="0.12" />}
              <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
              {months.map((m, i) => (
                <g key={m.id}>
                  <circle cx={pts[i][0]} cy={pts[i][1]} r="4.5" fill="var(--surface)" stroke={color} strokeWidth="2.5"
                    onMouseMove={(e) => show(e, { title: m.label, rows: [{ label, color, value: fmt(currency, vals[i], { cents: false }) }] })}
                    onMouseLeave={() => setTip(null)} style={{ cursor: "pointer" }} />
                  <text x={pts[i][0]} y={pad.t + innerH + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{m.label.split(" ")[0]}</text>
                </g>
              ))}
            </g>
          );
        }}
      </ChartFrame>
      <Tooltip tip={tip} />
    </div>
  );
}

/* ---- stacked area: cumulative savings by category ----------------------- */
function StackedArea({ months, cats, accessor, currency, colorBase = 158 }) {
  const { tip, setTip, ref, show } = useTooltip();
  const colorOf = (cat) => GROUP_PALETTE[cats.indexOf(cat) % GROUP_PALETTE.length];
  const totals = months.map(m => cats.reduce((a, c) => a + (accessor(m)[c] || 0), 0));
  const max = niceMax(Math.max(...totals, 1));
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <ChartFrame max={max} currency={currency} height={230}>
        {({ pad, innerH, vb }) => {
          const innerW = vb - pad.l - pad.r;
          const x = (i) => months.length === 1 ? pad.l + innerW / 2 : pad.l + (innerW * i) / (months.length - 1);
          const y = (v) => pad.t + innerH - (v / max) * innerH;
          // build cumulative stack: lower[i][cat] = baseline before this cat
          const lowers = months.map(() => ({}));
          const uppers = months.map(() => ({}));
          months.forEach((m, i) => { let acc = 0; cats.forEach(c => { lowers[i][c] = acc; acc += accessor(m)[c] || 0; uppers[i][c] = acc; }); });
          return (
            <g>
              {cats.map((c) => {
                const top = months.map((m, i) => [x(i), y(uppers[i][c])]);
                const bot = months.map((m, i) => [x(i), y(lowers[i][c])]);
                const path = top.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ")
                  + bot.slice().reverse().map(p => `L${p[0]},${p[1]}`).join(" ") + " Z";
                return <path key={c} d={path} fill={colorOf(c)} opacity="0.82" stroke="var(--surface)" strokeWidth="1" />;
              })}
              {/* hover dots on the top line (total) */}
              {months.map((m, i) => {
                const total = cats.reduce((a, c) => a + (accessor(m)[c] || 0), 0);
                return (
                  <g key={m.id}>
                    <circle cx={x(i)} cy={y(total)} r="4" fill="var(--surface)" stroke="var(--accent-strong)" strokeWidth="2"
                      onMouseMove={(e) => show(e, { title: `${m.label} · ${fmt(currency, total, { cents: false })} saved`, rows: cats.filter(c => (accessor(m)[c] || 0) > 0).map(c => ({ label: c, color: colorOf(c), value: fmt(currency, accessor(m)[c] || 0, { cents: false }) })) })}
                      onMouseLeave={() => setTip(null)} style={{ cursor: "pointer" }} />
                    <text x={x(i)} y={pad.t + innerH + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{m.label.split(" ")[0]}</text>
                  </g>
                );
              })}
            </g>
          );
        }}
      </ChartFrame>
      <Legend keys={cats.map(c => ({ label: c, color: colorOf(c) }))} />
      <Tooltip tip={tip} />
    </div>
  );
}

function Legend({ keys }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 10 }}>
      {keys.map((k, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: k.color }} /> {k.label}
        </span>
      ))}
    </div>
  );
}

Object.assign(window, { GroupedBars, StackedBars, LineChart, StackedArea, GROUP_PALETTE });
