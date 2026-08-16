/* ============================================================
   Readouts: small components that show a value and take no input.
   ============================================================ */
import { cx, fmt } from '../lib/index.js';
import { Icons } from './icons.jsx';

/* ---- member avatar ------------------------------------------------------ */
function Avatar({ member, size = 26 }) {
  const initials = (member?.name || "?").trim().slice(0, 1).toUpperCase();
  /* All four are runtime values: three read the size prop and the fourth the
     member's own colour. .avatar owns the rest. */
  return <span className="avatar" style={{ width: size, height: size, background: member?.color || "var(--muted)", fontSize: size * 0.42 }}>{initials}</span>;
}

/* ---- difference pill ---------------------------------------------------- */
/* Under-spending is not a win in zero-based budgeting, it is an unfinished
   allocation, so "left" is as neutral as "on track". Only a breach is
   coloured - and only a breach gets a fill; the resting states are outlined
   captions (.pill-diff). */
function DiffPill({ diff, currency }) {
  if (Math.abs(diff) < 0.005) return <span className="pill pill-diff pill-diff-ontrack"><Icons.check size={11} /> On track</span>;
  if (diff > 0) return <span className="pill pill-diff num">{fmt(currency, diff, { cents: false })} left</span>;
  return <span className="pill pill-diff pill-diff-breach num">{fmt(currency, Math.abs(diff), { cents: false })} over</span>;
}

/* ---- mini progress bar -------------------------------------------------- */
function MiniBar({ actual, allocated }) {
  const pct = allocated > 0 ? Math.min(actual / allocated, 1) : (actual > 0 ? 1 : 0);
  const over = actual > allocated + 0.001;
  // Beside an item row a DiffPill says "over" in words, but in the wallet drawer
  // the bar stands alone, so it has to say it itself: a name for screen readers,
  // and a hatch for anyone who cannot tell the breach red from the per-theme
  // accent fill by colour alone. A bar that is over is always full, so the
  // stripes never stretch out of shape.
  const share = allocated > 0 ? actual / allocated : (actual > 0 ? 1 : 0);
  const label = allocated > 0
    ? `${Math.round(share * 100)}% of the budget used${over ? ", over budget" : ""}`
    : (over ? "Over budget, nothing allocated" : "Nothing allocated");
  // scaleX rather than width: animating width relayouts every row on each
  // commit. Inline because the fraction is only known once the numbers are in.
  return (
    <div role="img" aria-label={label} className="mini-bar">
      <div className={cx("mini-bar-fill", over && "is-over")} style={{ transform: `scaleX(${pct})` }} />
    </div>
  );
}

export { Avatar, DiffPill, MiniBar };
