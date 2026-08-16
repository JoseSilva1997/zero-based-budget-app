/* ============================================================
   The UI barrel: the app's shared visual vocabulary, and the only path a
   screen imports it from.

   A screen owns its own arrangement and its own copy. What it does NOT own is
   what a field, a dialog, a pill, a heading or an empty state looks like:
   those are the same objects wherever they appear, and a second drawing of
   one is how an app stops looking like itself. Anything reached for by more
   than one screen belongs behind this barrel.

   Split by what a thing does, not by what it looks like:
     icons        the two icon sets
     layout       the page skeleton (title block, section headings)
     inputs       the editable primitives (amount, day, name)
     readouts     small components that show a value and take no input
     rows         a thing and what is true of it, at three depths
     notices      what the app says when there is nothing, or something failed
     overlays     dialogs, and the focus handling that makes them dialogs
     containers   the boxes a screen puts its content inside
     hooks        behaviour shared with no markup attached

   The styling for all of it lives in renderer/styles/, keyed on the classes
   these components render; see the header of styles/tokens.css for the rules
   that govern which values may appear where.
   ============================================================ */
export { Icons, MsIcons } from "./icons.jsx";
export { PageHeader, Section } from "./layout.jsx";
export { MoneyInput, DayField, TextInline } from "./inputs.jsx";
export { Avatar, DiffPill, MiniBar } from "./readouts.jsx";
export { ObjectRow } from "./rows.jsx";
export { EmptyState, Alert } from "./notices.jsx";
export { Modal, ConfirmDialog } from "./overlays.jsx";
export { ChartCard } from "./containers.jsx";
export { useFocusTrap } from "./hooks.js";
