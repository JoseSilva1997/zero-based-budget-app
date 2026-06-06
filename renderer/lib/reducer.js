/* ============================================================
   Empty-state factory. Writes go to the SQL database through granular IPC (see
   renderer/store.jsx); this minimal AppState is a read-only fallback for when
   the app runs outside Electron (no window.api), so a screen can still render.
   ============================================================ */

export function buildEmpty() {
  const d = new Date();
  const mid = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return {
    settings: { currency: "$", theme: "indigo", members: [], accounts: [], autoBackup: "onclose", lastBackup: null },
    months: { [mid]: { id: mid, incomes: [], groups: [] } },
    order: [mid],
    activeMonth: mid,
  };
}
