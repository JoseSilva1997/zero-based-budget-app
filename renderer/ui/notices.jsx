/* ============================================================
   What the app says when there is nothing to show, or when something could
   not be read. Both are the app speaking rather than reporting a number, and
   both have to look the same wherever they happen: a household that learns
   what an absence looks like on one screen should not have to learn it again
   on the next.
   ============================================================ */
import { cx } from '../lib/index.js';
import { Icons } from './icons.jsx';

/* ---- nothing here yet ---------------------------------------------------
   Two sizes, and the difference between them is what the emptiness is of.

   The page variant is a whole screen or a whole table with nothing in it, so
   it gets the larger glyph and room for a title above the sentence. The
   inline variant is one section of a screen that happens to be empty while
   the rest of the page carries on around it, so it is a single line at the
   size of the text it sits among, with no title to compete with the section
   heading already above it.

   `panel` draws the card. It is off for an emptiness that already sits inside
   one, which would otherwise be a card drawn inside a card. */
function EmptyState({ icon: Icon, title, inline = false, panel = true, className, children }) {
  return (
    <div className={cx(panel && "panel", "empty", inline && "is-inline", className)}>
      <div className="empty-icon"><Icon size={inline ? 20 : 22} /></div>
      {title && <div className="empty-title">{title}</div>}
      <div className="empty-note">{children}</div>
    </div>
  );
}

/* ---- something could not be read ----------------------------------------
   Shown rather than swallowed, so a failed read does not arrive looking like
   a household with nothing in it.

   role="alert" is on every one of these, not just the ones a screen renders
   on load: an error that appears in response to a click has to announce
   itself, because the reader's attention is on the button they just pressed.

   `banner` is the version that runs across the top of a screen. Without it
   the notice is a line inside a dialog that already carries its own fill and
   corner, and `className` is how those two sites keep the padding they were
   drawn at; see the notes at .restore-error and .hist-detail-error. */
function Alert({ banner = false, className, children }) {
  return (
    <div role="alert" className={cx("alert", banner && "alert-banner", className)}>
      <Icons.alert size={16} />
      <span>{children}</span>
    </div>
  );
}

export { EmptyState, Alert };
