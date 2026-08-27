/* ============================================================
   The page skeleton: the two headings every screen is built out of.

   A screen is a title, then a run of named sections. Both are here so that a
   new screen inherits the app's own vertical rhythm by importing it rather
   than by remembering it, and so the heading levels stay in one order across
   the app instead of per file.
   ============================================================ */
import { cx } from '../lib/index.js';

/* ---- the screen's own title --------------------------------------------
   The block at the top of Dashboard, History and Settings. Month Budget does
   not take it: that screen leads with a month stepper rather than a name, so
   it composes .topbar itself out of different parts.

   `actions` fills the right-hand end of the bar for a screen that needs
   controls up there. */
function PageHeader({ title, sub, actions }) {
  return (
    <div className="topbar">
      <div>
        <div className="page-title">{title}</div>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="topbar-actions">{actions}</div>}
    </div>
  );
}

/* ---- a named section within a screen ------------------------------------
   The small-caps heading over a card or a list. It is the upper of the app's
   two label tiers; the lower one is .eyebrow, over a single object rather
   than a whole section (see the note at .eyebrow in styles/base.css).

   `children` fill the right-hand end of the heading row, which is where a
   count, a column-label strip or a control goes. */
function Section({ title, className, children }) {
  return (
    <div className={cx("section-head", className)}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export { PageHeader, Section };
