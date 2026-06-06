/* ============================================================
   Month-id and entry-date helpers. A month id is a "YYYY-MM" string; an
   actual-entry date is a stored "M/DD" string. Pure, no React.
   ============================================================ */

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(id) {
  const [y, m] = id.split("-").map(Number);
  return { mo: MONTH_NAMES[m - 1], yr: String(y), short: `${MONTH_NAMES[m - 1].slice(0, 3)} ${y}` };
}

export function prevMonthId(id) {
  let [y, m] = id.split("-").map(Number);
  m -= 1;
  if (m < 1) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function nextMonthId(id) {
  let [y, m] = id.split("-").map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Number of days in a "YYYY-MM" month (day 0 of the next month). */
export function daysInMonth(monthId) {
  const [y, m] = String(monthId).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 28;
  return new Date(y, m, 0).getDate();
}

/** Day-of-month for an actual entry. Empty or invalid dates fall back to the
 *  last day of the month, so legacy entries read as month-end. */
export function actualDay(entry, monthId) {
  const last = daysInMonth(monthId);
  const parts = String((entry && entry.date) || "").split("/");
  const d = Number(parts[parts.length - 1]);
  if (Number.isInteger(d) && d >= 1 && d <= last) return d;
  return last;
}

/** Build a stored "M/DD" date from a month id and a chosen day, clamped to a
 *  valid day for that month (blank/invalid -> last day of the month). */
export function makeActualDate(monthId, day) {
  const last = daysInMonth(monthId);
  const m = Number(String(monthId).split("-")[1]);
  let d = Math.round(Number(day));
  if (!Number.isInteger(d) || d < 1) d = last;
  if (d > last) d = last;
  return `${m}/${String(d).padStart(2, "0")}`;
}
