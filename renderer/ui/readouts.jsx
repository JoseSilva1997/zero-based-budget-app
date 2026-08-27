/* ============================================================
   Readouts: small components that show a value and take no input.
   ============================================================ */
import { cx, fmt, hexToSoft } from '../lib/index.js';
import { Icons } from './icons.jsx';

/* ---- tile ---------------------------------------------------------------
   A glyph in a rounded, tinted square: an account, a savings wallet, a person
   with no avatar of their own, the thing an empty screen is missing.

   Three sizes and no more - a tile in a form row, a tile in a list of
   records, a tile standing alone on an empty screen - and the radius and the
   glyph follow the box rather than being chosen per call site.

   The fill is either `tint`, a record's own colour, which only JS can mix
   into a wash and so arrives inline; or one of three tones for the tiles that
   stand for a state rather than a record. */
function Tile({ icon: Icon, size = "lg", tint, tone = "well", className }) {
  const glyph = size === "sm" ? 16 : size === "lg" ? 22 : 17;
  /* Spelled out rather than built from `size` and `tone`, so a grep for any
     of these classes finds the place that writes it. */
  const toneClass = tint ? null : tone === "info" ? "is-info" : tone === "breach" ? "is-breach" : "is-well";
  return (
    <span className={cx("tile", size === "sm" && "is-sm", size === "lg" && "is-lg", toneClass, className)}
      style={tint ? { background: hexToSoft(tint), color: tint } : undefined}>
      <Icon size={glyph} />
    </span>
  );
}

/* ---- stat ---------------------------------------------------------------
   A figure with a caption: the four totals in a month's detail, a card in the
   History comparison, the amount at the head of the Wallet.

   Three sizes, and only the figure moves between them - 15 in a dialog's
   summary strip, 20 on a card, 30 where the figure is the whole of a surface.
   The label stays at
   one size on every rung, for the reason .eyebrow does: a caption is a
   caption, and three sizes of it would be a vocabulary with nothing to say.

   `note` is prose UNDER the figure rather than a label over it, which is a
   different job and the reason it is a second slot. `children` take whatever
   else belongs in the stack, such as the comparison card's delta line. */
function Stat({ label, figure, note, size = "md", className, children }) {
  return (
    <div className={cx("stat", size === "sm" && "is-sm", size === "lg" && "is-lg", className)}>
      {label && <div className="stat-label">{label}</div>}
      <div className="num stat-figure">{figure}</div>
      {note && <div className="stat-note">{note}</div>}
      {children}
    </div>
  );
}

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
  // Beside an item row a DiffPill says "over" in words, but in the Wallet
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

export { Tile, Stat, Avatar, DiffPill, MiniBar };
