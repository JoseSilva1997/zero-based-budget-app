/* ============================================================
   Overlays: the things that float above the page and take the keyboard with
   them. A dialog that can be tabbed out of is a dialog that has not really
   opened, so the trap, the initial focus and the focus restore are as much a
   part of these as the veil is - all three via useFocusTrap, which the Wallet
   sheet takes as well.
   ============================================================ */
import { useCallback, useEffect, useState, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from './hooks.js';
import { Icons } from './icons.jsx';

function Modal({ children, onClose, width, label }) {
  const boxRef = useRef(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`).current;
  const [titledBy, setTitledBy] = useState(null);

  // The name of a dialog is its title, not its contents. Rather than ask every
  // caller to label its dialog, find the heading each one already renders and
  // point at that; before paint, so the name is right the first time it is read.
  useLayoutEffect(() => {
    if (label) return;
    const h = boxRef.current && boxRef.current.querySelector("h1,h2,h3,h4");
    if (!h) return;
    if (!h.id) h.id = titleId;
    setTitledBy(h.id);
  }, [label, titleId, children]);

  useFocusTrap(boxRef, onClose);

  return (
    <div className="modal-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={boxRef} className="modal" role="dialog" aria-modal="true"
        aria-label={label || (titledBy ? undefined : "Dialog")} aria-labelledby={label ? undefined : titledBy || undefined}
        style={width ? { width } : undefined}>
        {children}
      </div>
    </div>
  );
}

/* ---- confirmation ------------------------------------------------------- */
/* One shape for every destructive action, so the guarantee a user learns from
   deleting an item holds when they delete a group, an account, or a member. */
function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose, busy, icon, width = 460 }) {
  return (
    <Modal onClose={busy ? () => {} : onClose} width={width}>
      <h3>{title}</h3>
      <p>{children}</p>
      {/* Cancel takes focus, never the destructive button: a stray Enter on an
          unexpected dialog must not be the thing that deletes the data. */}
      <div className="dialog-actions">
        <button className="btn btn-ghost" data-autofocus onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
          {icon}{busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ---- the sheet ----------------------------------------------------------
   The third overlay shape: a centred surface capped at 1120px, holding a
   screen's worth of work rather than a question. The Wallet and the upload
   are the two things that open one, and they share this drawing so the veil,
   the keyframe, the focus trap and the close button stay one object.

   `head` is the caller's identity block (and anything that sits beside it);
   the close button is always the last thing in the head, named by
   `closeLabel`. The sheet sits inside the veil so the veil can centre it; the
   target check is what keeps a click that lands on the sheet itself from
   reaching the veil's own handler and closing it. */
function Sheet({ label, head, closeLabel, onClose, className, children }) {
  const boxRef = useRef(null);
  useFocusTrap(boxRef, onClose);
  return (
    <div className="sheet-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside ref={boxRef} className={className ? `sheet ${className}` : "sheet"} role="dialog" aria-modal="true" aria-label={label}>
        <div className="sheet-head">
          {head}
          <button className="icon-btn sheet-close" onClick={onClose} aria-label={closeLabel} title="Close"><Icons.x size={18} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </aside>
    </div>
  );
}

/* ---- the anchored menu --------------------------------------------------
   A short list of buttons that opens from a button: Move to another group on
   the budget, a row's other options on the upload review. Portalled and
   fixed, because a group card or the sheet clips its children, so a popover
   drawn inside the row would be cut off at the edge. It starts off-screen and
   is placed after measuring, so it never flashes in the wrong spot: under
   the anchor, right-aligned to it, or above when there is no room below.

   `children` is a function given `close`, which closes the menu and gives
   focus back to the anchor when focus was inside it. `className` adds to
   .move-menu (the upload's sits above the sheet). */
function AnchoredMenu({ anchorRef, label, onClose, className, children }) {
  const ref = useRef(null);
  const placedAt = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    const btn = anchorRef.current, menu = ref.current;
    if (!btn || !menu) return;
    const a = btn.getBoundingClientRect(), m = menu.getBoundingClientRect();
    placedAt.current = { top: a.top, left: a.left };
    const left = Math.max(8, Math.min(a.right - m.width, window.innerWidth - m.width - 8));
    const below = a.bottom + 6;
    const top = below + m.height > window.innerHeight - 8 ? Math.max(8, a.top - 6 - m.height) : below;
    setPos({ top, left });
  }, [anchorRef]);
  // Closing just unmounts the portal, and the DOM node that currently holds
  // focus (an autoFocused or arrowed-to menu item) goes with it, dropping the
  // keyboard/screen-reader user on <body> with no reachable position. Focus
  // only comes back to the anchor when it was still inside the menu at the
  // moment of closing: an outside click has, by then, usually already moved
  // focus to whatever the user just clicked, and reclaiming it here would
  // yank it back away from that control.
  const close = useCallback(() => {
    if (anchorRef.current && ref.current && ref.current.contains(document.activeElement)) {
      anchorRef.current.focus();
    }
    onClose();
  }, [anchorRef, onClose]);
  useEffect(() => {
    // The anchor is excluded so its own click toggles the menu shut once,
    // rather than closing here and reopening on the button's handler.
    const onPointerDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      close();
    };
    // Fixed position cannot follow a scroll or a resize, so either dismisses
    // it, EXCEPT a scroll that originates inside the menu's own list
    // (.move-menu is 'overflow-y: auto' past nine or so items): 'e.target' is
    // the scrolled element for that case and 'document' for a page scroll, so
    // a contains() check tells the two apart. A scroll that left the anchor
    // where it was is ignored too: scroll events arrive a frame late, so one
    // from just before the menu opened (focus going back to a button, say)
    // would otherwise close it as it appears.
    const onScroll = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      const a = anchorRef.current && anchorRef.current.getBoundingClientRect();
      const at = placedAt.current;
      if (a && at && Math.abs(a.top - at.top) < 1 && Math.abs(a.left - at.left) < 1) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [anchorRef, close]);
  return createPortal(
    // A plain labelled group of buttons, not role="menu": the list is walked
    // with Tab like any other button group, and none of the arrow-key/Home/End
    // roving-tabindex contract a real menu role promises is implemented here.
    // Claiming the role without the behaviour is worse than not claiming it.
    // Escape stops here, so it closes the menu and not a sheet behind it.
    <div ref={ref} className={className ? `move-menu ${className}` : "move-menu"} role="group" aria-label={label}
      style={{ top: pos.top, left: pos.left }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
      {children(close)}
    </div>,
    document.body
  );
}

export { Modal, ConfirmDialog, Sheet, AnchoredMenu };
