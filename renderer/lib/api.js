/* ============================================================
   Renderer data layer - a thin wrapper around the preload's 'window.api'.

   Every method is async and already envelope-unwrapped by the preload, so
   callers get the inner data or a thrown Error. 'hasApi' lets callers degrade
   gracefully when running outside Electron (e.g. a plain browser). Also holds
   small date helpers for building the "YYYY-MM-DD" 'spent_on' the backend wants.
   ============================================================ */

const w = typeof window !== "undefined" ? window : {};

/** True when the Electron preload bridge is present. */
export const hasApi = !!(w && w.api);

/** The raw preload surface (methods are undefined outside Electron). */
export const api = (w && w.api) || {};

/** "YYYY-MM" + day-of-month -> "YYYY-MM-DD" (day clamped to 1..31). */
export function spentOn(monthKey, day) {
  let d = Math.round(Number(day));
  if (!Number.isInteger(d) || d < 1) d = 1;
  if (d > 31) d = 31;
  return `${monthKey}-${String(d).padStart(2, "0")}`;
}

/** Pull the day-of-month out of a stored "M/DD" date (fallback 1). */
export function dayFromMonthDay(mdy) {
  const parts = String(mdy || "").split("/");
  const d = Number(parts[parts.length - 1]);
  return Number.isInteger(d) && d >= 1 ? d : 1;
}
