/* ============================================================
   Renderer data layer - a thin wrapper around the preload's 'window.api'.

   Every method is async and already envelope-unwrapped by the preload, so
   callers get the inner data or a thrown Error. 'hasApi()' lets callers degrade
   gracefully when running outside Electron (e.g. a plain browser). Also holds
   small date helpers for building the "YYYY-MM-DD" 'spent_on' the backend wants.

   Everything here reads 'window.api' at the moment it is called rather than
   snapshotting it when this module loads. The preload does win that race in
   the shipped app, but a module that only works when it is evaluated late is
   a trap for anything that mounts a component against a stand-in bridge, which
   is exactly what tests/update-banner-electron.cjs does.

   THE BRIDGE RULE
   ---------------
   'window.api' is named in this file and nowhere else in the renderer. Budget
   reads and writes go through the store, which is the only caller that needs
   them; the handful of things that are not budget data (the app version, the
   menu's shortcut list, backups, updates) come through here instead, so there
   is one door into the main process rather than one per screen.

   scripts/check-platform.mjs enforces it, run by `npm test` via `pretest`.
   ============================================================ */

const bridge = () => (typeof window !== "undefined" && window.api) || null;

/** True when the Electron preload bridge is present. */
export const hasApi = () => !!bridge();

/* The preload surface, read through on every access so it is whatever
   'window.api' is now. Outside Electron every method reads as undefined
   rather than throwing on the property access, which is what lets 'can'
   below be the single test callers make. */
export const api = new Proxy({}, {
  get(_target, method) {
    const b = bridge();
    const value = b ? b[method] : undefined;
    return typeof value === "function" ? value.bind(b) : value;
  },
  has(_target, method) {
    const b = bridge();
    return !!b && method in b;
  },
});

/* Whether the bridge actually carries a given method. The two dev-only
   channels are absent from a shipped build, and the whole surface is absent
   outside Electron, so anything optional is asked for by name rather than
   assumed from 'hasApi()'. */
export const can = (method) => typeof api[method] === "function";

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
