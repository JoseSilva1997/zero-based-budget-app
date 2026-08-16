/* ============================================================
   The UI barrel: the app's shared visual vocabulary, and the only path a
   screen imports it from.

   A screen owns its own arrangement and its own copy. What it does NOT own is
   what a field, a dialog, a pill or a card looks like: those are the same
   objects wherever they appear, and a second drawing of one is how an app
   stops looking like itself. Anything reached for by more than one screen
   belongs behind this barrel.

   Split by what a thing does, not by what it looks like:
     icons        the two icon sets
     inputs       the editable primitives (amount, day, name)
     readouts     small components that show a value and take no input
     overlays     dialogs, and the focus handling that makes them dialogs
     containers   the boxes a screen puts its content inside

   The styling for all of it lives in renderer/styles/, keyed on the classes
   these components render; see the header of styles/tokens.css for the rules
   that govern which values may appear where.
   ============================================================ */
export { Icons, MsIcons } from "./icons.jsx";
export { MoneyInput, DayField, TextInline } from "./inputs.jsx";
export { Avatar, DiffPill, MiniBar } from "./readouts.jsx";
export { Modal, ConfirmDialog } from "./overlays.jsx";
export { ChartCard } from "./containers.jsx";
