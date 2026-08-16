/* ============================================================
   Behaviour shared by more than one component, where the behaviour is the
   whole of what is shared and there is no markup to go with it.
   ============================================================ */
import { useEffect } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/* Everything that makes a veiled surface a real dialog rather than a box drawn
   on top of one: Escape closes it, Tab cannot leave it, focus moves into it on
   open and returns to whatever opened it on close.

   This is one hook rather than a rule each overlay follows, because the mouse
   is already stopped by the veil and the keyboard has to be stopped by code:
   an overlay that forgets a third of this is a page the keyboard silently
   falls through, and nothing about the screen says so. There are two of these
   surfaces (the modal and the Wallet drawer) and they cannot be one component,
   since one is centred and one slides in from the edge.

   `ref` is the box to trap inside. `onClose` is what Escape calls.

   Initial focus prefers an element marked [data-autofocus], which is how
   ConfirmDialog puts the caret on Cancel rather than on the button that
   deletes the data. */
function useFocusTrap(ref, onClose) {
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [ref, onClose]);

  // Empty deps: this runs on open and its cleanup on close, and must not
  // re-fire in between - a re-run would drag focus back to the top of the
  // dialog while the user was partway through it.
  useEffect(() => {
    const returnTo = document.activeElement;
    const box = ref.current;
    const target = box && (box.querySelector("[data-autofocus]") || box.querySelector(FOCUSABLE));
    if (target) target.focus();
    return () => { if (returnTo && typeof returnTo.focus === "function") returnTo.focus(); };
  }, []);
}

export { useFocusTrap };
