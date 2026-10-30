/* ============================================================
   Overlays: the things that float above the page and take the keyboard with
   them. A dialog that can be tabbed out of is a dialog that has not really
   opened, so the trap, the initial focus and the focus restore are as much a
   part of these as the veil is - all three via useFocusTrap, which the Wallet
   sheet takes as well.
   ============================================================ */
import { useState, useLayoutEffect, useRef } from 'react';
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

export { Modal, ConfirmDialog, Sheet };
