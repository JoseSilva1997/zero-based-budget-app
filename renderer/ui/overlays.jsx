/* ============================================================
   Overlays: the things that float above the page and take the keyboard with
   them. A dialog that can be tabbed out of is a dialog that has not really
   opened, so the trap, the initial focus and the focus restore are as much a
   part of these as the veil is.
   ============================================================ */
import { useState, useEffect, useLayoutEffect, useRef } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

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

  // Escape closes; Tab is trapped inside the dialog so focus can never land on
  // the page behind the veil.
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !boxRef.current) return;
      const items = Array.from(boxRef.current.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Move focus in on open, put it back where it came from on close.
  useEffect(() => {
    const returnTo = document.activeElement;
    const box = boxRef.current;
    const target = box && (box.querySelector("[data-autofocus]") || box.querySelector(FOCUSABLE));
    if (target) target.focus();
    return () => { if (returnTo && typeof returnTo.focus === "function") returnTo.focus(); };
  }, []);

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

export { Modal, ConfirmDialog };
